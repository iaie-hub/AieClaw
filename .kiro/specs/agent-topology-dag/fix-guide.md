# Agent-Topology-DAG 修复指南

## 问题概述

RPC handlers 已实现但未注册，导致前端无法调用拓扑 API。

---

## 修复步骤

### 步骤 1: 暴露 CacheService 从 TenantService

**文件**: `AieClaw/aiemas/src/index.ts`

在 `TenantService` 接口中添加 `cacheService` 属性：

```typescript
export interface TenantService {
  // ... 现有属性 ...
  cacheService: CacheService;
}
```

**文件**: `AieClaw/aiemas/src/gateway-bridge/bridge.ts`

在 `GatewayAuthBridge` 中添加对 `cacheService` 的访问：

```typescript
export class GatewayAuthBridge {
  constructor(
    private tenantService: TenantService,
    private db: DatabaseSync,
    private llm?: LLMConfig,
    private transcriptStore?: SessionTranscriptStore,
  ) {
    // cacheService 通过 tenantService.cacheService 访问
  }
}
```

---

### 步骤 2: 在 mas4s-gateway-plugin.ts 中注册 handlers

**文件**: `AieClaw/aiemas/src/gateway-bridge/mas4s-gateway-plugin.ts`

在文件顶部添加导入：

```typescript
import { registerAgentHandlers } from "./aiemas-agent.js";
```

在 `createMas4sGatewayPlugin()` 函数中，在 `extraHandlers` 定义完成后添加：

```typescript
export async function createMas4sGatewayPlugin(
  config?: TenantServiceConfig,
): Promise<Mas4sGatewayPlugin> {
  const tenantService = createTenantService(config);
  await tenantService.init();

  // ... 现有代码 ...

  const extraHandlers: SimpleHandlers = {
    // ... 现有的 handlers ...
  };

  // ── 新增: 注册 agent 相关的 handlers ──
  registerAgentHandlers(extraHandlers, {
    plugin: null as any, // 暂时传 null，handlers 不依赖 plugin
    db,
    cacheService: tenantService.cacheService,
    setCurrentRequestContext: (context, client) => {
      // 如果需要设置请求上下文，在这里实现
    },
    clearRequestContext: () => {
      // 如果需要清除请求上下文，在这里实现
    },
  });

  // ... 继续返回 plugin ...
  const plugin: Mas4sGatewayPlugin = {
    bridge,
    tenantService,
    extraHandlers,
    // ... 其他属性 ...
  };

  return plugin;
}
```

---

### 步骤 3: 调整 aiemas-agent.ts 中的 AgentContext

**文件**: `AieClaw/aiemas/src/gateway-bridge/aiemas-agent.ts`

修改 `AgentContext` 接口，使 `plugin` 可选：

```typescript
export interface AgentContext {
  plugin?: Mas4sGatewayPlugin; // 改为可选
  db: DatabaseSync;
  cacheService: CacheService;
  setCurrentRequestContext?: (context: GatewayContext, client: GatewayClient) => void;
  clearRequestContext?: () => void;
}
```

修改 `registerAgentHandlers()` 函数，移除对 `plugin` 的依赖：

```typescript
export function registerAgentHandlers(extraHandlers: Record<string, unknown>, ctx: AgentContext) {
  // 移除对 ctx.setCurrentRequestContext 的使用（如果不需要）
  // 或者在调用时检查是否存在

  // ── aiemas.agents.topology.list ──
  extraHandlers["aiemas.agents.topology.list"] = (opts: {
    params: Record<string, unknown>;
    respond: (ok: boolean, payload: unknown, error: unknown) => void;
  }) => {
    const { params, respond } = opts;
    const rootAgentId = params.rootAgentId as string | undefined;

    if (rootAgentId) {
      const topology = ctx.cacheService.topologyCache.getTopology(rootAgentId);
      respond(true, { rootAgentId, topology: topology ?? { edges: [] } }, null);
    } else {
      const rows = loadAllTopologies(ctx.db);
      respond(true, { topologies: rows }, null);
    }
  };

  // ── aiemas.agents.topology.save ──
  extraHandlers["aiemas.agents.topology.save"] = (opts: {
    params: Record<string, unknown>;
    respond: (ok: boolean, payload: unknown, error: unknown) => void;
  }) => {
    const { params, respond } = opts;
    const rootAgentId = params.rootAgentId as string | undefined;
    const topology = params.topology as { edges?: Array<{ from: string; to: string }> } | undefined;

    if (!rootAgentId) {
      respond(false, null, { code: "INVALID_PARAMS", message: "rootAgentId required" });
      return;
    }

    if (!topology || !Array.isArray(topology.edges)) {
      respond(false, null, { code: "INVALID_PARAMS", message: "topology required" });
      return;
    }

    const validation = validateEdges(topology.edges);
    if (!validation.valid) {
      respond(false, null, { code: "INVALID_PARAMS", message: validation.message });
      return;
    }

    const topologyTree = { edges: topology.edges };
    saveTopology(ctx.db, rootAgentId, topologyTree);
    ctx.cacheService.topologyCache.update(rootAgentId, topologyTree);

    respond(true, { ok: true }, null);
  };
}
```

---

### 步骤 4: 验证修复

运行以下命令验证修复：

```bash
# 1. 类型检查
pnpm tsgo

# 2. 运行 aiemas 相关测试
pnpm test aiemas/src

# 3. 运行属性测试
pnpm test aiemas/src/store/topology-store.property.test.ts
pnpm test aiemas/src/cache/topology-cache.property.test.ts

# 4. 运行完整的 aiemas 测试套件
pnpm test -- aiemas/src
```

---

## 验证清单

修复完成后，验证以下功能：

- [ ] 类型检查通过 (`pnpm tsgo`)
- [ ] 所有属性测试通过 (100 次迭代)
- [ ] 前端可以调用 `aiemas.agents.topology.list`
- [ ] 前端可以调用 `aiemas.agents.topology.save`
- [ ] 拓扑数据正确保存到数据库
- [ ] 拓扑缓存正确更新
- [ ] 前端 UI 正确显示拓扑图
- [ ] 编辑模式可以创建/删除边
- [ ] 保存操作成功并显示提示

---

## 测试场景

### 场景 1: 查询不存在的拓扑

```json
{
  "type": "req",
  "id": "1",
  "method": "aiemas.agents.topology.list",
  "params": { "rootAgentId": "nonexistent" }
}
```

**预期响应**:

```json
{
  "type": "res",
  "id": "1",
  "ok": true,
  "payload": {
    "rootAgentId": "nonexistent",
    "topology": { "edges": [] }
  }
}
```

### 场景 2: 保存有效的拓扑

```json
{
  "type": "req",
  "id": "2",
  "method": "aiemas.agents.topology.save",
  "params": {
    "rootAgentId": "aie-iaas",
    "topology": {
      "edges": [
        { "from": "aie-iaas", "to": "aieiaas-resource" },
        { "from": "aie-iaas", "to": "aieiaas-model" }
      ]
    }
  }
}
```

**预期响应**:

```json
{
  "type": "res",
  "id": "2",
  "ok": true,
  "payload": { "ok": true }
}
```

### 场景 3: 保存自引用边（应失败）

```json
{
  "type": "req",
  "id": "3",
  "method": "aiemas.agents.topology.save",
  "params": {
    "rootAgentId": "aie-iaas",
    "topology": {
      "edges": [{ "from": "aie-iaas", "to": "aie-iaas" }]
    }
  }
}
```

**预期响应**:

```json
{
  "type": "res",
  "id": "3",
  "ok": false,
  "error": { "code": "INVALID_PARAMS", "message": "自引用边不允许" }
}
```

### 场景 4: 查询所有拓扑

```json
{
  "type": "req",
  "id": "4",
  "method": "aiemas.agents.topology.list",
  "params": {}
}
```

**预期响应**:

```json
{
  "type": "res",
  "id": "4",
  "ok": true,
  "payload": {
    "topologies": [
      {
        "rootAgentId": "aie-iaas",
        "topology": {
          "edges": [
            { "from": "aie-iaas", "to": "aieiaas-resource" },
            { "from": "aie-iaas", "to": "aieiaas-model" }
          ]
        }
      }
    ]
  }
}
```

---

## 预期结果

修复完成后：

1. ✅ 前端可以成功调用拓扑 API
2. ✅ 拓扑数据正确持久化到数据库
3. ✅ 拓扑缓存正确维护
4. ✅ 前端 UI 可以显示和编辑拓扑
5. ✅ 所有属性测试通过
6. ✅ 完整的端到端功能工作
