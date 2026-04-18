# 方向 E 深度分析：Per-Session Lane 隔离实现多 Agent 并发

## 一、核心发现：双 Lane 嵌套机制

### 1.1 现有架构中已存在 Per-Session Lane

深入分析源码后发现，Gateway 的 Agent 运行调度实际上使用了**双 Lane 嵌套**机制，而非单一 Lane：

```typescript
// src/agents/pi-embedded-runner/run.ts — runEmbeddedPiAgent()

const sessionLane = resolveSessionLane(params.sessionKey); // "session:agent:aieiaas-resource:uuid"
const globalLane = resolveGlobalLane(params.lane); // "nested"（来自 sessions_send）

return enqueueSession(() =>
  // ← 第一层：per-session 串行
  enqueueGlobal(async () => {
    // ← 第二层：全局并发控制
    // ... 实际 Agent 运行逻辑
  }),
);
```

**Lane 解析规则：**

```typescript
// src/agents/pi-embedded-runner/lanes.ts

function resolveSessionLane(key: string) {
  const cleaned = key.trim() || CommandLane.Main;
  return cleaned.startsWith("session:") ? cleaned : `session:${cleaned}`;
}
// 示例：sessionKey="agent:aieiaas-resource:abc123" → sessionLane="session:agent:aieiaas-resource:abc123"

function resolveGlobalLane(lane?: string) {
  const cleaned = lane?.trim();
  if (cleaned === CommandLane.Cron) return CommandLane.Nested; // cron → nested，避免死锁
  return cleaned ? cleaned : CommandLane.Main;
}
// 示例：lane="nested" → globalLane="nested"
```

### 1.2 双 Lane 嵌套的执行语义

一个 Agent 运行任务必须**同时获取两个 Lane 的执行槽位**才能开始执行：

```
任务入队流程：

1. enqueueSession(sessionLane, outerTask)
   → sessionLane 队列入队
   → 等待 sessionLane 的 maxConcurrent 槽位（默认 1）

2. 获得 sessionLane 槽位后，outerTask 开始执行
   → outerTask 内部调用 enqueueGlobal(globalLane, innerTask)
   → globalLane 队列入队
   → 等待 globalLane 的 maxConcurrent 槽位

3. 获得 globalLane 槽位后，innerTask 开始执行
   → 实际 Agent 运行（LLM 推理 + 工具调用）

4. innerTask 完成 → 释放 globalLane 槽位
5. outerTask 完成 → 释放 sessionLane 槽位
```

### 1.3 当前瓶颈的精确定位

```
AIEMAS 编排 Agent 并发调用 4 个子 Agent：

调用 1: aiemas_sessions_send(aieiaas-resource)
  → sessions_send → callGateway("agent", { lane: "nested", sessionKey: "agent:aieiaas-resource:uuid" })
  → runEmbeddedPiAgent:
      sessionLane = "session:agent:aieiaas-resource:uuid"  ← 独立，无竞争
      globalLane  = "nested"                                ← 共享，maxConcurrent=1

调用 2: aiemas_sessions_send(aieiaas-model)
  → sessions_send → callGateway("agent", { lane: "nested", sessionKey: "agent:aieiaas-model:uuid" })
  → runEmbeddedPiAgent:
      sessionLane = "session:agent:aieiaas-model:uuid"     ← 独立，无竞争
      globalLane  = "nested"                                ← 共享，maxConcurrent=1

调用 3: aiemas_sessions_send(aieiaas-task)
  → sessionLane = "session:agent:aieiaas-task:uuid"        ← 独立
  → globalLane  = "nested"                                  ← 共享

调用 4: aiemas_sessions_send(aieiaas-monitor)
  → sessionLane = "session:agent:aieiaas-monitor:uuid"     ← 独立
  → globalLane  = "nested"                                  ← 共享
```

**关键结论：**

- **Session Lane 层面**：4 个子 Agent 的 sessionLane 完全不同，互不竞争，天然支持并发
- **Global Lane 层面**：4 个子 Agent 共享同一个 `"nested"` globalLane，`maxConcurrent=1`，严格串行
- **瓶颈在且仅在 globalLane**：sessionLane 已经提供了 per-session 串行保证，globalLane 的 `maxConcurrent=1` 是多余的串行约束

### 1.4 与 Subagent Lane 的对比

`subagent` Lane 已经配置了较高的并发数（默认 8），证明 Gateway 设计上允许不同 session 的 Agent 运行并发执行：

```typescript
// src/config/agent-limits.ts
export const DEFAULT_SUBAGENT_MAX_CONCURRENT = 8;

// src/gateway/server-lanes.ts
export function applyGatewayLaneConcurrency(cfg: OpenClawConfig) {
  setCommandLaneConcurrency(CommandLane.Cron, cfg.cron?.maxConcurrentRuns ?? 1);
  setCommandLaneConcurrency(CommandLane.Main, resolveAgentMaxConcurrent(cfg)); // 默认 4
  setCommandLaneConcurrency(CommandLane.Subagent, resolveSubagentMaxConcurrent(cfg)); // 默认 8
  // ⚠️ 注意：nested Lane 未被配置，保持默认值 1
}
```

| Lane       | maxConcurrent                 | 用途                            |
| ---------- | ----------------------------- | ------------------------------- |
| `main`     | 4（可配置）                   | 用户直接消息                    |
| `subagent` | 8（可配置）                   | `sessions_spawn` 子 Agent       |
| `cron`     | 1（可配置）                   | 定时任务                        |
| `nested`   | **1（未配置，硬编码默认值）** | `sessions_send` 跨 session 消息 |

`nested` Lane 的 `maxConcurrent=1` 很可能是**遗漏**而非有意设计——它是 Lane 创建时的默认值，而 `applyGatewayLaneConcurrency` 中没有为它设置并发数。

---

## 二、可行性分析

### 2.1 数据安全性分析

**核心问题：提升 nested Lane 并发数是否会导致数据竞争？**

答案是**不会**，原因如下：

1. **Session 历史文件隔离**：每个 Agent 的 session 历史存储在独立的 JSONL 文件中（`~/.openclaw/agents/<agentId>/sessions/<sessionId>.jsonl`），不同 agentId 的文件完全隔离。

2. **Session Lane 已提供串行保证**：`runEmbeddedPiAgent` 的双 Lane 嵌套中，内层的 `enqueueSession(sessionLane, ...)` 已经保证了同一 sessionKey 的运行严格串行。即使 globalLane 允许并发，同一 session 的两个运行也不会同时执行。

3. **Session Store 写入安全**：Session Store（`store.json`）的写入通过 `persistSessionEntry` 函数，该函数使用 `updateSessionStore` 进行原子更新（读取-修改-写入），不同 session 的写入互不影响。

4. **Subagent Lane 的先例**：`subagent` Lane 的 `maxConcurrent=8` 已经证明了多个不同 session 的 Agent 运行可以安全并发执行。`nested` Lane 的使用场景（`sessions_send` 跨 session 消息）与 `subagent` Lane 的使用场景（`sessions_spawn` 子 Agent）在数据安全性上是等价的。

### 2.2 资源消耗分析

每个并发的 Agent 运行消耗的资源：

| 资源     | 单个 Agent 运行消耗                   | 4 个并发             |
| -------- | ------------------------------------- | -------------------- |
| 内存     | LLM 上下文 + 工具状态，约 50-200MB    | 200-800MB            |
| CPU      | LLM API 调用为 I/O 密集型，CPU 占用低 | 低                   |
| 网络     | LLM API 请求（流式）                  | 4 个并发连接         |
| 文件 I/O | Session JSONL 读写                    | 4 个独立文件，无竞争 |

**结论：** 对于 AIEMAS 的典型场景（4-6 个子 Agent），并发执行的资源消耗在可接受范围内。Gateway 已经支持 `main` Lane 4 并发 + `subagent` Lane 8 并发，额外的 `nested` Lane 并发不会显著增加资源压力。

### 2.3 对现有功能的影响分析

`nested` Lane 的所有使用场景：

| 使用场景                          | 代码位置                               | 影响分析                                        |
| --------------------------------- | -------------------------------------- | ----------------------------------------------- |
| `sessions_send` 同步模式          | `sessions-send-tool.ts` L281           | ✅ 不同 session 并发安全（sessionLane 保护）    |
| `sessions_send` A2A ping-pong     | `sessions-send-tool.a2a.ts` L106, L137 | ✅ ping-pong 的每一步都是不同 session，并发安全 |
| `agent-step.ts` 的 `runAgentStep` | `agent-step.ts` L39                    | ✅ 每次 step 针对不同 session                   |
| Cron 内部嵌套运行                 | `pi-embedded-runner/lanes.ts` L12      | ✅ Cron 触发的嵌套运行，不同 session 并发安全   |

**所有场景都通过 sessionLane 保证了同一 session 的串行执行。** 提升 nested Lane 的 globalLane 并发数不会破坏任何现有的数据一致性保证。

---

## 三、具体方案

### 方案 E1：在 `applyGatewayLaneConcurrency` 中配置 nested Lane 并发数（推荐）

**改动范围：** 2 个文件，共约 10 行代码

#### 3.1.1 改动 1：新增 nested Lane 并发数解析函数

**文件：** `src/config/agent-limits.ts`

```typescript
// 新增
export const DEFAULT_NESTED_MAX_CONCURRENT = 8;

export function resolveNestedMaxConcurrent(cfg?: OpenClawConfig): number {
  const raw = cfg?.agents?.defaults?.nested?.maxConcurrent;
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return Math.max(1, Math.floor(raw));
  }
  return DEFAULT_NESTED_MAX_CONCURRENT;
}
```

#### 3.1.2 改动 2：在 Gateway 启动时配置 nested Lane

**文件：** `src/gateway/server-lanes.ts`

```typescript
import {
  resolveAgentMaxConcurrent,
  resolveSubagentMaxConcurrent,
  resolveNestedMaxConcurrent, // 新增
} from "../config/agent-limits.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";
import { setCommandLaneConcurrency } from "../process/command-queue.js";
import { CommandLane } from "../process/lanes.js";

export function applyGatewayLaneConcurrency(cfg: OpenClawConfig) {
  setCommandLaneConcurrency(CommandLane.Cron, cfg.cron?.maxConcurrentRuns ?? 1);
  setCommandLaneConcurrency(CommandLane.Main, resolveAgentMaxConcurrent(cfg));
  setCommandLaneConcurrency(CommandLane.Subagent, resolveSubagentMaxConcurrent(cfg));
  setCommandLaneConcurrency(CommandLane.Nested, resolveNestedMaxConcurrent(cfg)); // 新增
}
```

#### 3.1.3 改动 3：热重载时同步更新

**文件：** `src/gateway/server-reload-handlers.ts`

在 `handleConfigReload` 中已有的 Lane 并发更新块中新增一行：

```typescript
setCommandLaneConcurrency(CommandLane.Cron, nextConfig.cron?.maxConcurrentRuns ?? 1);
setCommandLaneConcurrency(CommandLane.Main, resolveAgentMaxConcurrent(nextConfig));
setCommandLaneConcurrency(CommandLane.Subagent, resolveSubagentMaxConcurrent(nextConfig));
setCommandLaneConcurrency(CommandLane.Nested, resolveNestedMaxConcurrent(nextConfig)); // 新增
```

#### 3.1.4 方案评估

| 维度              | 评估                                                      |
| ----------------- | --------------------------------------------------------- |
| 改动量            | 极小（~10 行代码，3 个文件）                              |
| 风险              | 低（与 subagent Lane 的配置模式完全一致）                 |
| 数据安全          | ✅ sessionLane 已保证 per-session 串行                    |
| 向后兼容          | ✅ 默认值从 1 变为 8，行为变化但安全                      |
| 可配置性          | ✅ 用户可通过 `agents.defaults.nested.maxConcurrent` 调整 |
| 上游同步冲突      | 低（改动集中在配置层，不涉及核心队列逻辑）                |
| 是否需要改 AIEMAS | 否                                                        |

---

### 方案 E2：AIEMAS 桥接层使用自定义 Lane（备选）

如果不希望改动核心 Gateway 的 nested Lane 默认行为，可以在 AIEMAS 桥接层为 `aiemas_sessions_send` 使用自定义 Lane。

#### 3.2.1 改动：在 `mas4s-integration.ts` 中覆盖 Lane

**文件：** `src/gateway/mas4s-integration.ts`

在现有的 `callSessionsSend` 回调中，除了已有的 `maxPingPongTurns: 0` 覆盖外，新增 Lane 覆盖：

```typescript
const callSessionsSend = async (params) => {
  const noPingPongConfig = {
    ...context.config,
    session: {
      ...context.config?.session,
      agentToAgent: {
        ...context.config?.session?.agentToAgent,
        maxPingPongTurns: 0,
      },
    },
  };
  const sendTool = createSessionsSendTool({
    agentSessionKey: context.agentSessionKey,
    agentChannel: context.agentChannel,
    config: noPingPongConfig,
    callGateway,
    laneOverride: "aiemas-nested", // ← 新增：使用 AIEMAS 专用 Lane
  });
  // ...
};
```

**问题：** `createSessionsSendTool` 当前不支持 `laneOverride` 参数，`sessions-send-tool.ts` 中硬编码了 `lane: AGENT_LANE_NESTED`。需要修改 `sessions-send-tool.ts` 支持 Lane 参数化。

#### 3.2.2 需要的额外改动

**文件：** `src/agents/tools/sessions-send-tool.ts`

```typescript
// createSessionsSendTool 参数新增 laneOverride
export function createSessionsSendTool(params: {
  agentSessionKey: string;
  agentChannel: string;
  config: OpenClawConfig;
  callGateway: CallGateway;
  laneOverride?: string; // 新增
}) {
  const lane = params.laneOverride ?? AGENT_LANE_NESTED;
  // ... 在 callGateway("agent", { lane, ... }) 中使用
}
```

**文件：** `src/gateway/server-lanes.ts`

```typescript
// 新增 AIEMAS 专用 Lane 的并发配置
setCommandLaneConcurrency("aiemas-nested", 8);
```

#### 3.2.3 方案评估

| 维度              | 评估                                          |
| ----------------- | --------------------------------------------- |
| 改动量            | 中等（~20 行代码，3-4 个文件）                |
| 风险              | 低                                            |
| 数据安全          | ✅ sessionLane 已保证 per-session 串行        |
| 向后兼容          | ✅ 不改变 nested Lane 的默认行为              |
| 可配置性          | 有限（AIEMAS 专用，不通用）                   |
| 上游同步冲突      | 中（修改了 `sessions-send-tool.ts` 核心模块） |
| 是否需要改 AIEMAS | 是（`mas4s-integration.ts`）                  |

---

## 四、方案对比

| 维度         | E1（配置 nested 并发数）                 | E2（AIEMAS 自定义 Lane）            |
| ------------ | ---------------------------------------- | ----------------------------------- |
| 改动文件数   | 3                                        | 3-4                                 |
| 改动行数     | ~10                                      | ~20                                 |
| 改动核心模块 | `agent-limits.ts`（配置层）              | `sessions-send-tool.ts`（核心工具） |
| 影响范围     | 所有 `sessions_send` 调用                | 仅 AIEMAS 的 `aiemas_sessions_send` |
| 上游同步冲突 | 低                                       | 中                                  |
| 通用性       | 高（所有 nested Lane 用户受益）          | 低（仅 AIEMAS）                     |
| 设计一致性   | 高（与 main/subagent/cron 配置模式一致） | 中（引入了特殊 Lane）               |

---

## 五、推荐方案：E1

### 5.1 推荐理由

1. **nested Lane 的 `maxConcurrent=1` 是遗漏而非设计**：`applyGatewayLaneConcurrency` 中配置了 main（4）、subagent（8）、cron（可配置），唯独遗漏了 nested。所有 Lane 的数据安全都由 sessionLane 保证，nested Lane 没有理由比 subagent Lane 更保守。

2. **改动最小且模式一致**：完全复用现有的 `resolveXxxMaxConcurrent` + `setCommandLaneConcurrency` 模式，代码风格与 subagent Lane 的配置完全对齐。

3. **通用受益**：不仅 AIEMAS 受益，所有使用 `sessions_send` 的场景（包括未来的第三方插件）都能获得并发能力。

4. **可配置可回退**：用户可通过 `agents.defaults.nested.maxConcurrent: 1` 回退到串行行为。

### 5.2 默认值选择

推荐 `DEFAULT_NESTED_MAX_CONCURRENT = 8`，与 subagent Lane 对齐：

- `sessions_send` 和 `sessions_spawn` 的使用场景高度相似（都是跨 session 的 Agent 运行）
- 两者的数据安全保证机制完全相同（都依赖 sessionLane 的 per-session 串行）
- 8 并发足以覆盖 AIEMAS 的典型场景（4-6 个子 Agent），同时不会造成过大的资源压力

### 5.3 预期效果

以 AIEMAS 编排 Agent 并发调用 4 个子 Agent 为例：

```
修复前（nested maxConcurrent=1）：

时间 ──────────────────────────────────────────────────────────────────→
      │ resource (20s) │ model (15s) │ task (18s) │ monitor (12s) │
      总耗时 = 20 + 15 + 18 + 12 = 65s

修复后（nested maxConcurrent=8）：

时间 ──────────────────────────────────────────────────────────────────→
      │ resource (20s)  │
      │ model (15s)     │
      │ task (18s)      │
      │ monitor (12s)   │
      总耗时 = max(20, 15, 18, 12) = 20s

性能提升：65s → 20s（约 3.25 倍）
```

### 5.4 实施步骤

1. **修改 `src/config/agent-limits.ts`**：新增 `DEFAULT_NESTED_MAX_CONCURRENT` 和 `resolveNestedMaxConcurrent`
2. **修改 `src/gateway/server-lanes.ts`**：在 `applyGatewayLaneConcurrency` 中新增 nested Lane 配置
3. **修改 `src/gateway/server-reload-handlers.ts`**：在热重载中同步更新 nested Lane 并发数
4. **验证**：运行 `pnpm check` + `pnpm test` 确保无回归
5. **测试**：在 AIEMAS 环境中验证编排 Agent 并发调用多个子 Agent 的效果

### 5.5 回滚方案

如果上线后发现问题，用户可通过配置立即回滚：

```json
{
  "agents": {
    "defaults": {
      "nested": {
        "maxConcurrent": 1
      }
    }
  }
}
```

或者直接 revert 代码改动（3 个文件，~10 行），恢复到 nested Lane 未配置（默认 1）的状态。

---

## 六、风险与缓解

### 6.1 风险：同一 session 的并发 sessions_send

**场景：** 两个不同的 Agent 同时向同一个目标 session 发送 `sessions_send` 消息。

**分析：** 这种情况下，两个 Agent 运行的 globalLane 都是 `"nested"`，但 sessionLane 相同（目标 session 的 key）。由于 sessionLane 的 `maxConcurrent=1`，两个运行仍然会串行执行。**不受 nested Lane 并发数变化的影响。**

```
Agent A → sessions_send(target=session-X) → sessionLane="session:session-X" → 串行
Agent B → sessions_send(target=session-X) → sessionLane="session:session-X" → 串行（排队等待 A 完成）
```

### 6.2 风险：资源耗尽

**场景：** 大量并发的 `sessions_send` 调用导致过多的 Agent 运行同时执行。

**缓解：**

- `maxConcurrent=8` 限制了最多 8 个并发运行，与 subagent Lane 一致
- 用户可通过配置降低并发数
- Gateway 的内存/CPU 监控可以发现资源压力

### 6.3 风险：LLM API 并发限制

**场景：** 多个并发 Agent 运行同时调用 LLM API，触发 API 速率限制。

**缓解：**

- 这是现有问题（main Lane 已经支持 4 并发，subagent Lane 支持 8 并发）
- Gateway 已有 API 速率限制处理和重试机制
- AIEMAS 的子 Agent 通常使用同一个 LLM provider，但不同的 session 上下文，API 调用量与串行模式相同（只是时间分布不同）

### 6.4 风险：上游同步冲突

**分析：** 改动集中在配置层（`agent-limits.ts`、`server-lanes.ts`、`server-reload-handlers.ts`），这些文件的变更频率较低，且改动是纯增量的（新增函数和调用），不修改现有代码。冲突概率低。

---

## 七、补充验证项

实施前建议确认以下几点：

1. **确认 sessionLane 的 maxConcurrent 始终为 1**：sessionLane 是动态创建的（`getLaneState` 中 `maxConcurrent: 1`），且没有任何代码修改它的并发数。需要确认没有遗漏的 `setCommandLaneConcurrency("session:...", N)` 调用。

2. **确认 Session Store 的写入原子性**：`persistSessionEntry` 使用 `updateSessionStore` 进行文件级原子更新（读取-修改-写入）。如果多个并发运行同时更新不同 session 的 entry，需要确认文件锁或原子写入机制能防止数据丢失。

3. **确认 JSONL 文件写入安全**：不同 session 的 JSONL 文件是独立的，但需要确认同一 session 的 JSONL 写入不会因为 globalLane 并发而出现竞争（理论上 sessionLane 已保证串行，但需要确认没有绕过 sessionLane 的写入路径）。

---

## 八、参考

### 核心源码

| 文件                                     | 关键函数/常量                                                    | 作用                           |
| ---------------------------------------- | ---------------------------------------------------------------- | ------------------------------ |
| `src/process/command-queue.ts`           | `enqueueCommandInLane`, `drainLane`, `setCommandLaneConcurrency` | Lane 队列核心实现              |
| `src/process/lanes.ts`                   | `CommandLane` enum                                               | Lane 名称定义                  |
| `src/agents/pi-embedded-runner/run.ts`   | `runEmbeddedPiAgent`                                             | 双 Lane 嵌套入口               |
| `src/agents/pi-embedded-runner/lanes.ts` | `resolveSessionLane`, `resolveGlobalLane`                        | Lane 解析逻辑                  |
| `src/config/agent-limits.ts`             | `resolveAgentMaxConcurrent`, `resolveSubagentMaxConcurrent`      | 并发数配置解析                 |
| `src/gateway/server-lanes.ts`            | `applyGatewayLaneConcurrency`                                    | Gateway 启动时 Lane 配置       |
| `src/gateway/server-reload-handlers.ts`  | 热重载中的 Lane 并发更新                                         | 配置热重载                     |
| `src/agents/tools/sessions-send-tool.ts` | `lane: AGENT_LANE_NESTED`                                        | sessions_send 使用 nested Lane |
