# 历史消息同步方案

Agent 之间**没有共享内存**，历史消息同步通过以下机制实现。

---

## 1. `sessions_history` 工具 — 主动读取历史

**源文件：** `src/agents/tools/sessions-history-tool.ts`

Agent 主动调用此工具读取另一个 session 的完整对话历史。

### 1.1 工具参数

```typescript
{
  sessionKey:     string;   // 目标 session key
  limit?:         number;   // 返回的最大消息条数（>= 1）
  includeTools?:  boolean;  // 是否包含工具调用消息，默认 false（过滤掉）
}
```

### 1.2 完整执行流程

```
Agent A 调用 sessions_history(sessionKey)
  │
  ├─ resolveSessionReference()       — 解析 session key（支持 sessionId/别名）
  ├─ resolveVisibleSessionReference()— Sandbox 可见性验证
  │
  ├─ 创建 A2A Policy + Visibility Guard（与 sessions_send 相同逻辑）
  │   └── visibilityGuard.check(resolvedKey)  — 返回 allowed/forbidden
  │
  ├─ callGateway("chat.history", { sessionKey: resolvedKey, limit })
  │   └── 返回 { messages: Message[] }
  │
  ├─ includeTools=false → stripToolMessages()  — 过滤 role=toolResult/tool 的消息
  │
  ├─ 逐条 sanitizeHistoryMessage()  — 安全清洗（见 1.3）
  │
  ├─ capArrayByJsonBytes(items, 80KB)  — 按字节限制截断
  │
  ├─ enforceSessionsHistoryHardCap()  — 兜底硬限
  │
  └─ 返回 { sessionKey, messages, truncated, droppedMessages, contentTruncated, contentRedacted, bytes }
```

### 1.3 数据安全清洗管道

每条消息经过 `sanitizeHistoryMessage` 处理：

```typescript
function sanitizeHistoryMessage(message: unknown) {
  // 1. 删除大型辅助字段
  delete entry.details;  // 工具结果详情（通常非常大）
  delete entry.usage;    // token 用量
  delete entry.cost;     // 费用

  // 2. 递归清洗 content 数组中的每个 block
  for each block in content: sanitizeHistoryContentBlock(block)

  // 3. 清洗顶层 text 字段
  truncateHistoryText(entry.text)
}
```

`sanitizeHistoryContentBlock` 按 block type 处理：

```typescript
function sanitizeHistoryContentBlock(block) {
  // 文本 block：redact 敏感信息 + 截断到 4000 字符
  if (block.text) {
    block.text = redactSensitiveText(block.text); // 正则匹配并替换凭证（OC-07）
    block.text = truncateUtf16Safe(block.text, 4000);
  }

  // thinking block：redact 思考文本 + 删除加密签名
  if (block.type === "thinking") {
    block.thinking = redactSensitiveText(block.thinking);
    delete block.thinkingSignature; // 加密签名体积大且无用，始终删除
    truncated = true;
  }

  // partialJson block：redact + 截断
  if (block.partialJson) {
    /* 同文本处理 */
  }

  // image block：删除 base64 数据，只保留元信息
  if (block.type === "image") {
    const bytes = block.data?.length;
    delete block.data; // 删除 base64 原始数据
    block.omitted = true; // 标记为已省略
    block.bytes = bytes; // 保留原始字节数（供参考）
    truncated = true;
  }
}
```

### 1.4 响应大小控制（两道防线）

**第一道：`capArrayByJsonBytes`（序列化后字节限制）**

```typescript
const SESSIONS_HISTORY_MAX_BYTES = 80 * 1024; // 80KB

const cappedMessages = capArrayByJsonBytes(
  sanitizedMessages.map((entry) => entry.message),
  SESSIONS_HISTORY_MAX_BYTES,
);
// 从最早的消息开始丢弃，直到总字节数 <= 80KB
```

**第二道：`enforceSessionsHistoryHardCap`（兜底保护）**

```typescript
function enforceSessionsHistoryHardCap({ items, bytes, maxBytes }) {
  if (bytes <= maxBytes) return items; // 未超出，直接返回

  // 尝试只返回最后一条消息
  const lastOnly = [items.at(-1)];
  if (jsonUtf8Bytes(lastOnly) <= maxBytes) {
    return { items: lastOnly, hardCapped: true };
  }

  // 若单条也超出，返回占位符
  return {
    items: [{ role: "assistant", content: "[sessions_history omitted: message too large]" }],
    hardCapped: true,
  };
}
```

### 1.5 返回字段说明

```typescript
{
  sessionKey:      string;   // 目标 session 的显示 key
  messages:        Message[]; // 清洗后的消息列表
  truncated:       boolean;  // 是否有任何内容被截断（消息丢失 或 内容截断 或 hardCap）
  droppedMessages: boolean;  // 是否有整条消息被丢弃（超过 80KB 限制）
  contentTruncated:boolean;  // 是否有消息内部内容被截断（超过 4000 字符限制）
  contentRedacted: boolean;  // 是否有敏感内容被 redact（凭据、API key 等）
  bytes:           number;   // 实际返回的消息总字节数
}
```

---

## 2. `sessions_list` 工具的 `messageLimit` 参数 — 批量预览

**源文件：** `src/agents/tools/sessions-list-tool.ts`

`sessions_list` 支持在列出 session 时同时拉取每个 session 的最近消息（预览）。

### 2.1 参数

```typescript
{
  kinds?:        string[];  // 过滤 session 类型
  limit?:        number;    // 返回的最大 session 数量
  activeMinutes?: number;   // 只返回近 N 分钟内活跃的 session
  messageLimit?: number;    // 每个 session 预拉取的最新消息条数（最多 20）
}
```

`messageLimit` 上限硬设为 20：

```typescript
const messageLimit = Math.min(messageLimitRaw, 20); // 单个 session 最多 20 条
```

### 2.2 批量并发拉取实现

```typescript
if (messageLimit > 0 && historyTargets.length > 0) {
  // 最多 4 个并发 worker，避免过度压力 Gateway
  const maxConcurrent = Math.min(4, historyTargets.length);
  let index = 0;

  const worker = async () => {
    while (true) {
      const next = index++;
      if (next >= historyTargets.length) return;
      const target = historyTargets[next];

      const history = await gatewayCall<{ messages: unknown[] }>({
        method: "chat.history",
        params: { sessionKey: target.resolvedKey, limit: messageLimit },
      });

      const rawMessages = history?.messages ?? [];
      const filtered = stripToolMessages(rawMessages); // 过滤工具消息
      target.row.messages =
        filtered.length > messageLimit
          ? filtered.slice(-messageLimit) // 只保留最新的 messageLimit 条
          : filtered;
    }
  };

  await Promise.all(Array.from({ length: maxConcurrent }, () => worker()));
}
```

> **注意：** `sessions_list` 拉取的历史**不做安全清洗**（无 redact/truncate），仅过滤 tool 消息。**不应用于读取敏感 session 的历史**，需要完整安全清洗时请用 `sessions_history`。

### 2.3 与 `sessions_history` 的对比

| 特性         | `sessions_history`             | `sessions_list` + messageLimit     |
| ------------ | ------------------------------ | ---------------------------------- |
| 消息数量限制 | 无内置上限（`limit` 参数控制） | 每个 session 最多 20 条            |
| 安全清洗     | ✅ redact + 截断 + 删除签名    | ❌ 仅 stripToolMessages            |
| 敏感数据保护 | ✅ 完整（OC-07 合规）          | ❌ 无保护                          |
| 字节限制     | ✅ 80KB 硬限                   | ❌ 无                              |
| 并发拉取     | ❌ 单次请求                    | ✅ 最多 4 并发                     |
| 适用场景     | Agent 读取他人历史（安全）     | 列表展示时附带最近几条消息（预览） |

---

## 3. `chat.history` Gateway 协议

所有历史读取操作底层均调用 Gateway 的 `chat.history` 方法：

```typescript
callGateway<{ messages: Message[] }>({
  method: "chat.history",
  params: {
    sessionKey: string;   // 目标 session 的 canonical key
    limit?:     number;   // 最大返回条数（不设则返回全部）
  },
})
```

返回的 `Message` 结构：

```typescript
type Message = {
  role: "user" | "assistant" | "system" | "tool" | "toolResult";
  content: string | ContentBlock[];
  // 可能包含：details, usage, cost, stopReason, errorMessage 等扩展字段
};
```

`chat.history` 是**只读**操作，不会向 session 注入任何消息，也不会触发 agent 运行。

---

## 4. Session Store — 持久化元数据（跨 agent 共享）

**路径：** `~/.openclaw/sessions/<agentId>/store.json`

每个 agentId 有独立目录，记录该 agent 所有 session 的元数据：

```typescript
type SessionEntry = {
  sessionId: string; // Gateway 内部 ID
  model?: string; // 运行时使用的模型名称
  modelProvider?: string; // 模型提供商
  channel?: string; // 绑定的消息 channel
  to?: string; // 消息投递目标
  threadId?: string; // 线程 ID（Discord/Slack 等）
  spawnDepth?: number; // spawn 深度（0=主 session）
  spawnedBy?: string; // 父 session key
  spawnedWorkspaceDir?: string; // 继承的工作区目录
  // ...
};
```

跨 agent 读写时，各自通过 `loadSessionStore(storePath)` 读取对应 agentId 目录，**不共享文件句柄**。子 agent 写入：`updateSessionStore(storePath, mutator)`。

---

## 5. Subagent Registry — 进程内运行状态（仅 Gateway 内部）

**源文件：** `src/agents/subagent-registry-memory.ts`, `src/agents/subagent-registry.ts`

Gateway 进程内维护一个全局 Map，记录所有子 agent 的运行状态：

```typescript
// 进程级全局注册表
export const subagentRuns: Map<string, SubagentRunRecord> = new Map();

type SubagentRunRecord = {
  runId:                string;
  childSessionKey:      string;
  requesterSessionKey:  string;
  controllerSessionKey?: string;
  task:                 string;
  label?:               string;
  model?:               string;
  createdAt:            number;
  endedAt?:             number;
  outcome?:             { status: "ok" | "error" | ... };
};
```

支持查询接口：

- `listSubagentRunsForController(sessionKey)` — 列出某 session 控制的子 agent
- `countPendingDescendantRuns(sessionKey)` — 统计待完成的后代 agent
- `getLatestSubagentRunByChildSessionKey(key)` — 查最新 run 状态

> **注意：** 此注册表仅在单个 gateway 进程内有效，**不跨进程持久化**，重启后清空。
