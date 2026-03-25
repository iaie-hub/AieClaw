# Requirements: aiemas 会话消息历史管理

## 背景

OpenClaw gateway 已有基于 JSONL 的会话消息持久化方案（`~/.openclaw/agents/<agentId>/sessions/<sessionId>.jsonl`）。
该方案存在 O(N) 读写性能问题，且不在 aiemas 模块的控制范围内。

本功能在 `aiemas/src/` 内独立实现一套会话消息历史管理系统，**不修改 gateway 原有方案**。

### 技术可行性确认

aiemas 已有成熟的 gateway 挂载机制：

- `mas4s-gateway-plugin.ts` 中的 `extraHandlers` 是 aiemas 向 gateway 注册自定义方法处理器的标准入口。
- `gatewayDispatch` 回调允许 aiemas 向 gateway 内部发起方法调用（如 `chat.history`），已在 `session.archive` 流程中使用。
- `GatewayAuthBridge` 的 `interceptMethod` 在每次 `chat.send` 前被调用，可在此处捕获消息上下文（`sessionKey`、`masAuth`）。

**两种捕获方式**：

| 方式                                                      | 优点                                                    | 缺点                                      |
| --------------------------------------------------------- | ------------------------------------------------------- | ----------------------------------------- |
| 在 `interceptMethod`/`chat.send` extraHandler 中捕获      | 可直接获取 `masAuth`（userId、tenantId）和 `sessionKey` | 仅捕获用户消息，AI 回复需另外处理         |
| 订阅 `onSessionTranscriptUpdate` 事件（gateway 内部事件） | 用户消息和 AI 回复均可捕获，payload 含完整 message 对象 | 需从 sessionKey 反查 userId（需维护映射） |

**推荐方案**：两者结合——在 `chat.send` extraHandler 中维护 `sessionKey → userId` 映射；订阅 `onSessionTranscriptUpdate` 事件捕获所有消息（含 AI 回复），写入时通过映射关联 userId。

**存储方案**：消息持久化到 `mas4s.db` 的新表 `session_messages`（SQLite），复用现有 `initDatabase` / `ensureMas4sSchema` 基础设施，不引入新的文件存储。

---

## 用户故事

### US-1 消息捕获

**作为** aiemas 平台管理员，  
**我希望** 系统能自动捕获经过 gateway 的所有会话消息（含用户消息和 AI 回复），  
**以便** 在 aiemas 侧独立保存完整的会话消息记录，不依赖 gateway 的 JSONL 文件。

#### 验收标准

- AC-1.1：在 `mas4s-gateway-plugin.ts` 的 `chat.send` extraHandler 中，维护 `sessionKey → { userId, tenantId }` 的内存映射，供后续消息写入时关联用户身份。
- AC-1.2：在 `aiemas/src/session-history/` 下新增 `session-transcript-store.ts`，订阅 `onSessionTranscriptUpdate` 事件（`src/sessions/transcript-events.ts`），将每条消息写入 `mas4s.db` 的 `session_messages` 表。
- AC-1.3：捕获的消息记录包含：`id`（UUID）、`sessionKey`、`sessionId`、`userId`（可为 null）、`tenantId`（可为 null）、`role`（user/assistant/tool/summary）、`content`（TEXT）、`timestamp`（INTEGER ms）、`seq`（INTEGER）。
- AC-1.4：捕获失败（DB 写入错误）不影响 gateway 原有消息流程，仅记录 `console.error` 日志。
- AC-1.5：兼容模式（`userId` 为 null）下，消息仍被捕获并存储，`userId` 和 `tenantId` 字段为 NULL。

---

### US-2 按天归档

**作为** aiemas 平台管理员，  
**我希望** 系统在每天（本地时区日期变更时）自动将前一天的消息标记为归档，  
**以便** 历史消息按日期有序管理，活跃消息与历史消息逻辑隔离。

#### 验收标准

- AC-2.1：`session_messages` 表新增 `archivedDate` 字段（TEXT，格式 `yyyy-mm-dd`，默认 NULL 表示活跃消息）。
- AC-2.2：归档触发条件：当新消息写入时，检测其本地日期与该 `sessionKey` 最新活跃消息的日期不同，则将所有旧活跃消息的 `archivedDate` 更新为其对应的本地日期。
- AC-2.3：归档操作在同一 SQLite 事务中完成（UPDATE + INSERT），保证原子性。
- AC-2.4：归档触发时，记录一条 INFO 日志，包含 `sessionKey`、归档日期、归档消息数量。
- AC-2.5：归档操作不删除任何消息，仅更新 `archivedDate` 字段。

---

### US-3 时间范围消息加载（`session.history.range`）

**作为** aiemas 前端用户，  
**我希望** 通过新的 `session.history.range` 方法指定时间范围（`from` / `to`）来加载会话消息，  
**以便** 查看特定日期段内的历史对话，而不仅限于最近 N 条。

#### 验收标准（后端）

- AC-3.1：在 `extraHandlers` 中注册新方法 `session.history.range`，参数：`sessionKey`（必填）、`from`（Unix ms，可选，默认当前时间减 30 天）、`to`（Unix ms，可选，默认当前时间）、`limit`（可选，默认 200，最大 1000）。
- AC-3.2：从 `session_messages` 表按 `timestamp BETWEEN from AND to` 查询，结果按 `timestamp DESC` 排序（最新消息在前），再按 `limit` 截取。
- AC-3.3：返回结果包含 `messages` 数组（按 `timestamp DESC` 排列）、`total`（时间范围内的总消息数）、`truncated`（是否因 limit 截断）、`hasSummary`（时间范围内是否存在 `role=summary` 的消息）字段。
- AC-3.4：权限检查：`userId` 不为 null 时，调用 `bridge.checkSessionAccess` 验证访问权限；兼容模式（userId=null）直接放行。
- AC-3.5：由于消息采用批量缓冲写入，`session.history.range` 查询时必须将 `SessionTranscriptStore` 内存缓冲区中尚未落盘的消息与 SQLite 查询结果合并后返回，确保查询结果包含所有已捕获的消息（含窗口期内的最新消息）。合并后的结果仍按 `timestamp DESC` 排序，并遵守 `limit` 上限。

---

### US-6 前端历史消息加载切换

**作为** aiemas 前端用户，  
**我希望** 前端在加载会话历史时优先使用 `session.history.range`（从 aiemas 自有存储读取），  
**以便** 获得跨 reset 的完整历史记录和时间范围筛选能力，而不仅限于 gateway `chat.history` 返回的最近 N 条。

#### 背景

当前前端调用链：`session-controller.ts` → `fetchSessionHistory()` → `client.request("chat.history", { sessionKey, limit: 200 })`。  
`chat.history` 只返回当前 `sessionId` 的最近消息，reset 后历史丢失。  
`session.history.range` 从 aiemas `session_messages` 表查询，支持跨 reset 和时间范围。

#### 验收标准（前端）

- AC-6.1：在 `aiemas/ui/mas4s/src/gateway/session-manager.ts` 中，新增 `fetchSessionHistoryRange()` 函数，调用 `client.request("session.history.range", { sessionKey, limit: 200 })`（不传 `from`/`to`，由后端默认取最近 30 天）替代原 `chat.history` 调用。
- AC-6.2：后端返回的 `messages` 数组为 `timestamp DESC` 顺序；前端在渲染前将其反转为 `timestamp ASC`（最旧在上、最新在下），与现有 `chat-view` 的渲染顺序保持一致。
- AC-6.3：`session-controller.ts` 的 `onSessionSelect` 中，将 `fetchSessionHistory()` 替换为 `fetchSessionHistoryRange()`；若 `session.history.range` 返回错误（如后端未部署），自动降级回 `chat.history`。
- AC-6.4：新增可选参数 `from` / `to`（Unix ms），供未来历史翻页或日期筛选 UI 使用；当前默认不传（加载最近 `limit` 条）。
- AC-6.5：`session.history.range` 响应中的 `hasSummary: true` 时，前端在消息列表顶部显示摘要提示条（复用现有 `summary-dialog` 组件或简单文本提示），告知用户"更早的消息已生成摘要"。
- AC-6.6：`truncated: true` 时，前端在消息列表顶部显示"加载更多"入口（预留 UI 占位，点击行为可在后续迭代实现）。

---

### US-4 自动摘要触发（session.archive 联动）

**作为** aiemas 平台管理员，  
**我希望** 当活跃消息数量超过阈值时，系统自动触发摘要生成并将旧消息归档，  
**以便** 控制活跃消息数量，同时保留语义上下文。

#### 验收标准

- AC-4.1：摘要触发阈值可配置（默认 200 条活跃消息），通过 `TenantServiceConfig.sessionHistory?.summaryThreshold` 传入。
- AC-4.2：每次消息写入后，检查该 `sessionKey` 的活跃消息数（`archivedDate IS NULL`）是否超过阈值。
- AC-4.3：超过阈值时，异步调用现有的 `bridge.generateSummary`（通过 `gatewayDispatch` 获取 `chat.history`），生成摘要后：
  - 将摘要文本以 `role: "summary"` 写入 `session_messages` 表（新的活跃消息）。
  - 将触发摘要前的所有活跃消息批量设置 `archivedDate` 为当天日期。
- AC-4.4：摘要生成为异步操作（`setImmediate` 或 `Promise` 不阻塞写入路径），不阻塞当前消息写入响应。
- AC-4.5：摘要生成失败时，记录 `console.error` 日志，不修改任何消息的 `archivedDate`，下次触发时重试。
- AC-4.6：`session_messages` 表中存在 `role = 'summary'` 的消息时，`session.history.range` 返回结果中 `hasSummary` 字段为 `true`。

---

### US-5 会话重置联动

**作为** aiemas 平台管理员，  
**我希望** 当 gateway 触发 session reset（新 `sessionId`）时，aiemas 消息历史模块能感知并正确处理，  
**以便** 新会话的消息不与旧会话消息混存。

#### 验收标准

- AC-5.1：`session_messages` 表以 `sessionId` 作为物理隔离键；reset 后新 `sessionId` 的消息自然写入新的行集合，与旧 `sessionId` 完全隔离。
- AC-5.2：`session.history.range` 支持可选参数 `sessionId`，当指定时仅返回该 `sessionId` 的消息；不指定时返回该 `sessionKey` 下所有 `sessionId` 的消息（跨 reset 合并）。
- AC-5.3：`sessionKey → { userId, tenantId }` 的内存映射在 reset 后保持有效（映射基于 `sessionKey`，不依赖 `sessionId`）。

---

## 非功能性需求

### NFR-1 性能

- 消息持久化采用**定时批量写入**：消息先缓冲至内存队列，每 500ms 或缓冲区满 100 条时批量刷入 SQLite（单一事务），避免每条消息单独 fsync 的开销。
- 批量刷写延迟 P99 < 10ms（SQLite WAL 模式，本地磁盘，单批 ≤ 100 条）。
- 消息从事件触发到进入缓冲区的延迟 P99 < 1ms（纯内存操作）。
- `session.history.range` 时间范围查询（≤ 30 天跨度）响应时间 P99 < 100ms（需在 `timestamp` 和 `sessionKey` 上建立复合索引）。
- 进程退出时（`stop()` 调用）强制刷写缓冲区，保证不丢失已捕获的消息。

### NFR-2 存储

- 消息数据存储在现有 `mas4s.db` 的新表 `session_messages` 中，不引入新的文件或数据库。
- 不读写 gateway 的 `~/.openclaw/agents/` 目录。

### NFR-3 模块边界

- 遵循 `aiemas/AGENTS.md` 约束：后端新代码闭环在 `aiemas/src/` 内。
- 新增子目录：`aiemas/src/session-history/`，包含：
  - `session-transcript-store.ts`：消息捕获与写入逻辑
  - `session-history-query.ts`：时间范围查询逻辑
  - `session-history.test.ts`：单元测试
- `ensureMas4sSchema` 中新增 `session_messages` 表的 DDL（幂等迁移）。
- 不修改 `src/gateway/` 下的任何文件。
- 前端改动范围：
  - `aiemas/ui/mas4s/src/gateway/session-manager.ts`：新增 `fetchSessionHistoryRange()`，修改 `onSessionSelect` 调用点
  - `aiemas/ui/mas4s/src/views/chat-view.ts`：新增摘要提示条和"加载更多"占位 UI
  - 不修改 `message-list.ts`、`msg-*.ts` 等消息渲染组件

### NFR-4 可测试性

- 所有核心逻辑（消息写入、归档触发、时间范围查询、摘要触发）必须有对应的单元测试。
- 测试使用 `:memory:` SQLite 数据库，不依赖真实 `~/.openclaw` 路径。
- 测试通过 `pnpm test -- aiemas/src/session-history` 运行。
