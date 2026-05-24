# 消息流转函数调用链分析 v2

本文档对比分析 `extensions/agent-registry` 接收请求消息后的处理流程，与 `aiemas/ui/mas4s` 通过 `chat.send` 发送消息的处理流程。仅关注函数调用链，不涉及具体代码实现。

---

## 1. extensions/agent-registry 接收请求消息处理流程

### 通信模型

A2A（Agent-to-Agent），基于 NATS JetStream 的去中心化发布-订阅模型。

### 函数调用链

```
NATS Server
  │
  ▼
[Worker Thread] channel.worker.ts
  natsClient.subscribe(subject, callback)
    → callback(payload: Uint8Array)
      → parentPort.postMessage({ type: "MESSAGE", subject, payload })
  │
  ▼
[Main Thread] channel.ts — natsClient.connect() 内的 worker.on("message") 监听
  worker.on("message", msg)
    → handlers.get(msg.subject)
      → handler(msg.payload)   // handler 由 messageRouter.createInboundHandler() 生成
  │
  ▼
[Router] router.ts — createInboundHandler(topic) 返回的闭包
  (bytes: Uint8Array) => {
    → deserializeEnvelope(bytes)                    // envelope.ts
    → 自环过滤: envelope.source === getEffectiveAgentId()
    → 主题模式匹配与路由分发:
        ├─ matchesPrefix("a2a.agent.unicast.")  → handleUnicast(envelope)
        ├─ matchesPrefix("a2a.agent.group.")    → handleMulticast(envelope)
        ├─ matchesPrefix("a2a.agent.broadcast.") → handleBroadcast(envelope)
        ├─ matchesPrefix("a2a.discussion.")     → emitCollabEvent() + handleCollaborationTopic(discussionId, envelope)
        └─ matchesPrefix("a2a.cowork.")         → emitCollabEvent() + handleCollaborationTopic(taskId, envelope)
  }
  │
  ▼
[Router 分支处理] router.ts
  handleUnicast(envelope)
    → getOrCreateSession(envelope.source, boundAgentId)
      → session.dispatch(envelope)

  handleMulticast(envelope)
    → getLeastLoadedSession(boundAgentId)  // 负载均衡选择
    → 若无会话: createSession(envelope.source, boundAgentId)
    → session.dispatch(envelope)

  handleBroadcast(envelope)
    → switch(envelope.action):
        ├─ "discussion.created" → arbiter.processDiscussionCreated(payload)
        └─ "cowork.created"     → arbiter.processCoworkCreated(payload)

  handleCollaborationTopic(topicId, envelope)
    → getOrCreateSession(topicId, boundAgentId)
      → session.dispatch(envelope)
  │
  ▼
[Session 层] channel.ts — createAgentSession()
  session.dispatch(envelope)
    → 提取 messageText = envelope.payload["text"]
    → dispatchInboundDirectDmWithRuntime({       // openclaw/plugin-sdk/direct-dm
        cfg, runtime, channel, accountId,
        peer, senderId, rawBody, messageId,
        deliver: async (payload) => { ... }
      })
  │
  ▼
[Core Agent Runtime] — OpenClaw 核心规划执行管道
  → Agent 推理、工具调用、生成响应
  → 调用 deliver(payload) 回调
  │
  ▼
[Outbound] outbound.ts — createOutboundAdapter().send()
  deliver 回调内:
    → outboundAdapter.send({
        responseText, inboundEnvelope, sessionContext
      })
      → resolveSubject(replyTo, source, ctx)     // 确定目标 NATS 主题
      → resolveAction(ctx, isComplete)           // 确定信封 action
      → resolveResourceType(ctx)                 // 确定 resource_type
      → buildPayload(responseText, ctx)          // 构建负载
      → createEnvelope({ ... })                  // envelope.ts — 生成 RegistryEnvelope
      → serializeEnvelope(envelope)              // envelope.ts — JSON → Uint8Array
      → natsClient.publish(subject, bytes)       // 通过 Worker 线程发布到 NATS
```

### 关键模块职责

| 模块 | 职责 |
|------|------|
| `channel.worker.ts` | Worker 线程，持有 NATS 物理连接，隔离网络 I/O |
| `channel.ts` | 主线程组装，Worker 消息代理，Session 工厂 |
| `router.ts` | 消息反序列化、自环过滤、主题路由分发 |
| `envelope.ts` | RegistryEnvelope 序列化/反序列化/工厂 |
| `outbound.ts` | 响应信封构建与 NATS 发布 |
| `arbiter.ts` | 协作仲裁器，处理 broadcast 中的协作邀请 |

---

## 2. aiemas/ui/mas4s 通过 chat.send 发送消息处理流程

### 通信模型

C2A（Client-to-Agent），基于 WebSocket 的 RPC + 事件流模型。

### 函数调用链（发送阶段）

```
[UI 组件] — 用户点击发送 / 回车
  │
  ▼
[Controller] message-controller.ts — MessageController.onSendMessage(e)
  → 获取 store.activeSession
  → 检查 isChattingBySession → 若忙碌则调用 onAbortChat()
      → client.request("chat.abort", { sessionKey, runId })
  → crypto.randomUUID() 生成 clientRunId
  → 构造本地 ChatMessage { role: "user", content, id: clientRunId, ... }
  → store.appendMessage(sessionUuid, msg)           // 乐观追加到会话消息流
  → store.appendAgentMessage(sessionUuid, rootAgentId, msg)  // 乐观追加到 Agent 消息流
  → store.setIsChatting(sessionUuid, true, clientRunId)      // 标记忙碌状态
  │
  ▼
[Format] message-format.ts — buildChatSendParams()
  → 组装 { sessionKey, message, clientRunId, idempotencyKey, attachments }
  │
  ▼
[Gateway Client] client.ts — getClient()
  → 返回 GatewayBrowserClient 单例
  │
  ▼
[Gateway] gateway.ts — GatewayBrowserClient.request("chat.send", params)
  → 校验 ws.readyState === WebSocket.OPEN
  → generateUUID() 生成 RPC 帧 ID
  → 构建帧 { type: "req", id, method: "chat.send", params }
  → pending.set(id, { resolve, reject })    // 注册 Promise 回调
  → ws.send(JSON.stringify(frame))          // WebSocket 物理发送
  │
  ▼
[Gateway Backend] — WebSocket Server 接收 RPC 帧
  → 处理 chat.send 请求
  → 返回同步确认帧 { type: "res", id, ok: true }
  │
  ▼
[Gateway] gateway.ts — handleMessage(raw)
  → JSON.parse(raw)
  → frame.type === "res"
    → pending.get(res.id)
    → pending.delete(res.id)
    → res.ok ? pending.resolve(payload) : pending.reject(GatewayRequestError)
```

### 函数调用链（接收阶段 — 流式事件反馈）

```
[Gateway Backend] — Agent 执行过程中推送事件
  → ws.send({ type: "event", event: "chat"|"agent"|..., payload })
  │
  ▼
[Gateway] gateway.ts — handleMessage(raw)
  → frame.type === "event"
    → 序列号间隙检测 (onGap)
    → opts.onEvent(evt)
  │
  ▼
[Client] client.ts — onEvent 回调
  → 遍历 _pendingHandlers 列表
    → handler(evt)
  │
  ▼
[Event Handler] event-handler.ts — registerEventHandlers() 注册的闭包
  → switch(evt.event):
      ├─ "chat"              → handleChatEvent(store, payload)
      ├─ "agent"             → handleAgentEvent(store, payload)
      ├─ "session.tool"      → handleAgentEvent(store, payload)
      ├─ "exec.approval.*"   → store.addApproval() / store.resolveApproval()
      ├─ "sessions.changed"  → 生命周期状态同步 (start/end/error/abort)
      ├─ "session.joined"    → store.addSession()
      ├─ "session.removed"   → store.removeSession()
      ├─ "topology.changed"  → store.setTopology()
      ├─ "collab.message"    → dispatchCollabMessage()
      └─ ...
  │
  ▼
[Chat 事件处理] event-handler.ts — handleChatEvent(store, payload)
  → resolveMessageTarget(store, sessionKey)   // 解析 sessionUuid, agentId, isRootAgent
  → state === "clear" → store.clearMessages() + store.resetToolStream()
  → state === "final" → _thinkingByRun.delete() + store.setIsChatting(false) + clearAgentActive()
  → state === "delta" → store.setIsChatting(true)
  → normalizeMessage(message)
  → parseSenderPrefix(firstText)
  → 构造 ChatMessage
  → updateAgentChatStream(store, sessionUuid, agentId, chatMsg, isFinal)
  → isRootAgent ? updateChatStream(store, sessionUuid, chatMsg, isFinal) : skip
  │
  ▼
[Agent 事件处理] event-handler.ts — handleAgentEvent(store, payload)
  → resolveMessageTarget(store, sessionKey)
  → switch(stream):
      ├─ "prompt"    → normalizeMessage() → updateAgentChatStream() + updateChatStream()
      ├─ "agent"     → normalizeMessage() → updateAgentChatStream() (A2A 中继消息)
      ├─ "assistant" → 流式文本拼接 → updateAgentChatStream() + updateChatStream()
      ├─ "tool"      → store.upsertToolStream() + store.appendAgentMessage() (toolResult)
      └─ "thinking"  → _thinkingByRun.set() → updateAgentChatStream() + updateChatStream()
  │
  ▼
[Store 更新] event-handler.ts — updateChatStream() / updateAgentChatStream()
  → 末尾消息 ID + role 匹配 → 原地更新（流式 delta 合并）
  → 不匹配 → store.appendMessage() / store.appendAgentMessage()
```

### 关键模块职责

| 模块 | 职责 |
|------|------|
| `message-controller.ts` | 用户操作入口，乐观更新，RPC 调用编排 |
| `message-format.ts` | 请求参数组装，发送者前缀解析 |
| `client.ts` | Gateway 客户端单例管理，事件处理器注册 |
| `gateway.ts` | WebSocket 连接管理，RPC 请求/响应，事件分发 |
| `event-handler.ts` | 流式事件路由，消息归一化，Store 状态同步 |
| `app-store.ts` | 响应式状态容器，消息列表管理 |

---

## 3. 对比分析

### 3.1 通信协议与架构

| 维度 | agent-registry (接收) | mas4s UI (发送) |
|------|----------------------|-----------------|
| 物理协议 | NATS JetStream (消息中间件) | WebSocket (浏览器长连接) |
| 通信模式 | 去中心化 Pub/Sub | 同步 RPC + 单向事件流 |
| 会话模型 | A2A 对等通信 | C2A 操作员→智能体 |
| 线程模型 | Worker 线程隔离网络 I/O | 单线程事件循环 |

### 3.2 消息入口与路由

| 维度 | agent-registry | mas4s UI |
|------|---------------|----------|
| 入口 | NATS 订阅回调 (bytes) | 用户 UI 事件 (CustomEvent) |
| 路由依据 | NATS 主题前缀模式匹配 | 固定方法名 ("chat.send") |
| 路由复杂度 | 5 种主题模式 (unicast/group/broadcast/discussion/cowork) | 单一路径，无分支路由 |
| 反序列化 | deserializeEnvelope (自定义二进制→JSON) | JSON.parse (标准 WebSocket 帧) |

### 3.3 会话管理

| 维度 | agent-registry | mas4s UI |
|------|---------------|----------|
| 会话标识 | NATS 主题 + sourceAgentId 组合键 | sessionKey (逻辑键) |
| 会话创建 | 按需动态创建 (getOrCreateSession) | 预先存在，由 Gateway 管理 |
| 负载均衡 | getLeastLoadedSession (多会话分发) | 无，串行单会话 |
| 并发控制 | 多会话并行处理 | isChattingBySession 互斥锁 |

### 3.4 消息生命周期

| 维度 | agent-registry | mas4s UI |
|------|---------------|----------|
| 发送前 | 无本地状态 (纯后端) | 乐观渲染 + 状态标记 |
| 确认机制 | Fire-and-forget (无 ACK) | 同步 RPC 响应确认 |
| 幂等保障 | envelope.message_id 去重 | clientRunId + idempotencyKey |
| 自环防护 | source === effectiveAgentId 过滤 | 无需 (单向 C→S) |
| 错误恢复 | catch 日志 + 丢弃 (不崩溃) | GatewayRequestError + 自动重连 |

### 3.5 响应/反馈机制

| 维度 | agent-registry | mas4s UI |
|------|---------------|----------|
| 响应路径 | outboundAdapter → NATS publish | Gateway 事件流 → event-handler |
| 流式支持 | 无 (单次完整响应) | delta/final 增量流式更新 |
| 状态同步 | 无 UI 状态 | thinking/assistant/tool 多流并行 |
| 中断机制 | 无 (异步独立) | chat.abort RPC 主动中断 |

### 3.6 调用链深度对比

```
agent-registry 接收链 (7 层):
  NATS → Worker.callback → parentPort.postMessage → handlers.get(subject)
  → createInboundHandler → deserializeEnvelope → handleXxx → session.dispatch
  → dispatchInboundDirectDmWithRuntime → [Core Agent] → deliver → outboundAdapter.send
  → createEnvelope → serializeEnvelope → natsClient.publish

mas4s 发送链 (4 层):
  UI Event → MessageController.onSendMessage → buildChatSendParams
  → GatewayBrowserClient.request → ws.send

mas4s 接收链 (5 层):
  ws.onmessage → handleMessage → onEvent → handler(evt)
  → handleChatEvent/handleAgentEvent → resolveMessageTarget
  → normalizeMessage → updateChatStream/updateAgentChatStream → store.appendMessage
```

### 3.7 架构协同关系

两个流程在系统中形成闭环：

1. **mas4s → Gateway → agent-registry**：用户在 mas4s 发送 `chat.send`，Gateway 将请求路由到目标 Agent。若目标 Agent 绑定了 agent-registry 通道，Gateway 通过 Plugin SDK 的 `outboundAdapter` 将消息发布到 NATS 主题。

2. **agent-registry → Core Agent → Gateway → mas4s**：agent-registry 接收 NATS 消息后，通过 `dispatchInboundDirectDmWithRuntime` 进入核心 Agent 执行管道。执行过程中产生的流式事件（thinking/assistant/tool）通过 Gateway WebSocket 推送回 mas4s 的 `event-handler`。

3. **隔离设计**：agent-registry 通过 Worker 线程隔离 NATS I/O；mas4s 通过乐观更新隔离网络延迟对 UI 的影响。两者分别在后端和前端最大化系统弹性。
