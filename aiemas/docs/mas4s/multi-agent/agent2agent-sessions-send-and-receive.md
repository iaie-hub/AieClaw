# 消息发送与接收（sessions_send + 目标 Session 接收）

> 本文档合并了 `sessions_send` 工具的消息发送流程与目标 Session 的消息接收方案。

---

## 一、`sessions_send` 工具

**源文件：** `src/agents/tools/sessions-send-tool.ts`  
**A2A Flow：** `src/agents/tools/sessions-send-tool.a2a.ts`

Agent 通过 `sessions_send` 工具向另一个 session 发送消息，支持**同步等待**和**异步发射**两种模式。

---

### 1.1 工具参数 Schema

```typescript
// SessionsSendToolSchema
{
  sessionKey?:     string;          // 目标 session key（与 label 二选一）
  label?:          string;          // 目标 session 的人类可读标签
  agentId?:        string;          // 配合 label 使用，指定目标 agentId（跨 agent label 查找时用）
  message:         string;          // 要发送的消息（必填）
  timeoutSeconds?: number;          // 等待回复的最大秒数，默认 600，设为 0 = 不等待（异步）
}
```

> `sessionKey` 和 `label` 不能同时提供，否则返回 `status: "error"`。

---

### 1.2 目标 Session 解析（三条路径）

**路径 A：通过 `label` 查找（需 A2A 权限预检）**

```
label + agentId? 输入
  │
  ├─ 提前 A2A 预检（跨 agent 时）：
  │   ├─ a2aPolicy.enabled?  否 → forbidden
  │   └─ a2aPolicy.isAllowed(requesterAgentId, requestedAgentId)?  否 → forbidden
  │
  ├─ callGateway("sessions.resolve", { label, agentId?, spawnedBy? })
  │   └── Gateway 按 label + agentId 过滤，返回匹配的 session key
  │
  └─ resolvedKey（内部 canonical key）
```

**路径 B：通过 `sessionKey` 直接解析（`resolveSessionReference`）**

```typescript
// sessions-resolution.ts
async function resolveSessionReference(params: {
  sessionKey: string; // 原始输入（可能是 "main" / sessionId / 完整 key）
  alias: string; // agent 主 session 别名
  mainKey: string; // 内部 mainKey
  requesterInternalKey?: string;
  restrictToSpawned: boolean;
});
```

解析优先级：

1. 特殊关键字 `"current"` → 先尝试 Gateway key 解析，再尝试 sessionId 解析
2. **疑似非标准 key**（`shouldResolveSessionIdInput` 返回 true）：先尝试 key 解析，再尝试 sessionId 解析
3. **标准 key 格式**（`agent:xxx:yyy`、`cron:xxx` 等）：`resolveInternalSessionKey` 直接映射

`shouldResolveSessionIdInput` 的判断：

```typescript
// 把不像 session key 格式的值当 sessionId 候选
looksLikeSessionId(value) || !looksLikeSessionKey(value);
```

**路径 C：Sandbox 模式下的可见性验证（`resolveVisibleSessionReference`）**

沙盒 session 还需通过 `isRequesterSpawnedSessionVisible` 确认目标 session 是否由该 session spawn 而来：

```typescript
// 优先用 sessions.resolve { spawnedBy } 快速验证
callGateway("sessions.resolve", { key: target, spawnedBy: requester });
// 若失败，fallback 到 sessions.list { spawnedBy: requester } 全量比对
```

---

### 1.3 发送前权限检查（双层）

```typescript
// 第一层：Visibility Guard（预先构建，O(1) 检查）
const visibilityGuard = await createSessionVisibilityGuard({
  action: "send",
  requesterSessionKey: effectiveRequesterKey,
  visibility, // "self" | "tree" | "agent" | "all"
  a2aPolicy,
});

// 构建时预加载：visibility=="tree" 时异步拉取所有子 session
const spawnedKeys =
  visibility === "tree"
    ? await listSpawnedSessionKeys({ requesterSessionKey }) // sessions.list { spawnedBy }
    : null;

// check 函数（同步）：基于 resolvedKey 做最终判断
const access = visibilityGuard.check(resolvedKey);
```

`check` 的判断逻辑（按顺序短路）：

```typescript
const isCrossAgent = targetAgentId !== requesterAgentId;

if (isCrossAgent) {
  if (visibility !== "all")   → forbidden: "Session send visibility is restricted..."
  if (!a2aPolicy.enabled)     → forbidden: "Agent-to-agent messaging is disabled..."
  if (!a2aPolicy.isAllowed()) → forbidden: "Agent-to-agent messaging denied by ..."
  return { allowed: true };
}

// 同 agent 内部
if (visibility === "self" && target !== requester) → forbidden
if (visibility === "tree" && !spawnedKeys.has(target)) → forbidden
return { allowed: true };
```

---

### 1.4 Gateway `agent` 方法调用（消息注入）

通过权限检查后，构建以下参数发送到 Gateway：

```typescript
const sendParams = {
  message,
  sessionKey: resolvedKey, // canonical session key
  idempotencyKey: crypto.randomUUID(), // UUID，防重复执行
  deliver: false, // 不向用户 channel 投递
  channel: "internal", // INTERNAL_MESSAGE_CHANNEL
  lane: "nested", // AGENT_LANE_NESTED，与 subagent 队列隔离
  extraSystemPrompt: agentMessageContext, // 注入 A2A 上下文到 agent 系统提示
  inputProvenance: {
    kind: "inter_session",
    sourceSessionKey: opts?.agentSessionKey, // 发送方 session key
    sourceChannel: opts?.agentChannel, // 发送方 channel
    sourceTool: "sessions_send",
  },
};
```

`agentMessageContext`（由 `buildAgentToAgentMessageContext` 生成）：

```
Agent-to-agent message context:
Agent 1 (requester) session: agent:alice:subagent:xxx.
Agent 1 (requester) channel: telegram.
Agent 2 (target) session: agent:bob:main.
```

---

### 1.5 同步模式：等待回复

```typescript
// 1. 提交运行（10s 超时）
const start = await startAgentRun({ callGateway, runId, sendParams, sessionKey });
// startAgentRun 内部：callGateway("agent", sendParams, timeoutMs: 10_000)
// 成功返回 { ok: true, runId: gatewayRunId }（优先用 Gateway 返回的 runId）

// 2. 拿 baseline（防止读取到历史旧回复）
const baselineReply = await readLatestAssistantReplySnapshot({
  sessionKey: resolvedKey,
  limit: 50,
});
// 内部：callGateway("chat.history", { sessionKey, limit: 50 })
// 返回最新一条 assistant 消息的文本 + fingerprint（JSON 序列化）

// 3. 等待运行完成 + 比对拿新回复
const result = await waitForAgentRunAndReadUpdatedAssistantReply({
  runId,
  sessionKey: resolvedKey,
  timeoutMs, // timeoutSeconds * 1000
  limit: 50,
  baseline: baselineReply,
  callGateway,
});
// 内部：callGateway("agent.wait", { runId, timeoutMs }, timeoutMs: timeoutMs+2000)
// 完成后：callGateway("chat.history") 再读最新 assistant 消息
// fingerprint 与 baseline 相同 → replyText = undefined（忽略旧回复）
```

返回值：

| 状态                                                   | 含义               |
| ------------------------------------------------------ | ------------------ |
| `{ status: "ok", reply, runId, sessionKey, delivery }` | 同步拿到回复       |
| `{ status: "accepted", runId, sessionKey, delivery }`  | 异步模式，不等回复 |
| `{ status: "timeout", runId, error }`                  | `agent.wait` 超时  |
| `{ status: "error", runId, error }`                    | 运行出错或提交失败 |
| `{ status: "forbidden", error }`                       | 权限拒绝           |

---

### 1.6 异步模式（`timeoutSeconds=0`）

```typescript
if (timeoutSeconds === 0) {
  const start = await startAgentRun(...);
  const runId = start.runId;

  // 不读 baseline，不等 agent.wait
  // 把 runId 传给 A2A Flow，由它异步等待
  startA2AFlow(undefined, runId);
  // startA2AFlow 内部：void runSessionsSendA2AFlow({ ..., waitRunId: runId })
  // A2A Flow 中：waitForAgentRun({ runId, timeoutMs: min(announceTimeoutMs, 60s) })

  return jsonResult({ runId, status: "accepted", sessionKey: displayKey, delivery });
}
```

`delivery` 字段：`{ status: "pending", mode: "announce" }` — 表示结果将通过 announce 机制异步投递。

---

## 二、目标 Session 消息接收方案

`sessions_send` 描述了消息如何从 Agent A **发出**，本节描述消息如何在目标 Agent B 的 session 中被**接收和处理**。

---

### 2.1 整体接收流程概览

```
Agent A 调用 sessions_send(message, sessionKey=B)
  │
  │  callGateway("agent", { message, sessionKey, lane:"nested", channel:"internal", deliver:false, ... })
  │
  ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Gateway 进程 — agent 方法处理器                                        │
│  (src/gateway/server-methods/agent.ts)                                  │
│                                                                          │
│  1. 参数验证与规范化                                                     │
│  2. Session 元数据更新（Session Store 持久化）                           │
│  3. 立即返回 { status:"accepted", runId } 给调用方                      │
│  4. 异步调用 dispatchAgentRunFromGateway()                              │
└────────────────────────┬────────────────────────────────────────────────┘
                         │ 异步
                         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Command Queue — Lane 队列调度                                          │
│  (src/process/command-queue.ts)                                         │
│                                                                          │
│  任务入队到 "nested" lane（maxConcurrent=1）                            │
│  等待 lane 空闲 → 出队执行                                              │
└────────────────────────┬────────────────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│  Agent B 运行 — agentCommandInternal                                    │
│  (src/agents/agent-command.ts → attempt.ts)                             │
│                                                                          │
│  1. 加载/创建 Agent B 的 session（含历史消息）                           │
│  2. 注入 extraSystemPrompt（A2A 上下文）                                │
│  3. 将 message 作为用户消息提交给 LLM                                   │
│  4. Agent B 执行推理 + 工具调用                                         │
│  5. 生成回复（写入 session 历史）                                       │
│  6. 回复投递决策（deliver=false → 不向外部 channel 推送）               │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### 2.2 Gateway 接收与分发（第一阶段）

**源文件：** `src/gateway/server-methods/agent.ts`

当 `sessions_send` 调用 `callGateway("agent", sendParams)` 时，Gateway 的 `agent` 方法处理器执行以下步骤：

**步骤 1：参数验证与规范化**

```typescript
// Gateway 接收到的关键参数（来自 sessions_send）
{
  message: "用户发送的消息内容",
  sessionKey: "agent:bob:main",           // 目标 session 的 canonical key
  idempotencyKey: "uuid-xxx",             // 幂等键，防重复执行
  deliver: false,                         // 不向外部 channel 投递
  channel: "internal",                    // INTERNAL_MESSAGE_CHANNEL = "webchat"
  lane: "nested",                         // AGENT_LANE_NESTED
  extraSystemPrompt: "Agent-to-agent...", // A2A 上下文注入
  inputProvenance: {
    kind: "inter_session",
    sourceSessionKey: "agent:alice:main",
    sourceChannel: "telegram",
    sourceTool: "sessions_send",
  },
}
```

Gateway 对参数进行规范化处理：

- 解析 `sessionKey` → 获取目标 agentId、sessionId
- 规范化 `channel` → `INTERNAL_MESSAGE_CHANNEL`（值为 `"webchat"`）
- 幂等检查 → 通过 `idempotencyKey` 查重，防止同一消息被重复处理

**步骤 2：Session 元数据更新**

```typescript
// 从 Session Store 加载目标 session 的现有元数据
const { cfg, entry, canonicalKey } = loadSessionEntry(requestedSessionKey);

// 更新 session 元数据（持久化到 ~/.openclaw/sessions/<agentId>/store.json）
await updateSessionStore(storePath, (store) => {
  store[primaryKey] = mergeSessionEntry(store[primaryKey], {
    sessionId,
    updatedAt: Date.now(),
    lastChannel: resolvedChannel, // "webchat"（internal）
    // ... 其他元数据
  });
});
```

**步骤 3：立即返回 accepted 响应**

```typescript
const accepted = { runId, status: "accepted", acceptedAt: Date.now() };
respond(true, accepted, undefined, { runId });
// 调用方（Agent A）立即拿到 runId，不需要等待 Agent B 完成
```

**步骤 4：deliver 标志的最终决策**

Gateway 在分发前会对 `deliver` 做最终判断：

```typescript
// src/gateway/server-methods/agent.ts 第 795 行
const deliver = request.deliver === true && resolvedChannel !== INTERNAL_MESSAGE_CHANNEL;
// sessions_send 传入 deliver=false，且 channel="webchat"（INTERNAL_MESSAGE_CHANNEL）
// 因此 deliver 最终为 false → Agent B 的回复不会被推送到任何外部 channel
```

**步骤 5：异步分发 Agent 运行**

```typescript
dispatchAgentRunFromGateway({
  ingressOpts: {
    message, // 原始消息
    sessionKey: resolvedSessionKey,
    lane: "nested", // 进入 nested lane 队列
    channel: "webchat", // internal channel
    deliver: false, // 不外部投递
    extraSystemPrompt, // A2A 上下文
    inputProvenance, // 来源追踪
    // ... 其他参数
  },
  runId,
  idempotencyKey: idem,
});
```

> **关键设计：** `dispatchAgentRunFromGateway` 是 fire-and-forget 模式（`void agentCommandFromIngress(...)`），Gateway 不等待 agent 运行完成。调用方通过 `agent.wait` RPC 轮询 runId 状态来获取结果。

**步骤 6：Task 跟踪排除**

```typescript
// dispatchAgentRunFromGateway 内部
const inputProvenance = normalizeInputProvenance(params.ingressOpts.inputProvenance);
const shouldTrackTask =
  params.ingressOpts.sessionKey?.trim() && inputProvenance?.kind !== "inter_session";
// inter_session 类型的消息不会被记录到 Running Task 跟踪系统
// 这避免了 A2A 内部消息污染用户可见的任务列表
```

---

### 2.3 Lane 队列调度（第二阶段）

**源文件：** `src/process/command-queue.ts`、`src/process/lanes.ts`

`agentCommandFromIngress` 通过 Command Queue 的 Lane 机制进行调度。

**Lane 定义：**

```typescript
// src/process/lanes.ts
export const enum CommandLane {
  Main = "main", // 主 agent 运行（用户直接消息）
  Cron = "cron", // 定时任务
  Nested = "nested", // sessions_send 的跨 session 消息
  Subagent = "subagent", // sessions_spawn 的子 agent 任务
}
```

**队列状态结构：**

```typescript
type LaneState = {
  lane: string;
  queue: QueueEntry[]; // 待执行任务队列（FIFO）
  activeTaskIds: Set<number>; // 当前活跃任务 ID 集合
  maxConcurrent: number; // 每个 lane 最多 1 个并发任务
  draining: boolean;
  generation: number;
};
```

**调度流程：**

```
sessions_send 消息到达
  │
  ├─ enqueueCommand("nested", agentTask)
  │   └── 任务入队到 nested lane 的 FIFO 队列
  │
  ├─ pump()  ← 触发队列处理
  │   ├─ 检查 activeTaskIds.size < maxConcurrent（1）
  │   ├─ 是 → 出队任务，开始执行
  │   └─ 否 → 等待当前任务完成后自动 pump
  │
  └─ 任务完成后
      ├─ activeTaskIds.delete(taskId)
      └─ pump()  ← 继续处理下一个排队任务
```

**Lane 隔离的意义：**

| Lane       | 用途                    | 隔离效果                                   |
| ---------- | ----------------------- | ------------------------------------------ |
| `main`     | 用户直接消息            | 用户消息不会被 A2A 消息阻塞                |
| `nested`   | `sessions_send` 消息    | A2A 消息在独立队列中排队，不影响主 lane    |
| `subagent` | `sessions_spawn` 子任务 | 子 agent 任务与 sessions_send 消息互不阻塞 |
| `cron`     | 定时任务                | 定时任务独立运行                           |

> **注意：** 每个 lane 的 `maxConcurrent=1`，同一 lane 内的消息严格串行执行。如果 Agent B 的 nested lane 已有一个 A2A 消息在处理中，后续的 `sessions_send` 消息会排队等待。

---

### 2.4 Agent B 运行执行（第三阶段）

**源文件：** `src/agents/agent-command.ts`、`src/agents/pi-embedded-runner/run/attempt.ts`

当 nested lane 队列轮到该任务时，`agentCommandFromIngress` 开始执行 Agent B 的运行。

**步骤 1：准备执行环境**

```typescript
// agentCommandInternal 内部
const prepared = await prepareAgentCommandExecution(opts, runtime);
// 解析出：
//   - cfg: Agent B 的配置
//   - sessionId / sessionKey: 目标 session 标识
//   - sessionFile: session 历史文件路径（~/.openclaw/sessions/<agentId>/<sessionId>.jsonl）
//   - workspaceDir: 工作区目录
//   - agentDir: agent 配置目录
//   - model / provider: 使用的模型
//   - runId: 本次运行 ID
```

**步骤 2：创建 Agent Session（加载历史）**

```typescript
// attempt.ts 内部
const { session } = await createAgentSession({
  cwd: resolvedWorkspace,
  agentDir,
  model: params.model,
  thinkingLevel: mapThinkingLevel(params.thinkLevel),
  tools: builtInTools, // Agent B 可用的工具集
  customTools: allCustomTools,
  sessionManager, // 管理 session 历史的加载/持久化
  // ...
});
```

`createAgentSession` 会：

1. 从 `sessionFile`（`.jsonl` 文件）加载 Agent B 的完整对话历史
2. 初始化 Agent B 的系统提示（包含 agent 配置、工具定义等）
3. 准备 LLM 推理上下文

**步骤 3：注入 A2A 上下文（extraSystemPrompt）**

```typescript
// extraSystemPrompt 被注入到 Agent B 的系统提示中
applySystemPromptOverrideToSession(session, systemPromptText);
// systemPromptText 包含 extraSystemPrompt 的内容，例如：
//
// Agent-to-agent message context:
// Agent 1 (requester) session: agent:alice:main.
// Agent 1 (requester) channel: telegram.
// Agent 2 (target) session: agent:bob:main.
```

这使得 Agent B 在处理消息时能够感知到：

- 消息来自哪个 agent（Agent A）
- 来源 session 和 channel
- 当前处于 A2A 通信上下文中

**步骤 4：消息提交给 LLM**

```typescript
// attempt.ts 中，消息作为用户输入提交
const effectivePrompt = body; // 即 sessions_send 传入的 message

if (promptOptions) {
  await abortable(activeSession.prompt(effectivePrompt, promptOptions));
} else {
  await abortable(activeSession.prompt(effectivePrompt));
}
```

此时 Agent B 的 LLM 收到的完整上下文为：

```
┌─────────────────────────────────────────────────────────┐
│  System Prompt                                           │
│  ├─ Agent B 的基础系统提示                               │
│  ├─ Agent B 的工具定义                                   │
│  └─ [注入] A2A 上下文（extraSystemPrompt）               │
│                                                          │
│  历史消息（从 sessionFile 加载）                          │
│  ├─ 之前的 user/assistant 对话                           │
│  └─ ...                                                  │
│                                                          │
│  当前用户消息                                             │
│  └─ sessions_send 传入的 message                         │
└─────────────────────────────────────────────────────────┘
```

**步骤 5：Agent B 执行推理**

Agent B 像处理普通用户消息一样执行推理：

- LLM 生成回复（可能包含工具调用）
- 如果有工具调用，执行工具并将结果反馈给 LLM
- 循环直到 LLM 生成最终回复（`end_turn`）

**步骤 6：回复持久化**

Agent B 的回复被写入 session 历史文件（`sessionFile`），包括：

- 用户消息（来自 Agent A 的 message）
- assistant 回复（Agent B 的响应）
- 工具调用记录（如有）

**步骤 7：回复投递决策**

```typescript
// deliverAgentCommandResult 内部
// 由于 deliver=false 且 channel=INTERNAL_MESSAGE_CHANNEL
// Agent B 的回复不会被推送到任何外部 channel（Telegram、Discord 等）
// 回复仅存在于 session 历史中，供调用方通过 chat.history 读取
```

---

### 2.5 调用方如何获取 Agent B 的回复

Agent B 运行完成后，调用方（Agent A）通过以下机制获取回复：

**同步模式（`timeoutSeconds > 0`）：**

```typescript
// 1. Agent A 通过 agent.wait 等待 runId 完成
await callGateway("agent.wait", { runId, timeoutMs });

// 2. 完成后，通过 chat.history 读取 Agent B 的最新回复
const history = await callGateway("chat.history", {
  sessionKey: targetSessionKey,
  limit: 50,
});

// 3. 通过 fingerprint 比对确认是本次运行产生的新回复（非历史旧回复）
const latestReply = extractLatestAssistantReply(history);
if (latestReply.fingerprint !== baselineFingerprint) {
  return latestReply.text; // 新回复
}
```

**异步模式（`timeoutSeconds = 0`）：**

```typescript
// Agent A 立即返回 { status: "accepted", runId }
// A2A Flow 在后台异步等待 Agent B 完成
// 完成后通过 Announce 机制将结果推送到 Agent B 的外部 channel
```

---

### 2.6 inputProvenance 在接收侧的作用

`inputProvenance` 在目标 session 的接收侧有以下具体影响：

| 影响点               | 行为                                                                                            |
| -------------------- | ----------------------------------------------------------------------------------------------- |
| **Task 跟踪排除**    | `kind === "inter_session"` 的消息不会被记录到 Running Task 系统，避免污染用户可见的任务列表     |
| **审计追踪**         | 消息来源（sourceSessionKey、sourceChannel、sourceTool）被记录，支持跨 session 消息溯源          |
| **Session 事件通知** | Gateway 发出 `sessions_changed` 事件（reason: "send"），通知 UI 刷新 session 列表               |
| **Subagent 重激活**  | 如果目标 session 是已完成的 subagent session，`reactivateCompletedSubagentSession` 会重新激活它 |

---

### 2.7 目标 Session 区分 A2A 消息与普通消息

Agent B 的 session 通过以下信号区分 A2A 消息和普通用户消息：

| 信号                   | A2A 消息（sessions_send）               | 普通用户消息                  |
| ---------------------- | --------------------------------------- | ----------------------------- |
| `channel`              | `"webchat"`（INTERNAL_MESSAGE_CHANNEL） | `"telegram"` / `"discord"` 等 |
| `lane`                 | `"nested"`                              | `"main"`                      |
| `deliver`              | `false`                                 | `true`（通常）                |
| `inputProvenance.kind` | `"inter_session"`                       | 无 / `"user_input"`           |
| `extraSystemPrompt`    | 包含 A2A 上下文信息                     | 无 / 其他上下文               |

> **重要：** 从 Agent B 的 LLM 视角看，A2A 消息和普通用户消息的处理方式**完全相同**——都是作为用户消息提交给 LLM 推理。区别仅在于：(1) 系统提示中注入了 A2A 上下文；(2) 回复不会被投递到外部 channel。

---

### 2.8 完整接收时序图

```
Agent A                    Gateway                     Agent B Session
  │                           │                             │
  │──callGateway("agent")────→│                             │
  │                           │                             │
  │                           │── 1. 验证参数               │
  │                           │── 2. 更新 Session Store     │
  │                           │── 3. 幂等检查               │
  │                           │                             │
  │←──{accepted, runId}───────│                             │
  │                           │                             │
  │                           │── 4. dispatchAgentRun ──────│
  │                           │      (异步, fire-and-forget)│
  │                           │                             │
  │                           │         ┌───────────────────┤
  │                           │         │ Command Queue     │
  │                           │         │ Lane: "nested"    │
  │                           │         │ 等待 lane 空闲    │
  │                           │         └───────┬───────────┤
  │                           │                 │           │
  │                           │                 ▼           │
  │                           │         ┌───────────────────┤
  │                           │         │ agentCommandInternal
  │                           │         │                   │
  │                           │         │ a. 加载 session   │
  │                           │         │    历史           │
  │                           │         │ b. 注入 A2A      │
  │                           │         │    extraSystem    │
  │                           │         │    Prompt         │
  │                           │         │ c. 提交 message  │
  │                           │         │    给 LLM        │
  │                           │         │ d. LLM 推理      │
  │                           │         │    + 工具调用     │
  │                           │         │ e. 生成回复      │
  │                           │         │ f. 持久化到      │
  │                           │         │    sessionFile   │
  │                           │         │ g. deliver=false  │
  │                           │         │    → 不外部投递   │
  │                           │         └───────┬───────────┤
  │                           │                 │           │
  │                           │←── run 完成 ────┘           │
  │                           │  (runId 状态更新为 "ok")    │
  │                           │                             │
  │──callGateway              │                             │
  │  ("agent.wait",{runId})──→│                             │
  │←──{status:"ok"}──────────│                             │
  │                           │                             │
  │──callGateway              │                             │
  │  ("chat.history")────────→│──── 读取 sessionFile ──────→│
  │←──{messages:[...]}────────│←── 返回历史消息 ────────────│
  │                           │                             │
  │  提取最新 assistant 回复   │                             │
  │  (fingerprint 比对)        │                             │
```

---

### 2.9 关键设计总结

| 设计点               | 实现方式                                                                 |
| -------------------- | ------------------------------------------------------------------------ |
| **异步非阻塞接收**   | Gateway 立即返回 accepted，agent 运行在后台异步执行                      |
| **Lane 队列隔离**    | A2A 消息在 `nested` lane 中排队，不阻塞主 lane 的用户消息                |
| **内部通道不外泄**   | `channel="webchat"` + `deliver=false` 确保回复不推送到外部 channel       |
| **透明处理**         | Agent B 的 LLM 以处理普通用户消息的方式处理 A2A 消息，无需特殊适配       |
| **上下文感知**       | `extraSystemPrompt` 注入 A2A 上下文，使 Agent B 知道消息来源             |
| **回复拉取而非推送** | 调用方通过 `agent.wait` + `chat.history` 主动拉取回复，而非 Gateway 推送 |
| **幂等保护**         | `idempotencyKey` 防止网络重试导致同一消息被 Agent B 处理两次             |
| **Task 跟踪隔离**    | `inter_session` 类型的消息不进入 Running Task 系统，保持用户任务列表干净 |
