# aiemas 会话消息持久化实现方案 v1

## 1. 总体架构

aiemas 的会话消息持久化采用**独立 SQLite 数据库 + 内存写缓冲 + 事件订阅**三层架构，与主库（`mas4s.db`）物理隔离，避免消息写入压力影响认证/RBAC 等核心业务。

```
Gateway 消息事件
      │
      ▼
onSessionTranscriptUpdate (transcript-events.ts)
      │
      ▼
SessionTranscriptStore.handleUpdate()
      │  ← 内存缓冲（buffer[]）
      ▼
flush() — 每 500ms 或 buffer ≥ 100 条时触发
      │
      ▼
persistBatch() — SQLite 事务批量写入
      │
      ▼
mas4s.message.db → session_messages 表
```

查询路径：

```
queryHistoryRange(db, params)
      │
      ├── DB 查询（session_messages WHERE sessionKey + timestamp BETWEEN）
      ├── 合并内存 buffer（未落盘消息）
      ├── 去重（同 id 以 buffer 版本优先）
      └── 返回 timestamp DESC 排序结果
```

---

## 2. 数据库设计

### 2.1 数据库文件

| 文件                                  | 用途                             |
| ------------------------------------- | -------------------------------- |
| `~/.openclaw/aiemas/mas4s.db`         | 主库：租户、用户、RBAC、会话归属 |
| `~/.openclaw/aiemas/mas4s.message.db` | 消息库：会话消息历史（性能隔离） |

初始化入口：`aiemas/src/store/database.ts`

- `initDatabase(dbPath?)` — 初始化主库
- `initMessageDatabase(dbPath?)` — 初始化消息库

两个数据库均启用 WAL 模式（`PRAGMA journal_mode=WAL`）和 `busy_timeout=5000`，保证多进程并发写入安全。

### 2.2 session_messages 表结构

```sql
CREATE TABLE IF NOT EXISTS session_messages (
  id           TEXT    PRIMARY KEY,          -- UUID
  sessionKey   TEXT    NOT NULL,             -- 会话标识（跨 reset 不变）
  sessionId    TEXT    NOT NULL,             -- 单次会话 ID（reset 后变更）
  userId       TEXT    NULL,                 -- 发送者 userId（兼容模式下为 NULL）
  tenantId     TEXT    NULL,                 -- 租户 ID（兼容模式下为 NULL）
  role         TEXT    NOT NULL              -- 消息角色
               CHECK(role IN ('user','assistant','tool','summary')),
  content      TEXT    NOT NULL,             -- 消息正文（纯文本，已提取）
  timestamp    INTEGER NOT NULL,             -- Unix ms
  seq          INTEGER NOT NULL DEFAULT 0,   -- 会话内单调递增序号
  archivedDate TEXT    NULL                  -- 跨日归档日期（yyyy-mm-dd）
);
```

索引：

```sql
-- 主查询路径：按 sessionKey + 时间范围
CREATE INDEX idx_session_messages_key_ts    ON session_messages(sessionKey, timestamp);
-- 按 sessionId 过滤（跨 reset 隔离）
CREATE INDEX idx_session_messages_session_id ON session_messages(sessionId);
-- seq 连续性验证
CREATE INDEX idx_session_messages_sid_seq   ON session_messages(sessionId, seq);
```

---

## 3. 写入流程

### 3.1 SessionTranscriptStore

源文件：`aiemas/src/session-history/session-transcript-store.ts`

#### 构造与启动

```typescript
const store = new SessionTranscriptStore(db, {
  flushIntervalMs: 500, // 定时刷盘间隔（默认 500ms）
  maxBufferSize: 100, // 强制刷盘阈值（默认 100 条）
});
store.start(); // 订阅事件 + 启动定时器
```

`start()` 内部调用 `onSessionTranscriptUpdate()` 注册监听器，并启动 `setInterval` 定时刷盘。

#### 发送者上下文注入

`chat.send` 的 extraHandler 在消息到达时调用：

```typescript
store.recordSenderContext(sessionKey, { userId, tenantId });
```

此后该 `sessionKey` 的所有消息都会携带正确的 `userId`/`tenantId`。兼容模式（未认证连接）下两者均为 `null`。

#### handleUpdate 处理逻辑

每条 `SessionTranscriptUpdate` 事件触发以下处理：

1. 跳过无 `message` 字段的文件路径更新事件
2. 调用 `extractContent()` 将 `message.content` 规范化为纯文本字符串：
   - 字符串：直接使用
   - 数组（Anthropic 格式）：拼接所有 `type=text` 块；`thinking` 块序列化为 `[thinking] ...`；`tool_use`/`toolCall` 块序列化为 `[tool_use:name] args`
3. 调用 `normaliseRole()` 将 `human`/`ai`/`toolResult` 等变体统一为 `user`/`assistant`/`tool`/`summary`
4. 调用 `isInboundMetaMessage()` 过滤 gateway 注入的 `Sender (untrusted metadata):` 重复消息
5. 从 `seqMap` 取当前 `sessionId` 的最大 seq，递增后写入（跨重启从 DB 加载初始值）
6. 构造 `StoredMessage` 推入 `buffer[]`
7. 若 `buffer.length >= maxBufferSize`，立即触发 `flush()`

#### flush / persistBatch

`flush()` 原子性地将 `buffer` 全部取出，调用 `persistBatch()`：

1. 按 `sessionKey` 分组，对每组检查是否跨日（`checkArchiveDate()`）
2. 若跨日，将该 `sessionKey` 下所有 `archivedDate IS NULL` 的旧消息批量更新 `archivedDate = 旧日期`
3. 在同一个 `BEGIN/COMMIT` 事务中批量 `INSERT` 所有新消息

跨日归档逻辑：

```
新消息日期 ≠ DB 中该 sessionKey 最新活跃消息日期
  → 将旧消息标记 archivedDate = 旧日期
  → 新消息以 archivedDate = NULL 写入（活跃状态）
```

#### stop

```typescript
store.stop();
// 取消订阅 → 清除定时器 → 同步 flush 剩余 buffer
```

进程退出前必须调用，确保缓冲消息不丢失。

---

## 4. 查询流程

### 4.1 queryHistoryRange

源文件：`aiemas/src/session-history/session-history-query.ts`

```typescript
const result = queryHistoryRange(db, {
  sessionKey: "sk-xxx",
  sessionId?: "sid-yyy",          // 可选：限定单次会话（跨 reset 隔离）
  from?: number,                   // Unix ms，默认 now - 30天
  to?: number,                     // Unix ms，默认 now
  limit?: number,                  // 默认 200，最大 1000
  buffered?: StoredMessage[],      // 未落盘的内存消息（由调用方传入）
  resolveDisplayName?: (userId) => string | undefined,  // 用户名解析回调
});
```

返回值：

```typescript
interface HistoryRangeResult {
  messages: StoredMessageWithSender[]; // timestamp DESC
  total: number; // 时间范围内总条数（含 buffer）
  truncated: boolean; // total > messages.length
  hasSummary: boolean; // 是否含 role='summary' 消息
}
```

#### 查询步骤

1. 参数默认值填充（`from`、`to`、`limit`）
2. 构造 SQL：`WHERE sessionKey = ? AND timestamp BETWEEN ? AND ?`，可选追加 `AND sessionId = ?`，`ORDER BY timestamp DESC`
3. 过滤 `buffered` 参数中匹配条件的消息
4. 合并 DB 结果与 buffer，调用 `dedupeById()`（同 id 以 buffer 版本优先）
5. `toSorted((a, b) => b.timestamp - a.timestamp)` 保证全局 timestamp DESC
6. 截取前 `limit` 条，计算 `total`、`truncated`、`hasSummary`
7. 对 `role === 'user'` 且 `userId` 非空的消息调用 `resolveDisplayName` 填充 `senderLabel`；`assistant`/`tool` 消息的 `senderLabel` 固定为 `null`

---

## 5. 关键设计决策

### 5.1 双数据库隔离

消息库（`mas4s.message.db`）与主库（`mas4s.db`）物理分离，原因：

- 消息写入频率远高于用户/RBAC 操作，避免锁竞争
- 消息库可独立备份、清理、迁移，不影响认证状态
- 主库 schema 变更不影响消息历史

### 5.2 内存缓冲 + 批量写入

单条消息不直接落盘，而是先进 `buffer[]`，由定时器（500ms）或阈值（100条）触发批量写入。优点：

- 减少 SQLite 事务开销（N 条消息 → 1 次事务）
- 高并发场景下写入吞吐量显著提升
- `stop()` 时同步 flush 保证不丢消息

### 5.3 seq 内存累积 + 重启恢复

`seqMap` 在内存中维护每个 `sessionId` 的当前最大 seq，避免每次写入都查询 DB。重启时通过：

```sql
SELECT sessionId, MAX(seq) AS maxSeq FROM session_messages GROUP BY sessionId
```

恢复初始值，保证 seq 跨重启单调递增。

### 5.4 buffer 与 DB 合并查询

`queryHistoryRange` 接受调用方传入的 `buffered` 参数，将未落盘消息与 DB 结果合并后返回，确保查询结果实时性。同 id 消息以 buffer 版本优先（buffer 中的消息可能比 DB 中的版本更新）。

### 5.5 跨 reset 隔离

`sessionKey` 在会话 reset 后保持不变，`sessionId` 变更为新 UUID。查询时：

- 不传 `sessionId`：返回该 `sessionKey` 下所有历史消息（跨多次 reset）
- 传入 `sessionId`：仅返回该次 reset 周期内的消息

### 5.6 跨日归档

`archivedDate` 字段标记消息所属的"活跃日期"。当新消息到达且日期与现有活跃消息不同时，旧消息被批量打上 `archivedDate`，新消息以 `archivedDate = NULL` 写入。这使得按日期范围过滤历史消息成为可能，同时不删除任何数据。

---

## 6. 消息内容提取规则

`extractContent(raw)` 处理 gateway 产生的多种 content 格式：

| 输入格式                                  | 处理方式                          |
| ----------------------------------------- | --------------------------------- |
| `string`                                  | 直接使用                          |
| `[{ type: "text", text: "..." }]`         | 拼接所有 text 块                  |
| `[{ type: "thinking", thinking: "..." }]` | `[thinking] ...`                  |
| `[{ type: "tool_use", name, input }]`     | `[tool_use:name] JSON(input)`     |
| `[{ type: "toolCall", name, arguments }]` | `[tool_use:name] JSON(arguments)` |
| `[{ type: "tool_result", content }]`      | 递归提取 content                  |
| 其他                                      | 空字符串，过滤掉                  |

---

## 7. 角色规范化规则

`normaliseRole(raw)` 映射：

| 输入                                      | 输出                           |
| ----------------------------------------- | ------------------------------ |
| `"human"`, `"user"`                       | `"user"`                       |
| `"ai"`, `"assistant"`                     | `"assistant"`                  |
| `"tool"`, `"toolResult"`, `"tool_result"` | `"tool"`                       |
| `"summary"`                               | `"summary"`                    |
| 其他未知值                                | `"user"`（满足 DB CHECK 约束） |

---

## 8. 重复消息过滤

gateway 在处理入站消息时会触发两次 `SessionTranscriptUpdate`：

1. 原始用户消息
2. 经 `buildInboundUserContextPrefix` 注入 `Sender (untrusted metadata):` 前缀的元数据版本

`isInboundMetaMessage()` 检测第二条事件并跳过，避免同一条用户消息被存储两次。

---

## 9. 测试覆盖

测试文件：`aiemas/src/session-history/session-history.test.ts`

| 测试类型 | 覆盖点                                                                                                                                             |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 单元测试 | 写入后落盘、跨日归档触发、maxBufferSize 强制刷盘、stop() 刷盘、getBuffered 过滤、recordSenderContext 关联、重复消息过滤、seq 累积、重启后 seq 恢复 |
| 单元测试 | 时间范围过滤、sessionId 过滤、limit 截断、hasSummary 检测、buffer 合并去重、senderLabel 解析                                                       |
| PBT P-1  | 查询结果严格 timestamp DESC（100 次随机）                                                                                                          |
| PBT P-2  | archivedDate 单调性：归档日期 ≤ 活跃消息日期（50 次随机）                                                                                          |
| PBT P-3  | 指定 sessionId 时结果严格隔离（100 次随机）                                                                                                        |
| PBT P-4  | 所有返回消息 timestamp ∈ [from, to]（100 次随机）                                                                                                  |
| PBT P-5  | `truncated === (total > messages.length)`（100 次随机）                                                                                            |
| PBT P-6  | buffer 消息在时间范围内必须出现在结果中（100 次随机）                                                                                              |

运行：

```bash
pnpm test -- aiemas/src/session-history
```

---

## 10. 与 openclaw 核心的关系

aiemas 的消息持久化是对 openclaw 核心 JSONL 方案的**补充**，而非替代：

| 维度          | openclaw 核心（JSONL）                                    | aiemas（SQLite）                         |
| ------------- | --------------------------------------------------------- | ---------------------------------------- |
| 存储位置      | `~/.openclaw/agents/<agentId>/sessions/<sessionId>.jsonl` | `~/.openclaw/aiemas/mas4s.message.db`    |
| 写入方式      | 追加写入，每次写前全量读取计算 seq（O(N)）                | 内存缓冲 + 批量事务写入（O(1) seq 计算） |
| 查询方式      | 全量读取后截取                                            | 索引范围查询 + buffer 合并               |
| 多租户隔离    | 无                                                        | `tenantId` 字段 + RBAC 过滤              |
| 跨 reset 查询 | 需遍历归档文件                                            | `sessionKey` 索引直接覆盖                |
| 用户身份关联  | 无                                                        | `userId` + `resolveDisplayName` 回调     |
