# 实现计划：智能体拓扑关系 DAG 可视化

## 概述

将设计文档中的拓扑 DAG 功能分解为增量式编码任务。从数据模型和存储层开始，逐步构建缓存层、RPC handler、前端组件，最终集成联调。每个任务构建在前一步之上，确保无孤立代码。

## 任务

- [x] 1. 数据模型与存储层
  - [x] 1.1 在 `aiemas/src/models.ts` 中新增 `TopologyEdge` 和 `TopologyTree` 类型定义
    - 添加 `TopologyEdge` 接口（`from: string, to: string`）
    - 添加 `TopologyTree` 接口（`edges: TopologyEdge[]`）
    - _需求: 1.1, 1.3_

  - [x] 1.2 在 `aiemas/src/store/database.ts` 的 `ensureMas4sSchema` 中追加 `agent_topologies` 表 DDL
    - `CREATE TABLE IF NOT EXISTS agent_topologies (rootAgentId TEXT PRIMARY KEY, topology TEXT NOT NULL, updatedAt INTEGER NOT NULL)`
    - _需求: 1.1, 1.2_

  - [x] 1.3 创建 `aiemas/src/store/topology-store.ts`，实现数据库操作函数
    - 实现 `validateEdges(edges)`：校验无自引用边（`from !== to`）
    - 实现 `loadTopology(db, rootAgentId)`：按主键查询单棵拓扑树
    - 实现 `loadAllTopologies(db)`：查询所有拓扑树
    - 实现 `saveTopology(db, rootAgentId, topology)`：`INSERT OR REPLACE` 写入
    - _需求: 1.3, 1.4, 2.2, 2.3_

  - [x] 1.4 编写属性测试：Property 1 — 自引用边校验
    - **Property 1: 自引用边校验**
    - 使用 `fast-check` 生成任意边，验证 `from === to` 时校验失败，`from !== to` 时校验通过
    - 测试文件：`aiemas/src/store/topology-store.property.test.ts`
    - **验证需求: 1.3, 3.4**

  - [x] 1.5 编写属性测试：Property 2 — 保存-加载往返一致性
    - **Property 2: 拓扑树保存-加载往返一致性**
    - 生成合法 `rootAgentId` 和 `TopologyTree`，保存后加载，验证 edges 集合语义等价
    - 测试文件：`aiemas/src/store/topology-store.property.test.ts`
    - **验证需求: 1.4, 2.2, 3.2**

  - [x] 1.6 编写属性测试：Property 3 — 全量列表完整性
    - **Property 3: 全量列表完整性**
    - 保存多棵不同 rootAgentId 的拓扑树，调用 `loadAllTopologies` 验证返回完整且一致
    - 测试文件：`aiemas/src/store/topology-store.property.test.ts`
    - **验证需求: 2.3**

- [x] 2. 检查点 — 存储层验证
  - 确保所有测试通过，如有疑问请向用户确认。

- [x] 3. 内存缓存层
  - [x] 3.1 创建 `aiemas/src/cache/topology-cache.ts`，实现 `TopologyCache` 类
    - 维护 `byRoot: Map<string, TopologyTree>` 完整拓扑树索引
    - 维护 `childrenIndex: Map<string, string[]>` 子节点索引
    - 实现 `load(db)`：从 DB 加载所有拓扑树并构建双层索引
    - 实现 `getTopology(rootAgentId)`：返回完整拓扑树
    - 实现 `getChildren(agentId)`：返回直接子节点列表，不存在时返回空数组
    - 实现 `update(rootAgentId, topology)`：更新拓扑树并重建子节点索引
    - _需求: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [x] 3.2 编写属性测试：Property 4 — 子节点索引正确性
    - **Property 4: 子节点索引正确性**
    - 生成任意 TopologyTree，加载后验证 `getChildren` 返回值与 edges 中 `from→to` 映射一致
    - 测试文件：`aiemas/src/cache/topology-cache.property.test.ts`
    - **验证需求: 5.2, 5.4, 5.5**

  - [x] 3.3 编写属性测试：Property 5 — 缓存一致性
    - **Property 5: 缓存与数据库一致性**
    - 执行 `update` 后验证 `getTopology` 和 `getChildren` 返回值与传入数据一致
    - 测试文件：`aiemas/src/cache/topology-cache.property.test.ts`
    - **验证需求: 3.3, 5.3**

  - [x] 3.4 创建 `aiemas/src/cache/cache-service.ts`，实现 `CacheService` 类
    - 持有 `userCache: UserCache` 和 `topologyCache: TopologyCache` 实例
    - 实现 `init(db)`：统一调用各子缓存的 `load(db)` 方法
    - _需求: 4.1, 4.2, 4.3, 4.4_

- [x] 4. 集成 CacheService 到 TenantService
  - [x] 4.1 修改 `aiemas/src/index.ts`，将 `UserCache` 替换为 `CacheService`
    - 在 `createTenantService` 中实例化 `CacheService` 替代独立的 `UserCache`
    - `init()` 中调用 `cacheService.init(db)` 替代 `cache.load(db)`
    - 现有 `cache.findById` / `cache.findByUsername` 等调用改为 `cacheService.userCache.xxx`
    - 在 `TenantService` 接口上暴露 `cacheService` 属性
    - _需求: 4.4, 4.5_

  - [x] 4.2 修改 `aiemas/src/gateway-bridge/mas4s-gateway-plugin.ts`，将 `CacheService` 和 `db` 传递给 `registerAgentHandlers`
    - 在 `createMas4sGatewayPlugin` 中通过 `tenantService.cacheService` 获取缓存实例
    - 将 `db` 和 `cacheService` 传入 `registerAgentHandlers` 的上下文参数
    - _需求: 4.4, 4.5_

- [x] 5. 检查点 — 缓存层与集成验证
  - 确保所有测试通过，现有功能不受影响，如有疑问请向用户确认。

- [x] 6. RBAC 权限注册与 RPC Handler
  - [x] 6.1 在 `aiemas/src/rbac/permission-checker.ts` 的 `GLOBAL_ROLE_PERMISSIONS` 中注册拓扑 API 权限
    - `"aiemas.agents.topology.list": new Set(["admin", "member", "viewer"])`
    - `"aiemas.agents.topology.save": new Set(["admin", "member"])`
    - _需求: 2.4, 3.5_

  - [x] 6.2 在 `aiemas/src/gateway-bridge/aiemas-agent.ts` 的 `registerAgentHandlers` 中注册拓扑 RPC handler
    - 更新 `AgentContext` 接口，添加 `db` 和 `cacheService` 字段
    - 实现 `aiemas.agents.topology.list` handler：从 TopologyCache 读取，支持按 rootAgentId 查询或返回全部
    - 实现 `aiemas.agents.topology.save` handler：校验 edges → 写入 DB → 同步更新缓存 → 返回 `{ ok: true }`
    - 参数校验：rootAgentId 非空、topology 存在、edges 无自引用
    - _需求: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 7. 检查点 — 后端 API 验证
  - 确保所有测试通过，RPC handler 参数校验和权限控制正确，如有疑问请向用户确认。

- [x] 8. 前端 API 封装与组件入口
  - [x] 8.1 在 `aiemas/ui/mas4s/src/gateway/agents-api.ts` 中新增 `fetchTopology` 和 `saveTopology` 函数
    - `fetchTopology(client, rootAgentId?)` 调用 `aiemas.agents.topology.list`
    - `saveTopology(client, rootAgentId, topology)` 调用 `aiemas.agents.topology.save`
    - _需求: 2.1, 3.1_

  - [x] 8.2 修改 `aiemas/ui/mas4s/src/components/agent-card.ts`，在 card-footer 中添加拓扑图标按钮
    - 在导出按钮之前插入拓扑 SVG 图标按钮
    - 点击触发 `agent-topology` 自定义事件，detail 包含 `agent` 对象
    - 设置 `title="拓扑关系"` 和 `aria-label`
    - _需求: 6.1, 6.2, 6.3_

  - [x] 8.3 修改 `aiemas/ui/mas4s/src/views/agents-view.ts`，监听 `agent-topology` 事件并路由到拓扑视图
    - 新增 `_topologyAgent` 状态，监听 `agent-topology` 事件设置该状态
    - 在 render 中当 `_topologyAgent` 存在时渲染 `topology-view` 组件
    - 处理返回事件清除 `_topologyAgent` 状态
    - _需求: 7.1_

- [x] 9. 拓扑视图组件
  - [x] 9.1 创建 `aiemas/ui/mas4s/src/views/topology-view.ts`，实现查看模式
    - Lit 自定义元素 `topology-view`，接收 `agent` 属性
    - `connectedCallback` 中调用 `agents.list` 获取智能体列表 + `fetchTopology(rootAgentId)` 获取拓扑数据
    - SVG 渲染：矩形节点（显示名称）+ 带箭头有向连线，自动布局算法
    - 左上角返回按钮（触发 `topology-back` 事件），右上角编辑按钮
    - 查看模式禁止拖拽和连线
    - _需求: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [x] 9.2 在 `topology-view.ts` 中实现编辑模式
    - 点击编辑按钮切换到编辑模式
    - 节点上显示输出/输入连接点，支持拖拽创建有向边
    - 点击连线高亮选中，显示删除入口
    - 阻止自引用边（`from === to`）
    - 保存按钮调用 `saveTopology`，成功显示提示，失败显示错误并保留编辑状态
    - 取消按钮丢弃变更返回查看模式
    - _需求: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8, 8.9_

- [x] 10. API 文档记录
  - [x] 10.1 在 `aiemas/docs/openclaw/websocket_api.md` 中记录拓扑 API
    - 记录 `aiemas.agents.topology.list` 的请求参数和响应格式
    - 记录 `aiemas.agents.topology.save` 的请求参数、响应格式和错误码
    - _需求: 9.1, 9.2_

- [x] 11. 最终检查点 — 全量验证
  - 确保所有测试通过，前后端集成正常，如有疑问请向用户确认。

## 备注

- 标记 `*` 的任务为可选任务，可跳过以加速 MVP 交付
- 每个任务引用了具体的需求编号，确保可追溯性
- 检查点任务用于增量验证，确保每个阶段的正确性
- 属性测试验证设计文档中定义的正确性属性，单元测试验证具体示例和边界情况
