# 需求文档：mas4s 会话协作管理

## 简介

本 spec 针对 mas4s 多智能体协作平台的会话协作场景，重新设计会话邀请与成员管理、会话归档、会话摘要三项核心功能。

背景：原 `mas4s-multi-tenant-rbac` spec 需求 5（会话邀请与成员管理）的实现已有较大修改，原方案不再满足当前需求。本 spec 在现有后端实现（`aiemas/src/gateway-bridge/session-manager.ts`、`aiemas/src/gateway-bridge/bridge.ts`、`aiemas/src/store/database.ts`）和前端实现（`aiemas/ui/mas4s/src/gateway/session-invite.ts`、`aiemas/ui/mas4s/src/components/invite-dialog.ts`）的基础上，明确新的功能边界与接口契约。

架构约束：尽量少改动原 gateway（`src/gateway/`），新增功能在 `aiemas/src` 中实现。使用 SQLite（`~/.openclaw/aiemas/mas4s.db`）持久化。

---

## 词汇表

- **Session_Collaboration_Service**：`aiemas/src/gateway-bridge/` 中负责会话协作管理的服务模块，包含邀请、成员管理、归档、摘要等能力
- **GatewayAuthBridge**：`aiemas/src/gateway-bridge/bridge.ts` 中的薄适配层，将 WebSocket 请求路由到 Session_Collaboration_Service
- **SessionMembership**：会话成员记录，存储于 SQLite `session_memberships` 表，包含 `sessionKey`、`userId`、`role`（`"owner"` | `"participant"`）、`joinedAt` 字段
- **Session_Owner**：会话创建者，在 `session_memberships` 中 `role="owner"` 的用户
- **Session_Participant**：会话协作者，在 `session_memberships` 中 `role="participant"` 的用户
- **Session_Member**：Session_Owner 或 Session_Participant 的统称
- **SessionArchive**：会话归档状态，存储于 `session_ownership` 表的 `archivedAt` 字段（INTEGER，NULL 表示未归档，非 NULL 表示归档时间戳）
- **SessionSummary**：会话摘要，存储于 `session_summaries` 表，包含 `sessionKey`、`content`、`generatedAt`、`generatedBy` 字段
- **AppStore**：前端全局响应式状态单例（`aiemas/ui/mas4s/src/store/app-store.ts`）
- **MasSession**：前端会话类型（`aiemas/ui/mas4s/src/types/session-types.ts`），含 `masType`（`"initiated"` | `"participated"`）字段
- **InviteDialog**：前端邀请对话框组件（`aiemas/ui/mas4s/src/components/invite-dialog.ts`）

---

## 需求

### 需求 1：会话邀请（成员均可邀请）

**用户故事：** 作为会话创建者或协作者，我希望能邀请其他用户加入我的会话（类似群聊邀请，邀请即自动加入），以便进行多人协作。

#### 验收标准

1. THE Session_Collaboration_Service SHALL 提供 `session.invite` 接口，接受 `sessionKey`、`targetUserId` 参数，Session_Owner 和 Session_Participant 均可调用
2. WHEN `session.invite` 被调用且调用者是 Session_Member，THE Session_Collaboration_Service SHALL 立即在 `session_memberships` 表中创建目标用户的成员记录（`role="participant"`、`joinedAt` 为当前时间戳），被邀人无需确认即自动加入
3. WHEN `session.invite` 成功，THE GatewayAuthBridge SHALL 向被邀人所有已连接的 WebSocket 客户端推送 `event:session.joined` 事件，payload 包含 `{ sessionKey, label, invitedBy, joinedAt }`
4. WHEN 被邀人当前不在线，THE Session_Collaboration_Service SHALL 确保被邀人下次调用 `sessions.list` 时返回包含该会话的列表（因 SessionMembership 已持久化到 SQLite）
5. WHEN 非 Session_Member 调用 `session.invite`，THE Session_Collaboration_Service SHALL 返回错误码 `SESSION_ACCESS_DENIED`
6. WHEN `targetUserId` 已是 Session_Member，THE Session_Collaboration_Service SHALL 返回错误码 `ALREADY_MEMBER`，不重复创建 SessionMembership 记录
7. WHEN 前端收到 `event:session.joined` 事件，THE AppStore SHALL 将该会话添加到本地会话列表并标记 `masType="participated"`，同时显示通知提示（如 Toast："您已被邀请加入会话 {label}"）
8. THE InviteDialog SHALL 提供用户搜索输入框，调用 `user.list` 接口获取同租户内可邀请的用户列表，并在选择后调用 `session.invite`

---

### 需求 2：删除协作者（仅 Session_Owner 可操作）

**用户故事：** 作为会话创建者，我希望能删除协作者，以便管理会话成员。

#### 验收标准

1. THE Session_Collaboration_Service SHALL 提供 `session.removeMember` 接口，接受 `sessionKey`、`targetUserId` 参数，仅 Session_Owner 可调用
2. WHEN `session.removeMember` 被调用且调用者是 Session_Owner，THE Session_Collaboration_Service SHALL 删除目标用户在 `session_memberships` 表中的记录
3. WHEN `session.removeMember` 成功，THE GatewayAuthBridge SHALL 向被移除用户所有已连接的 WebSocket 客户端推送 `event:session.removed` 事件，payload 包含 `{ sessionKey, removedBy }`
4. WHEN 前端收到 `event:session.removed` 事件，THE AppStore SHALL 从本地会话列表中移除该会话，并显示通知提示（如 Toast："您已被移出会话 {label}"）
5. WHEN 非 Session_Owner 调用 `session.removeMember`，THE Session_Collaboration_Service SHALL 返回错误码 `SESSION_ACCESS_DENIED`
6. WHEN Session_Owner 尝试通过 `session.removeMember` 移除自己，THE Session_Collaboration_Service SHALL 返回错误码 `OWNER_CANNOT_LEAVE`
7. WHEN `targetUserId` 不是 Session_Member，THE Session_Collaboration_Service SHALL 返回错误码 `NOT_A_MEMBER`

---

### 需求 3：会话归档与启用（仅 Session_Owner 可操作）

**用户故事：** 作为会话创建者，我希望能归档会话，归档后不支持继续对话；也希望能重新启用已归档的会话，启用后可继续对话，以便灵活管理协作会话的生命周期。

#### 验收标准

1. THE Session_Collaboration_Service SHALL 提供 `session.archive` 接口，接受 `sessionKey` 参数，仅 Session_Owner 可调用
2. WHEN `session.archive` 被调用且调用者是 Session_Owner，THE Session_Collaboration_Service SHALL 在 `session_ownership` 表中将该会话的 `archivedAt` 字段更新为当前时间戳
3. WHEN 非 Session_Owner 调用 `session.archive`，THE Session_Collaboration_Service SHALL 返回错误码 `SESSION_ACCESS_DENIED`
4. WHEN 会话已归档（`archivedAt` 不为 NULL），THE Session_Collaboration_Service SHALL 在 `chat.send` 请求时返回错误码 `SESSION_ARCHIVED`，拒绝继续对话
5. WHEN 会话已归档，THE Session_Collaboration_Service SHALL 仍允许 Session_Member 调用 `chat.history`、`session.members`、`session.summary.get` 等只读接口
6. WHEN `session.archive` 成功，THE GatewayAuthBridge SHALL 向该会话所有已连接的 Session_Member 推送 `event:session.archived` 事件，payload 包含 `{ sessionKey, archivedAt, archivedBy }`
7. WHEN 前端收到 `event:session.archived` 事件，THE AppStore SHALL 更新本地会话的归档状态，前端消息输入框应立即变为禁用状态，placeholder 显示"会话已归档，无法发送消息"，发送按钮同步禁用
8. WHEN `sessions.list` 返回会话列表，THE Session_Collaboration_Service SHALL 在每条会话记录中附加 `archivedAt` 字段（NULL 或时间戳）和 `hasSummary` 字段（boolean，表示是否已有持久化摘要），前端据此渲染归档标识并初始化摘要显示状态
9. WHEN 前端加载会话列表且某会话的 `hasSummary` 为 `true`，THE Frontend SHALL 自动调用 `session.summary.get` 获取摘要内容，并在会话底部显示摘要区域
10. THE Session_Collaboration_Service SHALL 提供 `session.unarchive` 接口，接受 `sessionKey` 参数，仅 Session_Owner 可调用
11. WHEN `session.unarchive` 被调用且调用者是 Session_Owner，THE Session_Collaboration_Service SHALL 将 `session_ownership` 表中该会话的 `archivedAt` 字段重置为 NULL，会话恢复为活跃状态
12. WHEN 非 Session_Owner 调用 `session.unarchive`，THE Session_Collaboration_Service SHALL 返回错误码 `SESSION_ACCESS_DENIED`
13. WHEN `session.unarchive` 成功，THE GatewayAuthBridge SHALL 向该会话所有已连接的 Session_Member 推送 `event:session.unarchived` 事件，payload 包含 `{ sessionKey, unarchivedBy }`
14. WHEN 前端收到 `event:session.unarchived` 事件，THE AppStore SHALL 将本地会话的 `archivedAt` 重置为 `null`，消息输入框恢复为可用状态，Session_Member 可继续发送消息

---

### 需求 4：会话摘要生成与查看

**用户故事：** 作为会话创建者或协作者，我希望能随时生成会话摘要以便整体了解会话内容；作为会话创建者，归档会话时系统自动生成并持久化摘要，以便后续便捷查看。

#### 验收标准

1. THE Session_Collaboration_Service SHALL 提供 `session.summary.generate` 接口，接受 `sessionKey` 参数；未归档会话时 Session_Owner 和 Session_Participant 均可调用；已归档会话时仅 Session_Owner 可调用
2. WHEN `session.summary.generate` 被调用，THE Session_Collaboration_Service SHALL 读取该会话的消息历史，调用 LLM 分别生成文本摘要（`textSummary`）和工具调用摘要（`toolSummary`），并将结果直接返回给调用方
3. WHEN 会话**未归档**时调用 `session.summary.generate`，THE Session_Collaboration_Service SHALL 仅返回摘要内容，**不持久化**到数据库
4. WHEN 会话**已归档**时调用 `session.summary.generate`，THE Session_Collaboration_Service SHALL 将摘要内容持久化到 `session_summaries` 表（若已存在则覆盖更新），并向该会话所有已连接的 Session_Member 推送 `event:session.summary.updated` 事件
5. WHEN `session.archive` 被成功调用，THE Session_Collaboration_Service SHALL 自动触发摘要生成流程，将生成的摘要持久化到 `session_summaries` 表，并推送 `event:session.summary.updated` 事件
6. THE Session_Collaboration_Service SHALL 提供 `session.summary.get` 接口，接受 `sessionKey` 参数，Session_Member 均可调用，返回已持久化的最新摘要（`textSummary`、`toolSummary`、`generatedAt`、`generatedBy`）或 `null`（尚无持久化摘要）
7. WHEN 非 Session_Member 调用 `session.summary.get` 或 `session.summary.generate`，THE Session_Collaboration_Service SHALL 返回错误码 `SESSION_ACCESS_DENIED`
8. WHEN 已归档会话的非 Session_Owner 调用 `session.summary.generate`，THE Session_Collaboration_Service SHALL 返回错误码 `SESSION_ACCESS_DENIED`
9. WHEN 消息历史为空（会话无任何有效消息），THE Session_Collaboration_Service SHALL 在 `session.summary.generate` 时返回错误码 `NO_MESSAGES_TO_SUMMARIZE`
10. THE Frontend SHALL 在会话详情区域为所有 Session_Member 提供"生成摘要"按钮（已归档会话仅 Session_Owner 可见），点击后展示摘要内容（不持久化时仅在当前客户端展示，不推送给其他成员）
11. WHEN 前端收到 `event:session.summary.updated` 事件（归档触发的持久化摘要），THE AppStore SHALL 自动刷新当前会话的摘要内容，所有在线成员均可看到

---

### 需求 5：数据库 Schema 扩展

**用户故事：** 作为开发者，我希望数据库 schema 支持归档状态和摘要存储，以便持久化新功能所需的数据，并在会话删除时自动清理关联数据。

#### 验收标准

1. THE Session_Collaboration_Service SHALL 在 `session_ownership` 表中增加 `archivedAt INTEGER` 字段（默认 NULL），用于记录会话归档时间戳；若该字段已存在则跳过（幂等迁移）
2. THE Session_Collaboration_Service SHALL 在数据库中创建 `session_summaries` 表：`sessionKey TEXT PRIMARY KEY`、`textSummary TEXT`、`toolSummary TEXT`、`generatedAt INTEGER NOT NULL`、`generatedBy TEXT NOT NULL`；若该表已存在则跳过（幂等迁移）
3. THE Session_Collaboration_Service SHALL 在 `aiemas/src/store/database.ts` 的 `ensureMas4sSchema` 函数中完成上述 schema 迁移，确保服务启动时自动执行
4. THE Session_Collaboration_Service SHALL 使用 SQLite 事务保证 `session_ownership` 的 `archivedAt` 更新与 `session_summaries` 的写入操作的原子性
5. WHEN 会话通过 `sessions.delete` 被删除，THE GatewayAuthBridge SHALL 同步删除该会话在 `session_summaries` 表中的摘要记录（若存在）

---

## 正确性属性

_属性是在系统所有有效执行中应保持为真的特征或行为——本质上是关于系统应做什么的形式化陈述。_

### 属性 1：邀请权限对称性

_对于任意_ 会话 S 和用户 U，当 U 是 S 的 Session_Member（无论 owner 还是 participant）时，`session.invite` 应成功；当 U 不是 S 的 Session_Member 时，`session.invite` 应返回 `SESSION_ACCESS_DENIED`。

**验证：需求 1.1、1.2、1.5**

---

### 属性 2：邀请成员增长不变量

_对于任意_ 会话 S，成功调用 `session.invite(targetUserId)` 后，`session.members` 返回的列表长度应恰好增加 1，且列表中包含 `targetUserId`；若 `targetUserId` 已是成员，列表长度不变，接口返回 `ALREADY_MEMBER`。

**验证：需求 1.2、1.6**

---

### 属性 3：删除成员完整性

_对于任意_ 会话 S 的 Session_Owner A 和 Session_Participant B，A 调用 `session.removeMember(B)` 后，`session.members` 不包含 B，B 调用 `sessions.list` 不包含 S；若 B 在线，B 应收到 `event:session.removed` 推送。

**验证：需求 2.2、2.3**

---

### 属性 4：owner 不可自行移除

_对于任意_ 会话 S 的 Session_Owner U，U 调用 `session.removeMember(U)` 应返回 `OWNER_CANNOT_LEAVE`，`session_memberships` 中 U 的记录不应被删除。

**验证：需求 2.6**

---

### 属性 5：归档后拒绝发送消息

_对于任意_ 已归档会话 S（`archivedAt` 不为 NULL），任意 Session_Member 调用 `chat.send` 到 S 应返回 `SESSION_ARCHIVED`；调用 `chat.history` 应正常返回历史消息（只读操作不受归档影响）。

**验证：需求 3.4、3.5**

---

### 属性 6：归档幂等性

_对于任意_ 已归档会话 S，再次调用 `session.archive` 应成功（或返回已归档状态），`archivedAt` 字段值不应被更新为新的时间戳（保留首次归档时间）。

**验证：需求 3.2**

---

### 属性 7：摘要持久化条件

_对于任意_ 会话 S，当 S **未归档**时调用 `session.summary.generate`，摘要内容应直接返回给调用方，`session_summaries` 表中不应存在 S 的记录；当 S **已归档**时调用 `session.summary.generate`，摘要内容应同时持久化到 `session_summaries` 表，`session.summary.get` 应返回等价内容。

**验证：需求 4.3、4.4、4.6**

---

### 属性 8：摘要权限隔离

_对于任意_ 非 Session_Member 用户 U，U 调用 `session.summary.get` 或 `session.summary.generate` 均应返回 `SESSION_ACCESS_DENIED`；未归档会话的 Session_Participant 调用 `session.summary.generate` 应成功（返回摘要但不持久化）；已归档会话的 Session_Participant 调用 `session.summary.generate` 应返回 `SESSION_ACCESS_DENIED`。

**验证：需求 4.1、4.7、4.8**

---

### 属性 8：摘要权限隔离

_对于任意_ 非 Session_Member 用户 U，U 调用 `session.summary.get` 或 `session.summary.generate` 均应返回 `SESSION_ACCESS_DENIED`；非 Session_Owner 的 Session_Participant 调用 `session.summary.generate` 应返回 `SESSION_ACCESS_DENIED`，但调用 `session.summary.get` 应成功。

**验证：需求 4.6、4.7**

---

### 属性 9：Schema 迁移幂等性

_对于任意_ 已包含 `archivedAt` 字段的 `session_ownership` 表或已存在的 `session_summaries` 表，重复调用 `ensureMas4sSchema` 不应抛出错误，数据库状态应保持不变。

**验证：需求 5.1、5.2、5.3**

---

### 属性 10：归档与启用互逆性

_对于任意_ 会话 S，调用 `session.archive` 后 `archivedAt` 不为 NULL；随后调用 `session.unarchive` 后 `archivedAt` 应重置为 NULL，`chat.send` 应恢复正常（不再返回 `SESSION_ARCHIVED`）。

**验证：需求 3.11、3.14**
