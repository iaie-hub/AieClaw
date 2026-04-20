# 实现计划：Gateway Proxy

## 概述

基于设计文档，将 Gateway Proxy 的实现拆分为增量式编码任务。每个任务构建在前一个任务之上，确保代码始终可运行。使用 Python 3.10+ / asyncio / websockets / aiosqlite 技术栈，所有代码位于 `aiemas/gateway-proxy/` 目录。

## 任务

- [x] 1. 项目结构初始化与配置加载
  - 创建 `aiemas/gateway-proxy/` 目录结构，包含 `__init__.py`、`__main__.py`、`config.py`、`models.py`
  - 实现 `ProxyConfig` 数据类：从 `~/.openclaw/gateway-proxy.json` 加载配置，不存在时创建默认配置
  - 实现 `ensure_token()` 逻辑：token 为空时自动生成 64 字符 hex token 并回写配置文件
  - 实现 `models.py`：定义所有数据类（`UserInfo`、`GatewayInfo`、`ClientConnection`、`AuthContext`、`RequestMapping`、`JwtPayload`）
  - 配置结构化日志，使用 `[gateway-proxy]` 前缀
  - 创建 `requirements.txt` 或 `pyproject.toml`，声明依赖：`websockets`、`aiosqlite`、`PyJWT`、`hypothesis`（dev）
  - _需求：12.1, 12.2_

- [x] 2. 数据库初始化与 Schema 管理
  - [x] 2.1 实现数据库初始化模块 `database.py`
    - 创建 SQLite 数据库文件 `aiemas.gateway.db`（路径从配置读取）
    - 设置 WAL 模式、`busy_timeout=5000`、`foreign_keys=ON`
    - 创建 `users` 表（userId, username, displayName, passwordHash, role, tenantId, status, createdAt）
    - 创建 `gateways` 表（gatewayId, name, wsUrl, token, status, createdAt）
    - 创建 `session_ownership` 表（sessionKey, userId, tenantId, createdAt）
    - 创建 `session_memberships` 表（sessionKey, userId, role, joinedAt）及索引
    - 使用事务保证多表写入原子性
    - _需求：1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9_

  - [x] 2.2 编写数据库初始化单元测试
    - 验证 schema 创建、WAL 模式、外键约束
    - _需求：1.1, 1.2, 1.3, 1.4_

- [x] 3. 密码哈希与认证服务
  - [x] 3.1 实现 `auth_service.py` 中的密码哈希模块
    - 实现 `hash_password(plain)` → `sha256:<salt>:<hash>` 格式（兼容现有 gateway）
    - 实现 `verify_password(plain, stored)` 常量时间比较
    - _需求：1.10_

  - [x] 3.2 编写属性测试：密码哈希 round-trip
    - **属性 1：密码哈希 round-trip**
    - 对任意非空密码字符串 p，`hash_password(p)` 产生的哈希值 h 满足 `verify_password(p, h)` 返回 True；对任意不同于 p 的密码字符串 q，`verify_password(q, h)` 返回 False
    - **验证需求：1.10**

  - [x] 3.3 实现 JWT token 签发与验证
    - 实现 `AuthService.login()`：验证用户名密码，签发 JWT token（HMAC-SHA256，共享 `MAS4S_JWT_SECRET`）
    - 实现 `AuthService.verify_token()`：验证 JWT 有效性，返回 `JwtPayload`
    - 实现 `AuthService.refresh_token()`：刷新 JWT token
    - 实现 `AuthService.register()`：注册新用户
    - 实现 `AuthService.get_system_status()`：返回系统初始化状态
    - 实现登录速率限制：同一 IP 每分钟最多 10 次失败尝试
    - _需求：8.2, 8.3, 8.4, 8.5, 8.6, 8.13_

  - [x] 3.4 编写属性测试：JWT token round-trip
    - **属性 2：JWT token round-trip**
    - 对任意有效用户信息 (userId, tenantId, role)，签发的 JWT token 经 `verify_token` 验证后应返回相同的 userId、tenantId 和 role
    - **验证需求：8.13**

- [x] 4. RBAC 权限校验
  - [x] 4.1 实现 `permission_checker.py`
    - 移植 `GLOBAL_ROLE_PERMISSIONS` 权限矩阵（与现有 gateway `permission-checker.ts` 一致）
    - 移植 `SESSION_ROLE_PERMISSIONS` 会话级权限矩阵
    - 实现 `check_permission()` 方法：全局角色 + 会话角色校验
    - 实现 `_derive_allowed_roles()` fallback 推导（read/write/admin 分类）
    - 未注册的 `aiemas.*` 前缀方法默认拒绝
    - admin 角色绕过会话级权限限制
    - _需求：7.1, 7.2, 7.3, 7.4, 7.7, 7.8_

  - [x] 4.2 编写属性测试：全局权限矩阵一致性
    - **属性 3：全局权限矩阵一致性**
    - 对任意 (method, role) 组合，Proxy 的 `check_permission` 结果应与现有 gateway 的权限矩阵完全一致
    - **验证需求：7.1, 7.2, 7.3, 7.7**

  - [x] 4.3 编写属性测试：会话级权限校验（含 admin 绕过）
    - **属性 4：会话级权限校验（含 admin 绕过）**
    - 对任意 (method, global_role, session_role) 组合，admin 角色始终通过会话级校验；非 admin 按 session_role 判断
    - **验证需求：7.4, 7.8**

- [x] 5. 检查点 - 确保所有测试通过
  - 确保所有测试通过，如有问题请询问用户。

- [x] 6. 全局缓存与会话路由
  - [x] 6.1 实现 `global_cache.py`
    - 实现 `GlobalCache` 单例：管理 `_users`、`_gateways`、`_session_routes`、`_session_access` 字典
    - 实现 `init_from_db()`：从数据库加载用户和 gateway 信息到内存
    - 实现 `get_route()` / `set_route()` / `remove_route()`：O(1) 会话路由查找
    - 实现 `update_access()`：更新会话 `lastAccessAt` 时间戳
    - 实现 `get_least_loaded_gateway()`：基于最近 24h 活跃会话数选择负载最低的 gateway
    - 实现 `get_active_session_count()`：计算某 gateway 最近 24h 活跃会话数
    - 使用 `asyncio.Lock` 保证写操作线程安全
    - _需求：4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 6.3, 6.5, 6.9_

  - [x] 6.2 编写属性测试：路由缓存增删一致性
    - **属性 8：路由缓存增删一致性**
    - 对任意 sessionKey 和 gateway_id，`set_route` 后 `get_route` 返回 gateway_id；`remove_route` 后返回 None
    - **验证需求：5.2, 5.3, 6.6**

  - [x] 6.3 编写属性测试：负载均衡选择正确性
    - **属性 9：负载均衡选择正确性**
    - 对任意已连接 gateway 集合及其会话列表，`get_least_loaded_gateway` 返回的 gateway 活跃会话数应 ≤ 所有其他 gateway
    - **验证需求：6.3, 6.5**

- [x] 7. 消息路由与请求 ID 映射
  - [x] 7.1 实现 `message_router.py`
    - 定义 `LOCAL_METHODS` 集合：`system.status`、`auth.login`、`auth.refresh`、`auth.verify`、`user.register`
    - 实现 `route()` 方法：根据 method 分类本地处理或转发
    - 实现 `_handle_local()`：分发到 AuthService 对应方法
    - 实现 `_forward_to_gateway()`：RBAC 校验 → 生成新请求 ID → 附加 `_auth` 字段 → 转发
    - 实现 `_create_forwarded_frame()`：生成转发帧（新 ID + `_auth: {userId, tenantId, role}`）
    - 实现 `handle_gateway_response()`：通过请求 ID 映射将响应关联回原始 UI 请求
    - 实现转发超时清理（默认 30 秒）
    - _需求：9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

  - [x] 7.2 编写属性测试：方法路由分类
    - **属性 5：方法路由分类**
    - 对任意方法名，若属于 `LOCAL_METHODS` 则本地处理；否则路由转发
    - **验证需求：9.2, 9.3**

  - [x] 7.3 编写属性测试：请求 ID 映射 round-trip
    - **属性 6：请求 ID 映射 round-trip**
    - 转发时生成的 proxy_req_id 不同于原始 req_id；gateway 响应时 ID 替换回原始 req_id
    - **验证需求：9.4, 9.6**

  - [x] 7.4 编写属性测试：\_auth 字段附加
    - **属性 7：\_auth 字段附加**
    - 对任意请求帧和已认证用户上下文，转发帧应包含 `_auth` 字段且内容与用户上下文一致
    - **验证需求：9.5**

- [x] 8. Gateway 连接管理
  - [x] 8.1 实现 `gateway_connection.py`（单个 Gateway 连接）
    - 封装与单个 gateway 的 WebSocket 连接
    - 实现 `connect()`：建立连接，在 URL 中携带 token 参数认证
    - 实现 `send_request()`：发送请求帧并等待响应（使用 `asyncio.Future`）
    - 实现 `_receive_loop()`：接收循环，分发响应和事件
    - 实现 `_reconnect_loop()`：指数退避重连，最大间隔 60 秒
    - 实现 `close()`：优雅关闭连接
    - _需求：3.4, 3.5, 3.6, 3.7_

  - [x] 8.2 编写属性测试：指数退避间隔计算
    - **属性 13：指数退避间隔计算**
    - 对任意重连次数 n，退避间隔满足 `min(base * factor^n, 60)` 秒，永远不超过 60 秒
    - **验证需求：3.4**

  - [x] 8.3 实现 `gateway_manager.py`（Gateway 连接管理器）
    - 实现 `connect_all()`：启动时连接所有已注册 gateway
    - 实现 `connect_one()`：连接单个 gateway，建立连接后同步会话列表到 GlobalCache
    - 实现 `disconnect_one()`：断开指定 gateway 连接
    - 实现 `send_request()`：向指定 gateway 发送请求
    - 实现 `is_connected()` / `get_connected_gateway_ids()`
    - _需求：3.1, 3.2, 3.3, 3.5_

- [x] 9. Gateway 注册管理 API
  - [x] 9.1 实现 Gateway 管理接口
    - 在 MessageRouter 中添加 `proxy.gateway.add`、`proxy.gateway.remove`、`proxy.gateway.list` 本地处理
    - 添加 gateway 时持久化到 `gateways` 表，自动建立 WebSocket 连接
    - 删除 gateway 时校验无活跃会话，关闭连接，从数据库和缓存中移除
    - 地址唯一性校验：wsUrl 已注册时拒绝添加
    - 查询接口返回所有 gateway 的标识、名称、地址和连接状态
    - _需求：2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 9.2 编写属性测试：Gateway 注册增删 round-trip
    - **属性 10：Gateway 注册增删 round-trip**
    - 添加后可在列表中查询到且字段匹配；删除后不再出现
    - **验证需求：2.1, 2.2**

  - [x] 9.3 编写属性测试：Gateway 地址唯一性约束
    - **属性 11：Gateway 地址唯一性约束**
    - 已注册的 wsUrl 再次添加应被拒绝
    - **验证需求：2.4**

  - [x] 9.4 编写属性测试：有活跃会话时拒绝删除 gateway
    - **属性 12：有活跃会话时拒绝删除 gateway**
    - 路由缓存中存在 sessionKey 映射时，删除该 gateway 应被拒绝
    - **验证需求：2.3**

- [x] 10. 检查点 - 确保所有测试通过
  - 确保所有测试通过，如有问题请询问用户。

- [x] 11. UI 客户端连接管理
  - [x] 11.1 实现 `client_manager.py`
    - 实现 `add_client()` / `remove_client()`：管理 UI WebSocket 客户端连接
    - 实现 `send_to_client()`：向指定客户端发送消息帧
    - 实现 `get_clients_for_session()`：获取订阅指定会话的客户端列表
    - 保证连接操作线程安全
    - _需求：8.11, 12.4_

  - [x] 11.2 实现 WebSocket 连接认证
    - 在 `ProxyServer.handle_client()` 中验证连接请求的认证凭据（token 认证）
    - 认证成功后将用户身份信息关联到连接上下文
    - 认证失败时拒绝连接并返回 `MAS_AUTH_FAILED`（code=4008）
    - _需求：8.1, 8.7, 8.8, 8.9_

- [x] 12. 会话创建与负载均衡
  - [x] 12.1 实现会话创建与列表查询
    - 实现 `aiemas.sessions.create` 处理：调用 `get_least_loaded_gateway()` 选择目标 gateway → 转发创建请求 → 注册路由映射 → 写入 `session_ownership` 和 `session_memberships`
    - 实现 `aiemas.sessions.list` 处理：聚合所有 gateway 的会话列表返回给 UI
    - 创建失败时返回错误信息；所有 gateway 断开时返回 `NO_AVAILABLE_GATEWAY`
    - _需求：6.1, 6.2, 6.4, 6.6, 6.7, 6.8, 7.5_

  - [x] 12.2 实现会话列表同步
    - gateway 连接建立后调用 `aiemas.sessions.list` 同步会话列表到 GlobalCache
    - 新会话创建成功后添加路由映射
    - 会话删除后移除路由映射
    - sessionKey 不存在时返回 `SESSION_NOT_FOUND`
    - _需求：5.1, 5.2, 5.3, 5.4_

  - [x] 12.3 实现会话成员变更同步
    - 会话邀请（`session.invite`）、移除（`session.removeMember`）、离开（`session.leave`）时同步更新 `session_memberships` 表
    - _需求：7.6_

- [x] 13. 消息转发与事件透传
  - [x] 13.1 实现消息转发
    - UI 发送会话消息时通过 Session_Router 查找目标 gateway 并转发
    - 转发时更新 `lastAccessAt` 时间戳
    - 使用 asyncio 协程处理，避免阻塞
    - 转发失败时返回错误信息
    - 保持同一会话内消息顺序
    - _需求：10.1, 10.2, 10.3, 10.4, 10.5, 6.9_

  - [x] 13.2 实现 `event_forwarder.py`（流式事件转发）
    - 实现 `forward_event()`：将 gateway 事件转发给对应会话的 UI 客户端
    - 支持所有事件类型：chat、agent、session.tool、exec.approval.requested/resolved 等
    - 保持事件原始顺序和内容不变
    - 目标客户端断开时丢弃事件，不影响其他客户端
    - 使用 asyncio 协程处理，避免慢速客户端阻塞
    - _需求：11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

  - [x] 13.3 编写属性测试：事件内容透传不变性
    - **属性 14：事件内容透传不变性**
    - 对任意 gateway 推送的事件帧，转发给 UI 的事件帧内容应与原始完全一致（JSON 深度相等）
    - **验证需求：11.4**

  - [x] 13.4 编写属性测试：消息与事件顺序保持
    - **属性 15：消息与事件顺序保持**
    - 对任意同一会话内的有序消息/事件序列，转发后顺序与原始一致
    - **验证需求：10.5, 11.3**

- [x] 14. ProxyServer 主服务组装与启动
  - 实现 `proxy_server.py`：组装所有组件（GlobalCache、GatewayManager、ClientManager、MessageRouter、AuthService、PermissionChecker、EventForwarder）
  - 实现 `start()`：初始化 DB → 加载缓存 → 连接 gateways → 启动 WebSocket 服务器
  - 实现 `stop()`：优雅关闭所有连接和数据库
  - 实现 `handle_client()`：处理新 UI 客户端连接的完整生命周期
  - 实现 `__main__.py` 入口：解析命令行参数，启动 ProxyServer
  - 转发消息到 gateway 时携带用户身份信息（`_auth` 字段）
  - _需求：8.1, 8.9, 8.10, 8.12, 12.1, 12.2, 12.3, 12.4, 12.5_

- [x] 15. 检查点 - 确保所有测试通过
  - 确保所有测试通过，如有问题请询问用户。

## 备注

- 标记 `*` 的任务为可选任务，可跳过以加速 MVP 开发
- 每个任务引用了具体的需求编号，确保可追溯性
- 检查点任务确保增量验证
- 属性测试使用 Hypothesis 库验证正确性属性（共 15 个属性）
- 单元测试验证具体示例和边界条件
