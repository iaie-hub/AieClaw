# Ping-Pong 多轮对话机制

**核心源文件：**

- `src/agents/tools/sessions-send-tool.ts` — `sessions_send` 主入口，触发 A2A Flow
- `src/agents/tools/sessions-send-tool.a2a.ts` — `runSessionsSendA2AFlow`，整个多轮对话的调度器
- `src/agents/tools/sessions-send-helpers.ts` — 各阶段 prompt 构建 + 轮次配置
- `src/agents/tools/agent-step.ts` — 单步 agent 调用（每轮的执行单元）
- `src/agents/run-wait.ts` — runId 等待 + 回复提取逻辑
- `src/agents/tools/sessions-announce-target.ts` — 解析目标 channel 投递地址
- `src/agents/tools/sessions-send-tokens.ts` — Skip token 定义

---

## 1. 整体三阶段流程

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

## 2. Phase 1：获取 Round-One Reply

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

## 3. Phase 2：Ping-Pong 多轮对话

### 3.1 进入条件

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

### 3.2 Session 游标交替机制

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

### 3.3 每轮的 extraSystemPrompt 模板

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

### 3.4 单步执行：`runAgentStep`

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

### 3.5 回复提取：baseline 比对机制

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

## 4. Phase 3：Announce Step（最终摘要投递）

无论 Ping-Pong 是否发生，A2A Flow 最后都会执行 Announce Step。

### 4.1 Announce Target 解析

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

### 4.2 Announce Step 的 extraSystemPrompt

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

### 4.3 Announce Step 执行

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

### 4.4 投递判断

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

## 5. Skip Token 机制

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

## 6. 配置项

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

## 7. 超时行为

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

## 8. A2A Flow 的错误隔离

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

## 9. 完整时序图

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
