# Implementation Plan: ClawHub Registry Integration

## Overview

本实现计划将 ClawHub Registry Integration 功能分解为可增量执行的编码任务。整体按照以下顺序推进：

1. Python 后端健康检查端点
2. 数据库 Schema 与配置持久化层
3. Gateway RPC 处理器与权限注册
4. 前端工具层（验证器、聚合器、API）
5. 前端视图组件（导航、ClawHub 页面、设置区域）
6. 环境变量迁移逻辑
7. API 文档更新

技术栈：TypeScript (Gateway/Frontend)、Python (AgentRegistry 后端)

## Tasks

- [x] 1. AgentRegistry 健康检查端点 (Python)
  - [x] 1.1 在 `AgentRegistry/src/agent_registry/api/routes.py` 中新增 `GET /api/v1/healthy` 路由
    - 使用 `Depends(get_current_user)` 依赖注入进行认证（支持 Bearer Token 和 X-API-Key）
    - 认证通过返回 `{"success": true, "status": "healthy"}`
    - 认证失败由 middleware 返回 401 `{"success": false, "error": "Unauthorized", "code": "UNAUTHORIZED"}`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [x] 1.2 编写 `GET /api/v1/healthy` 端点的 pytest 单元测试
    - 测试有效 Token → 200、有效 API Key → 200、无凭证 → 401、无效凭证 → 401
    - 测试文件: `AgentRegistry/tests/test_healthy_endpoint.py`
    - _Requirements: 1.3, 1.4_

- [x] 2. 数据库 Schema 与配置持久化层
  - [x] 2.1 在 `aiemas/src/store/database.ts` 的 `ensureMas4sSchema()` 中新增 `agent_registry` 表
    - 字段: id (TEXT PK 'default'), api_key, nats_url, nats_token, agent_id, agent_name, bound_agent_id, created_at (INTEGER NOT NULL), updated_at (INTEGER NOT NULL)
    - 使用 `CREATE TABLE IF NOT EXISTS` 确保幂等
    - _Requirements: 2.1, 2.2_

  - [x] 2.2 创建 `aiemas/src/store/agent-registry-config.ts` 配置持久化模块
    - 实现 `AgentRegistryConfigRecord` 接口
    - 实现 `getAgentRegistryConfig(db)`: 从数据库读取配置，空值回退环境变量
    - 实现 `saveAgentRegistryConfig(db, config)`: 使用 INSERT OR REPLACE 保存配置
    - 实现 `migrateFromEnvIfEmpty(db)`: 首次启动时从 `~/.openclaw/.env` 读取 AGENT*REGISTRY*\* 变量并写入数据库
    - 配置解析优先级: DB 值 ?? 环境变量值 ?? null
    - _Requirements: 2.3, 2.4, 2.5_

  - [x] 2.3 编写 `agent-registry-config.ts` 的属性测试
    - **Property 1: Config resolution priority** — 数据库非空值优先于环境变量
    - **Validates: Requirements 2.4**
    - **Property 2: Env migration correctness** — 迁移后数据库值与源环境变量完全一致
    - **Validates: Requirements 2.3**
    - 测试文件: `aiemas/src/store/agent-registry-config.property.test.ts`

- [x] 3. Checkpoint - 确保数据库层测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 4. Gateway RPC 处理器与权限注册
  - [x] 4.1 创建 `aiemas/src/gateway-bridge/clawhub-proxy.ts` HTTP 代理工具
    - 使用 `node:http`/`node:https` 发起请求
    - 支持 GET 方法，携带 `X-API-Key` 头部
    - 10 秒超时，错误映射: 网络错误 → SERVICE_UNREACHABLE, 401 → INVALID_API_KEY, 其他 → REGISTRY_ERROR
    - _Requirements: 6.2, 6.6_

  - [x] 4.2 创建 `aiemas/src/gateway-bridge/clawhub-handlers.ts` RPC 处理器
    - 实现 `registerClawHubHandlers(handlers, deps)` 注册函数
    - `aiemas.clawhub.config.get`: 从 DB 读取配置返回（API Key 掩码处理）
    - `aiemas.clawhub.config.save`: 保存配置，若含 API Key 则先调用 healthy 端点验证
    - `aiemas.clawhub.agents.list`: 代理 GET /api/v1/agents?page=X&page_size=Y
    - `aiemas.clawhub.healthy`: 代理健康检查（用于保存前验证）
    - _Requirements: 3.5, 3.7, 3.8, 6.1, 6.2_

  - [x] 4.3 在 `aiemas/src/rbac/permission-checker.ts` 的 `GLOBAL_ROLE_PERMISSIONS` 中注册权限
    - `aiemas.clawhub.config.get`: `new Set(["admin", "member", "viewer"])`
    - `aiemas.clawhub.agents.list`: `new Set(["admin", "member", "viewer"])`
    - `aiemas.clawhub.config.save`: `new Set(["admin"])`
    - `aiemas.clawhub.healthy`: `new Set(["admin"])`
    - _Requirements: 4.10 (Admin only for write ops)_

  - [x] 4.4 在 `aiemas/src/gateway-bridge/mas4s-gateway-plugin.ts` 中注册 ClawHub handlers
    - 导入 `registerClawHubHandlers` 并在 extraHandlers 构建区域调用
    - 传入 `{ db }` 依赖
    - _Requirements: (架构约束 — AGENTS.md)_

- [x] 5. 前端工具层
  - [x] 5.1 创建 `aiemas/ui/mas4s/src/utils/registry-validators.ts` 输入验证模块
    - `validateApiKey(value)`: 前缀 `api-ar-` + 总长度 64
    - `validateNatsUrl(value)`: 匹配 `nats://{host}:{port}`，port 1-65535，总长度 ≤ 256
    - `validateAgentId(value)`: `[a-zA-Z0-9_-]{1,64}`
    - `validateAgentName(value)`: 长度 1-128
    - 返回 `{ valid: boolean; error?: string }`
    - _Requirements: 3.3, 3.4, 4.2, 4.3, 4.5_

  - [x] 5.2 编写 `registry-validators.ts` 的属性测试
    - **Property 3: API Key format validation** — 以 `api-ar-` 为前缀且总长度 64 时 valid=true
    - **Validates: Requirements 3.3, 3.4**
    - **Property 4: NATS URL format validation** — 匹配 `nats://{host}:{port}` 模式时 valid=true
    - **Validates: Requirements 4.2**
    - **Property 5: Agent ID format validation** — 仅含 `[a-zA-Z0-9_-]` 且长度 1-64 时 valid=true
    - **Validates: Requirements 4.3**
    - **Property 6: Agent Name length validation** — 长度 1-128 时 valid=true
    - **Validates: Requirements 4.5**
    - 测试文件: `aiemas/ui/mas4s/src/utils/registry-validators.property.test.ts`

  - [x] 5.3 创建 `aiemas/ui/mas4s/src/utils/skill-aggregator.ts` 技能聚合模块
    - `aggregateSkills(agents)`: 按技能名称（大小写敏感）聚合，返回 `AggregatedSkill[]`
    - `filterSkills(skills, query)`: 大小写不敏感子字符串匹配过滤
    - _Requirements: 7.1, 7.3, 7.5_

  - [x] 5.4 编写 `skill-aggregator.ts` 的属性测试
    - **Property 8: Skill aggregation groups by unique name** — 每个唯一技能名称恰好一个条目，列出所有声明该技能的 Agent
    - **Validates: Requirements 7.1, 7.3**
    - **Property 9: Skill search filter correctness** — 返回且仅返回名称包含查询子串（不区分大小写）的技能
    - **Validates: Requirements 7.5**
    - 测试文件: `aiemas/ui/mas4s/src/utils/skill-aggregator.property.test.ts`

  - [x] 5.5 创建 `aiemas/ui/mas4s/src/gateway/clawhub-api.ts` 前端 API 层
    - `fetchRegistryAgents(client, page, pageSize)`: 调用 `aiemas.clawhub.agents.list`
    - `fetchRegistryConfig(client)`: 调用 `aiemas.clawhub.config.get`
    - `saveRegistryConfig(client, config)`: 调用 `aiemas.clawhub.config.save`
    - 定义 `RegistryAgent`, `AgentsListResponse`, `RegistryConfig` 类型
    - _Requirements: 6.1, 3.5, 3.9_

- [x] 6. Checkpoint - 确保工具层和 Gateway 层测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. 前端导航与视图组件
  - [x] 7.1 扩展 `aiemas/ui/mas4s/src/controllers/ui-state-controller.ts` 的 NavItem 类型
    - 在 `NavItem` 联合类型中新增 `"clawhub"` 选项（位于 `"discussions"` 之后、`"settings"` 之前）
    - _Requirements: 5.1, 5.2_

  - [x] 7.2 创建 `aiemas/ui/mas4s/src/views/clawhub-view.ts` ClawHub 主视图组件
    - Lit Web Component `<clawhub-view>`
    - 包含 "Agents" 和 "Skills" 两个页签按钮，默认激活 Agents
    - Agents 页签: 调用 `fetchRegistryAgents` 获取数据，卡片网格布局展示
    - Skills 页签: 使用 `aggregateSkills` 聚合数据，支持搜索过滤
    - 加载状态、空状态、错误状态（含重试按钮）、API Key 未配置引导
    - 分页控件: 当前页码、总页数、上一页/下一页按钮
    - _Requirements: 5.3, 5.4, 6.1, 6.3, 6.4, 6.5, 6.6, 6.7, 7.1, 7.2, 7.4, 7.5, 7.6, 7.7_

  - [x] 7.3 创建 `aiemas/ui/mas4s/src/views/clawhub-agent-card.ts` Agent 卡片组件
    - Lit Web Component `<clawhub-agent-card>`
    - 展示: Agent 名称、Agent ID、状态标识（online/idle/busy/offline 颜色区分）
    - 技能标签列表: 最多 5 个，超出以 "+N" 折叠
    - _Requirements: 6.3_

  - [x] 7.4 创建 `aiemas/ui/mas4s/src/views/clawhub-skill-card.ts` Skill 卡片组件
    - Lit Web Component `<clawhub-skill-card>`
    - 展示: 技能名称、所属 Agent 列表（含各 Agent 状态标识）
    - 支持多 Agent 聚合展示
    - _Requirements: 7.2, 7.3_

  - [x] 7.5 创建 `aiemas/ui/mas4s/src/views/settings-registry.ts` 设置页面配置区域组件
    - Lit Web Component `<settings-registry>`
    - API Key 输入框（密码类型 + 显示/隐藏切换）、失焦时格式验证
    - NATS 配置表单: URL、Token、Agent ID（自动生成默认值 `Agent-{uuid}`）、Agent Name、Bound Agent ID（下拉选择本地 Agent）
    - 保存按钮: 调用 `saveRegistryConfig`，显示成功/失败提示
    - 加载时回填已保存配置（API Key 掩码显示）
    - Admin 角色限制: 非 Admin 隐藏 NATS 配置编辑区域
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8, 3.9, 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10_

  - [x] 7.6 在 `app-shell.ts` 中集成 ClawHub 导航项和视图路由
    - 在侧边栏导航菜单中新增 "ClawHub" 导航项（位于 "协作讨论" 之后）
    - 图标风格、字体大小、间距和激活态高亮与现有导航项一致
    - 路由: 当 `nav === "clawhub"` 时渲染 `<clawhub-view>`
    - 在设置视图中集成 `<settings-registry>` 组件
    - _Requirements: 5.1, 5.2_

- [x] 8. 环境变量迁移与启动集成
  - [x] 8.1 在 `mas4s-gateway-plugin.ts` 的初始化流程中调用 `migrateFromEnvIfEmpty(db)`
    - 在数据库初始化后、handler 注册前执行迁移
    - 迁移失败时记录 error 日志但不阻塞启动
    - _Requirements: 2.3, 2.5_

- [x] 9. API 文档更新
  - [x] 9.1 在 `docs/openclaw/websocket_api.md` 中记录新增的 RPC 命令
    - 记录 `aiemas.clawhub.config.get`、`aiemas.clawhub.config.save`、`aiemas.clawhub.agents.list`、`aiemas.clawhub.healthy` 的请求/响应格式
    - 记录权限要求和错误码
    - _Requirements: (AGENTS.md 约束 — 记录新增 API)_

- [x] 10. Final Checkpoint - 确保所有测试通过
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties (Properties 1-9 from design)
- Unit tests validate specific examples and edge cases
- 前端属性测试使用 `fast-check` 库，遵循项目现有 `.property.test.ts` 命名约定
- Python 后端测试使用 `pytest`
- 所有 RPC 命令使用 `aiemas.clawhub.*` 前缀，遵循 AGENTS.md 架构约束
- 配置变更通过数据库 + 热重载信号实现，无需重启服务

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "5.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "5.2", "5.3"] },
    { "id": 2, "tasks": ["2.3", "4.1", "5.4", "5.5"] },
    { "id": 3, "tasks": ["4.2", "4.3"] },
    { "id": 4, "tasks": ["4.4", "7.1"] },
    { "id": 5, "tasks": ["7.2", "7.3", "7.4", "7.5"] },
    { "id": 6, "tasks": ["7.6", "8.1"] },
    { "id": 7, "tasks": ["9.1"] }
  ]
}
```
