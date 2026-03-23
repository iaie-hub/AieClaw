# 需求文档：mas4s 多租户与角色权限控制

## 简介

当前 mas4s 多智能体协作平台没有用户概念，所有连接共享同一个 gateway 实例，会话对所有连接可见，配置信息无权限控制。本文档定义多租户（Multi-Tenant）和基于角色的访问控制（RBAC）功能需求，实现用户注册/登录、会话隔离、邀请加入、角色权限管理等能力。

关键架构约束：尽量少改动原 gateway（`AieClaw/src/gateway/`），新增功能在 `aiemas/src` 中实现。原 gateway 作为 WebSocket 入口，调用 `aiemas/src` 中的多租户服务。

本 spec 与已有 `mas4s-multi-agent-platform` spec 互补：已有 spec 定义前端 UI 组件和多人会话交互，本 spec 聚焦后端多租户身份认证、会话归属隔离和角色权限控制。

---

## 词汇表

- **TenantService**：`aiemas/src` 中的多租户核心服务模块，负责用户管理、认证、会话归属和权限校验
- **User**：系统中的注册用户实体，包含 `userId`、`username`、`displayName`、`passwordHash`、`role`、`tenantId`、`status`、`createdAt` 字段
- **UserStatus**：用户状态，取值为 `"pending"` | `"approved"` | `"rejected"`；pending 为自注册待审批状态，approved 为审批通过可登录状态，rejected 为审批拒绝状态
- **Tenant**：租户实体，代表一个独立的组织或工作空间，包含 `tenantId`、`name`、`createdAt` 字段；同一租户下的用户共享该租户的资源
- **Role**：用户角色，取值为 `"admin"` | `"member"` | `"viewer"`；admin 拥有全部权限，member 可创建和参与会话，viewer 仅可查看已加入的会话
- **SessionOwnership**：会话归属记录，将 sessionKey 与创建者 userId 和 tenantId 关联
- **SessionMembership**：会话成员记录，记录哪些用户被授权访问某个会话，包含 `sessionKey`、`userId`、`role`（会话级角色：`"owner"` | `"participant"`）、`joinedAt` 字段
- **AuthToken**：用户登录后颁发的 JWT 令牌，包含 `userId`、`tenantId`、`role`、`exp` 声明
- **GatewayAuthBridge**：在原 gateway 中新增的薄适配层，将 WebSocket 连接的认证请求转发给 TenantService
- **AppStore**：前端全局响应式状态单例（已有，需扩展 `currentUser` 字段）
- **LoginView**：前端用户登录/注册视图组件
- **SessionFilter**：前端会话列表过滤逻辑，仅显示当前用户创建或加入的会话

---

## 需求

### 需求 1：用户注册与管理

**用户故事：** 作为平台管理员，我希望能够注册和管理用户账号，支持用户自注册但需审批通过后才能登录，以便不同用户拥有独立的身份标识且受控接入。

#### 验收标准

1. THE TenantService SHALL 提供 `user.register` 接口，接受 `username`、`password`、`displayName`、`tenantId`（可选）参数，创建新用户并返回 User 对象（不含 passwordHash）
2. WHEN `username` 已被同一 tenantId 下的其他用户占用，THE TenantService SHALL 返回错误码 `USERNAME_TAKEN` 和描述信息
3. THE TenantService SHALL 使用 bcrypt（cost factor 不低于 10）对用户密码进行哈希存储，密码明文不得持久化
4. WHEN 未指定 `tenantId`，THE TenantService SHALL 创建一个新的 Tenant 并将该用户设为该 Tenant 的 admin 角色
5. THE TenantService SHALL 提供 `user.list` 接口，返回指定 tenantId 下的用户列表，所有已认证用户均可调用（以支持邀请用户加入会话时的用户搜索）；admin 调用时返回所有用户（含 `status` 字段）；member/viewer 调用时仅返回 `status="approved"` 的用户（不含 `status` 字段）
6. THE TenantService SHALL 提供 `user.update` 接口，允许 admin 修改用户的 `displayName` 和 `role` 字段
7. THE TenantService SHALL 提供 `system.status` 接口（无需认证），返回 `{ initialized: boolean }`，其中 `initialized` 为 `true` 当且仅当数据库中存在至少一个用户
8. WHEN 系统未初始化（`initialized=false`），THE TenantService SHALL 允许通过 `user.register` 创建第一个用户，该用户的 `username` 必须为 `"admin"`，角色自动设为 `admin`，`status` 自动设为 `"approved"`，同时自动创建默认 Tenant
9. WHEN 系统已初始化（`initialized=true`），用户可自行调用 `user.register` 注册新账号（无需认证），新用户的 `status` 设为 `"pending"`，`role` 默认为 `"member"`
10. THE TenantService SHALL 提供 `user.approve` 接口，接受 `targetUserId` 参数，仅 admin 角色可调用，将目标用户的 `status` 从 `"pending"` 改为 `"approved"`
11. THE TenantService SHALL 提供 `user.reject` 接口，接受 `targetUserId` 参数，仅 admin 角色可调用，将目标用户的 `status` 从 `"pending"` 改为 `"rejected"`
12. WHEN admin 通过 `user.register` 创建用户（admin 已认证调用），THE TenantService SHALL 将新用户的 `status` 直接设为 `"approved"`（跳过审批）

---

### 需求 2：用户登录与令牌认证

**用户故事：** 作为用户，我希望通过用户名和密码登录系统，审批通过后才能获得访问权限。

#### 验收标准

1. THE TenantService SHALL 提供 `auth.login` 接口，接受 `username`、`password`、`tenantId`（可选）参数，验证凭据后返回 AuthToken（JWT 格式）
2. WHEN 用户名不存在或密码不匹配，THE TenantService SHALL 返回统一的错误码 `AUTH_FAILED`，不区分"用户不存在"和"密码错误"
3. THE AuthToken SHALL 包含 `userId`、`tenantId`、`role`、`iat`、`exp` 声明，默认有效期为 24 小时
4. THE TenantService SHALL 提供 `auth.refresh` 接口，接受有效的 AuthToken，返回新的 AuthToken（续期）
5. THE TenantService SHALL 提供 `auth.verify` 接口，接受 AuthToken 字符串，返回解码后的用户身份信息（userId、tenantId、role）或验证失败错误
6. WHEN AuthToken 已过期，THE TenantService SHALL 在 `auth.verify` 时返回错误码 `TOKEN_EXPIRED`
7. THE TenantService SHALL 使用 HMAC-SHA256 签名算法和可配置的密钥（`MAS4S_JWT_SECRET` 环境变量或配置文件）签发和验证 AuthToken
8. WHEN 用户 `status` 为 `"pending"`，THE TenantService SHALL 在 `auth.login` 时返回错误码 `ACCOUNT_PENDING_APPROVAL`，提示"账号正在等待管理员审批"
9. WHEN 用户 `status` 为 `"rejected"`，THE TenantService SHALL 在 `auth.login` 时返回错误码 `ACCOUNT_REJECTED`，提示"账号注册申请已被拒绝"

---

### 需求 3：Gateway 认证桥接

**用户故事：** 作为开发者，我希望原 gateway 能识别多租户用户身份，并通过桥接层管理用户级会话生命周期，以便在不大幅修改 gateway 的前提下实现用户级访问控制和会话隔离。

#### 验收标准

1. THE GatewayAuthBridge SHALL 在 WebSocket `connect` 请求中识别 `auth.masToken` 字段（与现有 `auth.token` 并存）
2. WHEN `connect` 请求包含 `auth.masToken`，THE GatewayAuthBridge SHALL 调用 TenantService 的 `auth.verify` 验证令牌，并将解码后的 `userId`、`tenantId`、`role` 附加到连接上下文
3. WHEN `auth.masToken` 验证失败，THE GatewayAuthBridge SHALL 返回 `connect` 错误响应，错误码为 `MAS_AUTH_FAILED`
4. WHEN `connect` 请求不包含 `auth.masToken`，THE GatewayAuthBridge SHALL 回退到原有的 token/password 认证流程，连接上下文中 `userId` 为 `null`（兼容无多租户场景）
5. THE GatewayAuthBridge SHALL 作为独立模块实现于 `aiemas/src/gateway-bridge/` 目录，原 gateway 仅在关键流程中增加桥接调用
6. THE GatewayAuthBridge SHALL 维护用户级会话管理：原 gateway 在执行 `sessions.create` 时调用 bridge 的 `onSessionCreated` 钩子记录会话归属；在执行 `sessions.list` 时调用 bridge 的 `filterSessionsForUser` 钩子过滤结果；在执行 `sessions.resolve`、`chat.send` 时调用 bridge 的 `checkSessionAccess` 钩子校验访问权限
7. THE GatewayAuthBridge SHALL 使用 SQLite 持久化会话归属（SessionOwnership）和会话成员（SessionMembership）数据，与 TenantService 共享同一个 SQLite 数据库文件（`~/.openclaw/aiemas/mas4s.db`）

---

### 需求 4：会话归属与隔离

**用户故事：** 作为用户，我希望只能看到自己创建和加入的会话，以便不同用户的工作空间相互隔离。

#### 验收标准

1. WHEN 用户通过 `sessions.create` 创建会话，原 gateway 完成会话创建后 SHALL 调用 GatewayAuthBridge 的 `onSessionCreated` 钩子，由 bridge 记录 SessionOwnership（sessionKey、userId、tenantId）和 SessionMembership（sessionKey、userId、role="owner"）到 SQLite
2. WHEN 用户通过 `sessions.list` 查询会话列表，原 gateway 获取全量会话后 SHALL 调用 GatewayAuthBridge 的 `filterSessionsForUser` 钩子，由 bridge 根据 SessionMembership 过滤仅返回当前用户有权访问的会话
3. WHEN 用户通过 `sessions.resolve` 查询会话，原 gateway SHALL 调用 GatewayAuthBridge 的 `checkSessionAccess` 钩子，由 bridge 验证当前用户拥有该会话的 SessionMembership，无权限时返回错误码 `SESSION_ACCESS_DENIED`
4. WHEN 用户通过 `chat.send` 发送消息，原 gateway SHALL 调用 GatewayAuthBridge 的 `checkSessionAccess` 钩子，由 bridge 验证当前用户拥有目标会话的 SessionMembership，无权限时返回错误码 `SESSION_ACCESS_DENIED`
5. THE GatewayAuthBridge SHALL 将 SessionOwnership 和 SessionMembership 数据持久化到 SQLite 数据库（`~/.openclaw/aiemas/mas4s.db`）
6. WHEN 连接上下文中 `userId` 为 `null`（兼容模式），THE GatewayAuthBridge SHALL 跳过会话归属校验，保持原有行为（所有会话可见）

---

### 需求 5：会话邀请与成员管理

**用户故事：** 作为会话创建者，我希望能邀请其他用户加入我的会话（类似群聊邀请，邀请即自动加入），以便进行多人协作。

#### 验收标准

1. THE GatewayAuthBridge SHALL 提供 `session.invite` 接口，接受 `sessionKey`、`targetUserId` 参数，会话成员（owner 和 participant）均可调用
2. WHEN `session.invite` 被调用，THE GatewayAuthBridge SHALL 立即创建 SessionMembership 记录（sessionKey、targetUserId、role="participant"、joinedAt）到 SQLite，被邀人无需确认即自动加入会话
3. WHEN 非会话成员调用 `session.invite`，THE GatewayAuthBridge SHALL 返回错误码 `SESSION_ACCESS_DENIED`
4. WHEN `session.invite` 成功，THE GatewayAuthBridge SHALL 向被邀人所有已连接的 WebSocket 客户端推送 `event:session.joined` 事件，payload 包含 `{ sessionKey, label, invitedBy, joinedAt }`，使被邀人实时看到新加入的会话
5. WHEN 被邀人当前不在线，THE System SHALL 在被邀人下次连接并调用 `sessions.list` 时返回包含该会话的列表（因 membership 已持久化到 SQLite）
6. THE GatewayAuthBridge SHALL 提供 `session.members` 接口，返回指定会话的所有成员列表（userId、displayName、role、joinedAt），仅会话成员可调用
7. THE GatewayAuthBridge SHALL 提供 `session.leave` 接口，允许 participant 角色的用户主动退出会话，删除对应的 SessionMembership 记录
8. IF owner 用户调用 `session.leave`，THEN THE GatewayAuthBridge SHALL 返回错误码 `OWNER_CANNOT_LEAVE`，提示需先转让 owner 角色
9. WHEN `targetUserId` 已是会话成员，THE GatewayAuthBridge SHALL 返回错误码 `ALREADY_MEMBER`，不重复创建 membership
10. THE GatewayAuthBridge SHALL 提供 `session.removeMember` 接口，接受 `sessionKey`、`targetUserId` 参数，仅会话 owner 可调用，删除目标用户的 SessionMembership 记录
11. WHEN `session.removeMember` 成功，THE GatewayAuthBridge SHALL 向被移除用户所有已连接的 WebSocket 客户端推送 `event:session.removed` 事件，payload 包含 `{ sessionKey, removedBy }`，前端收到后从会话列表中移除该会话
12. WHEN owner 尝试通过 `session.removeMember` 移除自己，THE GatewayAuthBridge SHALL 返回错误码 `OWNER_CANNOT_LEAVE`
13. WHEN `targetUserId` 不是会话成员，THE GatewayAuthBridge SHALL 返回错误码 `NOT_A_MEMBER`

---

### 需求 6：角色权限控制

**用户故事：** 作为平台管理员，我希望不同角色的用户拥有不同的操作权限，以便实现最小权限原则。

#### 验收标准

1. THE TenantService SHALL 定义三种全局角色权限：admin（用户管理 + 全部会话操作）、member（查询用户 + 创建会话 + 参与会话 + 发送消息）、viewer（查询用户 + 仅查看已加入会话的消息，不可发送）
2. WHEN viewer 角色用户调用 `chat.send`，THE TenantService SHALL 返回错误码 `PERMISSION_DENIED`
3. WHEN viewer 角色用户调用 `sessions.create`，THE TenantService SHALL 返回错误码 `PERMISSION_DENIED`
4. WHEN member 或 viewer 角色用户调用 `user.update`，THE TenantService SHALL 返回错误码 `PERMISSION_DENIED`
5. THE TenantService SHALL 定义两种会话级角色权限：owner（移除成员 + 审批操作 + 邀请成员 + 全部消息操作）、participant（邀请成员 + 发送消息 + 查看消息，不可移除成员或执行审批操作）
6. WHEN participant 角色用户调用 `exec.approval.resolve`，THE TenantService SHALL 返回错误码 `PERMISSION_DENIED`

---

### 需求 7：事件广播隔离

**用户故事：** 作为用户，我希望只收到与自己相关的会话事件，以便不被其他用户的活动干扰。

#### 验收标准

1. WHEN gateway 广播 `event:chat` 事件，THE GatewayAuthBridge SHALL 仅将事件发送给拥有该 sessionKey 的 SessionMembership 的已连接用户
2. WHEN gateway 广播 `event:agent` 事件，THE GatewayAuthBridge SHALL 仅将事件发送给拥有该 sessionKey 的 SessionMembership 的已连接用户
3. WHEN gateway 广播 `event:exec.approval.requested` 事件，THE GatewayAuthBridge SHALL 仅将事件发送给该会话的 owner 用户
4. WHEN 连接上下文中 `userId` 为 `null`（兼容模式），THE GatewayAuthBridge SHALL 保持原有广播行为（发送给所有有 scope 权限的连接）

---

### 需求 8：前端用户登录集成

**用户故事：** 作为用户，我希望在前端看到登录界面，以便使用用户名和密码登录系统。首次部署时，系统应引导我创建初始 admin 账号。

#### 验收标准

1. THE LoginView SHALL 提供用户名、密码输入框和"登录"按钮，以及"注册新账号"链接
2. WHEN 用户点击"登录"，THE LoginView SHALL 调用 TenantService 的 `auth.login` 接口，成功后将 AuthToken 存储到 `localStorage`（key: `mas4s_auth_token`）
3. WHEN 登录成功，THE AppStore SHALL 设置 `currentUser` 字段（包含 userId、username、displayName、role、tenantId）
4. WHEN 登录失败，THE LoginView SHALL 显示错误提示信息；特别地，WHEN 错误码为 `ACCOUNT_PENDING_APPROVAL`，SHALL 显示"您的账号正在等待管理员审批，请耐心等待"；WHEN 错误码为 `ACCOUNT_REJECTED`，SHALL 显示"您的注册申请已被拒绝，请联系管理员"
5. THE GatewayClient SHALL 在 `connect` 请求的 `auth` 字段中携带 `masToken`（从 `localStorage` 读取）
6. WHEN `localStorage` 中无 `mas4s_auth_token`，THE System SHALL 先调用 `system.status` 检查系统是否已初始化
7. WHEN `system.status` 返回 `initialized=false`，THE System SHALL 显示初始化引导视图（复用注册页面），用户名固定为 `"admin"` 且输入框禁用不可修改，用户仅需填写密码和显示名称，提交后调用 `user.register` 创建 admin 账号并自动登录
8. WHEN `system.status` 返回 `initialized=true` 且无 token，THE System SHALL 显示 LoginView
9. THE System SHALL 提供"退出登录"按钮，点击后清除 `localStorage` 中的 `mas4s_auth_token` 并重置 `AppStore.currentUser`，断开 WebSocket 连接并显示 LoginView
10. WHEN 用户自注册成功（非初始化、非 admin 创建），THE LoginView SHALL 显示"注册成功，请等待管理员审批后登录"提示，并切换回登录表单

---

### 需求 9：前端会话列表过滤

**用户故事：** 作为用户，我希望会话列表仅显示我创建和加入的会话，并在被邀请时实时看到新会话，以便快速找到相关工作。

#### 验收标准

1. WHEN 用户登录后加载会话列表，THE SessionFilter SHALL 调用 `sessions.list`（后端已按 SessionMembership 过滤），仅显示返回的会话
2. WHEN 用户创建新会话，THE AppStore SHALL 将新会话添加到本地列表，并标记 `masType="initiated"`
3. WHEN 前端收到 `event:session.joined` 事件（被他人邀请加入），THE EventHandler SHALL 将事件中的会话信息添加到 AppStore 会话列表，标记 `masType="participated"`，并显示通知提示（如 Toast："您已被邀请加入会话 {label}"）
4. THE SessionSidebar SHALL 在"发起的会话"分组显示 `masType="initiated"` 的会话，在"参与的会话"分组显示 `masType="participated"` 的会话
5. WHEN 用户发送消息，THE MessageFormatter SHALL 使用 `currentUser.displayName` 替代硬编码的"我"作为发送者名前缀
6. WHEN 前端收到 `event:session.removed` 事件（被 owner 移除），THE EventHandler SHALL 从 AppStore 会话列表中移除该会话，并显示通知提示（如 Toast："您已被移出会话 {label}"）

---

### 需求 10：数据持久化与存储

**用户故事：** 作为开发者，我希望多租户数据有可靠的持久化方案，以便系统重启后数据不丢失。

#### 验收标准

1. THE TenantService SHALL 使用 SQLite 数据库（`node:sqlite` 内置模块，与项目现有 `src/memory/` 模块保持一致）存储所有多租户数据，数据库文件位于 `~/.openclaw/aiemas/mas4s.db`
2. THE TenantService SHALL 在数据库中创建 `tenants` 表（tenantId TEXT PRIMARY KEY, name TEXT, createdAt INTEGER）
3. THE TenantService SHALL 在数据库中创建 `users` 表（userId TEXT PRIMARY KEY, username TEXT, displayName TEXT, passwordHash TEXT, role TEXT, tenantId TEXT FK, createdAt INTEGER），并在 (tenantId, username) 上创建 UNIQUE 索引
4. THE TenantService SHALL 在数据库中创建 `session_ownership` 表（sessionKey TEXT PRIMARY KEY, userId TEXT FK, tenantId TEXT FK, createdAt INTEGER）
5. THE TenantService SHALL 在数据库中创建 `session_memberships` 表（sessionKey TEXT, userId TEXT, role TEXT, joinedAt INTEGER, PRIMARY KEY (sessionKey, userId)）
6. THE TenantService SHALL 使用 SQLite 事务（BEGIN/COMMIT）保证多表写入的原子性，使用 WAL 模式和 busy_timeout 处理并发访问
7. THE TenantService SHALL 在启动时自动创建数据库文件和所需表结构（若不存在），复用项目现有的 `requireNodeSqlite()` 加载方式

---

### 需求 11：安全性约束

**用户故事：** 作为平台管理员，我希望系统具备基本的安全防护，以便防止未授权访问和常见攻击。

#### 验收标准

1. THE TenantService SHALL 对 `auth.login` 接口实施速率限制：同一 IP 地址每分钟最多 10 次失败尝试，超限后返回错误码 `RATE_LIMITED` 和 `retryAfterMs`
2. THE TenantService SHALL 对 AuthToken 的 JWT 密钥长度要求不低于 32 字节
3. THE TenantService SHALL 在所有权限校验失败时记录审计日志（userId、操作、目标资源、时间戳、结果）
4. THE TenantService SHALL 对用户密码强度进行基本校验：长度不低于 8 个字符
5. IF JWT 密钥未配置（`MAS4S_JWT_SECRET` 环境变量为空），THEN THE TenantService SHALL 在启动时生成随机密钥并输出警告日志，提示生产环境应配置固定密钥

---

## 正确性属性

_属性是在系统所有有效执行中应保持为真的特征或行为——本质上是关于系统应做什么的形式化陈述。_

### 属性 1：用户名租户内唯一性

_对于任意_ 租户 T 和用户名 U，在 T 下注册两个相同用户名 U 的用户，第二次注册应返回 `USERNAME_TAKEN` 错误，且 T 下仅存在一条 username=U 的 User 记录。

**验证：需求 1.2**

---

### 属性 2：密码安全不变量

_对于任意_ 注册请求中的密码 P（长度 ≥ 8），注册成功后持久化存储中不应包含 P 的明文，仅包含以 `$2b$` 开头的 bcrypt 哈希值；_对于任意_ 密码 P（长度 < 8），注册应被拒绝。

**验证：需求 1.3、11.4**

---

### 属性 3：AuthToken round-trip

_对于任意_ 有效的注册参数（username、password、displayName），执行 `register → login → verify` 链路后，`verify` 返回的 `userId`、`tenantId`、`role` 应与注册时创建的用户一致，且 token 的 JWT header 中 `alg` 为 `HS256`。

**验证：需求 2.1、2.3、2.5、2.7**

---

### 属性 4：过期令牌拒绝

_对于任意_ 已过期的 AuthToken（`exp < now`），`auth.verify` 应返回 `TOKEN_EXPIRED` 错误，不应返回有效的身份信息。

**验证：需求 2.6**

---

### 属性 5：认证错误不泄露信息

_对于任意_ 登录失败场景（用户名不存在或密码错误），`auth.login` 应返回相同的错误码 `AUTH_FAILED`，不应通过错误码、错误消息或响应时间差异区分失败原因。`ACCOUNT_PENDING_APPROVAL` 和 `ACCOUNT_REJECTED` 仅在凭据验证通过后根据 status 返回。

**验证：需求 2.2、2.8、2.9**

---

### 属性 6：会话隔离完备性

_对于任意_ 两个不同的已认证用户 A 和 B，若 B 没有会话 S 的 SessionMembership 记录，则：

- B 调用 `sessions.list` 的结果不应包含 S
- B 调用 `sessions.resolve(S)` 应返回 `SESSION_ACCESS_DENIED`
- B 调用 `chat.send` 到 S 应返回 `SESSION_ACCESS_DENIED`

**验证：需求 4.2、4.3、4.4**

---

### 属性 7：会话创建记录完整性

_对于任意_ 已认证用户 U 创建的会话 S，创建后应同时存在 SessionOwnership 记录（sessionKey=S, userId=U）和 SessionMembership 记录（sessionKey=S, userId=U, role="owner"）。

**验证：需求 4.1**

---

### 属性 8：会话邀请权限与成员增长

_对于任意_ 会话 S 和用户 U，当 U 是 S 的成员（owner 或 participant）时 `session.invite` 应成功；成功后被邀人立即成为会话成员（无需确认），`session.members` 返回的列表长度应增加 1 且包含被邀请用户；若被邀人在线，应收到 `event:session.joined` 推送。非成员调用应返回 `SESSION_ACCESS_DENIED`。已是成员时应返回 `ALREADY_MEMBER`。

**验证：需求 5.1、5.2、5.3、5.4、5.6、5.9**

---

### 属性 9：owner 不可自行退出

_对于任意_ 会话 S 的 owner 用户 U，调用 `session.leave` 应返回 `OWNER_CANNOT_LEAVE` 错误，SessionMembership 记录不应被删除。

**验证：需求 5.7、5.8**

---

### 属性 10：全局与会话级权限矩阵一致性

_对于任意_ 全局角色 R 和操作 M 的组合，权限校验结果应与以下矩阵一致：

- admin: user.list ✓, user.update ✓, sessions.create ✓, chat.send ✓
- member: user.list ✓, user.update ✗, sessions.create ✓, chat.send ✓
- viewer: user.list ✓, user.update ✗, sessions.create ✗, chat.send ✗

_对于任意_ 会话级角色 SR 和操作 M 的组合：

- owner: session.invite ✓, session.removeMember ✓, exec.approval.resolve ✓
- participant: session.invite ✓, session.removeMember ✗, exec.approval.resolve ✗

**验证：需求 6.1、6.2、6.3、6.4、6.5、6.6**

---

### 属性 11：事件广播隔离

_对于任意_ 会话事件（chat/agent）和已连接用户集合，事件仅应发送给拥有该 sessionKey 的 SessionMembership 的用户连接；`exec.approval.requested` 事件仅应发送给该会话的 owner 用户。

**验证：需求 7.1、7.2、7.3**

---

### 属性 12：兼容模式透明性

_对于任意_ 不携带 `masToken` 的连接（userId=null），系统行为应与多租户功能引入前完全一致：会话全部可见、事件全部广播、无权限校验。

**验证：需求 3.4、4.6、7.4**

---

### 属性 13：登录速率限制

_对于任意_ IP 地址，在 1 分钟窗口内连续 10 次登录失败后，第 11 次尝试应返回 `RATE_LIMITED` 错误和 `retryAfterMs` 值。

**验证：需求 11.1**

---

### 属性 14：权限失败审计日志

_对于任意_ 权限校验失败事件，审计日志中应包含一条记录，包含 userId、操作名、目标资源、时间戳和结果字段。

**验证：需求 11.3**

---

### 属性 15：数据持久化 round-trip

_对于任意_ 通过 TenantService 创建的用户、租户、会话归属和会话成员数据，关闭并重新打开 SQLite 数据库后读取应得到等价的数据。

**验证：需求 10.1、10.2、10.3、10.4**

---

### 属性 16：并发写入安全

_对于任意_ 两个并发的写入操作（如同时注册两个用户），SQLite WAL 模式和 busy_timeout 应确保数据不丢失、不损坏，最终状态包含两次写入的结果。

**验证：需求 10.6**

---

### 属性 17：消息发送者名替换

_对于任意_ 已登录用户 U（displayName=D），发送消息时构造的消息体前缀应为 `"D: "` 而非硬编码的 `"我: "`。

**验证：需求 9.5**

---

### 属性 18：会话类型标记

_对于任意_ 用户创建的会话，AppStore 中应标记 `masType="initiated"`；_对于任意_ 通过邀请加入的会话，应标记 `masType="participated"`。

**验证：需求 9.2、9.3**

---

### 属性 19：成员移除完整性

_对于任意_ 会话 S 的 owner 用户 A 和 participant 用户 B，A 调用 `session.removeMember(B)` 后，B 不再是会话成员，`session.members` 不包含 B，B 调用 `sessions.list` 不包含 S。若 B 在线，应收到 `event:session.removed` 推送。owner 移除自己应返回 `OWNER_CANNOT_LEAVE`，目标不是成员应返回 `NOT_A_MEMBER`。

**验证：需求 5.10、5.11、5.12、5.13**

---

### 需求 12：用户在线状态维护

**用户故事：** 作为用户，我希望系统能追踪用户的在线状态，以便在查看用户列表时了解哪些用户当前在线，方便协作决策。

#### 验收标准

1. THE TenantService SHALL 在数据库中创建 `user_presence` 表（userId TEXT PRIMARY KEY REFERENCES users(userId), lastSeenAt INTEGER NOT NULL, isOnline INTEGER NOT NULL DEFAULT 0），记录每个用户最后一次心跳时间和在线状态
2. THE TenantService SHALL 提供 `presence.update` 接口，接受有效的 AuthToken，将调用者在 `user_presence` 表中的 `lastSeenAt` 更新为当前时间戳并将 `isOnline` 设为 `1`；若该用户尚无 presence 记录则自动创建
3. THE TenantService SHALL 在 `auth.refresh` 接口（需求 2.4）成功续期时，同时调用 `presence.update` 逻辑更新该用户的在线状态
4. THE Frontend SHALL 在用户登录成功后，每隔 5 分钟自动调用一次 `auth.refresh` 接口刷新令牌，以维持在线状态并避免 token 过期
5. THE TenantService SHALL 提供后台定时任务（间隔不超过 1 分钟），扫描 `user_presence` 表，将 `lastSeenAt` 距当前时间超过 15 分钟的用户的 `isOnline` 设为 `0`（标记为离线）
6. WHEN `user.list` 接口被调用，THE TenantService SHALL 在返回的每个用户对象中附加 `isOnline` 字段（`boolean`），值来源于 `user_presence` 表；若该用户尚无 presence 记录，则 `isOnline` 默认为 `false`
7. WHEN admin 调用 `user.list`，THE TenantService SHALL 返回所有用户的 `isOnline` 状态；WHEN member/viewer 调用 `user.list`，THE TenantService SHALL 同样返回 `isOnline` 状态（仅限 `status="approved"` 的用户）
8. WHEN 用户主动退出登录（调用退出接口或前端清除 token），THE TenantService SHALL 立即将该用户的 `isOnline` 设为 `0`，`lastSeenAt` 更新为当前时间戳
9. THE Frontend SHALL 在用户列表 UI 中为每个用户显示在线状态指示器（如绿色圆点表示在线，灰色圆点表示离线）

---

## 正确性属性（续）

### 属性 20：在线状态超时一致性

_对于任意_ 用户 U，若 U 最后一次调用 `auth.refresh`（或 `presence.update`）的时间距当前超过 15 分钟，则 `user.list` 返回的 U 的 `isOnline` 字段应为 `false`；若 U 在 15 分钟内调用过 `auth.refresh`，则 `isOnline` 应为 `true`。

**验证：需求 12.3、12.5、12.6**

---

### 属性 21：退出登录即时离线

_对于任意_ 已登录用户 U，U 主动退出登录后，`user.list` 返回的 U 的 `isOnline` 字段应立即变为 `false`，不等待超时扫描。

**验证：需求 12.8**
