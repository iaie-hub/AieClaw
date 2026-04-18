# 实时对话中子 Agent 抽屉不显示根 Agent 发来的消息 — 原因分析与解决方案

> 本文档基于完整的源码链路追踪，分析子 Agent 抽屉在实时模式下缺失 role="agent" 输入消息的根因，并给出解决方案及后续 Trace 扩展设计。

---

## 一、问题描述

实时对话中，子 Agent 抽屉只显示了子 Agent 的 assistant 回复和 tool 消息，缺少根 Agent 通过 `sessions_send` 发来的输入消息（role="agent"）。

用户刷新页面或切换 session 后，历史消息视图能正确显示 role="agent" 的消息，说明消息已正确持久化到 JSONL transcript 和 SQLite `session_messages` 表中，问题仅出现在实时 WebSocket 广播路径上。

---

## 二、根因分析

### 2.1 消息广播的两条路径

Gateway 中消息到达 UI 有两条独立路径：

| 路径                         | 触发方式                                       | 事件类型                                                   | 用途                                             |
| ---------------------------- | ---------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------------ |
| **路径 A：`chat` 事件广播**  | `context.broadcast("chat", payload)`           | `chat` (state: delta/final/clear)                          | 流式文本、最终确认、用户消息                     |
| **路径 B：`agent` 事件广播** | `emitAgentEvent()` → `createAgentEventHandler` | `agent` (stream: assistant/tool/thinking/lifecycle/prompt) | assistant 流式文本、工具调用、推理过程、生命周期 |

### 2.2 `chat.send` vs `aiemas_sessions_send` 的广播差异

#### `chat.send`（Web UI 直接发送）— 用户输入消息有广播 ✅

```
用户在 Web UI 输入消息
  │
  ├─ 1. MessageController.onSendMessage() 乐观追加到 UI（立即显示）
  │
  ├─ 2. Gateway chat.send 处理器
  │     ├─ emitSessionTranscriptUpdate({ message: userMessage })
  │     │   └─ 触发 session.message 事件广播（含消息内容）
  │     │
  │     └─ context.broadcast("chat", { state: "delta/final", message: { role: "user", ... } })
  │         └─ 触发 chat 事件广播（UI handleChatEvent 处理）
  │
  └─ 3. UI 收到 chat 事件，handleChatEvent 追加用户消息到 messagesByAgent
```

#### `aiemas_sessions_send`（A2A 消息）— 用户输入消息无广播 ❌

```
根 Agent 调用 aiemas_sessions_send(agentId, message)
  │
  ├─ 1. aiemas-tools.ts 解析 targetSessionKey
  ├─ 2. markNextMessageAsAgent（标记下一条消息为 agent 来源）
  ├─ 3. callSessionsSend → callGateway("agent", { message, sessionKey, lane:"nested", ... })
  │
  ├─ 4. Gateway agent 方法处理器
  │     ├─ respond({ status: "accepted", runId })  ← 立即返回
  │     ├─ emitSessionsChanged({ reason: "send" })  ← 仅通知 session 列表变更，不含消息内容
  │     └─ dispatchAgentRunFromGateway()  ← 异步分发 agent run
  │         │
  │         │  ❌ 此处没有 broadcast("chat", { message: { role: "agent", ... } })
  │         │
  │         └─ agentCommandFromIngress() → runEmbeddedPiAgent()
  │              │
  │              ├─ 用户消息写入 JSONL transcript  ← 持久化成功
  │              │  ❌ 写入后没有 emit 任何实时广播事件
  │              │
  │              ├─ emitAgentEvent({ stream: "assistant", text: "..." })     ← assistant 回复 ✅
  │              ├─ emitAgentEvent({ stream: "tool", ... })                  ← 工具调用 ✅
  │              └─ emitAgentEvent({ stream: "thinking", ... })              ← 推理过程 ✅
  │
  └─ 5. UI 收到 agent 事件
        ├─ handleAgentEvent 处理 stream:assistant → 显示 assistant 回复 ✅
        ├─ handleAgentEvent 处理 stream:tool → 显示工具调用 ✅
        └─ ❌ 没有收到任何包含 agent 输入消息的事件
```

### 2.3 三层缺失的精确定位

#### 第一层：`aiemas_sessions_send` 不广播输入消息

`aiemas_sessions_send`（`aiemas/src/gateway-bridge/aiemas-tools.ts`）是 AIEMAS Agent 间通信的唯一入口。在调用 `callSessionsSend` 前后，没有任何地方将输入消息广播到 WebSocket 客户端。

#### 第二层：Gateway `agent` 方法不广播用户输入消息

在 `src/gateway/server-methods/agent.ts` 的 `agentHandlers.agent` 处理器中：

- 收到请求后立即返回 `accepted`
- 发出 `sessions.changed` 事件（reason: "send"），但该事件不含消息内容
- 异步调用 `dispatchAgentRunFromGateway()`，但该函数内部没有任何 `broadcast("chat", ...)` 调用

#### 第三层：UI 端 `stream === "prompt"` 处理存在 role 推断 bug

在 `aiemas/ui/mas4s/src/gateway/event-handler.ts` 的 `handleAgentEvent` 中，已有 `stream === "prompt"` 处理逻辑：

```typescript
if (stream === "prompt" && data?.text !== undefined) {
    const normalized = normalizeMessage(data.text);  // ← data.text 是纯文本字符串
    const chatMsg: ChatMessage = {
      ...normalized,
      role: normalized.role,  // ← role 会是 "unknown"（字符串没有 role 属性）
      ...
    };
}
```

`normalizeMessage(data.text)` 接收的是纯文本字符串，`m.role` 为 `undefined`，导致 role 被设为 `"unknown"`。而 `message-list.ts` 中 `"unknown"` 不匹配任何渲染条件，最终什么都不渲染。

### 2.4 消息渲染路由

`message-list.ts` 中的分发逻辑：

| role                      | 组件                | 位置       | 样式                     |
| ------------------------- | ------------------- | ---------- | ------------------------ |
| `"user"` / `"User"`       | `<msg-user>`        | 右对齐     | 蓝色气泡                 |
| `"agent"`                 | `<msg-agent-input>` | **右对齐** | 蓝色气泡 + 绿色 A2A 徽章 |
| `"assistant"`             | `<msg-agent>`       | 左对齐     | 灰色气泡                 |
| `"tool"` / `"toolResult"` | `<msg-tool-result>` | 左对齐     | 工具卡片                 |
| `"unknown"`               | 无                  | **不渲染** | —                        |

A2A 输入消息应使用 `role="agent"` → `<msg-agent-input>` → 右对齐，带 A2A 徽章。

### 2.5 消息链路对比总结

| 场景                           | 用户输入广播   | assistant 回复广播          | tool 调用广播          | thinking 广播              |
| ------------------------------ | -------------- | --------------------------- | ---------------------- | -------------------------- |
| `chat.send`（Web UI 直接发送） | ✅ `chat` 事件 | ✅ `agent` stream:assistant | ✅ `agent` stream:tool | ✅ `agent` stream:thinking |
| `aiemas_sessions_send`（A2A）  | ❌ **缺失**    | ✅ `agent` stream:assistant | ✅ `agent` stream:tool | ✅ `agent` stream:thinking |

---

## 三、解决方案（方案 B：在 `aiemas_sessions_send` 中广播）

### 3.1 方案选型

| 维度                    | 方案 A：改 `agent-command.ts` emit prompt     | 方案 B：在 `aiemas_sessions_send` 中广播                   |
| ----------------------- | --------------------------------------------- | ---------------------------------------------------------- |
| **改动位置**            | `src/agents/agent-command.ts`（Gateway 核心） | `aiemas/src/gateway-bridge/aiemas-tools.ts`（AIEMAS 模块） |
| **是否改 Gateway 核心** | 是                                            | **否**                                                     |
| **影响范围**            | 所有 agent run                                | **仅 AIEMAS A2A 消息**                                     |
| **去重复杂度**          | 需要 UI 端区分 isRootAgent 做去重             | **无需去重**                                               |
| **架构边界**            | 跨越 AIEMAS/Gateway 边界                      | **闭环在 AIEMAS 模块内**                                   |
| **符合最小入侵原则**    | 一般                                          | **完全符合**                                               |

**选择方案 B**：完全闭环在 AIEMAS 模块内，不改 Gateway 核心逻辑，不需要复杂的去重，精确覆盖问题场景。

### 3.2 改动点 1：`aiemas-tools.ts` — 新增 `broadcastChatEvent` 依赖注入

在 `AiemasToolDeps` 中新增广播回调：

```typescript
export interface AiemasToolDeps {
  db: DatabaseSync;
  callSessionsSend: (params: { ... }) => Promise<unknown>;
  transcriptStore?: SessionTranscriptStore;
  /** 依赖注入：广播 chat 事件到 WebSocket 客户端，用于 A2A 输入消息实时显示 */
  broadcastChatEvent?: (params: {
    sessionKey: string;
    runId: string;
    message: { role: string; content: Array<{ type: string; text: string }>; timestamp: number };
  }) => void;
}
```

在 `execute` 中，`callSessionsSend` 调用前广播 agent 输入消息：

```typescript
// 广播 A2A 输入消息到 UI，使子 Agent 抽屉实时显示
if (deps.broadcastChatEvent && targetSessionKey) {
  const sourceAgentId = extractAgentNameFromKey(agentSessionKey);
  deps.broadcastChatEvent({
    sessionKey: targetSessionKey,
    runId: `a2a-input-${Date.now()}`,
    message: {
      role: "agent",
      content: [{ type: "text", text: message ?? "" }],
      timestamp: Date.now(),
      senderLabel: sourceAgentId,
    },
  });
}
```

### 3.3 改动点 2：`mas4s-integration.ts` — 构造 `broadcastChatEvent` 回调

在 `resolveAgentTools` 中构造回调，通过 `emitAgentEvent` 走 agent 事件总线：

```typescript
import { emitAgentEvent } from "../infra/agent-events.js";

// resolveAgentTools 内部
const broadcastChatEvent = (params: {
  sessionKey: string;
  runId: string;
  message: { role: string; content: unknown[]; timestamp: number; senderLabel?: string };
}) => {
  emitAgentEvent({
    runId: params.runId,
    sessionKey: params.sessionKey,
    stream: "agent",
    data: {
      role: params.message.role, // "agent"
      text: params.message, // 完整消息对象
      senderLabel: params.message.senderLabel,
    },
  });
};

tools.push(
  createAiemasSessionsSendTool(
    {
      db: plugin.db,
      callSessionsSend,
      transcriptStore: plugin.transcriptStore,
      broadcastChatEvent,
    },
    { agentSessionKey: context.agentSessionKey },
  ),
);
```

### 3.4 改动点 3：`event-handler.ts` — 新增 `stream === "agent"` 分支

现有 `stream === "prompt"` 分支保持不变（用于 ACP 路径）。新增独立的 `stream === "agent"` 分支处理 A2A 输入消息：

- `prompt`：ACP 路径的用户输入（`emitAcpPrompt`），语义是"提交给 LLM 的 prompt"
- `agent`：A2A 消息（`aiemas_sessions_send` 广播），语义是"来自另一个 Agent 的输入"

修复：新增独立的 `stream === "agent"` 分支，从事件 `data.role` 显式取值：

```typescript
// 新增 stream === "agent" 分支（与 prompt 分支解耦）
if (stream === "agent" && data?.text !== undefined) {
  const normalized = normalizeMessage(data.text);
  const chatMsg: ChatMessage = {
    ...normalized,
    id: runId ?? `a2a-${Date.now()}`,
    sessionKey,
    timestamp: Date.now(),
    role: ((data as Record<string, unknown>).role as string) ?? normalized.role,
    senderLabel: ((data as Record<string, unknown>).senderLabel as string) ?? null,
    subType: undefined,
  };
  // ...
}
```

当 `emitAgentEvent({ stream: "agent", data: { role: "agent", text: "...", senderLabel: "root-agent" } })` 到达时：

- `chatMsg.role` = `"agent"`
- `message-list.ts` 路由到 `<msg-agent-input>`
- **右对齐显示，蓝色气泡，带绿色 A2A 徽章**

### 3.5 改动范围评估

| 改动                           | 文件                                           | 风险 | 是否改 Gateway 核心          |
| ------------------------------ | ---------------------------------------------- | ---- | ---------------------------- |
| 新增 `broadcastChatEvent` 依赖 | `aiemas/src/gateway-bridge/aiemas-tools.ts`    | 低   | 否                           |
| 构造广播回调                   | `src/gateway/mas4s-integration.ts`             | 低   | 仅新增 `emitAgentEvent` 导入 |
| 新增 `stream: "agent"` 处理    | `aiemas/ui/mas4s/src/gateway/event-handler.ts` | 低   | 否                           |

### 3.6 修复后的消息流

```
根 Agent 调用 aiemas_sessions_send(agentId, message)
  │
  ├─ 1. 解析 targetSessionKey
  ├─ 2. markNextMessageAsAgent
  │
  ├─ 3. broadcastChatEvent → emitAgentEvent({ stream: "agent", data: { role: "agent", text: message } })
  │     └─ Gateway createAgentEventHandler → broadcast("agent", payload)
  │         └─ UI handleAgentEvent → stream === "agent"
  │             └─ chatMsg.role = data.role = "agent"
  │                 └─ store.appendAgentMessage → 子 Agent 抽屉立即显示 ✅
  │
  ├─ 4. callSessionsSend → 子 Agent 开始执行
  │     ├─ stream:assistant → 子 Agent 抽屉显示回复 ✅
  │     ├─ stream:tool → 子 Agent 抽屉显示工具调用 ✅
  │     └─ stream:thinking → 子 Agent 抽屉显示推理 ✅
  │
  └─ 5. 返回结果
```

### 3.7 验证方式

1. **实时场景**：根 Agent 通过 `aiemas_sessions_send` 向子 Agent 发送消息，观察子 Agent 抽屉是否立即显示输入消息（右对齐，A2A 徽章）
2. **历史一致性**：刷新页面后，历史消息视图与实时视图显示一致
3. **多 Agent 场景**：多个子 Agent 同时接收消息，确认各自抽屉独立显示正确
4. **无副作用**：Web UI 直接发送消息（chat.send），确认根 Agent 消息列表不受影响

---

## 四、后续扩展：Trace 整个消息链路

### 4.1 目标

支持 trace 整个消息链路，包括 LLM 请求和响应，使用户能够在 UI 中查看完整的 Agent 执行过程。

### 4.2 新增 `stream: "trace"` 事件

在现有的 `agent` 事件流基础上，新增 `stream: "trace"` 类型：

#### 4.2.1 LLM 请求 Trace

**触发点**：`src/agents/pi-embedded-runner/run.ts` 中 LLM API 调用前

```typescript
emitAgentEvent({
  runId,
  sessionKey,
  stream: "trace",
  data: {
    phase: "llm-request",
    provider,
    model,
    systemPromptTokens,
    historyTurns,
    toolCount,
    timestamp: Date.now(),
  },
});
```

#### 4.2.2 LLM 响应 Trace

**触发点**：`src/agents/pi-embedded-subscribe.ts` 中 LLM 响应完成后

```typescript
emitAgentEvent({
  runId,
  sessionKey,
  stream: "trace",
  data: {
    phase: "llm-response",
    usage: { inputTokens, outputTokens, cacheRead, cacheWrite, totalTokens },
    stopReason,
    durationMs,
    timestamp: Date.now(),
  },
});
```

#### 4.2.3 工具执行 Trace

```typescript
emitAgentEvent({
  runId,
  sessionKey,
  stream: "trace",
  data: {
    phase: "tool-execution",
    toolName,
    toolCallId,
    durationMs,
    resultSize,
    isError,
    timestamp: Date.now(),
  },
});
```

### 4.3 UI Trace 面板设计

在子 Agent 抽屉中增加 "Trace" tab，以时间线形式显示完整的消息链路：

```
┌─────────────────────────────────────────────────────────┐
│  [Messages]  [Trace]  [Settings]                        │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  14:32:01  📥 Agent Input                               │
│            from: root-agent (via aiemas_sessions_send)  │
│            "请帮我分析 src/main.ts 的性能问题"           │
│                                                         │
│  14:32:01  🧠 LLM Request                               │
│            model: claude-sonnet-4-20250514               │
│            input: 12,340 tokens (cache hit: 8,200)      │
│                                                         │
│  14:32:03  🔧 Tool: read_file                           │
│            duration: 45ms, result: 2,340 chars          │
│                                                         │
│  14:32:08  💬 Assistant Reply                            │
│            output: 1,240 tokens                         │
│                                                         │
│  14:32:08  ✅ Run Complete                               │
│            duration: 7.2s, cost: $0.0234                │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### 4.4 Trace 扩展的改动范围

| 改动           | 文件                                                     | 风险 |
| -------------- | -------------------------------------------------------- | ---- |
| LLM 请求 trace | `src/agents/pi-embedded-runner/run.ts`                   | 中   |
| LLM 响应 trace | `src/agents/pi-embedded-subscribe.ts`                    | 中   |
| 工具执行 trace | `src/agents/pi-embedded-subscribe.handlers.tools.ts`     | 低   |
| UI Trace 面板  | `aiemas/ui/mas4s/src/components/trace-panel.ts`          | 低   |
| Trace 持久化   | `aiemas/src/session-history/session-transcript-store.ts` | 低   |

---

## 五、推荐实施顺序

| 阶段       | 内容                     | 优先级 | 预估工作量 |
| ---------- | ------------------------ | ------ | ---------- |
| **第一步** | 方案 B 实施（本次）      | P0     | 0.5 天     |
| **第二步** | LLM 请求/响应 trace 事件 | P2     | 1 天       |
| **第三步** | UI Trace 面板            | P2     | 1.5 天     |
| **第四步** | Trace 持久化 + 历史查询  | P3     | 1 天       |

---

## 六、相关文件索引

| 文件                                           | 作用                                                                 |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| `aiemas/src/gateway-bridge/aiemas-tools.ts`    | `aiemas_sessions_send` 工具实现（本次改动）                          |
| `src/gateway/mas4s-integration.ts`             | AIEMAS 集成层，构造 `broadcastChatEvent` 回调（本次改动）            |
| `aiemas/ui/mas4s/src/gateway/event-handler.ts` | UI 事件处理，修复 `stream=prompt` role 推断（本次改动）              |
| `aiemas/ui/mas4s/src/views/message-list.ts`    | 消息列表，按 role 分发渲染组件                                       |
| `aiemas/ui/mas4s/src/views/msg-agent-input.ts` | A2A 输入消息组件（右对齐，A2A 徽章）                                 |
| `src/gateway/server-methods/agent.ts`          | Gateway `agent` 方法处理器                                           |
| `src/gateway/server-chat.ts`                   | `createAgentEventHandler`，将 `emitAgentEvent` 转换为 WebSocket 广播 |
| `src/infra/agent-events.ts`                    | `emitAgentEvent` / `onAgentEvent` 事件总线                           |
| `.kiro/specs/a2a-communication/design.md`      | A2A 通信设计文档                                                     |
