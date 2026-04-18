## 一、前端收到的消息类型完整参考

> 本节记录前端 `event-handler.ts` 实际生成并写入 `messagesByAgent` / `messagesBySession` 的所有 `ChatMessage` 类型，
> 包括各类型的 `role`、`content` 结构、来源事件路径和 JSON 示例。

### 1.1 类型定义回顾

```typescript
// aiemas/ui/mas4s/src/lib/chat-types.ts
type MessageContentItem = {
  type:
    | "text"
    | "tool_call"
    | "tool_result"
    | "thinking"
    | "approval_requested"
    | "approval_resolved"
    | "sop_state"
    | "skill_progress";
  text?: string;
  thinking?: string;
  name?: string;
  args?: unknown;
  isError?: boolean;
};

// aiemas/ui/mas4s/src/types/chat-types.ts
interface ChatMessage extends NormalizedMessage {
  subType?: "colleague" | "pending" | "execution-followup";
}
```

### 1.2 消息类型总览

| #   | 消息类型             | `role`                            | 来源事件                    | 来源 stream                      | 渲染组件                        | 位置   |
| --- | -------------------- | --------------------------------- | --------------------------- | -------------------------------- | ------------------------------- | ------ |
| 1   | 用户输入             | `"user"`                          | `chat` (state: delta/final) | —                                | `<msg-user>`                    | 右对齐 |
| 2   | 协作者输入           | `"user"` (subType: `"colleague"`) | `chat` (state: delta/final) | —                                | `<msg-colleague>`               | 左对齐 |
| 3   | A2A Agent 输入       | `"agent"`                         | `agent`                     | `stream: "agent"`                | `<msg-agent-input>`             | 右对齐 |
| 4   | Prompt 输入          | 由 normalizeMessage 推断          | `agent`                     | `stream: "prompt"`               | 按 role 分发                    | —      |
| 5   | Assistant 流式回复   | `"assistant"`                     | `agent`                     | `stream: "assistant"`            | `<msg-agent>`                   | 左对齐 |
| 6   | 思考过程（Thinking） | `"assistant"`                     | `agent`                     | `stream: "thinking"`             | `<msg-agent>` (thinking 折叠块) | 左对齐 |
| 7   | 工具调用结果         | `"toolResult"`                    | `agent` / `session.tool`    | `stream: "tool"` (phase: result) | `<msg-tool-result>`             | 左对齐 |
| 8   | Chat Final 确认      | `"assistant"`                     | `chat` (state: final)       | —                                | `<msg-agent>`                   | 左对齐 |

### 1.3 各类型详细说明与 JSON 示例

---

#### 1.3.1 用户输入消息（User Input）

**来源**：`event: "chat"`, `state: "delta" | "final"`, `message.role === "user"`

**处理函数**：`handleChatEvent` → `normalizeMessage` → `parseSenderPrefix`

**特征**：

- `role: "user"`
- 无 `senderLabel` 时为当前用户发送
- 有 `senderLabel` 时 `subType` 设为 `"colleague"`（协作者消息）

```json
{
  "role": "user",
  "content": [{ "type": "text", "text": "请帮我分析 src/main.ts 的性能问题" }],
  "timestamp": 1713254221000,
  "id": "run-abc123",
  "sessionKey": "IaaS-Orchestrator:uuid-xxx",
  "senderLabel": null,
  "subType": undefined
}
```

---

#### 1.3.2 协作者输入消息（Colleague Input）

**来源**：`event: "chat"`, 消息文本包含 `[sender:xxx]` 前缀

**处理函数**：`handleChatEvent` → `parseSenderPrefix` 解析出 `senderLabel`

**特征**：

- `role: "user"`
- `subType: "colleague"`
- `senderLabel` 为协作者用户名

```json
{
  "role": "user",
  "content": [{ "type": "text", "text": "我觉得可以用缓存优化" }],
  "timestamp": 1713254225000,
  "id": "run-def456",
  "sessionKey": "IaaS-Orchestrator:uuid-xxx",
  "senderLabel": "alice",
  "subType": "colleague"
}
```

---

#### 1.3.3 A2A Agent 输入消息（Agent-to-Agent Input）

**来源**：`event: "agent"`, `stream: "agent"`, 由 `aiemas_sessions_send` 通过 `emitAgentEvent` 广播

**处理函数**：`handleAgentEvent` → `stream === "agent"` 分支

**特征**：

- `role: "agent"`（从 `data.role` 显式取值）
- `senderLabel` 为发送方 Agent ID
- `id` 格式为 `a2a-{timestamp}`（无 runId 时）

```json
{
  "role": "agent",
  "content": [
    {
      "type": "text",
      "text": "查询 xstack 平台上的所有物理机（裸金属服务器）列表，包括状态、规格、所在机柜/机房等信息"
    }
  ],
  "timestamp": 1713254230000,
  "id": "a2a-1713254230000",
  "sessionKey": "Resource-Manager:uuid-yyy",
  "senderLabel": "IaaS-Orchestrator",
  "subType": undefined
}
```

---

#### 1.3.4 Prompt 输入消息（Manual Prompt）

**来源**：`event: "agent"`, `stream: "prompt"`, 由 ACP 路径的 `emitAcpPrompt` 触发

**处理函数**：`handleAgentEvent` → `stream === "prompt"` 分支

**特征**：

- `role` 由 `normalizeMessage(data.text)` 推断（通常为 `"user"`）
- 用于 ACP（Agent Communication Protocol）路径的用户输入

```json
{
  "role": "user",
  "content": [{ "type": "text", "text": "执行部署任务" }],
  "timestamp": 1713254235000,
  "id": "run-ghi789",
  "sessionKey": "Deploy-Agent:uuid-zzz",
  "senderLabel": null,
  "subType": undefined
}
```

---

#### 1.3.5 Assistant 流式回复（Assistant Streaming）

**来源**：`event: "agent"`, `stream: "assistant"`, `data.text` 为累积文本

**处理函数**：`handleAgentEvent` → `stream === "assistant"` 分支 → `updateAgentChatStream`（原地更新）

**特征**：

- `role: "assistant"`
- `id` 为 `runId`（流式更新使用同一 id 原地覆盖）
- `content` 可能同时包含 `thinking` 和 `text` 两个 item（thinking 从 `_thinkingByRun` 缓存合并）
- 流式更新期间持续触发，最终由 `chat` final 事件确认

```json
{
  "role": "assistant",
  "content": [
    { "type": "thinking", "thinking": "用户需要查询物理机列表，我应该调用 xstack API..." },
    { "type": "text", "text": "我来帮您查询 xstack 平台上的物理机列表。让我调用相关 API..." }
  ],
  "timestamp": 1713254240000,
  "id": "run-jkl012",
  "sessionKey": "Resource-Manager:uuid-yyy",
  "senderLabel": null
}
```

**纯文本回复（无 thinking）**：

```json
{
  "role": "assistant",
  "content": [
    { "type": "text", "text": "查询完成，共找到 12 台物理机，其中 8 台在线、4 台维护中。" }
  ],
  "timestamp": 1713254260000,
  "id": "run-jkl012",
  "sessionKey": "Resource-Manager:uuid-yyy",
  "senderLabel": null
}
```

---

#### 1.3.6 思考过程消息（Thinking）

**来源**：`event: "agent"`, `stream: "thinking"`, `data.text` 为全量累积思考文本

**处理函数**：`handleAgentEvent` → `stream === "thinking"` 分支 → `_thinkingByRun` 缓存 → `updateAgentChatStream`

**特征**：

- `role: "assistant"`
- `content` 仅包含 `{ type: "thinking" }` item（无 `text` item）
- `id` 为 `runId`（与后续 assistant 流式回复共享同一 id，原地更新）
- 当 assistant 流式回复到达时，thinking 内容会被合并到 assistant 消息的 content 数组中

```json
{
  "role": "assistant",
  "content": [
    {
      "type": "thinking",
      "thinking": "用户需要查询物理机列表，我应该先确认 xstack API 的访问权限，然后调用 list-bare-metals 接口..."
    }
  ],
  "timestamp": 1713254238000,
  "id": "run-jkl012",
  "sessionKey": "Resource-Manager:uuid-yyy",
  "senderLabel": null
}
```

> **注意**：thinking 消息和 assistant 消息共享同一 `runId` 作为 `id`。thinking 先到达时创建消息，assistant 文本到达后通过 `updateAgentChatStream` 原地更新，将 thinking 和 text 合并到同一条消息的 `content` 数组中。

---

#### 1.3.7 工具调用结果消息（Tool Result）

**来源**：`event: "agent"` 或 `event: "session.tool"`, `stream: "tool"`, `phase: "result"`

**处理函数**：`handleAgentEvent` → `stream === "tool"` 分支 → `phase === "result"` 时追加 `toolResult` 消息

**特征**：

- `role: "toolResult"`
- `id` 格式为 `{toolCallId}-result`
- 携带 `toolCallId` 和 `toolName` 字段
- `isError` 标记工具执行是否失败
- `content` 包含 `{ type: "tool_result" }` item

**工具执行三阶段**（仅 `phase: "result"` 生成 ChatMessage）：

| phase    | 行为                                | 是否生成 ChatMessage    |
| -------- | ----------------------------------- | ----------------------- |
| `start`  | 记录工具名和参数到 `toolStreamById` | 否（仅更新 toolStream） |
| `update` | 更新部分结果到 `toolStreamById`     | 否（仅更新 toolStream） |
| `result` | 追加 `toolResult` 消息到消息流      | **是**                  |

```json
{
  "role": "toolResult",
  "content": [
    {
      "type": "tool_result",
      "text": "{\n  \"bare_metals\": [\n    { \"id\": \"bm-001\", \"status\": \"online\", \"spec\": \"64C/256G\", \"rack\": \"A-12\" },\n    { \"id\": \"bm-002\", \"status\": \"maintenance\", \"spec\": \"128C/512G\", \"rack\": \"B-03\" }\n  ],\n  \"total\": 12\n}"
    }
  ],
  "timestamp": 1713254250000,
  "id": "call_abc123-result",
  "sessionKey": "Resource-Manager:uuid-yyy",
  "senderLabel": null,
  "toolCallId": "call_abc123",
  "toolName": "xstack_list_bare_metals",
  "isError": false
}
```

**工具执行失败示例**：

```json
{
  "role": "toolResult",
  "content": [{ "type": "tool_result", "text": "Error: API timeout after 30s" }],
  "timestamp": 1713254255000,
  "id": "call_def456-result",
  "sessionKey": "Resource-Manager:uuid-yyy",
  "senderLabel": null,
  "toolCallId": "call_def456",
  "toolName": "xstack_get_server_detail",
  "isError": true
}
```

---

#### 1.3.8 Chat Final 确认消息

**来源**：`event: "chat"`, `state: "final"`, `message.role === "assistant"`

**处理函数**：`handleChatEvent` → `updateAgentChatStream`（原地更新，保留 thinking）

**特征**：

- `role: "assistant"`
- 由 `chat` 事件的 `state: "final"` 触发
- 通过 `updateAgentChatStream` 原地更新已有的流式消息（保留 thinking 内容，更新 text 部分）
- 同时触发 `_thinkingByRun` 缓存清理和 `isChatting` 状态重置
- 子 Agent 的 `activeAgents` 状态在此时清除

```json
{
  "role": "assistant",
  "content": [{ "type": "text", "text": "查询完成。xstack 平台共有 12 台物理机..." }],
  "timestamp": 1713254265000,
  "id": "run-jkl012",
  "sessionKey": "Resource-Manager:uuid-yyy",
  "senderLabel": null
}
```

> **注意**：final 消息到达时，`updateAgentChatStream` 会将已有消息中的 `thinking` content item 保留，仅用 final 消息的 `text` content item 替换旧的 text 部分。最终消息的 `content` 数组同时包含 thinking 和 text。

### 1.4 消息生命周期与流式更新策略

```
┌─────────────────────────────────────────────────────────────────────┐
│                     消息生命周期时序                                  │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. thinking delta 到达                                              │
│     └─ _thinkingByRun[runId] = text                                 │
│     └─ ChatMessage { id: runId, role: "assistant",                  │
│          content: [{ type: "thinking", thinking: "..." }] }         │
│     └─ updateAgentChatStream → 追加新消息                            │
│                                                                     │
│  2. assistant delta 到达                                             │
│     └─ ChatMessage { id: runId, role: "assistant",                  │
│          content: [                                                  │
│            { type: "thinking", thinking: "..." },  ← 从缓存合并     │
│            { type: "text", text: "..." }                             │
│          ] }                                                         │
│     └─ updateAgentChatStream → 原地更新（id + role 匹配末尾消息）    │
│                                                                     │
│  3. tool phase=start                                                 │
│     └─ upsertToolStream（仅更新 toolStreamById，不生成 ChatMessage） │
│                                                                     │
│  4. tool phase=update                                                │
│     └─ upsertToolStream（更新部分结果）                               │
│                                                                     │
│  5. tool phase=result                                                │
│     └─ ChatMessage { id: "{toolCallId}-result", role: "toolResult", │
│          toolCallId, toolName, isError }                             │
│     └─ appendAgentMessage → 追加新消息                               │
│                                                                     │
│  6. chat final 到达                                                  │
│     └─ updateAgentChatStream → 原地更新（保留 thinking，更新 text）  │
│     └─ _thinkingByRun.delete(runId)                                 │
│     └─ store.setIsChatting(false)                                   │
│     └─ store.clearAgentActive（子 Agent）                            │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 1.5 消息渲染路由（message-list.ts）

```
ChatMessage
  │
  ├─ role === "user" || role === "User"
  │   └─ <msg-user>                          右对齐，蓝色气泡
  │
  ├─ subType === "colleague"
  │   └─ <msg-colleague>                     左对齐，琥珀色气泡
  │
  ├─ role === "agent"
  │   └─ <msg-agent-input>                   右对齐，蓝色气泡 + 绿色 A2A 徽章
  │
  ├─ role === "assistant"
  │   ├─ content 含 { type: "thinking" }
  │   │   └─ <msg-agent> (thinking 折叠块)   左对齐，灰色气泡
  │   └─ content 含 { type: "text" }
  │       └─ <msg-agent>                     左对齐，灰色气泡
  │
  ├─ role === "tool" || role === "toolResult"
  │   └─ <msg-tool-result>                   左对齐，工具卡片
  │
  ├─ role === "progress"
  │   └─ (不渲染，由 SOP pipeline 组件消费)
  │
  └─ 其他 role
      └─ (不渲染)
```

### 1.6 拓扑状态条预览（topology-bar.ts `_getLatestPreview`）

拓扑状态条从 `agentMessages` 中提取最新消息作为子 Agent 卡片的预览文本：

| 消息类型       | `role`                       | 预览显示               | 示例                                                |
| -------------- | ---------------------------- | ---------------------- | --------------------------------------------------- |
| A2A 消息       | `"agent"`                    | `[发送者] 文本前24字…` | `[IaaS-Orchestrator] 查询 xstack 平台上的所有物理…` |
| 工具调用结果   | `"toolResult"`               | `🔧 工具名`            | `🔧 xstack_list_bare_metals`                        |
| Assistant 文本 | `"assistant"` (有 text)      | 文本前24字截断         | `查询完成，共找到 12 台物理机…`                     |
| 思考过程       | `"assistant"` (仅 thinking)  | `💭 思考中…`           | `💭 思考中…`                                        |
| 工具调用中     | `"assistant"` (含 tool_call) | `🔧 调用 工具名`       | `🔧 调用 xstack_list_bare_metals`                   |
| 无消息         | —                            | `等待响应`（灰色斜体） | `等待响应`                                          |

### 1.7 事件路径与消息类型映射

```
WebSocket Event
  │
  ├─ event: "chat"
  │   ├─ state: "clear"        → 清空消息（无 ChatMessage 生成）
  │   ├─ state: "delta"
  │   │   ├─ role: "user"      → ChatMessage { role: "user" }
  │   │   └─ role: "assistant" → 跳过（由 agent stream:assistant 处理）
  │   └─ state: "final"
  │       ├─ role: "user"      → ChatMessage { role: "user" }（最终确认）
  │       └─ role: "assistant" → ChatMessage { role: "assistant" }（原地更新）
  │
  ├─ event: "agent"
  │   ├─ stream: "prompt"      → ChatMessage { role: normalizeMessage 推断 }
  │   ├─ stream: "agent"       → ChatMessage { role: "agent" }（A2A 输入）
  │   ├─ stream: "assistant"   → ChatMessage { role: "assistant" }（流式更新）
  │   ├─ stream: "thinking"    → ChatMessage { role: "assistant", content: [thinking] }
  │   └─ stream: "tool"
  │       ├─ phase: "start"    → 仅更新 toolStreamById（无 ChatMessage）
  │       ├─ phase: "update"   → 仅更新 toolStreamById（无 ChatMessage）
  │       └─ phase: "result"   → ChatMessage { role: "toolResult" }
  │
  ├─ event: "session.tool"     → 复用 handleAgentEvent（协作者工具事件）
  │
  ├─ event: "exec.approval.requested"  → ApprovalRequest（非 ChatMessage）
  └─ event: "exec.approval.resolved"   → ApprovalResolved（非 ChatMessage）
```
