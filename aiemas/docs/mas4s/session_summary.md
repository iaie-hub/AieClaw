# Session Summary: `session.summary.generate` & `session.summary.get`

## 概述

会话摘要功能通过 LLM 对多智能体协作会话的对话内容和工具调用记录生成结构化摘要，并支持持久化存储与查询。

---

## 数据模型

```typescript
// aiemas/src/models.ts
interface SessionSummary {
  sessionKey: string;
  textSummary: string | null; // 对话文本摘要（≤300字）
  toolSummary: string | null; // 工具调用摘要（≤300字）
  generatedAt: number; // Unix ms 时间戳
  generatedBy: string; // 触发生成的 userId
}
```

SQLite 表：`session_summaries`（位于 `mas4s.db`）

```sql
INSERT OR REPLACE INTO session_summaries
  (sessionKey, textSummary, toolSummary, generatedAt, generatedBy)
VALUES (?, ?, ?, ?, ?)
```

---

## `session.summary.generate`

### 权限矩阵

| 维度                   | 规则                                   |
| ---------------------- | -------------------------------------- |
| 全局角色               | `admin` \| `member`（viewer 不可调用） |
| 会话角色（活跃会话）   | `owner` \| `participant`               |
| 会话角色（已归档会话） | 仅 `owner`                             |

### 调用参数

```json
{ "sessionKey": "<session-key>" }
```

### 处理流程

```
客户端
  │
  ▼
mas4s-gateway-plugin.ts  →  extraHandlers["session.summary.generate"]
  │  1. 提取 callerUserId（来自 MasAuthContext）
  │  2. 构造 fetchHistory 回调（调用内部 chat.history，limit=1000）
  ▼
GatewayAuthBridge.generateSummary()
  │  3. isSessionArchived() 判断会话状态
  │
  ├─ 活跃会话：checkSessionAccess() 验证成员资格
  └─ 已归档：_getSessionRole() 验证必须为 owner
  │
  │  4. fetchHistory() → ChatHistoryMessage[]
  │  5. extractContentForSummary() → { textLines, toolPairs }
  │  6. generateSummaryWithLLM() → { textSummary, toolSummary, generatedAt }
  │
  ├─ 活跃会话：直接返回，persisted=false（不写库）
  └─ 已归档：upsertSummary() 写入 session_summaries，persisted=true
```

### 内容提取逻辑（`extractContentForSummary`）

- `user` 消息：提取 `type=text` 的内容块，前缀 `senderLabel`（默认"用户"）
- `assistant` 消息：提取非 thinking 的 `type=text` 块，前缀"助手"；收集 `type=toolCall` 到 Map
- `toolResult` 消息：与对应 toolCall 配对，组成 `ToolPair { name, arguments, result, isError }`

### LLM 调用

两次独立请求（有内容才调用）：

1. 文本摘要：系统提示要求不超过 300 字，只输出摘要正文
2. 工具摘要：格式化为 `[success/failure] toolName(args)` 列表后请求摘要

参数：`temperature=0.3, max_tokens=1024`

后处理：`stripThinkingPreamble()` 去除 `<think>...</think>` 及推理前言。

### 响应

```typescript
// 成功
{
  ok: true,
  textSummary: string | null,
  toolSummary: string | null,
  generatedAt: number,
  persisted: boolean   // true=已归档且写库，false=活跃会话仅返回
}

// 失败
{ ok: false, code: string, message: string }
```

常见错误码：`SESSION_ACCESS_DENIED` / `LLM_NOT_CONFIGURED` / `NO_MESSAGES_TO_SUMMARIZE`

### 自动触发（归档时）

`session.archive` 处理完成后，`archiveSession()` 内部自动调用 `generateSummary()`（best-effort，失败不影响归档结果），并在成功时通过 `pushSummaryUpdated()` 向所有在线成员推送 `session.summary.updated` 事件。

---

## `session.summary.get`

### 权限矩阵

| 维度     | 规则                            |
| -------- | ------------------------------- |
| 全局角色 | `admin` \| `member` \| `viewer` |
| 会话角色 | `owner` \| `participant`        |

### 调用参数

```json
{ "sessionKey": "<session-key>" }
```

### 处理流程

```
客户端
  │
  ▼
mas4s-gateway-plugin.ts  →  extraHandlers["session.summary.get"]
  │  1. 提取 callerUserId
  ▼
GatewayAuthBridge.getSummary()
  │  2. checkSessionAccess() 验证成员资格
  │  3. sessionManager.getSummary() 查询 session_summaries
  └─ 返回 SessionSummary | null
```

### 响应

```typescript
// 成功（有摘要）
{
  ok: true,
  summary: {
    sessionKey: string,
    textSummary: string | null,
    toolSummary: string | null,
    generatedAt: number,
    generatedBy: string
  }
}

// 成功（无摘要）
{ ok: true, summary: null }

// 失败
{ ok: false, code: "SESSION_ACCESS_DENIED", message: string }
```

---

## 关键约束

- 活跃会话生成的摘要**不持久化**，每次调用重新生成
- 已归档会话的摘要**持久化**，仅 owner 可重新生成（覆盖写入）
- 会话删除时（`onSessionDeleted`）自动清理 `session_summaries` 记录
- LLM 配置优先级：plugin config → 全局 provider fallback → 环境变量（详见 `summary_llm.md`）

---

## 相关文件

| 文件                                                | 职责                                             |
| --------------------------------------------------- | ------------------------------------------------ |
| `aiemas/src/gateway-bridge/mas4s-gateway-plugin.ts` | 请求入口，handler 注册                           |
| `aiemas/src/gateway-bridge/bridge.ts`               | `generateSummary` / `getSummary` 业务逻辑        |
| `aiemas/src/gateway-bridge/summary-llm.ts`          | 内容提取 + LLM 调用                              |
| `aiemas/src/gateway-bridge/session-manager.ts`      | `upsertSummary` / `getSummary` / `deleteSummary` |
| `aiemas/src/rbac/permission-checker.ts`             | 权限矩阵定义                                     |
| `aiemas/src/models.ts`                              | `SessionSummary` 类型                            |
| `aiemas/docs/mas4s/summary_llm.md`                  | LLM 配置说明                                     |
