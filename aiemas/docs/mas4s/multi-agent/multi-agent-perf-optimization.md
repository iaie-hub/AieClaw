# 多 Agent 消息链路性能优化

## 背景

多 Agent 场景下（根 agent 转发请求到子 agent），消息链路端到端延迟 33-45 秒，其中 agent 初始化阶段占 30+ 秒。用户体验为"发送消息后长时间无响应"。

通过在关键路径上添加性能日志，精确定位到瓶颈函数并逐步优化。

---

## 优化方案

### 方案 1：provider discovery 进程级缓存

**文件**：`src/agents/models-config.providers.implicit.ts`

`resolveImplicitProviders` 的结果只依赖 config 中 provider 的结构（baseUrl、api、models）和 env 变量，与 agentDir 无关。在函数入口增加进程级缓存，key 为 provider 结构 + env 的 fingerprint（排除 apiKey 等 secret 字段），无 TTL。

fingerprint 排除 secret 字段是关键——不同 agentDir 的 secret resolution 结果不同，但不影响 provider 列表结构。

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

**文件**：`src/gateway/agent-perf-warmup.ts`（新增），`src/gateway/server.impl.ts`（调用）

gateway 启动时，阻塞式（`await`）遍历 `listAgentIds(config)` 中的所有 agent，串行执行完整初始化路径：

- `ensureOpenClawModelsJson(config, agentDir)` — 填充方案 1/5b 缓存
- `discoverAuthStorage(agentDir)` + `discoverModels()` — 填充方案 2 缓存
- `resolveModelAsync(provider, model, agentDir, config)` — 填充方案 5a 缓存

在 gateway 接受用户请求前完成预热，消除预热与请求的 event loop 竞争。串行处理每个 agent，避免并发 CPU 密集操作阻塞 event loop。代价是 gateway 启动时间增加 ~30-50s，但首次请求直接进入热启动路径（~3s）。失败不影响 gateway 启动。

### 方案 5a：normalizeResolvedModel 进程级缓存

**文件**：`src/agents/pi-embedded-runner/model.ts`

`normalizeResolvedModel` 内部调用 plugin 的 normalize/compat/transport hook，首次调用耗时 1-2.3s（plugin runtime 模块懒加载）。这些 hook 只依赖 provider 类型和 model 标识，不依赖 apiKey、agentDir 等运行时变量。

增加进程级缓存，key 为 `provider + "\0" + model.id`，无 TTL。预热阶段通过 `resolveModelAsync` 提前填充。

### 方案 5b：normalizeProviders 进程级缓存

**文件**：`src/agents/models-config.providers.normalize.ts`

`normalizeProviders` 遍历所有 provider 执行 secret resolution，首次调用耗时 0.5-2.6s。相同 agentDir + 相同 provider 结构 → 相同结果。

增加进程级缓存，key 为 `agentDir + provider 结构 fingerprint`（排除 apiKey 等 secret 字段），无 TTL。预热阶段通过 `ensureOpenClawModelsJson` 自动填充。

---

## 优化效果

### agent 初始化耗时对比（最终）

| 场景                      | 优化前 | 优化后 | 提升    |
| ------------------------- | ------ | ------ | ------- |
| 请求 1 根 agent（冷启动） | ~33s   | ~8.9s  | **73%** |
| 请求 1 子 agent（冷启动） | ~35s   | ~11.9s | **66%** |
| 请求 2 根 agent           | ~33s   | ~3.2s  | **90%** |
| 请求 2 子 agent           | ~35s   | ~3.1s  | **91%** |

### 各瓶颈函数耗时对比（最终）

| 函数                           | 优化前         | 优化后（请求 1）      | 优化后（请求 2） |
| ------------------------------ | -------------- | --------------------- | ---------------- |
| `resolveImplicitProviders`     | 11-35s（串行） | cache hit（0ms）      | cache hit（0ms） |
| `discoverAuthStorage`          | 1.3s           | 5ms                   | 5ms              |
| `normalizeResolvedModel`       | 1-2.3s         | **2-3ms** (cache hit) | 5ms              |
| `normalizeProviders`           | 0.5-2.6s       | **3-4ms** (cache hit) | cache hit        |
| `ensureModelsJson`（子 agent） | 22-35s         | 5.2s                  | 76ms             |

### 剩余耗时构成（请求 2 稳态）

| 阶段                        | 耗时      | 说明                         |
| --------------------------- | --------- | ---------------------------- |
| `createOpenClawCodingTools` | 2.5-2.7s  | tool 创建固定开销            |
| `ensureSkillSnapshot`       | 0.2-0.4s  | skill 快照加载               |
| `ensureModelsJson`          | 0.1-0.3s  | normalize cache hit + noop   |
| `resolveModelAsync`         | 0.05-0.4s | cache hit                    |
| 其他                        | 0.1-0.3s  | session state、directives 等 |
| **总计**                    | **~3s**   |                              |

---

## 冷启动剩余开销分析

方案 5a/5b 消除了 `normalizeResolvedModel`（1-2.3s → 2ms）和 `normalizeProviders`（0.5-2.6s → 3ms）的冷启动开销。请求 1 仍比请求 2 慢 ~6-9s。

通过进一步添加细粒度日志，确认剩余开销的根因是 **Node.js event loop 竞争**，而非特定函数的首次初始化。

### 证据

| 现象                                                  | 函数                   | 冷启动耗时 | 热启动耗时 | 说明                               |
| ----------------------------------------------------- | ---------------------- | ---------- | ---------- | ---------------------------------- |
| `shouldSuppressBuiltInModel` → `findInlineModelMatch` | `resolveExplicitModel` | 827-2167ms | 9-365ms    | 中间只有一个 `if` 判断，不应有耗时 |
| `applyNativeStreamingUsageCompat`                     | `planModelsJson`       | 3398ms     | 2306ms     | 同步轻量函数，不应花秒级时间       |
| `ensureModelsFileMode (noop)`                         | `ensureModelsJson`     | 7976ms     | 8ms        | 简单的 `fs.chmod` 调用             |

这些函数本身都是毫秒级操作，但在冷启动时表现为秒级耗时。共同特征：它们都是 async 函数中 `await` 恢复后的同步代码。

### 根因

Node.js 单线程 event loop 被 CPU 密集的同步操作阻塞。冷启动时多个并发任务（预热的后续 agent、请求的 agent 初始化）同时执行 CPU 密集操作（`normalizeProviders` 的 per-provider 遍历、`createOpenClawCodingTools` 的 tool 定义构建、plugin runtime hook 执行），导致 event loop 排队。

当一个 async 函数在 `await` 点让出控制权后，需要等待 event loop 中排在前面的同步任务完成才能恢复执行。这就是为什么简单的 `fs.chmod` 或 `if` 判断会表现为秒级耗时——实际等待的是 event loop 中其他任务的 CPU 时间。

### 结论

这是 Node.js 单线程模型的固有限制，无法通过缓存解决。当前优化已将所有可缓存的计算结果（provider discovery、auth storage、normalizeResolvedModel、normalizeProviders）全部覆盖，剩余开销来自 event loop 竞争。

当前性能水平：

- 请求 1（冷启动）：根 agent ~9s，子 agent ~12s
- 请求 2+（热启动）：根 agent ~3s，子 agent ~3s

进一步优化方向（收益递减，风险增大）：

- ~~将 CPU 密集的同步操作拆分为微任务（`setImmediate` / `setTimeout(0)`），避免长时间阻塞 event loop~~
- ~~预热改为阻塞式（`await warmupAgentCaches`），确保预热完成后再接受请求，消除预热与请求的 event loop 竞争~~ → **已实施为方案 6**
- ~~减少预热并发，串行处理每个 agent~~ → **已实施为方案 6**

---

## 修改文件清单

| 文件                                              | 方案 | 改动说明                                       |
| ------------------------------------------------- | ---- | ---------------------------------------------- |
| `src/agents/models-config.providers.implicit.ts`  | 1+3  | provider discovery 进程级缓存 + catalog 并行化 |
| `src/agents/pi-model-discovery.ts`                | 2    | auth storage / model registry mtime 缓存       |
| `src/gateway/agent-perf-warmup.ts`                | 4+6  | 新增：预热逻辑集中封装，阻塞式串行执行         |
| `src/gateway/server.impl.ts`                      | 4+6  | 阻塞式 await 调用预热                          |
| `src/agents/pi-embedded-runner/model.ts`          | 5a   | normalizeResolvedModel 进程级缓存              |
| `src/agents/models-config.providers.normalize.ts` | 5b   | normalizeProviders 进程级缓存                  |
