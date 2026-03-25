# Tasks: aiemas 会话消息历史管理

## 实现任务

- [x] 1. 数据库 Schema 迁移
  - [x] 1.1 在 `aiemas/src/store/database.ts` 的 `ensureMas4sSchema` 末尾追加 `session_messages` 表 DDL（含 `id`、`sessionKey`、`sessionId`、`userId`、`tenantId`、`role`、`content`、`timestamp`、`seq`、`archivedDate` 字段）
  - [x] 1.2 追加复合索引 `idx_session_messages_key_ts ON session_messages(sessionKey, timestamp)` 和 `idx_session_messages_session_id ON session_messages(sessionId)`
  - [x] 1.3 验证迁移幂等性：对已存在表重复调用 `ensureMas4sSchema` 不报错

- [x] 2. 实现 `SessionTranscriptStore`（`aiemas/src/session-history/session-transcript-store.ts`）
  - [x] 2.1 实现类骨架：构造函数接收 `db: DatabaseSync` 和可选 `opts`（`flushIntervalMs` 默认 500、`maxBufferSize` 默认 100），初始化内存缓冲队列 `buffer` 和 `senderMap`
  - [x] 2.2 实现 `recordSenderContext(sessionKey, ctx)`：更新 `senderMap`，供后续消息写入时关联 userId/tenantId
  - [x] 2.3 实现 `start()`：订阅 `onSessionTranscriptUpdate`，启动 `setInterval` 定时刷写
  - [x] 2.4 实现 `stop()`：取消订阅，清除定时器，强制调用 `flush()` 刷写剩余缓冲消息
  - [x] 2.5 实现 `handleUpdate(update)`：从 `update.message` 提取字段（role 映射、content、timestamp、sessionId），从 `senderMap` 取 userId/tenantId，生成 UUID，推入 `buffer`；超过 `maxBufferSize` 时立即同步 `flush()`；异常仅 `console.error`
  - [x] 2.6 实现 `flush()`：drain buffer，调用 `persistBatch(msgs)`；异常仅 `console.error`
  - [x] 2.7 实现 `persistBatch(msgs)`：单一 SQLite 事务，按 sessionKey 分组做归档检查（`checkArchiveDate`），批量 INSERT（prepared statement 循环）
  - [x] 2.8 实现 `checkArchiveDate(sessionKey, newMsgDate)`：查询该 sessionKey 最新活跃消息日期，返回需归档的旧日期或 null
  - [x] 2.9 实现 `getBuffered(sessionKey, from, to, sessionId?)`：返回 buffer 中符合条件的消息快照（只读，不修改 buffer）

- [x] 3. 实现 `queryHistoryRange`（`aiemas/src/session-history/session-history-query.ts`）
  - [x] 3.1 实现函数签名和参数默认值（`from` 默认 now-30天，`to` 默认 now，`limit` 默认 200 最大 1000）
  - [x] 3.2 构建带条件的 SQL（`sessionKey`、`timestamp BETWEEN`、可选 `sessionId`），查询全量 DB 消息（不带 limit）
  - [x] 3.3 合并 `params.buffered`：过滤符合条件的缓冲消息，与 DB 结果按 `id` 去重（buffer 优先），按 `timestamp DESC` 排序后截取 `limit`
  - [x] 3.4 计算并返回 `{ messages, total, truncated, hasSummary }`

- [x] 4. 更新 `mas4s-gateway-plugin.ts`
  - [x] 4.1 在 `createMas4sGatewayPlugin` 中初始化 `SessionTranscriptStore`，调用 `transcriptStore.start()`
  - [x] 4.2 在 `extraHandlers["chat.send"]` 中内联 `recordSenderContext` 调用（记录 sessionKey → userId/tenantId 映射）
  - [x] 4.3 注册 `session.history.range` extraHandler：权限检查 → 调用 `transcriptStore.getBuffered()` 取缓冲快照 → 调用 `queryHistoryRange(db, { ..., buffered })` → respond

- [x] 5. 编写单元测试和 PBT（`aiemas/src/session-history/session-history.test.ts`）
  - [x] 5.1 `SessionTranscriptStore` 单元测试：使用 `:memory:` SQLite，覆盖消息写入、按天归档触发、`maxBufferSize` 强制刷写、`stop()` 强制刷写、`getBuffered()` 过滤逻辑
  - [x] 5.2 `queryHistoryRange` 单元测试：覆盖时间范围过滤、sessionId 过滤、limit 截断、`hasSummary` 检测、缓冲区合并去重
  - [x] 5.3 PBT P-1：消息顺序不变性（返回结果严格 timestamp DESC）
  - [x] 5.4 PBT P-2：归档日期单调性（已归档消息日期不晚于任何活跃消息日期）
  - [x] 5.5 PBT P-3：跨 reset 隔离性（指定 sessionId 时结果不含其他 sessionId 的消息）
  - [x] 5.6 PBT P-4：时间范围边界正确性（所有返回消息 timestamp ∈ [from, to]）
  - [x] 5.7 PBT P-5：`truncated` 语义正确性（`truncated === total > messages.length`）
  - [x] 5.8 PBT P-6：缓冲区消息可见性（buffer 中符合条件的消息必须出现在结果中）

- [x] 6. 前端：新增 `fetchSessionHistoryRange`（`aiemas/ui/mas4s/src/gateway/session-manager.ts`）
  - [x] 6.1 实现 `fetchSessionHistoryRange(client, sessionKey, opts?)`：调用 `session.history.range`，将返回的 DESC 消息数组 `.reverse()` 为 ASC，返回 `{ messages, total, truncated, hasSummary }`

- [x] 7. 前端：更新 `session-controller.ts` 调用点
  - [x] 7.1 在 `onSessionSelect` 中将 `fetchSessionHistory` 替换为 `fetchSessionHistoryRange`，失败时降级回 `fetchSessionHistory`；将 `truncated`/`hasSummary` 存入组件状态并传递给 `chat-view`

- [x] 8. 前端：更新 `chat-view.ts` UI（`aiemas/ui/mas4s/src/views/chat-view.ts`）
  - [x] 8.1 新增 `@property hasSummary` 和 `@property truncated` 布尔 props
  - [x] 8.2 在消息列表顶部渲染摘要提示条（`hasSummary=true` 时）和加载更多占位（`truncated=true` 时），添加对应 CSS 样式
