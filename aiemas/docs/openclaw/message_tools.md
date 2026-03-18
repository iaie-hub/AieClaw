# OpenClaw 通信链路与 Agent 执行可视化代码深度解析

本文档详细剖析从用户在 UI 发送消息、通过 WebSocket 到达网关、Agent 处理，再到返回结果并动态可视化渲染在 UI 的全过程。后续对该部分的分析也请追加到本文档。

## 0. WebSocket 协议帧结构 (Gateway Protocol Frames)

OpenClaw 所有通信基于 WebSocket 上的 JSON-RPC 风格帧协议（定义于 `src/gateway/protocol/schema/frames.ts`）。客户端与网关之间只有三种顶级帧格式：

| 帧类型 | `type` 字段 | 用途 |
|--------|------------|------|
| **请求帧** | `"req"` | UI → Gateway，发起 RPC 调用（如 `chat.send`）|
| **响应帧** | `"res"` | Gateway → UI，返回调用结果（ACK 或错误）|
| **事件帧** | `"event"` | Gateway → UI，单向推送（Agent 流式输出、tool 执行通知）|

```typescript
// src/gateway/protocol/schema/frames.ts

// 请求帧: UI 发起一次 RPC
const RequestFrameSchema = Type.Object({
  type: Type.Literal("req"),
  id: NonEmptyString,              // UUID，用于找到对应的 Response
  method: NonEmptyString,           // 方法路由，例如 "chat.send" / "connect"
  params: Type.Optional(Type.Unknown()),  // 各 method 自己定义的参数体
});

// 响应帧: Gateway 把 RPC 结果回给 UI
const ResponseFrameSchema = Type.Object({
  type: Type.Literal("res"),
  id: NonEmptyString,              // 对应 RequestFrame.id
  ok: Type.Boolean(),              // 成功与否
  payload: Type.Optional(Type.Unknown()),  // 响应体 (如 { runId, status: "started" })
  error: Type.Optional(ErrorShapeSchema),  // ok=false 时携带强类型错误
});

// 事件帧: Gateway 主动向 UI 推送消息，无需 UI 请求
const EventFrameSchema = Type.Object({
  type: Type.Literal("event"),
  event: NonEmptyString,           // 道名称，如 "chat" / "agent"
  payload: Type.Optional(Type.Unknown()),  // 挂载的数据（delta 文本、tool 状态等）
  seq: Type.Optional(Type.Integer({ minimum: 0 })), // 序号，保证前端顺序播放
});
```

> **连接握手流程：** 客户端发送 `{ type: "req", method: "connect", params: ConnectParams }`。`ConnectParams` 包含协议版本协商 (`minProtocol`/`maxProtocol`)、客户端身份信息（ID、版本、平台）、身份鉴权 Token 以及 Device 签名（防伪装）。网关验证通过后回复 `hello-ok` 事件，并将当前 Gateway 的 features 列表、Policy 参数一并下发。

## 1. 用户界面发包 (UI Frontend Sending)

在前端 Web 控制台中，核心的发包逻辑集中在 `ui/src/ui/controllers/chat.ts` 的 `sendChatMessage` 函数中：

### 1.1 消息格式 (NormalizedMessage)

UI 内部维护的消息使用统一的 Block 序列化结构，支持纯文本与富媒体附件：

```typescript
// UI 内部消息类型 (ui/src/ui/controllers/chat.ts)
export type NormalizedMessage = {
  id?: string;
  role: "user" | "assistant" | "system";
  content: MessageContentItem[];  // Block 序列，支持混排
  timestamp: number;
};

export type MessageContentItem =
  | { type: "text"; text: string }
  | { type: "image"; mimeType: string; data: string }  // base64 图片附件
  | { type: "toolcall";   /* 工具调用 widget */ }
  | { type: "toolresult"; /* 工具执行结果 widget */ };
```

发包时，消息被封装为符合协议的 Request Frame 发出：

```typescript
// ui/src/ui/controllers/chat.ts => sendChatMessage
export async function sendChatMessage(state: ChatState, message: string, attachments?: ChatAttachment[]) {
  // 1. 构建本地用户消息并乐观更新 UI
  state.chatMessages = [...state.chatMessages, { role: "user", content: contentBlocks, timestamp: now }];
  
  // 2. 初始化本次运行的状态
  state.chatSending = true;
  const runId = generateUUID();  // 生成唯一 idempotencyKey(runId)
  state.chatRunId = runId;
  state.chatStream = "";
  
  // 3. 通过 WebSocket 客户端封装为 Request Frame 发送
  // 底层发出：{ type: "req", id: uuid, method: "chat.send", params: {...} }
  await state.client.request("chat.send", {
    sessionKey: state.sessionKey,
    message: msg,
    deliver: false,           // 声明为本地客户端，不向外部渠道投递
    idempotencyKey: runId,    // 用于后端的幂等性及绑定 Agent 批次
    attachments: apiAttachments,
  });
  return runId;
}
```

请求发送后，前端在等待服务器ACK的同时，界面上显示用户的输入泡泡和打字/加载提示（由于 `chatStream` 设置为了空字符串 `""` 且有了 `chatRunId`）。

## 2. 服务端网关接收 (Server Gateway Handling)

服务端 WebSocket 握手并鉴权通过后，所有的路由都由 `src/gateway/server-methods.ts` 分发。针对 `chat.send`，处理程序位于 `src/gateway/server-methods/chat.ts`：

```typescript
// src/gateway/server-methods/chat.ts (chatHandlers["chat.send"])
async function handleChatSend(ctx, request) {
  // 1. 获取对应的 SessionEntry 
  const { cfg, storePath, store, entry, canonicalKey } = await loadSessionEntry(params.sessionKey);
  
  // 2. 幂等性控制（防止网络断开重连时重复触发 Agent）
  const dedupeKey = `chat.send:${canonicalKey}:${params.idempotencyKey}`;
  if (context.dedupe.has(dedupeKey)) return context.dedupe.get(dedupeKey);
  
  // 3. 立即回复 Response Frame，作为 ACK（status: "started"），无需等 Agent 跑完
  context.respond(request.id, true, { runId: params.idempotencyKey, status: "started" });
  //     ↑ 这里就是 { type: "res", id: request.id, ok: true, payload: { runId, status:"started" } }

  // 4. 构建网关上下文 (MsgContext)
  const msgCtx = { Body: params.message, SessionKey: canonicalKey, ... }
  
  // 5. 异步启动 Agent 调度，不阻塞当前 WebSocket 响应帧
  void dispatchInboundMessage({ ctx: msgCtx, cfg, dispatcher, replyOptions });
}
```

### 2.1 协议安全加固 (Protocol Hardening)

网关对 WebSocket 连接从握手阶段就实施了多层防护（代码见 `src/gateway/server/ws-connection/message-handler.ts`）：

| 防护机制 | 实现方式 |
|---------|--------|
| **包体大小限制** | 握手前用 `MAX_PREAUTH_PAYLOAD_BYTES` 防暴力包；连接后用 `MAX_PAYLOAD_BYTES` 防单帧过大 |
| **幂等防抖** | `chat.send` 的 `idempotencyKey`（即 `runId`）在网关侧做 Dedupe，重连不会重复唤醒 Agent |
| **Device 签名校验** | 连接时 `ConnectParams.device` 携带时间戳签名 + 一次性 nonce，由网关验证防伪装 |
| **协议版本协商** | `minProtocol`/`maxProtocol` 不匹配时 1002 关闭连接，防旧版客户端乱连 |
| **Origin 校验** | Control UI 和 WebChat 的连接强制做 Origin Header 检查，防 CSRF |

## 3. Agent 分发与执行 (Agent Dispatch & Execution)

`dispatchInboundMessage` 随后层层调用进入 `runEmbeddedPiAgent`，在这里执行 LLM 推理。由于采用流式响应，每一次数据都会发出对应的 EventEmitter 事件：

```typescript
// src/infra/agent-events.ts 中定义事件总线并触发事件
// 当产生文本回复时:
emitAgentEvent(runId, { stream: "assistant", data: { text, delta } });

// 当 Agent 调用工具(Tool)时:
emitAgentEvent(runId, { stream: "tool", data: { phase: "start"|"update"|"result", name: "bash", args: {...} } });

// 在 src/gateway/server-chat.ts 中捕获并使用 WebSocket 广播到前端：
function emitChatDelta(...) {
  // 根据节流机制 (150ms) 缓冲 Delta 
  broadcast("chat", { runId, sessionKey, state: "delta", message: { content: [{ type: "text", text }] }});
}
```

### 3.1 通信链路完整流程（基于源码验证）

以下是基于 `src/infra/agent-events.ts`、`src/gateway/server-chat.ts`、`src/gateway/server-broadcast.ts` 的精确实现：

```
UI (WebSocket)
    │  { type:"req", method:"chat.send", params:{ sessionKey, message, idempotencyKey } }
    ▼
src/gateway/server/ws-connection.ts
    attachGatewayWsConnectionHandler → attachGatewayWsMessageHandler
    │  路由到 chatHandlers["chat.send"]
    ▼
src/gateway/server-methods/chat.ts  chat.send handler
    │  1. 校验 + 清洗输入（NFC规范化、去控制字符）
    │  2. 检查幂等缓存 context.dedupe
    │  3. new AbortController() → 注册到 chatAbortControllers
    │  4. respond(true, { runId, status:"started" })  ← 立即 ACK
    │  5. 构建 MsgContext（Body, BodyForAgent, SessionKey, OriginatingChannel...）
    │  6. injectTimestamp(messageForAgent)
    │  7. void dispatchInboundMessage(...)  ← 异步，不阻塞
    ▼
src/auto-reply/dispatch.ts  dispatchInboundMessage
    │  → dispatchReplyFromConfig → getReplyFromConfig
    ▼
src/agents/agent-command.ts  agentCommand → runAgentAttempt
    │  → runEmbeddedPiAgent（embedded Pi agent）
    │    或 runCliAgent（CLI agent）
    ▼
src/agents/pi-embedded-subscribe.ts  subscribeEmbeddedPiSession
    │  订阅 Pi SDK session 事件流
    │  每个 token/事件 → emitAgentEvent(...)
    ▼
src/infra/agent-events.ts  进程内事件总线
    │  emitAgentEvent({ runId, stream, data })
    │  → 附加单调递增 seq + ts
    │  → 广播给所有 listeners
    ▼
src/gateway/server-chat.ts  createAgentEventHandler（在 server.impl.ts 注册）
    │  assistant stream → emitChatDelta（150ms 节流）
    │  lifecycle end   → emitChatFinal（先 flush 节流残留）
    │  tool stream     → broadcastToConnIds（仅 tool-events cap 的连接）
    ▼
src/gateway/server-broadcast.ts  createGatewayBroadcaster
    │  序列化为 JSON frame: { type:"event", event, payload, seq }
    │  背压检测：bufferedAmount > MAX_BUFFERED_BYTES → 丢弃或断开慢消费者
    │  scope 校验：exec.approval.* 仅发给有 operator.approvals scope 的连接
    ▼
UI WebSocket
    event: "chat"  → 渲染对话气泡（delta/final）
    event: "agent" → 渲染工具调用卡片、思考指示器
```

### 3.2 事件总线核心实现（src/infra/agent-events.ts）

```typescript
// 进程内单例，所有 agent 运行共享
const seqByRun = new Map<string, number>();   // 每个 runId 独立的单调序列号
const listeners = new Set<(evt: AgentEventPayload) => void>();
const runContextById = new Map<string, AgentRunContext>();

export type AgentEventPayload = {
  runId: string;
  seq: number;       // 严格单调递增，按 runId 独立计数
  stream: AgentEventStream;  // "lifecycle" | "tool" | "assistant" | "thinking" | "compaction" | "error"
  ts: number;
  data: Record<string, unknown>;
  sessionKey?: string;
};

export type AgentRunContext = {
  sessionKey?: string;
  verboseLevel?: VerboseLevel;
  isHeartbeat?: boolean;
  isControlUiVisible?: boolean;  // false 时不向 UI 发送 chat/agent 更新
};

export function emitAgentEvent(event: Omit<AgentEventPayload, "seq" | "ts">) {
  const nextSeq = (seqByRun.get(event.runId) ?? 0) + 1;
  seqByRun.set(event.runId, nextSeq);
  const enriched: AgentEventPayload = { ...event, seq: nextSeq, ts: Date.now() };
  for (const listener of listeners) {
    try { listener(enriched); } catch { /* ignore */ }
  }
}
```

### 3.3 文本流合并与节流（src/gateway/server-chat.ts）

```typescript
// 150ms 节流：避免过于频繁广播
const now = Date.now();
const last = chatRunState.deltaSentAt.get(clientRunId) ?? 0;
if (now - last < 150) return;

// 文本合并：优先用全量 text，有 delta 则追加，防乱序
function resolveMergedAssistantText({ previousText, nextText, nextDelta }) {
  if (nextText && previousText) {
    if (nextText.startsWith(previousText)) return nextText;  // 全量覆盖
    if (previousText.startsWith(nextText) && !nextDelta) return previousText;  // 防回退
  }
  if (nextDelta) return appendUniqueSuffix(previousText, nextDelta);  // 增量追加
  return nextText || previousText;
}

// lifecycle end 前强制 flush，清除节流残留
flushBufferedChatDeltaIfNeeded(sessionKey, clientRunId, runId, seq);
```

## 4. UI 界面状态更新与响应 (UI Response Handling)

客户端 `ui/src/ui/app-chat.ts` 中拦截到 `event: "chat"` 对应的广播消息，将调用核心状态机函数 `handleChatEvent`：

```typescript
// ui/src/ui/controllers/chat.ts => handleChatEvent
export function handleChatEvent(state: ChatState, payload?: ChatEventPayload) {
  if (payload.state === "delta") {
    // LLM 在打字：逐步累加流式文本，绑定给 state.chatStream 让 Lit 框架进行响应式渲染
    const next = extractText(payload.message);
    state.chatStream = next;
  } else if (payload.state === "final") {
    // 运行结束，将拼接好的流落盘到 state.chatMessages 中，清理流状态
    state.chatMessages = [...state.chatMessages, { role: "assistant", content: [{ text: state.chatStream }] }];
    state.chatStream = null;
    state.chatRunId = null;
  }
}
```

## 5. Agent 执行过程的可视化机制 (Tool Execution Visualization)

除了纯文本，Agent 还经常需要调用各类工具进行自发式的行为决策，这部分的动态可视化机制由 `ui/src/ui/app-tool-stream.ts` 实现。

前端通过监听 `event: "agent"` 接收各种 `stream: "tool"` 事件：

```typescript
// ui/src/ui/app-tool-stream.ts => handleAgentEvent
export function handleAgentEvent(host: ToolStreamHost, payload?: AgentEventPayload) {
  if (payload.stream !== "tool") return;
  const { toolCallId, name, phase, args, partialResult, result } = payload.data;

  // 1. 获取或创建工具条目 entry
  let entry = host.toolStreamById.get(toolCallId);
  if (!entry) {
    // Edge case: 如果在工具开始调用前有文本正在输出，先把该文本截断作为 "chatStreamSegments"
    if (host.chatStream) {
      host.chatStreamSegments.push({ text: host.chatStream, ts: Date.now() });
      host.chatStream = null;
    }
    entry = { toolCallId, name, args: args, output: undefined, message: {} };
    host.toolStreamById.set(toolCallId, entry);
    host.toolStreamOrder.push(toolCallId);
  } else {
    entry.args = args ?? entry.args;
    entry.output = phase === "update" ? formatToolOutput(partialResult) : formatToolOutput(result);
  }

  entry.message = buildToolStreamMessage(entry);
  scheduleToolStreamSync(host, phase === "result");
}
```

### 5.1 可视化事件流类型详解

| stream | 触发时机 | data 关键字段 | UI 表现 |
|--------|---------|--------------|---------|
| `lifecycle` | 执行开始/结束/错误 | `phase: "start"\|"end"\|"error"`, `stopReason` | 转圈显示/隐藏 |
| `assistant` | 每个 token 流出 | `text`（累积全文）, `delta`（增量片段）| 流式文字渲染 |
| `tool` | 工具调用各阶段 | `phase: "start"\|"update"\|"result"`, `toolName`, `toolCallId`, `args`, `result` | 工具卡片 |
| `thinking` | 推理模型思考流 | `text`, `delta` | 可折叠思考区域 |
| `compaction` | 上下文压缩 | `phase: "start"\|"end"\|"retry"` | 压缩提示 |
| `error` | 序列号异常 | `reason: "seq gap"`, `expected`, `received` | 诊断信息 |

### 5.2 工具事件路由规则

工具事件（`stream: "tool"`）不广播给所有连接，只发给注册了 `tool-events` capability 的连接：

```typescript
// src/gateway/server-chat.ts createAgentEventHandler 中
if (isToolEvent) {
  // tool.start 前先 flush 文本 delta，确保工具卡片出现在完整文字之后
  if (toolPhase === "start" && isControlUiVisible && sessionKey && !isAborted) {
    flushBufferedChatDeltaIfNeeded(sessionKey, clientRunId, evt.runId, evt.seq);
  }
  // 只发给注册了 tool-events cap 的连接
  const recipients = toolEventRecipients.get(evt.runId);
  if (recipients && recipients.size > 0) {
    broadcastToConnIds("agent", toolPayload, recipients);
  }
}
```

客户端需在 `connect` 请求中声明：
```typescript
{ caps: ["tool-events"] }
```

### 5.3 verbose 级别控制

`verboseLevel` 控制工具事件的详细程度：

| verboseLevel | 工具事件内容 | 发给 channel（Telegram/Discord 等）|
|-------------|------------|----------------------------------|
| `off`（默认）| 剥除 `result`/`partialResult`，只保留元数据 | 不发送 |
| `on` | 发送工具摘要 | 发送摘要 |
| `full` | 发送完整 result | 发送完整内容 |

### 5.4 可视化机制关键点

1. **Tool Streaming Throttle:** 使用 `scheduleToolStreamSync` 和 `setTimeout(..., 80ms)` 节流机制控制高频刷新的卡顿。
2. **Text Segmenting:** 通过 `chatStreamSegments` 将夹在两次 Tool 用法之间的文字分离，实现：一段文字 → 工具卡片 → 一段文字的混合输出排列。
3. **Truncation 保底:** `formatToolOutput` 中有 120,000 字符的硬截断上限，防止 Agent 工具输出引发浏览器内存崩溃。
4. **状态隔离:** 当历史记录请求 (`chat.history`) 触发时，旧的所有 `toolStreamById` 将被全部清除 (`resetToolStream`)，历史卡片被固化到 `chatMessages` 里。

### 5.5 完整执行时序（WebSocket 事件序列）

```
← event: agent  { stream:"lifecycle", data:{ phase:"start", startedAt:... } }
                                                    ↑ UI 显示"思考中"转圈

← event: agent  { stream:"thinking", data:{ text:"...", delta:"..." } }
                                                    ↑ UI 显示推理过程（可折叠）

← event: agent  { stream:"tool", data:{ phase:"start", name:"read", toolCallId:"tc-1", args:{...} } }
                                                    ↑ UI 显示工具卡片（toolName + input）

← event: agent  { stream:"tool", data:{ phase:"result", name:"read", toolCallId:"tc-1", isError:false } }
                                                    ↑ UI 更新工具卡片（result）

← event: agent  { stream:"assistant", data:{ text:"根据", delta:"根据" } }
← event: chat   { state:"delta", message:{ role:"assistant", content:[{ type:"text", text:"根据" }] } }
                                                    ↑ UI 流式渲染文本（150ms 节流）

← event: agent  { stream:"compaction", data:{ phase:"start" } }
                                                    ↑ UI 显示"压缩上下文"提示

← event: agent  { stream:"lifecycle", data:{ phase:"end", endedAt:... } }
← event: chat   { state:"final", message:{ role:"assistant", content:[{ type:"text", text:"..." }] } }
                                                    ↑ UI 隐藏转圈，锁定最终文本
```

## 6. Agent 与 Subagent 执行机制及路由 (Agent & Subagent Routing and Execution)

在 OpenClaw 中，Agent 不仅能单独处理用户请求，还能在执行复杂任务时产生出子代理（Subagents）来拆解任务。相关的逻辑主要集中在 `src/agents/` 下的 `agent-scope.ts`、`subagent-spawn.ts` 和 `subagent-registry.ts` 中。

### 6.1 Agent 的身份与路由 (Agent Routing)

所有流入网关的消息都会被包装并分配一个 `SessionKey`，它的标准化格式为 `agent:{agentId}:{rest}`。系统通过 `SessionKey` 决定消息的去向：

```typescript
// src/agents/agent-scope.ts => resolveSessionAgentId
export function resolveSessionAgentId({ sessionKey, config }): string {
  // 1. 从 sessionKey 提取 Agent ID
  const parsed = parseAgentSessionKey(sessionKey); 
  if (parsed) return normalizeAgentId(parsed.agentId);

  // 2. 降级：如果没有指定或解析失败，使用配置文件里 default: true 的默认 Agent
  return resolveDefaultAgentId(config);
}
```

### 6.2 派生子代理 (Spawning Subagents)

当一个主 Agent（或某个能力较强的 Agent）决定将其任务委托给其他节点时，它会触发 `sessions_spawn` 动作。相关的实际代码跑在 `src/agents/subagent-spawn.ts` 的 `spawnSubagentDirect` 内：

```typescript
// src/agents/subagent-spawn.ts => spawnSubagentDirect
export async function spawnSubagentDirect(params: SpawnSubagentParams, ctx: SpawnSubagentContext) {
  // 1. 深度与数量校验防循环跑飞
  const callerDepth = getSubagentDepthFromSessionStore(requesterInternalKey);
  if (callerDepth >= maxSpawnDepth) return { status: "forbidden" };

  // 2. 为子代理生成一个专属的隔离 SessionKey 
  const childSessionKey = `agent:${targetAgentId}:subagent:${crypto.randomUUID()}`;

  // 3. 继承与隔离：设置 System Prompt、工作区 (Workspace) 挂载
  let childSystemPrompt = buildSubagentSystemPrompt({...});
  const spawnedMetadata = normalizeSpawnedRunMetadata({ spawnedBy: requesterInternalKey, ... });

  // 4. 发起 Gateway Call，就像是一个外部用户发消息给新 Agent 一样启动推理流 (Lane: SUBAGENT)
  const response = await callGateway({
    method: "agent",
    params: {
      message: childTaskMessage,
      sessionKey: childSessionKey,
      lane: AGENT_LANE_SUBAGENT,  // 走独立限流/队列子代理通道
      ...
    }
  });

  // 5. 注册子代理：把父子级运行关系写入 Registry，支持挂起与唤醒
  registerSubagentRun({
    runId: response.runId,
    childSessionKey,
    controllerSessionKey: requesterInternalKey,
  });

  return { status: "accepted", childSessionKey, runId: response.runId };
}
```

**派生机制关键点：**
1. **沙箱与安全深度 (Depth Limits):** 系统自带最大衍生层级的限制 `maxSpawnDepth` (防无限套娃) 和单次衍生上限 `maxChildrenPerAgent`。
2. **生命周期拦截：** Subagent Spawned 是允许插件 (hooks) 去做外部拦截的，比如可以为 Subagent 把输出强行绑定为宿主通道里的一条 Reply Thread (Slack / Discord 等)。

### 6.3 子代理的注册表和生命周期 (Subagent Registry & Completion)

父子任务之间是异步的（父代理产生任务后，不该进行死循环 Sleep 轮询）。OpenClaw 通过注册表机制保证父节点只在子任务处理完后才被主动唤醒。

这部分的实现在 `src/agents/subagent-registry.ts` 里：

```typescript
// src/agents/subagent-registry.ts

// 子代理执行完毕、出错或超时，触发生命周期终态
export async function completeSubagentRun(params: {runId, outcome, reason}) {
  const entry = subagentRuns.get(params.runId);
  
  // 1. 结果快照: 将子代理最后的一条 message (往往是 Result 摘要) 抓出来冻结
  await freezeRunResultAtCompletion(entry);

  // 2. 状态扭转落盘
  entry.outcome = params.outcome;
  entry.endedReason = params.reason;
  persistSubagentRuns(); // 落盘防止意外宕机导致孤儿
  
  // 3. 去系统里 Announce 
  startSubagentAnnounceCleanupFlow(params.runId, entry);
}

// 通过跑一个 SubagentAnnounceFlow 进行回调唤醒
function startSubagentAnnounceCleanupFlow(runId, entry) {
  runSubagentAnnounceFlow({
    childSessionKey: entry.childSessionKey,
    requesterSessionKey: entry.requesterSessionKey, 
    roundOneReply: entry.frozenResultText  // 用冻结内容直接送入宿主，作为宿主在沉睡期间的"新用户消息"
  }).then(didAnnounce => {
    finalizeSubagentCleanup(runId, entry.cleanup, didAnnounce); // 回收该 Subagent 的垃圾会话数据
  });
}
```

**执行流程总结：**
1. 父 Agent 发出 Tool Call（请求分配新兵子代理去干某件事）。
2. `spawnSubagentDirect` 分发新的 `SessionKey` 并通过 Gateway 把任务发给新的 Agent 进行后台推理。
3. 父 Agent 被告知 "Spawn Accepted"，然后父 Agent 立即结束自己当前回合（LLM 停机），进入休眠等待阶段，避免持续消耗。
4. 子 Agent 处理任务（可能又花了好几轮自我 Tool Call），最终输出一段 `AgentEvent: Lifecycle End`。
5. `subagent-registry.ts` 捕获到该完成事件，使用 `completeSubagentRun`，抽取子代理的最终答复，发起一次倒推式 Call，触发 `runSubagentAnnounceFlow`，也就是将子代理的结果**伪装**成一条用户输入的新消息，直接"塞"到最初父 Agent 的消息流末端，将沉睡的父 Agent 重新唤醒激活。

## 7. 人工审核机制（Exec Approvals）

OpenClaw 对 `exec`（shell 命令执行）工具实现了完整的人工审核机制，在工具执行前阻塞等待用户决策。相关代码集中在 `src/infra/exec-approvals.ts`、`src/gateway/server-methods/exec-approval.ts`、`src/infra/exec-approval-forwarder.ts`。

### 7.1 审核触发条件

核心判断逻辑在 `src/infra/exec-approvals.ts` 的 `requiresExecApproval()`：

```typescript
export function requiresExecApproval(params: {
  ask: ExecAsk;       // "off" | "on-miss" | "always"
  security: ExecSecurity;  // "deny" | "allowlist" | "full"
  analysisOk: boolean;
  allowlistSatisfied: boolean;
}): boolean {
  return (
    params.ask === "always" ||
    (params.ask === "on-miss" &&
      params.security === "allowlist" &&
      (!params.analysisOk || !params.allowlistSatisfied))
  );
}
```

三种安全模式（`security`）：

| 值 | 行为 |
|----|------|
| `deny` | 完全禁止 exec，无论 ask 设置（**系统默认**） |
| `allowlist` | 只允许白名单命令；不在白名单则触发审核 |
| `full` | 允许所有命令，不触发审核 |

三种询问模式（`ask`）：

| 值 | 行为 |
|----|------|
| `off` | 从不询问（白名单外直接拒绝） |
| `on-miss` | 白名单未命中时询问（**系统默认**） |
| `always` | 每次都询问 |

以下情况也强制触发审核（即使白名单命中）：
- heredoc 执行（命令含 `<<` 语法）
- 检测到命令混淆（obfuscation）

### 7.2 审核流程（阻塞式）

审核请求会**阻塞** agent 执行，直到用户决策或超时（默认 120 秒）：

```
exec 工具调用
    │
    ▼
src/agents/bash-tools.exec-host-gateway.ts
    │  evaluateShellAllowlist() → 检查白名单
    │  requiresExecApproval() → 判断是否需要审核
    │
    ▼（需要审核）
src/agents/bash-tools.exec-host-shared.ts
    │  createAndRegisterDefaultExecApprovalRequest()
    │  → registerExecApprovalRequestForHostOrThrow()
    │
    ▼
src/gateway/server-methods/exec-approval.ts  exec.approval.request handler
    │  1. 创建 approval record（含 id、command、cwd、agentId、sessionKey、expiresAtMs）
    │  2. manager.register(record, timeoutMs) → 返回 decisionPromise（阻塞等待）
    │  3. broadcast("exec.approval.requested", { id, request, createdAtMs, expiresAtMs })
    │     ↑ 仅发给有 operator.approvals scope 的 WS 客户端
    │  4. opts.forwarder.handleRequested() → 转发到消息渠道（Telegram/Discord 等）
    │  5. await decisionPromise  ← 阻塞，等待用户决策
    │
    ▼（用户决策）
exec.approval.resolve handler
    │  manager.resolve(approvalId, decision, resolvedBy)
    │  broadcast("exec.approval.resolved", { id, decision, resolvedBy, ts })
    │
    ▼
decisionPromise 解除阻塞
    │  decision: "allow-once" | "allow-always" | "deny"
    │
    ▼
evaluateSystemRunPolicy() → allowed: true/false
    │
    ▼（allowed）
exec 工具继续执行
```

### 7.3 审核通知渠道

`src/infra/exec-approval-forwarder.ts` 的 `createExecApprovalForwarder` 负责把审核请求转发到消息渠道：

**转发目标解析优先级（`resolveForwardTargets`）：**
1. `mode: "session"` — 当前 turn 的来源 channel（`turnSourceChannel`/`turnSourceTo`）
2. `mode: "targets"` — 配置中显式指定的 `approvals.exec.targets`
3. `mode: "both"` — 两者都发

**各渠道的审核消息格式：**

Web UI（通过 WS 事件）：
```json
{
  "type": "event",
  "event": "exec.approval.requested",
  "payload": {
    "id": "approval-uuid",
    "request": {
      "command": "rm -rf /tmp/test",
      "cwd": "/home/user",
      "agentId": "main",
      "sessionKey": "agent:main:main",
      "host": "gateway",
      "security": "allowlist",
      "ask": "on-miss"
    },
    "createdAtMs": 1710000000000,
    "expiresAtMs": 1710000120000
  }
}
```

Telegram/Discord（文本消息，`src/infra/exec-approval-reply.ts`）：
```
Approval required.
Run:
```txt
/approve abc123 allow-once
```
Pending command:
```sh
rm -rf /tmp/test
```
Other options:
```txt
/approve abc123 allow-always
/approve abc123 deny
```
Host: gateway
CWD: /home/user
Expires in: 120s
Full id: `approval-uuid`
```

### 7.4 超时 fallback 策略

`askFallback` 配置决定审核超时后的行为（`src/node-host/exec-policy.ts`）：

| `askFallback` | 超时后行为 |
|---------------|-----------|
| `deny`（默认）| 拒绝执行，返回错误 |
| `allowlist` | 若命令在白名单则放行，否则拒绝 |

超时后 agent 会收到 followup 消息通知用户：
```
Exec denied (gateway id=<approvalId>, approval-timeout): <command>
```

### 7.5 决策选项

| 决策 | 含义 |
|------|------|
| `allow-once` | 本次允许，下次同样命令仍需审核 |
| `allow-always` | 允许并将命令模式加入白名单（持久化到 `~/.openclaw/exec-approvals.json`） |
| `deny` | 拒绝执行 |

`allow-always` 会调用 `addAllowlistEntry()` 将命令模式写入 `~/.openclaw/exec-approvals.json`，后续相同命令自动放行。

### 7.6 审核请求的 WS 事件 scope 控制

审核相关事件受 scope 保护（`src/gateway/server-broadcast.ts`）：

```typescript
const EVENT_SCOPE_GUARDS: Record<string, string[]> = {
  "exec.approval.requested": ["operator.approvals"],
  "exec.approval.resolved": ["operator.approvals"],
};
```

客户端需在 `connect` 请求中声明 `scopes: ["operator.approvals"]` 或 `scopes: ["operator.admin"]` 才能收到审核事件。

对应的 RPC 方法也受同样的 scope 保护（`src/gateway/method-scopes.ts`）：
- `exec.approval.request` — 发起审核请求
- `exec.approval.waitDecision` — 等待审核决策
- `exec.approval.resolve` — 提交审核决策

### 7.7 子 Agent（sessions_spawn）的审核

子 agent 本身没有独立的审核门，但有两层间接控制：

1. `sessions_spawn` 被列在 `DANGEROUS_ACP_TOOLS`（`src/security/dangerous-tools.ts`），在 ACP（自动化控制平面）场景下强制要求用户确认，不允许静默通过：

```typescript
// src/security/dangerous-tools.ts
export const DANGEROUS_ACP_TOOL_NAMES = [
  "exec", "spawn", "shell",
  "sessions_spawn", "sessions_send",
  "gateway",
  "fs_write", "fs_delete", "fs_move",
  "apply_patch",
] as const;

export const DANGEROUS_ACP_TOOLS = new Set<string>(DANGEROUS_ACP_TOOL_NAMES);
```

2. 子 agent 执行的 exec 命令同样走上述审核流程，所以子 agent 执行危险命令时仍会触发人工审核。

### 7.8 审核配置示例

```json
// ~/.openclaw/exec-approvals.json
{
  "version": 1,
  "socket": {
    "path": "~/.openclaw/exec-approvals.sock",
    "token": "<auto-generated>"
  },
  "defaults": {
    "security": "allowlist",
    "ask": "on-miss",
    "askFallback": "deny",
    "autoAllowSkills": false
  },
  "agents": {
    "main": {
      "allowlist": [
        { "id": "uuid-1", "pattern": "git *", "lastUsedAt": 1710000000000 },
        { "id": "uuid-2", "pattern": "npm test" }
      ]
    }
  }
}
```

Telegram 审核配置（`openclaw.json`）：
```json
{
  "channels": {
    "telegram": {
      "execApprovals": {
        "enabled": true,
        "approvers": [123456789],
        "agentFilter": ["main"],
        "sessionFilter": ["agent:main:*"]
      }
    }
  },
  "approvals": {
    "exec": {
      "enabled": true,
      "mode": "session",
      "targets": [
        { "channel": "telegram", "to": "123456789" }
      ]
    }
  }
}
```

### 7.9 审核完整时序图

```
Agent                    Gateway                    UI/Telegram
  │                         │                           │
  │── exec tool call ──────►│                           │
  │                         │── 检查白名单 ─────────────│
  │                         │   requiresExecApproval()  │
  │                         │                           │
  │                         │── broadcast ─────────────►│
  │                         │   "exec.approval.requested"│
  │                         │   { id, command, expiresAtMs }
  │                         │                           │
  │                         │── forwarder ─────────────►│ Telegram 消息
  │                         │   handleRequested()       │ "Approval required..."
  │                         │                           │
  │   (阻塞等待，最长 120s)  │                           │
  │                         │                           │
  │                         │◄── exec.approval.resolve ─│ 用户回复 /approve
  │                         │    { id, decision }       │
  │                         │                           │
  │                         │── broadcast ─────────────►│
  │                         │   "exec.approval.resolved"│
  │                         │   { id, decision, resolvedBy }
  │                         │                           │
  │◄── decision resolved ───│                           │
  │    allow-once/deny       │                           │
  │                         │                           │
  │── 继续执行 or 返回错误 ──│                           │
```
