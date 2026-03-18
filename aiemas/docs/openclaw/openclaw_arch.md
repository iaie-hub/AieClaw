# OpenClaw 代码结构分析

> 版本：2026.3.10 | 仓库：https://github.com/openclaw/openclaw

## 项目概述

OpenClaw 是一个多渠道 AI 网关，支持将 AI agent 接入 Telegram、Discord、Slack、WhatsApp、iMessage 等 30+ 消息平台。核心用 TypeScript ESM 编写，支持 Node 22+ 和 Bun 双运行时。

---

## 顶层目录结构

| 目录 | 说明 |
|------|------|
| `src/` | 主源码，按功能模块划分 |
| `extensions/` | 渠道插件（30+ 个） |
| `apps/` | 原生客户端（iOS / Android / macOS） |
| `skills/` | AI 技能包（50+ 个） |
| `ui/` | Web 控制台（Vite + Lit） |
| `packages/` | 内部包（clawdbot、moltbot） |
| `docs/` | Mintlify 文档站 |
| `scripts/` | 构建、发布、CI 脚本 |
| `test/` | 全局测试辅助和 e2e 测试 |
| `vendor/` | 本地 vendor（a2ui） |

---

## src/ 核心模块

### Agent 系统（`src/agents/`）

最大的模块，包含 AI agent 的完整生命周期：

- **模型管理**：`model-catalog.ts`、`model-selection.ts`、`model-auth.ts`、`model-fallback.ts`
- **会话管理**：`session-dirs.ts`、`session-write-lock.ts`、`session-transcript-repair.ts`
- **工具系统**：`pi-tools.ts`、`tool-catalog.ts`、`tool-policy.ts`、`tool-mutation.ts`
- **沙箱**：`sandbox.ts`、`sandbox-paths.ts`、`sandbox-skills.ts`
- **Skills**：`skills.ts`、`skills-install.ts`、`skills-status.ts`
- **子 agent**：`subagent-registry.ts`、`subagent-spawn.ts`、`subagent-announce.ts`
- **压缩/上下文**：`compaction.ts`、`context-window-guard.ts`、`bootstrap-cache.ts`
- **多提供商支持**：Anthropic、OpenAI、Gemini、Ollama、Bedrock、HuggingFace 等

### 网关（`src/gateway/`）

WebSocket + HTTP 服务器，是所有渠道的接入点：

- `server.ts` / `server.impl.ts` — 主服务器
- `server-http.ts` — HTTP 端点
- `server-chat.ts` — 聊天消息处理
- `server-channels.ts` — 渠道管理
- `server-cron.ts` — 定时任务
- `auth.ts`、`connection-auth.ts` — 认证
- `control-ui.ts` — Web 控制台路由
- `openai-http.ts`、`openresponses-http.ts` — OpenAI 兼容 API

### 渠道抽象（`src/channels/`）

渠道无关的通用逻辑：

- `session.ts` — 会话管理
- `allowlist-match.ts`、`allow-from.ts` — 访问控制
- `typing.ts`、`draft-stream-controls.ts` — 打字状态和流式输出
- `command-gating.ts`、`mention-gating.ts` — 命令和 @ 提及门控

### 内置渠道实现

| 模块 | 渠道 |
|------|------|
| `src/telegram/` | Telegram Bot |
| `src/discord/` | Discord |
| `src/slack/` | Slack |
| `src/signal/` | Signal |
| `src/imessage/` | iMessage |
| `src/web/` | WhatsApp Web |
| `src/line/` | LINE |

### 自动回复（`src/auto-reply/`）

消息调度和回复逻辑：

- `dispatch.ts` — 消息分发
- `reply.ts` — 回复构建
- `commands-registry.ts` — 命令注册
- `skill-commands.ts` — Skill 命令处理
- `thinking.ts` — 思考模式控制

### CLI（`src/cli/`）

命令行工具入口，每个子命令对应一个文件：

- `program.ts` — Commander 主程序
- `gateway-cli.ts`、`channels-cli.ts`、`models-cli.ts` 等
- `progress.ts` — 使用 `osc-progress` + `@clack/prompts` 的进度显示

### 命令实现（`src/commands/`）

具体命令逻辑（onboard、configure、status、backup、doctor 等）。

### 配置系统（`src/config/`）

- `schema.ts`、`zod-schema.ts` — Zod 配置 schema
- `config.ts` — 配置读写
- `legacy-migrate.ts` — 历史配置迁移
- `types.*.ts` — 各模块类型定义

### 基础设施（`src/infra/`）

底层工具：进程管理、网络、文件系统、更新、心跳、exec 审批、Tailscale、bonjour 等。

### 其他模块

| 模块 | 说明 |
|------|------|
| `src/plugin-sdk/` | 插件 SDK，对外暴露多个子路径 |
| `src/memory/` | 向量记忆 / 嵌入系统（SQLite-vec、LanceDB） |
| `src/browser/` | Playwright 浏览器自动化 |
| `src/media/` | 媒体处理管道（音视频、图片、PDF） |
| `src/hooks/` | 消息 Hook 系统 |
| `src/cron/` | 定时任务服务 |
| `src/acp/` | Agent Client Protocol |
| `src/tts/` | 文字转语音 |
| `src/tui/` | 终端 UI |
| `src/terminal/` | ANSI、表格、调色板等终端工具 |
| `src/secrets/` | 密钥管理和 secret-ref 系统 |
| `src/security/` | 安全审计和策略 |
| `src/pairing/` | 设备配对 |
| `src/routing/` | 消息路由和账号绑定 |

---

## extensions/ 渠道插件

每个插件结构：`index.ts` + `openclaw.plugin.json` + 可选 `package.json`、`src/`。

| 插件 | 渠道 |
|------|------|
| `extensions/telegram/` | Telegram（扩展版） |
| `extensions/discord/` | Discord（扩展版） |
| `extensions/slack/` | Slack（扩展版） |
| `extensions/signal/` | Signal |
| `extensions/matrix/` | Matrix |
| `extensions/msteams/` | Microsoft Teams |
| `extensions/whatsapp/` | WhatsApp |
| `extensions/feishu/` | 飞书 |
| `extensions/googlechat/` | Google Chat |
| `extensions/line/` | LINE |
| `extensions/irc/` | IRC |
| `extensions/nostr/` | Nostr |
| `extensions/tlon/` | Tlon |
| `extensions/twitch/` | Twitch |
| `extensions/zalo/` | Zalo |
| `extensions/voice-call/` | 语音通话 |
| `extensions/memory-core/` | 记忆核心 |
| `extensions/memory-lancedb/` | LanceDB 记忆后端 |
| `extensions/llm-task/` | LLM 任务 |
| `extensions/diffs/` | Diff 工具 |
| `extensions/lobster/` | Lobster UI |

---

## apps/ 原生客户端

| 目录 | 平台 | 技术栈 |
|------|------|--------|
| `apps/ios/` | iOS | Swift / SwiftUI（`@Observable` 框架） |
| `apps/android/` | Android | Kotlin / Gradle |
| `apps/macos/` | macOS | SwiftUI（menubar 应用，含 Sparkle 自动更新） |
| `apps/shared/` | 共享 | OpenClawKit Swift 库 |

---

## skills/ AI 技能包

50+ 个技能，每个包含 `SKILL.md`（描述、用法、命令示例）。部分技能有独立的 MCP server 或 CLI 工具依赖。

代表性技能：`github`、`weather`、`spotify-player`、`obsidian`、`notion`、`peekaboo`、`canvas`、`coding-agent`、`tmux`、`slack`、`discord` 等。

---

## 技术栈总结

| 类别 | 技术 |
|------|------|
| 语言 | TypeScript ESM，严格模式，无 `any` |
| 运行时 | Node 22+ / Bun（双路径） |
| 包管理 | pnpm 10 workspace |
| 构建 | tsdown |
| 测试 | Vitest（unit / gateway / e2e / live / channels） |
| Lint | Oxlint（type-aware） |
| Format | Oxfmt |
| Web UI | Vite + Lit + Signals |
| 配置 schema | Zod |
| 类型工具 | TypeBox（工具 schema） |
| 进度/提示 | osc-progress + @clack/prompts |
| 表格/ANSI | `src/terminal/table.ts`、`src/terminal/palette.ts` |

---

## 构建与开发命令

```bash
pnpm install          # 安装依赖
pnpm build            # 完整构建
pnpm tsgo             # TypeScript 类型检查
pnpm check            # lint + format + 自定义检查
pnpm test             # 运行测试（并行）
pnpm openclaw ...     # 开发模式运行 CLI
```

---

## 版本位置

版本号需在以下位置同步更新：

- `package.json`（CLI）
- `apps/android/app/build.gradle.kts`（versionName/versionCode）
- `apps/ios/Sources/Info.plist` + `apps/ios/Tests/Info.plist`
- `apps/macos/Sources/OpenClaw/Resources/Info.plist`
- `docs/install/updating.md`（pinned npm 版本）


---

## 聊天完整流程分析（发送消息调用链）

> 入口：Web 控制台聊天界面用户点击 Send 按钮或按 Enter 键

### 一、前端调用链

```
用户输入 → 按 Enter / 点击 Send 按钮
  └─ ui/src/ui/views/chat.ts: renderChat()
       textarea @keydown / button @click → props.onSend()
         └─ ui/src/ui/app.ts: OpenClawApp.handleSendChat()
              └─ ui/src/ui/app-chat.ts: handleSendChat(host)
                   ├─ 检查 isChatStopCommand() → 若是 stop 命令则调用 handleAbortChat()
                   ├─ 检查 isChatBusy() → 若正在发送则 enqueueChatMessage() 入队
                   └─ sendChatMessageNow(host, message, opts)
                        ├─ resetToolStream()  // 清空上一次工具流状态
                        └─ controllers/chat.ts: sendChatMessage(state, message, attachments)
                             ├─ 构建 user message content blocks（text + image）
                             ├─ 追加到 state.chatMessages（乐观更新 UI）
                             ├─ 生成 runId = generateUUID()
                             ├─ 设置 state.chatStream = ""（开始流式状态）
                             └─ gateway.ts: client.request("chat.send", {
                                  sessionKey, message, deliver: false,
                                  idempotencyKey: runId, attachments
                                })
```

### 二、WebSocket 传输层

```
ui/src/ui/gateway.ts: GatewayBrowserClient.request("chat.send", params)
  ├─ 生成 id = generateUUID()
  ├─ 发送 JSON 帧: { type: "req", id, method: "chat.send", params }
  └─ 返回 Promise，等待服务端 { type: "res", id, ok, payload } 响应

连接建立流程（首次）:
  WebSocket open → queueConnect() → 等待 connect.challenge 事件
    → sendConnect() → request("connect", { device, auth, caps: ["tool-events"], ... })
    → 服务端返回 hello-ok → onHello() → host.connected = true
```

### 三、服务端处理链

```
src/gateway/server-methods.ts: handleGatewayRequest()
  └─ 路由到 chatHandlers["chat.send"]
       (src/gateway/server-methods/chat.ts)

chat.send handler 执行步骤:
  1. validateChatSendParams(params)          // Zod schema 校验
  2. sanitizeChatSendMessageInput(message)   // NFC 规范化 + 控制字符过滤
  3. parseMessageWithAttachments()           // 解析图片附件（若有）
  4. loadSessionEntry(sessionKey)            // 加载会话配置和 entry
  5. resolveSendPolicy()                     // 检查发送策略（deny/allow）
  6. isChatStopCommandText() → 若是 stop 则 abortChatRunsForSessionKey()
  7. context.dedupe.get() → 幂等性检查（防重复提交）
  8. new AbortController() → 注册到 chatAbortControllers
  9. respond(true, { runId, status: "started" }) // 立即 ACK 前端
  10. 构建 MsgContext: { Body, BodyForAgent, SessionKey, OriginatingChannel, ... }
  11. injectTimestamp(messageForAgent)        // 注入当前时间戳
  12. createReplyDispatcher()                 // 创建回复分发器
  13. void dispatchInboundMessage({ ctx, cfg, dispatcher, replyOptions })
      // 异步启动，不阻塞 respond
```

### 四、Agent 调度链

```
src/auto-reply/dispatch.ts: dispatchInboundMessage()
  └─ finalizeInboundContext(ctx)             // 补全 MsgContext 字段
       └─ withReplyDispatcher({ dispatcher, run: () =>
            dispatchReplyFromConfig({ ctx, cfg, dispatcher })
          })
            └─ src/auto-reply/reply/dispatch-from-config.ts
                 └─ getReplyFromConfig() / agent.run()
                      ├─ 命令路由（/think、/new 等）
                      ├─ 模型选择（resolveSessionModelRef）
                      ├─ 工具调用循环（Pi coding agent）
                      └─ 流式输出 → onAgentRunStart(runId) 回调
                           └─ 注册 toolEventRecipient（WS 连接 ID）
```

### 五、流式响应回流链

```
Agent 产生 assistant text delta:
  src/infra/agent-events.ts: emit AgentEventPayload { stream: "assistant", data: { text, delta } }
    └─ src/gateway/server-chat.ts: createAgentEventHandler() 返回的处理函数
         └─ emitChatDelta(sessionKey, clientRunId, runId, seq, text, delta)
              ├─ resolveMergedAssistantText()  // 合并增量文本
              ├─ 节流：距上次广播 < 150ms 则跳过
              └─ broadcast("chat", {
                   runId, sessionKey, seq,
                   state: "delta",
                   message: { role: "assistant", content: [{ type: "text", text }] }
                 })

Agent 完成（lifecycle phase = "end"):
  └─ emitChatFinal(sessionKey, clientRunId, runId, seq, "done")
       ├─ flushBufferedChatDeltaIfNeeded()   // 刷出最后一个被节流的 delta
       └─ broadcast("chat", { runId, sessionKey, seq, state: "final", message })

广播路径:
  context.broadcast("chat", payload)         // 广播给所有 WS 连接
  context.nodeSendToSession(sessionKey, ...)  // 发送给节点订阅者
```

### 六、前端接收与 UI 更新

```
ui/src/ui/gateway.ts: GatewayBrowserClient.handleMessage()
  └─ 解析 JSON 帧 { type: "event", event: "chat", payload }
       └─ opts.onEvent(evt)
            └─ ui/src/ui/app-gateway.ts: handleGatewayEvent()
                 └─ handleGatewayEventUnsafe()
                      └─ evt.event === "chat" → handleChatGatewayEvent(host, payload)
                           ├─ setLastActiveSessionKey()
                           └─ controllers/chat.ts: handleChatEvent(state, payload)
                                ├─ state === "delta":
                                │    extractText(payload.message) → state.chatStream = text
                                │    (Lit reactive property → 触发 renderChat() 重渲染)
                                ├─ state === "final":
                                │    state.chatMessages = [...chatMessages, finalMessage]
                                │    state.chatStream = null
                                │    state.chatRunId = null
                                └─ state === "error" / "aborted":
                                     清空流状态，追加错误/中断消息

handleTerminalChatEvent() (final/error/aborted):
  ├─ resetToolStream()                       // 清空工具流
  ├─ flushChatQueueForEvent()                // 处理队列中的下一条消息
  └─ 若有工具事件 → loadChatHistory()        // 重新加载历史（含工具结果）
```

### 七、关键数据结构

**WebSocket 帧格式（JSON-RPC 风格）：**
```typescript
// 请求帧
{ type: "req", id: string, method: string, params: unknown }

// 响应帧
{ type: "res", id: string, ok: boolean, payload?: unknown, error?: { code, message } }

// 事件帧
{ type: "event", event: string, payload?: unknown, seq?: number }
```

**chat.send 请求参数：**
```typescript
{
  sessionKey: string,
  message: string,
  deliver: false,           // false = 不转发到外部渠道
  idempotencyKey: string,   // = runId，用于幂等性
  attachments?: Array<{ type, mimeType, content }>
}
```

**chat 事件 payload：**
```typescript
{
  runId: string,
  sessionKey: string,
  seq: number,
  state: "delta" | "final" | "aborted" | "error",
  message?: { role: "assistant", content: [{ type: "text", text: string }], timestamp: number },
  errorMessage?: string,
  stopReason?: string
}
```

### 八、完整时序图

```
前端                    WebSocket              服务端 chat.send         Agent
 │                          │                        │                    │
 │── onSend() ─────────────►│── { type:"req",        │                    │
 │                          │    method:"chat.send" }►│                    │
 │                          │                        │── validate ────────│
 │                          │                        │── sanitize ────────│
 │                          │                        │── loadSessionEntry─│
 │                          │◄── { type:"res",        │                    │
 │◄── Promise resolves ─────│    ok:true,             │                    │
 │    chatSending=false      │    payload:{status:     │                    │
 │                          │    "started"} }         │                    │
 │                          │                        │── dispatchInbound──►│
 │                          │                        │   (async, void)     │── 模型推理
 │                          │                        │                    │── 工具调用
 │◄── { event:"chat",       │◄── broadcast("chat",   │◄── AgentEvent      │
 │     state:"delta" } ─────│    delta payload }      │    (assistant text)│
 │    chatStream 更新        │                        │                    │
 │    UI 重渲染              │                        │                    │
 │◄── { event:"chat",       │◄── broadcast("chat",   │◄── AgentEvent      │
 │     state:"final" } ─────│    final payload }      │    (lifecycle:end) │
 │    chatMessages 追加      │                        │                    │
 │    chatStream = null      │                        │                    │
```


---

## Agent 路由与执行详细分析

> 入口：`src/gateway/server-methods/chat.ts` 中 `chat.send` handler 调用 `dispatchInboundMessage()`

### 一、消息分发入口（dispatch-from-config.ts）

`dispatchReplyFromConfig()` 是所有渠道消息的统一分发入口：

```
dispatchInboundMessage({ ctx, cfg, dispatcher })
  └─ finalizeInboundContext(ctx)          // 补全 MsgContext 字段
       └─ withReplyDispatcher({ dispatcher, run: () =>
            dispatchReplyFromConfig({ ctx, cfg, dispatcher })
          })
```

`dispatchReplyFromConfig()` 执行步骤：

1. `shouldSkipDuplicateInbound(ctx)` — 幂等性检查，跳过重复消息
2. `resolveSessionStoreLookup()` — 加载 session store entry（含 TTS 配置）
3. 触发插件 hooks（`message_received`，fire-and-forget）
4. 触发内部 hooks（`message.received`，fire-and-forget）
5. 解析路由方向：`shouldRouteToOriginating` — 判断是否需要跨渠道回复
6. `tryFastAbortFromMessage()` — 快速 abort 检测（stop 命令）
7. `resolveSendPolicy()` — 检查 session 发送策略（deny/allow）
8. `tryDispatchAcpReply()` — ACP 协议优先路由（若适用）
9. 调用 `getReplyFromConfig(ctx, opts, cfg)` — 核心 agent 执行
10. 对回复应用 TTS，通过 dispatcher 或 `routeReply()` 发送

---

### 二、Agent 选择（agent-scope.ts）

**Agent ID 解析优先级：**

```
resolveSessionAgentId({ sessionKey, config })
  ├─ 1. 解析 sessionKey 格式：agent:{agentId}:{rest}
  │       parseAgentSessionKey("agent:coder:main") → { agentId: "coder", rest: "main" }
  ├─ 2. 若 sessionKey 无 agentId → resolveDefaultAgentId(cfg)
  │       ├─ cfg.agents.list 中第一个 default=true 的 entry
  │       └─ 否则取 list[0]，再否则 "main"
  └─ 3. normalizeAgentId() — 小写 + trim
```

**Agent 配置加载：**

```
resolveAgentConfig(cfg, agentId)
  └─ 从 cfg.agents.list 中找 id 匹配的 entry，返回：
       { name, workspace, agentDir, model, skills,
         memorySearch, humanDelay, heartbeat, identity,
         groupChat, subagents, sandbox, tools }

resolveAgentWorkspaceDir(cfg, agentId)
  └─ entry.workspace → 展开 ~ → 绝对路径
     否则 ~/.openclaw/workspace-{agentId}

resolveAgentDir(cfg, agentId)
  └─ entry.agentDir → 展开 ~
     否则 ~/.openclaw/agents/{agentId}/agent
```

---

### 三、模型选择（model-selection.ts + get-reply.ts）

**模型解析优先级（从高到低）：**

```
1. session-level override:  sessionEntry.modelOverride / providerOverride
2. channel-level override:  cfg.channels[provider].modelOverride
3. heartbeat override:      opts.heartbeatModelOverride / cfg.agents.defaults.heartbeat.model
4. agent-level model:       cfg.agents.list[agentId].model
5. global default:          cfg.agents.defaults.model  (DEFAULT_PROVIDER/DEFAULT_MODEL)
```

**模型字符串解析：**

```
resolveModelRefFromString("anthropic/claude-sonnet-4-6")
  → { provider: "anthropic", model: "claude-sonnet-4-6" }

resolveModelRefFromString("sonnet-4.6")   // 别名
  → { provider: "anthropic", model: "claude-sonnet-4-6" }

normalizeProviderId("z.ai")     → "zai"
normalizeProviderId("bedrock")  → "amazon-bedrock"
normalizeProviderId("doubao")   → "volcengine"
```

**Thinking Level 解析：**

```
resolveThinkingDefault({ cfg, provider, model, catalog })
  ├─ Claude 4.6 系列 → "adaptive"
  ├─ cfg.agents.defaults.thinkingLevel → 全局默认
  └─ 模型 catalog 中 reasoning 能力 → "low"
```

**Fallback 链：**

```
resolveEffectiveModelFallbacks(cfg, agentId)
  ├─ cfg.agents.list[agentId].model.fallbacks
  └─ cfg.agents.defaults.model.fallbacks

runAgentTurnWithFallback() 中：
  while (true) {
    try { runEmbeddedPiAgent(...) }
    catch (rate_limit | auth_error) {
      fallbackProvider = fallbacks[attempt].provider
      fallbackModel    = fallbacks[attempt].model
      // 继续循环，通知前端 fallback 状态
    }
  }
```

---

### 四、Skill 选择与加载（skills/workspace.ts）

#### 4.1 Skill Filter 合并

```
getReplyFromConfig() 中：
  mergeSkillFilters(
    opts.skillFilter,                    // 渠道级 filter（来自 chat.send 调用方）
    resolveAgentSkillsFilter(cfg, agentId)  // agent 级 filter（cfg.agents.list[].skills）
  )
  ├─ 两者均 undefined → undefined（不过滤，所有 skill 可用）
  ├─ 一方 undefined → 取另一方
  ├─ 两者均为空数组 → []（无 skill）
  └─ 两者均有值 → 取交集（intersection）
```

#### 4.2 Skill 发现（loadSkillEntries）

扫描以下目录，按优先级合并（后者覆盖前者）：

```
优先级（低 → 高）：
  1. cfg.skills.load.extraDirs + plugin skill dirs  (source: "openclaw-extra")
  2. ~/.openclaw/skills/                            (source: "openclaw-bundled")
  3. ~/.openclaw/skills/ (managed)                  (source: "openclaw-managed")
  4. ~/.agents/skills/                              (source: "agents-skills-personal")
  5. {workspaceDir}/.agents/skills/                 (source: "agents-skills-project")
  6. {workspaceDir}/skills/                         (source: "openclaw-workspace")
```

每个目录扫描逻辑：
- 检测 `skills/` 子目录（嵌套 root 自动检测）
- 每个子目录若有 `SKILL.md` 则视为一个 skill
- 文件大小限制：默认 256KB/skill，最多 200 个/来源，最多 150 个进入 prompt
- 路径安全检查：symlink 不能逃逸出 root 目录

#### 4.3 Skill 过滤（filterSkillEntries）

```
filterSkillEntries(entries, config, skillFilter, eligibility)
  ├─ shouldIncludeSkill() — 检查：
  │    ├─ metadata.os — 平台匹配
  │    ├─ metadata.requires.bins — 二进制依赖存在
  │    ├─ metadata.requires.env — 环境变量存在
  │    ├─ metadata.requires.config — 配置项存在
  │    ├─ isBundledSkillAllowed() — bundled skill 白名单
  │    └─ eligibility.remote — 远程 skill 平台兼容性
  └─ skillFilter 白名单过滤（若有）
```

#### 4.4 Skill Snapshot 构建

```
buildWorkspaceSkillSnapshot(workspaceDir, opts)
  └─ resolveWorkspaceSkillPromptState()
       ├─ loadSkillEntries()         // 发现所有 skill
       ├─ filterSkillEntries()       // 过滤
       ├─ applySkillsPromptLimits()  // 截断（默认 30,000 字符）
       └─ formatSkillsForPrompt()    // 格式化为 agent 可读的 prompt 文本

SkillSnapshot = {
  prompt: string,          // 注入 agent system prompt 的 skill 描述文本
  skills: [{ name, primaryEnv, requiredEnv }],
  skillFilter?: string[],  // 应用的过滤器
  resolvedSkills: Skill[], // 完整 skill 对象（含 baseDir、filePath）
  version?: number
}
```

#### 4.5 Skill Snapshot 缓存策略

```
ensureSkillSnapshot() 中：
  ├─ 首次 turn（isFirstTurnInSession=true）→ 强制重建 snapshot
  ├─ sessionEntry.skillsSnapshot 存在且 filter 未变 → 复用缓存
  └─ 重建后写入 sessionEntry.skillsSnapshot（持久化到 session store）
```

---

### 五、Agent 执行（get-reply-run.ts → agent-runner-execution.ts）

#### 5.1 执行前准备（runPreparedReply）

```
runPreparedReply(params)
  ├─ 构建 extraSystemPromptParts:
  │    ├─ inboundMetaPrompt（消息元信息）
  │    ├─ groupChatContext（群聊上下文，若适用）
  │    ├─ groupIntro（首次激活介绍）
  │    └─ groupSystemPrompt（群聊系统提示）
  ├─ ensureSkillSnapshot() → 获取/刷新 skillsSnapshot
  ├─ resolveThinkLevel() → 确定思考级别
  ├─ 构建 followupRun.run 对象（含所有 agent 运行参数）
  └─ runReplyAgent() → 进入队列/执行
```

#### 5.2 队列与执行模式

```
resolveQueueSettings() → resolvedQueue.mode:
  ├─ "immediate"     — 直接执行（默认）
  ├─ "followup"      — 追加到当前 run 的 followup 队列
  ├─ "steer"         — 注入 steering 消息到正在运行的 agent
  ├─ "steer-backlog" — steer + 追加 followup
  ├─ "collect"       — 收集多条消息后批量发送
  └─ "interrupt"     — 中断当前 run，立即执行新消息

runReplyAgent() 中：
  if (shouldSteer && isActive)   → steerEmbeddedPiRun()
  elif (shouldFollowup && isActive) → enqueueFollowupRun()
  else → runAgentTurnWithFallback()
```

#### 5.3 Agent 实际执行（runAgentTurnWithFallback）

```
runAgentTurnWithFallback(params)
  ├─ registerAgentRunContext(runId, { sessionKey, verboseLevel, isHeartbeat })
  ├─ notifyAgentRunStart() → opts.onAgentRunStart(runId)
  │    └─ 服务端注册 toolEventRecipient（WS 连接 ID）
  └─ while (true):  // fallback 循环
       runEmbeddedPiAgent({
         prompt: prefixedCommandBody,
         sessionFile,           // ~/.openclaw/sessions/{agentId}/{sessionId}.jsonl
         workspaceDir,
         skillsSnapshot,        // 包含 skill prompt 和 resolvedSkills
         provider, model,
         thinkLevel,
         extraSystemPrompt,
         abortSignal,
         onPartialReply(payload) → emitChatDelta → broadcast("chat", delta)
         onBlockReply(payload)  → dispatcher.sendBlockReply()
         onToolResult(payload)  → dispatcher.sendToolResult()
         onAgentEvent(evt)      → broadcast("agent", evt)
       })
       catch (rate_limit | transient_http) → 切换 fallback model，continue
```

#### 5.4 Pi Agent 工具循环（@mariozechner/pi-coding-agent）

```
runEmbeddedPiAgent() 内部（Pi coding agent 库）：
  1. 加载 session transcript（JSONL 格式）
  2. 构建 system prompt：
       ├─ 基础 system prompt（agent 身份、能力）
       ├─ skillsSnapshot.prompt（skill 描述）
       └─ extraSystemPrompt（群聊上下文、元信息等）
  3. 发送 user message 到 LLM API
  4. 接收流式响应：
       ├─ text delta → onPartialReply({ text })
       └─ tool_use block → 进入工具调用循环
  5. 工具调用循环：
       ├─ 解析 tool_name + tool_input
       ├─ 执行工具（bash、read_file、write_file、skill 命令等）
       ├─ onToolResult({ text: tool_output })
       └─ 将 tool_result 追加到 transcript，继续下一轮 LLM 调用
  6. 生命周期事件：
       ├─ { stream: "lifecycle", data: { phase: "start" } }
       ├─ { stream: "assistant", data: { text, delta } }  // 文本 delta
       ├─ { stream: "tool", data: { phase: "start"|"result", ... } }
       └─ { stream: "lifecycle", data: { phase: "end"|"error" } }
```

---

### 六、Skill 命令执行（skill-commands.ts）

#### 6.1 Skill 命令注册

```
buildWorkspaceSkillCommandSpecs(workspaceDir, opts)
  ├─ loadSkillEntries() → filterSkillEntries()
  ├─ 过滤 userInvocable=true 的 skill
  ├─ sanitizeSkillCommandName(skill.name) → 规范化为 /command 格式
  │    ├─ 小写 + 非字母数字替换为 _
  │    └─ 最长 32 字符
  ├─ resolveUniqueSkillCommandName() → 去重（加 _2、_3 后缀）
  └─ 读取 SKILL.md frontmatter 中的 command-dispatch 字段

SkillCommandSpec = {
  name: string,          // 命令名（不含 /）
  skillName: string,     // 原始 skill 名
  description: string,   // 来自 skill.description（≤100字符）
  dispatch?: {
    kind: "tool",
    toolName: string,    // 直接调用的工具名
    argMode?: "raw"
  }
}
```

#### 6.2 Skill 命令调度

```
用户输入 "/github list issues"
  └─ resolveReplyDirectives() 中：
       listSkillCommandsForWorkspace() → skillCommands[]
       detectCommand("/github list issues", skillCommands)
         → { key: "skill:github", args: "list issues" }

两种执行路径：
  A. dispatch.kind === "tool"（直接工具调用）：
       → 跳过 agent，直接调用 toolName 对应的工具
       → 工具输出作为 reply 返回

  B. 无 dispatch（默认，通过 agent）：
       → 将 "/github list issues" 作为 commandBody 传给 agent
       → agent 识别 skill 命令，调用对应工具
       → 工具执行 skill 的 SKILL.md 中定义的操作
```

#### 6.3 Skill 在 Agent 中的执行

```
Agent system prompt 中包含 skillsSnapshot.prompt，例如：
  ## github
  Manage GitHub issues, PRs, and repositories.
  Commands: /github <action> [args]
  ...

Agent 收到 "/github list issues" 后：
  1. 识别为 skill 命令
  2. 调用 bash 工具执行 skill 的 CLI 命令
     （skill 目录中的可执行脚本或 MCP server）
  3. 返回工具结果
  4. 将结果格式化为回复文本
```

---

### 七、完整调用链总览

```
chat.send (server-methods/chat.ts)
  │
  ├─ 1. 参数校验 + 消息清洗
  ├─ 2. loadSessionEntry(sessionKey)
  ├─ 3. respond(ACK)  ← 立即返回前端
  │
  └─ 4. void dispatchInboundMessage({ ctx, cfg, dispatcher })
            │
            ├─ finalizeInboundContext()
            └─ dispatchReplyFromConfig()
                  │
                  ├─ 幂等/策略检查
                  ├─ 触发 hooks
                  └─ getReplyFromConfig(ctx, opts, cfg)
                        │
                        ├─ A. resolveSessionAgentId()     ← Agent 选择
                        ├─ B. mergeSkillFilters()          ← Skill filter 合并
                        ├─ C. resolveDefaultModel()        ← 模型选择
                        ├─ D. ensureAgentWorkspace()       ← 工作区准备
                        ├─ E. applyMediaUnderstanding()    ← 媒体理解
                        ├─ F. initSessionState()           ← Session 初始化
                        ├─ G. resolveReplyDirectives()     ← 指令解析（/think、/new 等）
                        ├─ H. handleInlineActions()        ← 内联命令处理
                        └─ I. runPreparedReply()
                                │
                                ├─ ensureSkillSnapshot()   ← Skill 加载/缓存
                                ├─ 构建 system prompt
                                └─ runReplyAgent()
                                      │
                                      └─ runAgentTurnWithFallback()
                                            │
                                            └─ runEmbeddedPiAgent()
                                                  │
                                                  ├─ LLM API 调用（流式）
                                                  ├─ text delta → broadcast("chat", delta)
                                                  ├─ tool_use → 执行工具/skill
                                                  └─ lifecycle:end → broadcast("chat", final)
```

---

### 八、配置层级总结

| 层级 | 配置位置 | 影响范围 |
|------|----------|----------|
| Session | `sessionEntry.modelOverride` | 单个会话 |
| Channel | `cfg.channels[provider].modelOverride` | 整个渠道 |
| Agent | `cfg.agents.list[id].model` | 单个 agent |
| Global | `cfg.agents.defaults.model` | 所有 agent |
| Skill filter | `cfg.agents.list[id].skills` | agent 可用 skill |
| Workspace | `cfg.session.store` / `entry.workspace` | 文件系统路径 |


---

## Agent 选择实现方案（详细补充）

### 一、Session Key 格式规范

Agent 选择的核心依据是 session key，其格式定义在 `src/sessions/session-key-utils.ts`：

```
规范格式（canonical）：
  agent:{agentId}:{rest}

示例：
  agent:main:main                          → agentId=main, rest=main
  agent:coder:main                         → agentId=coder, rest=main
  agent:coder:telegram:direct:+1234567890  → agentId=coder, rest=telegram:direct:+1234567890
  agent:main:cron:daily-report:run:abc123  → agentId=main, rest=cron:daily-report:run:abc123
  agent:main:subagent:task-abc             → agentId=main, rest=subagent:task-abc

解析规则（parseAgentSessionKey）：
  1. 转小写 + trim
  2. 按 ":" 分割，过滤空段
  3. parts[0] 必须 === "agent"，否则返回 null
  4. parts.length 必须 >= 3，否则返回 null
  5. agentId = parts[1]，rest = parts[2:].join(":")
```

**非规范格式（legacy/alias）的处理：**

```
"main"                → 别名，映射到 agent:{defaultAgentId}:main
"agent:coder:MAIN"    → malformed（大写），parseAgentSessionKey 返回 null
"telegram:direct:..."  → legacy 格式，无 agentId 前缀

classifySessionKeyShape(key):
  → "agent"           规范格式
  → "legacy_or_alias" 无 "agent:" 前缀
  → "malformed_agent" 有 "agent:" 前缀但解析失败
  → "missing"         空字符串
```

---

### 二、Agent ID 解析完整流程

```typescript
// src/agents/agent-scope.ts
resolveSessionAgentId({ sessionKey, config })
  └─ resolveSessionAgentIds({ sessionKey, config, agentId? })
       │
       ├─ 1. resolveDefaultAgentId(cfg)
       │       ├─ cfg.agents.list 为空 → "main"（DEFAULT_AGENT_ID）
       │       ├─ 找第一个 default=true 的 entry → entry.id
       │       │    （多个 default=true 时取第一个，打 warn 日志）
       │       └─ 无 default=true → list[0].id
       │
       ├─ 2. 若传入显式 agentId 参数 → normalizeAgentId(agentId)（最高优先级）
       │
       ├─ 3. 解析 sessionKey：parseAgentSessionKey(sessionKey)
       │       → 成功 → normalizeAgentId(parsed.agentId)
       │       → 失败（legacy/alias/missing）→ 使用 defaultAgentId
       │
       └─ 返回 sessionAgentId
```

**normalizeAgentId 规范化规则：**

```typescript
// src/routing/session-key.ts
normalizeAgentId(value):
  1. trim + 空值 → "main"
  2. 符合 /^[a-z0-9][a-z0-9_-]{0,63}$/i → 直接 toLowerCase()
  3. 否则（含特殊字符）→ 非法字符替换为 "-"，去首尾 "-"，截断到 64 字符
     例：normalizeAgentId("My Agent!") → "my-agent"
```

---

### 三、默认 Agent 的前端感知机制

前端（Web 控制台）通过 WebSocket 握手的 `hello-ok` 响应中的 `snapshot.sessionDefaults` 字段获知默认 agent：

```typescript
// src/gateway/server/health-state.ts
buildGatewaySnapshot():
  cfg = loadConfig()
  defaultAgentId = resolveDefaultAgentId(cfg)   // 同上述逻辑
  mainKey        = normalizeMainKey(cfg.session?.mainKey)  // 默认 "main"
  mainSessionKey = resolveMainSessionKey(cfg)    // = "agent:{defaultAgentId}:{mainKey}"
  scope          = cfg.session?.scope ?? "per-sender"

  return {
    sessionDefaults: {
      defaultAgentId,    // 例："coder"
      mainKey,           // 例："main"
      mainSessionKey,    // 例："agent:coder:main"
      scope,             // 例："per-sender"
    },
    ...
  }
```

前端收到后（`ui/src/ui/app-gateway.ts`）：

```typescript
applySnapshot(host, hello)
  └─ applySessionDefaults(host, snapshot.sessionDefaults)
       └─ normalizeSessionKeyForDefaults(host.sessionKey, defaults)
            // 将 "main"、"agent:coder:main" 等别名统一规范化为 mainSessionKey
            // 确保前端 sessionKey 与服务端一致
```

---

### 四、Agent 配置结构（cfg.agents.list）

```typescript
// 配置文件示例（~/.openclaw/config.yaml）
agents:
  defaults:
    model: anthropic/claude-sonnet-4-6
    workspace: ~/workspace
  list:
    - id: main
      default: true
      name: "Main Assistant"
      model: anthropic/claude-opus-4-6
      workspace: ~/workspace
      skills: [github, weather]        // skill 白名单（undefined = 不限制）
      heartbeat:
        enabled: true
        model: anthropic/claude-haiku-4-5
    - id: coder
      name: "Code Assistant"
      model:
        primary: anthropic/claude-sonnet-4-6
        fallbacks: [openai/gpt-4o, google/gemini-2.0-flash]
      workspace: ~/code-workspace
      agentDir: ~/.openclaw/agents/coder/agent
      sandbox:
        enabled: true
      tools:
        bash: { elevated: false }
```

**resolveAgentConfig 返回字段说明：**

| 字段 | 来源 | 说明 |
|------|------|------|
| `name` | `entry.name` | 显示名称 |
| `workspace` | `entry.workspace` | 工作区目录（展开 `~`） |
| `agentDir` | `entry.agentDir` | agent 专属目录（存放 agent 文件） |
| `model` | `entry.model` | 模型配置（字符串或 `{primary, fallbacks}`） |
| `skills` | `entry.skills` | skill 白名单（`string[]`，`undefined` = 不限制） |
| `memorySearch` | `entry.memorySearch` | 记忆搜索配置 |
| `humanDelay` | `entry.humanDelay` | 模拟人类延迟配置 |
| `heartbeat` | `entry.heartbeat` | 心跳配置（定时 ping） |
| `identity` | `entry.identity` | agent 身份（名字、头像等） |
| `groupChat` | `entry.groupChat` | 群聊行为配置 |
| `subagents` | `entry.subagents` | 子 agent 配置 |
| `sandbox` | `entry.sandbox` | 沙箱配置 |
| `tools` | `entry.tools` | 工具权限配置 |

---

### 五、工作区与 Agent 目录解析

```typescript
// src/agents/agent-scope.ts
resolveAgentWorkspaceDir(cfg, agentId):
  1. entry.workspace 已配置 → resolveUserPath(workspace)（展开 ~）
  2. agentId === defaultAgentId:
       a. cfg.agents.defaults.workspace 已配置 → resolveUserPath(workspace)
       b. 否则 → resolveDefaultAgentWorkspaceDir(process.env)
                  = OPENCLAW_WORKSPACE_DIR env 或 ~/.openclaw/workspace
  3. 其他 agent → {stateDir}/workspace-{agentId}
                  = ~/.openclaw/workspace-{agentId}

resolveAgentDir(cfg, agentId):
  1. entry.agentDir 已配置 → resolveUserPath(agentDir)
  2. 否则 → {stateDir}/agents/{agentId}/agent
             = ~/.openclaw/agents/{agentId}/agent
```

**反向查找（路径 → agentId）：**

```typescript
resolveAgentIdByWorkspacePath(cfg, workspacePath):
  // 用于工具调用时根据当前工作目录反推 agentId
  1. 遍历所有 agentId，解析各自 workspaceDir
  2. 检查 workspacePath 是否在 workspaceDir 内（isPathWithinRoot）
  3. 多个匹配时取路径最长的（最精确匹配），同长度取配置顺序靠前的
```

---

### 六、特殊 Session Key 类型的 Agent 路由

```
cron session:    agent:main:cron:daily-report:run:abc123
  → agentId = "main"，由 cron 调度器创建，固定路由到 main agent

subagent session: agent:main:subagent:task-abc
  → agentId = "main"（父 agent），子 agent 继承父 agent 的 agentId
  → getSubagentDepth() 计算嵌套深度（防止无限递归）

acp session:     agent:main:acp:session-xyz
  → agentId = "main"，ACP 协议桥接，优先走 tryDispatchAcpReply()

thread session:  agent:main:telegram:direct:+123:thread:456
  → agentId = "main"，resolveThreadParentSessionKey() 返回父 session key
```

---

### 七、完整 Agent 选择决策树

```
收到 chat.send { sessionKey: "agent:coder:main" }
  │
  ├─ parseAgentSessionKey("agent:coder:main")
  │    → { agentId: "coder", rest: "main" }
  │
  ├─ normalizeAgentId("coder") → "coder"
  │
  ├─ resolveAgentEntry(cfg, "coder")
  │    → cfg.agents.list.find(e => normalizeAgentId(e.id) === "coder")
  │    → 找到 → 使用该 entry 的配置
  │    → 未找到 → 使用 cfg.agents.defaults（无 agent 专属配置）
  │
  ├─ resolveAgentWorkspaceDir(cfg, "coder") → ~/code-workspace
  ├─ resolveAgentDir(cfg, "coder")          → ~/.openclaw/agents/coder/agent
  ├─ resolveAgentSkillsFilter(cfg, "coder") → entry.skills（白名单）
  └─ resolveDefaultModelForAgent(cfg, "coder")
       → entry.model.primary → "anthropic/claude-sonnet-4-6"
```

---

## 七、SessionKey 完整生命周期

### 7.1 SessionKey 格式规范

所有规范化的 sessionKey 统一采用 `agent:{agentId}:{rest}` 格式：

| 类型 | 格式示例 | 说明 |
|------|---------|------|
| 主会话（DM） | `agent:main:main` | 默认 agent 的主会话 |
| 自定义主键 | `agent:ops:work` | mainKey=work 时 |
| 群组/频道 | `agent:main:telegram:group:123456789` | Telegram 群组 |
| Discord 频道 | `agent:main:discord:channel:987654321` | Discord 频道 |
| 线程 | `agent:main:telegram:group:123:thread:456` | 话题/线程 |
| 子 agent | `agent:main:main:subagent:0` | 子 agent 深度 0 |
| Cron 任务 | `agent:main:main:cron:{jobId}:{runId}` | 定时任务运行 |
| ACP 会话 | `agent:main:main:acp:{channel}:{accountId}:{convId}` | ACP 绑定会话 |
| 全局（global scope） | `global` | scope=global 时 |
| 未知来源 | `unknown` | 无法解析 From 时 |
| 多 peer（per-channel-peer） | `agent:main:telegram:direct:{peerId}` | 按渠道+peer 隔离 |
| 多账号（per-account-channel-peer） | `agent:main:telegram:{accountId}:direct:{peerId}` | 按账号+渠道+peer 隔离 |

### 7.2 前端 SessionKey 生命周期

#### 7.2.1 初始化（页面加载）

```
loadSettings()                          // 从 localStorage 读取 UiSettings
  → settings.sessionKey                 // 上次保存的 sessionKey（默认 "main"）
  → settings.lastActiveSessionKey       // 上次活跃的 sessionKey

OpenClawApp 构造函数:
  @state() sessionKey = this.settings.sessionKey
  @state() applySessionKey = this.settings.lastActiveSessionKey
```

#### 7.2.2 URL 参数覆盖（applySettingsFromUrl）

```
URL ?session=xxx  →  host.sessionKey = session
                  →  applySettings({ sessionKey, lastActiveSessionKey: session })
URL #token=xxx    →  applySettings({ token })
URL ?gatewayUrl=  →  host.pendingGatewayUrl（需用户确认）
```

#### 7.2.3 连接握手后更新（hello-ok）

```
connectGateway()
  → WebSocket 握手
  → 收到 hello-ok 响应
  → hello.snapshot.sessionDefaults.mainSessionKey
  → setLastActiveSessionKey(host, mainSessionKey)
    → applySettings({ lastActiveSessionKey: trimmed })
    → host.applySessionKey = trimmed
```

`hello-ok` 中的 `sessionDefaults.mainSessionKey` 由服务端 `resolveMainSessionKey(cfg)` 计算，反映当前配置的默认 agent 和 mainKey。

#### 7.2.4 用户切换 Session

```
用户在 Sessions 列表点击某个 session
  → setLastActiveSessionKey(host, selectedKey)
  → applySettings({ lastActiveSessionKey: selectedKey })
  → host.applySessionKey = selectedKey
  → syncUrlWithSessionKey(host, sessionKey, false)  // URL 更新 ?session=xxx
```

#### 7.2.5 发送消息时携带 SessionKey

```
handleSendChat()
  → sendChatMessageNow()
  → sendChatMessage(client, { sessionKey: host.applySessionKey, ... })
  → client.request("chat.send", { sessionKey, message, ... })
```

前端发送的 `sessionKey` 来自 `host.applySessionKey`（即 `settings.lastActiveSessionKey`），而非 `host.sessionKey`（后者是初始值，不随切换更新）。

#### 7.2.6 浏览器历史导航（popstate）

```
onPopState()
  → URL ?session=xxx  →  host.sessionKey = session
                      →  applySettings({ sessionKey, lastActiveSessionKey: session })
```

### 7.3 服务端 SessionKey 解析流程

#### 7.3.1 入口：chat.send handler

```
chat.send 收到 { sessionKey: "main" }（前端发来的原始值）
  → initSessionState({ ctx: { SessionKey: "main", ... }, cfg })
```

#### 7.3.2 resolveSessionKey（src/config/sessions/session-key.ts）

```typescript
resolveSessionKey(scope, ctx, mainKey):
  1. explicit = ctx.SessionKey?.trim()
     → 若存在：normalizeExplicitSessionKey(explicit, ctx)
       → trim + toLowerCase
       → 若 surface/provider/from 是 discord：normalizeExplicitDiscordSessionKey()
       → 返回规范化后的显式 key

  2. 若无显式 key：deriveSessionKey(scope, ctx)
     → scope === "global"  →  return "global"
     → resolveGroupSessionKey(ctx)  →  若是群组/频道，返回群组 key
     → normalizeE164(ctx.From)  →  DM 的 From 字段（电话号码等）
     → 若 From 为空  →  return "unknown"

  3. 非 global、非 group 的 DM：
     → buildAgentMainSessionKey({ agentId: DEFAULT_AGENT_ID, mainKey })
     → 返回 "agent:main:main"（或配置的 mainKey）
```

#### 7.3.3 群组 SessionKey 构建（src/config/sessions/group.ts）

```
resolveGroupSessionKey(ctx):
  判断条件（满足任一即为群组）：
    - ctx.ChatType === "group" | "channel"
    - ctx.From 包含 ":group:" | ":channel:"
    - ctx.From 以 "@g.us" 结尾（WhatsApp 群组）

  构建格式：
    "{provider}:{kind}:{id}"
    例：telegram:group:123456789
        discord:channel:987654321
        whatsapp:group:123456789@g.us

  最终包装为：
    agent:{DEFAULT_AGENT_ID}:{provider}:{kind}:{id}
```

#### 7.3.4 线程 SessionKey（src/routing/session-key.ts）

```
resolveThreadSessionKeys({ baseSessionKey, threadId }):
  → "{baseSessionKey}:thread:{normalizedThreadId}"
  例：agent:main:telegram:group:123:thread:456
```

#### 7.3.5 渠道消息的 SessionKey 构建（buildAgentPeerSessionKey）

各渠道 adapter 在收到消息时调用 `buildAgentPeerSessionKey`，根据 `dmScope` 配置决定隔离粒度：

```
dmScope = "main"（默认）:
  → buildAgentMainSessionKey()  →  所有 DM 共享同一 session

dmScope = "per-peer":
  → "agent:{agentId}:direct:{peerId}"

dmScope = "per-channel-peer":
  → "agent:{agentId}:{channel}:direct:{peerId}"

dmScope = "per-account-channel-peer":
  → "agent:{agentId}:{channel}:{accountId}:direct:{peerId}"

群组/频道（peerKind != "direct"）:
  → "agent:{agentId}:{channel}:{peerKind}:{peerId}"
```

### 7.4 服务端 SessionKey 规范化（resolveSessionStoreKey）

`loadSessionEntry` 调用 `resolveSessionStoreKey` 将任意输入 key 转换为存储用的规范 key：

```
resolveSessionStoreKey({ cfg, sessionKey }):
  1. 空值  →  原样返回
  2. "global" | "unknown"  →  原样返回（小写）
  3. 已是 agent: 格式（parseAgentSessionKey 成功）：
     → normalizeAgentId(parsed.agentId)
     → canonicalizeMainSessionAlias()  →  解析 main 别名
     → 返回小写规范 key
  4. 非 agent: 格式：
     → 若是 "main" 或配置的 mainKey  →  resolveMainSessionKey(cfg)
     → 否则  →  canonicalizeSessionKeyForAgent(defaultAgentId, lowered)
               →  "agent:{defaultAgentId}:{lowered}"
```

#### canonicalizeMainSessionAlias 别名解析

```
输入 "main" 或 "agent:ops:main"（当 mainKey="work" 时）
  → 统一映射到 "agent:ops:work"

输入 "agent:ops:work"（已是规范 key）
  → 原样返回

scope=global 时所有 main 别名
  → 映射到 "global"
```

### 7.5 Session Store 查找与持久化

#### 7.5.1 loadSessionEntry 完整流程

```
loadSessionEntry(sessionKey):
  1. resolveSessionStoreKey()  →  canonicalKey
  2. resolveSessionStoreAgentId()  →  从 canonicalKey 解析 agentId
  3. resolveStorePath(cfg.session?.store, { agentId })
     → 默认：~/.openclaw/agents/{agentId}/sessions/sessions.json
     → 若 store 路径含 {agentId}：按 agent 隔离
     → 若 store 路径不含模板：所有 agent 共享同一文件
  4. loadSessionStore(storePath)  →  读取 JSON 文件
  5. findStoreMatch(store, canonicalKey, sessionKey)
     → 先精确匹配
     → 再大小写不敏感扫描（兼容历史遗留 key）
  6. 返回 { cfg, storePath, store, entry, canonicalKey, legacyKey }
```

#### 7.5.2 initSessionState 中的 Session 初始化

```
initSessionState({ ctx, cfg }):
  1. resolveSessionAgentId()  →  确定 agentId
  2. resolveGroupSessionKey()  →  检测是否群组
  3. loadSessionStore(storePath, { skipCache: true })  →  强制读新鲜数据
  4. resolveSessionKey(scope, ctx, mainKey)  →  得到最终 sessionKey
  5. 查找 sessionStore[sessionKey]  →  现有 entry
  6. 判断 freshness（基于 updatedAt + resetPolicy）
  7. 若 fresh && !isNewSession：复用 sessionId
     否则：crypto.randomUUID()  →  新 sessionId
  8. 构建 sessionEntry（合并 baseEntry + 新字段）
  9. updateSessionStore(storePath, ...)  →  持久化
  10. 返回 SessionInitResult（含 sessionKey、sessionId、isNewSession 等）
```

### 7.6 完整 SessionKey 生命周期时序图

```
前端                          WebSocket                    服务端
 │                               │                            │
 │  loadSettings()               │                            │
 │  sessionKey = "main"          │                            │
 │                               │                            │
 │──── WebSocket connect ────────►                            │
 │                               │──── hello-ok ─────────────►
 │                               │◄─── { snapshot.sessionDefaults.mainSessionKey: "agent:main:main" }
 │  setLastActiveSessionKey()    │                            │
 │  applySessionKey = "agent:main:main"                       │
 │                               │                            │
 │  用户输入消息                  │                            │
 │  handleSendChat()             │                            │
 │  sessionKey = applySessionKey │                            │
 │──── chat.send ────────────────►                            │
 │     { sessionKey: "agent:main:main", message: "..." }      │
 │                               │                            │
 │                               │  resolveSessionKey()       │
 │                               │  → explicit key 存在       │
 │                               │  → normalizeExplicitSessionKey()
 │                               │  → "agent:main:main"       │
 │                               │                            │
 │                               │  resolveSessionStoreKey()  │
 │                               │  → parseAgentSessionKey()  │
 │                               │  → canonicalizeMainSessionAlias()
 │                               │  → canonicalKey = "agent:main:main"
 │                               │                            │
 │                               │  loadSessionStore()        │
 │                               │  → ~/.openclaw/agents/main/sessions/sessions.json
 │                               │                            │
 │                               │  findStoreMatch()          │
 │                               │  → 找到/创建 entry         │
 │                               │                            │
 │                               │  initSessionState()        │
 │                               │  → sessionId (复用/新建)   │
 │                               │  → updateSessionStore()    │
 │                               │                            │
 │                               │  dispatchReplyFromConfig() │
 │                               │  → resolveSessionAgentId() │
 │                               │  → agent 执行              │
 │                               │                            │
 │◄─── chat delta ───────────────│                            │
 │◄─── chat done ────────────────│                            │
```

### 7.7 渠道消息（非 Web UI）的 SessionKey 生成

Telegram/Discord/Slack 等渠道消息不经过前端，sessionKey 由渠道 adapter 直接构建：

```
渠道 adapter 收到消息
  → buildAgentPeerSessionKey({
      agentId,
      channel: "telegram",
      peerKind: ctx.ChatType,   // "direct" | "group" | "channel"
      peerId: ctx.From,
      dmScope: cfg.session?.scope,
      mainKey: cfg.session?.mainKey,
    })
  → 注入 ctx.SessionKey
  → 进入 dispatchInboundMessage()
  → resolveSessionKey() 读取 ctx.SessionKey（explicit 路径）
```

### 7.8 特殊 SessionKey 类型的派生规则

| 类型 | 派生方式 | 格式 |
|------|---------|------|
| 线程 | `resolveThreadSessionKeys()` | `{base}:thread:{threadId}` |
| 子 agent | `buildSubagentSessionKey()` | `{parent}:subagent:{depth}` |
| Cron 运行 | `buildCronRunSessionKey()` | `{base}:cron:{jobId}:{runId}` |
| ACP 会话 | `buildAcpSessionKey()` | `{base}:acp:{channel}:{accountId}:{convId}` |
| 父 session | `resolveThreadParentSessionKey()` | 去掉 `:thread:{id}` 后缀 |

### 7.9 关键配置项对 SessionKey 的影响

| 配置项 | 默认值 | 影响 |
|--------|--------|------|
| `session.scope` | `"per-sender"` | `"global"` 时所有消息共享 `global` key |
| `session.mainKey` | `"main"` | DM 主会话的 key 后缀，如 `"work"` → `agent:main:work` |
| `session.store` | `~/.openclaw/agents/{agentId}/sessions/sessions.json` | 含 `{agentId}` 则按 agent 隔离存储 |
| `agents.list[].id` | `"main"` | 决定 `agent:` 前缀中的 agentId 部分 |
| `agents.list[].default` | 第一个 agent | 决定默认 agentId |

---

## 八、SessionKey 到 Agent 的路由机制

### 8.1 核心原理

SessionKey 的格式 `agent:{agentId}:{rest}` 本身就编码了 agentId。路由的本质是从 sessionKey 中解析出 agentId，再用 agentId 查找对应的 agent 配置、工作目录、技能集等，最终交给该 agent 执行。

### 8.2 路由入口：resolveSessionAgentId

所有需要确定 agent 的地方都调用同一个函数（`src/agents/agent-scope.ts`）：

```typescript
resolveSessionAgentId({ sessionKey, config: cfg }):
  1. parseAgentSessionKey(sessionKey)
     → 解析 "agent:{agentId}:{rest}" 格式
     → 返回 { agentId: "ops", rest: "main" }

  2. 若解析成功：normalizeAgentId(parsed.agentId)
     → 小写 + 字符规范化
     → 返回 "ops"

  3. 若解析失败（非 agent: 格式）：
     → resolveDefaultAgentId(cfg)
     → 返回配置中 default=true 的 agent，或第一个 agent，或 "main"
```

`parseAgentSessionKey` 的规则极简：
- 必须以 `agent:` 开头
- 至少三段（`agent:{id}:{rest}`）
- 返回 `{ agentId, rest }`，均为小写

### 8.3 完整路由调用链

```
chat.send 收到 { sessionKey: "agent:ops:main" }
  │
  ▼
getReplyFromConfig(ctx, opts, cfg)          ← src/auto-reply/reply/get-reply.ts
  │
  ├─ agentSessionKey = ctx.SessionKey       // "agent:ops:main"
  │
  ├─ agentId = resolveSessionAgentId({      // ← 核心路由点
  │    sessionKey: "agent:ops:main",
  │    config: cfg
  │  })
  │  → parseAgentSessionKey() → { agentId: "ops", rest: "main" }
  │  → normalizeAgentId("ops") → "ops"
  │
  ├─ mergedSkillFilter = mergeSkillFilters(
  │    opts.skillFilter,
  │    resolveAgentSkillsFilter(cfg, "ops")  // 读取 ops agent 的 skills 配置
  │  )
  │
  ├─ resolveDefaultModel({ cfg, agentId: "ops" })
  │  → 读取 cfg.agents.list[id="ops"].model
  │  → 或 cfg.agents.defaults.model
  │
  ├─ workspaceDirRaw = resolveAgentWorkspaceDir(cfg, "ops")
  │  → cfg.agents.list[id="ops"].workspace
  │  → 或 ~/.openclaw/workspace-ops
  │
  ├─ agentDir = resolveAgentDir(cfg, "ops")
  │  → cfg.agents.list[id="ops"].agentDir
  │  → 或 ~/.openclaw/agents/ops/agent
  │
  ├─ initSessionState({ ctx, cfg })
  │  → resolveSessionAgentId() 再次确认 agentId
  │  → storePath = ~/.openclaw/agents/ops/sessions/sessions.json
  │  → 加载/创建 session entry
  │
  └─ runPreparedReply({ agentId: "ops", agentDir, workspaceDir, ... })
       │
       └─ runReplyAgent({ followupRun: { run: { agentId: "ops", ... } } })
            → runAgentTurnWithFallback()
            → runEmbeddedPiAgent()
            → 使用 ops agent 的配置执行
```

### 8.4 resolveAgentConfig：从 agentId 查找配置

```typescript
resolveAgentConfig(cfg, "ops"):
  → listAgentEntries(cfg)           // cfg.agents.list 数组
  → find(entry => normalizeAgentId(entry.id) === "ops")
  → 返回该 entry 的所有字段：
    {
      name, workspace, agentDir,
      model, skills, memorySearch,
      humanDelay, heartbeat, identity,
      groupChat, subagents, sandbox, tools
    }
```

若 `cfg.agents.list` 中不存在该 agentId，`resolveAgentConfig` 返回 `undefined`，各字段 fallback 到 `cfg.agents.defaults.*`。

### 8.5 Agent 工作目录与存储路径的隔离

agentId 决定了三个关键路径：

| 路径 | 解析逻辑 | 示例（agentId="ops"） |
|------|---------|----------------------|
| workspace | `cfg.agents.list[ops].workspace` → `cfg.agents.defaults.workspace` → `~/.openclaw/workspace-ops` | `~/projects/ops` |
| agentDir | `cfg.agents.list[ops].agentDir` → `~/.openclaw/agents/ops/agent` | `~/.openclaw/agents/ops/agent` |
| storePath | `resolveStorePath(cfg.session.store, { agentId: "ops" })` → `~/.openclaw/agents/ops/sessions/sessions.json` | `~/.openclaw/agents/ops/sessions/sessions.json` |

`storePath` 的模板替换：若 `cfg.session.store` 含 `{agentId}`（默认值），则每个 agent 有独立的 sessions 文件；否则所有 agent 共享同一文件。

### 8.6 默认 Agent 的 fallback 规则

当 sessionKey 不是 `agent:` 格式（如 `"main"`、`"global"`、`"unknown"`）时：

```
resolveDefaultAgentId(cfg):
  1. cfg.agents.list 中 default=true 的第一个 → 其 id
  2. 若无 default 标记 → cfg.agents.list[0].id
  3. 若 list 为空 → "main"（DEFAULT_AGENT_ID）

多个 default=true 时：取第一个，打印 warn 日志
```

### 8.7 resolveSessionAgentIds：同时返回 default 和 session agent

部分场景需要同时知道"默认 agent"和"本次会话的 agent"：

```typescript
resolveSessionAgentIds({ sessionKey, config, agentId? }):
  → defaultAgentId = resolveDefaultAgentId(cfg)
  → explicitAgentId = params.agentId（调用方显式传入，优先级最高）
  → parsed = parseAgentSessionKey(sessionKey)
  → sessionAgentId = explicitAgentId
                  ?? parsed?.agentId
                  ?? defaultAgentId
  → return { defaultAgentId, sessionAgentId }
```

优先级：显式参数 > sessionKey 中解析 > 配置默认值。

### 8.8 路由决策树

```
收到 sessionKey
       │
       ▼
parseAgentSessionKey(sessionKey)
       │
  ┌────┴────┐
  │ 成功解析 │                    │ 解析失败（非 agent: 格式）
  │         ▼                    ▼
  │  agentId = parsed.agentId   resolveDefaultAgentId(cfg)
  │         │                    │
  └────┬────┘                    │
       ▼                         ▼
  normalizeAgentId()         normalizeAgentId()
       │                         │
       └──────────┬──────────────┘
                  ▼
         resolveAgentConfig(cfg, agentId)
                  │
         ┌────────┴────────┐
         │ 找到配置         │ 未找到配置
         │                 ▼
         │        使用 cfg.agents.defaults.*
         ▼
  使用 agent 专属配置
  (model, workspace, agentDir, skills, ...)
                  │
                  ▼
         storePath = ~/.openclaw/agents/{agentId}/sessions/sessions.json
                  │
                  ▼
         runEmbeddedPiAgent(agentId, agentDir, workspaceDir, ...)
```

### 8.9 多 Agent 场景示例

配置示例：
```yaml
agents:
  list:
    - id: main
      default: true
      workspace: ~/projects/main
    - id: ops
      workspace: ~/projects/ops
      model: anthropic/claude-opus-4-5
    - id: research
      workspace: ~/projects/research
      skills: [web-search, arxiv]
```

| 前端发送的 sessionKey | 解析结果 | 路由到 | 工作目录 |
|----------------------|---------|--------|---------|
| `agent:main:main` | agentId=main | main agent | ~/projects/main |
| `agent:ops:main` | agentId=ops | ops agent | ~/projects/ops |
| `agent:research:telegram:group:123` | agentId=research | research agent | ~/projects/research |
| `main`（非 agent: 格式） | 解析失败 → default | main agent | ~/projects/main |
| `global` | 解析失败 → default | main agent | ~/projects/main |
