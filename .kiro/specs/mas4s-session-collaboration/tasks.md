# 实现计划：mas4s 会话协作管理

## 概述

在现有会话邀请/成员管理实现基础上，增量实现会话归档、会话摘要（含 LLM 调用）、数据库 Schema 扩展，以及对应的前端 UI 变更。按后端→前端→测试顺序组织，后端任务严格遵循依赖顺序。

## 任务

- [ ] 1. 扩展数据库 Schema（`aiemas/src/store/database.ts`）
  - 在 `ensureMas4sSchema` 中使用 `PRAGMA table_info(session_ownership)` 检查 `archivedAt` 列是否存在，不存在则执行 `ALTER TABLE session_ownership ADD COLUMN archivedAt INTEGER`（幂等迁移）
  - 新增 `CREATE TABLE IF NOT EXISTS session_summaries` 语句，字段：`sessionKey TEXT PRIMARY KEY`、`textSummary TEXT`、`toolSummary TEXT`、`generatedAt INTEGER NOT NULL`、`generatedBy TEXT NOT NULL`
  - _需求：5.1、5.2、5.3_

  - [ ]\* 1.1 为 Schema 迁移编写属性测试
    - **属性 9：Schema 迁移幂等性**
    - **验证：需求 5.1、5.2、5.3**
    - 在 `aiemas/src/store/database.property.test.ts` 中新增测试用例，重复调用 `ensureMas4sSchema` 三次，断言不抛出错误且数据库状态不变
    - 标签：`// Feature: mas4s-session-collaboration, Property 9: Schema 迁移幂等性`

- [ ] 2. 新增错误码与模型类型
  - 在 `aiemas/src/errors.ts` 中新增三个错误码常量：`SESSION_ARCHIVED`、`NO_MESSAGES_TO_SUMMARIZE`、`LLM_NOT_CONFIGURED`
  - 在 `aiemas/src/models.ts` 中新增 `SessionSummary` 接口：`{ sessionKey: string; textSummary: string | null; toolSummary: string | null; generatedAt: number; generatedBy: string }`
  - _需求：3.4、4.8、5.1_

- [ ] 3. 扩展 `session-manager.ts`（`aiemas/src/gateway-bridge/session-manager.ts`）
  - 新增 `archiveSession(db, sessionKey, callerUserId): number`：校验调用者为 owner，幂等更新 `archivedAt`（已归档则直接返回现有时间戳），返回 `archivedAt` 时间戳
  - 新增 `isSessionArchived(db, sessionKey): boolean`：查询 `session_ownership.archivedAt` 是否非 NULL
  - 新增 `upsertSummary(db, sessionKey, textSummary, toolSummary, generatedBy): SessionSummary`：使用 `INSERT OR REPLACE` 写入 `session_summaries` 表
  - 新增 `getSummary(db, sessionKey): SessionSummary | null`：从 `session_summaries` 表读取摘要，不存在返回 `null`
  - 新增 `deleteSummary(db, sessionKey): void`：从 `session_summaries` 表删除指定会话的摘要记录（幂等，不存在时不报错）
  - _需求：3.2、3.4、4.3、4.5_

  - [ ]\* 3.1 为归档幂等性编写属性测试
    - **属性 6：归档幂等性**
    - **验证：需求 3.2**
    - 在 `aiemas/src/gateway-bridge/session-collaboration.property.test.ts` 中新增测试：对同一会话重复调用 `archiveSession`，断言两次返回的 `archivedAt` 相同
    - 标签：`// Feature: mas4s-session-collaboration, Property 6: 归档幂等性`

  - [ ]\* 3.2 为摘要 round-trip 编写属性测试
    - **属性 7：摘要持久化条件（round-trip）**
    - **验证：需求 4.3、4.5**
    - 在 `aiemas/src/gateway-bridge/session-collaboration.property.test.ts` 中新增测试：`upsertSummary` 后立即调用 `getSummary`，断言返回内容等价；重新打开数据库后再次调用 `getSummary` 仍返回相同结果
    - 标签：`// Feature: mas4s-session-collaboration, Property 7: 摘要 round-trip`

- [ ] 4. 新增 LLM 摘要服务（新文件 `aiemas/src/gateway-bridge/summary-llm.ts`）
  - 实现 `extractContentForSummary(messages): { textLines: string[]; toolPairs: ToolPair[] }`：按设计文档规则提取 `textLines`（user/assistant 文本行）和 `toolPairs`（工具调用+结果配对）
  - 实现 `generateSummaryWithLLM(textLines, toolPairs, generatedBy): Promise<{ textSummary: string | null; toolSummary: string | null; generatedAt: number }>`：读取环境变量 `MAS4S_LLM_BASE_URL`、`MAS4S_LLM_API_KEY`、`MAS4S_LLM_MODEL`，未配置时抛出 `LLM_NOT_CONFIGURED`；`textLines` 为空则 `textSummary=null`，`toolPairs` 为空则 `toolSummary=null`；两者均为空时抛出 `NO_MESSAGES_TO_SUMMARIZE`；分别发起 LLM 调用生成两段摘要
  - _需求：4.2、4.8_

- [ ] 5. 扩展 `bridge.ts`（`aiemas/src/gateway-bridge/bridge.ts`）
  - 在 `interceptMethod` 中，对 `chat.send` 方法在现有 `checkSessionAccess` 之后增加归档检查：调用 `sessionManager.isSessionArchived`，已归档则返回 `{ allowed: false, code: SESSION_ARCHIVED, message: "Session is archived" }`
  - 在 `_isSessionAccessMethod` 中新增 `session.archive`、`session.summary.generate`、`session.summary.get`
  - 新增 `archiveSession(params: { sessionKey, callerUserId, fetchHistory }): Promise<{ ok: true; archivedAt: number; summaryGenerated: boolean } | { ok: false; code: string; message: string }>`：校验权限、调用 `sessionManager.archiveSession`、自动触发 `generateSummary`（消息为空时 `summaryGenerated=false` 但归档仍成功）
  - 新增 `generateSummary(params: { sessionKey, callerUserId, fetchHistory }): Promise<...>`：
    - 未归档会话：校验调用者为 Session_Member（owner 或 participant），调用 `extractContentForSummary` + `generateSummaryWithLLM`，直接返回不写库
    - 已归档会话：校验调用者为 Session_Owner，调用 LLM，持久化并调用 `pushSummaryUpdated`
  - 新增 `getSummary(params: { sessionKey, callerUserId }): { ok: true; summary: SessionSummary | null } | { ok: false; code: string; message: string }`：校验成员权限，调用 `sessionManager.getSummary`
  - 新增 `pushSessionArchived(sessionKey, payload, connectedUsers, sendToClient): void`：向该会话所有在线成员推送 `event:session.archived`
  - 新增 `pushSummaryUpdated(sessionKey, payload, connectedUsers, sendToClient): void`：向该会话所有在线成员推送 `event:session.summary.updated`
  - 新增 `onSessionDeleted(sessionKey): void`：调用 `sessionManager.deleteSummary` 删除摘要记录，在 `mas4s-gateway-plugin.ts` 的 `sessions.delete` 钩子中调用
  - 扩展 `filterSessionsForUser`：对每条有 SessionMembership 的会话调用 `enrichSessionRow(db, session)`，附加 `archivedAt`（`session_ownership.archivedAt`，NULL 表示未归档）和 `hasSummary`（`session_summaries` 中是否存在该 sessionKey 的记录）两个字段
  - 实现 `enrichSessionRow(db, session)` 辅助函数：查询 `session_ownership.archivedAt` 和 `session_summaries` 是否存在记录，返回附加了这两个字段的会话对象
  - _需求：3.1、3.2、3.4、3.6、4.1、4.3、4.4、5.5_

  - [ ]\* 5.1 为归档后拒绝发送消息编写属性测试
    - **属性 5：归档后拒绝发送消息**
    - **验证：需求 3.4、3.5**
    - 在 `aiemas/src/gateway-bridge/session-collaboration.property.test.ts` 中新增测试：归档会话后，`interceptMethod("chat.send", ...)` 返回 `SESSION_ARCHIVED`；`interceptMethod("chat.history", ...)` 仍返回 `allowed: true`
    - 标签：`// Feature: mas4s-session-collaboration, Property 5: 归档后拒绝发送消息`

- [ ] 6. 扩展 `mas4s-gateway-plugin.ts`（`aiemas/src/gateway-bridge/mas4s-gateway-plugin.ts`）
  - 在 `extraHandlers` 中新增 `session.archive` 路由：提取 `callerUserId`，构造 `fetchHistory`（调用 gateway 的 `chat.history`），调用 `bridge.archiveSession`，成功后调用 `bridge.pushSessionArchived`
  - 新增 `session.summary.generate` 路由：提取 `callerUserId`，构造 `fetchHistory`，调用 `bridge.generateSummary`，已归档时调用 `bridge.pushSummaryUpdated`
  - 新增 `session.summary.get` 路由：提取 `callerUserId`，调用 `bridge.getSummary`
  - 在 `sessions.delete` 路由处理完成后调用 `bridge.onSessionDeleted(sessionKey)`，确保摘要记录同步清理
  - _需求：3.1、4.1、4.5、5.5_

- [ ] 7. 检查点 — 后端核心逻辑
  - 确保所有后端测试通过，向用户确认是否有疑问后继续。

- [ ] 8. 扩展前端类型与 AppStore
  - 在 `aiemas/ui/mas4s/src/types/session-types.ts` 的 `MasSession` 接口中新增 `archivedAt?: number | null` 和 `hasSummary?: boolean` 字段
  - 在 `aiemas/ui/mas4s/src/store/app-store.ts` 中新增：
    - 字段 `summaryBySession: Map<string, SessionSummary> = new Map()`（需从 `models.ts` 导入 `SessionSummary` 类型，或在前端定义等价类型）
    - 方法 `updateSessionArchived(sessionKey: string, archivedAt: number): void`：更新 `sessions` 中对应会话的 `archivedAt` 字段并调用 `notify()`
    - 方法 `setSummary(sessionKey: string, summary: SessionSummary): void`：写入 `summaryBySession` 并调用 `notify()`
    - 方法 `getSummary(sessionKey: string): SessionSummary | undefined`：从 `summaryBySession` 读取
  - _需求：3.7、3.8、4.10_

- [ ] 9. 扩展前端事件处理（`aiemas/ui/mas4s/src/gateway/event-handler.ts`）
  - 在 `registerEventHandlers` 的 switch 中新增 `session.archived` 分支：解构 `{ sessionKey, archivedAt }`，调用 `store.updateSessionArchived(sessionKey, archivedAt)`，打印 `console.info("会话已归档，无法继续发送消息")`
  - 新增 `session.summary.updated` 分支：解构 `{ sessionKey }`，调用 `store.notify()`（由组件监听后主动拉取摘要）
  - _需求：3.7、4.10_

- [ ] 10. 新增前端归档接口（新文件 `aiemas/ui/mas4s/src/gateway/session-archive.ts`）
  - 实现 `archiveSession(client, sessionKey): Promise<void>`：调用 `client.request("session.archive", { sessionKey })`，失败时抛出含错误码的 Error
  - 实现 `generateSummary(client, sessionKey): Promise<SessionSummary>`：调用 `client.request("session.summary.generate", { sessionKey })`，返回摘要对象
  - 实现 `getSummary(client, sessionKey): Promise<SessionSummary | null>`：调用 `client.request("session.summary.get", { sessionKey })`，返回 `summary` 字段
  - _需求：3.1、4.1、4.5_

- [ ] 10.1 前端会话列表摘要初始化
  - 在 `aiemas/ui/mas4s/src/gateway/session-manager.ts` 的 `fetchSessions`（或 session-controller 加载会话列表的入口）中，加载会话列表后遍历结果：对 `hasSummary=true` 的会话批量调用 `getSummary(client, session.key)`，将返回的摘要写入 `AppStore.summaryBySession`（调用 `store.setSummary`）
  - 批量调用可并发执行（`Promise.all`），单条失败不影响其他会话
  - _需求：4.10_

- [ ] 11. 更新 SessionSidebar 归档标识（`aiemas/ui/mas4s/src/components/session-sidebar.ts`）
  - 在 `_renderSession` 方法中，当 `session.archivedAt` 不为 null/undefined 时，在会话标签前显示归档图标（📦）
  - 为已归档会话添加 CSS 样式（灰色文字 `color: #94a3b8`，`font-style: italic`），区别于活跃会话
  - _需求：3.8_

- [ ] 12. 更新 ChatView 输入框禁用逻辑（`aiemas/ui/mas4s/src/views/chat-view.ts`）
  - 当 `this.session?.archivedAt` 不为 null/undefined 时，将输入框 `textarea` 的 `?disabled` 属性设为 `true`
  - 输入框 `placeholder` 在归档状态下变为"会话已归档，无法发送消息"
  - 发送按钮同步禁用
  - _需求：3.7_

- [ ] 13. 新增 SummaryPanel 组件（新文件 `aiemas/ui/mas4s/src/components/summary-panel.ts`）
  - 创建 `<summary-panel>` LitElement 组件，接受 `session: MasSession`、`summary: SessionSummary | undefined`、`isOwner: boolean` 属性
  - 渲染"生成摘要"按钮（未归档会话所有 Session_Member 均可见；已归档会话仅 Session_Owner 可见，点击调用 `generateSummary` 接口）
  - 摘要内容区域分两个子区域：**对话摘要**（`textSummary`，为 null 时显示"暂无对话内容"）和**工具调用摘要**（`toolSummary`，为 null 时显示"暂无工具调用"）
  - 显示 `generatedAt` 时间戳（格式化为本地时间字符串）
  - 未归档会话：摘要结果仅在当前客户端展示（写入 `store.setSummary`），不持久化
  - 已归档会话：收到 `session.summary.updated` 事件后自动调用 `getSummary` 刷新
  - _需求：4.9、4.10_

- [ ] 14. 检查点 — 前端集成
  - 确保所有前端类型检查通过，向用户确认是否有疑问后继续。

- [ ] 15. 编写属性测试文件（`aiemas/src/gateway-bridge/session-collaboration.property.test.ts`）
  - 创建测试文件，导入 fast-check、`initDatabase`、`ensureMas4sSchema`、`session-manager` 函数，在 `beforeEach` 中使用内存数据库（`:memory:`）并初始化 schema
  - [ ]\* 15.1 属性 1：邀请权限对称性
    - **属性 1：邀请权限对称性**
    - **验证：需求 1.1、1.2、1.5**
    - 使用 `fc.property` 生成随机 `sessionKey`、`ownerId`、`targetId`，断言成员调用 `inviteToSession` 成功，非成员调用抛出 `SESSION_ACCESS_DENIED`
    - 标签：`// Feature: mas4s-session-collaboration, Property 1: 邀请权限对称性`

  - [ ]\* 15.2 属性 2：邀请成员增长不变量
    - **属性 2：邀请成员增长不变量**
    - **验证：需求 1.2、1.6**
    - 断言成功邀请后 `listSessionMembers` 长度恰好增加 1；重复邀请同一用户抛出 `ALREADY_MEMBER` 且长度不变
    - 标签：`// Feature: mas4s-session-collaboration, Property 2: 邀请成员增长不变量`

  - [ ]\* 15.3 属性 3：删除成员完整性
    - **属性 3：删除成员完整性**
    - **验证：需求 2.2、2.3**
    - 断言 owner 调用 `removeMember(participant)` 后，`listSessionMembers` 不包含该 participant，`listSessionsForUser(participant)` 不包含该 sessionKey
    - 标签：`// Feature: mas4s-session-collaboration, Property 3: 删除成员完整性`

  - [ ]\* 15.4 属性 4：owner 不可自行移除
    - **属性 4：owner 不可自行移除**
    - **验证：需求 2.6**
    - 断言 owner 调用 `removeMember(owner)` 抛出 `OWNER_CANNOT_LEAVE`，`session_memberships` 中 owner 记录仍存在
    - 标签：`// Feature: mas4s-session-collaboration, Property 4: owner 不可自行移除`

  - [ ]\* 15.5 属性 7b：归档自动触发摘要持久化
    - **属性 7b：归档自动触发摘要持久化**
    - **验证：需求 4.5**
    - 断言消息历史非空的会话归档后，`getSummary` 返回非 null 摘要记录
    - 标签：`// Feature: mas4s-session-collaboration, Property 7b: 归档自动触发摘要持久化`

  - [ ]\* 15.6 属性 8：摘要权限隔离
    - **属性 8：摘要权限隔离**
    - **验证：需求 4.6、4.7**
    - 断言非成员调用 `getSummary`/`generateSummary` 返回 `SESSION_ACCESS_DENIED`；participant 调用 `getSummary` 成功
    - 标签：`// Feature: mas4s-session-collaboration, Property 8: 摘要权限隔离`

- [ ] 16. 最终检查点 — 确保所有测试通过
  - 确保所有测试通过，向用户确认是否有疑问后继续。

## 备注

- 标有 `*` 的子任务为可选测试任务，可跳过以加快 MVP 交付
- 每个任务引用了具体需求条款以保证可追溯性
- 属性测试使用 fast-check，每个属性最少运行 100 次迭代（`{ numRuns: 100 }`）
- 后端测试使用内存 SQLite（`:memory:`）以保证隔离性和速度
- 任务 3、5 中的属性测试子任务可在创建测试文件（任务 15）时统一实现，也可在对应实现任务完成后立即实现
