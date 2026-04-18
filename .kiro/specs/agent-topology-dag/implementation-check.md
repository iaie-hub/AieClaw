# Agent-Topology-DAG 实现检查报告

**检查日期**: 2026-04-09  
**检查范围**: 需求文档 vs 设计文档 vs 实现代码

---

## 执行摘要

agent-topology-dag 功能的实现**大部分完成**，但存在**一个关键缺失**：RPC handlers 未在 `mas4s-gateway-plugin.ts` 中注册。

### 完成度统计

| 组件                                 | 状态        | 备注                                                     |
| ------------------------------------ | ----------- | -------------------------------------------------------- |
| 数据模型 (TopologyTree/TopologyEdge) | ✅ 完成     | 在 `models.ts` 中定义                                    |
| 数据库表 (agent_topologies)          | ✅ 完成     | 在 `database.ts` 的 `ensureMas4sSchema` 中创建           |
| Topology Store                       | ✅ 完成     | `topology-store.ts` 实现了所有需要的函数                 |
| Topology Cache                       | ✅ 完成     | `topology-cache.ts` 实现了双层索引                       |
| CacheService                         | ✅ 完成     | `cache-service.ts` 集中管理所有缓存                      |
| RPC Handlers 实现                    | ✅ 完成     | `aiemas-agent.ts` 实现了 handlers                        |
| **RPC Handlers 注册**                | ❌ **缺失** | **未在 `mas4s-gateway-plugin.ts` 中注册**                |
| RBAC 权限                            | ✅ 完成     | 在 `permission-checker.ts` 中注册                        |
| 前端 API 封装                        | ✅ 完成     | `agents-api.ts` 实现了 `fetchTopology` 和 `saveTopology` |
| 前端 Topology View                   | ✅ 完成     | `topology-view.ts` 实现了查看和编辑模式                  |
| Agent Card 拓扑按钮                  | ✅ 完成     | `agent-card.ts` 添加了拓扑按钮                           |
| Agents View 路由                     | ✅ 完成     | `agents-view.ts` 处理了 `agent-topology` 事件            |
| API 文档                             | ✅ 完成     | `websocket_api.md` 记录了完整的 API 文档                 |
| 属性测试                             | ✅ 完成     | 实现了 5 个属性的 PBT 测试                               |

---

## 详细检查结果

### 需求 1: 拓扑树整体持久化存储

**状态**: ✅ 完成

- [x] `agent_topologies` 表已在 `database.ts` 中创建
- [x] 表结构包含 `rootAgentId` (PRIMARY KEY)、`topology` (JSON TEXT)、`updatedAt` (INTEGER)
- [x] `topology-store.ts` 实现了 `saveTopology()` 使用 `INSERT OR REPLACE`
- [x] `validateEdges()` 校验无自引用边

**验证代码**:

```typescript
// database.ts, line ~130
CREATE TABLE IF NOT EXISTS agent_topologies (
  rootAgentId TEXT PRIMARY KEY,
  topology    TEXT NOT NULL,
  updatedAt   INTEGER NOT NULL
);
```

---

### 需求 2: 拓扑关系查询 API

**状态**: ✅ 实现完成，❌ 未注册

- [x] `aiemas-agent.ts` 中实现了 `aiemas.agents.topology.list` handler
- [x] 支持可选参数 `rootAgentId`
- [x] 返回格式正确（单棵或列表）
- [x] 权限在 `permission-checker.ts` 中注册为 `["admin", "member", "viewer"]`
- ❌ **Handler 未在 `mas4s-gateway-plugin.ts` 的 `extraHandlers` 中注册**

**缺失的注册代码**:

```typescript
// 应该在 mas4s-gateway-plugin.ts 的 extraHandlers 中添加
// 但目前不存在
```

---

### 需求 3: 拓扑关系保存 API

**状态**: ✅ 实现完成，❌ 未注册

- [x] `aiemas-agent.ts` 中实现了 `aiemas.agents.topology.save` handler
- [x] 接受 `rootAgentId` 和 `topology` 参数
- [x] 校验自引用边，返回 `INVALID_PARAMS` 错误
- [x] 保存成功后更新缓存
- [x] 权限在 `permission-checker.ts` 中注册为 `["admin", "member"]`
- ❌ **Handler 未在 `mas4s-gateway-plugin.ts` 的 `extraHandlers` 中注册**

---

### 需求 4: 全局缓存服务 (CacheService)

**状态**: ✅ 完成

- [x] `cache-service.ts` 实现了 `CacheService` 类
- [x] 持有 `userCache` 和 `topologyCache` 实例
- [x] 提供 `init(db)` 方法统一初始化
- [x] 提供 `userCache` 和 `topologyCache` 属性访问器

**验证代码**:

```typescript
// cache-service.ts
export class CacheService {
  readonly userCache: UserCache;
  readonly topologyCache: TopologyCache;

  constructor() {
    this.userCache = new UserCache();
    this.topologyCache = new TopologyCache();
  }

  init(db: DatabaseSync): void {
    this.userCache.load(db);
    this.topologyCache.load(db);
  }
}
```

---

### 需求 5: 内存拓扑缓存

**状态**: ✅ 完成

- [x] `topology-cache.ts` 维护两层数据结构
  - `byRoot`: `Map<string, TopologyTree>` 存储完整拓扑树
  - `childrenIndex`: `Map<string, string[]>` 存储子节点列表
- [x] `load()` 方法从数据库加载并构建索引
- [x] `update()` 方法同步更新缓存和索引
- [x] `getChildren()` 方法返回直接子节点列表
- [x] `getTopology()` 方法返回完整拓扑树

**验证代码**:

```typescript
// topology-cache.ts
export class TopologyCache {
  private readonly byRoot = new Map<string, TopologyTree>();
  private readonly childrenIndex = new Map<string, string[]>();

  load(db: DatabaseSync): void { ... }
  getTopology(rootAgentId: string): TopologyTree | undefined { ... }
  getChildren(agentId: string): string[] { ... }
  update(rootAgentId: string, topology: TopologyTree): void { ... }
}
```

---

### 需求 6: 智能体卡片拓扑入口

**状态**: ✅ 完成

- [x] `agent-card.ts` 在 card-footer 中添加了拓扑图标按钮
- [x] 按钮位于导出按钮之前
- [x] 点击触发 `agent-topology` 自定义事件
- [x] 事件 detail 包含 `agent` 对象

**验证代码**:

```typescript
// agent-card.ts, line ~288
private _onTopology = (e: Event) => {
  e.stopPropagation();
  this.dispatchEvent(
    new CustomEvent("agent-topology", {
      detail: { agent: this.agent },
      bubbles: true,
      composed: true,
    }),
  );
};
```

---

### 需求 7: 拓扑关系查看视图

**状态**: ✅ 完成

- [x] `topology-view.ts` 作为二级页面展示
- [x] 调用 `agents.list` 获取智能体列表
- [x] 调用 `aiemas.agents.topology.list` 获取拓扑数据
- [x] 将智能体渲染为 SVG 矩形节点
- [x] 将拓扑边渲染为带箭头的有向连线
- [x] 左上角返回按钮
- [x] 右上角编辑按钮
- [x] 查看模式禁止拖拽

**验证代码**:

```typescript
// topology-view.ts
@customElement("topology-view")
export class TopologyView extends LitElement {
  private async _loadData() {
    const [agentsPayload, topoPayload] = await Promise.all([
      fetchAgents(client),
      fetchTopology(client, this.agent.id),
    ]);
    // ...
  }
}
```

---

### 需求 8: 拓扑关系编辑器

**状态**: ✅ 完成

- [x] 编辑模式允许拖拽连接点创建边
- [x] 从源节点输出连接点拖拽到目标节点输入连接点
- [x] 点击连线高亮并显示删除操作
- [x] 基于原生 JavaScript 和 SVG 实现
- [x] 提供保存和取消按钮
- [x] 保存时调用 `aiemas.agents.topology.save`
- [x] 显示成功/失败提示
- [x] 阻止自引用边

**验证代码**:

```typescript
// topology-view.ts
private _onConnectorMouseDown(nodeId: string, e: MouseEvent) {
  e.preventDefault();
  this._dragging = true;
  this._dragFrom = nodeId;
  // ...
}

private _onNodeMouseUp(nodeId: string) {
  if (!this._dragging) return;
  if (this._dragFrom && this._dragFrom !== nodeId) {
    const exists = this._editEdges.some(
      (e) => e.from === this._dragFrom && e.to === nodeId,
    );
    if (!exists) {
      this._editEdges = [...this._editEdges, { from: this._dragFrom, to: nodeId }];
    }
  }
  this._dragging = false;
}
```

---

### 需求 9: API 文档记录

**状态**: ✅ 完成

- [x] `websocket_api.md` 记录了 `aiemas.agents.topology.list` 方法
- [x] 记录了请求参数（可选 `rootAgentId`）
- [x] 记录了响应格式（单棵或列表）
- [x] 记录了 `aiemas.agents.topology.save` 方法
- [x] 记录了请求参数、响应格式和错误码

**验证代码**:

```markdown
# websocket_api.md, 第五部分

## 五、拓扑关系 API (Topology API Detail)

### 1. 查询拓扑关系 (aiemas.agents.topology.list)

...

### 2. 保存拓扑关系 (aiemas.agents.topology.save)

...
```

---

## 关键缺失: RPC Handlers 注册

### 问题描述

`aiemas-agent.ts` 中实现了 `registerAgentHandlers()` 函数，该函数定义了两个 RPC handlers：

- `aiemas.agents.topology.list`
- `aiemas.agents.topology.save`

但是，这个函数**从未被调用**，handlers 也**从未被注册**到 `mas4s-gateway-plugin.ts` 的 `extraHandlers` 中。

### 影响

- 前端调用 `aiemas.agents.topology.list` 或 `aiemas.agents.topology.save` 时会收到 "method not found" 错误
- 整个拓扑功能在运行时无法工作

### 修复方案

需要在 `mas4s-gateway-plugin.ts` 的 `createMas4sGatewayPlugin()` 函数中调用 `registerAgentHandlers()`：

```typescript
// 在 mas4s-gateway-plugin.ts 中，大约在 extraHandlers 定义之后

import { registerAgentHandlers } from "./aiemas-agent.js";

// ... 在 createMas4sGatewayPlugin 中 ...

const extraHandlers: SimpleHandlers = {
  // ... 现有的 handlers ...
};

// 注册 agent 相关的 handlers（包括 topology）
registerAgentHandlers(extraHandlers, {
  plugin: null as any, // 需要传入 plugin 实例
  db,
  cacheService: tenantService.cacheService, // 需要从 TenantService 暴露
  setCurrentRequestContext: (context, client) => {
    /* ... */
  },
  clearRequestContext: () => {
    /* ... */
  },
});

// ... 继续返回 plugin ...
```

### 额外需求

1. **TenantService 需要暴露 cacheService**
   - 当前 `CacheService` 在 `createTenantService` 中创建但未暴露
   - 需要在 `TenantService` 接口中添加 `cacheService` 属性

2. **aiemas-agent.ts 中的 AgentContext 需要调整**
   - 当前期望 `plugin: Mas4sGatewayPlugin`
   - 但在注册时 plugin 还未完全创建
   - 可能需要重构为不依赖 plugin 实例

---

## 属性测试覆盖

**状态**: ✅ 完成

所有 5 个属性都有对应的 PBT 测试：

| 属性                         | 测试文件                          | 状态          |
| ---------------------------- | --------------------------------- | ------------- |
| Property 1: 自引用边校验     | `topology-store.property.test.ts` | ✅ 100 次迭代 |
| Property 2: 保存-加载往返    | `topology-store.property.test.ts` | ✅ 100 次迭代 |
| Property 3: 全量列表完整性   | `topology-store.property.test.ts` | ✅ 100 次迭代 |
| Property 4: 子节点索引正确性 | `topology-cache.property.test.ts` | ✅ 100 次迭代 |
| Property 5: 缓存一致性       | `topology-cache.property.test.ts` | ✅ 100 次迭代 |

---

## 前端集成检查

**状态**: ✅ 完成

- [x] `agents-view.ts` 监听 `agent-topology` 事件
- [x] 设置 `_topologyAgent` 状态
- [x] 在 render 中根据 `_topologyAgent` 切换到 `topology-view`
- [x] `topology-view` 监听 `topology-back` 事件返回列表

**验证代码**:

```typescript
// agents-view.ts, render 方法
if (this._topologyAgent) {
  return html`
    <topology-view
      .agent=${this._topologyAgent}
      @topology-back=${() => {
        this._topologyAgent = null;
      }}
    ></topology-view>
  `;
}
```

---

## 总结

### 已完成的工作

✅ 数据模型定义  
✅ 数据库 schema 创建  
✅ Store 层实现  
✅ Cache 层实现  
✅ CacheService 集中管理  
✅ RPC handlers 实现  
✅ RBAC 权限注册  
✅ 前端 API 封装  
✅ 前端 UI 组件  
✅ 前端路由集成  
✅ API 文档  
✅ 属性测试

### 待完成的工作

❌ **RPC handlers 注册** (关键)

- 需要在 `mas4s-gateway-plugin.ts` 中调用 `registerAgentHandlers()`
- 需要暴露 `cacheService` 从 `TenantService`
- 需要处理 `AgentContext` 的依赖关系

### 建议

1. **立即修复**: 在 `mas4s-gateway-plugin.ts` 中注册 handlers
2. **重构**: 调整 `TenantService` 接口以暴露 `cacheService`
3. **测试**: 运行完整的集成测试验证端到端功能
4. **文档**: 更新 `aiemas/AGENTS.md` 记录 CacheService 的使用方式
