# Agent-to-Agent (A2A) 通信实现分析

## 总览

AieClaw 中的 Agent-to-Agent 通信基于 **Gateway 中间层** 实现，所有跨 agent 的消息发送均通过 `callGateway` 进行，不存在 agent 之间的直接 socket/内存调用。

---

## 一、消息发送方案（详细分析）

### 1.1 `sessions_send` 工具

**源文件：** `src/agents/tools/sessions-send-tool.ts`  
**A2A Flow：** `src/agents/tools/sessions-send-tool.a2a.ts`

Agent 通过 `sessions_send` 工具向另一个 session 发送消息，支持**同步等待**和**异步发射**两种模式。

---

#### 1.1.1 工具参数 Schema

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

#### 1.1.2 目标 Session 解析（三条路径）

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

#### 1.1.3 发送前权限检查（双层）

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

#### 1.1.4 Gateway `agent` 方法调用（消息注入）

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

#### 1.1.5 同步模式：等待回复

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

#### 1.1.6 异步模式（`timeoutSeconds=0`）

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

### 1.2 `sessions_spawn` 工具 — 创建子 Agent（详细分析）

**源文件：** `src/agents/subagent-spawn.ts`

---

#### 1.2.1 参数与前置检查

```typescript
type SpawnSubagentParams = {
  task: string; // 子 agent 要执行的任务描述
  label?: string; // 标识符（用于父 agent 识别子 session）
  agentId?: string; // 目标 agent id，不填则继承发送方 agentId
  model?: string; // 模型覆盖（"provider/model" 格式）
  thinking?: string; // 思考等级覆盖
  runTimeoutSeconds?: number; // 运行超时秒数（0=不限制）
  thread?: boolean; // 是否绑定到消息线程
  mode?: "run" | "session";
  cleanup?: "delete" | "keep";
  sandbox?: "inherit" | "require";
  expectsCompletionMessage?: boolean;
  attachments?: Attachment[]; // 文件附件
  attachMountPath?: string;
};
```

前置检查（按顺序，任一失败立即返回）：

| 检查项                                               | 失败结果              |
| ---------------------------------------------------- | --------------------- |
| `agentId` 格式合法性（`isValidAgentId`）             | `status: "error"`     |
| `callerDepth >= maxSpawnDepth`（默认 5 层）          | `status: "forbidden"` |
| `activeChildren >= maxChildrenPerAgent`（默认 5 个） | `status: "forbidden"` |
| `requireAgentId=true` 但未提供 `agentId`             | `status: "forbidden"` |
| 目标 agentId 不在 `allowAgents` 白名单               | `status: "forbidden"` |
| 沙盒 session 尝试 spawn 非沙盒子 agent               | `status: "forbidden"` |

---

#### 1.2.2 Spawn 流程（六步）

```
步骤 1: 生成 childSessionKey
  └── "agent:{targetAgentId}:subagent:{crypto.randomUUID()}"

步骤 2: sessions.patch — 写入子 session 初始元数据
  └── { spawnDepth, subagentRole, subagentControlScope, model?, thinkingLevel? }

步骤 3: 持久化 model 到 Session Store（如指定了 model）
  └── updateSessionStore(storePath, { model, modelProvider })

步骤 4: 线程绑定（thread=true 时）
  └── hookRunner.runSubagentSpawning → channel plugin 分配或绑定线程

步骤 5: 物化附件（如有 attachments）
  └── materializeSubagentAttachments → 写入磁盘，返回系统提示后缀

步骤 6: 写入 lineage 元数据（spawnedBy + workspaceDir）
  └── sessions.patch(childSessionKey, { spawnedBy: requesterKey, spawnedWorkspaceDir })

步骤 7: 提交子 agent 运行
  └── callGateway("agent", {
        message: childTaskMessage,     // "[Subagent Context]... [Subagent Task]: {task}"
        sessionKey: childSessionKey,
        lane: "subagent",
        deliver: false,
        idempotencyKey: crypto.randomUUID(),
        extraSystemPrompt: childSystemPrompt + attachmentSuffix,
        thinking: thinkingOverride,
        timeout: runTimeoutSeconds,
        label,
        spawnedBy: requesterKey,
        workspaceDir: resolvedWorkspaceDir,
      })
  → 返回 { childSessionKey, runId, status: "accepted" }
```

---

#### 1.2.3 子 agent 系统提示注入

`buildSubagentSystemPrompt` 注入以下上下文（`extraSystemPrompt`）：

- 请求方 session key + 原始来源（channel/to/threadId）
- 当前 spawnDepth/maxSpawnDepth
- auto-announce 行为说明（禁止轮询，等待 completion event）

`childTaskMessage`（作为子 agent 的第一条用户消息）：

```
[Subagent Context] You are running as a subagent (depth 1/5). Results auto-announce to your requester; do not busy-poll for status.
[Subagent Task]: <task 内容>
```

---

## 二、通信协议

### 2.1 协议层架构

所有跨 session 通信均通过 `callGateway()` 这一统一入口，底层走 WebSocket/IPC 到 Gateway 进程：

```
┌─────────────────────────────────────────────────────────┐
│                    Agent (A / B)                         │
│  callGateway(method, params)                             │
└────────────────────────┬────────────────────────────────┘
                         │ WebSocket / IPC
                         ▼
┌─────────────────────────────────────────────────────────┐
│                   Gateway 进程                           │
│  负责 session 路由、消息队列、运行状态跟踪                   │
└─────────────────────────────────────────────────────────┘
```

### 2.2 关键 Gateway 方法

| 方法               | 用途                                                   |
| ------------------ | ------------------------------------------------------ |
| `agent`            | 向指定 sessionKey 注入消息并触发 agent 运行            |
| `agent.wait`       | 阻塞等待指定 runId 完成                                |
| `chat.history`     | 读取指定 session 的消息历史                            |
| `sessions.patch`   | 修改 session 元数据（spawnDepth, model 等）            |
| `sessions.delete`  | 删除 session（错误清理用）                             |
| `sessions.resolve` | 通过 label/agentId 查找 session key                    |
| `send`             | 向指定 channel/to 发出外部消息（Telegram、Discord 等） |

### 2.3 消息元数据

每条跨 agent 的 `agent` 方法调用都会携带溯源信息：

```typescript
inputProvenance: {
  kind: "inter_session",
  sourceSessionKey: "agent:requester:...",
  sourceChannel: "internal",
  sourceTool: "sessions_send" | "subagent_announce" | "sessions_spawn"
}
```

### 2.4 Lane 机制

不同类型的 A2A 调用使用不同的 lane，避免队列干扰：

| Lane 常量             | 值           | 用途                                 |
| --------------------- | ------------ | ------------------------------------ |
| `AGENT_LANE_NESTED`   | `"nested"`   | `sessions_send` 的跨 session 消息    |
| `AGENT_LANE_SUBAGENT` | `"subagent"` | `sessions_spawn` 启动的子 agent 任务 |

---

## 三、Ping-Pong 多轮对话机制（详细分析）

**核心源文件：**

- `src/agents/tools/sessions-send-tool.ts` — `sessions_send` 主入口，触发 A2A Flow
- `src/agents/tools/sessions-send-tool.a2a.ts` — `runSessionsSendA2AFlow`，整个多轮对话的调度器
- `src/agents/tools/sessions-send-helpers.ts` — 各阶段 prompt 构建 + 轮次配置
- `src/agents/tools/agent-step.ts` — 单步 agent 调用（每轮的执行单元）
- `src/agents/run-wait.ts` — runId 等待 + 回复提取逻辑
- `src/agents/tools/sessions-announce-target.ts` — 解析目标 channel 投递地址
- `src/agents/tools/sessions-send-tokens.ts` — Skip token 定义

---

### 3.1 整体三阶段流程

`sessions_send` 的多轮对话由三个顺序阶段组成：

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     A2A Flow（runSessionsSendA2AFlow）                   │
│                                                                          │
│  Phase 1: Round-One Reply 获取                                           │
│  ─────────────────────────────────────────────────────────────────────  │
│  同步模式：roundOneReply 已直接从调用方传入                                 │
│  异步模式：等待 waitRunId 完成 → readLatestAssistantReply 读取回复         │
│                                                                          │
│  Phase 2: Ping-Pong 多轮（可选，maxPingPongTurns > 0 且跨 session）       │
│  ─────────────────────────────────────────────────────────────────────  │
│  turn=1: 当前执行者=A（requester），发给 B 的回复作为消息，B 执行          │
│  turn=2: 当前执行者=B（target），发给 A 的回复作为消息，A 执行             │
│  turn=3: 当前执行者=A（requester）... 以此交替                           │
│  终止：任一方回复 REPLY_SKIP，或达到 maxPingPongTurns 上限                │
│                                                                          │
│  Phase 3: Announce Step（最终摘要投递）                                   │
│  ─────────────────────────────────────────────────────────────────────  │
│  对目标 session（B）执行一次 agent step                                   │
│  B 自主决定：回复 ANNOUNCE_SKIP = 不发出任何消息                          │
│              其他回复 → callGateway("send") 推送到 B 的 channel           │
└─────────────────────────────────────────────────────────────────────────┘
```

---

### 3.2 Phase 1：获取 Round-One Reply

**触发点：** `sessions-send-tool.ts` 中构建的 `startA2AFlow`

```typescript
// sessions-send-tool.ts（同步模式）
const reply = result.replyText; // 已从 waitForAgentRun 中拿到
startA2AFlow(reply ?? undefined); // 直接传入 roundOneReply

// sessions-send-tool.ts（异步模式，timeoutSeconds=0）
startA2AFlow(undefined, runId); // 传入 waitRunId，让 A2A Flow 自行等待
```

**A2A Flow 内部（`runSessionsSendA2AFlow`）：**

```typescript
let primaryReply = params.roundOneReply;
let latestReply = params.roundOneReply;

// 异步模式：roundOneReply 为空，需要等 runId 完成后再读
if (!primaryReply && params.waitRunId) {
  const wait = await waitForAgentRun({
    runId: params.waitRunId,
    timeoutMs: Math.min(params.announceTimeoutMs, 60_000), // 最多等 60s
  });
  if (wait.status === "ok") {
    primaryReply = await readLatestAssistantReply({ sessionKey: params.targetSessionKey });
    latestReply = primaryReply;
  }
}

// 如果完全没有回复（B 未响应/超时），直接退出 A2A Flow
if (!latestReply) return;
```

> **关键设计：** `primaryReply` 保存的是 Round 1 回复（始终不变），`latestReply` 随每轮更新，用于 Announce Step 向 B 汇报"最新对话结论"。

---

### 3.3 Phase 2：Ping-Pong 多轮对话

#### 3.3.1 进入条件

```typescript
if (
  params.maxPingPongTurns > 0 &&
  params.requesterSessionKey &&
  params.requesterSessionKey !== params.targetSessionKey // 必须是跨 session
) {
  /* 执行 ping-pong */
}
```

若同 session 发送或 `maxPingPongTurns === 0`，直接跳过此阶段进入 Announce。

#### 3.3.2 Session 游标交替机制

这是 Ping-Pong 的核心实现——用游标变量在两个 session 之间交替：

```typescript
let currentSessionKey = params.requesterSessionKey; // 初始：A 执行
let nextSessionKey = params.targetSessionKey;
let incomingMessage = latestReply; // 从 B 的回复开始

for (let turn = 1; turn <= params.maxPingPongTurns; turn += 1) {
  // 确定当前执行者的角色
  const currentRole =
    currentSessionKey === params.requesterSessionKey
      ? "requester" // A 在执行
      : "target"; // B 在执行

  // 构建本轮的 extraSystemPrompt
  const replyPrompt = buildAgentToAgentReplyContext({
    requesterSessionKey: params.requesterSessionKey,
    requesterChannel: params.requesterChannel,
    targetSessionKey: params.displayKey,
    targetChannel,
    currentRole,
    turn,
    maxTurns: params.maxPingPongTurns,
  });

  // 在 currentSessionKey 的 session 中执行一步
  const replyText = await runAgentStep({
    sessionKey: currentSessionKey,
    message: incomingMessage, // 上一轮对方的回复
    extraSystemPrompt: replyPrompt,
    timeoutMs: params.announceTimeoutMs,
    lane: AGENT_LANE_NESTED,
    sourceSessionKey: nextSessionKey, // 消息来源（对方）
    sourceChannel:
      nextSessionKey === params.requesterSessionKey
        ? params.requesterChannel // 对方是 A 时，用 A 的 channel
        : targetChannel, // 对方是 B 时，用 B 的 channel
    sourceTool: "sessions_send",
  });

  // 终止检查
  if (!replyText || isReplySkip(replyText)) break;

  // 更新状态，交换游标
  latestReply = replyText;
  incomingMessage = replyText;
  const swap = currentSessionKey;
  currentSessionKey = nextSessionKey; // 下一轮换对方执行
  nextSessionKey = swap;
}
```

**游标交替示意（以 5 轮为例）：**

```
turn=1: currentSession=A(requester)  消息来自B的回复  →  A 响应 → replyText1
turn=2: currentSession=B(target)     消息=replyText1   →  B 响应 → replyText2
turn=3: currentSession=A(requester)  消息=replyText2   →  A 响应 → replyText3
turn=4: currentSession=B(target)     消息=replyText3   →  B 响应 → replyText4
turn=5: currentSession=A(requester)  消息=replyText4   →  A 响应 → replyText5
结束，latestReply = replyText5（或最后未 SKIP 的那个）
```

#### 3.3.3 每轮的 extraSystemPrompt 模板

由 `buildAgentToAgentReplyContext` 生成：

```
Agent-to-agent reply step:
Current agent: Agent 1 (requester).        ← 当前执行者的角色标识
Turn 2 of 5.                               ← 当前轮次 / 总轮次
Agent 1 (requester) session: agent:alice:subagent:xxx.
Agent 1 (requester) channel: telegram.
Agent 2 (target) session: agent:bob:main.
Agent 2 (target) channel: discord.
If you want to stop the ping-pong, reply exactly "REPLY_SKIP".
```

> `currentRole` 由游标判断：`currentSessionKey === requesterSessionKey` → "requester"，否则 → "target"。

#### 3.3.4 单步执行：`runAgentStep`

每一轮 Ping-Pong 都调用 `runAgentStep`，它封装了完整的「提交 → 等待 → 读取回复」三步：

```typescript
// agent-step.ts
async function runAgentStep(params): Promise<string | undefined> {
  const stepIdem = crypto.randomUUID();

  // 1. 提交 agent 运行
  const response = await callGateway<{ runId?: string }>({
    method: "agent",
    params: {
      message: params.message,
      sessionKey: params.sessionKey,
      idempotencyKey: stepIdem,
      deliver: false, // 不推送到外部 channel
      channel: INTERNAL_MESSAGE_CHANNEL,
      lane: AGENT_LANE_NESTED,
      extraSystemPrompt: params.extraSystemPrompt,
      inputProvenance: {
        kind: "inter_session",
        sourceSessionKey: params.sourceSessionKey,
        sourceChannel: params.sourceChannel,
        sourceTool: params.sourceTool ?? "sessions_send",
      },
    },
    timeoutMs: 10_000, // 提交超时：10s（不是运行超时）
  });

  const resolvedRunId = response?.runId || stepIdem;

  // 2. 等待本轮运行完成 + 读取新回复
  const result = await waitForAgentRunAndReadUpdatedAssistantReply({
    runId: resolvedRunId,
    sessionKey: params.sessionKey,
    timeoutMs: Math.min(params.timeoutMs, 60_000), // 单轮最多等 60s
  });

  if (result.status !== "ok") return undefined; // timeout/error 均视为无回复
  return result.replyText;
}
```

#### 3.3.5 回复提取：baseline 比对机制

`waitForAgentRunAndReadUpdatedAssistantReply` 采用 **fingerprint 比对**确保拿到的是本轮新产生的回复，而非历史回复：

```typescript
// run-wait.ts
async function waitForAgentRunAndReadUpdatedAssistantReply(params) {
  // 等待 runId 完成
  const wait = await waitForAgentRun({ runId, timeoutMs });
  if (wait.status !== "ok") return wait;

  // 读取最新 assistant 消息
  const latestReply = await readLatestAssistantReplySnapshot({ sessionKey, limit });

  // 基线比对：fingerprint 相同 → 与本轮无关的旧回复，丢弃
  const replyText =
    latestReply.text && (!baselineFingerprint || latestReply.fingerprint !== baselineFingerprint)
      ? latestReply.text
      : undefined;

  return { status: "ok", replyText };
}
```

`fingerprint` 是将整个 assistant message 对象 JSON 序列化后的字符串，能精确识别「是否发生了变化」。

提取文本时，`extractAssistantText` 会对内容做清洗：

- 去除 thinking 标签（`<thinking>...</thinking>`）
- 去除工具调用 XML（Minimax 等模型的特殊格式）
- 去除模型特殊 token
- 去除降级工具调用文本

---

### 3.4 Phase 3：Announce Step（最终摘要投递）

无论 Ping-Pong 是否发生，A2A Flow 最后都会执行 Announce Step。

#### 3.4.1 Announce Target 解析

首先解析 B 的外部投递地址（`resolveAnnounceTarget`）：

```typescript
// sessions-announce-target.ts
const announceTarget = await resolveAnnounceTarget({
  sessionKey: params.targetSessionKey,
  displayKey: params.displayKey,
});
```

解析优先级：

1. **从 session key 直接解析**（`resolveAnnounceTargetFromKey`）：`agent:alice:telegram:group:xxx` → 直接提取 channel+to
2. **插件 preferSessionLookup**：某些 channel plugin 标记 `preferSessionLookupForAnnounceTarget=true`，强制走 sessions.list 查找
3. **sessions.list 查找**：调用 `callGateway("sessions.list")` 获取全部 session，匹配目标 session 的 `deliveryContext`/`lastChannel`/`lastTo`
4. **fallback**：使用步骤 1 的结果（即便插件希望偏好 lookup 但 lookup 失败）

```typescript
type AnnounceTarget = {
  channel: string; // "telegram" / "discord" / ...
  to: string; // "group:xxx" / "channel:yyy"
  accountId?: string;
  threadId?: string; // 论坛话题 ID（可选）
};
```

#### 3.4.2 Announce Step 的 extraSystemPrompt

由 `buildAgentToAgentAnnounceContext` 生成：

```
Agent-to-agent announce step:
Agent 1 (requester) session: agent:alice:subagent:xxx.
Agent 1 (requester) channel: telegram.
Agent 2 (target) session: agent:bob:main.
Agent 2 (target) channel: discord.
Original request: 帮我查一下明天的天气
Round 1 reply: 好的，明天北京天气：晴，15-22℃，适宜出行。
Latest reply: 综上所述，推荐带一件薄外套。
If you want to remain silent, reply exactly "ANNOUNCE_SKIP".
Any other reply will be posted to the target channel.
After this reply, the agent-to-agent conversation is over.
```

字段说明：

- `Original request`：A 最初发给 B 的消息（原话）
- `Round 1 reply`：B 的第一轮回复（Phase 1 获取）
- `Latest reply`：Ping-Pong 后的最新一轮回复（可能与 Round 1 相同）

#### 3.4.3 Announce Step 执行

```typescript
const announceReply = await runAgentStep({
  sessionKey: params.targetSessionKey, // 在 B 的 session 中执行
  message: "Agent-to-agent announce step.",
  extraSystemPrompt: announcePrompt,
  timeoutMs: params.announceTimeoutMs,
  lane: AGENT_LANE_NESTED,
  sourceSessionKey: params.requesterSessionKey,
  sourceChannel: params.requesterChannel,
  sourceTool: "sessions_send",
});
```

#### 3.4.4 投递判断

```typescript
if (
  announceTarget && // 能解析到有效投递地址
  announceReply && // B 有实际回复
  announceReply.trim() && // 回复非空
  !isAnnounceSkip(announceReply) // 回复不是 "ANNOUNCE_SKIP"
) {
  await callGateway({
    method: "send",
    params: {
      to: announceTarget.to,
      message: announceReply.trim(),
      channel: announceTarget.channel,
      accountId: announceTarget.accountId,
      idempotencyKey: crypto.randomUUID(), // 防重复发送
    },
    timeoutMs: 10_000,
  });
}
```

> Announce 投递失败只记录 warn 日志，**不抛出异常**，不影响 `sessions_send` 的返回结果。

---

### 3.5 Skip Token 机制

**源文件：** `src/agents/tools/sessions-send-tokens.ts`

```typescript
export const ANNOUNCE_SKIP_TOKEN = "ANNOUNCE_SKIP";
export const REPLY_SKIP_TOKEN = "REPLY_SKIP";

// 判断逻辑（精确匹配 trim 后的字符串）
export const isAnnounceSkip = (text?: string) => (text ?? "").trim() === ANNOUNCE_SKIP_TOKEN;

export const isReplySkip = (text?: string) => (text ?? "").trim() === REPLY_SKIP_TOKEN;
```

| Token           | 用途                                                        | 检查时机                   |
| --------------- | ----------------------------------------------------------- | -------------------------- |
| `REPLY_SKIP`    | 任一方在 Ping-Pong 中回复此 token 时，立即终止 Ping-Pong    | 每轮 `runAgentStep` 返回后 |
| `ANNOUNCE_SKIP` | B 在 Announce Step 中回复此 token 时，跳过向 channel 的投递 | Announce Step 后           |

两者均为**精确匹配**（`trim()` 后），agent 回复中多余的空格可以被自动过滤。

---

### 3.6 配置项

```yaml
session:
  agentToAgent:
    maxPingPongTurns: 5 # Ping-Pong 最大轮次，默认 5，上限 5，最小 0（禁用）
```

```typescript
// sessions-send-helpers.ts
const DEFAULT_PING_PONG_TURNS = 5;
const MAX_PING_PONG_TURNS = 5;

export function resolvePingPongTurns(cfg?: OpenClawConfig) {
  const raw = cfg?.session?.agentToAgent?.maxPingPongTurns;
  const fallback = DEFAULT_PING_PONG_TURNS;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return fallback;
  const rounded = Math.floor(raw);
  return Math.max(0, Math.min(MAX_PING_PONG_TURNS, rounded));
}
```

设置 `maxPingPongTurns: 0` 可完全禁用 Ping-Pong，仅保留 Round-One Reply + Announce Step。

---

### 3.7 超时行为

| 阶段                      | 超时配置                      | 超时处理                                                                   |
| ------------------------- | ----------------------------- | -------------------------------------------------------------------------- |
| Phase 1 异步等待 runId    | `min(announceTimeoutMs, 60s)` | 等待超时视为无 Round-One Reply，整个 A2A Flow 直接退出（不进入 Ping-Pong） |
| Phase 2 每轮 runAgentStep | `min(announceTimeoutMs, 60s)` | 超时或错误时 `runAgentStep` 返回 `undefined`，视为 reply 为空 → break      |
| Phase 3 Announce Step     | `announceTimeoutMs`           | 超时时 runAgentStep 返回 undefined → 跳过 channel 投递                     |
| Announce 外部投递         | 10s                           | 失败只记警告，不中断流程                                                   |

`announceTimeoutMs` 计算规则（来自 `sessions-send-tool.ts`）：

```typescript
const timeoutSeconds = params.timeoutSeconds ?? 600;
const timeoutMs = timeoutSeconds * 1000;
const announceTimeoutMs = timeoutSeconds === 0 ? 30_000 : timeoutMs;
// 异步模式（timeoutSeconds=0）：announceTimeoutMs 固定 30s
// 同步模式：与调用方 timeoutSeconds 对齐
```

---

### 3.8 A2A Flow 的错误隔离

整个 `runSessionsSendA2AFlow` 被包裹在一个顶层 try-catch 中：

```typescript
try {
  // Phase 1 + Phase 2 + Phase 3
} catch (err) {
  log.warn("sessions_send announce flow failed", { runId: runContextId, error });
}
```

**这意味着：**

- A2A Flow 中任何异常都不会传播回 `sessions_send` 的调用方
- `sessions_send` 已经返回 `{ status: "ok", reply }` 给调用方（Agent A）
- A2A Flow 完全异步，即使全部失败，Agent A 的工具调用结果不受影响

---

### 3.9 完整时序图

```
Agent A                   Gateway                   Agent B
  │                          │                          │
  │──sessions_send(msg)─────→│                          │
  │                          │──agent(B, msg)──────────→│
  │                          │                          │ (B 处理消息)
  │←──{ok, reply=roundOne}───│←──reply────────────────  │
  │                          │                          │
  │  [A2A Flow 开始，异步]    │                          │
  │                          │                          │
  │──── Ping-Pong turn=1 ────│                          │
  │                          │──agent(A, roundOne)─────→│  ← 注：消息发给A
  │                          │                   (A执行) │
  │                          │←──A的回复1────────────── │
  │                          │                          │
  │──── Ping-Pong turn=2 ────│                          │
  │                          │──agent(B, A的回复1)─────→│
  │                          │                   (B执行) │
  │                          │←──B的回复2────────────── │
  │                          │                          │
  │  ... (最多到turn=5) ...  │                          │
  │                          │                          │
  │──── Announce Step ───────│                          │
  │                          │──agent(B, announceCtx)──→│
  │                          │                   (B决策) │
  │                          │←──announceReply──────────│
  │                          │                          │
  │                          │──send(B的channel, msg)──→│ (推送到外部)
  │                          │                          │
```

> **注意：** Ping-Pong turn=1 时，`currentSessionKey` 初始为 A（requester），因此第一轮是 **在 A 的 session 里**执行，消息内容是 B 的 Round-One Reply。这意味着 A 先对 B 的回复"做出反应"，然后 B 再根据 A 的反应回应，以此类推。

---

## 四、历史消息同步方案（详细分析）

Agent 之间**没有共享内存**，历史消息同步通过以下机制实现。

---

### 4.1 `sessions_history` 工具 — 主动读取历史

**源文件：** `src/agents/tools/sessions-history-tool.ts`

Agent 主动调用此工具读取另一个 session 的完整对话历史。

#### 4.1.1 工具参数

```typescript
{
  sessionKey:     string;   // 目标 session key
  limit?:         number;   // 返回的最大消息条数（>= 1）
  includeTools?:  boolean;  // 是否包含工具调用消息，默认 false（过滤掉）
}
```

#### 4.1.2 完整执行流程

```
Agent A 调用 sessions_history(sessionKey)
  │
  ├─ resolveSessionReference()       — 解析 session key（支持 sessionId/别名）
  ├─ resolveVisibleSessionReference()— Sandbox 可见性验证
  │
  ├─ 创建 A2A Policy + Visibility Guard（与 sessions_send 相同逻辑）
  │   └── visibilityGuard.check(resolvedKey)  — 返回 allowed/forbidden
  │
  ├─ callGateway("chat.history", { sessionKey: resolvedKey, limit })
  │   └── 返回 { messages: Message[] }
  │
  ├─ includeTools=false → stripToolMessages()  — 过滤 role=toolResult/tool 的消息
  │
  ├─ 逐条 sanitizeHistoryMessage()  — 安全清洗（见 4.1.3）
  │
  ├─ capArrayByJsonBytes(items, 80KB)  — 按字节限制截断
  │
  ├─ enforceSessionsHistoryHardCap()  — 兜底硬限
  │
  └─ 返回 { sessionKey, messages, truncated, droppedMessages, contentTruncated, contentRedacted, bytes }
```

#### 4.1.3 数据安全清洗管道

每条消息经过 `sanitizeHistoryMessage` 处理：

```typescript
function sanitizeHistoryMessage(message: unknown) {
  // 1. 删除大型辅助字段
  delete entry.details;  // 工具结果详情（通常非常大）
  delete entry.usage;    // token 用量
  delete entry.cost;     // 费用

  // 2. 递归清洗 content 数组中的每个 block
  for each block in content: sanitizeHistoryContentBlock(block)

  // 3. 清洗顶层 text 字段
  truncateHistoryText(entry.text)
}
```

`sanitizeHistoryContentBlock` 按 block type 处理：

```typescript
function sanitizeHistoryContentBlock(block) {
  // 文本 block：redact 敏感信息 + 截断到 4000 字符
  if (block.text) {
    block.text = redactSensitiveText(block.text); // 正则匹配并替换凭证（OC-07）
    block.text = truncateUtf16Safe(block.text, 4000);
  }

  // thinking block：redact 思考文本 + 删除加密签名
  if (block.type === "thinking") {
    block.thinking = redactSensitiveText(block.thinking);
    delete block.thinkingSignature; // 加密签名体积大且无用，始终删除
    truncated = true;
  }

  // partialJson block：redact + 截断
  if (block.partialJson) {
    /* 同文本处理 */
  }

  // image block：删除 base64 数据，只保留元信息
  if (block.type === "image") {
    const bytes = block.data?.length;
    delete block.data; // 删除 base64 原始数据
    block.omitted = true; // 标记为已省略
    block.bytes = bytes; // 保留原始字节数（供参考）
    truncated = true;
  }
}
```

#### 4.1.4 响应大小控制（两道防线）

**第一道：`capArrayByJsonBytes`（序列化后字节限制）**

```typescript
const SESSIONS_HISTORY_MAX_BYTES = 80 * 1024; // 80KB

const cappedMessages = capArrayByJsonBytes(
  sanitizedMessages.map((entry) => entry.message),
  SESSIONS_HISTORY_MAX_BYTES,
);
// 从最早的消息开始丢弃，直到总字节数 <= 80KB
```

**第二道：`enforceSessionsHistoryHardCap`（兜底保护）**

```typescript
function enforceSessionsHistoryHardCap({ items, bytes, maxBytes }) {
  if (bytes <= maxBytes) return items; // 未超出，直接返回

  // 尝试只返回最后一条消息
  const lastOnly = [items.at(-1)];
  if (jsonUtf8Bytes(lastOnly) <= maxBytes) {
    return { items: lastOnly, hardCapped: true };
  }

  // 若单条也超出，返回占位符
  return {
    items: [{ role: "assistant", content: "[sessions_history omitted: message too large]" }],
    hardCapped: true,
  };
}
```

#### 4.1.5 返回字段说明

```typescript
{
  sessionKey:      string;   // 目标 session 的显示 key
  messages:        Message[]; // 清洗后的消息列表
  truncated:       boolean;  // 是否有任何内容被截断（消息丢失 或 内容截断 或 hardCap）
  droppedMessages: boolean;  // 是否有整条消息被丢弃（超过 80KB 限制）
  contentTruncated:boolean;  // 是否有消息内部内容被截断（超过 4000 字符限制）
  contentRedacted: boolean;  // 是否有敏感内容被 redact（凭据、API key 等）
  bytes:           number;   // 实际返回的消息总字节数
}
```

---

### 4.2 `sessions_list` 工具的 `messageLimit` 参数 — 批量预览

**源文件：** `src/agents/tools/sessions-list-tool.ts`

`sessions_list` 支持在列出 session 时同时拉取每个 session 的最近消息（预览）。

#### 4.2.1 参数

```typescript
{
  kinds?:        string[];  // 过滤 session 类型
  limit?:        number;    // 返回的最大 session 数量
  activeMinutes?: number;   // 只返回近 N 分钟内活跃的 session
  messageLimit?: number;    // 每个 session 预拉取的最新消息条数（最多 20）
}
```

`messageLimit` 上限硬设为 20：

```typescript
const messageLimit = Math.min(messageLimitRaw, 20); // 单个 session 最多 20 条
```

#### 4.2.2 批量并发拉取实现

```typescript
if (messageLimit > 0 && historyTargets.length > 0) {
  // 最多 4 个并发 worker，避免过度压力 Gateway
  const maxConcurrent = Math.min(4, historyTargets.length);
  let index = 0;

  const worker = async () => {
    while (true) {
      const next = index++;
      if (next >= historyTargets.length) return;
      const target = historyTargets[next];

      const history = await gatewayCall<{ messages: unknown[] }>({
        method: "chat.history",
        params: { sessionKey: target.resolvedKey, limit: messageLimit },
      });

      const rawMessages = history?.messages ?? [];
      const filtered = stripToolMessages(rawMessages); // 过滤工具消息
      target.row.messages =
        filtered.length > messageLimit
          ? filtered.slice(-messageLimit) // 只保留最新的 messageLimit 条
          : filtered;
    }
  };

  await Promise.all(Array.from({ length: maxConcurrent }, () => worker()));
}
```

> **注意：** `sessions_list` 拉取的历史**不做安全清洗**（无 redact/truncate），仅过滤 tool 消息。**不应用于读取敏感 session 的历史**，需要完整安全清洗时请用 `sessions_history`。

#### 4.2.3 与 `sessions_history` 的对比

| 特性         | `sessions_history`             | `sessions_list` + messageLimit     |
| ------------ | ------------------------------ | ---------------------------------- |
| 消息数量限制 | 无内置上限（`limit` 参数控制） | 每个 session 最多 20 条            |
| 安全清洗     | ✅ redact + 截断 + 删除签名    | ❌ 仅 stripToolMessages            |
| 敏感数据保护 | ✅ 完整（OC-07 合规）          | ❌ 无保护                          |
| 字节限制     | ✅ 80KB 硬限                   | ❌ 无                              |
| 并发拉取     | ❌ 单次请求                    | ✅ 最多 4 并发                     |
| 适用场景     | Agent 读取他人历史（安全）     | 列表展示时附带最近几条消息（预览） |

---

### 4.3 `chat.history` Gateway 协议

所有历史读取操作底层均调用 Gateway 的 `chat.history` 方法：

```typescript
callGateway<{ messages: Message[] }>({
  method: "chat.history",
  params: {
    sessionKey: string;   // 目标 session 的 canonical key
    limit?:     number;   // 最大返回条数（不设则返回全部）
  },
})
```

返回的 `Message` 结构：

```typescript
type Message = {
  role: "user" | "assistant" | "system" | "tool" | "toolResult";
  content: string | ContentBlock[];
  // 可能包含：details, usage, cost, stopReason, errorMessage 等扩展字段
};
```

`chat.history` 是**只读**操作，不会向 session 注入任何消息，也不会触发 agent 运行。

---

### 4.4 Session Store — 持久化元数据（跨 agent 共享）

**路径：** `~/.openclaw/sessions/<agentId>/store.json`

每个 agentId 有独立目录，记录该 agent 所有 session 的元数据：

```typescript
type SessionEntry = {
  sessionId: string; // Gateway 内部 ID
  model?: string; // 运行时使用的模型名称
  modelProvider?: string; // 模型提供商
  channel?: string; // 绑定的消息 channel
  to?: string; // 消息投递目标
  threadId?: string; // 线程 ID（Discord/Slack 等）
  spawnDepth?: number; // spawn 深度（0=主 session）
  spawnedBy?: string; // 父 session key
  spawnedWorkspaceDir?: string; // 继承的工作区目录
  // ...
};
```

跨 agent 读写时，各自通过 `loadSessionStore(storePath)` 读取对应 agentId 目录，**不共享文件句柄**。子 agent 写入：`updateSessionStore(storePath, mutator)`。

---

### 4.5 Subagent Registry — 进程内运行状态（仅 Gateway 内部）

**源文件：** `src/agents/subagent-registry-memory.ts`, `src/agents/subagent-registry.ts`

Gateway 进程内维护一个全局 Map，记录所有子 agent 的运行状态：

```typescript
// 进程级全局注册表
export const subagentRuns: Map<string, SubagentRunRecord> = new Map();

type SubagentRunRecord = {
  runId:                string;
  childSessionKey:      string;
  requesterSessionKey:  string;
  controllerSessionKey?: string;
  task:                 string;
  label?:               string;
  model?:               string;
  createdAt:            number;
  endedAt?:             number;
  outcome?:             { status: "ok" | "error" | ... };
};
```

支持查询接口：

- `listSubagentRunsForController(sessionKey)` — 列出某 session 控制的子 agent
- `countPendingDescendantRuns(sessionKey)` — 统计待完成的后代 agent
- `getLatestSubagentRunByChildSessionKey(key)` — 查最新 run 状态

> **注意：** 此注册表仅在单个 gateway 进程内有效，**不跨进程持久化**，重启后清空。

---

## 五、权限控制体系

**源文件：** `src/agents/tools/sessions-access.ts`

### 5.1 双层权限检查

跨 agent 访问必须**同时满足**两层：

**第一层：Visibility（会话可见性）**

| 模式      | 可见范围                                   | 配置项                            |
| --------- | ------------------------------------------ | --------------------------------- |
| `"self"`  | 仅自己的当前 session                       | `tools.sessions.visibility=self`  |
| `"tree"`  | 自己 + 所有 spawned 子 session（**默认**） | `tools.sessions.visibility=tree`  |
| `"agent"` | 仅本 agent 的所有 session                  | `tools.sessions.visibility=agent` |
| `"all"`   | 所有 session                               | `tools.sessions.visibility=all`   |

> 跨 agent 访问要求 visibility 为 `"all"`，否则直接拒绝。

**第二层：A2A Policy（跨 agent 权限策略）**

```yaml
tools:
  agentToAgent:
    enabled: true # 总开关，默认 false（关闭）
    allow: # 白名单，空列表 = 允许所有
      - "agent-a"
      - "agent-b"
      - "agent-*" # 支持通配符
      - "*" # 允许全部
```

### 5.2 isAllowed 判断逻辑

```typescript
isAllowed = (requesterAgentId: string, targetAgentId: string): boolean => {
  // 同 agent 内部访问始终允许（不跨 agent）
  if (requesterAgentId === targetAgentId) return true;
  // 总开关
  if (!enabled) return false;
  // 双方都必须在白名单中
  return matchesAllow(requesterAgentId) && matchesAllow(targetAgentId);
};
```

### 5.3 沙盒会话的额外限制

沙盒 session（`sandboxed=true`）即使配置了 `visibility=all`，也会被强制收紧为 `"tree"`：

```typescript
// src/agents/tools/sessions-access.ts: resolveEffectiveSessionToolsVisibility
if (sandboxed && sandboxClamp === "spawned" && visibility !== "tree") {
  return "tree"; // 强制收紧
}
```

---

## 六、Announce 异步结果回传机制

**源文件：** `src/agents/subagent-announce-delivery.ts`, `src/agents/subagent-announce.ts`

子 agent 完成任务后，通过 announce 机制将结果异步推送回父 agent：

```
Child Agent 运行完成
  │
  ├─ 构建 triggerMessage（完成通知 prompt，包含任务概要、结果、状态）
  │
  ├─ 检查父 session 状态
  │   │
  │   ├─ [父 session 活跃中] isEmbeddedPiRunActive(sessionId) = true
  │   │   ├─ mode=steer → queueEmbeddedPiMessage(steer)  // 注入父 agent 当前运行
  │   │   └─ mode=followup/collect → enqueueAnnounce()   // 放入队列待处理
  │   │
  │   └─ [父 session 空闲] sendSubagentAnnounceDirectly()
  │       └── callGateway("agent", {
  │             sessionKey: parentKey,
  │             message: triggerMessage,
  │             role: "system",        // 以 system 角色注入
  │             deliver: true/false,   // 是否推送到外部 channel
  │             inputProvenance: { kind: "inter_session", sourceTool: "subagent_announce" }
  │           })
  │
  └─ 父 agent 收到系统消息后自动处理（生成回复或触发进一步动作）
```

### 瞬时错误自动重试

recognize 以下错误为瞬时错误，自动重试（间隔 5s/10s/20s，最多 3 次）：

```
UNAVAILABLE, gateway not connected, gateway closed (1006),
ECONNRESET, ECONNREFUSED, ETIMEDOUT, no active listener ...
```

永久错误（`unsupported channel`, `chat not found`, `bot was kicked` 等）不重试直接失败。

---

## 七、整体架构图

```
┌──────────────────────────────────────────────────────────────────┐
│                         Gateway 进程                              │
│                                                                    │
│  ┌────────────┐   method:"agent"    ┌─────────────────────────┐  │
│  │  Agent A   │ ─────────────────→  │  Agent B session        │  │
│  │  session   │                     │  (内部 channel, nested) │  │
│  └─────┬──────┘ ←─────────────────  └───────────────────┬─────┘  │
│        │         announce/steer/reply                    │        │
│        │                                                 │        │
│        └────── sessions_history ────────────────────────┘        │
│                  (chat.history RPC, 80KB上限, redact)             │
│                                                                    │
│  subagentRuns Map (进程内注册表, 父子关系/生命周期)                  │
│  Session Store   (文件系统, 按 agentId 分目录, 元数据持久化)         │
└──────────────────────────────────────────────────────────────────┘
```

---

## 八、关键设计原则

| 原则           | 实现方式                                                         |
| -------------- | ---------------------------------------------------------------- |
| **无直接通信** | 所有 A2A 消息经 Gateway 路由，保持隔离                           |
| **异步推送**   | subagent 完成用 announce 推送，父 agent 不轮询                   |
| **权限双层**   | Visibility + A2A Policy，默认关闭，需显式配置                    |
| **数据隔离**   | Session Store 按 agentId 分目录，Registry 是进程内全局状态       |
| **安全清洗**   | 跨 session 读取历史时强制 redact 凭证、删除图片 base64           |
| **幂等性**     | 每次 Gateway 调用携带 `idempotencyKey`（UUID）防重复执行         |
| **追溯性**     | 每条跨 session 消息携带 `inputProvenance`，记录来源 session/tool |

---

## 九、相关源文件索引

| 文件                                         | 功能                                      |
| -------------------------------------------- | ----------------------------------------- |
| `src/agents/tools/sessions-send-tool.ts`     | `sessions_send` 工具主实现                |
| `src/agents/tools/sessions-send-tool.a2a.ts` | A2A Flow（Ping-Pong + Announce）          |
| `src/agents/tools/sessions-send-helpers.ts`  | Ping-Pong 上下文构建、轮次配置            |
| `src/agents/tools/sessions-access.ts`        | A2A 权限策略（Policy + Visibility Guard） |
| `src/agents/tools/sessions-history-tool.ts`  | `sessions_history` 工具                   |
| `src/agents/subagent-spawn.ts`               | `sessions_spawn` 子 agent 创建            |
| `src/agents/subagent-control.ts`             | 子 agent 控制（list/kill/steer）          |
| `src/agents/subagent-announce-delivery.ts`   | Announce 异步回传 + 重试                  |
| `src/agents/subagent-registry.ts`            | 子 agent 注册表（CRUD）                   |
| `src/agents/subagent-registry-memory.ts`     | 进程内全局 `subagentRuns` Map             |
| `src/agents/tools/agent-step.ts`             | 单步 agent 调用（Ping-Pong 内部使用）     |
