# Design: aiemas 会话消息历史管理

## 1. 架构概览

```
gateway (src/)
  └── onSessionTranscriptUpdate 事件 ──────────────────────────────┐
  └── chat.send extraHandler (mas4s-integration.ts) ──────────────┐│
                                                                   ││
aiemas/src/session-history/                                        ││
  ├── session-transcript-store.ts  ←── 订阅事件 + 维护映射 ←───────┘│
  │     └── 写入 session_messages (SQLite)                         │
  └── session-history-query.ts    ←── session.history.range handler│
        └── 查询 session_messages                                  │
                                                                   │
aiemas/src/gateway-bridge/                                         │
  └── mas4s-gateway-plugin.ts  ←── 注册 session.history.range ←───┘
        └── chat.send wrap 维护 sessionKey→userId 映射

aiemas/ui/mas4s/src/
  ├── gateway/session-manager.ts  ← fetchSessionHistoryRange()
  └── views/chat-view.ts          ← 摘要提示条 + 加载更多占位
```

所有新后端代码闭环在 `aiemas/src/` 内，不修改 `src/gateway/` 任何文件。

---

## 2. 数据库 Schema

### 2.1 `session_messages` 表 DDL

在 `aiemas/src/store/database.ts` 的 `ensureMas4sSchema` 末尾追加：

```sql
CREATE TABLE IF NOT EXISTS session_messages (
  id          TEXT    PRIMARY KEY,          -- UUID v4
  sessionKey  TEXT    NOT NULL,             -- 逻辑会话键（跨 reset 不变）
  sessionId   TEXT    NOT NULL,             -- 物理会话 ID（reset 后变更）
  userId      TEXT    NULL,                 -- 发送者 userId（兼容模式可为 NULL）
  tenantId    TEXT    NULL,                 -- 租户 ID（兼容模式可为 NULL）
  role        TEXT    NOT NULL              -- 'user' | 'assistant' | 'tool' | 'summary'
              CHECK(role IN ('user','assistant','tool','summary')),
  content     TEXT    NOT NULL,             -- 消息正文
  timestamp   INTEGER NOT NULL,             -- Unix ms
  seq         INTEGER NOT NULL DEFAULT 0,   -- 同一 sessionId 内的序号（单调递增）
  archivedDate TEXT   NULL                  -- 'yyyy-mm-dd'，NULL 表示活跃消息
);

CREATE INDEX IF NOT EXISTS idx_session_messages_key_ts
ON session_messages(sessionKey, timestamp);

CREATE INDEX IF NOT EXISTS idx_session_messages_session_id
ON session_messages(sessionId);
```

### 2.2 幂等迁移

`ensureMas4sSchema` 已使用 `CREATE TABLE IF NOT EXISTS` 模式，新表直接追加即可。
若需对已有部署做列迁移，使用与现有 `user_presence` 迁移相同的 `PRAGMA table_info` 检查模式。

---

## 3. 后端模块设计

### 3.1 `aiemas/src/session-history/session-transcript-store.ts`

#### 职责

- 订阅 `onSessionTranscriptUpdate`（`src/sessions/transcript-events.ts`）
- 维护 `sessionKey → { userId, tenantId }` 内存映射（由 `chat.send` wrap 填充）
- **批量缓冲**：消息先写入内存队列，由定时器定期批量刷入 SQLite，降低写入频率
- 含按天归档逻辑（在批量刷写时检测）

#### 批量写入策略

| 参数              | 默认值 | 说明                                                 |
| ----------------- | ------ | ---------------------------------------------------- |
| `flushIntervalMs` | `500`  | 定时刷写间隔（ms）                                   |
| `maxBufferSize`   | `100`  | 缓冲区上限；超过时立即触发强制刷写，防止内存无限增长 |

**触发条件**（满足任一即刷写）：

1. 定时器到期（每 `flushIntervalMs` ms）
2. 缓冲区消息数 ≥ `maxBufferSize`（立即同步刷写）
3. 调用 `stop()` 时强制刷写剩余消息（进程退出前不丢数据）

#### 类型定义

```typescript
import type { DatabaseSync } from "node:sqlite";
import type { SessionTranscriptUpdate } from "../../../src/sessions/transcript-events.js";

export interface SenderContext {
  userId: string | null;
  tenantId: string | null;
}

export interface StoredMessage {
  id: string;
  sessionKey: string;
  sessionId: string;
  userId: string | null;
  tenantId: string | null;
  role: "user" | "assistant" | "tool" | "summary";
  content: string;
  timestamp: number;
  seq: number;
  archivedDate: string | null;
}

export interface SessionTranscriptStoreOptions {
  flushIntervalMs?: number; // 默认 500
  maxBufferSize?: number; // 默认 100
}
```

#### 类结构

```typescript
export class SessionTranscriptStore {
  private readonly db: DatabaseSync;
  private readonly flushIntervalMs: number;
  private readonly maxBufferSize: number;
  // sessionKey → { userId, tenantId }
  private readonly senderMap = new Map<string, SenderContext>();
  // 内存缓冲队列
  private readonly buffer: StoredMessage[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(db: DatabaseSync, opts?: SessionTranscriptStoreOptions) { ... }

  /** 由 chat.send extraHandler 调用，建立 sessionKey → userId 映射 */
  recordSenderContext(sessionKey: string, ctx: SenderContext): void { ... }

  /** 订阅 onSessionTranscriptUpdate，启动定时刷写，开始捕获消息 */
  start(): void { ... }

  /** 取消订阅，强制刷写缓冲区，停止定时器 */
  stop(): void { ... }

  /** 返回缓冲区中符合条件的消息快照（不修改 buffer），供查询时合并 */
  getBuffered(sessionKey: string, from: number, to: number, sessionId?: string): StoredMessage[] { ... }

  /** 内部：处理单条 transcript 更新，将消息加入缓冲区 */
  private handleUpdate(update: SessionTranscriptUpdate): void { ... }

  /** 内部：将缓冲区所有消息批量写入 SQLite（单一事务） */
  private flush(): void { ... }

  /** 内部：按天归档检查 + 批量 INSERT（同一事务） */
  private persistBatch(msgs: StoredMessage[]): void { ... }

  /** 内部：检查是否需要归档，返回需归档的旧日期（或 null） */
  private checkArchiveDate(sessionKey: string, newMsgDate: string): string | null { ... }
}
```

#### `handleUpdate` 逻辑

```
1. 从 update.message 提取 role / content / timestamp / sessionId
   - role 映射：'human'/'user' → 'user'；'ai'/'assistant' → 'assistant'；其余保留
   - 若 message 为 null/undefined，跳过（仅文件路径更新）
2. 从 senderMap 查找 userId / tenantId（可为 null）
3. 生成 id = crypto.randomUUID()
4. seq 在缓冲区内按 sessionId 累加（不查 DB，刷写时由 INSERT 顺序保证单调性）
5. 将 StoredMessage 推入 buffer
6. 若 buffer.length >= maxBufferSize，立即调用 flush()（同步）
7. 捕获所有异常，仅 console.error，不抛出
```

#### `flush` 逻辑

```
若 buffer 为空，直接返回
取出 buffer 中所有消息（drain），清空 buffer
调用 persistBatch(msgs)
捕获所有异常，仅 console.error（不影响后续刷写）
```

#### `persistBatch` 逻辑（单一 SQLite 事务，批量写入）

```
BEGIN TRANSACTION
  按 sessionKey 分组处理归档检查：
    对每个 sessionKey 中时间戳最早的新消息：
      checkArchiveDate(sessionKey, toDateStr(minTimestamp))
      若需归档：
        UPDATE session_messages
          SET archivedDate = <oldDate>
        WHERE sessionKey = ? AND archivedDate IS NULL
        -- 记录 INFO 日志：sessionKey、归档日期、影响行数

  批量 INSERT（prepared statement 循环）：
    INSERT INTO session_messages VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    -- 对 msgs 中每条消息执行一次 stmt.run(...)
COMMIT
```

> 使用单一事务包裹所有 INSERT，避免每条消息单独提交的 fsync 开销，
> 是 SQLite 批量写入性能的关键优化点。

#### `checkArchiveDate` 逻辑

```
SELECT MAX(timestamp) FROM session_messages
WHERE sessionKey = ? AND archivedDate IS NULL

若无活跃消息 → 返回 null（无需归档）
若最新活跃消息日期 === 新消息日期 → 返回 null
否则 → 返回最新活跃消息的日期字符串（'yyyy-mm-dd'）
```

---

### 3.2 `aiemas/src/session-history/session-history-query.ts`

#### 职责

实现 `session.history.range` 的查询逻辑，与 handler 注册解耦，便于单元测试。

#### 接口

```typescript
export interface HistoryRangeParams {
  sessionKey: string;
  sessionId?: string;       // 可选，指定时仅查该 sessionId
  from?: number;            // Unix ms，默认 now - 30天
  to?: number;              // Unix ms，默认 now
  limit?: number;           // 默认 200，最大 1000
  /** 缓冲区中尚未落盘的消息，由调用方（plugin handler）传入，与 DB 结果合并 */
  buffered?: StoredMessage[];
}

export interface HistoryRangeResult {
  messages: StoredMessage[];  // timestamp DESC 排列
  total: number;              // 时间范围内总消息数（含缓冲区）
  truncated: boolean;
  hasSummary: boolean;        // 时间范围内是否有 role='summary'
}

export function queryHistoryRange(
  db: DatabaseSync,
  params: HistoryRangeParams,
): HistoryRangeResult { ... }
```

#### `queryHistoryRange` 实现

```
const now = Date.now()
const from = params.from ?? (now - 30 * 24 * 60 * 60 * 1000)
const to   = params.to   ?? now
const limit = Math.min(params.limit ?? 200, 1000)

-- 构建 WHERE 子句
WHERE sessionKey = :sessionKey
  AND timestamp BETWEEN :from AND :to
  [AND sessionId = :sessionId]   -- 仅当 params.sessionId 存在时追加

-- 查询 DB 消息（不带 limit，先取全量用于合并）
SELECT * FROM session_messages WHERE ...
ORDER BY timestamp DESC

-- 合并缓冲区消息（去重：以 id 为键，buffer 优先覆盖 DB 同 id 记录）
const buffered = (params.buffered ?? []).filter(
  m => m.sessionKey === sessionKey
    && m.timestamp >= from && m.timestamp <= to
    && (!params.sessionId || m.sessionId === params.sessionId)
)
const merged = dedupeById([...dbMessages, ...buffered])
              .sort((a, b) => b.timestamp - a.timestamp)

const total = merged.length
const hasSummary = merged.some(m => m.role === 'summary')
const messages = merged.slice(0, limit)

return {
  messages,
  total,
  truncated: messages.length < total,
  hasSummary,
}
```

> `dedupeById`：以 `id` 为键构建 Map，后写入的覆盖先写入的（buffer 消息在 DB 消息之后写入，因此 buffer 优先）。实际上同一条消息在 buffer 和 DB 中同时存在的概率极低（flush 与查询并发时），去重仅作保险。

---

### 3.3 `mas4s-gateway-plugin.ts` 变更

#### 3.3.1 新增 `session.history.range` handler

在 `extraHandlers` 对象中追加：

```typescript
"session.history.range": async ({ params, client, respond }) => {
  const auth = getCallerAuth(client);
  try {
    const sessionKey = str(params["sessionKey"]);
    if (!sessionKey) {
      respond(false, undefined, errorShape("INVALID_PARAMS", "sessionKey required"));
      return;
    }

    // 权限检查：userId 不为 null 时验证访问权限
    if (auth.userId) {
      const access = bridge.checkSessionAccess(sessionKey, auth.userId);
      if (!access.allowed) {
        respond(false, undefined, errorShape("FORBIDDEN", access.message));
        return;
      }
    }

    const { queryHistoryRange } = await import("../session-history/session-history-query.js");

    // 取缓冲区快照，合并尚未落盘的消息，避免批量写入窗口期内的查询缺失
    const resolvedFrom = typeof params["from"] === "number" ? params["from"] : Date.now() - 30 * 24 * 60 * 60 * 1000;
    const resolvedTo   = typeof params["to"]   === "number" ? params["to"]   : Date.now();
    const resolvedSid  = typeof params["sessionId"] === "string" ? params["sessionId"] : undefined;
    const buffered = transcriptStore.getBuffered(sessionKey, resolvedFrom, resolvedTo, resolvedSid);

    const result = queryHistoryRange(db, {
      sessionKey,
      sessionId: resolvedSid,
      from:  resolvedFrom,
      to:    resolvedTo,
      limit: typeof params["limit"] === "number" ? params["limit"] : undefined,
      buffered,
    });
    respond(true, result, undefined);
  } catch (err) {
    const e = err instanceof TenantServiceError
      ? err : new TenantServiceError("INTERNAL", String(err));
    respond(false, undefined, errorShape(e.code, e.message));
  }
},
```

#### 3.3.2 `SessionTranscriptStore` 初始化与 `chat.send` wrap

在 `createMas4sGatewayPlugin` 函数体内，`bridge` 创建之后：

```typescript
// 初始化消息捕获存储
const { SessionTranscriptStore } = await import("../session-history/session-transcript-store.js");
const transcriptStore = new SessionTranscriptStore(db);
transcriptStore.start();

// 在 chat.send extraHandler 中维护 sessionKey → userId 映射
// （此 handler 在 mas4s-integration.ts 的 coreChatSend wrap 之前注册，
//  integration 层会覆盖 chat.send，但 transcriptStore 通过事件独立捕获）
// 因此这里只需在 extraHandlers 中注册一个轻量 hook 来记录 sender context：
extraHandlers["chat.send"] = async ({ params, client, respond }) => {
  const auth = getCallerAuth(client);
  const sessionKey = str(params["sessionKey"] ?? "");
  if (sessionKey && (auth.userId || auth.tenantId)) {
    transcriptStore.recordSenderContext(sessionKey, {
      userId: auth.userId ?? null,
      tenantId: auth.tenantId ?? null,
    });
  }
  // 注意：此 handler 会被 mas4s-integration.ts 的 coreChatSend wrap 覆盖，
  // 覆盖后 integration 层负责调用 coreChatSend；sender context 记录在覆盖前已执行。
  // 实际上 integration 层 wrap 会在 opts 中调用原 handler，所以这里 respond 不需要实际响应。
  respond(true, {}, undefined);
};
```

> **注意**：`mas4s-integration.ts` 中的 `chat.send` wrap 会在 `extraHandlers["chat.send"]` 基础上再次包装（`coreChatSend` 指向原始 gateway handler）。为确保 sender context 在消息写入前已记录，`recordSenderContext` 调用需在 `coreChatSend` 执行前完成。
>
> 实际集成时，`mas4s-integration.ts` 的 wrap 逻辑为：
>
> ```typescript
> const coreChatSend = chatHandlers["chat.send"];  // gateway 原始 handler
> extraHandlers["chat.send"] = async (opts) => {
>   // 1. 记录 sender context（来自 plugin 的 extraHandler 逻辑）
>   transcriptStore.recordSenderContext(sessionKey, { userId, tenantId });
>   // 2. 执行 gateway 原始 handler
>   await coreChatSend(opts);
>   // 3. 广播给其他成员（现有逻辑）
>   ...
> };
> ```
>
> 由于 `mas4s-integration.ts` 不能修改，`transcriptStore` 实例需通过 `plugin` 对象暴露，
> 或在 `plugin.extraHandlers["chat.send"]` 中内联 `recordSenderContext` 调用，
> 让 `mas4s-integration.ts` 的 wrap 在调用 `origChatSend`（即 plugin 的 handler）时自然触发。

**最终方案**：在 `plugin.extraHandlers["chat.send"]` 中内联 `recordSenderContext`，
`mas4s-integration.ts` 的 wrap 调用 `origChatSend`（即此 handler）时会先执行 context 记录，
再由 integration 层调用 `coreChatSend`（gateway 原始 handler）。

```typescript
// plugin.extraHandlers["chat.send"] — 仅记录 sender context，不调用 coreChatSend
// （coreChatSend 由 mas4s-integration.ts 的 wrap 负责调用）
extraHandlers["chat.send"] = async ({ params, client, respond }) => {
  const auth = getCallerAuth(client);
  const sessionKey = str(params["sessionKey"] ?? "");
  if (sessionKey) {
    transcriptStore.recordSenderContext(sessionKey, {
      userId: auth.userId ?? null,
      tenantId: auth.tenantId ?? null,
    });
  }
  respond(true, {}, undefined);
};
```

---

### 3.4 `database.ts` 变更

在 `ensureMas4sSchema` 末尾追加 `session_messages` 表 DDL（见 §2.1）。

---

## 4. 前端设计

### 4.1 `aiemas/ui/mas4s/src/gateway/session-manager.ts`

#### 新增 `fetchSessionHistoryRange`

```typescript
export interface SessionHistoryRangeResult {
  messages: ChatMessage[]; // 已反转为 ASC（最旧在上）
  total: number;
  truncated: boolean;
  hasSummary: boolean;
}

/**
 * 通过 session.history.range 拉取会话历史（默认最近 30 天，limit 200）。
 * 后端返回 DESC 顺序，此函数反转为 ASC 后返回。
 */
export async function fetchSessionHistoryRange(
  client: GatewayBrowserClient,
  sessionKey: string,
  opts?: { from?: number; to?: number; limit?: number },
): Promise<SessionHistoryRangeResult> {
  const result = await client.request<{
    messages?: unknown[];
    total?: number;
    truncated?: boolean;
    hasSummary?: boolean;
  }>("session.history.range", {
    sessionKey,
    limit: opts?.limit ?? 200,
    ...(opts?.from != null ? { from: opts.from } : {}),
    ...(opts?.to != null ? { to: opts.to } : {}),
  });

  const messages = (result.messages ?? [])
    .map((raw) => normalizeMessage(raw) as ChatMessage)
    .reverse(); // DESC → ASC

  return {
    messages,
    total: result.total ?? messages.length,
    truncated: result.truncated ?? false,
    hasSummary: result.hasSummary ?? false,
  };
}
```

### 4.2 `session-controller.ts` 调用点变更

在 `onSessionSelect` 中，将 `fetchSessionHistory` 替换为 `fetchSessionHistoryRange`，
并在失败时降级回 `fetchSessionHistory`：

```typescript
// 伪代码示意（实际位置在 session-controller.ts 的 onSessionSelect handler）
try {
  const result = await fetchSessionHistoryRange(client, session.key);
  this._messages = result.messages;
  this._historyMeta = { truncated: result.truncated, hasSummary: result.hasSummary };
} catch {
  // 降级：后端未部署 session.history.range 时回退
  const messages = await fetchSessionHistory(client, session.key);
  this._messages = messages;
  this._historyMeta = { truncated: false, hasSummary: false };
}
```

### 4.3 `chat-view.ts` 新增 UI 元素

#### 新增 props

```typescript
@property({ type: Boolean }) hasSummary = false;
@property({ type: Boolean }) truncated = false;
```

#### 摘要提示条（`hasSummary: true`）

在消息列表顶部渲染，复用现有 `summary-dialog` 触发机制：

```html
<!-- 仅当 hasSummary=true 时显示 -->
<div class="history-summary-hint" @click="${this._onSummaryClick}">
  <span>更早的消息已生成摘要，点击查看</span>
</div>
```

样式：

```css
.history-summary-hint {
  text-align: center;
  padding: 8px 16px;
  margin-bottom: 12px;
  background: #f0f9ff;
  border: 1px solid #bae6fd;
  border-radius: 8px;
  color: #0369a1;
  font-size: 13px;
  cursor: pointer;
}
.history-summary-hint:hover {
  background: #e0f2fe;
}
```

#### 加载更多占位（`truncated: true`）

```html
<!-- 仅当 truncated=true 时显示，在摘要提示条之上 -->
<div class="load-more-placeholder">
  <span>— 加载更多历史消息（即将支持）—</span>
</div>
```

样式：

```css
.load-more-placeholder {
  text-align: center;
  padding: 8px;
  color: #94a3b8;
  font-size: 12px;
  cursor: default;
}
```

#### render 方法中的顺序

```
chat-container 内部顺序（从上到下）：
  1. load-more-placeholder（truncated=true 时）
  2. history-summary-hint（hasSummary=true 时）
  3. session-divider
  4. message-list / empty-hint
```

---

## 5. 正确性属性（Property-Based Testing）

在 `aiemas/src/session-history/session-history.test.ts` 中使用 `fast-check` 实现以下属性：

### P-1 消息顺序不变性

**属性**：`queryHistoryRange` 返回的 `messages` 数组严格按 `timestamp DESC` 排列。

```
∀ messages ∈ queryHistoryRange(db, params).messages:
  ∀ i < messages.length - 1:
    messages[i].timestamp >= messages[i+1].timestamp
```

### P-2 归档日期单调性

**属性**：同一 `sessionKey` 下，`archivedDate` 不为 null 的消息，其 `archivedDate` 值
不晚于同 `sessionKey` 下任何活跃消息（`archivedDate IS NULL`）的日期。

```
∀ archived ∈ session_messages WHERE archivedDate IS NOT NULL:
∀ active   ∈ session_messages WHERE archivedDate IS NULL
  AND sessionKey = archived.sessionKey:
  archived.archivedDate <= toDateStr(active.timestamp)
```

### P-3 跨 reset 隔离性

**属性**：指定 `sessionId` 查询时，返回结果中所有消息的 `sessionId` 均等于参数值。

```
∀ msg ∈ queryHistoryRange(db, { sessionKey, sessionId: sid }).messages:
  msg.sessionId === sid
```

### P-4 时间范围边界正确性

**属性**：返回的所有消息 `timestamp` 均在 `[from, to]` 闭区间内。

```
∀ msg ∈ queryHistoryRange(db, { from, to }).messages:
  from <= msg.timestamp <= to
```

### P-5 `truncated` 语义正确性

**属性**：`truncated = true` 当且仅当 `total > messages.length`。

```
result.truncated === (result.total > result.messages.length)
```

### P-6 缓冲区消息可见性

**属性**：缓冲区中符合时间范围的消息，在 `queryHistoryRange` 结果中必须出现（不因未落盘而丢失）。

```
∀ msg ∈ buffered, msg.timestamp ∈ [from, to]:
  ∃ r ∈ queryHistoryRange(db, { ..., buffered }).messages:
    r.id === msg.id
```

---

## 6. 文件变更清单

| 文件                                                     | 变更类型 | 说明                                                                                           |
| -------------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| `aiemas/src/store/database.ts`                           | 修改     | `ensureMas4sSchema` 追加 `session_messages` DDL                                                |
| `aiemas/src/session-history/session-transcript-store.ts` | 新增     | 消息捕获与写入                                                                                 |
| `aiemas/src/session-history/session-history-query.ts`    | 新增     | 时间范围查询                                                                                   |
| `aiemas/src/session-history/session-history.test.ts`     | 新增     | 单元测试 + PBT                                                                                 |
| `aiemas/src/gateway-bridge/mas4s-gateway-plugin.ts`      | 修改     | 注册 `session.history.range`；初始化 `SessionTranscriptStore`；`chat.send` sender context hook |
| `aiemas/ui/mas4s/src/gateway/session-manager.ts`         | 修改     | 新增 `fetchSessionHistoryRange()`                                                              |
| `aiemas/ui/mas4s/src/views/chat-view.ts`                 | 修改     | 新增 `hasSummary`/`truncated` props 及对应 UI                                                  |

> US-4（自动摘要触发）已明确推迟，不在本 spec 实现范围内。
