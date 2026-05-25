# 多 Agent 消息链路性能分析

## 背景

用户在 mas4s Web UI 发送消息"重新查询在线agent列表"到 cowork 会话，从收到请求（22:58:04）到最终调用 `discover_agents` 工具（22:59:43），端到端耗时约 **99 秒**。`discover_agents` 工具本身的 NATS 请求-响应耗时约 21 秒（22:59:43 → 23:00:06），总端到端耗时约 **2 分钟**。

---

## 消息链路时序分析

基于 gateway 日志，完整链路如下：

```
22:58:04.000  [ws] ← chat.send 收到 WebSocket 请求
22:58:04.xxx  [aiemas:chat] 开始处理 chat.send
22:58:04.xxx  [ws] ⇄ session.run.state 响应 (80ms)
22:58:04.xxx  [plugins] plugins.allow 警告（非阻塞）
                ↓
         ══════════════════════════════════════════
         ║  阶段 A: 嵌入式运行准备 (embedded run)  ║
         ══════════════════════════════════════════
                ↓
22:58:48.000  [tools] tools.profile/tools.allow 警告
22:58:48.000  [agents:tools] Injected 1 AIEMAS tools
22:58:48.000  [trace:embedded-run] core-plugin-tool stages (totalMs=7638)
                ↓
         ══════════════════════════════════════════
         ║  阶段 B: bootstrap-context (23208ms)    ║
         ══════════════════════════════════════════
                ↓
22:59:20.000  [trace:embedded-run] prep stages (totalMs=47071, phase=stream-ready)
                ↓
         ══════════════════════════════════════════
         ║  阶段 C: LLM 推理 (模型决策调用工具)     ║
         ══════════════════════════════════════════
                ↓
22:59:43.000  [gateway] discover_agents phase=start
22:59:43.000  [nats-client] subscribed to inbox (NATS request 发出)
                ↓
         ══════════════════════════════════════════
         ║  阶段 D: NATS 请求-响应 (21s)           ║
         ══════════════════════════════════════════
                ↓
23:00:06.901  [nats-client] unsubscribed (NATS 响应收到)
23:00:08.000  [gateway] discover_agents phase=result
```

---

## 各阶段耗时拆解

| 阶段 | 起止时间 | 耗时 | 说明 |
|------|----------|------|------|
| **A: core-plugin-tools** | 22:58:04 → 22:58:48 | **~44s** | 工具构建（含 event loop 竞争） |
| **B: bootstrap-context** | 22:58:48 → ~22:59:11 | **~23s** | 工作区上下文加载 |
| **C: 其余 prep + LLM 推理** | ~22:59:11 → 22:59:43 | **~32s** | system-prompt + session + LLM 首 token |
| **D: discover_agents NATS** | 22:59:43 → 23:00:08 | **~25s** | NATS 请求-响应 + 结果处理 |
| **总计** | 22:58:04 → 23:00:08 | **~124s** | |

### 阶段 A 细分：core-plugin-tools (7638ms 自身 + event loop 竞争)

从 `[trace:embedded-run] core-plugin-tool stages` 日志：

| 子阶段 | 耗时 | 累计 | 说明 |
|--------|------|------|------|
| tool-policy | 451ms | 451ms | 工具策略解析 |
| workspace-policy | 0ms | 451ms | |
| base-coding-tools | 1ms | 452ms | |
| shell-tools | 1ms | 453ms | |
| openclaw-tools:session-workspace | 2ms | 455ms | |
| openclaw-tools:image-tool | 282ms | 737ms | 图像工具初始化 |
| openclaw-tools:image-generate-tool | 204ms | 941ms | |
| openclaw-tools:video-generate-tool | 886ms | 1827ms | 视频生成工具初始化 |
| openclaw-tools:music-generate-tool | 0ms | 1827ms | |
| openclaw-tools:pdf-tool | 1ms | 1828ms | |
| openclaw-tools:web-search-tool | 0ms | 1828ms | |
| openclaw-tools:web-fetch-tool | 1ms | 1829ms | |
| openclaw-tools:message-tool | 6ms | 1835ms | |
| openclaw-tools:nodes-tool | 0ms | 1835ms | |
| openclaw-tools:core-tool-list | 7ms | 1842ms | |
| **openclaw-tools:plugin-tools** | **5769ms** | **7611ms** | **插件工具解析（主要瓶颈）** |
| message-provider-policy | 0ms | 7611ms | |
| model-provider-policy | 1ms | 7612ms | |
| authorization-policy | 7ms | 7619ms | |
| schema-normalization | 16ms | 7635ms | |
| tool-hooks | 2ms | 7637ms | |
| abort-wrappers | 0ms | 7637ms | |
| deferred-followup-descriptions | 1ms | 7638ms | |
| attempt:create-openclaw-coding-tools | 0ms | 7638ms | |
| attempt:tools-allow | 0ms | 7638ms | |

**关键发现：** `openclaw-tools:plugin-tools` 占 7638ms 中的 5769ms（75%）。

但日志显示 chat.send 在 22:58:04 收到，core-plugin-tools 在 22:58:48 完成，中间有 **44 秒**。而 core-plugin-tools 自身只花了 7.6 秒。差值 **~36 秒** 来自：

1. **agent warmup 竞争**：`[perf:warmup] agent "researcher" warmed in 104091ms`（22:58:57 完成，说明预热从 ~22:57:13 开始，与请求处理并发）
2. **event loop 阻塞**：diagnostic 日志显示 `eventLoopDelayP99Ms=9001`（22:58:34）和 `eventLoopDelayMaxMs=16013.9`（22:59:11），event loop 被严重阻塞

### 阶段 B 细分：bootstrap-context (23208ms)

从 prep stages 日志：

| 子阶段 | 耗时 | 累计 | 说明 |
|--------|------|------|------|
| workspace-sandbox | 7829ms | 7829ms | 沙箱上下文解析 |
| skills | 2ms | 7831ms | |
| core-plugin-tools | 7638ms | 15469ms | （同阶段 A） |
| **bootstrap-context** | **23208ms** | **38677ms** | **工作区文件加载** |
| bundle-tools | 798ms | 39475ms | MCP/LSP 工具 |
| system-prompt | 6450ms | 45925ms | 系统提示词构建 |
| session-resource-loader | 1024ms | 46949ms | 会话资源加载 |
| agent-session | 6ms | 46955ms | |
| stream-setup | 116ms | 47071ms | |

**关键发现：**
- `bootstrap-context` 耗时 23.2 秒，是最大的单一瓶颈
- `workspace-sandbox` 耗时 7.8 秒（异常高）
- `system-prompt` 耗时 6.4 秒（异常高）
- 总 prep 阶段 47 秒

### 阶段 C：LLM 推理 (~23s)

从 prep stages 完成（22:59:20 stream-ready）到 discover_agents 工具调用开始（22:59:43），约 23 秒。这段时间是：
1. LLM 首次推理（读取 system prompt + 用户消息 → 决策调用 discover_agents）
2. 可能包含 event loop 排队延迟

### 阶段 D：discover_agents NATS 请求-响应 (~25s)

| 子步骤 | 时间 | 说明 |
|--------|------|------|
| 工具 execute 开始 | 22:59:43 | gateway 记录 phase=start |
| NATS subscribe inbox | 22:59:43 (14:59:45 UTC) | 创建临时 inbox 订阅 |
| NATS publish request | 22:59:43 | 发布到 registry.agent.discover |
| AgentRegistry 处理 | ? | 内存查询，应 <100ms |
| NATS response 到达 | 23:00:06 (15:00:06 UTC) | inbox 收到响应 |
| 工具 execute 完成 | 23:00:08 | gateway 记录 phase=result |

**NATS 请求-响应耗时 21 秒**（从 subscribe 到 unsubscribe）。AgentRegistry 的 `handle_discover` 只是内存过滤操作，应在毫秒级完成。21 秒的延迟可能来自：

1. **event loop 阻塞**：OpenClaw 进程的 event loop 被其他 CPU 密集操作阻塞，NATS 消息无法及时处理
2. **NATS 网络延迟**：本地 NATS 连接不应有此延迟
3. **AgentRegistry 侧延迟**：Python 进程可能被其他任务阻塞
4. **aieiaas warmup 竞争**：`[perf:warmup] agent "aieiaas" warmed in 44468ms`（22:59:41 完成），与 discover_agents 执行时间重叠

---

## 根因分析

### 根因 1：Agent 预热与请求处理并发竞争 event loop

日志显示两个 agent 预热与请求处理并发：
- `researcher` 预热：耗时 104s，22:58:57 完成
- `aieiaas` 预热：耗时 44s，22:59:41 完成

预热文档（`multi-agent-perf-optimization.md`）中方案 4/6 明确要求预热是**阻塞式**的（gateway 启动时 `await warmupAgentCaches`），但日志显示预热仍在请求处理期间进行。

**可能原因：**
- 预热代码虽然是串行的，但 gateway 在预热完成前就开始接受请求
- 或者这些是新发现的 agent（非启动时已知），运行时动态预热

### 根因 2：bootstrap-context 加载耗时 23 秒

`resolveBootstrapFilesForRun` 需要：
1. 检查工作区设置完成状态
2. 加载/缓存 bootstrap 文件（AGENTS.md、TOOLS.md 等）
3. 应用 hook 覆盖
4. 构建上下文文件

对于 cowork 会话，工作区可能包含大量文件，或 hook 覆盖涉及 I/O 操作。在 event loop 被阻塞的情况下，简单的文件读取也会表现为秒级延迟。

### 根因 3：plugin-tools 解析耗时 5.7 秒

`resolveOpenClawPluginToolsForOptions` 遍历所有已加载插件，为每个插件解析工具定义。当插件数量多时（日志提到 37 个 plugin），累计耗时显著。

### 根因 4：NATS 请求-响应 21 秒延迟

`discover_agents` 使用自定义的 subscribe + publish 模式（非 nats.js 原生 `request()`）。在 event loop 被阻塞时：
- publish 可能延迟发出
- 收到的响应可能延迟处理（subscribe handler 在 event loop 中排队）

---

## 耗时分布总结

```
┌─────────────────────────────────────────────────────────────────────────┐
│ 22:58:04                                                      23:00:08 │
│ ├──────────────────────────────────────────────────────────────────────┤│
│ │ event loop 竞争 + workspace-sandbox (36s)                           ││
│ │ ├─ researcher warmup 并发 (104s total, 完成于 22:58:57)            ││
│ │ └─ aieiaas warmup 并发 (44s total, 完成于 22:59:41)               ││
│ ├──────────────────────────────────────────────────────────────────────┤│
│ │ core-plugin-tools 自身 (7.6s)                                       ││
│ │ └─ plugin-tools 解析 (5.7s)                                        ││
│ ├──────────────────────────────────────────────────────────────────────┤│
│ │ bootstrap-context (23.2s)                                           ││
│ ├──────────────────────────────────────────────────────────────────────┤│
│ │ system-prompt (6.4s) + session-resource-loader (1s)                 ││
│ ├──────────────────────────────────────────────────────────────────────┤│
│ │ LLM 推理 (~23s)                                                     ││
│ ├──────────────────────────────────────────────────────────────────────┤│
│ │ discover_agents NATS (~25s, 含 event loop 延迟)                     ││
│ └──────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 优化建议（需添加链路耗时日志后验证）

### 需要添加的链路耗时日志

为精确定位瓶颈，建议在以下位置添加耗时日志：

#### 1. chat.send 入口到 embedded run 启动

**文件：** `src/gateway/server-methods/chat.ts`

在 `chat.send` handler 入口记录时间戳，在调用 embedded run 前记录差值，确认请求排队/预处理耗时。

#### 2. bootstrap-context 细分

**文件：** `src/agents/bootstrap-files.ts`

在 `resolveBootstrapFilesForRun` 内部各步骤添加计时：
- `isWorkspaceSetupCompletedForContext` 耗时
- `getOrLoadBootstrapFiles` / `loadWorkspaceBootstrapFiles` 耗时
- `applyBootstrapHookOverrides` 耗时
- `buildBootstrapContextFiles` 耗时

#### 3. plugin-tools 细分

**文件：** `src/agents/openclaw-plugin-tools.ts`

在 `resolveOpenClawPluginToolsForOptions` 内部记录：
- `resolveOpenClawPluginToolInputs` 耗时
- `resolvePluginTools` 耗时（含每个 plugin 的工具解析）

#### 4. discover_agents NATS 请求细分

**文件：** `extensions/agent-registry/src/agent-discovery.ts`

在 `discoverAgents` 函数内记录：
- subscribe 创建耗时
- publish 发出时间
- 响应到达时间（handler 被调用时）
- 响应解析耗时

#### 5. workspace-sandbox 细分

**文件：** `src/agents/pi-embedded-runner/run/attempt.ts`

在 `resolveSandboxContext` 调用前后添加计时，确认 7.8 秒是否来自 event loop 竞争。

#### 6. system-prompt 细分

在 `buildAttemptSystemPrompt` 调用前后添加计时，确认 6.4 秒的构成。

---

## 初步优化方向

### 方向 1：确保预热完成后再接受请求（验证方案 4/6 是否生效）

日志显示预热仍与请求并发。需要验证：
- `warmupAgentCaches` 是否确实在 `await` 后才开始监听
- 是否存在动态发现的 agent 绕过了启动预热

### 方向 2：bootstrap-context 缓存

对于同一 session 的重复请求，bootstrap 文件（AGENTS.md、TOOLS.md）内容不变时可缓存。使用 mtime 检测失效。

### 方向 3：plugin-tools 结果缓存

`resolveOpenClawPluginToolsForOptions` 的结果只依赖 config + 已加载插件列表。在 config 不变时可进程级缓存。

### 方向 4：discover_agents 使用 nats.js 原生 request()

当前实现使用 subscribe + publish 模式，在 event loop 阻塞时容易产生额外延迟。改用 `nc.request(subject, payload, { timeout })` 可减少一次 event loop 调度。

### 方向 5：LLM 推理优化

23 秒的 LLM 推理时间可能受 system prompt 长度影响。对于简单的工具调用场景，可考虑：
- 精简 cowork 会话的 system prompt
- 使用更快的模型处理简单路由决策

---

## 下一步

1. **已添加链路耗时日志**（见下方修改文件清单），重新复现场景
2. **确认各阶段真实耗时**（排除 event loop 竞争的干扰）
3. **针对确认的瓶颈实施优化**
4. **验证预热机制是否正常工作**（为何 researcher/aieiaas 在请求期间仍在预热）

---

## 已添加的链路耗时日志

### 日志标签与位置

| 日志标签 | 文件 | 触发条件 | 记录内容 |
|----------|------|----------|----------|
| `[perf:chat.send] ack sent` | `src/gateway/server-methods/chat.ts` | `OPENCLAW_MAS4S_DEBUG=1` | 从 chat.send 入口到 ack 响应的耗时 |
| `[perf:chat.send] dispatch start` | `src/gateway/server-methods/chat.ts` | `OPENCLAW_MAS4S_DEBUG=1` | 从 chat.send 入口到 dispatch 开始的耗时 |
| `[perf:warmup] starting background warmup` | `src/gateway/server.impl.ts` | 始终 | 标记预热开始时间点 |
| `[perf:embedded-run] workspace-sandbox slow` | `src/agents/pi-embedded-runner/run/attempt.ts` | >1000ms | workspace-sandbox 阶段耗时 |
| `[perf:embedded-run] bootstrap-context slow` | `src/agents/pi-embedded-runner/run/attempt.ts` | >5000ms | bootstrap-context 累计耗时 |
| `[perf:embedded-run] system-prompt slow` | `src/agents/pi-embedded-runner/run/attempt.ts` | >10000ms | system-prompt 累计耗时 |
| `[perf:embedded-run] stream-ready slow` | `src/agents/pi-embedded-runner/run/attempt.ts` | >10000ms | 全部 prep 阶段累计耗时 |
| `[perf:sandbox-context]` | `src/agents/sandbox/context.ts` | >1000ms | sandbox 各子步骤耗时（prune/layout/backend/registry） |
| `[perf:bootstrap-files]` | `src/agents/bootstrap-files.ts` | >500ms | bootstrap 文件加载各子步骤耗时 |
| `[perf:plugin-tools]` | `src/agents/openclaw-plugin-tools.ts` | >500ms | 插件工具解析各子步骤耗时 |
| `[perf:system-prompt]` | `src/agents/pi-embedded-runner/run/attempt-system-prompt.ts` | >1000ms | system prompt 构建各子步骤耗时 |
| `[perf:discover-agents]` | `extensions/agent-registry/src/agent-discovery.ts` | 始终 | NATS 请求各阶段耗时（setup/roundTrip/parse） |
| `[perf:discover]` | `AgentRegistry/src/agent_registry/core/registry_service.py` | 始终 | Registry 侧处理耗时 |

### 修改文件清单

| 文件 | 改动说明 |
|------|----------|
| `src/gateway/server-methods/chat.ts` | chat.send 入口计时 + ack/dispatch 耗时日志 |
| `src/gateway/server.impl.ts` | 预热启动时间标记 |
| `src/agents/pi-embedded-runner/run/attempt.ts` | embedded run 各阶段慢日志 |
| `src/agents/sandbox/context.ts` | sandbox 上下文解析细分耗时 |
| `src/agents/bootstrap-files.ts` | bootstrap 文件加载细分耗时 |
| `src/agents/openclaw-plugin-tools.ts` | 插件工具解析细分耗时 |
| `src/agents/pi-embedded-runner/run/attempt-system-prompt.ts` | system prompt 构建细分耗时 |
| `extensions/agent-registry/src/agent-discovery.ts` | discover_agents NATS 请求细分耗时 |
| `AgentRegistry/src/agent_registry/core/registry_service.py` | Registry 侧 discover 处理耗时 |

### 复现步骤

1. 确保 `OPENCLAW_MAS4S_DEBUG=1` 环境变量已设置
2. 重启 gateway 和 AgentRegistry
3. 在 mas4s Web UI 的 cowork 会话中发送"重新查询在线agent列表"
4. 收集 gateway 日志，搜索 `[perf:` 前缀的所有日志行
5. 对比各阶段耗时，确认瓶颈是真实计算开销还是 event loop 竞争
