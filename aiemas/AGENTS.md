# AIEMAS 架构与开发约束

本文档提取自 `.kiro/specs/mas4s-multi-tenant-rbac/requirements.md`，用于全局指导 `aiemas` 模块的开发。在修改 `aiemas` 及关联模块的代码时，请严格遵守以下核心系统约束：

## 0. 目录结构 (Directory Structure)

```
aiemas/
├── src/                          # 核心 TypeScript 源码（由根目录 vitest 统一测试）
│   ├── auth/                     # JWT 签发/验证/续期；密码哈希（bcrypt）
│   │   ├── jwt.ts
│   │   ├── jwt.test.ts
│   │   ├── jwt.property.test.ts  # fast-check 属性测试
│   │   ├── password.ts
│   │   ├── rate-limiter.ts
│   │   └── rate-limiter.property.test.ts
│   ├── users/                    # 用户注册、查询、更新、审批；系统初始化状态
│   │   ├── user-service.ts
│   │   └── user-service.property.test.ts
│   ├── rbac/                     # 全局角色 + 会话级角色权限矩阵
│   │   ├── permission-checker.ts
│   │   └── permission-checker.property.test.ts
│   ├── store/                    # SQLite 初始化、schema、事务封装
│   │   ├── database.ts
│   │   ├── database.test.ts
│   │   └── database.property.test.ts
│   ├── audit/                    # 权限失败审计日志
│   │   ├── audit-logger.ts
│   │   └── audit-logger.test.ts
│   ├── gateway-bridge/           # GatewayAuthBridge 薄适配层（连接认证、会话归属、广播过滤）
│   │   ├── bridge.ts
│   │   ├── bridge.property.test.ts
│   │   ├── context.ts            # WeakMap 连接上下文扩展（不修改原 gateway 类型）
│   │   ├── integration.ts
│   │   ├── mas4s-gateway-plugin.ts
│   │   └── session-manager.ts
│   ├── presence/                 # 用户在线状态维护（心跳/超时扫描）
│   │   └── presence-service.ts
│   ├── test-helpers/             # 测试辅助工具（generators、setup）
│   │   ├── generators.ts
│   │   └── setup.ts
│   ├── errors.ts                 # TenantServiceError 统一错误类
│   ├── models.ts                 # 共享数据类型（Tenant、User、SessionMembership 等）
│   └── index.ts                  # TenantService 单例初始化与导出
├── ui/
│   └── mas4s/                    # Vue 3 + Vite 前端工作台
│       ├── src/
│       │   ├── app.ts            # 应用入口
│       │   ├── components/       # UI 组件（LoginView、SessionSidebar 等）
│       │   ├── gateway/          # GatewayBrowserClient（masToken 注入）
│       │   ├── lib/              # 工具库
│       │   ├── store/            # AppStore（currentUser、会话列表）
│       │   ├── styles/
│       │   ├── types/
│       │   ├── utils/
│       │   └── views/            # 页面视图
│       ├── index.html
│       ├── package.json
│       ├── tsconfig.json
│       └── vite.config.ts
├── docs/
│   ├── mas4s/                    # mas4s 平台文档（mas.html）
│   └── openclaw/                 # openclaw 集成文档（协议、架构、workspace 等）
├── AGENTS.md                     # 本文件（模块开发约束）
└── README.md                     # 平台愿景与架构概述
```

数据库文件（运行时生成，不入库）：

```
~/.openclaw/aiemas/
├── mas4s.db        # SQLite 主库（WAL 模式）
├── mas4s.db-wal    # WAL 日志（自动）
├── mas4s.db-shm    # 共享内存（自动）
└── audit.log       # 审计日志（追加写入）
```

## 1. 架构与目录约束 (Architecture & Directory)

- **最小入侵原 Gateway**：尽量少改动原 gateway (`src/gateway/`)，AIEMAS 的服务等新增功能必须闭环在 `aiemas/src` 目录内实现。
- **桥接层定位**：`GatewayAuthBridge` 必须作为独立模块实现在 `aiemas/src/gateway-bridge/`。原 gateway 仅通过挂载调用该桥接层暴露的钩子（hooks）即可。

## 2. 数据存储与持久化 (Data Storage & Persistence)

- **数据库底座**：必须统一使用 `node:sqlite` 内置模块（须与项目现有的 `src/memory/` 模块风格/加载方式保持一致），复用 `requireNodeSqlite()` 加载。
- **持久化路径**：多租户/RBAC 所有数据必须持久化到独立的 SQLite 数据库文件中：`~/.openclaw/aiemas/mas4s.db`。
- **事务与并发**：数据库的多表写入操作必须使用 SQLite 事务（`BEGIN`/`COMMIT`）以保证原子性。必须使用 `WAL` 模式和 `busy_timeout` 妥善处理多连接跨进程访问的并发争抢问题。
- **密码存储红线**：用户的密码明文绝对不可在任何情况下被持久化存储。所有落库密码必须使用 bcrypt 加密（cost factor $\ge$ 10）。

## 3. 认证与安全策略 (Authentication & Security)

- **令牌生成**：系统颁发的会话令牌 (AuthToken) 必须使用 JWT 格式，并采用 HMAC-SHA256 算法签名，加密密钥长度不得低于 32 字节。
- **爆破防护与限流**：核心接口（如 `auth.login`）强制要求实施基于 IP 地址的速率限制（例如：同一 IP 地址每分钟最多允许 10 次失败尝试，超限应返回 `RATE_LIMITED` 错误）。
- **错误模糊化**：登录失败场景下（无论是用户不存在还是密码错误），均对外返回统一的相同错误码 `AUTH_FAILED`，禁止借由错误提示向外部泄漏具体原因（除非是处于特殊的账户业务状态，如 pending/rejected）。
- **安全日志审计**：发生任何情况下的权限校验失败，系统必须输出审计日志记录（需包含关键信息：userId、访问操作类型、目标系统资源、发生的时间戳、结果）。

## 4. 后向兼容与隔离降级 (Backward Compatibility)

- **无缝回退机制（兼容模式）**：当 WebSocket 客户端发起未携带 `auth.masToken` 的连接时，桥接层必须自动回退至平台原有的 token/password 流程。该连接的对应上下文中 `userId` 必须置为 `null`。
- **回退行为兜底**：处于兼容模式（`userId` 为 `null`）时，系统必须跳过各种会话归属和权限层面的校验逻辑，保持该客户端下原有行为全部通过（所有会话可见、所有作用域事件全量广播、不拦截消息等）。

## 5. API 接口约束 (API Interface Constraints)

- **记录新增API ** : 记录新增的API到 `docs/openclaw/websocket_api.md` 中。
- **记录新增事件 ** : 记录新增的事件到 `docs/openclaw/websocket_api.md` 中。
- **记录新增消息格式 ** : 记录新增的消息格式到 `docs/openclaw/websocket_api.md` 中。
