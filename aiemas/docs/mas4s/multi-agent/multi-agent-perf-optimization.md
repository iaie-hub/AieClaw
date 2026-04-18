# 多 Agent 消息链路性能优化

## 背景

多 Agent 场景下（根 agent 转发请求到子 agent），消息链路端到端延迟 33-45 秒，其中 agent 初始化阶段占 30+ 秒。用户体验为"发送消息后长时间无响应"。

通过在关键路径上添加性能日志，精确定位到 3 个瓶颈函数：

| 瓶颈 | 函数                       | 耗时    | 根因                                                                      |
| ---- | -------------------------- | ------- | ------------------------------------------------------------------------- |
| #1   | `ensureOpenClawModelsJson` | 11-35s  | 37 个 provider plugin 串行执行 catalog 发现，且不同 agentDir 无法共享缓存 |
| #2   | `discoverAuthStorage`      | 1.3s/次 | 每次 agent 运行都重新读取 auth 文件，无进程级缓存                         |
| #3   | `resolveModelAsync`        | 1.9s/次 | 依赖 #2 的结果，且 `resolveDynamicAttempt` 无缓存                         |

---

## 优化方案

### 方案 1：provider discovery 进程级缓存

**文件**：`src/agents/models-config.providers.implicit.ts`

`resolveImplicitProviders` 的结果只依赖 config 中 provider 的结构（baseUrl、api、models）和 env 变量，与 agentDir 无关。在函数入口增加进程级缓存，key 为 provider 结构 + env 的 fingerprint（排除 apiKey 等 secret 字段），无 TTL。

fingerprint 排除 secret 字段是关键——不同 agentDir 的 secret resolution 结果不同，但不影响 provider 列表结构。不排除会导致子 agent 首次请求 cache miss。

缓存命中时直接返回；cache miss 时执行 discovery 并写入缓存。并发调用通过 `pending` Promise 去重，避免重复执行。

### 方案 2：auth storage 进程级缓存

**文件**：`src/agents/pi-model-discovery.ts`

`discoverAuthStorage` 和 `discoverModels` 增加进程级缓存，key 为 agentDir，用 `fs.statSync` 的 mtime 做失效检测，无 TTL。文件未变时直接返回缓存的 AuthStorage/ModelRegistry 实例。

`discoverAuthStorage` 创建缓存条目时同时预建 ModelRegistry，使后续 `discoverModels` 调用也能命中。

### 方案 3：provider catalog 并行发现

**文件**：`src/agents/models-config.providers.implicit.ts`

`resolvePluginImplicitProviders` 中将同一 order 内的 provider catalog 发现从 `for...of await`（串行）改为 `Promise.allSettled`（并行）。37 个 plugin 的串行累计耗时从 11-35s 压缩到最慢单个 plugin 的耗时（~6s）。

结果按原始数组顺序处理，保持合并确定性。

### 方案 4：gateway 启动预热

**文件**：`src/gateway/agent-perf-warmup.ts`（新增），`src/gateway/server.impl.ts`（3 行调用）

gateway 启动完成后，异步（fire-and-forget）遍历 `listAgentIds(config)` 中的所有 agent，对每个 agent 调用 `ensureOpenClawModelsJson(config, agentDir)` + `discoverAuthStorage(agentDir)` + `discoverModels()`，模拟 agent 运行时的完整初始化路径，填充方案 1/2 的所有缓存层。

不阻塞 gateway 启动，失败不影响正常功能。预热未完成时来的请求走正常路径（方案 1/3 兜底）。

---

## 优化效果

### agent 初始化耗时对比

| 场景                      | 优化前 | 优化后 | 提升    |
| ------------------------- | ------ | ------ | ------- |
| 请求 1 根 agent（冷启动） | ~33s   | ~8.6s  | **74%** |
| 请求 1 子 agent（冷启动） | ~35s   | ~8.2s  | **77%** |
| 请求 2 根 agent           | ~33s   | ~3.1s  | **91%** |
| 请求 2 子 agent           | ~35s   | ~3.7s  | **89%** |
| 请求 3 根 agent           | ~33s   | ~3.0s  | **91%** |
| 请求 3 子 agent           | ~35s   | ~3.1s  | **91%** |

### 各瓶颈函数耗时对比

| 函数                           | 优化前         | 优化后（请求 1） | 优化后（请求 2+） |
| ------------------------------ | -------------- | ---------------- | ----------------- |
| `ensureModelsJson`（子 agent） | 22-35s         | 2.5s             | 0.2s              |
| `resolveImplicitProviders`     | 11-35s（串行） | cache hit（0ms） | cache hit（0ms）  |
| `discoverAuthStorage`          | 1.3s           | 7-10ms           | 5-10ms            |
| `resolveModelAsync`            | 5-7s           | 2-3s             | 0.06-0.6s         |

### 剩余耗时构成（请求 2+ 稳态）

| 阶段                        | 耗时      | 说明                         |
| --------------------------- | --------- | ---------------------------- |
| `createOpenClawCodingTools` | 1.5-2.8s  | tool 创建固定开销            |
| `resolveDynamicAttempt`     | 0.05-0.5s | provider runtime hook        |
| `ensureSkillSnapshot`       | 0.3-0.4s  | skill 快照加载               |
| `ensureModelsJson`          | 0.2s      | normalize + noop             |
| 其他                        | 0.1-0.3s  | session state、directives 等 |
| **总计**                    | **~3s**   |                              |

---

## 修改文件清单

| 文件                                             | 方案 | 改动说明                                       |
| ------------------------------------------------ | ---- | ---------------------------------------------- |
| `src/agents/models-config.providers.implicit.ts` | 1+3  | provider discovery 进程级缓存 + catalog 并行化 |
| `src/agents/pi-model-discovery.ts`               | 2    | auth storage / model registry mtime 缓存       |
| `src/gateway/agent-perf-warmup.ts`               | 4    | 新增：预热逻辑集中封装                         |
| `src/gateway/server.impl.ts`                     | 4    | 3 行动态 import 调用预热                       |

---

## 冷启动额外开销分析

优化后请求 1（冷启动）仍比请求 2+（热启动）慢约 5-6 秒。通过细粒度日志定位到三个首次初始化开销：

### 冷启动 vs 热启动逐阶段对比

| 阶段                                             | 冷启动（根 agent） | 热启动（请求 3） | 差值        |
| ------------------------------------------------ | ------------------ | ---------------- | ----------- |
| `ensureRuntimePluginsLoaded`                     | 912ms              | 16ms             | **+896ms**  |
| `normalizeProviders`                             | 500ms              | 84ms             | **+416ms**  |
| `resolveExplicitModel` → `resolveDynamicAttempt` | 2080ms             | 50ms             | **+2030ms** |
| `createOpenClawCodingTools`                      | 1339ms             | 1264ms           | +75ms       |
| 其他                                             | ~700ms             | ~200ms           | +500ms      |
| **runEmbeddedPiAgent 总计**                      | **~5.5s**          | **~1.6s**        | **~3.9s**   |

子 agent 冷启动额外开销更大（~6s），主要因为 `normalizeProviders` 首次 secret resolution 对不同 agentDir 需要独立解析（2.5s vs 根 agent 的 0.5s）。

### 冷启动开销来源

| 开销来源                                         | 耗时     | 性质                    | 说明                                                                                                                                                      |
| ------------------------------------------------ | -------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ensureRuntimePluginsLoaded`                     | ~900ms   | 模块加载                | 首次加载所有 plugin runtime 模块（动态 import），后续 ~20ms                                                                                               |
| `resolveExplicitModel` → `resolveDynamicAttempt` | 2-2.5s   | provider runtime 初始化 | 首次执行 `shouldCompareProviderRuntimeResolvedModel` + `prepareProviderDynamicModel`（provider runtime hook），涉及 plugin 的 provider runtime 首次初始化 |
| `normalizeProviders`                             | 0.5-2.5s | secret resolution       | 首次 auth profile store 读取 + secret ref 解析，子 agent 因不同 agentDir 需独立解析                                                                       |

### 结论

这些冷启动开销属于 Node.js 模块加载和首次 I/O 的固有成本，不是缓存能解决的问题。当前优化已将可缓存的部分（provider discovery、auth storage、models.json）全部覆盖，剩余的冷启动开销需要从以下方向继续优化：

- `ensureRuntimePluginsLoaded`：可在预热阶段提前触发，将 plugin runtime 模块加载从请求路径移除
- `prepareProviderDynamicModel`：可在预热阶段对目标 provider 提前执行一次 runtime hook
- `normalizeProviders`：可缓存 secret resolution 结果（需要 mtime 失效检测）

这些属于下一阶段优化方向，当前优先级低于已实施的方案 1-4。
