# aiemas 会话消息持久化实现方案 v3

> 在 v2 基础上新增 **exec.approval 事件持久化**和**审批卡片历史回放**能力，实现完整的非流式对话回放。

## 1. v2 → v3 变更概述

v2 已覆盖 user 消息、assistant 消息（含 thinking + toolCall）、tool 调用事件的持久化。v3 补齐最后两块拼图：

| 事件类型                                  | v2 状态            | v3 状态                |
| ----------------------------------------- | ------------------ | ---------------------- |
| 用户消息 (chat.send)                      | ✅ handleUpdate    | ✅ 不变                |
| agent 事件 (thinking/assistant/lifecycle) | ✅ handleUpdate    | ✅ 不变                |
| tool 调用事件 (stream:tool)               | ✅ recordToolEvent | ✅ 不变                |
| exec.approval.requested                   | ❌ 仅前端内存      | ✅ recordApprovalEvent |
| 用户发出的 exec.approval.resolve 请求     | ❌ 未覆盖          | ✅ recordApprovalEvent |
| exec.approval.resolved                    | ❌ 仅前端内存      | ✅ recordApprovalEvent |

v3 后，`session_messages` 表完整记录了一次对话中的所有事件，历史回放时能以非流式方式还原实时对话的完整视图。

## 2. 总体架构

v3 在 v2 的写入路径基础上新增路径 C（审批事件捕获）：

```
                    ┌──────────────────────────────────────────────────┐
                    │              写入路径                              │
                    │                                                  │
Gateway 消息事件     │  路径 A（v1）                                    │
      │             │  onSessionTranscriptUpdate                       │
      ▼             │    → handleUpdate()                              │
onSessionTranscript │    → user / assistant(含 thinking+toolCall)      │
Update              │                                                  │
      │             │  路径 B（v2）                                    │
      │             │  filterBroadcast (mas4s-integration.ts)          │
      │             │    → agent/session.tool stream:tool              │
      │             │      → recordToolEvent()                         │
      │             │                                                  │
      │             │  路径 C（v3 新增）                               │
      │             │  filterBroadcast (mas4s-integration.ts)          │
      │             │    → exec.approval.requested                     │
      │             │      → recordApprovalEvent(type:"requested")     │
      │             │    → exec.approval.resolved                      │
      │             │      → recordApprovalEvent(type:"resolved")      │
      │             │                                                  │
      │             │  路径 D（v3 新增）                               │
      │             │  interceptRequest (mas4s-integration.ts)         │
      │             │    → exec.approval.resolve (用户请求)            │
      │             │      → recordApprovalEvent(type:"user-resolve")  │
      │             └──────────────────────────────────────────────────┘
      │
      ▼
SessionTranscriptStore
      │  ← 内存缓冲（buffer[]）
      │  ← pendingToolCalls（工具调用暂存）
      ▼
flush() — 每 3000ms 或 buffer ≥ 100 条时触发
      │
      ▼
persistBatch() — SQLite 事务批量写入
      │
      ▼
mas4s.message.db → session_messages 表
```

前端还原路径（v3 新增审批卡片还原）：

```
session.history.range 返回 StoredMessage[]（ASC 顺序）
      │
      ▼
.flatMap(normalizeMessage → splitHistoryMessage)
      │
      ├── role="user"      → msg-user 渲染
      ├── role="assistant"  → msg-agent 渲染
      │   ├── "[thinking] ..."        → { type: "thinking", thinking }
      │   ├── "[text] ..."            → { type: "text", text }
      │   ├── "[tool_use:name] {}"    → { type: "tool_call", name, args }
      │   └── "[tool_result] ..."     → { type: "tool_result", text }
      ├── role="tool"       → msg-agent 渲染
      └── role="approval"   → msg-approval-card 渲染 ⭐ v3 新增
          ├── "[approval:requested] {}" → { type: "approval_requested", args }
          └── "[approval:resolved] {}"  → { type: "approval_resolved", args }
              │
              ▼
          message-list._buildHistoryResolvedMap()
          将 approval_resolved 按 id 索引，
          渲染 approval_requested 时查找匹配的 resolved 状态
              │
              ▼
          msg-approval-card（只读，isInitiator=false）
          已决策：显示审批结果 badge
          未决策：显示过期状态（历史回放中不可操作）
```

---

## 3. 数据库 schema 变更

### 3.1 session_messages.role 扩展

`role` 列的 CHECK 约束新增 `'approval'` 值：

```sql
CREATE TABLE IF NOT EXISTS session_messages (
  id          TEXT    PRIMARY KEY,
  sessionKey  TEXT    NOT NULL,
  sessionId   TEXT    NOT NULL,
  userId      TEXT    NULL,
  tenantId    TEXT    NULL,
  role        TEXT    NOT NULL
              CHECK(role IN ('user','assistant','tool','approval')),  -- ⭐ 新增 'approval'
  content     TEXT    NOT NULL,
  timestamp   INTEGER NOT NULL,
  seq         INTEGER NOT NULL DEFAULT 0,
  archivedDate TEXT   NULL
);
```

原表已手动删除，`CREATE TABLE IF NOT EXISTS` 直接创建新表，无需迁移。

### 3.2 TypeScript 类型同步

`StoredMessage.role` 类型扩展：

```typescript
// aiemas/src/session-history/session-transcript-store.ts
role: "user" | "assistant" | "tool" | "approval";
```

`normaliseRole` 函数新增 `'approval'` 分支：

```typescript
if (raw === "approval") {
  return "approval";
}
```

---

## 4. 审批事件序列化格式

与 v2 的 `[thinking]`、`[tool_use:name]`、`[tool_result]` 行前缀格式保持一致，新增两种前缀：

### 4.1 exec.approval.requested

```
[approval:requested] {"id":"31ef2104-...","command":"rm /tmp/123.txt","cwd":"/Users/admin/...","resolvedPath":"/bin/rm","host":"gateway","agentId":"default","security":"allowlist","sessionKey":"agent:default:group:mas-6895471d","createdAtMs":1774529145408,"expiresAtMs":1774529265408,"triggeredByMsgId":"<assistant-msg-uuid>"}
```

存储字段：

| 字段             | 来源                           | 说明                                                                            |
| ---------------- | ------------------------------ | ------------------------------------------------------------------------------- |
| id               | payload.id                     | 审批请求唯一 ID                                                                 |
| command          | payload.request.command        | 待执行命令                                                                      |
| commandPreview   | payload.request.commandPreview | 命令预览（可选）                                                                |
| cwd              | payload.request.cwd            | 工作目录                                                                        |
| resolvedPath     | payload.request.resolvedPath   | 解析后的可执行文件路径                                                          |
| host             | payload.request.host           | 执行主机                                                                        |
| agentId          | payload.request.agentId        | Agent ID                                                                        |
| security         | payload.request.security       | 安全策略                                                                        |
| sessionKey       | payload.request.sessionKey     | 会话标识                                                                        |
| createdAtMs      | payload.createdAtMs            | 请求创建时间（用作 timestamp）                                                  |
| expiresAtMs      | payload.expiresAtMs            | 过期时间                                                                        |
| triggeredByMsgId | handleUpdate 回填              | 触发本次审批的 assistant 消息 id（见 §5.4）；前端用于在历史视图中精确隐藏该消息 |

### 4.2 exec.approval.resolved

```
[approval:resolved] {"id":"31ef2104-...","decision":"allow-once","resolvedBy":"管理员","ts":1774529155912}
```

存储字段：

| 字段       | 来源               | 说明                                       |
| ---------- | ------------------ | ------------------------------------------ |
| id         | payload.id         | 对应的审批请求 ID                          |
| decision   | payload.decision   | 决策结果：allow-once / allow-always / deny |
| resolvedBy | payload.resolvedBy | 审批人名称                                 |
| ts         | payload.ts         | 决策时间（用作 timestamp）                 |

### 4.3 exec.approval.resolve（用户请求）

```
[approval:user-resolve] {"id":"31ef2104-...","decision":"allow-once","resolvedBy":"管理员","ts":1774529155900}
```

由 `interceptRequest` 在 RBAC 通过后、原始 handler 执行前写入，timestamp 为用户发出请求的时刻（比 `exec.approval.resolved` 广播早几毫秒）。

存储字段：

| 字段       | 来源                | 说明                              |
| ---------- | ------------------- | --------------------------------- |
| id         | params.id           | 对应的审批请求 ID                 |
| decision   | params.decision     | 决策结果                          |
| resolvedBy | masAuth.displayName | 审批人名称（来自 MAS 认证上下文） |
| ts         | Date.now()          | 用户发出请求的时刻                |

前端解析时，`[approval:user-resolve]` 与 `[approval:resolved]` 使用相同的 `approval_resolved` content item 类型，渲染效果一致。

### 4.3 数据库记录示例

以用户发送"删除/tmp/123.txt"为例，`session_messages` 中的完整记录：

| seq | role      | content 摘要                                                                                      | timestamp     |
| --- | --------- | ------------------------------------------------------------------------------------------------- | ------------- |
| 1   | user      | `删除/tmp/123.txt`                                                                                | 1774529139543 |
| 2   | assistant | `[thinking] 用户请求删除...\n[text] 我来删除这个文件。`                                           | 1774529142876 |
| 3   | assistant | `[tool_use:exec] {"command":"rm /tmp/123.txt"}\n[tool_result] remove /tmp/123.txt`                | 1774529145011 |
| 4   | approval  | `[approval:requested] {"id":"31ef2104-...","command":"rm /tmp/123.txt",...}`                      | 1774529145408 |
| 5   | approval  | `[approval:user-resolve] {"id":"31ef2104-...","decision":"allow-once","resolvedBy":"管理员",...}` | 1774529155900 |
| 6   | approval  | `[approval:resolved] {"id":"31ef2104-...","decision":"allow-once","resolvedBy":"管理员",...}`     | 1774529155912 |

所有事件使用原始 timestamp 入库，`seq` 单调递增保证同一 session 内的入库顺序。查询时按 `timestamp ASC` 排序还原真实时间线。

---

## 5. 后端实现

### 5.1 SessionTranscriptStore.recordApprovalEvent

源文件：`aiemas/src/session-history/session-transcript-store.ts`

```typescript
recordApprovalEvent(params: {
  sessionKey: string;
  type: "requested" | "resolved" | "user-resolve";
  payload: unknown;
  timestamp: number;
}): void {
  const { sessionKey, type, payload, timestamp } = params;
  const content = `[approval:${type}] ${JSON.stringify(payload)}`;
  this.pushToBuffer({
    sessionKey,
    role: "approval",
    content,
    timestamp,
  });
}
```

调用 `pushToBuffer` 写入内存缓冲，与 user/assistant/tool 消息共享同一条写入管线（buffer → flush → persistBatch → SQLite 事务）。`role` 为 `"approval"`，与其他消息类型区分。

> `triggeredByMsgId` 字段**不在此处写入**，而是由 `handleUpdate` 在写入 assistant 消息后回填（见 §5.4）。

### 5.2 filterBroadcast 旁路捕获（路径 C）

源文件：`src/gateway/mas4s-integration.ts`

在 v2 已有的 tool event 捕获逻辑之后，新增对审批广播事件的拦截：

```typescript
// 路径 C：审批广播事件 → 持久化到 session_messages
if (event === "exec.approval.requested") {
  // sessionKey 来自 payload.request.sessionKey
  // recordApprovalEvent({ type: "requested", payload: { id, command, cwd, ... }, timestamp: createdAtMs })
}

if (event === "exec.approval.resolved") {
  // sessionKey 来自 payload.request.sessionKey
  // recordApprovalEvent({ type: "resolved", payload: { id, decision, resolvedBy, ts }, timestamp: ts })
}
```

### 5.3 interceptRequest 钩子（路径 D）

源文件：`src/gateway/mas4s-integration.ts`

在 RBAC 检查通过后，当 method 是 `exec.approval.resolve` 时，从 `ExecApprovalManager.getSnapshot(id)` 查 `sessionKey`，fire-and-forget 写入 `[approval:user-resolve]` 记录：

```typescript
if (result.allowed && method === "exec.approval.resolve" && execApprovalManager) {
  const snapshot = execApprovalManager.getSnapshot(params.id);
  const sessionKey = snapshot?.request?.sessionKey;
  if (sessionKey) {
    plugin.transcriptStore.recordApprovalEvent({
      sessionKey,
      type: "user-resolve",
      payload: { id, decision, resolvedBy: masAuth.displayName, ts: Date.now() },
      timestamp: Date.now(),
    });
  }
}
```

`execApprovalManager` 通过 `_setExecApprovalManager` 在 gateway 启动后注入（`server.impl.ts`），与 `_setActiveClients` 模式一致。

此时 approval 仍在 pending 状态（`interceptRequest` 在原始 handler 执行前调用），`getSnapshot` 能可靠地返回 snapshot。

### 5.3 时间顺序保证

所有事件使用原始 timestamp 入库：

| 事件                            | timestamp 来源                 | 说明                       |
| ------------------------------- | ------------------------------ | -------------------------- |
| 用户消息                        | msg.timestamp                  | handleUpdate 路径          |
| agent thinking/assistant        | msg.timestamp                  | handleUpdate 路径          |
| tool start/result               | payload.ts                     | recordToolEvent 路径       |
| exec.approval.requested         | payload.createdAtMs            | recordApprovalEvent 路径 C |
| 用户 exec.approval.resolve 请求 | Date.now() at interceptRequest | recordApprovalEvent 路径 D |
| exec.approval.resolved          | payload.ts                     | recordApprovalEvent 路径 C |

`seq` 在 `pushToBuffer` 中从 `SessionState.lastSeq` 单调递增，保证同一 session 内消息的入库顺序。历史查询 `queryHistoryRange` 按 `timestamp DESC` 排序后分页，返回前反转为 ASC，天然保持时间顺序。

### 5.4 handleUpdate 回填 triggeredByMsgId（历史视图一致性）

源文件：`aiemas/src/session-history/session-transcript-store.ts`

**背景：** agent 在等待审批期间会生成一条 assistant 消息（如"需要批准才能执行删除命令，请回复 /approve ..."）。实时视图中，`chat final` 事件以空 content 覆盖该消息，审核卡片 UI 接管了"等待审批"的语义，用户不会看到这条文本。但历史视图直接回放 JSONL transcript，该消息会原样渲染，导致历史视图比实时视图多出一条冗余的 assistant 气泡。

**时序约束：** `exec.approval.requested` 通过 `filterBroadcast`（路径 C）触发，此时 agent run 仍在进行中，JSONL transcript 尚未落盘，`recordApprovalEvent` 调用时 buffer 里还没有那条 assistant 消息，无法在写入 approval 时直接关联。

**解决方案：** 在 `handleUpdate` 写入 assistant 消息后，反向扫描 buffer，找到同 session 最近一条尚未关联 `triggeredByMsgId` 的 `[approval:requested]` 记录，将刚写入的 assistant 消息 id 原地回填进去：

```typescript
// handleUpdate 内，role === "assistant" 时执行
if (role === "assistant") {
  for (let i = this.buffer.length - 2; i >= 0; i--) {
    const entry = this.buffer[i];
    if (!entry || entry.sessionKey !== sessionKey || entry.role !== "approval") continue;
    if (!entry.content.startsWith("[approval:requested]")) continue;
    const jsonStart = entry.content.indexOf(" ") + 1;
    const parsed = JSON.parse(entry.content.slice(jsonStart));
    if (!parsed["triggeredByMsgId"]) {
      parsed["triggeredByMsgId"] = stored.id;
      entry.content = `[approval:requested] ${JSON.stringify(parsed)}`;
    }
    break; // 只回填最近一条
  }
}
```

回填发生在 `flush()` 之前，因此 `persistBatch` 写入 DB 时 `[approval:requested]` 的 content 已包含 `triggeredByMsgId`。

---

## 6. 前端实现

### 6.1 MessageContentItem 类型扩展

源文件：`aiemas/ui/mas4s/src/lib/chat-types.ts`

```typescript
export type MessageContentItem = {
  type:
    | "text"
    | "tool_call"
    | "tool_result"
    | "thinking"
    | "approval_requested"
    | "approval_resolved"; // ⭐ v3 新增
  text?: string;
  thinking?: string;
  name?: string;
  args?: unknown;
};
```

### 6.2 normalizeMessage 解析扩展

源文件：`aiemas/ui/mas4s/src/lib/message-normalizer.ts`

在逐行解析循环中，新增两种行前缀匹配（位于 `[tool_result]` 之后）：

```typescript
// [approval:requested] {...}
const approvalReqMatch = /^\[approval:requested\]\s*(.*)$/.exec(line);
if (approvalReqMatch) {
  flushText();
  const data = JSON.parse(approvalReqMatch[1] ?? "{}");
  items.push({ type: "approval_requested", args: data });
  continue;
}

// [approval:resolved] {...}
const approvalResMatch = /^\[approval:resolved\]\s*(.*)$/.exec(line);
if (approvalResMatch) {
  flushText();
  const data = JSON.parse(approvalResMatch[1] ?? "{}");
  items.push({ type: "approval_resolved", args: data });
  continue;
}
```

解析后的 content items 中，`args` 字段包含完整的审批请求/决策数据，供渲染层重建审批卡片。

### 6.3 message-list 审批卡片渲染

源文件：`aiemas/ui/mas4s/src/views/message-list.ts`

#### 6.3.1 历史 resolved 索引与触发消息 id 集合构建

每次 `render()` 时，扫描所有 `role="approval"` 消息，同时完成两件事：

1. 将 `approval_resolved` 类型的 content item 按 `id` 建立索引（`_cachedHistoryResolved`）
2. 收集所有 `approval_requested` 中的 `triggeredByMsgId`，存入 `_cachedApprovalTriggeredMsgIds`

```typescript
private _buildHistoryResolvedMap(): Map<string, ApprovalResolved> {
  const map = new Map<string, ApprovalResolved>();
  this._cachedApprovalTriggeredMsgIds = new Set<string>();
  for (const msg of this.messages) {
    if (msg.role !== "approval") continue;
    // 收集 triggeredByMsgId
    const reqItem = msg.content.find((c) => c.type === "approval_requested");
    if (reqItem?.args) {
      const reqData = reqItem.args as Record<string, unknown>;
      const triggeredId = reqData["triggeredByMsgId"];
      if (typeof triggeredId === "string" && triggeredId) {
        this._cachedApprovalTriggeredMsgIds.add(triggeredId);
      }
    }
    // 建立 resolved 索引
    const resItem = msg.content.find((c) => c.type === "approval_resolved");
    if (resItem?.args) {
      const data = resItem.args as Record<string, unknown>;
      const id = data["id"] as string;
      if (id) {
        map.set(id, { id, decision, resolvedBy, ts });
      }
    }
  }
  return map;
}
```

#### 6.3.2 审批卡片渲染逻辑

当 `msg.role === "approval"` 时：

1. 查找 `approval_requested` content item，从 `args` 重建 `ApprovalRequest` 对象
2. 用审批 ID 查找匹配的 resolved 状态（优先实时缓存 `resolvedApprovals`，其次历史索引 `_cachedHistoryResolved`）
3. 渲染 `msg-approval-card`，`isInitiator=false`（历史回放不可操作）

```typescript
if (msg.role === "approval") {
  const reqItem = msg.content.find((c) => c.type === "approval_requested");
  if (reqItem?.args) {
    const approval = reconstructApprovalRequest(reqItem.args);
    const resolved = resolvedFromRealtime?.resolved ?? resolvedFromHistory;
    return html`<msg-approval-card
      .approval=${approval}
      .resolved=${resolved}
      .isInitiator=${false}
    ></msg-approval-card>`;
  }
  // approval_resolved 消息不单独渲染（已被 requested 卡片消费）
  return html``;
}
```

#### 6.3.3 触发审批的 assistant 消息过滤

渲染 `role="assistant"` 消息时，检查其 id 是否在 `_cachedApprovalTriggeredMsgIds` 中，命中则跳过渲染，与实时视图中 `chat final` 覆盖的效果一致：

```typescript
if (msg.role === "assistant" && msg.id && this._cachedApprovalTriggeredMsgIds.has(msg.id)) {
  return html``;
}
return html`<msg-agent .message=${msg}></msg-agent>`;
```

#### 6.3.4 审批卡片状态

| 场景              | resolved 值                      | 卡片显示                                  |
| ----------------- | -------------------------------- | ----------------------------------------- |
| 历史回放 + 已决策 | 从 `_cachedHistoryResolved` 获取 | 显示决策结果 badge（✓ 已允许 / ✗ 已拒绝） |
| 历史回放 + 未决策 | null                             | 显示过期状态，无操作按钮                  |
| 实时 + pending    | 从 `pendingApprovals` 获取       | 显示操作按钮（允许/拒绝）                 |
| 实时 + 已决策     | 从 `resolvedApprovals` 获取      | 显示决策结果 badge                        |

---

## 7. 实时对话 vs 历史回放对照

以 WebSocket 消息流为例，展示实时对话事件与 `session_messages` 记录的对应关系：

### 7.1 实时对话事件流（WebSocket）

```
1. → req  chat.send { message: "删除/tmp/123.txt" }
2. ← event agent { stream: "lifecycle", phase: "start" }
3. ← event agent { stream: "thinking", data: { text: "Reasoning:..." } }  (多条 delta)
4. ← event agent { stream: "assistant", data: { text: "我来删除这个文件。" } }
5. ← event chat  { state: "delta", message: { role: "assistant", content: [...] } }
6. ← event agent { stream: "tool", phase: "start", name: "exec", args: {...} }
7. ← event exec.approval.requested { id: "31ef2104-...", request: { command: "rm /tmp/123.txt", ... } }
8. → req  exec.approval.resolve { id: "31ef2104-...", decision: "allow-once" }
9. ← event exec.approval.resolved { id: "31ef2104-...", decision: "allow-once", resolvedBy: "管理员" }
10. ← event agent { stream: "tool", phase: "result", toolCallId: "call_3a777e1c...", result: "..." }
11. ← event agent { stream: "lifecycle", phase: "end" }
12. ← event chat  { state: "final", message: { role: "assistant", content: [...] } }
```

### 7.2 session_messages 持久化记录

| seq | role      | content                                                                                           | timestamp     | 写入路径                    |
| --- | --------- | ------------------------------------------------------------------------------------------------- | ------------- | --------------------------- |
| 1   | user      | `删除/tmp/123.txt`                                                                                | 1774529139543 | 路径 A: handleUpdate        |
| 2   | assistant | `[thinking] 用户请求删除...\n[text] 我来删除这个文件。`                                           | 1774529142876 | 路径 A: handleUpdate        |
| 3   | assistant | `[tool_use:exec] {"command":"rm /tmp/123.txt"}\n[tool_result] remove /tmp/123.txt`                | 1774529145011 | 路径 B: recordToolEvent     |
| 4   | approval  | `[approval:requested] {"id":"31ef2104-...","command":"rm /tmp/123.txt",...}`                      | 1774529145408 | 路径 C: recordApprovalEvent |
| 5   | approval  | `[approval:user-resolve] {"id":"31ef2104-...","decision":"allow-once","resolvedBy":"管理员",...}` | 1774529155900 | 路径 D: interceptRequest    |
| 6   | approval  | `[approval:resolved] {"id":"31ef2104-...","decision":"allow-once","resolvedBy":"管理员",...}`     | 1774529155912 | 路径 C: recordApprovalEvent |

### 7.3 历史回放渲染

加载历史消息后，前端按 seq/timestamp 顺序渲染：

1. **seq=1** `role=user` → `msg-user` 组件，显示"删除/tmp/123.txt"
2. **seq=2** `role=assistant` → `msg-agent` 组件，显示 thinking 折叠块 + 文本"我来删除这个文件。"
3. **seq=3** `role=assistant` → `msg-agent` 组件（经 `splitHistoryMessage` 拆分），显示工具调用卡片（exec: rm /tmp/123.txt → 执行结果）
4. **seq=4** `role=approval` → `msg-approval-card` 组件，显示审批卡片（命令、工作目录、解析路径等元信息）
5. **seq=5** `role=approval` → 不单独渲染（`_buildHistoryResolvedMap` 已将其索引，seq=4 的卡片通过 `_cachedHistoryResolved` 查找到匹配的 resolved 状态，显示"✓ 已允许一次 · 审批人：管理员 · 审批时间：..."）

最终历史视图与实时对话视图一致：用户消息 → agent 思考+回复 → 工具调用卡片 → 审批卡片（含决策结果）。

---

## 8. 涉及文件

| 文件                                                     | 变更类型 | 说明                                                                                                                                                                                                                                                       |
| -------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aiemas/src/store/database.ts`                           | 修改     | `session_messages.role` CHECK 约束新增 `'approval'`                                                                                                                                                                                                        |
| `aiemas/src/session-history/session-transcript-store.ts` | 修改     | `StoredMessage.role` 新增 `'approval'`；`normaliseRole` 新增 `'approval'` 分支；新增 `recordApprovalEvent()` 方法；`handleUpdate` 新增 assistant 消息写入后回填 `triggeredByMsgId` 到同 session 最近 `[approval:requested]` 的逻辑（§5.4）                 |
| `src/gateway/mas4s-integration.ts`                       | 修改     | `Mas4sIntegration` 接口新增 `_setExecApprovalManager`；`filterBroadcast` 新增 `exec.approval.requested` 和 `exec.approval.resolved` 旁路捕获（路径 C）；`interceptRequest` 新增 `exec.approval.resolve` 用户请求记录（路径 D）                             |
| `src/gateway/server.impl.ts`                             | 修改     | 启动后调用 `_setExecApprovalManager` 注入 manager                                                                                                                                                                                                          |
| `aiemas/ui/mas4s/src/lib/chat-types.ts`                  | 修改     | `MessageContentItem.type` 新增 `approval_requested` / `approval_resolved`                                                                                                                                                                                  |
| `aiemas/ui/mas4s/src/lib/message-normalizer.ts`          | 修改     | 新增 `[approval:requested]` / `[approval:resolved]` / `[approval:user-resolve]` 行前缀解析                                                                                                                                                                 |
| `aiemas/ui/mas4s/src/views/message-list.ts`              | 修改     | `_buildHistoryResolvedMap` 同时收集 `triggeredByMsgId` 到 `_cachedApprovalTriggeredMsgIds`；渲染 assistant 消息时按 id 精确过滤触发审批的消息（§6.3.3）；新增 `role="approval"` 消息渲染：重建 `ApprovalRequest`、构建历史 resolved 索引、渲染只读审批卡片 |

---

## 9. 与 v2 的兼容性

- 数据库 schema：原表已删除重建，`CREATE TABLE IF NOT EXISTS` 直接使用新 CHECK 约束
- 写入路径：路径 A（handleUpdate）和路径 B（recordToolEvent）不变，路径 C 为纯新增
- 前端解析：`normalizeMessage` 对不含 `[approval:*]` 前缀的旧消息无影响，作为普通文本处理
- 渲染层：`message-list` 对 `role` 非 `"approval"` 的消息走原有分支，不影响现有渲染

---

## 10. 实时对话消息示例与回放分析

### 10.1 原始 WebSocket 消息流

以下为一次完整的"删除 /tmp/123.txt"对话的 WebSocket 消息，包含用户请求、agent 流式输出、工具调用、审批请求和审批决策。

#### 用户请求

```json
{
  "type": "req",
  "id": "1d056abb-8316-4ab2-8805-9362fc2445f1",
  "method": "chat.send",
  "params": {
    "sessionKey": "agent:default:group:mas-6895471d",
    "message": "删除/tmp/123.txt",
    "clientRunId": "1a265d54-5afc-4a3c-ac31-3a1db304bd71",
    "idempotencyKey": "1a265d54-5afc-4a3c-ac31-3a1db304bd71"
  }
}
```

#### Agent lifecycle start

```json
{
  "type": "event",
  "event": "agent",
  "payload": {
    "runId": "1a265d54-5afc-4a3c-ac31-3a1db304bd71",
    "stream": "lifecycle",
    "data": { "phase": "start", "startedAt": 1774529142576 },
    "sessionKey": "agent:default:group:mas-6895471d",
    "seq": 1,
    "ts": 1774529142576
  },
  "seq": 27
}
```

#### Thinking 流式 delta（共 22 条，仅展示首尾）

```json
{
  "type": "event",
  "event": "agent",
  "payload": {
    "runId": "1a265d54-5afc-4a3c-ac31-3a1db304bd71",
    "stream": "thinking",
    "data": { "text": "Reasoning:\n_用户请求_", "delta": "Reasoning:\n_用户请求_" },
    "sessionKey": "agent:default:group:mas-6895471d",
    "seq": 2,
    "ts": 1774529144270
  },
  "seq": 29
}
```

```json
{
  "type": "event",
  "event": "agent",
  "payload": {
    "runId": "1a265d54-5afc-4a3c-ac31-3a1db304bd71",
    "stream": "thinking",
    "data": {
      "text": "Reasoning:\n_用户请求删除/tmp/123.txt 文件，这是一个安全的系统目录操作，我可以直接执行删除命令。_",
      "delta": "。_"
    },
    "sessionKey": "agent:default:group:mas-6895471d",
    "seq": 22,
    "ts": 1774529144511
  },
  "seq": 49
}
```

#### Assistant 流式 delta（共 5 条）

```json
{
  "type": "event",
  "event": "agent",
  "payload": {
    "runId": "1a265d54-5afc-4a3c-ac31-3a1db304bd71",
    "stream": "assistant",
    "data": { "text": "我来删除这个文件。", "delta": "。" },
    "sessionKey": "agent:default:group:mas-6895471d",
    "seq": 27,
    "ts": 1774529144602
  },
  "seq": 55
}
```

#### Chat delta（assistant 文本中间态）

```json
{
  "type": "event",
  "event": "chat",
  "payload": {
    "runId": "1a265d54-5afc-4a3c-ac31-3a1db304bd71",
    "sessionKey": "agent:default:group:mas-6895471d",
    "seq": 28,
    "state": "delta",
    "message": {
      "role": "assistant",
      "content": [{ "type": "text", "text": "我来删除这个文件。" }],
      "timestamp": 1774529145011
    }
  },
  "seq": 56
}
```

#### Tool start

```json
{
  "type": "event",
  "event": "agent",
  "payload": {
    "runId": "1a265d54-5afc-4a3c-ac31-3a1db304bd71",
    "stream": "tool",
    "data": {
      "phase": "start",
      "name": "exec",
      "toolCallId": "call_3a777e1c5c774b72890335c2",
      "args": { "command": "rm /tmp/123.txt" }
    },
    "sessionKey": "agent:default:group:mas-6895471d",
    "seq": 28,
    "ts": 1774529145011
  }
}
```

#### exec.approval.requested

```json
{
  "type": "event",
  "event": "exec.approval.requested",
  "payload": {
    "id": "31ef2104-8762-421a-9d58-f0c807e3d86a",
    "request": {
      "command": "rm /tmp/123.txt",
      "systemRunBinding": null,
      "systemRunPlan": null,
      "cwd": "/Users/admin/.openclaw/workspace-default",
      "nodeId": null,
      "host": "gateway",
      "security": "allowlist",
      "ask": "on-miss",
      "agentId": "default",
      "resolvedPath": "/bin/rm",
      "sessionKey": "agent:default:group:mas-6895471d",
      "turnSourceChannel": "webchat",
      "turnSourceTo": null,
      "turnSourceAccountId": null,
      "turnSourceThreadId": null
    },
    "createdAtMs": 1774529145408,
    "expiresAtMs": 1774529265408
  },
  "seq": 58
}
```

#### Tool result

```json
{
  "type": "event",
  "event": "agent",
  "payload": {
    "runId": "1a265d54-5afc-4a3c-ac31-3a1db304bd71",
    "stream": "tool",
    "data": {
      "phase": "result",
      "name": "exec",
      "toolCallId": "call_3a777e1c5c774b72890335c2",
      "meta": "remove /tmp/123.txt, `rm /tmp/123.txt`",
      "isError": false
    },
    "sessionKey": "agent:default:group:mas-6895471d",
    "seq": 29,
    "ts": 1774529145429
  }
}
```

#### Agent lifecycle end + chat final

```json
{"type":"event","event":"agent","payload":{"runId":"1a265d54-5afc-4a3c-ac31-3a1db304bd71","stream":"lifecycle","data":{"phase":"end","endedAt":1774529148105},"sessionKey":"agent:default:group:mas-6895471d","seq":30,"ts":1774529148105},"seq":61}
{"type":"event","event":"chat","payload":{"runId":"1a265d54-5afc-4a3c-ac31-3a1db304bd71","sessionKey":"agent:default:group:mas-6895471d","seq":30,"state":"final","message":{"role":"assistant","content":[{"type":"text","text":"我来删除这个文件。"}],"timestamp":1774529148111}},"seq":62}
```

#### 用户发出 exec.approval.resolve 请求

```json
{
  "type": "req",
  "id": "1d7ec850-1b02-44fb-a833-7a8688eb06f3",
  "method": "exec.approval.resolve",
  "params": { "id": "31ef2104-8762-421a-9d58-f0c807e3d86a", "decision": "allow-once" }
}
```

#### exec.approval.resolved 广播

```json
{
  "type": "event",
  "event": "exec.approval.resolved",
  "payload": {
    "id": "31ef2104-8762-421a-9d58-f0c807e3d86a",
    "decision": "allow-once",
    "resolvedBy": "管理员",
    "ts": 1774529155912,
    "request": {
      "command": "rm /tmp/123.txt",
      "systemRunBinding": null,
      "systemRunPlan": null,
      "cwd": "/Users/admin/.openclaw/workspace-default",
      "nodeId": null,
      "host": "gateway",
      "security": "allowlist",
      "ask": "on-miss",
      "agentId": "default",
      "resolvedPath": "/bin/rm",
      "sessionKey": "agent:default:group:mas-6895471d",
      "turnSourceChannel": "webchat",
      "turnSourceTo": null,
      "turnSourceAccountId": null,
      "turnSourceThreadId": null
    }
  },
  "seq": 63
}
```

---

### 10.2 逐条持久化分析

| #   | 事件                              | 持久化         | 写入路径                        | 说明                                                                                                |
| --- | --------------------------------- | -------------- | ------------------------------- | --------------------------------------------------------------------------------------------------- |
| ①   | `chat.send` 用户请求              | ✅             | 路径 A: handleUpdate            | JSONL transcript 写入后触发                                                                         |
| ②   | `agent lifecycle start`           | ❌             | —                               | 无 message payload，handleUpdate 直接 return                                                        |
| ③   | `agent thinking` delta × 22       | ❌（逐条不写） | —                               | 流式 delta 不经过 transcript 事件总线；最终完整 thinking 文本随 JSONL assistant 消息一起写入（见⑤） |
| ④   | `agent assistant` delta × 5       | ❌（逐条不写） | —                               | 同上，流式 delta 不逐条持久化                                                                       |
| ⑤   | JSONL transcript 写入（run 结束） | ✅             | 路径 A: handleUpdate            | 包含完整 thinking block + text block（+ 可能含 tool_use block，见⚠️）                               |
| ⑥   | `chat delta`（assistant 中间态）  | ❌             | —                               | 仅用于实时流式渲染，不持久化                                                                        |
| ⑦   | `agent tool start`                | ✅（暂存）     | 路径 B: recordToolEvent(start)  | 存入 pendingToolCalls，等待 result                                                                  |
| ⑧   | `exec.approval.requested`         | ✅             | 路径 C: filterBroadcast         | recordApprovalEvent(type="requested")                                                               |
| ⑨   | `agent tool result`               | ✅             | 路径 B: recordToolEvent(result) | 与 start 合并写入一条 assistant 记录                                                                |
| ⑩   | `agent lifecycle end`             | ❌             | —                               | 无 message payload                                                                                  |
| ⑪   | `chat final`                      | ❌（去重）     | —                               | storedRunIds 去重，handleUpdate 已写入，不重复                                                      |
| ⑫   | `exec.approval.resolve` 用户请求  | ✅             | 路径 D: interceptRequest        | RBAC 通过后 fire-and-forget，从 getSnapshot 取 sessionKey                                           |
| ⑬   | `exec.approval.resolved` 广播     | ✅             | 路径 C: filterBroadcast         | recordApprovalEvent(type="resolved")                                                                |

---

### 10.3 session_messages 最终记录

| seq | role      | content 摘要                                                                                                     | timestamp     | 写入路径   |
| --- | --------- | ---------------------------------------------------------------------------------------------------------------- | ------------- | ---------- |
| 1   | user      | `删除/tmp/123.txt`                                                                                               | 1774529139543 | A          |
| 2   | assistant | `[thinking] Reasoning:\n_用户请求删除/tmp/123.txt 文件..._\n[text] 我来删除这个文件。`                           | 1774529142876 | A          |
| 3   | assistant | `[tool_use:exec] {"command":"rm /tmp/123.txt"}\n[tool_result] remove /tmp/123.txt, \`rm /tmp/123.txt\``          | 1774529145011 | B          |
| 4   | approval  | `[approval:requested] {"id":"31ef2104-...","command":"rm /tmp/123.txt",...,"triggeredByMsgId":"<seq=5的uuid>"}`  | 1774529145408 | C + A 回填 |
| 5   | assistant | `[thinking] 命令需要批准...\n[text] 需要批准才能执行删除命令。请回复：/approve ...`                              | 1774529145429 | A          |
| 6   | approval  | `[approval:user-resolve] {"id":"31ef2104-...","decision":"allow-once","resolvedBy":"管理员","ts":1774529155900}` | 1774529155900 | D          |
| 7   | approval  | `[approval:resolved] {"id":"31ef2104-...","decision":"allow-once","resolvedBy":"管理员","ts":1774529155912}`     | 1774529155912 | C          |

> seq=4 的 `triggeredByMsgId` 在 seq=5 的 assistant 消息写入 buffer 后由 `handleUpdate` 回填，`flush()` 时两条记录一起持久化，DB 中 seq=4 已含该字段。

---

### 10.4 非流式回放渲染结果

历史加载后，`fetchSessionHistoryRange` 返回 ASC 顺序的消息，前端依次渲染：

| 渲染顺序 | seq | 组件                | 显示内容                                                                                                                              |
| -------- | --- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1        | 1   | `msg-user`          | "删除/tmp/123.txt"                                                                                                                    |
| 2        | 2   | `msg-agent`         | thinking 折叠块 + 文本"我来删除这个文件。"                                                                                            |
| 3        | 3   | `msg-agent`         | 工具调用卡片：exec `rm /tmp/123.txt` → `remove /tmp/123.txt`                                                                          |
| 4        | 4   | `msg-approval-card` | 审批卡片（只读）：命令、工作目录、解析路径、安全策略；resolved 状态由 seq=7 提供，显示"✓ 已允许一次 · 审批人：管理员 · 审批时间：..." |
| —        | 5   | 不渲染              | `_cachedApprovalTriggeredMsgIds` 包含 seq=5 的 id，assistant 消息被精确过滤（§6.3.3）                                                 |
| —        | 6   | 不渲染              | `approval_resolved`（`_source` 非 `user-resolve`）不单独渲染                                                                          |
| —        | 7   | 不渲染              | `approval_resolved` 已被 `_buildHistoryResolvedMap` 索引，供 seq=4 卡片消费                                                           |

历史视图与实时视图完全一致：用户消息 → agent 思考+回复 → 工具调用卡片 → 审批卡片（含决策结果）。seq=5 的"需要批准才能执行..."文本气泡在两个视图中均不可见。

---

### 10.5 待确认问题：seq=2 是否包含 tool_use block

seq=2（路径 A，handleUpdate）来自 JSONL transcript 的 assistant 消息。若 JSONL 写入时机在 agent run 结束后，assistant 消息的 content 数组可能同时包含 `thinking + text + tool_use` block。

- **若包含 tool_use**：seq=2 经 `splitHistoryMessage` 拆分后会产生一个工具调用气泡（无 tool_result），seq=3 再产生一个工具调用气泡（有 tool_result），用户看到**两个 exec 卡片**。
- **若不包含 tool_use**（只有 thinking + text）：seq=2 和 seq=3 各司其职，无重复。

需要确认 JSONL transcript 中 assistant 消息的实际 content 格式，以决定是否需要在 `recordToolEvent` 写入前检查 `handleUpdate` 是否已写入同一 tool_use。
