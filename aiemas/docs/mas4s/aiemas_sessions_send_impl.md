# aiemas_sessions_send 实现分析

## 函数签名与参数

```
createAiemasSessionsSendTool(deps: AiemasToolDeps, context?: { agentSessionKey?: string }): AiemasAgentTool
```

### AiemasToolDeps

| 参数                | 类型                                                                     | 说明                              |
| ------------------- | ------------------------------------------------------------------------ | --------------------------------- |
| db                  | DatabaseSync                                                             | SQLite 数据库实例                 |
| callSessionsSend    | (params: { sessionKey, message, timeoutSeconds? }) => Promise\<unknown\> | 依赖注入的 sessions_send 回调     |
| transcriptStore?    | SessionTranscriptStore                                                   | 用于标记 A2A 消息 role="agent"    |
| broadcastChatEvent? | (params: { sessionKey, runId, message }) => void                         | 广播 chat 事件到 WebSocket 客户端 |

### 工具参数 Schema (AiemasSessionsSendSchema)

| 参数           | 类型   | 必填 | 说明                              |
| -------------- | ------ | ---- | --------------------------------- |
| agentId        | string | 是   | 目标子 Agent 的 agentId           |
| message        | string | 是   | 要发送的消息                      |
| timeoutSeconds | number | 否   | 等待回复的超时秒数，默认/最小 600 |

---

## 方法调用链

### 1. 初始化注入链（Gateway 启动时）

```
server.impl.ts
  └─ initMas4sIntegration(log, cfgAtStart)
       └─ 返回 Mas4sIntegration 对象（含 resolveAgentTools 方法）
  └─ setMas4sIntegrationRef(mas4sIntegration)
       └─ 将实例存入 openclaw-tools.ts 模块级变量 mas4sIntegrationRef
```

### 2. 工具注入链（Agent 运行时创建工具列表）

```
pi-embedded-runner/run/attempt.ts
  └─ createOpenClawCodingTools(options)
       └─ pi-tools.ts: createOpenClawCodingTools()
            └─ getMas4sIntegrationRef()?.resolveAgentTools?.(context)
                 │  context = { agentSessionKey, agentChannel, config }
                 │
                 └─ mas4s-integration.ts: resolveAgentTools(context)
                      ├─ 构造 callSessionsSend 回调闭包
                      │    └─ 内部调用 createSessionsSendTool({ agentSessionKey, agentChannel, config: noPingPongConfig, callGateway })
                      │         └─ sendTool.execute("aiemas-internal", { sessionKey, message, timeoutSeconds })
                      │
                      └─ createAiemasSessionsSendTool({ db, callSessionsSend, transcriptStore, broadcastChatEvent }, { agentSessionKey })
                           └─ 返回 AiemasAgentTool 实例
            └─ tools.push(...injectedTools)
            └─ normalizeToolParameters(tool, { modelProvider, modelId, modelCompat })
            └─ wrapToolWithBeforeToolCallHook(tool, ...)
```

### 3. 执行链（LLM 调用工具时）

```
LLM 调用 aiemas_sessions_send(agentId, message, timeoutSeconds)
  └─ execute(_toolCallId, params)
       └─ 串行队列调度（Promise 链串行化，避免并发 wait 超时）
            └─ executeImpl(_toolCallId, params)
                 │
                 ├─ [1] 验证 agentSessionKey 非空
                 │
                 ├─ [2] extractUuidFromKey(agentSessionKey)
                 │    └─ session-utils.ts: 从 "agent:{agentId}:group:{uuid}" 提取末段 uuid
                 │
                 ├─ [3] 查询 aiemas_sessions 表
                 │    └─ createAiemasSessionsStore(db)
                 │         └─ store.loadRootSession(agentSessionKey)
                 │              └─ SQL: SELECT * FROM aiemas_sessions WHERE sessionKey = ?
                 │                   └─ 从 rootSession.descendantSessions 查找 agentId 匹配项
                 │                        └─ 取 descendant.sessionKey 作为 targetSessionKey
                 │
                 ├─ [4] Fallback（未找到时）
                 │    └─ constructKeyFromUuid(agentId, sessionUuid)
                 │         └─ session-utils.ts: 返回 "agent:{normalizedAgentId}:group:{normalizedUuid}"
                 │
                 ├─ [5a] transcriptStore.markNextMessageAsAgent(targetSessionKey, { sourceAgentId, sourceSessionKey, message })
                 │    └─ 标记下一条消息为 agent 来源（在 callSessionsSend 之前）
                 │
                 ├─ [5b] broadcastChatEvent({ sessionKey, runId, message })
                 │    └─ mas4s-integration.ts: emitAgentEvent({ runId, sessionKey, stream: "agent", data })
                 │         └─ 通过 WebSocket 广播到 UI（子 Agent 抽屉实时显示输入消息）
                 │
                 ├─ [5c] callSessionsSend({ sessionKey: targetSessionKey, message, timeoutSeconds: effectiveTimeout })
                 │    └─ mas4s-integration.ts 闭包:
                 │         └─ createSessionsSendTool({ agentSessionKey, agentChannel, config: noPingPongConfig, callGateway })
                 │              └─ sendTool.execute("aiemas-internal", { sessionKey, message, timeoutSeconds })
                 │                   └─ sessions-send-tool.ts: 完整的 sessions_send 逻辑
                 │                        ├─ resolveSessionToolContext(opts)
                 │                        ├─ resolveSessionReference({ sessionKey, ... })
                 │                        ├─ resolveVisibleSessionReference(...)
                 │                        ├─ createSessionVisibilityGuard(...)
                 │                        ├─ startAgentRun({ callGateway, runId, sendParams, ... })
                 │                        │    └─ callGateway({ method: "sessions.send", params: sendParams })
                 │                        └─ waitForAgentReply(...)（同步等待模式）
                 │
                 ├─ [6] 状态增强（blocked / running）
                 │    └─ 为 Orchestrator LLM 提供中文指令反馈
                 │
                 └─ [7] 返回 jsonResult(result)
                      └─ { content: [{ type: "text", text: JSON.stringify(result) }], details: result }
```

---

## 参数 agentId 和 message 的来源：从用户消息到工具调用的完整链路

### 端到端调用链概览

```
用户 (WebChat UI / SDK / Channel)
  │
  │  发送消息，例如："查询所有运行中的虚拟机"
  │
  ▼
[1] Gateway RPC: sessions.send
  │  params: { key: "agent:aieiaas:group:mas-xxx", message: "查询所有运行中的虚拟机" }
  │
  ▼
[2] chatHandlers["chat.send"]
  │  params: { sessionKey, message, idempotencyKey }
  │  → 消息验证、去重、注册 AbortController
  │
  ▼
[3] dispatchInboundMessage({ ctx, cfg, dispatcher, replyOptions })
  │  ctx.BodyForAgent = 用户原始消息（含时间戳注入）
  │  ctx.SessionKey = "agent:aieiaas:group:mas-xxx"（Orchestrator 的 sessionKey）
  │
  ▼
[4] dispatchReplyFromConfig({ ctx, cfg, dispatcher })
  │  → 解析 sessionAgentId = "aieiaas"（从 sessionKey 提取）
  │  → 加载 hook/plugin 处理
  │
  ▼
[5] replyResolver = getReplyFromConfig(ctx, opts, cfg)
  │  → 解析 agentId、workspace、model
  │  → 初始化 session state（历史消息、上下文文件）
  │  → 调用 embedded agent runner
  │
  ▼
[6] pi-embedded-runner/run/attempt.ts
  │  → 构建 system prompt（注入 AGENTS.md、SOUL.md 等 context files）
  │  → createOpenClawCodingTools() → 注入 aiemas_sessions_send 工具
  │  → 组装 messages = [system, ...history, user_message]
  │  → 调用 LLM Provider API（OpenAI/Anthropic/...）
  │
  ▼
[7] LLM 推理决策
  │  LLM 读取 system prompt 中的 AGENTS.md 内容，包含：
  │    - 路由表（关键词 → agentId 映射）
  │    - 调度方式说明（aiemas_sessions_send 用法）
  │  LLM 根据用户消息中的关键词，自主决定：
  │    - agentId = 路由表匹配结果（如 "虚拟机" → "aieiaas-resource"）
  │    - message = 用户原始请求或 LLM 改写后的任务描述
  │    - timeoutSeconds = 根据任务类型选择（查询 30s / SOP 120s）
  │
  ▼
[8] LLM 输出 tool_call: aiemas_sessions_send({ agentId, message, timeoutSeconds })
  │
  ▼
[9] Gateway 工具执行框架调用 tool.execute(toolCallId, params)
  │  → 进入 aiemas-tools.ts 的 executeImpl 逻辑
```

### agentId 的决策过程

agentId 由 LLM 在推理阶段自主决定，决策依据来自 system prompt 中注入的 AGENTS.md 路由表：

```
AGENTS.md 路由表（注入到 system prompt）:
┌─────────────────────────────────────────────────────────────────────┐
│ 用户意图关键词                        │ agentId              │
├─────────────────────────────────────────────────────────────────────┤
│ 虚拟机/VM/云主机/启动/停止/重启...    │ aieiaas-resource     │
│ 模型/推理/网关/API Key/部署模型...    │ aieiaas-model        │
│ 任务/Job/脚本/执行器/定时任务...      │ aieiaas-task         │
│ 监控/告警/日志/CPU/内存/GPU...        │ aieiaas-monitor      │
└─────────────────────────────────────────────────────────────────────┘
```

**决策流程：**

1. LLM 接收用户消息（如 "查询所有运行中的虚拟机"）
2. LLM 在 system prompt 中找到路由表
3. LLM 匹配关键词 "虚拟机" → 确定 agentId = `"aieiaas-resource"`
4. 对于复杂请求（涉及多个领域），LLM 会拆分为多个子任务，串行调用不同 agentId

### message 的决策过程（详细分析）

message 参数不是从代码中机械提取的，而是 LLM 在推理阶段基于多重上下文自主构造的自然语言字符串。以下详细分析其决策输入、构造逻辑和约束。

#### 决策输入源

LLM 构造 message 时可用的上下文信息（按优先级排列）：

```
┌─────────────────────────────────────────────────────────────────────────────┐
│ 输入源                          │ 来源位置                    │ 作用        │
├─────────────────────────────────────────────────────────────────────────────┤
│ 1. 用户当前消息                 │ messages 数组最后一条 user  │ 核心意图    │
│ 2. 会话历史 (conversation)      │ messages 数组中的历史轮次   │ 上下文延续  │
│ 3. AGENTS.md 路由表+调度说明    │ system prompt context files │ 格式约束    │
│ 4. 工具描述 (tool description)  │ tool schema 注入到 prompt   │ 参数语义    │
│ 5. 前序 tool_call 结果          │ messages 中的 tool results  │ 串行依赖    │
│ 6. MEMORY.md / memory/*.md      │ agent workspace 文件        │ 长期记忆    │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### 构造模式分类

| 模式           | 触发条件                        | message 构造逻辑                                       | 示例                                                                                                                       |
| -------------- | ------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| **直接透传**   | 用户请求明确、单一领域、无歧义  | 原样传递用户消息文本                                   | 用户: "查询所有运行中的虚拟机" → message: "查询所有运行中的虚拟机"                                                         |
| **语义改写**   | 用户表述模糊或口语化            | LLM 将模糊意图改写为子 Agent 可执行的明确指令          | 用户: "帮我看看机器" → message: "查询所有虚拟机的运行状态列表"                                                             |
| **任务拆分**   | 用户请求涉及多步骤或多领域      | LLM 将复杂请求分解为独立子任务，每个子任务一条 message | 用户: "部署 Qwen2-72B 并配置监控" → message₁: "执行模型部署 SOP: Qwen2-72B" → message₂: "为 Qwen2-72B 配置 GPU 利用率告警" |
| **上下文注入** | 串行调度中后续步骤依赖前序结果  | LLM 将前序 tool_call 返回的结果嵌入 message 作为上下文 | message: "基于以下部署结果，查询拓扑详情: {前序 result.reply}"                                                             |
| **SOP 触发**   | 用户请求匹配已知 SOP 模式       | LLM 构造 "执行 XXX SOP: 参数" 格式的指令               | 用户: "帮我部署 Qwen2-72B" → message: "执行模型部署 SOP: Qwen2-72B"                                                        |
| **追问转发**   | 子 Agent 返回需要用户选择的列表 | LLM 将用户的选择/确认转发给同一子 Agent                | 用户: "选第 2 个" → message: "用户选择了第 2 项，请继续执行"                                                               |

#### 决策流程时序

```
[LLM 推理开始]
     │
     ├─ 读取 system prompt 中的 AGENTS.md
     │    ├─ 核心职责: "意图识别 → 任务分解 → 子 Agent 调度 → 结果汇总"
     │    ├─ 路由表: 关键词 → agentId 映射
     │    ├─ 调度方式: 同步查询 / SOP 执行 / 多 Agent 串行
     │    └─ 约束: "编排 Agent 自身不直接调用任何 xstack API"
     │
     ├─ 读取工具 description
     │    └─ "【授权专用】AIEMAS Orchestrator Agent 必须且仅能使用此工具向其管理的子 Agent 发送消息"
     │
     ├─ 读取工具参数 schema
     │    ├─ agentId: { description: "目标子 Agent 的 agentId" }
     │    ├─ message: { description: "要发送的消息" }
     │    └─ timeoutSeconds: { description: "等待回复的超时秒数，默认 600" }
     │
     ├─ 分析用户当前消息
     │    └─ 提取意图关键词，匹配路由表
     │
     ├─ 分析会话历史
     │    ├─ 是否有未完成的多步骤任务？
     │    ├─ 前序 aiemas_sessions_send 的返回结果是什么？
     │    └─ 用户是否在回应子 Agent 的追问？
     │
     └─ 构造 message 参数
          ├─ 简单查询 → 直接透传或轻微改写
          ├─ 复杂任务 → 拆分为第一个子任务的指令
          ├─ 串行后续 → 注入前序结果作为上下文
          └─ 追问回应 → 将用户选择转发给对应子 Agent
```

#### AGENTS.md 中对 message 构造的隐式约束

AGENTS.md 通过以下方式间接约束 LLM 构造 message 的行为：

1. **交互流程定义**（第 5 节）：
   - "接收用户请求，根据路由表识别目标子 Agent"
   - "通过 aiemas_sessions_send 将请求委派给目标子 Agent"
   - 这指导 LLM 将用户请求转化为子 Agent 可理解的指令

2. **调度方式示例**（第 4 节）：
   - 同步查询示例: `message="查询所有运行中的虚拟机"` → 暗示查询类 message 应简洁直接
   - SOP 执行示例: `message="执行模型部署 SOP: Qwen2-72B"` → 暗示 SOP 类 message 应包含 "执行 XXX SOP: 参数" 格式
   - 多 Agent 串行示例 → 暗示后续步骤可引用前序结果

3. **子 Agent 状态处理**（第 6 节）：
   - 当子 Agent 返回 blocked/running/timeout/error 时，LLM 应向用户报告状态
   - 这意味着 message 不会包含状态处理逻辑，状态处理由 Orchestrator 自身完成

4. **约束**（第 8 节）：
   - "查询返回多条结果时，子 Agent 会展示完整列表并等待用户选择"
   - 这意味着 LLM 在用户做出选择后，需要构造包含选择信息的 message 转发给子 Agent

#### message 与子 Agent 的关系

message 到达子 Agent 后，会作为该子 Agent session 的新一条 user message 被处理：

```
Orchestrator LLM 构造 message
     │
     ▼ [aiemas_sessions_send.execute]
callSessionsSend({ sessionKey: targetSessionKey, message: "查询所有运行中的虚拟机" })
     │
     ▼ [sessions-send-tool.ts → callGateway({ method: "sessions.send" })]
Gateway 将 message 作为新的 user turn 写入子 Agent 的 session transcript
     │
     ▼ [子 Agent 的 embedded runner]
子 Agent 收到 message 作为 user message，结合自己的 AGENTS.md/Skills 执行任务
     │
     ▼ [子 Agent 执行完毕]
返回 reply → Orchestrator 的 aiemas_sessions_send 收到 { status: "ok", reply: "..." }
```

**关键点：** message 对子 Agent 而言就是一条普通的用户消息。子 Agent 不知道这条消息来自 Orchestrator 还是真实用户（除非通过 transcriptStore.markNextMessageAsAgent 标记了 role="agent"，但这仅影响 UI 显示，不影响子 Agent 的处理逻辑）。

#### 实际场景举例

**场景 1：简单查询（直接透传）**

```
用户: "列出所有运行中的虚拟机"
LLM 推理: 关键词"虚拟机" → agentId="aieiaas-resource"，请求明确无需改写
tool_call: aiemas_sessions_send(agentId="aieiaas-resource", message="列出所有运行中的虚拟机", timeoutSeconds=600)
```

**场景 2：模糊请求（语义改写）**

```
用户: "机器怎么样了"
LLM 推理: 结合会话历史（之前讨论过虚拟机），改写为明确查询
tool_call: aiemas_sessions_send(agentId="aieiaas-resource", message="查询所有虚拟机的当前运行状态", timeoutSeconds=600)
```

**场景 3：复杂任务（任务拆分 + 串行调度）**

```
用户: "部署 Qwen2-72B 模型并设置 GPU 监控告警"
LLM 推理: 涉及两个领域（模型服务 + 监控），需串行调度

第一次 tool_call:
  aiemas_sessions_send(agentId="aieiaas-model", message="执行模型部署 SOP: Qwen2-72B", timeoutSeconds=600)
  → 返回: { status: "ok", reply: "Qwen2-72B 已部署到 node-gpu-03，推理端点: http://..." }

第二次 tool_call（注入前序结果）:
  aiemas_sessions_send(agentId="aieiaas-monitor", message="为部署在 node-gpu-03 的 Qwen2-72B 模型配置 GPU 利用率告警，阈值 90%", timeoutSeconds=600)
```

**场景 4：用户追问（选择转发）**

```
第一轮:
  用户: "查看可用镜像"
  → aiemas_sessions_send(agentId="aieiaas-resource", message="查询所有可用的系统镜像列表")
  → 子 Agent 返回: "找到 5 个镜像: 1. Ubuntu 22.04  2. CentOS 8  3. ..."

第二轮:
  用户: "用第 2 个创建虚拟机"
  LLM 推理: 用户在回应子 Agent 的列表，需要将选择转发回同一子 Agent
  → aiemas_sessions_send(agentId="aieiaas-resource", message="使用 CentOS 8 镜像创建一台虚拟机")
```

**场景 5：会话记忆影响（上下文延续）**

```
之前的会话中用户提到过 "我们的生产集群是 cluster-prod-01"

当前用户: "重启集群里的 worker 节点"
LLM 推理: 结合会话历史中的集群信息
→ aiemas_sessions_send(agentId="aieiaas-resource", message="重启 cluster-prod-01 集群中的所有 worker 节点")

### AGENTS.md 注入到 system prompt 的链路

```

pi-embedded-runner/run/attempt.ts
└─ resolveBootstrapContextForRun(cfg, agentId, workspaceDir)
└─ 扫描 workspace 目录下的 context files
└─ 读取 AGENTS.md、SOUL.md、IDENTITY.md 等
└─ 按优先级排序（AGENTS.md=10, SOUL.md=20, IDENTITY.md=30）
└─ buildAgentSystemPrompt({ contextFiles, ... })
└─ 将 AGENTS.md 内容嵌入 system prompt 的 "Project Context" 区域
└─ LLM 在此获得路由表和调度方式说明

```

**关键文件路径：**
- Orchestrator 的 AGENTS.md: `~/.openclaw/workspace-aieiaas/AGENTS.md`
- 注入位置: system prompt 的 context files 区域（按 CONTEXT_FILE_ORDER 排序，AGENTS.md 优先级最高=10）

### 用户消息在链路中的变换

```

用户输入: "查询所有运行中的虚拟机"
│
▼ [sessions.send params.message]
原始消息: "查询所有运行中的虚拟机"
│
▼ [chat.send sanitize + timestamp inject]
BodyForAgent: "[2026-05-11 10:30:00] 查询所有运行中的虚拟机"
│
▼ [embedded runner → LLM messages 数组]
user message: { role: "user", content: "[2026-05-11 10:30:00] 查询所有运行中的虚拟机" }
│
▼ [LLM 推理 → 决定调用 aiemas_sessions_send]
tool_call params: { agentId: "aieiaas-resource", message: "查询所有运行中的虚拟机", timeoutSeconds: 600 }
│
▼ [aiemas_sessions_send.execute]
callSessionsSend({ sessionKey: "agent:aieiaas-resource:group:mas-xxx", message: "查询所有运行中的虚拟机" })

```

---

## 触发调用方式

### 触发入口

1. **Agent 运行时自动注入**：当 Gateway 启动 Agent run 时，`pi-embedded-runner/run/attempt.ts` 调用 `createOpenClawCodingTools()`，其中通过 `resolveAgentTools` 注入 `aiemas_sessions_send` 工具到 Agent 可用工具列表中。

2. **LLM 自主调用**：Orchestrator Agent（如 `aieiaas`）在 AGENTS.md 中被指示使用 `aiemas_sessions_send` 向子 Agent 发送消息。LLM 根据用户请求自主决定调用此工具。

### 调用条件

- `mas4sIntegrationRef` 不为 null（AIEMAS 插件已加载）
- `resolveAgentTools` 返回非空工具数组
- Agent 的 `agentSessionKey` 存在（用于提取 sessionUuid 和确定调用者身份）

### 调用示例（AGENTS.md 中的调度方式）

```

aiemas_sessions_send(agentId="aieiaas-resource", message="查询所有运行中的虚拟机", timeoutSeconds=600)
aiemas_sessions_send(agentId="aieiaas-model", message="执行模型部署 SOP: Qwen2-72B", timeoutSeconds=600)

```

---

## 关键设计点

| 设计点 | 说明 |
|--------|------|
| 架构边界 | aiemas-tools.ts 不导入任何 Gateway 核心模块（src/），通过依赖注入 callSessionsSend 回调 |
| 串行队列 | execute 内部用 Promise 链串行化，避免并发 wait 导致排队超时 |
| Ping-Pong 禁用 | callSessionsSend 闭包中设置 maxPingPongTurns=0，防止 orchestrator↔child 循环 |
| 最小超时 600s | effectiveTimeout = Math.max(timeoutSeconds ?? 600, 600)，防止 LLM 传入过小值 |
| Fallback 派生 | DB 查询失败或未找到目标时，回退到 constructKeyFromUuid 规则构造 sessionKey |
| A2A 消息标记 | 在 callSessionsSend 之前调用 markNextMessageAsAgent，确保 transcript 正确记录来源 |
| UI 实时广播 | 在 callSessionsSend 之前广播输入消息，子 Agent 抽屉立即显示 |
```
