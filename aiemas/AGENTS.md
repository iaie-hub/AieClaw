# AIEMAS 架构与开发约束

## 1. 架构与目录约束 (Architecture & Directory)

- **最小入侵原 Gateway**：尽量少改动原 gateway (`src/gateway/`)，AIEMAS 的服务等新增功能必须闭环在 `aiemas/src` 目录内实现。
- **桥接层定位**：`GatewayAuthBridge` 必须作为独立模块实现在 `aiemas/src/gateway-bridge/`。原 gateway 仅通过挂载调用该桥接层暴露的钩子（hooks）即可。

## 2. 数据存储与持久化 (Data Storage & Persistence)

- **数据库底座**：必须统一使用 `node:sqlite` 内置模块（须与项目现有的 `src/memory/` 模块风格/加载方式保持一致），复用 `requireNodeSqlite()` 加载。
- **持久化路径**：多租户/RBAC 所有数据必须持久化到独立的 SQLite 数据库文件中：`~/.openclaw/aiemas/mas4s.db`。
- **事务与并发**：数据库的多表写入操作必须使用 SQLite 事务（`BEGIN`/`COMMIT`）以保证原子性。必须使用 `WAL` 模式和 `busy_timeout` 妥善处理多连接跨进程访问的并发争抢问题。
- **密码存储红线**：用户的密码明文绝对不可在任何情况下被持久化存储。所有落库密码必须使用 bcrypt 加密（cost factor $\ge$ 10）。
- **内存缓存集中管理**：所有内存缓存（UserCache、TopologyCache 等）必须集中在 `CacheService`（`aiemas/src/cache/cache-service.ts`）中维护。禁止在 `createTenantService` 闭包或其他位置分散创建独立的内存缓存实例。新增内存缓存时必须注册到 `CacheService` 中，通过 `CacheService.init(db)` 统一初始化加载。

## 3. 认证与安全策略 (Authentication & Security)

- **令牌生成**：系统颁发的会话令牌 (AuthToken) 必须使用 JWT 格式，并采用 HMAC-SHA256 算法签名，加密密钥长度不得低于 32 字节。
- **爆破防护与限流**：核心接口（如 `auth.login`）强制要求实施基于 IP 地址的速率限制（例如：同一 IP 地址每分钟最多允许 10 次失败尝试，超限应返回 `RATE_LIMITED` 错误）。
- **错误模糊化**：登录失败场景下（无论是用户不存在还是密码错误），均对外返回统一的相同错误码 `AUTH_FAILED`，禁止借由错误提示向外部泄漏具体原因（除非是处于特殊的账户业务状态，如 pending/rejected）。
- **安全日志审计**：发生任何情况下的权限校验失败，系统必须输出审计日志记录（需包含关键信息：userId、访问操作类型、目标系统资源、发生的时间戳、结果）。

## 4. 后向兼容与隔离降级 (Backward Compatibility)

- **无缝回退机制（兼容模式）**：当 WebSocket 客户端发起未携带 `auth.masToken` 的连接时，桥接层必须自动回退至平台原有的 token/password 流程。该连接的对应上下文中 `userId` 必须置为 `null`。
- **回退行为兜底**：处于兼容模式（`userId` 为 `null`）时，系统必须跳过各种会话归属和权限层面的校验逻辑，保持该客户端下原有行为全部通过（所有会话可见、所有作用域事件全量广播、不拦截消息等）。

## 5. API 接口约束 (API Interface Constraints)

- **记录新增API** : 记录新增的API到 `docs/openclaw/websocket_api.md` 中。
- **记录新增事件** : 记录新增的事件到 `docs/openclaw/websocket_api.md` 中。
- **记录新增消息格式** : 记录新增的消息格式到 `docs/openclaw/websocket_api.md` 中。
- **新增接口必须同步放开权限**：在 `aiemas/src/gateway-bridge/mas4s-gateway-plugin.ts` 的 `extraHandlers` 中新增任何 RPC 方法时，必须同步在 `aiemas/src/rbac/permission-checker.ts` 的 `GLOBAL_ROLE_PERMISSIONS` 中显式注册该方法及其允许的角色集合。不得依赖 `deriveAllowedRoles` 的 fallback 推断，因为 `aiemas.*` 前缀的方法不在任何 fallback 集合中，未注册的方法会被全部拒绝（`PERMISSION_DENIED`）。权限级别参考：
  - 只读查询类（如 `aiemas.fs.list`）→ `new Set(["admin", "member", "viewer"])`
  - 写操作类（如 `aiemas.agents.preDelete`、`aiemas.agents.export`、`aiemas.files.download`、`aiemas.file.upload`）→ `new Set(["admin", "member"])`
  - 创建/破坏性操作类（如 `aiemas.agents.import`）→ `new Set(["admin"])`
