# 需求文档

## 简介

当前 AIEMAS 的 gateway 基于 Node.js 单线程 event loop 实现，在多人多 agent 并发场景下存在性能瓶颈（详见 `aiemas/docs/mas4s/multi-agent/multi-agent-perf-optimization.md`）。为支持多用户同时请求多个 agent 的并发需求，计划在网关层新增 **Gateway 代理服务**（gateway-proxy）。

Gateway 代理位于接入层（UI）与多个 openclaw gateway 实例之间，负责 WebSocket 连接管理、用户鉴权、消息转发及流式事件转发。通过将连接管理和路由逻辑从单线程 gateway 中剥离，实现水平扩展和负载均衡。

## 术语表

- **Gateway_Proxy**：新增的 Python 网关代理服务，位于 `aiemas/gateway-proxy/` 目录，负责管理 UI 与多个 gateway 实例之间的 WebSocket 连接、消息路由和事件转发
- **Gateway**：现有的 openclaw gateway 实例，基于 Node.js 实现（代码位于 `src/gateway/`），负责 agent 运行时管理和消息处理
- **UI**：AIEMAS 的 Web 聊天界面（代码位于 `aiemas/ui/mas4s/`），通过 WebSocket 连接到 Gateway_Proxy
- **Session**：用户与 agent 之间的会话，由 sessionKey 唯一标识，归属于某个 Gateway 实例
- **SessionKey**：会话的唯一标识符，用于在 Gateway_Proxy 中路由消息到正确的 Gateway
- **Global_Cache**：Gateway_Proxy 中的全局缓存对象，集中管理用户信息缓存、gateway 信息缓存、会话与 gateway 的路由映射缓存
- **Session_Router**：Global_Cache 中的会话路由缓存，维护 sessionKey 到 Gateway 的映射关系
- **Gateway_Registry**：Gateway_Proxy 中的 gateway 注册表，持久化存储在 `aiemas.gateway.db` 的 `gateways` 表中
- **Streaming_Event**：Gateway 在会话过程中以流式方式推送给 UI 的事件（如 agent 回复的增量文本、工具调用进度等）
- **Active_Session_Count**：某个 Gateway 在最近 24 小时内有用户消息活动的会话数量，基于 Global_Cache 中每个会话的 `lastAccessAt` 字段计算（转发用户消息时更新）
- **aiemas_gateway_db**：Gateway_Proxy 专属的 SQLite 数据库文件（`aiemas.gateway.db`），存储用户信息和 gateway 注册信息
- **JSON_RPC_Frame**：Gateway 协议的消息帧格式，请求帧为 `{ type: "req", id: "<uuid>", method: "<method>", params: {...} }`，响应帧为 `{ type: "res", id: "<uuid>", ok: true/false, payload: {...}, error: {...} }`，事件帧为 `{ type: "event", event: "<name>", payload: {...}, seq: <number> }`（参考 `aiemas/ui/mas4s/src/lib/gateway.ts`）。Proxy 转发到 Gateway 时，请求帧扩展可选字段 `_auth: { userId, tenantId, role }`，用于携带真实用户身份和角色信息

## 需求

### 需求 1：Gateway 代理数据库持久化

**用户故事：** 作为系统管理员，我希望 Gateway 代理拥有独立的持久化存储，以便管理用户信息和 gateway 注册信息。

#### 验收标准

1. WHEN Gateway_Proxy 首次启动, THE Gateway_Proxy SHALL 在配置路径下创建 SQLite 数据库文件 `aiemas.gateway.db`
2. THE aiemas_gateway_db SHALL 使用 WAL 模式以支持并发读写
3. THE aiemas_gateway_db SHALL 设置 `busy_timeout` 为 5000 毫秒以处理并发写入争抢
4. THE aiemas_gateway_db SHALL 启用外键约束（`PRAGMA foreign_keys=ON`）
5. THE aiemas_gateway_db SHALL 包含 `users` 表，存储用户标识、用户名、显示名称、密码哈希、角色和租户信息
6. THE aiemas_gateway_db SHALL 包含 `gateways` 表，存储 gateway 标识、名称、WebSocket 地址、状态和注册时间
7. THE aiemas_gateway_db SHALL 包含 `session_ownership` 表，存储会话的所有者信息（sessionKey、userId、tenantId），用于会话级别权限校验
8. THE aiemas_gateway_db SHALL 包含 `session_memberships` 表，存储会话的成员关系（sessionKey、userId、role: owner/participant），用于会话级别权限校验
9. WHEN 对 aiemas_gateway_db 执行多表写入操作时, THE Gateway_Proxy SHALL 使用 SQLite 事务（BEGIN/COMMIT）保证原子性
10. THE aiemas_gateway_db SHALL 使用与现有 gateway 一致的密码哈希方式（SHA-256 + 随机 UUID salt，格式为 `sha256:<salt>:<hash>`，参考 `aiemas/src/users/user-service.ts` 中的 `hashPassword` / `verifyPassword` 实现），密码明文不可被持久化

### 需求 2：Gateway 注册管理

**用户故事：** 作为系统管理员，我希望能够动态添加和删除 gateway 实例，以便灵活管理后端 gateway 集群。

#### 验收标准

1. WHEN 管理员提交添加 gateway 请求（包含名称、WebSocket 地址和认证 token）时, THE Gateway_Proxy SHALL 将该 gateway 信息持久化到 `gateways` 表并返回分配的 gateway 标识
2. WHEN 管理员提交删除 gateway 请求时, THE Gateway_Proxy SHALL 从 `gateways` 表中移除该 gateway 记录
3. WHEN 删除一个仍有活跃会话的 gateway 时, THE Gateway_Proxy SHALL 拒绝删除操作并返回错误信息，说明该 gateway 上存在活跃会话
4. WHEN 添加 gateway 时提供的 WebSocket 地址已被其他 gateway 注册, THE Gateway_Proxy SHALL 拒绝添加操作并返回地址重复的错误信息
5. THE Gateway_Proxy SHALL 提供查询所有已注册 gateway 列表的接口，返回每个 gateway 的标识、名称、地址和当前连接状态

### 需求 3：Gateway WebSocket 连接管理

**用户故事：** 作为 Gateway 代理服务，我需要与所有已注册的 gateway 实例建立和维护 WebSocket 连接，以便转发消息和事件。

#### 验收标准

1. WHEN Gateway_Proxy 启动时, THE Gateway_Proxy SHALL 遍历 Gateway_Registry 中所有已注册的 gateway，并为每个 gateway 建立 WebSocket 连接
2. WHEN 新 gateway 被添加到 Gateway_Registry 时, THE Gateway_Proxy SHALL 自动与该 gateway 建立 WebSocket 连接
3. WHEN gateway 被从 Gateway_Registry 中删除时, THE Gateway_Proxy SHALL 关闭与该 gateway 的 WebSocket 连接
4. IF 与某个 gateway 的 WebSocket 连接断开, THEN THE Gateway_Proxy SHALL 以指数退避策略自动重连，最大重连间隔不超过 60 秒
5. THE Gateway_Proxy SHALL 保证与 gateway 的 WebSocket 连接操作（建立、关闭、发送、接收）是线程安全的
6. WHEN Gateway_Proxy 与 gateway 建立 WebSocket 连接时, THE Gateway_Proxy SHALL 在连接 URL 中携带该 gateway 的 token 参数进行认证（参考 `aiemas/ui/mas4s/src/views/login-view.ts` 中的网关连接测试逻辑）
7. THE gateways 表 SHALL 存储每个 gateway 的认证 token，用于建立 WebSocket 连接时的身份验证

### 需求 4：全局缓存管理

**用户故事：** 作为 Gateway 代理服务，我需要一个集中的全局缓存对象来管理用户信息、gateway 信息和会话路由映射，以提高查询效率并保证数据一致性。

#### 验收标准

1. THE Gateway_Proxy SHALL 拥有一个 Global_Cache 单例对象，集中管理用户缓存、gateway 缓存和会话路由缓存
2. THE Global_Cache SHALL 在 Gateway_Proxy 启动时从 aiemas_gateway_db 加载用户信息和 gateway 信息到内存
3. THE Global_Cache SHALL 在与 gateway 建立连接后加载该 gateway 的会话列表到会话路由缓存
4. WHEN 用户信息、gateway 信息或会话路由发生变更时, THE Global_Cache SHALL 同步更新内存缓存
5. THE Global_Cache SHALL 保证所有缓存的读写操作是线程安全的
6. THE Global_Cache 中的会话路由缓存 SHALL 支持通过 sessionKey 在 O(1) 时间复杂度内查找到对应的 gateway

### 需求 5：会话列表同步与路由

**用户故事：** 作为 Gateway 代理服务，我需要维护会话到 gateway 的路由映射，以便快速将消息转发到正确的 gateway。

#### 验收标准

1. WHEN Gateway_Proxy 与某个 gateway 建立 WebSocket 连接后, THE Gateway_Proxy SHALL 通过调用该 gateway 的 `aiemas.sessions.list` 接口查询会话列表，并将 sessionKey 到 gateway 的映射关系更新到 Global_Cache 的会话路由缓存中
2. WHEN 新会话在某个 gateway 上创建成功后, THE Gateway_Proxy SHALL 将该会话的 sessionKey 添加到 Global_Cache 的会话路由缓存中
3. WHEN 会话在某个 gateway 上被删除后, THE Gateway_Proxy SHALL 从 Global_Cache 的会话路由缓存中移除该 sessionKey 的映射
4. IF 收到的消息中包含的 sessionKey 在 Global_Cache 的会话路由缓存中不存在, THEN THE Gateway_Proxy SHALL 返回会话未找到的错误信息给 UI

### 需求 6：会话创建与负载均衡

**用户故事：** 作为用户，我希望创建新会话时系统能自动选择负载最低的 gateway，以获得最佳的响应性能。

#### 验收标准

1. THE Gateway_Proxy SHALL 提供 `aiemas.sessions.create` 接口供 UI 创建新会话
2. THE Gateway_Proxy SHALL 提供 `aiemas.sessions.list` 接口供 UI 查询会话列表
3. WHEN 用户请求创建新会话时, THE Gateway_Proxy SHALL 基于 Global_Cache 中已缓存的各 gateway 会话列表计算最近 24 小时活跃会话数量（基于每个会话的 `lastAccessAt` 字段），选择活跃会话数最少的 gateway，不实时拉取 gateway 的会话列表
4. THE Gateway_Proxy SHALL 将创建会话请求转发给选中的 gateway
5. WHEN 多个 gateway 的活跃会话数相同时, THE Gateway_Proxy SHALL 随机选择其中一个 gateway
6. WHEN 目标 gateway 成功创建会话后, THE Gateway_Proxy SHALL 将新会话的 sessionKey 添加到 Global_Cache 的会话路由缓存中
7. WHEN 目标 gateway 创建会话失败时, THE Gateway_Proxy SHALL 将错误信息返回给 UI
8. IF 所有已注册的 gateway 均处于断开状态, THEN THE Gateway_Proxy SHALL 返回无可用 gateway 的错误信息给 UI
9. WHEN Gateway_Proxy 转发用户消息到 gateway 时, THE Gateway_Proxy SHALL 更新 Global_Cache 中该会话的 `lastAccessAt` 时间戳，用于后续负载均衡计算

### 需求 7：RBAC 权限控制

**用户故事：** 作为系统管理员，我希望 Gateway 代理实现与现有 gateway 一致的 RBAC 权限矩阵，以保证不同角色用户只能访问授权的接口。

#### 验收标准

1. THE Gateway_Proxy SHALL 实现与现有 gateway 一致的全局角色权限矩阵（参考 `aiemas/src/rbac/permission-checker.ts` 中的 `GLOBAL_ROLE_PERMISSIONS`），包含三种角色：admin、member、viewer
2. THE Gateway_Proxy SHALL 对本地处理的请求（`system.status`、`auth.login`、`auth.refresh`、`auth.verify`、`user.register`）按权限矩阵进行权限校验
3. THE Gateway_Proxy SHALL 对透传转发的请求在转发前按权限矩阵进行权限校验，权限不足时直接拒绝并返回 `PERMISSION_DENIED` 错误，不转发到 gateway
4. THE Gateway_Proxy SHALL 支持会话级别的角色权限控制（owner、participant），通过查询 aiemas_gateway_db 中的 `session_ownership` 和 `session_memberships` 表验证用户的会话角色，与现有 gateway 的 `SESSION_ROLE_PERMISSIONS` 保持一致
5. WHEN 会话创建成功后, THE Gateway_Proxy SHALL 将会话所有者信息写入 `session_ownership` 表和 `session_memberships` 表
6. WHEN 会话成员变更（邀请、移除、离开）时, THE Gateway_Proxy SHALL 同步更新 `session_memberships` 表
7. THE Gateway_Proxy SHALL 对权限矩阵中未注册的方法（`aiemas.*` 前缀）默认拒绝访问
8. THE Gateway_Proxy SHALL 支持 admin 角色绕过会话级别权限限制（与现有 gateway 行为一致）

### 需求 8：用户鉴权与登录注册

**用户故事：** 作为用户，我希望通过 Gateway 代理进行登录和注册，与直连 gateway 时的体验一致。

#### 验收标准

1. THE Gateway_Proxy 的 WebSocket 接口 SHALL 与现有 gateway 的 WebSocket 接口保持协议兼容，UI 连接 Gateway_Proxy 的流程与直接连接 gateway 的流程完全一致（参考 `aiemas/ui/mas4s/src/views/login-view.ts` 中的网关配置、连接测试、登录和注册流程）
2. THE Gateway_Proxy SHALL 支持 `system.status` 请求，在本地处理并返回系统初始化状态（用于 UI 判断是否需要初始化）
3. THE Gateway_Proxy SHALL 支持 `auth.login` 请求，在本地验证用户名和密码后返回认证 token 和用户信息
4. THE Gateway_Proxy SHALL 支持 `auth.refresh` 请求，在本地处理 token 刷新
5. THE Gateway_Proxy SHALL 支持 `auth.verify` 请求，在本地验证 token 有效性
6. THE Gateway_Proxy SHALL 支持 `user.register` 请求，在本地处理用户注册
7. WHEN UI 客户端建立 WebSocket 连接时, THE Gateway_Proxy SHALL 验证连接请求中携带的认证凭据（与 gateway 的 token 认证方式一致）
8. IF 认证凭据无效或缺失, THEN THE Gateway_Proxy SHALL 拒绝 WebSocket 连接并返回认证失败的错误码
9. WHEN 认证成功后, THE Gateway_Proxy SHALL 将用户身份信息关联到该 WebSocket 连接上下文中
10. THE Gateway_Proxy SHALL 在转发消息到 gateway 时携带用户身份信息
11. THE Gateway_Proxy SHALL 保证与 UI 的 WebSocket 连接操作（建立、关闭、发送、接收）是线程安全的
12. WHEN 无 Gateway_Proxy 部署时, THE UI SHALL 支持直接连接 gateway 进行登录和注册（保持现有直连模式兼容，UI 无需感知是连接 Gateway_Proxy 还是 gateway）
13. THE Gateway_Proxy 与所有注册的 Gateway SHALL 共享相同的 `MAS4S_JWT_SECRET`，以保证 Proxy 签发的 JWT token 能被 Gateway 验证，Gateway 签发的 token 也能被 Proxy 验证

### 需求 9：消息协议与请求路由

**用户故事：** 作为 Gateway 代理服务，我需要使用与现有 gateway 一致的消息帧格式，并根据请求类型决定本地处理或透传转发。

#### 验收标准

1. THE Gateway_Proxy SHALL 使用与现有 gateway 一致的 JSON_RPC_Frame 格式进行所有 WebSocket 通信
2. THE Gateway_Proxy SHALL 对以下请求在本地处理，不转发到 gateway：`system.status`、`auth.login`、`auth.refresh`、`auth.verify`、`user.register`
3. THE Gateway_Proxy SHALL 对所有其他请求（非本地处理的请求）通过 Session_Router 路由到对应的 gateway 进行透传转发
4. WHEN 转发请求到 gateway 时, THE Gateway_Proxy SHALL 为转发请求生成新的请求 ID，并维护 UI 请求 ID 到 gateway 请求 ID 的映射关系
5. WHEN 转发请求到 gateway 时, THE Gateway_Proxy SHALL 在请求帧中附加 `_auth` 字段（`{ userId: "<userId>", tenantId: "<tenantId>", role: "<role>" }`），携带当前请求的真实用户身份和角色信息，以便 gateway 无需再次查询数据库即可获取完整的权限上下文
6. WHEN gateway 返回响应时, THE Gateway_Proxy SHALL 通过请求 ID 映射将响应关联回原始 UI 请求，并使用 UI 的原始请求 ID 返回响应
7. WHEN 转发请求超时或 gateway 连接断开时, THE Gateway_Proxy SHALL 清理对应的请求 ID 映射并向 UI 返回错误响应

### 需求 10：消息转发

**用户故事：** 作为用户，我希望发送的会话消息能被正确转发到对应的 gateway，并收到 gateway 的响应。

#### 验收标准

1. WHEN UI 发送会话消息（包含 sessionKey）时, THE Gateway_Proxy SHALL 通过 Session_Router 查找目标 gateway 并将消息转发给该 gateway
2. WHEN gateway 返回响应消息时, THE Gateway_Proxy SHALL 将响应转发给发送原始请求的 UI 客户端
3. THE Gateway_Proxy SHALL 使用 asyncio 协程方式处理消息转发，避免单个消息的处理阻塞其他消息的转发
4. WHEN 消息转发到目标 gateway 失败时, THE Gateway_Proxy SHALL 返回转发失败的错误信息给 UI 客户端
5. THE Gateway_Proxy SHALL 保持消息转发的顺序性，同一会话内的消息按发送顺序到达 gateway

### 需求 11：流式事件转发

**用户故事：** 作为用户，我希望在会话过程中实时收到 agent 的流式回复，以获得流畅的交互体验。

#### 验收标准

1. WHEN gateway 推送 Streaming_Event 时, THE Gateway_Proxy SHALL 将该事件实时转发给对应会话的 UI 客户端
2. THE Gateway_Proxy SHALL 支持转发所有 UI 需要的事件类型（参考 `aiemas/docs/mas4s/ui-message-list.md`），包括但不限于：`chat` 事件（delta/final）、`agent` 事件（stream: assistant/thinking/tool/agent/prompt）、`session.tool` 事件、`exec.approval.requested`/`exec.approval.resolved` 事件
3. THE Gateway_Proxy SHALL 保持 Streaming_Event 的原始顺序，不对事件进行重排或合并
4. THE Gateway_Proxy SHALL 保持 Streaming_Event 的原始内容，不对事件数据进行修改
5. WHEN 目标 UI 客户端的 WebSocket 连接已断开时, THE Gateway_Proxy SHALL 丢弃该客户端的待转发事件，不影响其他客户端的事件接收
6. THE Gateway_Proxy SHALL 使用 asyncio 协程方式处理事件转发，避免单个客户端的慢速接收阻塞其他客户端的事件推送

### 需求 12：技术实现约束

**用户故事：** 作为开发者，我希望 Gateway 代理遵循明确的技术约束，以保证系统的可维护性和性能。

#### 验收标准

1. THE Gateway_Proxy SHALL 使用 Python 语言实现，代码位于 `aiemas/gateway-proxy/` 目录
2. THE Gateway_Proxy SHALL 采用 asyncio 协程架构实现并发消息和事件转发
3. THE Gateway_Proxy SHALL 保证所有与 gateway 的 WebSocket 连接操作是线程安全的
4. THE Gateway_Proxy SHALL 保证所有与 UI 的 WebSocket 连接操作是线程安全的
5. THE Gateway_Proxy SHALL 采用轻量架构，不在本地持久化会话信息，会话路由仅维护在内存中
