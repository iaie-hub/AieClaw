# OpenClaw Gateway 通信协议分析

> 基于源码分析，版本 2026.3.x

---

## 一、架构概览

OpenClaw Gateway 是所有客户端（Web、移动端、CLI）的统一接入点，同时暴露两种通信接口：

- **WebSocket**：主通信通道，用于实时双向 RPC 和事件推送
- **HTTP REST**：健康检查、Webhook 回调、OpenAI 兼容 API、工具调用

```
客户端
  ├── WebSocket ws://host:port/   ← 主通道（RPC + 事件流）
  └── HTTP      http://host:port/ ← 辅助通道（健康检查、OpenAI 兼容、Hooks）
```

默认端口：`18789`（loopback 绑定）

---

## 二、HTTP API

### 2.1 健康检查端点

| 路径 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 存活探针（liveness） |
| `/healthz` | GET | 存活探针（同上） |
| `/ready` | GET | 就绪探针（readiness） |
| `/readyz` | GET | 就绪探针（同上） |

响应示例：
```json
{ "status": "ok" }
```

### 2.2 OpenAI 兼容 API

路径：`POST /v1/chat/completions`

认证：`Authorization: Bearer <token>`

请求体（OpenAI Chat Completions 格式）：
```json
{
  "model": "openclaw",
  "messages": [
    { "role": "user", "content": "你好" }
  ],
  "stream": false
}
```

非流式响应：
```json
{
  "id": "chatcmpl_<uuid>",
  "object": "chat.completion",
  "created": 1710000000,
  "model": "openclaw",
  "choices": [{
    "index": 0,
    "message": { "role": "assistant", "content": "你好！" },
    "finish_reason": "stop"
  }],
  "usage": { "prompt_tokens": 0, "completion_tokens": 0, "total_tokens": 0 }
}
```

流式响应（`stream: true`）：SSE 格式，`data: {...}` 逐块推送，以 `data: [DONE]` 结束。

支持自定义 Header：
- `X-OpenClaw-Session-Key`：指定 session key
- `X-OpenClaw-Message-Channel`：指定消息渠道

### 2.3 工具调用 HTTP 端点

路径：`POST /api/tools/invoke`

认证：Bearer token

### 2.4 Webhook 回调

| 路径 | 渠道 |
|------|------|
| `/api/channels/mattermost/command` | Mattermost Slash Command |
| `/api/channels/slack/*` | Slack 事件/交互 |

### 2.5 控制 UI

路径：`/` 及子路径 — 提供 Web 控制台静态资源和 API。

---

## 三、WebSocket 协议

### 3.1 连接地址

```
ws://localhost:18789/
wss://your-gateway-host/   （TLS 模式）
```

### 3.2 帧格式

所有消息均为 JSON 文本帧，有三种类型：

**请求帧（客户端 → 服务端）**
```typescript
{
  type: "req",
  id: string,        // 请求 ID，用于匹配响应
  method: string,    // RPC 方法名
  params?: unknown   // 方法参数
}
```

**响应帧（服务端 → 客户端）**
```typescript
{
  type: "res",
  id: string,        // 对应请求的 ID
  ok: boolean,
  payload?: unknown, // 成功时的返回数据
  error?: {          // 失败时的错误信息
    code: string,
    message: string,
    details?: unknown,
    retryable?: boolean,
    retryAfterMs?: number
  }
}
```

**事件帧（服务端 → 客户端，主动推送）**
```typescript
{
  type: "event",
  event: string,     // 事件名
  payload?: unknown, // 事件数据
  seq?: number,      // 全局序列号（广播事件）
  stateVersion?: {   // 状态版本（用于增量同步）
    presence: number,
    health: number
  }
}
```

### 3.3 握手流程

```
客户端                              服务端
  |                                   |
  |──── TCP/WS 连接 ────────────────>|
  |                                   |
  |<─── event: connect.challenge ─────|
  |     { nonce: string, ts: number } |
  |                                   |
  |──── req: connect ───────────────>|
  |     (ConnectParams + auth)        |
  |                                   |
  |<─── res: hello-ok ────────────────|
  |     (HelloOk，含 snapshot)        |
  |                                   |
  |  ← 连接建立，开始正常通信 →       |
```

**connect 请求参数（ConnectParams）**：
```typescript
{
  minProtocol: number,   // 最低协议版本（当前为 1）
  maxProtocol: number,   // 最高协议版本
  client: {
    id: string,          // 客户端 ID，webchat 用 "webchat"
    displayName?: string,
    version: string,     // 客户端版本
    platform: string,    // 平台，如 "web"
    deviceFamily?: string,
    mode: string,        // 模式，如 "webchat"
    instanceId?: string
  },
  caps?: string[],       // 客户端能力列表
  auth?: {
    token?: string,      // Bearer token
    password?: string,
    deviceToken?: string,
    bootstrapToken?: string
  },
  role?: string,         // 角色：operator | node | browser
  scopes?: string[],     // 权限作用域
  locale?: string,
  userAgent?: string
}
```

**hello-ok 响应（HelloOk）**：
```typescript
{
  type: "hello-ok",
  protocol: number,      // 服务端协议版本
  server: {
    version: string,     // 服务端版本
    connId: string       // 连接 ID
  },
  features: {
    methods: string[],   // 支持的 RPC 方法列表
    events: string[]     // 支持的事件列表
  },
  snapshot: Snapshot,    // 初始状态快照
  canvasHostUrl?: string,
  auth?: {               // 设备认证时返回
    deviceToken: string,
    role: string,
    scopes: string[]
  },
  policy: {
    maxPayload: number,
    maxBufferedBytes: number,
    tickIntervalMs: number
  }
}
```

**Snapshot（初始状态）**：
```typescript
{
  presence: PresenceEntry[],  // 在线设备列表
  health: unknown,            // 健康状态
  stateVersion: { presence: number, health: number },
  uptimeMs: number,
  sessionDefaults?: {
    defaultAgentId: string,
    mainKey: string,
    mainSessionKey: string,   // 默认 session key，如 "main"
    scope?: string
  },
  authMode?: "none" | "token" | "password" | "trusted-proxy",
  updateAvailable?: { currentVersion, latestVersion, channel }
}
```

### 3.4 核心 RPC 方法

#### chat.send — 发送消息

请求参数：
```typescript
{
  sessionKey: string,          // 会话 key，如 "main" 或 "agent:xxx:main"
  message: string,             // 消息文本
  idempotencyKey: string,      // 幂等 key（UUID），防重复
  thinking?: string,           // 思考模式："low" | "medium" | "high"
  deliver?: boolean,           // 是否投递到外部渠道
  attachments?: unknown[],     // 附件（图片等）
  timeoutMs?: number           // 超时毫秒数
}
```

响应（立即 ACK）：
```typescript
{
  ok: true,
  payload: {
    runId: string,             // 本次运行 ID
    queued?: boolean
  }
}
```

Agent 执行过程中，服务端通过 `chat` 事件推送流式输出（见 3.5 节）。

#### chat.abort — 中止运行

```typescript
// 请求
{ sessionKey: string, runId?: string }

// 响应
{ ok: true, payload: { aborted: boolean } }
```

#### chat.history — 获取历史消息

```typescript
// 请求
{ sessionKey: string, limit?: number }

// 响应
{ ok: true, payload: { messages: unknown[] } }
```

#### health — 健康检查

```typescript
// 请求
{}

// 响应
{ ok: true, payload: { status: "ok", ... } }
```

#### channels.status — 渠道状态

```typescript
// 请求
{ probe?: boolean }

// 响应
{ ok: true, payload: { channels: ChannelStatus[] } }
```

#### sessions.list — 会话列表

```typescript
// 请求
{ agentId?: string, limit?: number }

// 响应
{ ok: true, payload: { sessions: SessionEntry[] } }
```

#### config.get — 获取配置

```typescript
// 请求
{ path?: string }

// 响应
{ ok: true, payload: { config: unknown } }
```

#### models.list — 模型列表

```typescript
// 请求
{}

// 响应
{ ok: true, payload: { models: ModelEntry[] } }
```

### 3.5 服务端推送事件

#### chat — 流式消息输出（最核心）

```typescript
{
  type: "event",
  event: "chat",
  payload: {
    runId: string,
    sessionKey: string,
    seq: number,           // 消息序列号（从 0 递增）
    state: "delta"         // 增量文本
          | "final"        // 最终完整消息
          | "aborted"      // 已中止
          | "error",       // 出错
    message?: unknown,     // 消息内容（final 时为完整消息对象）
    errorMessage?: string, // 错误信息
    usage?: unknown,       // token 用量（final 时）
    stopReason?: string    // 停止原因（final 时）
  }
}
```

消息流示意：
```
chat { state: "delta", seq: 0, message: { text: "你" } }
chat { state: "delta", seq: 1, message: { text: "好" } }
chat { state: "delta", seq: 2, message: { text: "！" } }
chat { state: "final",  seq: 3, message: { text: "你好！" }, usage: {...} }
```

#### connect.challenge — 握手挑战

```typescript
{ nonce: string, ts: number }
```

#### agent — Agent 执行事件

```typescript
{
  runId: string,
  sessionKey: string,
  stream: "assistant" | "tool" | "lifecycle",
  data: unknown
}
```

#### tick — 心跳

```typescript
{ ts: number }   // 服务端时间戳，按 tickIntervalMs 间隔发送
```

#### shutdown — 服务关闭通知

```typescript
{ reason: string, restartExpectedMs?: number }
```

#### presence.update — 在线状态变更

```typescript
{ presence: PresenceEntry[], stateVersion: StateVersion }
```

#### health.update — 健康状态变更

```typescript
{ health: unknown, stateVersion: StateVersion }
```

#### device.pair.requested — 设备配对请求

```typescript
{ deviceId: string, publicKey: string, ... }
```

#### exec.approval.requested — 工具执行审批请求

```typescript
{ approvalId: string, tool: string, input: unknown, ... }
```

### 3.6 错误码

| 错误码 | 含义 |
|--------|------|
| `INVALID_REQUEST` | 请求参数错误或权限不足 |
| `UNAUTHORIZED` | 认证失败 |
| `UNAVAILABLE` | 服务不可用（Agent 未就绪等） |
| `AGENT_TIMEOUT` | Agent 执行超时 |
| `NOT_LINKED` | 渠道未连接 |
| `NOT_PAIRED` | 设备未配对 |
| `INTERNAL_ERROR` | 服务器内部错误 |

---

## 四、认证机制

### 4.1 认证模式

| 模式 | 说明 |
|------|------|
| `none` | 无认证（loopback 本地连接默认） |
| `token` | Bearer token |
| `password` | 密码认证 |
| `trusted-proxy` | 反向代理信任 |

### 4.2 WebSocket 认证

在 `connect` 请求的 `auth` 字段中传入：

```typescript
auth: {
  token: "your-gateway-token",   // token 模式
  // 或
  password: "your-password",     // password 模式
  // 或
  deviceToken: "device-token"    // 设备 token 模式
}
```

### 4.3 HTTP 认证

```
Authorization: Bearer <token>
```

### 4.4 角色与权限

| 角色 | 说明 |
|------|------|
| `operator` | 完整操作权限（默认） |
| `browser` | 浏览器客户端（受限） |
| `node` | 节点角色 |

作用域（scopes）：
- `operator.admin`：管理员，绕过所有作用域检查
- `operator.approvals`：工具执行审批
- `operator.pairing`：设备配对管理

---

## 五、Session Key 格式

Session key 决定消息路由到哪个 Agent 会话：

```
main                          # 默认主会话
agent:<agentId>:main          # 指定 Agent 的主会话
agent:<agentId>:<scope>       # 指定 Agent 的特定作用域会话
telegram:<chatId>             # Telegram 渠道会话
discord:<channelId>           # Discord 渠道会话
```

握手后 `snapshot.sessionDefaults.mainSessionKey` 给出默认 session key。

---

## 六、Web 应用开发方案

### 6.1 技术选型

| 层次 | 推荐方案 | 说明 |
|------|----------|------|
| 框架 | React 18 + TypeScript | 生态成熟，类型安全 |
| 构建 | Vite | 快速 HMR，ESM 原生 |
| 状态管理 | Zustand | 轻量，适合 WebSocket 状态 |
| UI 组件 | shadcn/ui + Tailwind CSS | 可定制，无样式锁定 |
| WebSocket | 原生 WebSocket + 自定义 hook | 无需额外依赖 |
| Markdown 渲染 | react-markdown + rehype-highlight | Agent 回复通常含 Markdown |

### 6.2 项目结构

```
web-app/
├── src/
│   ├── gateway/
│   │   ├── client.ts          # WebSocket 客户端核心
│   │   ├── types.ts           # 协议类型定义
│   │   └── hooks.ts           # React hooks
│   ├── components/
│   │   ├── ChatWindow.tsx     # 聊天主界面
│   │   ├── MessageList.tsx    # 消息列表
│   │   ├── MessageInput.tsx   # 输入框
│   │   └── StatusBar.tsx      # 连接状态栏
│   ├── store/
│   │   └── chat.ts            # Zustand 状态
│   └── App.tsx
├── index.html
├── vite.config.ts
└── package.json
```

### 6.3 WebSocket 客户端核心实现

```typescript
// src/gateway/client.ts
import { randomUUID } from "crypto"; // 或 crypto.randomUUID()

type Frame =
  | { type: "req"; id: string; method: string; params?: unknown }
  | { type: "res"; id: string; ok: boolean; payload?: unknown; error?: ErrorShape }
  | { type: "event"; event: string; payload?: unknown; seq?: number };

type ErrorShape = {
  code: string;
  message: string;
  retryable?: boolean;
  retryAfterMs?: number;
};

type PendingRequest = {
  resolve: (payload: unknown) => void;
  reject: (error: ErrorShape) => void;
};

export class GatewayClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, PendingRequest>();
  private eventHandlers = new Map<string, Set<(payload: unknown) => void>>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private connId: string | null = null;

  constructor(
    private url: string,
    private token?: string,
  ) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);

      this.ws.onmessage = (e) => this.handleMessage(e.data);
      this.ws.onerror = () => reject(new Error("WebSocket error"));
      this.ws.onclose = () => this.scheduleReconnect();

      // connect.challenge 触发后发送 connect 请求
      this.once("connect.challenge", async () => {
        try {
          await this.request("connect", {
            minProtocol: 1,
            maxProtocol: 1,
            client: {
              id: "webchat",
              version: "1.0.0",
              platform: "web",
              mode: "webchat",
            },
            auth: this.token ? { token: this.token } : undefined,
          });
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    });
  }

  request(method: string, params?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      this.pending.set(id, { resolve, reject });
      this.send({ type: "req", id, method, params });
    });
  }

  on(event: string, handler: (payload: unknown) => void) {
    if (!this.eventHandlers.has(event)) {
      this.eventHandlers.set(event, new Set());
    }
    this.eventHandlers.get(event)!.add(handler);
    return () => this.eventHandlers.get(event)?.delete(handler);
  }

  once(event: string, handler: (payload: unknown) => void) {
    const off = this.on(event, (payload) => {
      off();
      handler(payload);
    });
  }

  private send(frame: Frame) {
    this.ws?.send(JSON.stringify(frame));
  }

  private handleMessage(data: string) {
    const frame = JSON.parse(data) as Frame;
    if (frame.type === "res") {
      const pending = this.pending.get(frame.id);
      if (pending) {
        this.pending.delete(frame.id);
        frame.ok ? pending.resolve(frame.payload) : pending.reject(frame.error!);
      }
    } else if (frame.type === "event") {
      this.eventHandlers.get(frame.event)?.forEach((h) => h(frame.payload));
    }
  }

  private scheduleReconnect() {
    this.reconnectTimer = setTimeout(() => this.connect(), 3000);
  }

  disconnect() {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
  }
}
```

### 6.4 React Hook

```typescript
// src/gateway/hooks.ts
import { useEffect, useRef, useState, useCallback } from "react";
import { GatewayClient } from "./client";

type Message = {
  id: string;
  role: "user" | "assistant";
  text: string;
  pending?: boolean;
};

export function useGatewayChat(url: string, token?: string) {
  const clientRef = useRef<GatewayClient | null>(null);
  const [connected, setConnected] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [sessionKey, setSessionKey] = useState("main");
  const pendingTextRef = useRef("");

  useEffect(() => {
    const client = new GatewayClient(url, token);
    clientRef.current = client;

    client.connect().then(() => {
      setConnected(true);
      // 从 hello-ok snapshot 获取默认 sessionKey
    });

    // 监听流式输出
    const offChat = client.on("chat", (payload: any) => {
      const { runId, state, message, seq } = payload;

      if (state === "delta") {
        const delta = message?.text ?? message?.content ?? "";
        pendingTextRef.current += delta;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.id === runId) {
            return [...prev.slice(0, -1), { ...last, text: pendingTextRef.current }];
          }
          return [...prev, { id: runId, role: "assistant", text: delta, pending: true }];
        });
      } else if (state === "final") {
        pendingTextRef.current = "";
        setMessages((prev) =>
          prev.map((m) =>
            m.id === runId
              ? { ...m, text: message?.text ?? m.text, pending: false }
              : m,
          ),
        );
      }
    });

    return () => {
      offChat();
      client.disconnect();
    };
  }, [url, token]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!clientRef.current || !connected) return;

      setMessages((prev) => [
        ...prev,
        { id: crypto.randomUUID(), role: "user", text },
      ]);

      await clientRef.current.request("chat.send", {
        sessionKey,
        message: text,
        idempotencyKey: crypto.randomUUID(),
      });
    },
    [connected, sessionKey],
  );

  return { connected, messages, sendMessage, sessionKey, setSessionKey };
}
```

### 6.5 聊天界面组件

```typescript
// src/components/ChatWindow.tsx
import { useGatewayChat } from "../gateway/hooks";
import ReactMarkdown from "react-markdown";
import { useState } from "react";

export function ChatWindow() {
  const { connected, messages, sendMessage } = useGatewayChat(
    "ws://localhost:18789",
    import.meta.env.VITE_GATEWAY_TOKEN,
  );
  const [input, setInput] = useState("");

  const handleSend = async () => {
    if (!input.trim()) return;
    await sendMessage(input.trim());
    setInput("");
  };

  return (
    <div className="flex flex-col h-screen">
      <div className="p-2 text-sm text-gray-500">
        {connected ? "● 已连接" : "○ 连接中..."}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[70%] rounded-lg p-3 ${
                msg.role === "user"
                  ? "bg-blue-500 text-white"
                  : "bg-gray-100 text-gray-900"
              } ${msg.pending ? "opacity-70" : ""}`}
            >
              <ReactMarkdown>{msg.text}</ReactMarkdown>
            </div>
          </div>
        ))}
      </div>

      <div className="p-4 border-t flex gap-2">
        <input
          className="flex-1 border rounded-lg px-3 py-2"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
          placeholder="输入消息..."
          disabled={!connected}
        />
        <button
          className="px-4 py-2 bg-blue-500 text-white rounded-lg disabled:opacity-50"
          onClick={handleSend}
          disabled={!connected || !input.trim()}
        >
          发送
        </button>
      </div>
    </div>
  );
}
```

### 6.6 环境配置

```bash
# .env
VITE_GATEWAY_URL=ws://localhost:18789
VITE_GATEWAY_TOKEN=your-token-here
```

### 6.7 关键注意事项

1. **幂等 key**：`chat.send` 必须传 `idempotencyKey`（UUID），防止重复提交。

2. **流式拼接**：`delta` 事件的 `message.text` 是增量文本，需要累加；`final` 事件给出完整文本。

3. **Session key**：从 `hello-ok` 的 `snapshot.sessionDefaults.mainSessionKey` 获取默认值（通常是 `"main"`）。

4. **重连**：WebSocket 断开后需自动重连并重新握手（重新发送 `connect` 请求）。

5. **CORS**：本地开发时 Gateway 默认绑定 loopback，需配置 Vite 代理或在 Gateway 配置中允许跨域。

6. **消息内容格式**：`chat` 事件的 `message` 字段结构取决于 Agent 输出，通常包含 `text` 字段，也可能包含 `content` 数组（多模态）。

---

## 七、Agent 执行步骤上报机制

### 7.1 整体架构

Agent 执行过程中的步骤上报通过一个进程内事件总线实现，链路如下：

```
Agent 执行层                    Gateway 层                    WebSocket 客户端
(pi-embedded-subscribe)         (server-chat.ts)
        |                              |                              |
  emitAgentEvent(evt)  ──────>  onAgentEvent(handler)               |
        |                              |                              |
        |                    createAgentEventHandler                  |
        |                              |                              |
        |                    broadcast("agent", payload) ──────────> event: agent
        |                              |                              |
        |                    broadcast("chat", payload)  ──────────> event: chat
```

核心模块：
- `src/infra/agent-events.ts`：进程内事件总线（`emitAgentEvent` / `onAgentEvent`）
- `src/agents/pi-embedded-subscribe.handlers.*.ts`：各阶段事件发射点
- `src/gateway/server-chat.ts`：`createAgentEventHandler`，将 agent 事件转换为 WebSocket 广播

### 7.2 AgentEventPayload 结构

```typescript
type AgentEventPayload = {
  runId: string;          // 运行 ID（与 chat.send 响应中的 runId 对应）
  seq: number;            // 严格递增序列号（进程内全局，按 runId 独立计数）
  stream: string;         // 事件流类型（见 7.3）
  ts: number;             // 时间戳（毫秒）
  data: Record<string, unknown>;  // 事件数据（按 stream 类型不同）
  sessionKey?: string;    // 关联的 session key
};
```

WebSocket 广播时封装为 `agent` 事件帧：

```typescript
{
  type: "event",
  event: "agent",
  payload: {
    runId: string,
    seq: number,
    stream: string,
    ts: number,
    sessionKey?: string,
    data: Record<string, unknown>
  }
}
```

### 7.3 stream 类型与 data 结构

#### lifecycle — 生命周期

Agent 运行的开始、结束、出错节点。

**phase: "start"** — Agent 开始执行
```typescript
{
  phase: "start",
  startedAt: number   // 毫秒时间戳
}
```

**phase: "end"** — Agent 正常结束
```typescript
{
  phase: "end",
  endedAt: number     // 毫秒时间戳
}
```

**phase: "error"** — Agent 出错结束
```typescript
{
  phase: "error",
  error: string,      // 错误描述文本
  endedAt: number
}
```

lifecycle 事件同时触发 `chat` 事件的 `final`/`error` 状态广播（见 3.5 节）。

#### assistant — 助手文本输出

LLM 生成文本的流式增量，是最高频的事件类型。

```typescript
{
  text: string,         // 当前累积的完整文本（单调递增）
  delta: string,        // 本次新增的增量文本
  mediaUrls?: string[]  // 媒体 URL（图片/文件，可选）
}
```

注意：`text` 是累积值，`delta` 是增量。Gateway 层对 `assistant` 事件做了 150ms 节流，并在 `lifecycle.end` 前强制 flush 一次，确保客户端收到完整文本。

#### tool — 工具调用

Agent 调用工具的完整生命周期，分三个 phase。

**phase: "start"** — 工具开始执行
```typescript
{
  phase: "start",
  name: string,         // 工具名，如 "exec"、"read"、"bash"
  toolCallId: string,   // 工具调用 ID（唯一标识一次调用）
  args: Record<string, unknown>  // 工具参数
}
```

**phase: "update"** — 工具执行中（流式部分结果）
```typescript
{
  phase: "update",
  name: string,
  toolCallId: string,
  partialResult: unknown  // 部分结果（verbose=full 时才包含）
}
```

**phase: "result"** — 工具执行完成
```typescript
{
  phase: "result",
  name: string,
  toolCallId: string,
  meta?: string,          // 工具元信息摘要（如命令预览）
  isError: boolean,       // 是否执行出错
  result: unknown         // 工具结果（verbose=full 时才包含完整内容）
}
```

工具事件的路由规则：
- 只发送给注册了 `tool-events` capability 的 WebSocket 连接（`broadcastToConnIds`）
- 非 verbose 模式下，`result` 和 `partialResult` 字段会被剥除，只保留元数据
- 客户端需在 `connect` 请求的 `caps` 中声明 `"tool-events"` 才能收到工具事件

#### thinking — 思考过程（推理模型）

仅在使用支持 extended thinking 的模型（如 Claude 3.7）时出现。

```typescript
{
  text: string,   // 当前累积的完整思考文本
  delta: string   // 本次新增的增量
}
```

#### compaction — 上下文压缩

当会话上下文接近模型 token 上限时触发自动压缩。

**phase: "start"**
```typescript
{ phase: "start" }
```

**phase: "end"**
```typescript
{
  phase: "end",
  willRetry: boolean,   // 是否会重试 LLM 请求（overflow 触发时为 true）
  completed: boolean    // 压缩是否成功完成
}
```

#### error — 序列号异常

当 Gateway 检测到 agent 事件序列号不连续时广播，用于客户端诊断。

```typescript
{
  reason: "seq gap",
  expected: number,
  received: number
}
```

### 7.4 完整执行时序

一次典型的 Agent 执行，WebSocket 客户端收到的事件序列：

```
← event: agent  { stream: "lifecycle", data: { phase: "start", startedAt: ... } }

← event: agent  { stream: "tool", data: { phase: "start", name: "read", toolCallId: "tc-1", args: {...} } }
← event: agent  { stream: "tool", data: { phase: "result", name: "read", toolCallId: "tc-1", isError: false } }

← event: agent  { stream: "assistant", data: { text: "根据", delta: "根据" } }
← event: chat   { state: "delta", message: { role: "assistant", content: [{ type: "text", text: "根据" }] } }

← event: agent  { stream: "assistant", data: { text: "根据文件内容，", delta: "文件内容，" } }
← event: chat   { state: "delta", message: { role: "assistant", content: [{ type: "text", text: "根据文件内容，" }] } }

← event: agent  { stream: "tool", data: { phase: "start", name: "exec", toolCallId: "tc-2", args: {...} } }
← event: agent  { stream: "tool", data: { phase: "update", name: "exec", toolCallId: "tc-2", partialResult: "..." } }
← event: agent  { stream: "tool", data: { phase: "result", name: "exec", toolCallId: "tc-2", isError: false } }

← event: agent  { stream: "assistant", data: { text: "根据文件内容，执行结果如下：...", delta: "执行结果如下：..." } }
← event: chat   { state: "delta", message: { role: "assistant", content: [{ type: "text", text: "根据文件内容，执行结果如下：..." }] } }

← event: agent  { stream: "lifecycle", data: { phase: "end", endedAt: ... } }
← event: chat   { state: "final", message: { role: "assistant", content: [{ type: "text", text: "根据文件内容，执行结果如下：..." }] } }
```

### 7.5 agent 事件与 chat 事件的关系

| 维度 | `agent` 事件 | `chat` 事件 |
|------|-------------|------------|
| 内容 | 完整执行步骤（工具、生命周期、思考等） | 仅助手文本输出 |
| 触发源 | 所有 stream 类型 | 仅 `assistant` stream 和 `lifecycle` end/error |
| 节流 | 无 | 150ms 节流（delta），final 无节流 |
| 接收方 | 声明 `tool-events` cap 的连接（工具事件）；全部连接（其他） | 全部连接 |
| 用途 | 展示执行步骤、工具调用详情 | 展示对话文本 |

### 7.6 客户端接收工具事件

要接收工具事件，`connect` 请求需声明 capability：

```typescript
{
  type: "req",
  id: "1",
  method: "connect",
  params: {
    minProtocol: 1,
    maxProtocol: 1,
    client: {
      id: "webchat",
      version: "1.0.0",
      platform: "web",
      mode: "webchat"
    },
    caps: ["tool-events"],   // ← 声明需要工具事件
    auth: { token: "..." }
  }
}
```

### 7.7 Web 应用中渲染执行步骤

```typescript
// 监听 agent 事件，渲染执行步骤
client.on("agent", (payload: any) => {
  const { runId, stream, data, ts } = payload;

  switch (stream) {
    case "lifecycle":
      if (data.phase === "start") {
        addStep(runId, { type: "start", ts });
      } else if (data.phase === "end") {
        addStep(runId, { type: "done", ts });
      } else if (data.phase === "error") {
        addStep(runId, { type: "error", message: data.error, ts });
      }
      break;

    case "tool":
      if (data.phase === "start") {
        addStep(runId, {
          type: "tool-start",
          name: data.name,
          toolCallId: data.toolCallId,
          args: data.args,
          ts,
        });
      } else if (data.phase === "result") {
        updateStep(runId, data.toolCallId, {
          type: "tool-done",
          isError: data.isError,
          meta: data.meta,
          ts,
        });
      }
      break;

    case "thinking":
      updateThinking(runId, data.text);
      break;

    case "compaction":
      if (data.phase === "start") {
        addStep(runId, { type: "compacting", ts });
      }
      break;
  }
});
```

---

## 八、快速验证

用浏览器控制台测试连接：

```javascript
const ws = new WebSocket("ws://localhost:18789");
ws.onmessage = (e) => console.log("←", JSON.parse(e.data));

// 收到 connect.challenge 后发送 connect
ws.onmessage = (e) => {
  const frame = JSON.parse(e.data);
  if (frame.event === "connect.challenge") {
    ws.send(JSON.stringify({
      type: "req", id: "1", method: "connect",
      params: {
        minProtocol: 1, maxProtocol: 1,
        client: { id: "webchat", version: "1.0.0", platform: "web", mode: "webchat" }
      }
    }));
  }
  console.log("←", frame);
};

// 连接成功后发送消息
function chat(msg) {
  ws.send(JSON.stringify({
    type: "req", id: crypto.randomUUID(), method: "chat.send",
    params: { sessionKey: "main", message: msg, idempotencyKey: crypto.randomUUID() }
  }));
}
```
