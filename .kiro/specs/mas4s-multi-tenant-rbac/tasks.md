# 实现计划：mas4s 多租户与角色权限控制

## 概述

按层级自底向上实现多租户 RBAC 系统：数据层 → 认证 → 用户管理 → 权限控制 → 审计 → 网关桥接（含会话归属与成员管理）→ 前端集成。所有新增后端代码位于 `aiemas/src/`，原 gateway 仅增加最小桥接调用。

## 任务

- [x] 1. 基础数据层：模型定义、错误类型与 SQLite 存储
  - [x] 1.1 创建数据模型和错误类型
    - 创建 `aiemas/src/models.ts`，定义 Tenant、User、PublicUser、SessionOwnership、SessionMembership、SessionMember 接口及 GlobalRole、SessionRole、UserStatus 类型（UserStatus = "pending" | "approved" | "rejected"）
    - 创建 `aiemas/src/errors.ts`，定义 TenantServiceError 类及所有错误码常量（AUTH_FAILED、TOKEN_EXPIRED、USERNAME_TAKEN、SESSION_ACCESS_DENIED、PERMISSION_DENIED、OWNER_CANNOT_LEAVE、RATE_LIMITED、WEAK_PASSWORD、ACCOUNT_PENDING_APPROVAL、ACCOUNT_REJECTED、ALREADY_MEMBER、NOT_A_MEMBER、ADMIN_USERNAME_REQUIRED 等）
    - _需求: 1.1, 1.2, 2.2, 2.6, 4.3, 5.3, 5.7, 6.2, 11.1_

  - [x] 1.2 实现 SQLite 数据库存储模块
    - 创建 `aiemas/src/store/database.ts`，实现 initDatabase(dbPath) 和 ensureMas4sSchema(db) 函数
    - 复用项目现有的 `requireNodeSqlite()`（`src/memory/sqlite.ts`），通过相对路径 `../../../src/memory/sqlite.js` 引用
    - 设置 WAL 模式（`PRAGMA journal_mode=WAL`）、busy_timeout（5000ms）、外键约束
    - 创建 tenants、users（含 UNIQUE 索引 tenantId+username）、session_ownership、session_memberships 四张表
    - 实现启动时自动创建数据库文件和目录结构（`~/.openclaw/aiemas/`）
    - **测试运行方式：`aiemas/src/` 无独立 package.json，测试统一在根目录 vitest 单元测试通道下运行（`pnpm test -- aiemas/src`），`aiemas/src/**/\*.test.ts`已加入`vitest.unit-paths.mjs`，不应创建 `aiemas/vitest.config.ts`\*\*
    - _需求: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7_

  - [x] 1.3 编写 SQLite 存储属性测试
    - **Property 15: 数据持久化 round-trip**
    - **验证: 需求 10.1, 10.2, 10.3, 10.4**
    - 创建 `aiemas/src/store/database.property.test.ts`，验证任意数据写入后关闭并重新打开数据库应得到等价数据

  - [x] 1.4 编写 SQLite 并发写入属性测试
    - **Property 16: 并发写入安全**
    - **验证: 需求 10.6**
    - 在 `aiemas/src/store/database.property.test.ts` 中添加并发写入测试，验证 WAL 模式和 busy_timeout 确保数据不丢失不损坏

- [ ] 2. 认证模块：JWT 签发/验证与密码哈希
  - [x] 2.1 实现 JWT 签发与验证
    - 创建 `aiemas/src/auth/jwt.ts`，实现 signToken(payload)、verifyToken(token)、refreshToken(token) 函数
    - 使用 HMAC-SHA256 签名算法，密钥来源优先级：MAS4S_JWT_SECRET 环境变量 → 配置文件 → 随机生成（输出警告）
    - JWT payload 包含 userId、tenantId、role、iat、exp，默认有效期 24 小时
    - 密钥长度校验：不低于 32 字节，否则抛出 JWT_SECRET_TOO_SHORT 错误
    - 未配置密钥时生成随机密钥并输出警告日志
    - login 流程中凭据验证通过后，检查用户 status：pending 返回 ACCOUNT_PENDING_APPROVAL，rejected 返回 ACCOUNT_REJECTED，仅 approved 签发 token
    - _需求: 2.1, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 11.2, 11.5_

  - [x] 2.2 实现密码哈希模块
    - 创建 `aiemas/src/auth/password.ts`，实现 hashPassword(plain)、verifyPassword(plain, hash) 函数
    - 使用 bcrypt，cost factor 不低于 10
    - 实现密码强度校验：长度不低于 8 字符，不满足时抛出 WEAK_PASSWORD 错误
    - _需求: 1.3, 11.4_

  - [x] 2.3 实现登录速率限制
    - 创建 `aiemas/src/auth/rate-limiter.ts`，实现基于 IP 的滑动窗口速率限制器
    - 同一 IP 每分钟最多 10 次失败尝试，超限返回 RATE_LIMITED 和 retryAfterMs
    - _需求: 11.1_

  - [x] 2.4 编写 JWT round-trip 属性测试
    - **Property 3: AuthToken round-trip**
    - **验证: 需求 2.1, 2.3, 2.5, 2.7**
    - 创建 `aiemas/src/auth/jwt.property.test.ts`，验证任意有效参数经 sign → verify 后返回一致的 userId、tenantId、role

  - [x] 2.5 编写过期令牌属性测试
    - **Property 4: 过期令牌拒绝**
    - **验证: 需求 2.6**
    - 在 `aiemas/src/auth/jwt.property.test.ts` 中添加测试，验证任意过期 token 的 verify 返回 TOKEN_EXPIRED

  - [x] 2.6 编写认证错误不泄露信息属性测试
    - **Property 5: 认证错误不泄露信息**
    - **验证: 需求 2.2**
    - 在 `aiemas/src/auth/jwt.property.test.ts` 中添加测试，验证用户名不存在和密码错误返回相同错误码 AUTH_FAILED

  - [x] 2.7 编写登录速率限制属性测试
    - **Property 13: 登录速率限制**
    - **验证: 需求 11.1**
    - 创建 `aiemas/src/auth/rate-limiter.property.test.ts`，验证任意 IP 连续 10 次失败后第 11 次返回 RATE_LIMITED

- [x] 3. 检查点 - 数据层与认证模块
  - 确保所有测试通过，如有问题请向用户确认。

- [ ] 4. 用户管理模块
  - [x] 4.1 实现用户注册、查询、更新与审批服务
    - 创建 `aiemas/src/users/user-service.ts`，实现 registerUser、listUsers、updateUser、getSystemStatus、approveUser、rejectUser 函数
    - getSystemStatus：查询 `SELECT COUNT(*) FROM users`，返回 `{ initialized: count > 0 }`
    - registerUser：
      - 若 initialized=false（首次注册）：username 必须为 "admin"，否则返回 ADMIN_USERNAME_REQUIRED；自动创建默认 Tenant，角色设为 admin，status 设为 "approved"；无需调用方认证
      - 若 initialized=true 且调用方为 admin（已认证）：创建用户，status 直接设为 "approved"（跳过审批）
      - 若 initialized=true 且无认证（自注册）：创建用户，status 设为 "pending"，role 默认为 "member"
      - 通用流程：校验密码强度 → 检查用户名唯一性（同 tenantId 下）→ bcrypt 哈希 → 生成 userId → 持久化 → 返回 PublicUser
    - 未指定 tenantId 时自动创建新 Tenant 并设用户为 admin
    - listUsers：所有已认证用户可调用；admin 返回指定 tenantId 下所有用户（含 status 字段）；member/viewer 仅返回 status="approved" 的用户（不含 status 字段），以支持邀请用户时的用户搜索
    - updateUser：仅 admin 可调用，允许修改 displayName 和 role
    - approveUser：仅 admin 可调用，将 status 从 "pending" 改为 "approved"
    - rejectUser：仅 admin 可调用，将 status 从 "pending" 改为 "rejected"
    - _需求: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10, 1.11, 1.12, 11.4_

  - [x] 4.2 编写用户名唯一性属性测试
    - **Property 1: 用户名租户内唯一性**
    - **验证: 需求 1.2**
    - 创建 `aiemas/src/users/user-service.property.test.ts`，验证同一 tenantId 下重复注册相同用户名返回 USERNAME_TAKEN

  - [x] 4.3 编写密码安全不变量属性测试
    - **Property 2: 密码安全不变量**
    - **验证: 需求 1.3, 11.4**
    - 在 `aiemas/src/users/user-service.property.test.ts` 中添加测试，验证注册后存储中不含密码明文且弱密码被拒绝

- [ ] 5. 权限控制与审计模块
  - [x] 5.1 实现 RBAC 权限校验器
    - 创建 `aiemas/src/rbac/permission-checker.ts`，实现 checkPermission 函数
    - 定义 GLOBAL_ROLE_PERMISSIONS 和 SESSION_ROLE_PERMISSIONS 权限矩阵常量（含 user.approve、user.reject 仅 admin；user.list 所有已认证用户可调用）
    - 全局角色校验：admin（全部）、member（查询用户+会话操作+消息）、viewer（查询用户+仅查看）
    - 会话级角色校验：owner（移除成员+审批+邀请+全部消息操作）、participant（邀请+消息）
    - 权限失败时调用审计模块记录日志
    - _需求: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6_

  - [x] 5.2 实现审计日志模块
    - 创建 `aiemas/src/audit/audit-logger.ts`，实现 logPermissionFailure 函数
    - 审计记录包含：userId、操作名、目标资源、时间戳、结果
    - 以追加方式写入 `~/.openclaw/aiemas/audit.log`
    - _需求: 11.3_

  - [x] 5.3 编写权限矩阵一致性属性测试
    - **Property 10: 全局与会话级权限矩阵一致性**
    - **验证: 需求 6.1, 6.2, 6.3, 6.4, 6.5, 6.6**
    - 创建 `aiemas/src/rbac/permission-checker.property.test.ts`，使用 fast-check 生成任意角色+操作组合，验证结果与矩阵一致

  - [x] 5.4 编写审计日志属性测试
    - **Property 14: 权限失败审计日志**
    - **验证: 需求 11.3**
    - 创建 `aiemas/src/audit/audit-logger.test.ts`，验证权限失败后审计日志包含完整记录

- [x] 6. 检查点 - 后端核心模块
  - 确保所有测试通过，如有问题请向用户确认。

- [ ] 7. TenantService 入口与集成
  - [x] 7.1 实现 TenantService 单例入口
    - 创建 `aiemas/src/index.ts`，定义 TenantServiceConfig 接口和 TenantService 接口
    - 实现 createTenantService(config) 工厂函数，组装 database、auth、users、sessions、rbac、audit 各模块
    - 实现 init() 方法：初始化 SQLite 数据库（WAL 模式）、初始化 JWT 密钥
    - 导出 TenantService 单例
    - _需求: 10.7, 11.5_

  - [x] 7.2 创建测试辅助工具
    - 创建 `aiemas/src/test-helpers/generators.ts`，实现 fast-check 生成器：arbUsername、arbPassword、arbWeakPassword、arbDisplayName、arbGlobalRole、arbSessionRole、arbSessionKey、arbMethod
    - 创建 `aiemas/src/test-helpers/setup.ts`，实现测试用临时 SQLite 数据库创建和清理辅助函数（使用 `:memory:` 或临时文件）

- [ ] 8. GatewayAuthBridge 桥接层（含会话归属与成员管理）
  - [x] 8.1 实现连接上下文管理
    - 创建 `aiemas/src/gateway-bridge/context.ts`，使用 WeakMap 实现 setMasAuth / getMasAuth，在不修改 GatewayWsClient 类型的前提下附加 MasAuthContext
    - 定义 MasAuthContext 接口（userId、tenantId、masRole，均可为 null）
    - _需求: 3.1, 3.2, 3.4_

  - [x] 8.2 实现会话归属与成员管理器
    - 创建 `aiemas/src/gateway-bridge/session-manager.ts`，实现以下函数（直接操作 SQLite）：
    - recordSessionCreated：同时创建 SessionOwnership 和 SessionMembership（role="owner"）记录
    - listSessionsForUser：返回用户拥有 membership 的所有 sessionKey
    - checkSessionAccess：检查用户是否有指定会话的 membership
    - inviteToSession：会话成员（owner 和 participant）均可调用，立即创建 membership（role="participant"），被邀人无需确认即自动加入；若 targetUserId 已是成员则返回 ALREADY_MEMBER
    - removeMember：仅 owner 可调用，删除目标用户的 SessionMembership 记录；owner 不可移除自己（返回 OWNER_CANNOT_LEAVE）；目标不是成员返回 NOT_A_MEMBER
    - listSessionMembers：返回会话所有成员（含 displayName），仅成员可调用
    - leaveSession：participant 可退出，owner 调用返回 OWNER_CANNOT_LEAVE
    - getSessionMemberUserIds / getSessionOwnerUserIds：用于广播过滤
    - _需求: 3.6, 3.7, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 5.2, 5.3, 5.6, 5.7, 5.8, 5.9, 5.10, 5.11, 5.12, 5.13_

  - [x] 8.3 实现 GatewayAuthBridge 核心逻辑
    - 创建 `aiemas/src/gateway-bridge/bridge.ts`，实现 GatewayAuthBridge 类：
    - authenticateConnect：从 WS URL query string 提取 masToken → 调用 TenantService.verify → 返回 MasAuthContext；无 masToken 时返回 null 上下文（兼容模式）
    - interceptMethod：检查全局角色权限 + 会话级权限 + 会话成员校验；兼容模式（userId=null）跳过所有校验
    - filterResponse：对 sessions.list 响应按 membership 过滤；兼容模式不过滤
    - filterBroadcastTargets：chat/agent 事件仅发给会话成员，approval 事件仅发给 owner；兼容模式返回 null（不过滤）
    - onSessionCreated：gateway 创建会话后回调，调用 session-manager 记录归属和 membership
    - filterSessionsForUser：gateway 获取全量会话后回调，调用 session-manager 过滤
    - checkSessionAccess：gateway 操作会话前回调，调用 session-manager 校验
    - inviteToSession / listSessionMembers / leaveSession / removeMember / getSessionMemberUserIds / getSessionOwnerUserIds：委托 session-manager 执行
    - pushSessionJoined：邀请成功后向被邀人所有已连接 WS 客户端推送 `event:session.joined { sessionKey, label, invitedBy, joinedAt }`，使被邀人实时看到新会话
    - pushSessionRemoved：成员移除后向被移除用户所有已连接 WS 客户端推送 `event:session.removed { sessionKey, removedBy }`，前端收到后从会话列表移除
    - _需求: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.2, 4.3, 4.4, 4.6, 5.4, 5.10, 5.11, 7.1, 7.2, 7.3, 7.4_

  - [x] 8.4 编写会话隔离完备性属性测试
    - **Property 6: 会话隔离完备性**
    - **验证: 需求 4.2, 4.3, 4.4**
    - 创建 `aiemas/src/gateway-bridge/bridge.property.test.ts`，验证无 membership 的用户无法访问会话

  - [x] 8.5 编写会话创建记录完整性属性测试
    - **Property 7: 会话创建记录完整性**
    - **验证: 需求 4.1**
    - 在 `aiemas/src/gateway-bridge/bridge.property.test.ts` 中添加测试，验证 onSessionCreated 后同时存在 ownership 和 membership 记录

  - [x] 8.6 编写会话邀请权限与成员增长属性测试
    - **Property 8: 会话邀请权限与成员增长（邀请即自动加入）**
    - **验证: 需求 5.1, 5.2, 5.3, 5.4, 5.9**
    - 在 `aiemas/src/gateway-bridge/bridge.property.test.ts` 中添加测试，验证会话成员（owner 和 participant）均可邀请、被邀人立即成为成员、非成员邀请返回 SESSION_ACCESS_DENIED、重复邀请返回 ALREADY_MEMBER

  - [x] 8.7 编写 owner 不可退出属性测试
    - **Property 9: owner 不可自行退出**
    - **验证: 需求 5.8**
    - 在 `aiemas/src/gateway-bridge/bridge.property.test.ts` 中添加测试，验证 owner 调用 leave 返回 OWNER_CANNOT_LEAVE

  - [x] 8.8 编写广播隔离属性测试
    - **Property 11: 事件广播隔离**
    - **验证: 需求 7.1, 7.2, 7.3**
    - 在 `aiemas/src/gateway-bridge/bridge.property.test.ts` 中添加测试，验证事件仅发送给有 membership 的用户，approval 仅发给 owner

  - [x] 8.9 编写兼容模式透明性属性测试
    - **Property 12: 兼容模式透明性**
    - **验证: 需求 3.4, 4.6, 7.4**
    - 在 `aiemas/src/gateway-bridge/bridge.property.test.ts` 中添加测试，验证 userId=null 时所有操作不受限制

  - [x] 8.10 编写成员移除完整性属性测试
    - **Property 19: 成员移除完整性**
    - **验证: 需求 5.10, 5.11, 5.12, 5.13**
    - 在 `aiemas/src/gateway-bridge/bridge.property.test.ts` 中添加测试，验证 owner 可移除 participant、移除后不再是成员、owner 不可移除自己（OWNER_CANNOT_LEAVE）、目标不是成员返回 NOT_A_MEMBER

- [ ] 9. Gateway 最小集成
  - [x] 9.1 在 gateway WS 连接流程中集成 GatewayAuthBridge
    - 在 `src/gateway/` 的 WS upgrade/connect 处理中增加一行调用：从 upgradeReq.url 提取 masToken → 调用 bridge.authenticateConnect → 将 MasAuthContext 附加到 client
    - 在 server-methods 请求分发前增加 bridge.interceptMethod 调用
    - 在 server-broadcast 广播前增加 bridge.filterBroadcastTargets 调用
    - 在 sessions.create 完成后增加 bridge.onSessionCreated 回调
    - 在 sessions.list 获取全量结果后增加 bridge.filterSessionsForUser 过滤
    - 在 sessions.resolve / chat.send 执行前增加 bridge.checkSessionAccess 校验
    - 保持原有认证流程不变，仅在有 masToken 时额外执行多租户认证
    - _需求: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 10. 检查点 - 后端集成完成
  - 确保所有测试通过，如有问题请向用户确认。

- [ ] 11. 前端登录与用户状态
  - [x] 11.1 扩展 AppStore 添加 currentUser 状态
    - 在 `aiemas/ui/mas4s/src/store/app-store.ts` 中添加 currentUser 字段（userId、username、displayName、role、tenantId）
    - 添加 setCurrentUser / clearCurrentUser 方法
    - 添加 logout 方法：清除 localStorage 中的 mas4s_auth_token、重置 currentUser、断开 WebSocket
    - _需求: 8.3, 8.7_

  - [x] 11.2 创建 LoginView 登录/注册组件
    - 创建 `aiemas/ui/mas4s/src/views/login-view.ts`，LitElement 组件
    - 提供用户名、密码输入框和"登录"按钮，以及"注册新账号"切换链接
    - 支持初始化模式（`mode="init"`）：用户名固定为 "admin" 且输入框 disabled 不可修改，按钮文案改为"初始化系统"，仅需填写密码和显示名称
    - 登录：通过 GatewayClient 调用 auth.login → 成功后存储 token 到 localStorage（key: mas4s_auth_token）→ 设置 AppStore.currentUser
    - 初始化/注册：调用 user.register → 成功后自动登录
    - 失败时显示错误提示（AUTH_FAILED、RATE_LIMITED 倒计时、WEAK_PASSWORD、ACCOUNT_PENDING_APPROVAL 显示"等待审批"、ACCOUNT_REJECTED 显示"已被拒绝"等）
    - 自注册成功后显示"注册成功，请等待管理员审批后登录"提示，切换回登录表单
    - _需求: 8.1, 8.2, 8.3, 8.4, 8.6, 8.7, 8.10_

  - [x] 11.3 修改 GatewayClient 注入 masToken
    - 修改 `aiemas/ui/mas4s/src/gateway/client.ts`，在构造 WebSocket URL 时从 localStorage 读取 mas4s_auth_token，追加为 query parameter：`?masToken=<token>`
    - _需求: 8.5_

  - [x] 11.4 修改 mas4s-app 根组件集成登录流程
    - 修改 `aiemas/ui/mas4s/src/app.ts`：
    - 启动时先调用 `system.status` 检查系统是否已初始化
    - 若 initialized=false：显示 LoginView（初始化模式，用户名锁定为 "admin"）
    - 若 initialized=true 且 localStorage 无 token：显示 LoginView（登录模式）
    - 若 initialized=true 且有 token：连接 WebSocket 进入主工作区
    - 在 primary-sidebar 或 header 中添加"退出登录"按钮
    - 处理 TOKEN_EXPIRED / MAS_AUTH_FAILED 错误：清除 token → 显示 LoginView
    - _需求: 8.5, 8.6, 8.7, 8.8, 8.9_

- [ ] 12. 前端会话列表过滤与消息发送者
  - [x] 12.1 实现会话列表 masType 标记与分组显示
    - 修改 `aiemas/ui/mas4s/src/store/app-store.ts`，在 MasSession 类型上添加 masType 字段（"initiated" | "participated"）
    - 创建会话时标记 masType="initiated"
    - 修改 `aiemas/ui/mas4s/src/gateway/event-handler.ts`，监听 `event:session.joined` 事件：收到后将会话自动加入 AppStore 列表（masType="participated"），并显示 Toast 通知（"您已被邀请加入会话 {label}"）；监听 `event:session.removed` 事件：收到后从 AppStore 会话列表中移除该会话，并显示 Toast 通知（"您已被移出会话 {label}"）
    - 修改 `aiemas/ui/mas4s/src/components/session-sidebar.ts`，按 masType 分组显示："发起的会话"和"参与的会话"
    - _需求: 9.1, 9.2, 9.3, 9.4, 9.6_

  - [x] 12.2 修改消息发送使用 currentUser.displayName
    - 修改 `aiemas/ui/mas4s/src/app.ts` 中的 \_onSendMessage 方法，使用 AppStore.currentUser.displayName 替代硬编码的"我"
    - _需求: 9.5_

  - [x] 12.3 编写消息发送者名替换属性测试
    - **Property 17: 消息发送者名替换**
    - **验证: 需求 9.5**
    - 创建 `aiemas/ui/mas4s/src/utils/message-format.property.test.ts`，验证任意 displayName 正确替换为消息前缀

  - [x] 12.4 编写会话类型标记属性测试
    - **Property 18: 会话类型标记**
    - **验证: 需求 9.2, 9.3**
    - 创建 `aiemas/ui/mas4s/src/store/app-store.property.test.ts`，验证创建的会话标记为 initiated，邀请加入的标记为 participated

- [ ] 13. 用户在线状态维护（需求 12）
  - [x] 13.1 扩展 SQLite schema 添加 user_presence 表
    - 在 `aiemas/src/store/database.ts` 的 `ensureMas4sSchema` 函数中添加 `user_presence` 表：
      ```sql
      CREATE TABLE IF NOT EXISTS user_presence (
        userId TEXT PRIMARY KEY REFERENCES users(userId),
        lastSeenAt INTEGER NOT NULL,
        isOnline INTEGER NOT NULL DEFAULT 0
      );
      ```
    - _需求: 12.1_

  - [x] 13.2 实现 presence 服务模块
    - 创建 `aiemas/src/presence/presence-service.ts`，实现：
      - `updatePresence(userId, db)`: UPSERT user_presence 记录，设 lastSeenAt=now, isOnline=1
      - `markOffline(userId, db)`: 更新 isOnline=0, lastSeenAt=now
      - `startOfflineScanner(db, intervalMs?)`: 启动后台定时任务（间隔 ≤ 1 分钟），扫描 lastSeenAt 超过 15 分钟的用户并设 isOnline=0
      - `getPresence(userId, db)`: 返回 `{ isOnline: boolean, lastSeenAt: number | null }`
    - _需求: 12.2, 12.5_

  - [x] 13.3 修改 auth.refresh 集成 presence.update
    - 修改 `aiemas/src/auth/jwt.ts` 中的 refreshToken 函数（或 TenantService 的 refresh 方法），在续期成功后调用 `updatePresence(userId, db)`
    - _需求: 12.3_

  - [x] 13.4 修改 user.list 附加 isOnline 字段
    - 修改 `aiemas/src/users/user-service.ts` 的 `listUsers` 函数，在返回每个用户对象时 JOIN 或查询 user_presence 表，附加 `isOnline: boolean` 字段（无 presence 记录时默认 false）
    - admin 和 member/viewer 均返回 isOnline（admin 返回全量用户，member/viewer 仅返回 approved 用户）
    - _需求: 12.6, 12.7_

  - [x] 13.5 修改退出登录立即标记离线
    - 在 TenantService 或 GatewayAuthBridge 中添加 `logout(userId)` 方法，调用 `markOffline(userId, db)`
    - 在 gateway 的 WS disconnect 或前端退出登录流程中调用此方法
    - _需求: 12.8_

  - [x] 13.6 前端：登录后每 5 分钟自动刷新 token
    - 修改 `aiemas/ui/mas4s/src/app.ts` 或 `aiemas/ui/mas4s/src/store/app-store.ts`，在登录成功后启动定时器（setInterval，5 分钟），自动调用 `auth.refresh` 接口
    - 退出登录时清除定时器
    - _需求: 12.4_

  - [x] 13.7 前端：用户列表显示在线状态指示器
    - 修改 `aiemas/ui/mas4s/src/views/user-list-view.ts`（或相关用户列表组件），在每个用户条目旁显示在线状态指示器：
      - isOnline=true：绿色圆点
      - isOnline=false：灰色圆点
    - _需求: 12.9_

  - [ ]\* 13.8 编写在线状态超时一致性属性测试
    - **属性 20: 在线状态超时一致性**
    - **验证: 需求 12.3, 12.5, 12.6**
    - 创建 `aiemas/src/presence/presence-service.property.test.ts`，验证：
      - 任意用户 U，若 lastSeenAt 超过 15 分钟，user.list 返回 isOnline=false
      - 若 lastSeenAt 在 15 分钟内，user.list 返回 isOnline=true
    - **测试运行方式：`pnpm test -- aiemas/src`**

  - [ ]\* 13.9 编写退出登录即时离线属性测试
    - **属性 21: 退出登录即时离线**
    - **验证: 需求 12.8**
    - 在 `aiemas/src/presence/presence-service.property.test.ts` 中添加测试，验证任意已登录用户退出后 isOnline 立即变为 false
    - **测试运行方式：`pnpm test -- aiemas/src`**

- [x] 14. 最终检查点 - 全部完成
  - 确保所有测试通过，如有问题请向用户确认。

## 备注

- 标记 `*` 的任务为可选测试任务，可跳过以加速 MVP 交付
- 每个任务引用了具体的需求编号，确保需求全覆盖
- 属性测试引用了设计文档中的 Property 编号，使用 Vitest + fast-check
- 检查点任务确保增量验证，及时发现问题
- 所有后端新增代码位于 `aiemas/src/`，原 gateway 仅在任务 9 中做最小改动
- **测试运行：`aiemas/src/` 无独立 package.json，其代码由 gateway 直接调用，测试统一在根目录 vitest 单元测试通道下运行：`pnpm test -- aiemas/src`（遵循 AGENTS.md：始终用 wrapper，不得用 `pnpm vitest run`）。`aiemas/src/**/\*.test.ts`已加入`vitest.unit-paths.mjs`，不应创建 `aiemas/vitest.config.ts`\*\*
- **前端测试（`aiemas/ui/`）独立运行，与后端测试分开**
