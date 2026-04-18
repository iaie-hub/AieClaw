# 需求文档：智能体拓扑关系 DAG 可视化

## 简介

在 AIEMAS 多智能体协作架构中，编排 Agent（aie-iaas）通过 `sessions_send` 将任务调度给子 Agent（aieiaas-resource、aieiaas-model、aieiaas-task、aieiaas-monitor）。这些 Agent 之间的调度关系本质上是有向无环图（DAG）。本功能为系统架构师提供一个前端可视化界面，以"拖拽连线"的流程图方式动态配置和查看智能体之间的父子调度拓扑关系，并将拓扑数据持久化到 mas4s.db 中。

## 术语表

- **Topology_Store**：mas4s.db 中存储智能体拓扑树的数据表及其操作层。每棵拓扑树以根节点 Agent ID 为索引，整棵树以 JSON 文档形式存储
- **Topology_Document**：一棵完整的拓扑树 JSON 文档，包含 `edges`（有向边数组），以 `rootAgentId` 为主键索引
- **CacheService**：全局缓存服务对象（`aiemas/src/cache/cache-service.ts`），集中管理所有内存缓存实例（UserCache、TopologyCache 等），在 `TenantService` 中创建并统一初始化
- **Topology_Cache**：内存中的拓扑关系缓存，为每个 agent（不仅是根节点）建立子节点索引（`Map<string, string[]>`），用于 `sessions_send` 路由时任意 agent 都能快速查找其直接子 Agent，避免每次请求都查询数据库。作为 CacheService 的子缓存实例集中管理
- **Topology_API**：通过 `mas4s-gateway-plugin.ts` 的 `extraHandlers` 暴露的 RPC 方法集合，用于查询和保存拓扑关系
- **Topology_View**：前端二级页面组件，以 SVG 流程图方式展示智能体之间的 DAG 拓扑关系
- **Topology_Editor**：Topology_View 的编辑模式，基于原生 JavaScript 和 SVG 实现的轻量级流程图编辑器
- **Agent_Card**：前端智能体卡片组件（`agent-card.ts`），展示单个智能体的基本信息
- **Edge**：拓扑图中的一条有向边，表示从父 Agent 到子 Agent 的调度关系
- **Node**：拓扑图中的一个节点，对应一个已注册的智能体
- **TopologyTree**：拓扑树的 TypeScript 类型定义，结构为 `{ edges: Array<{ from: string, to: string }> }`。节点信息从 `agents.list` 获取，前端每次自动布局，不持久化节点位置

## 需求

### 需求 1：拓扑树整体持久化存储

**用户故事：** 作为系统架构师，我希望智能体之间的拓扑调度关系以整棵树为单位持久化存储（以根节点 Agent ID 为索引），以便在系统重启后仍然保留配置，并且能够高效地按根节点重建完整拓扑。

#### 验收标准

1. THE Topology_Store SHALL 在 mas4s.db 中创建 `agent_topologies` 表，包含 `rootAgentId`（根 Agent ID，TEXT 类型，PRIMARY KEY）、`topology`（JSON TEXT，存储完整的 TopologyTree 文档）、`updatedAt`（更新时间戳，INTEGER）字段
2. THE Topology_Store SHALL 使用 `ensureMas4sSchema` 函数中的 `CREATE TABLE IF NOT EXISTS` 语句创建表结构，与现有 schema 初始化方式保持一致
3. WHEN 保存一棵拓扑树时，THE Topology_Store SHALL 验证 `topology.edges` 中每条边的 `from` 与 `to` 不相同
4. WHEN 保存一棵拓扑树时，THE Topology_Store SHALL 使用 `INSERT OR REPLACE` 语句以 `rootAgentId` 为主键写入整个 TopologyTree JSON 文档，保证同一根节点的拓扑数据为原子性覆盖更新

### 需求 2：拓扑关系查询 API

**用户故事：** 作为前端开发者，我希望通过 RPC 接口查询智能体之间的拓扑关系，支持按根节点查询单棵拓扑树或查询所有拓扑树，以便在前端渲染拓扑图。

#### 验收标准

1. THE Topology_API SHALL 提供 `aiemas.agents.topology.list` RPC 方法，接受可选参数 `{ rootAgentId?: string }`
2. WHEN 调用 `aiemas.agents.topology.list` 且提供了 `rootAgentId` 参数时，THE Topology_API SHALL 返回该根节点对应的单棵拓扑树，格式为 `{ rootAgentId: string, topology: TopologyTree }`；若该根节点不存在拓扑数据，则返回 `{ rootAgentId: string, topology: { edges: [] } }`
3. WHEN 调用 `aiemas.agents.topology.list` 且未提供 `rootAgentId` 参数时，THE Topology_API SHALL 返回所有拓扑树的列表，格式为 `{ topologies: Array<{ rootAgentId: string, topology: TopologyTree }> }`
4. THE Topology_API SHALL 在 `GLOBAL_ROLE_PERMISSIONS` 中将 `aiemas.agents.topology.list` 注册为只读权限，允许 admin、member、viewer 角色访问

### 需求 3：拓扑关系保存 API

**用户故事：** 作为系统架构师，我希望通过 RPC 接口保存编辑后的拓扑关系，以整棵树为单位提交，以便持久化我的配置变更。

#### 验收标准

1. THE Topology_API SHALL 提供 `aiemas.agents.topology.save` RPC 方法，接受参数 `{ rootAgentId: string, topology: { edges: Array<{ from: string, to: string }> } }`
2. WHEN 调用 `aiemas.agents.topology.save` 时，THE Topology_API SHALL 将传入的 TopologyTree 文档以 `rootAgentId` 为主键写入 Topology_Store，覆盖该根节点的旧拓扑数据
3. WHEN 保存成功时，THE Topology_API SHALL 同步更新 Topology_Cache 中对应 `rootAgentId` 的完整拓扑树缓存及该拓扑树涉及的所有 agentId 的子节点索引，然后返回 `{ ok: true }` 响应
4. IF 传入的 `topology.edges` 中存在 `from` 等于 `to` 的边，THEN THE Topology_API SHALL 返回错误码 `INVALID_PARAMS` 和描述信息 "自引用边不允许"
5. THE Topology_API SHALL 在 `GLOBAL_ROLE_PERMISSIONS` 中将 `aiemas.agents.topology.save` 注册为写操作权限，允许 admin、member 角色访问

### 需求 4：全局缓存服务（CacheService）

**用户故事：** 作为系统开发者，我希望 AIEMAS 有一个集中管理的全局缓存服务对象，将现有分散的内存缓存（UserCache、登录限流等）和新增的拓扑缓存统一收口，以便所有内存缓存的生命周期、初始化和同步逻辑集中维护。

#### 验收标准

1. THE CacheService SHALL 作为独立类实现在 `aiemas/src/cache/cache-service.ts` 中，集中管理所有内存缓存实例
2. THE CacheService SHALL 持有以下缓存实例：(a) `UserCache`（现有用户缓存，从 `createTenantService` 闭包中迁移）；(b) `TopologyCache`（新增拓扑缓存）；后续新增的内存缓存也必须注册到 CacheService 中
3. THE CacheService SHALL 提供 `init(db: DatabaseSync)` 方法，在系统启动时统一从 SQLite 加载所有缓存数据（调用各子缓存的 load 方法）
4. THE CacheService SHALL 提供 `userCache`、`topologyCache` 等属性访问器，供 `TenantService`、`GatewayAuthBridge` 和 RPC handler 使用
5. THE CacheService 的实例 SHALL 在 `createTenantService` 中创建并通过 `TenantService` 接口暴露，确保与现有 `TenantService` 生命周期一致

### 需求 5：内存拓扑缓存

**用户故事：** 作为系统开发者，我希望拓扑关系在内存中为每个 agent 建立子节点索引，以便任意 agent 发起 `sessions_send` 路由时都能快速查找其直接子 Agent，无需每次请求都查询 SQLite 数据库。

#### 验收标准

1. THE Topology_Cache SHALL 维护两层数据结构：(a) `Map<string, TopologyTree>` 存储以 `rootAgentId` 为键的完整拓扑树文档（用于前端查询和持久化同步）；(b) `Map<string, string[]>` 存储以任意 `agentId` 为键的直接子节点列表（用于路由快速查找）
2. WHEN 系统启动时，THE Topology_Cache SHALL 从 Topology_Store（SQLite）中加载所有拓扑树数据，填充完整拓扑树缓存，并遍历所有拓扑树的 `edges` 为每个出现在 `from` 字段中的 agentId 构建直接子节点索引
3. WHEN `aiemas.agents.topology.save` 被调用并成功写入数据库后，THE Topology_Cache SHALL 同步更新对应 `rootAgentId` 的完整拓扑树缓存，并重建该拓扑树涉及的所有 agentId 的子节点索引
4. THE Topology_Cache SHALL 提供 `getChildren(agentId: string): string[]` 方法，从子节点索引中查找指定 agent 的所有直接子 Agent ID 列表，用于路由决策；该方法适用于任意 agent（不限于根节点）
5. WHEN 子节点索引中不存在指定 `agentId` 的条目时，THE Topology_Cache 的 `getChildren` 方法 SHALL 返回空数组
6. THE Topology_Cache SHALL 提供 `getTopology(rootAgentId: string): TopologyTree | undefined` 方法，返回指定根节点的完整拓扑树文档，用于前端查询 API

### 需求 6：智能体卡片拓扑入口

**用户故事：** 作为系统架构师，我希望在智能体卡片上看到一个拓扑关系入口按钮，以便快速查看该智能体的调度拓扑。

#### 验收标准

1. THE Agent_Card SHALL 在卡片底部操作栏（card-footer）中添加一个拓扑图标按钮，位于导出按钮之前
2. WHEN 用户点击拓扑图标按钮时，THE Agent_Card SHALL 触发 `agent-topology` 自定义事件，事件 detail 中包含当前智能体的 `agent` 对象
3. THE Agent_Card 的拓扑图标按钮 SHALL 使用 SVG 图标表示有向图/网络拓扑含义，并设置 `title="拓扑关系"` 和对应的 `aria-label`

### 需求 7：拓扑关系查看视图

**用户故事：** 作为系统架构师，我希望在一个二级页面中以流程图方式查看智能体之间的 DAG 拓扑关系，以便直观理解调度架构。

#### 验收标准

1. WHEN 用户从 Agent_Card 点击拓扑按钮时，THE Topology_View SHALL 作为二级页面展示，替换当前的智能体列表视图
2. THE Topology_View SHALL 调用 `agents.list` 获取智能体列表，再调用 `aiemas.agents.topology.list` 并传入当前智能体的 `agentId` 作为 `rootAgentId` 参数获取该智能体的拓扑树数据
3. THE Topology_View SHALL 将每个智能体渲染为 SVG 矩形节点，节点内显示智能体名称
4. THE Topology_View SHALL 将每条拓扑边渲染为带箭头的 SVG 有向连线，从父节点指向子节点
5. THE Topology_View SHALL 在页面左上角提供返回按钮，点击后返回智能体列表视图
6. THE Topology_View SHALL 在页面右上角提供编辑按钮，点击后切换到 Topology_Editor 编辑模式
7. WHILE 处于查看模式时，THE Topology_View SHALL 禁止节点拖拽和连线操作

### 需求 8：拓扑关系编辑器

**用户故事：** 作为系统架构师，我希望通过拖拽连线的方式编辑智能体之间的调度拓扑关系，以便灵活配置多智能体协作架构。

#### 验收标准

1. WHEN 用户点击编辑按钮进入编辑模式时，THE Topology_Editor SHALL 允许用户通过拖拽节点上的连接点来创建新的有向边
2. WHEN 用户从一个节点的输出连接点拖拽到另一个节点的输入连接点时，THE Topology_Editor SHALL 创建一条从源节点到目标节点的有向边，并实时渲染该连线
3. WHEN 用户点击已有的连线时，THE Topology_Editor SHALL 高亮选中该连线并显示删除操作入口
4. WHEN 用户确认删除选中的连线时，THE Topology_Editor SHALL 从当前拓扑图中移除该边
5. THE Topology_Editor SHALL 基于原生 JavaScript 和 SVG 技术实现，不依赖第三方流程图库
6. THE Topology_Editor SHALL 在编辑模式下提供保存按钮和取消按钮；点击保存时调用 `aiemas.agents.topology.save` 并传入当前根节点的 `rootAgentId` 和 TopologyTree（仅包含 edges）持久化当前拓扑，点击取消时丢弃未保存的变更并返回查看模式
7. WHEN 保存操作成功时，THE Topology_Editor SHALL 显示保存成功的提示信息
8. IF 保存操作失败，THEN THE Topology_Editor SHALL 显示错误提示信息，保留当前编辑状态不丢失
9. IF 用户尝试创建一条 from 等于 to 的自引用边，THEN THE Topology_Editor SHALL 阻止该操作并忽略此次拖拽

### 需求 9：API 文档记录

**用户故事：** 作为开发者，我希望新增的拓扑 API 有完整的文档记录，以便了解接口的使用方式。

#### 验收标准

1. THE Topology_API SHALL 在 `docs/openclaw/websocket_api.md` 中记录 `aiemas.agents.topology.list` 方法的请求参数（含可选 `rootAgentId`）和响应格式（单棵拓扑树或拓扑树列表）
2. THE Topology_API SHALL 在 `docs/openclaw/websocket_api.md` 中记录 `aiemas.agents.topology.save` 方法的请求参数（`rootAgentId` + `topology` JSON 文档）、响应格式和错误码
