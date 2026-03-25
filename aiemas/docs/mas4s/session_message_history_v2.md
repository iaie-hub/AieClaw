# aiemas 会话消息持久化实现方案 v2

> 在 v1 基础上新增**工具调用持久化**和**历史视图还原**能力，解决历史消息与实时视图不一致的问题。

## 1. 总体架构

v2 在 v1 的三层架构基础上，新增了两条写入路径，统一由 `SessionTranscriptStore` 管理：

```
                    ┌─────────────────────────────────────────────┐
                    │           写入路径（v2 新增两条）              │
                    │                                             │
Gateway 消息事件     │  路径 A（原有）                              │
      │             │  onSessionTranscriptUpdate                  │
      ▼             │    → handleUpdate()                         │
onSessionTranscript │    → user / assistant(含 thinking+toolCall) │
Update              │    → tool_result                            │
      │             │                                             │
      │             │  路径 B（新增）                              │
      │             │  filterBroadcast (mas4s-integration.ts)     │
      │             │    → agent/session.tool stream:tool         │
      │             │      → recordToolEvent()                    │
      │             │    → chat state:final (assistant)           │
      │             │      → recordAssistantFinal()               │
      │             └─────────────────────────────────────────────┘
      │
      ▼
SessionTranscriptStore
      │  ← 内存缓冲（buffer[]）
      │  ← pendingToolCalls（工具调用暂存）
      │  ← storedRunIds（assistant 去重）
      ▼
flush() — 每 500ms 或 buffer ≥ 100 条时触发
      │
      ▼
persistBatch() — SQLite 事务批量写入
      │
      ▼
mas4s.message.db → session_messages 表
```

查询路径（v2 更新）：

```
queryHistoryRange(db, params)
      │
      ├── DB 查询（session_messages WHERE sessionKey [+ timestamp 条件（可选）]）
      ├── 合并内存 buffer（未落盘消息，同样应用可选时间过滤）
      ├── 去重（同 id 以 buffer 版本优先）
      ├── 全量排序（timestamp DESC）
      └── 分页切片（page/pageSize）→ 返回当页消息 + 分页元数据
```

前端还原路径（v2 新增）：

```
session.history.range 返回 StoredMessage[]（DESC 顺序）
      │
      ▼
.toReversed()  ← 先整体反转为 ASC，保证后续拆分子消息顺序正确
      │
      ▼
.flatMap(normalizeMessage → splitHistoryMessage)
      │
      ├── "[thinking] ..."      → { type: "thinking", thinking }
      ├── "[tool_use:name] {}"  → { type: "tool_call", name, args }
      ├── "[tool_result] ..."   → { type: "tool_result", text }
      └── 普通文本              → { type: "text", text }
      │
      ▼
msg-agent 渲染（与实时视图一致）
```

---

## 2. v1 → v2 变更点

### 2.1 问题根因

v1 的写入路径（`onSessionTranscriptUpdate`）只能捕获经过 JSONL transcript 的消息。以下两类消息**不经过** transcript 事件总线，导致历史视图缺失：

| 消息类型                              | 实时视图来源               | v1 历史视图                       |
| ------------------------------------- | -------------------------- | --------------------------------- |
| 工具调用卡片（exec/read 等）          | `agent` 事件 `stream:tool` | ❌ 缺失                           |
| assistant 最终文本（thinking 为空时） | `chat` 事件 `state:final`  | ❌ 部分缺失（content 为空字符串） |

此外，v1 的 `extractContent` 未处理 `type: "thinking"` block，导致 thinking 内容被丢弃，存入数据库的 content 为空字符串。

### 2.2 v2 修复清单

| 问题                              | 修复位置                                                                 | 修复方式                                                               |
| --------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| thinking block 丢失               | `session-transcript-store.ts` `extractContent`                           | 新增 `[thinking] ...` 序列化                                           |
| toolCall block 字段名不匹配       | `session-transcript-store.ts` `extractContent`                           | 新增 `type: "toolCall"` 处理（pi-coding-agent 格式，`arguments` 字段） |
| 工具调用卡片完全缺失              | `mas4s-integration.ts` `filterBroadcast` + `session-transcript-store.ts` | 新增 `recordToolEvent` 方法，在 `filterBroadcast` 旁路捕获             |
| assistant 最终文本缺失            | `mas4s-integration.ts` `filterBroadcast` + `session-transcript-store.ts` | 新增 `recordAssistantFinal` 方法，在 `filterBroadcast` 旁路捕获        |
| 历史视图 senderLabel 显示为用户名 | `session-history-query.ts`                                               | `resolveDisplayName` 仅对 `role=user` 调用                             |
| 历史视图工具调用无法渲染          | `message-normalizer.ts`                                                  | 解析 `[tool_use:]`/`[tool_result]`/`[thinking]` 标记还原结构化 content |
| `role=tool` 消息不渲染            | `message-list.ts`                                                        | `role=tool` 也走 `msg-agent` 渲染路径                                  |

---

## 3. 新增写入路径：filterBroadcast 旁路捕获

### 3.1 为什么选择 filterBroadcast

`filterBroadcast`（`src/gateway/mas4s-integration.ts`）是 mas4s 插件层所有广播事件的必经之路，包括：

- `agent` 事件（`stream: "tool"` / `stream: "thinking"` / `stream: "assistant"`）
- `session.tool` 事件（协作者接收的工具调用镜像）
- `chat` 事件（`state: "delta"` / `state: "final"` / `state: "user"`）

在此处旁路捕获的优点：

- 不修改 gateway 核心代码（`src/gateway/server-chat.ts` 等）
- 所有广播事件必经此处，覆盖完整
- 捕获逻辑与 RBAC 过滤逻辑完全解耦，互不影响

### 3.2 捕获逻辑

```typescript
// mas4s-integration.ts filterBroadcast 开头
const filterBroadcast = (event, payload, clients) => {
  try {
    const p = payload as Record<string, unknown>;
    const evtSessionKey = typeof p["sessionKey"] === "string" ? p["sessionKey"] : "";

    if (evtSessionKey) {
      // 1. 工具调用事件
      if ((event === "agent" || event === "session.tool") && p["stream"] === "tool") {
        const data = p["data"] as Record<string, unknown> | undefined;
        const phase = data?.["phase"];
        const toolCallId = data?.["toolCallId"];
        if (toolCallId && (phase === "start" || phase === "result")) {
          plugin.transcriptStore.recordToolEvent({
            sessionKey,
            toolCallId,
            name,
            phase,
            args,
            result,
            timestamp,
          });
        }
      }

      // 2. assistant 最终文本
      if (event === "chat" && p["state"] === "final" && p["runId"]) {
        const msg = p["message"];
        if (msg?.role === "assistant") {
          plugin.transcriptStore.recordAssistantFinal({ sessionKey, runId, text, timestamp });
        }
      }
    }
  } catch (err) {
    /* 静默忽略，不影响广播 */
  }

  // 原有 RBAC 过滤逻辑...
};
```

---

## 4. SessionTranscriptStore 新增方法

源文件：`aiemas/src/session-history/session-transcript-store.ts`

### 4.1 内部状态（集中管理）

所有 per-session 的内存状态统一收敛到 `SessionState` 接口，由 `sessionStates: Map<string, SessionState>` 持有，替代原先分散的 `senderMap` 和 `seqMap`：

```typescript
interface SessionState {
  sender: SenderContext; // 发起者（userId / tenantId）
  lastSeq: number; // 当前最大 seq，下一条消息直接 +1，无需查 DB
  firstMsgAt: number; // 最早消息时间戳（0 = 尚无消息）
  lastMsgAt: number; // 最新消息时间戳（0 = 尚无消息）
  msgCount: number; // 已持久化消息总数
}
```

`firstMsgAt` / `lastMsgAt` / `msgCount` 与 `session_msg_statistic` 保持镜像：每次 `persistBatch` 事务提交后立即更新，回滚时不更新（`lastSeq` 在回滚时回退）。

其余跨 session 的状态：

```typescript
// 工具调用暂存：toolCallId → PendingToolCall
private readonly pendingToolCalls = new Map<string, PendingToolCall>();

// assistant 去重：已存储的 runId 集合（最多保留 500 个）
private readonly storedRunIds = new Set<string>();
```

`PendingToolCall` 结构：

```typescript
interface PendingToolCall {
  sessionKey: string;
  name: string;
  callContent: string; // "[tool_use:name] {...}"
  timestamp: number;
}
```

### 4.2 recordToolEvent

工具调用采用**两阶段合并**策略：`phase=start` 时暂存，`phase=result` 时合并为单条记录写入 buffer。

```
phase=start  → pendingToolCalls.set(toolCallId, { callContent, timestamp, ... })
phase=result → pendingToolCalls.delete(toolCallId)
             → content = "[tool_use:name] {...}\n[tool_result] ..."
             → pushToBuffer({ role: "assistant", content, timestamp: start.timestamp })
```

这样历史视图中一次工具调用对应一条 `assistant` 消息，包含调用参数和执行结果，与实时视图的工具卡片（`tool_call` + `tool_result` content items）对应。

### 4.3 recordAssistantFinal

```typescript
recordAssistantFinal({ sessionKey, runId, text, timestamp }): void
```

- 若 `text` 为空，跳过
- 若 `storedRunIds` 已包含该 `runId`（说明 transcript 路径已存储），跳过（去重）
- 否则将 `runId` 加入 `storedRunIds`，调用 `pushToBuffer`
- `storedRunIds` 超过 500 条时，FIFO 淘汰最旧的条目

### 4.4 pushToBuffer（私有）

将 `recordToolEvent` 和 `recordAssistantFinal` 的公共写入逻辑提取为私有方法：

```typescript
private pushToBuffer({ sessionKey, role, content, timestamp }): void {
  // 从 senderMap 取 userId/tenantId
  // 从 seqMap 取并递增 seq
  // 构造 StoredMessage 推入 buffer[]
  // 若 buffer.length >= maxBufferSize，触发 flush()
}
```

### 4.5 extractContent 新增处理

v2 在 v1 基础上新增两种 block 类型的处理：

| block 类型                         | 字段                | 序列化格式                            |
| ---------------------------------- | ------------------- | ------------------------------------- |
| `thinking`                         | `thinking: string`  | `[thinking] {thinking}`               |
| `toolCall`（pi-coding-agent 格式） | `name`, `arguments` | `[tool_use:{name}] {JSON(arguments)}` |

完整的 `extractContent` 处理规则见第 6 节。

---

## 5. 前端还原：normalizeMessage

源文件：`aiemas/ui/mas4s/src/lib/message-normalizer.ts`

v2 对 `content` 为字符串的历史消息（来自 `session.history.range`）新增结构化解析，将序列化标记还原为 content items：

```
输入字符串（逐行解析）：
  "[thinking] 用户要求列出 /tmp 目录..."
  "[tool_use:exec] {"command":"ls -la /tmp/"}"
  "[tool_result] total 16\ndrwxrwxrwt..."
  "以下是 /tmp 目录的内容："

输出 content items：
  { type: "thinking", thinking: "用户要求列出 /tmp 目录..." }
  { type: "tool_call", name: "exec", args: { command: "ls -la /tmp/" } }
  { type: "tool_result", text: "total 16\ndrwxrwxrwt..." }
  { type: "text", text: "以下是 /tmp 目录的内容：" }
```

解析规则（按行匹配，优先级从高到低）：

| 行前缀                  | 输出 content item                                    |
| ----------------------- | ---------------------------------------------------- |
| `[thinking] ...`        | `{ type: "thinking", thinking: "..." }`              |
| `[tool_use:name] {...}` | `{ type: "tool_call", name, args: JSON.parse(...) }` |
| `[tool_result] ...`     | `{ type: "tool_result", text: "..." }`               |
| 其他                    | 累积到 text 块                                       |

`role=tool` 的历史消息（独立的 tool_result 行）：若解析后只有一个 `text` item，自动包装为 `tool_result` item。

---

## 6. 消息内容提取规则（完整，含 v2 新增）

`extractContent(raw)` 处理 gateway 产生的多种 content 格式：

| 输入格式                                  | 处理方式                                     |
| ----------------------------------------- | -------------------------------------------- |
| `string`                                  | 直接使用                                     |
| `[{ type: "text", text: "..." }]`         | 拼接所有 text 块                             |
| `[{ type: "thinking", thinking: "..." }]` | `[thinking] ...` ⭐ v2 新增                  |
| `[{ type: "toolCall", name, arguments }]` | `[tool_use:name] JSON(arguments)` ⭐ v2 新增 |
| `[{ type: "tool_use", name, input }]`     | `[tool_use:name] JSON(input)`                |
| `[{ type: "tool_result", content }]`      | 递归提取 content                             |
| 其他                                      | 空字符串，过滤掉                             |

---

## 7. 历史视图渲染修复

### 7.1 senderLabel 修复

`session-history-query.ts` 的 `resolveDisplayName` 回调仅对 `role=user` 的消息调用，`assistant`/`tool` 消息的 `senderLabel` 固定为 `null`，前端渲染为 `Agent`，与实时视图一致。

v1 的问题：对所有 role 都调用 `resolveDisplayName`，导致 assistant 消息的 `senderLabel` 被解析为发起该 run 的用户名（如"管理员"）。

### 7.2 role=tool 消息渲染

`message-list.ts` 的 `_renderMessage` 方法新增对 `role=tool` 的处理，与 `role=assistant` 和 `role=toolResult` 一样走 `msg-agent` 渲染路径。

---

## 8. 数据库设计

### 8.1 session_messages（与 v1 相同）

schema 无变更，见 v1 文档第 2 节。

### 8.2 session_msg_statistic（v2 新增）

每个 `sessionKey` 对应一行，维护该 session 的消息聚合统计，与 `session_messages` 在同一事务中写入，保证强一致。

```sql
CREATE TABLE IF NOT EXISTS session_msg_statistic (
  sessionKey  TEXT    PRIMARY KEY,
  firstMsgAt  INTEGER NOT NULL,   -- 最早消息的 Unix ms 时间戳
  lastMsgAt   INTEGER NOT NULL,   -- 最新消息的 Unix ms 时间戳
  msgCount    INTEGER NOT NULL DEFAULT 0,  -- 消息总数量
  lastSeq     INTEGER NOT NULL DEFAULT 0   -- 最新消息的 seq
);
```

写入策略：`persistBatch` 在同一 `BEGIN/COMMIT` 事务中，先批量 INSERT `session_messages`，再对每个 `sessionKey` 执行一次 UPSERT：

```sql
INSERT INTO session_msg_statistic (sessionKey, firstMsgAt, lastMsgAt, msgCount, lastSeq)
VALUES (?, ?, ?, ?, ?)
ON CONFLICT(sessionKey) DO UPDATE SET
  firstMsgAt = MIN(firstMsgAt, excluded.firstMsgAt),
  lastMsgAt  = MAX(lastMsgAt,  excluded.lastMsgAt),
  msgCount   = msgCount + excluded.msgCount,
  lastSeq    = MAX(lastSeq,    excluded.lastSeq);
```

- `firstMsgAt` 取 `MIN`：支持回放/补录场景下时间戳早于已有记录的消息
- `lastMsgAt` / `lastSeq` 取 `MAX`：保证单调递增，不受乱序批次影响
- `msgCount` 累加本批次数量，无需全表 COUNT
- 事务回滚时两张表同时回滚，不会出现统计与明细不一致的情况

### 8.3 启动加载与内存镜像

服务启动时，`loadSessionStates()` 从 `session_msg_statistic` 全量读取，填充 `sessionStates` Map：

- `lastSeq` 直接来自统计行，不再对 `session_messages` 做 `GROUP BY MAX(seq)` 查询
- `firstMsgAt` / `lastMsgAt` / `msgCount` 同步加载，供运行时直接读取，无需额外 DB 查询
- `sender` 字段初始为空，由后续 `recordSenderContext` 调用填充

每次 `persistBatch` 事务提交后，内存中对应 `SessionState` 的统计字段立即更新，与 DB 保持镜像。事务回滚时 `lastSeq` 回退（`-= group.length`），其余统计字段不变（回滚意味着消息未写入，计数不应增加）。

---

## 9. 关键设计决策

### 9.1 filterBroadcast 作为 hook 点

工具调用事件（`agent stream:tool`）完全绕过 `emitSessionTranscriptUpdate`，无法通过订阅 transcript 事件捕获。`filterBroadcast` 是 mas4s 插件层所有广播事件的必经之路，是最小侵入的 hook 点，不需要修改 gateway 核心。

### 9.2 工具调用两阶段合并

实时视图中，一次工具调用对应一个气泡（`tool_call` + `tool_result` 合并在同一条消息的 content 数组里）。历史视图需要还原相同的结构，因此在 `phase=start` 时暂存，`phase=result` 时合并为单条记录，而不是分别存两条。

若 `phase=result` 到达时找不到对应的 `phase=start`（例如服务重启导致 `pendingToolCalls` 丢失），则静默跳过，不写入孤立的 result 记录。

### 9.3 assistant 去重策略

`recordAssistantFinal` 和 `handleUpdate`（transcript 路径）可能对同一条 assistant 消息都触发写入。通过 `storedRunIds` 集合去重：先到的路径写入，后到的路径跳过。

`storedRunIds` 采用 FIFO 淘汰策略，最多保留 500 个 runId，防止内存无限增长。

### 9.4 序列化格式设计

历史消息的 content 字段使用行前缀标记（`[thinking]`、`[tool_use:name]`、`[tool_result]`）序列化结构化内容，原因：

- 兼容现有 `content TEXT NOT NULL` 列，无需 schema 变更
- 前缀格式简单，前端解析成本低
- 与普通文本内容不冲突（普通文本不以 `[` 开头的特定模式开始）

---

## 10. 与 v1 的兼容性

v2 完全向后兼容 v1：

- 数据库 schema 无变更
- `handleUpdate` 逻辑保留，仅新增 `extractContent` 对 `thinking`/`toolCall` 的处理
- 新增的 `recordToolEvent`/`recordAssistantFinal` 方法为可选调用路径，不影响现有写入
- 历史消息中不含 `[tool_use:]`/`[tool_result]`/`[thinking]` 前缀的旧数据，`normalizeMessage` 会将其作为普通文本处理，不会出错

---

## 11. 涉及文件

| 文件                                                     | 变更类型 | 说明                                                                                                                                                                         |
| -------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `aiemas/src/session-history/session-transcript-store.ts` | 修改     | 新增 `recordToolEvent`、`recordAssistantFinal`、`pushToBuffer`；`extractContent` 补充 `thinking`/`toolCall` 处理；`persistBatch` 在同一事务中 UPSERT `session_msg_statistic` |
| `aiemas/src/store/database.ts`                           | 修改     | `ensureMessageSchema` 新增 `session_msg_statistic` 表 DDL                                                                                                                    |
| `src/gateway/mas4s-integration.ts`                       | 修改     | `filterBroadcast` 新增旁路捕获逻辑                                                                                                                                           |
| `aiemas/src/session-history/session-history-query.ts`    | 修改     | `resolveDisplayName` 仅对 `role=user` 调用                                                                                                                                   |
| `aiemas/ui/mas4s/src/lib/message-normalizer.ts`          | 修改     | 新增 `[thinking]`/`[tool_use:]`/`[tool_result]` 行解析                                                                                                                       |
| `aiemas/ui/mas4s/src/views/message-list.ts`              | 修改     | `role=tool` 走 `msg-agent` 渲染路径                                                                                                                                          |
| `aiemas/ui/mas4s/src/gateway/session-manager.ts`         | 修改     | `fetchSessionHistoryRange` 先 `toReversed()` 再 `flatMap(splitHistoryMessage)`，修复拆分后子消息顺序错乱问题                                                                 |

---

## 12. session.history.range 接口实现方案

### 12.1 接口参数

| 参数         | 类型   | 必填 | 说明                                                   |
| ------------ | ------ | ---- | ------------------------------------------------------ |
| `sessionKey` | string | ✅   | 会话标识                                               |
| `sessionId`  | string | ❌   | 过滤指定 sessionId（跨 reset 场景）                    |
| `from`       | number | ❌   | Unix ms 下界（含）。**不传则不限制下界，查询全部历史** |
| `to`         | number | ❌   | Unix ms 上界（含）。**不传则不限制上界**               |
| `page`       | number | ❌   | 页码（1-based），默认 1                                |
| `pageSize`   | number | ❌   | 每页条数，默认 100，最大 1000                          |

### 12.2 返回值

```typescript
interface HistoryRangeResult {
  messages: StoredMessageWithSender[]; // 当页消息，timestamp DESC（最新在前）
  total: number; // 满足过滤条件的消息总数（分页前）
  page: number; // 当前页码（1-based）
  pageSize: number; // 本次生效的每页条数
  totalPages: number; // ceil(total / pageSize)
  truncated: boolean; // total > pageSize（向后兼容字段）
  hasSummary: boolean; // 全量结果中是否含 role='summary' 消息
}
```

消息按 `timestamp DESC` 返回（最新消息在数组最前）。前端 `fetchSessionHistoryRange` 在渲染前调用 `.reverse()` 转为 ASC，再 `flatMap(splitHistoryMessage)` 拆分子消息。

### 12.3 SQL 构造逻辑

`from`/`to` 均为可选，不传时对应的 `WHERE` 子句不生成：

```sql
-- 不传 from/to（查全部）
SELECT * FROM session_messages WHERE sessionKey = ?
  [AND sessionId = ?]
  ORDER BY timestamp DESC

-- 只传 from
SELECT * FROM session_messages WHERE sessionKey = ? AND timestamp >= ?
  [AND sessionId = ?]
  ORDER BY timestamp DESC

-- 传 from + to
SELECT * FROM session_messages WHERE sessionKey = ? AND timestamp >= ? AND timestamp <= ?
  [AND sessionId = ?]
  ORDER BY timestamp DESC
```

DB 结果与内存 buffer 合并后，在内存中完成去重、全量排序（DESC），再按 `page`/`pageSize` 切片。

### 12.4 分页设计说明

采用**内存分页**而非 SQL `LIMIT/OFFSET`，原因：

- buffer 中存在未落盘消息，必须先合并再分页，否则分页边界不准确
- 单个 session 的消息量通常在数千条以内，全量加载后内存排序+切片的开销可接受
- 避免 SQL `OFFSET` 在大数据量时的性能退化

若未来单 session 消息量超过 10 万条，可改为先 flush buffer 再用 SQL `LIMIT/OFFSET` 分页，并在 `session_msg_statistic.msgCount` 直接取 `total`，无需 COUNT 查询。

### 12.5 前端调用示例

```typescript
// 查询全部历史，第 1 页，每页 100 条（默认）
const result = await fetchSessionHistoryRange(client, sessionKey);

// 查询第 2 页
const page2 = await fetchSessionHistoryRange(client, sessionKey, { page: 2, pageSize: 100 });

// 按时间范围查询（仍支持）
const ranged = await fetchSessionHistoryRange(client, sessionKey, {
  from: Date.now() - 7 * 24 * 60 * 60 * 1000,
  to: Date.now(),
  page: 1,
  pageSize: 100,
});
```

### 12.6 涉及文件

| 文件                                                     | 变更说明                                                                                   |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `aiemas/src/session-history/session-history-query.ts`    | `from`/`to` 改为真正可选；新增 `page`/`pageSize` 分页；返回 `page`/`pageSize`/`totalPages` |
| `aiemas/src/session-history/session-transcript-store.ts` | `getBuffered` 的 `from`/`to` 改为 `number \| undefined`                                    |
| `aiemas/src/gateway-bridge/mas4s-gateway-plugin.ts`      | handler 去掉强制默认时间范围；透传 `page`/`pageSize`                                       |
| `aiemas/ui/mas4s/src/gateway/session-manager.ts`         | `opts` 新增 `page`/`pageSize`；`SessionHistoryRangeResult` 新增分页字段                    |
