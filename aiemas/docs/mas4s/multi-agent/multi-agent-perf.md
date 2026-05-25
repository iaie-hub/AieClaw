# 多 Agent 消息链路性能优化（第二轮）

## 背景

用户在 mas4s Web UI 发送消息到 cowork 会话，从收到请求到最终调用 `discover_agents` 工具，端到端耗时约 **2 分钟**。通过添加链路耗时日志逐步定位瓶颈，最终将预热时间从 341s 压缩到 70s，并消除了请求处理期间的 event loop 竞争。

---

## 优化成果

### 预热时间

| 指标 | 优化前 | 优化后 | 改善 |
|------|--------|--------|------|
| 总预热时间 | 341s | **70s** | **79%** |
| 首个 agent（冷启动） | 44s | 31s | 30% |
| 后续 agent（平均） | ~24s | **~2.9s** | **88%** |
| event loop max delay | 18.3s | **1.3s** | **93%** |

### 请求处理性能（预热完成后）

| 指标 | 优化前（预热并发） | 优化后（阻塞式预热） |
|------|-------------------|---------------------|
| chat.send → discover_agents | ~117s | **~33s** |
| discover_agents NATS roundTrip | 37ms | 37ms |
| event loop 竞争 | 严重（P99=18.3s） | **无** |

---

## 问题诊断过程

### 第一轮：添加链路耗时日志

在关键路径上添加 `[perf:*]` 前缀的耗时日志，覆盖完整链路：

- `chat.send` 入口 → dispatch → embedded run
- embedded run prep stages（workspace-sandbox / core-plugin-tools / bootstrap-context / system-prompt / session-resource-loader / stream-setup）
- `discover_agents` NATS 请求-响应
- AgentRegistry 侧处理

### 第二轮：确认 NATS 不是瓶颈

日志揭示 `discover_agents` 的 NATS roundTrip 只有 **37ms**，之前观察到的 21s 延迟完全是 event loop 阻塞造成的假象。

### 第三轮：确认预热并发是根因

预热完成后发送请求，性能从 ~117s 降到 ~33s。证明 event loop 竞争（预热 CPU 密集操作与请求处理并发）是主要放大器。

### 第四轮：定位预热内部瓶颈

添加 per-step 计时到预热函数，确认：
- `ensureModelsJson`（含 `resolveImplicitProviders`）占 80-90%
- `resolveModel`（含 `normalizeResolvedModel`）占剩余大部分
- 两者都因缺少进程级缓存而对每个 agent 重复执行

---

## 实施的优化方案

### 方案 1：resolveImplicitProviders 进程级缓存

**文件：** `src/agents/models-config.providers.implicit.ts`

**问题：** `resolveImplicitProviders` 的结果只依赖 config 中 provider 的结构和 env 变量，与 agentDir 无关。但 `ensureOpenClawModelsJson` 的缓存 key 包含 agentDir，导致每个 agent 都 cache miss，重复执行完整的 plugin provider discovery（~24s/agent）。

**方案：** 在 `resolveImplicitProviders` 入口增加进程级缓存：
- 缓存存储：`Symbol.for("openclaw.resolveImplicitProvidersCache")` 挂载到 `globalThis`
- 缓存 key：provider 结构 fingerprint（baseUrl、api、models[].id）+ env 变量 + plugin metadata + discovery filter
- 排除 agentDir 和 apiKey 等 secret 字段
- 并发调用通过 pending Promise 去重
- 失败时从缓存中移除，下次调用重试

**效果：** 后续 agent 的 `ensureModelsJson` 从 ~24s 降到 ~1.5s（首次 cache miss 后全部 hit）。

### 方案 5a：normalizeResolvedModel 进程级缓存

**文件：** `src/agents/pi-embedded-runner/model.ts`

**问题：** `normalizeResolvedModel` 内部调用 plugin 的 normalize/compat/transport hook，首次调用耗时 10-15s（plugin runtime 模块懒加载）。这些 hook 只依赖 provider 类型和 model 标识。

**方案：** 在 `normalizeResolvedModel` 入口增加进程级缓存：
- 缓存存储：`Symbol.for("openclaw.normalizeResolvedModelCache")` 挂载到 `globalThis`
- 缓存 key：`provider + "\0" + model.id + "\0" + model.api + "\0" + model.baseUrl + "\0" + model.transport`
- 仅在使用 `DEFAULT_PROVIDER_RUNTIME_HOOKS` 时缓存（特殊 hooks 不缓存）

**效果：** 后续 agent 的 `resolveModel` 从 7-15s 降到 ~1.3s。

### 方案 6：恢复阻塞式预热

**文件：** `src/gateway/server.impl.ts`

**问题：** 预热是非阻塞的（`import(...).then(...).catch(()=>{})`），与请求处理完全并发，导致 event loop 延迟高达 18.3s，所有 I/O 操作被放大 3-5 倍。

**方案：** 将预热改为阻塞式（`await warmupAgentCaches(cfgAtStart)`），在 HTTP 端口绑定后、接受用户请求前完成所有 agent 缓存预热。失败不影响 gateway 启动。

**效果：** 
- 消除请求处理期间的 event loop 竞争
- 预热本身也更快（无并发干扰，从 133s 降到 70s）
- 代价：gateway 启动时间增加 ~70s

---

## 最终预热耗时构成

```
总预热时间：70s（14 agents）
├─ main（首个，冷启动）：31s
│   ├─ ensureModelsJson: 18s
│   │   └─ resolveImplicitProviders: 16.5s（provider discovery，首次执行）
│   ├─ authStorage+discovery: 1s
│   └─ resolveModel: 12s
│       └─ normalizeResolvedModel: 10s（plugin hook 懒加载，首次执行）
└─ 后续 13 agents（缓存命中）：平均 2.9s each = 38s
    ├─ ensureModelsJson: ~0.95s（fingerprint + file I/O）
    ├─ authStorage+discovery: ~0.63s（auth profile 文件读取）
    └─ resolveModel: ~1.27s（prepareProviderDynamicModel + registry lookup）
```

---

## 修改文件清单

### 性能优化

| 文件 | 方案 | 改动说明 |
|------|------|----------|
| `src/agents/models-config.providers.implicit.ts` | 1 | resolveImplicitProviders 进程级缓存 |
| `src/agents/pi-embedded-runner/model.ts` | 5a | normalizeResolvedModel 进程级缓存 |
| `src/gateway/server.impl.ts` | 6 | 恢复阻塞式预热 |
| `src/gateway/agent-perf-warmup.ts` | — | 添加 per-step 计时日志 |

### 链路耗时日志（诊断用）

| 文件 | 日志标签 | 说明 |
|------|----------|------|
| `src/gateway/server-methods/chat.ts` | `[perf:chat.send]` | 请求入口到 ack/dispatch 耗时 |
| `src/agents/pi-embedded-runner/run.ts` | `[perf:embedded-run] queue wait` | 队列等待时间 |
| `src/agents/pi-embedded-runner/run.ts` | `[perf:embedded-run] startup complete` | startup stages 总耗时 |
| `src/agents/pi-embedded-runner/run/attempt.ts` | `[perf:embedded-run] *-slow` | 各 prep 阶段慢日志 |
| `src/agents/sandbox/context.ts` | `[perf:sandbox-context]` | sandbox 解析细分 |
| `src/agents/bootstrap-files.ts` | `[perf:bootstrap-files]` | bootstrap 文件加载细分 |
| `src/agents/workspace.ts` | `[perf:workspace-files]` | 逐文件加载耗时 |
| `src/agents/runtime-plugins.ts` | `[perf:runtime-plugins]` | 运行时插件加载 |
| `src/agents/openclaw-plugin-tools.ts` | `[perf:plugin-tools]` | 插件工具解析 |
| `src/plugins/tools.ts` | `[perf:resolve-plugin-tools]` | resolvePluginTools 内部 |
| `src/agents/pi-embedded-runner/run/attempt-system-prompt.ts` | `[perf:system-prompt]` | system prompt 构建 |
| `extensions/agent-registry/src/agent-discovery.ts` | `[perf:discover-agents]` | NATS 请求细分 |
| `AgentRegistry/src/agent_registry/core/registry_service.py` | `[perf:discover]` | Registry 侧处理 |

---

## 剩余优化空间

### 后续 agent 2.9s/个的构成

| 步骤 | 耗时 | 可优化性 |
|------|------|----------|
| ensureModelsJson | ~0.95s | fingerprint hash 计算 + file stat/read，可缓存 fingerprint |
| authStorage | ~0.63s | 每次重新扫描 auth profiles 目录，可缓存 main store |
| resolveModel | ~1.27s | prepareProviderDynamicModel + registry lookup，已接近下限 |

### 进一步优化方向（收益递减）

1. **fingerprint 缓存** — config 不变时 `buildModelsJsonFingerprint` 结果不变，可进程级缓存
2. **auth store 共享** — 所有 agent 继承 main auth store，main store 只需加载一次
3. **减少 agent 数量** — 14 个 agent 是否都需要独立预热？共享 provider 的 agent 可以共享 models.json

---

## 关键经验

1. **先加日志，再优化** — 不要猜测瓶颈，用数据说话
2. **event loop 竞争是隐形杀手** — 简单的文件 stat 从 <10ms 膨胀到 11s，NATS 37ms 响应延迟到 21s
3. **进程级缓存是最有效的优化** — 相同输入 → 相同输出的函数，缓存一次受益终身
4. **阻塞式预热优于非阻塞** — 启动慢 70s 远好于每次请求慢 100s+
5. **NATS 本身极快** — 37ms roundTrip，性能问题从来不在网络层
