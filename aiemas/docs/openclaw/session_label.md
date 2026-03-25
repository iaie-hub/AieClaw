# 会话消息保存与加载实现分析

## 1. 会话消息持久化方案

### 1.1 存储格式

每个会话对应一个 JSONL 文件，路径为：

```
~/.openclaw/agents/<agentId>/sessions/<sessionId>.jsonl
```

每行是一个独立的 JSON 对象，代表一条消息（用户消息、助手回复、工具调用结果等）。

### 1.2 消息保存流程

消息通过 **追加写入** 方式持久化：

- 用户发送消息时，`chat.send`（`src/gateway/server-methods/chat.ts`）将用户消息追加到 JSONL 文件末尾。
- AI 回复完成后，`appendAssistantTranscriptMessage` 将助手消息追加到同一文件。
- 每次追加前，系统会调用 `readSessionMessages` 全量读取文件以计算消息序号（seq），这是一个 O(N) 操作。

### 1.3 消息加载流程

`chat.history` 方法从 JSONL 文件全量读取并解析所有行，然后按 `limit` 参数截取最后 N 条返回给前端。

### 1.4 会话元数据存储

会话元数据（`SessionEntry`）存储在 `sessions.json` 中（`~/.openclaw/agents/<agentId>/sessions.json`），以 `sessionKey → SessionEntry` 的 JSON 对象形式保存。`SessionEntry` 包含 `sessionId`、`label`、`displayName`、`origin`、`updatedAt` 等字段。

---

## 2. `displayName` 的生成逻辑

`sessions.list` 返回的每条会话记录中，`displayName` 字段由 `buildGatewaySessionRow`（`src/gateway/session-utils.ts:1039`）按以下优先级回退链计算：

```
entry.displayName
  ?? buildGroupDisplayName(channel, subject, groupChannel, space, id, key)  // 仅 group 会话
  ?? entry.label
  ?? entry.origin?.label
```

对于 webchat 直聊会话（`chatType: "direct"`），`channel` 为 `"webchat"`，`buildGroupDisplayName` 不适用，因此实际回退链为：

```
entry.displayName ?? entry.label ?? entry.origin?.label
```

**`origin.label` 的来源**：首次 `chat.send` 时，`deriveSessionOrigin`（`src/config/sessions/metadata.ts`）从 `MsgContext.SenderName`（即 `clientInfo.displayName`，来自 WebSocket 握手时的 `client.connect.client.displayName`）提取 `label`，通过 `deriveSessionMetaPatch` 写入 `SessionEntry.origin.label`。

---

## 3. 会话历史文件重新生成后 `displayName` 丢失的根因

### 3.1 现象

用户创建会话时指定了会话名称（体现为 `origin.label`），`sessions.list` 能正确返回 `displayName`。但会话历史文件（JSONL）被重新生成（即发生 **session reset**）后，`displayName` 丢失，变为 `null`。

### 3.2 根因分析

**Session reset** 由 `performGatewaySessionReset`（`src/gateway/session-reset-service.ts:253`）执行。该函数在重置时构造一个全新的 `nextEntry` 对象写入 `sessions.json`，**显式列出了需要保留的字段**：

```typescript
const nextEntry: SessionEntry = {
  sessionId: randomUUID(), // 新 sessionId → 触发新 JSONL 文件
  updatedAt: now,
  systemSent: false,
  abortedLastRun: false,
  thinkingLevel: currentEntry?.thinkingLevel,
  fastMode: currentEntry?.fastMode,
  verboseLevel: currentEntry?.verboseLevel,
  reasoningLevel: currentEntry?.reasoningLevel,
  responseUsage: currentEntry?.responseUsage,
  model: resolvedModel.model,
  modelProvider: resolvedModel.provider,
  contextTokens: resetEntry?.contextTokens,
  sendPolicy: currentEntry?.sendPolicy,
  label: currentEntry?.label, // ✅ 保留 label
  origin: snapshotSessionOrigin(currentEntry), // ✅ 保留 origin（含 origin.label）
  lastChannel: currentEntry?.lastChannel,
  lastTo: currentEntry?.lastTo,
  lastAccountId: currentEntry?.lastAccountId,
  lastThreadId: currentEntry?.lastThreadId,
  skillsSnapshot: currentEntry?.skillsSnapshot,
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  totalTokensFresh: true,
  // ❌ displayName 未被保留！
};
```

**`displayName` 字段被遗漏**，没有从 `currentEntry` 复制到 `nextEntry`。

### 3.3 影响路径

`buildGatewaySessionRow` 的回退链在 `entry.displayName` 为 `undefined` 时会继续尝试 `entry.label` 和 `entry.origin?.label`。

- 如果 `origin.label` 被 `snapshotSessionOrigin` 正确保留，则 `displayName` 应该仍能通过 `origin.label` 回退得到。
- 但实际丢失说明：**`origin` 本身在某些情况下也未被正确保留**，或者 `origin.label` 在 webchat 会话中从未被写入（例如 mas4s 集成路径下，`origin.label` 的写入依赖首次 `chat.send` 时的 `MsgContext.SenderName`，而 reset 后的首条消息可能走了不同的代码路径）。

### 3.4 补充：`origin.label` 写入时机

`origin.label` 并非在会话创建时立即写入，而是在**第一条 `chat.send` 消息到达时**，由 `deriveSessionMetaPatch` → `mergeSessionEntryPreserveActivity` 写入。如果 reset 后的新会话在 `sessions.list` 被调用之前还没有收到任何消息，则 `origin.label` 为空，`displayName` 自然为 `null`。

---

## 4. Session Reset 的触发时机与实现方案

### 4.1 触发时机

Session reset 有以下几种触发路径：

#### 4.1.1 用户主动触发（消息命令）

用户在消息中发送重置命令，由 `initSessionState`（`src/auto-reply/reply/session.ts`）在消息入口处检测：

- 默认触发词：`/new`、`/reset`（定义于 `src/config/sessions/types.ts:393`）
- 可通过配置 `session.resetTriggers` 自定义触发词列表
- 支持带后续消息的形式：`/new 你好` — 重置后立即发送 "你好"
- 仅授权发送者（`resetAuthorized`）可触发

#### 4.1.2 Gateway API 主动触发

通过 WebSocket 方法 `sessions.reset`（`src/gateway/server-methods/sessions.ts:971`）直接调用，参数：

```json
{ "key": "<sessionKey>", "reason": "new" | "reset" }
```

#### 4.1.3 Agent 内部命令触发

通过 `agent.run` 方法中的 `/new` 或 `/reset` 命令（`src/gateway/server-methods/agent.ts:394`），正则为：

```
/^\/(new|reset)(?:\s+([\s\S]*))?$/i
```

#### 4.1.4 自动定时重置（Scheduled Reset）

每次消息到达时，`initSessionState` 会评估当前会话的"新鲜度"（freshness）。若会话已过期，则自动分配新 `sessionId`，触发隐式 reset：

- **daily 模式**（默认）：每天 `atHour`（默认凌晨 4 点）之后的首条消息触发重置
- **idle 模式**：会话最后活跃时间超过 `idleMinutes` 后触发重置
- 重置策略可按会话类型（`direct` / `group` / `thread`）和渠道（`resetByChannel`）分别配置

新鲜度评估逻辑（`src/config/sessions/reset.ts:139`）：

```typescript
// daily 模式：updatedAt < 今日 atHour 时刻 → 过期
// idle 模式：now > updatedAt + idleMinutes * 60_000 → 过期
```

#### 4.1.5 Cron/Hook 会话重置

Cron 任务通过 `resolveCronSession`（`src/cron/isolated-agent/session.ts`）在每次执行时评估 freshness，过期则自动创建新 `sessionId`。

### 4.2 两种 Reset 实现路径的差异

系统中存在两条不同的 reset 实现路径，行为有重要差异：

#### 路径 A：`performGatewaySessionReset`（显式 reset）

用于 `sessions.reset` API 和 `agent.run` 命令触发。

**流程**：

1. 调用 `cleanupSessionBeforeMutation` 清理运行时状态（ACP、订阅等）
2. 在 `sessions.json` 中构造全新的 `nextEntry`（显式列出保留字段）
3. 调用 `archiveSessionTranscriptsForSession` 将旧 JSONL 文件重命名为 `.reset.<timestamp>` 归档
4. 发出 `session-unbound` 生命周期事件

**JSONL 文件处理**：旧文件被重命名归档，新 `sessionId` 对应新的空白 JSONL 文件。

**问题**：`nextEntry` 构造时 `displayName` 字段被遗漏（见第 3 节）。

#### 路径 B：`initSessionState` 隐式 reset（自动定时重置）

用于消息入口的自动 freshness 检测和用户命令触发。

**流程**：

1. 检测到 `!freshEntry` 或 `resetTriggered`，分配新 `crypto.randomUUID()` 作为 `sessionId`
2. 构造 `sessionEntry` 时以 `baseEntry`（旧 entry）为基础展开（`...baseEntry`），再覆盖特定字段
3. 旧 JSONL 文件通过 `archiveSessionTranscriptsForSession` 归档（`.reset.<timestamp>`）

**关键区别**：路径 B 使用 `...baseEntry` 展开，因此**所有字段默认被保留**，包括 `displayName`、`chatType`、`channel` 等。路径 A 则是显式构造，遗漏了 `displayName`。

```typescript
// 路径 B（auto-reply/reply/session.ts）— displayName 通过 ...baseEntry 隐式保留
sessionEntry = {
  ...baseEntry, // ← 包含 displayName
  sessionId,
  updatedAt: Date.now(),
  // ...覆盖特定字段
};

// 路径 A（session-reset-service.ts）— displayName 被遗漏
const nextEntry: SessionEntry = {
  sessionId: randomUUID(),
  label: currentEntry?.label,
  origin: snapshotSessionOrigin(currentEntry),
  // ❌ displayName 未列出
};
```

### 4.3 JSONL 文件归档命名规则

重置后旧 JSONL 文件被重命名为：

```
<sessionId>.jsonl.reset.<ISO8601时间戳>
```

例如：`81344567-fa80-48ad-b2ae-066a411c691a.jsonl.reset.2026-03-24T00-59-25.677Z`

这与用户提供的文件列表完全吻合，可以通过文件名中的 `.reset.` 标记识别被归档的历史会话文件。

---

## 5. 解决方案

### 5.1 修复方案（推荐）

在 `performGatewaySessionReset` 的 `nextEntry` 构造中，补充保留 `displayName` 字段：

```typescript
// src/gateway/session-reset-service.ts
const nextEntry: SessionEntry = {
  // ... 现有字段 ...
  label: currentEntry?.label,
  displayName: currentEntry?.displayName, // ← 新增此行
  origin: snapshotSessionOrigin(currentEntry),
  // ...
};
```

同时，建议也保留 `chatType`、`channel`、`groupId`、`subject`、`groupChannel`、`space` 等与会话身份相关的字段，避免 group 会话 reset 后同样丢失 `displayName`：

```typescript
const nextEntry: SessionEntry = {
  // ... 现有字段 ...
  label: currentEntry?.label,
  displayName: currentEntry?.displayName,
  chatType: currentEntry?.chatType,
  channel: currentEntry?.channel,
  groupId: currentEntry?.groupId,
  subject: currentEntry?.subject,
  groupChannel: currentEntry?.groupChannel,
  space: currentEntry?.space,
  origin: snapshotSessionOrigin(currentEntry),
  // ...
};
```

### 5.2 防御性修复

在 `buildGatewaySessionRow` 的 `displayName` 回退链中，增加对 `entry.chatType === "direct"` 时直接使用 `origin.label` 的显式处理，确保即使 `displayName` 字段丢失，`origin.label` 也能被正确使用（当前逻辑已支持，但依赖 `origin` 被正确保留）。

### 5.3 验证方法

修复后，可通过以下步骤验证：

1. 创建一个 webchat 直聊会话，确认 `sessions.list` 返回正确的 `displayName`。
2. 触发 session reset（例如通过 `chat.new` 或等待每日重置）。
3. 再次调用 `sessions.list`，确认 `displayName` 仍然正确。

相关测试文件：`src/gateway/server.sessions.gateway-server-sessions-a.test.ts`。

---

## 6. 与 `session_message_store.md` 的关系

`session_message_store.md` 描述的 JSONL 持久化方案是准确的。本文档补充了以下内容：

- `displayName` 不存储在 JSONL 文件中，而是存储在 `sessions.json` 的 `SessionEntry` 里。
- JSONL 文件的重新生成（新 `sessionId`）本身不会导致 `displayName` 丢失；丢失的原因是 `sessions.json` 中的 `SessionEntry` 在 reset 时未保留 `displayName` 字段。
- 两个问题相互独立：JSONL 的性能问题（O(N) 读取）和 `displayName` 丢失问题需要分别修复。
