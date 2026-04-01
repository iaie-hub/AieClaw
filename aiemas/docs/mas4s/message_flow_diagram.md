# 消息完整流程分析：以 chat.send 为入口

> 本文档基于源码分析，覆盖从 `chat.send` 请求到 vLLM API 调用的完整链路，包括 Agent 路由、加载运行、工作区文件加载时机、Skills 加载机制、以及 Prompt 生成逻辑。

---

## 一、总体架构概览

```
WebSocket Client
      │
      ▼
Gateway (src/gateway/)
      │  ① 消息接收 & 路由解析
      ▼
Bindings 路由引擎 (src/routing/resolve-route.ts)
      │  ② 确定目标 agentId
      ▼
Session 管理层 (src/sessions/)
      │  ③ 确定 sessionKey / sessionId
      ▼
runEmbeddedPiAgent (src/agents/pi-embedded-runner/run.ts)
      │  ④ 加载工作区文件、Skills、构建 System Prompt
      ▼
buildAgentSystemPrompt (src/agents/system-prompt.ts)
      │  ⑤ 组装完整 Prompt
      ▼
LLM API (Anthropic / OpenAI / vLLM 等)
      │  ⑥ 流式响应
      ▼
subscribeEmbeddedPiSession (src/agents/pi-embedded-subscribe.ts)
      │  ⑦ 处理响应、工具调用、消息分发
      ▼
Channel 回复 (WhatsApp / Telegram / Discord / Web 等)
```

---

## 二、Agent 路由机制

### 2.1 路由入口

消息到达 Gateway 后，由 `src/routing/resolve-route.ts` 中的 `resolveAgentRoute()` 函数执行路由决策。

### 2.2 路由优先级（最具体优先）

```
优先级 1：peer 精确匹配（DM/群组/频道 id）
优先级 2：parentPeer 匹配（线程继承）
优先级 3：guildId + roles（Discord 角色路由）
优先级 4：guildId（Discord 服务器）
优先级 5：teamId（Slack 工作区）
优先级 6：accountId 匹配（特定渠道账户）
优先级 7：channel 级匹配（accountId: "*"）
优先级 8：回退到默认 agent（agents.list[].default，否则第一个，默认 "main"）
```

同一优先级有多个匹配时，取配置文件中第一个。

### 2.3 路由缓存

`resolveRouteCacheForConfig()` 对路由结果按 `(channel, accountId, peer, guildId, teamId, roleIds)` 组合键缓存，避免每条消息重复计算。

### 2.4 Session Key 生成

路由确定 `agentId` 后，`buildAgentSessionKey()` 生成会话键：

```
格式：agent:<agentId>:<mainKey>
示例：agent:main:group:120363xxx@g.us
      agent:work:dm:+15551234567
```

直接聊天（DM）折叠到 `agent:<agentId>:<mainKey>`，实现同一对话的历史连续性。

---

## 三、Agent 加载与运行

### 3.1 Agent 的组成

每个 Agent 是一个完全隔离的"大脑"，包含：

| 组件     | 路径                                            | 说明                   |
| -------- | ----------------------------------------------- | ---------------------- |
| 工作区   | `~/.openclaw/workspace-<agentId>`               | 文件、引导文件、Skills |
| 状态目录 | `~/.openclaw/agents/<agentId>/agent`            | 认证配置、模型注册表   |
| 会话存储 | `~/.openclaw/agents/<agentId>/sessions/*.jsonl` | 对话历史 JSONL         |

### 3.2 运行入口：runEmbeddedPiAgent

`src/agents/pi-embedded-runner/run.ts` 中的 `runEmbeddedPiAgent()` 是 Agent 运行的核心入口：

```
runEmbeddedPiAgent(params)
  │
  ├─ 1. 解析工作区目录 resolveRunWorkspaceDir()
  ├─ 2. 加载运行时插件 ensureRuntimePluginsLoaded()
  ├─ 3. 解析模型 resolveModelAsync(provider, modelId)
  ├─ 4. 初始化认证配置 initializeAuthProfile()
  ├─ 5. 初始化上下文引擎 resolveContextEngine()
  │
  └─ 进入重试循环 while(true)
       │
       ├─ 检查 live session model switch
       ├─ 调用 runEmbeddedAttempt() ← 核心执行单元
       │
       └─ 处理结果：
            ├─ 成功 → 返回 payloads
            ├─ 上下文溢出 → 触发 compaction 后重试
            ├─ 超时 → 触发 compaction 后重试
            └─ 认证失败 → 轮换 auth profile 后重试
```

### 3.3 运行时 Lane 隔离

每个 session 有独立的执行 Lane（`resolveSessionLane`），全局也有一个 Lane（`resolveGlobalLane`）。消息通过 `enqueueCommandInLane` 串行化，防止同一 session 并发执行。

---

## 四、工作区文件（AGENTS.md / SOUL.md / TOOLS.md / IDENTITY.md）加载时机

### 4.1 加载的文件列表

`src/agents/workspace.ts` 中的 `loadWorkspaceBootstrapFiles()` 加载以下文件：

```
AGENTS.md      - 操作指令 + "记忆"
SOUL.md        - 人设、边界、语气
TOOLS.md       - 工具使用说明（用户维护）
IDENTITY.md    - Agent 名称/风格/emoji
USER.md        - 用户档案 + 称呼偏好
HEARTBEAT.md   - 心跳提示词
BOOTSTRAP.md   - 一次性首次运行仪式（完成后删除）
```

### 4.2 加载时机：**每个 Session 的第一条消息时加载，之后缓存**

关键代码在 `src/agents/bootstrap-cache.ts`：

```typescript
const cache = new Map<string, WorkspaceBootstrapFile[]>();

export async function getOrLoadBootstrapFiles(params: {
  workspaceDir: string;
  sessionKey: string;
}): Promise<WorkspaceBootstrapFile[]> {
  const existing = cache.get(params.sessionKey);
  if (existing) {
    return existing; // ← 命中缓存，不重新读取文件
  }
  const files = await loadWorkspaceBootstrapFiles(params.workspaceDir);
  cache.set(params.sessionKey, files); // ← 按 sessionKey 缓存
  return files;
}
```

**结论：工作区文件不是每条消息都重新加载。** 它们在 session 的第一次运行时从磁盘读取，然后按 `sessionKey` 缓存在内存中。

**缓存失效时机：**

- `clearBootstrapSnapshot(sessionKey)` — session 滚动时清除
- `clearBootstrapSnapshotOnSessionRollover()` — session ID 变更时自动清除
- `clearAllBootstrapSnapshots()` — 全量清除（重启时）

### 4.3 注入到 Prompt 的方式

`src/agents/bootstrap-files.ts` 中的 `resolveBootstrapContextForRun()` 将文件内容转换为 `EmbeddedContextFile[]`，最终注入到系统提示词的 `# Project Context` 部分：

```
## Workspace Files (injected)
These user-editable files are loaded by OpenClaw and included below in Project Context.

# Project Context

The following project context files have been loaded:
If SOUL.md is present, embody its persona and tone...

## AGENTS.md
<文件内容>

## SOUL.md
<文件内容>

## TOOLS.md
<文件内容>
...
```

**大文件处理：** 超过 `bootstrapMaxChars`（默认 20000 字符）的文件会被截断并附加截断标记。

**轻量模式（lightweight）：**

- `heartbeat` 触发时：只注入 `HEARTBEAT.md`
- `cron/default` 轻量模式：不注入任何引导文件

---

## 五、Skills 加载机制

### 5.1 Skills 来源（三个位置，工作区优先）

```
优先级 1（最高）：<workspace>/skills/        ← 工作区 Skills
优先级 2：        ~/.openclaw/skills/         ← 托管/本地 Skills
优先级 3（最低）：bundled（随安装包附带）     ← 内置 Skills
```

名称冲突时，工作区 Skills 覆盖同名的托管/内置 Skills。

### 5.2 Skills 是否每条消息都加载？

**不是。** 通过 `skillsSnapshot` 机制缓存：

```typescript
// src/agents/pi-embedded-runner/skills-runtime.ts
export function resolveEmbeddedRunSkillEntries(params: {
  workspaceDir: string;
  config?: OpenClawConfig;
  skillsSnapshot?: SkillSnapshot; // ← 快照缓存
}): { shouldLoadSkillEntries: boolean; skillEntries: SkillEntry[] } {
  const shouldLoadSkillEntries = !params.skillsSnapshot || !params.skillsSnapshot.resolvedSkills;
  return {
    shouldLoadSkillEntries,
    skillEntries: shouldLoadSkillEntries
      ? loadWorkspaceSkillEntries(params.workspaceDir, { config })
      : [], // ← 有快照时不重新加载
  };
}
```

**结论：** 如果调用方传入了 `skillsSnapshot`（已解析的 Skills 快照），则直接使用快照，不重新扫描文件系统。

### 5.3 Skills 在 Prompt 中的呈现

`formatSkillsCompact()` 将 Skills 格式化为 XML 结构注入系统提示词：

```xml
<available_skills>
  <skill>
    <name>openclaw-release-maintainer</name>
    <description>Release naming, version coordination...</description>
    <location>/path/to/skills/openclaw-release-maintainer/SKILL.md</location>
  </skill>
  ...
</available_skills>
```

**关键设计：** Prompt 中只包含 Skills 的名称、描述和文件路径，**不包含 SKILL.md 的完整内容**。Agent 需要时通过 `read` 工具按需加载 SKILL.md 全文。这样保持基础 Prompt 精简，同时支持按需使用 Skills。

### 5.4 如何决定调用哪个 Skill

Agent 根据用户请求的语义自主判断：

1. 系统提示词中列出所有可用 Skills 的名称和描述
2. Agent 识别用户意图，匹配最相关的 Skill
3. 使用 `read` 工具加载对应 SKILL.md 的完整指令
4. 按 SKILL.md 中的工作流执行

例如：用户说"帮我发布新版本" → Agent 识别为发布场景 → 加载 `$openclaw-release-maintainer` 的 SKILL.md → 按其中的流程执行。

---

## 六、vLLM API 调用时的 Prompt 生成

### 6.1 System Prompt 组装流程

`src/agents/system-prompt.ts` 中的 `buildAgentSystemPrompt()` 按以下顺序组装系统提示词：

```
"You are a personal assistant running inside OpenClaw."

## Tooling
  - 当前可用工具列表（按策略过滤）
  - 工具调用风格指南

## Tool Call Style
  - 何时叙述、何时静默调用

## Safety
  - 安全防护提醒（建议性，非强制）

## OpenClaw CLI Quick Reference
  - Gateway 管理命令

## Skills（如有）
  <available_skills>...</available_skills>
  - 如何按需加载 SKILL.md

## Memory（如有）
  - 记忆检索指南

## OpenClaw Self-Update（非子 Agent 模式）
  - config.apply / update.run 使用规则

## Model Aliases（非子 Agent 模式，如有）
  - 模型别名列表

## Workspace
  - 工作目录路径
  - 文件操作指南

## Documentation
  - 本地文档路径
  - 何时查阅文档

## Sandbox（启用时）
  - 沙箱运行时信息

## User Identity（非子 Agent 模式）
  - 所有者标识

## Current Date & Time
  - 用户时区（不含动态时钟，保持 Prompt 缓存稳定）

## Workspace Files (injected)
  - 标记下方包含引导文件

## Reply Tags（非子 Agent 模式）
  - 支持的回复标签语法

## Messaging（非子 Agent 模式）
  - 消息发送规则

## Group Chat Context / Subagent Context（如有 extraSystemPrompt）
  - 群聊上下文或子 Agent 上下文

## Reactions（如有）
  - 表情反应指南

## Reasoning Format（如有）
  - 推理格式要求

# Project Context
  ## AGENTS.md
  <内容>
  ## SOUL.md
  <内容>
  ## TOOLS.md
  <内容>
  ## IDENTITY.md
  <内容>
  ## USER.md
  <内容>

## Silent Replies（非子 Agent 模式）
  - 无内容时的回复规则

## Heartbeats（非子 Agent 模式，如有）
  - 心跳确认规则

## Runtime
  - host, os, arch, node, model, agentId, channel, capabilities（单行）
  - Reasoning 级别
```

### 6.2 Prompt 模式（promptMode）

| 模式      | 适用场景             | 省略内容                                                                                                            |
| --------- | -------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `full`    | 默认（用户直接对话） | 无                                                                                                                  |
| `minimal` | 子 Agent / Cron      | Skills、Memory Recall、Self-Update、Model Aliases、User Identity、Reply Tags、Messaging、Silent Replies、Heartbeats |
| `none`    | 仅基础身份           | 几乎全部，只返回一行身份声明                                                                                        |

`resolvePromptModeForSession()` 根据 sessionKey 自动判断：子 Agent 或 Cron session 使用 `minimal` 模式。

### 6.3 每次 LLM 调用时 Prompt 是否重新生成？

**是的，每次 `runEmbeddedAttempt` 都会重新生成系统提示词。** 但由于：

- 工作区文件内容已缓存（bootstrap-cache）
- Skills 快照已缓存（skillsSnapshot）
- 时区等静态信息不含动态时钟

系统提示词在同一 session 内通常保持稳定，有利于 LLM 提供商的 **Prompt 缓存**（如 Anthropic 的 cache_control）。

### 6.4 对话历史（Messages）的组装

除系统提示词外，每次 LLM 调用还包含完整的对话历史：

```
[system prompt]
[user message 1]
[assistant message 1]
[tool_use block]
[tool_result block]
[user message 2]
...
[当前用户消息]
```

历史记录从 `~/.openclaw/agents/<agentId>/sessions/<sessionId>.jsonl` 读取，经过以下处理：

- `limitHistoryTurns()` — 按 token 预算限制历史轮数
- `sanitizeSessionHistory()` — 清理无效消息、修复角色顺序
- `truncateOversizedToolResults()` — 截断超大工具结果

---

## 七、完整消息流程时序图

```
Client (WebSocket)
  │
  │  chat.send({ sessionKey, message, ... })
  ▼
Gateway WebSocket Handler
  │
  ├─ 1. 提取 masAuth（JWT 验证）
  ├─ 2. recordSenderContext(sessionKey, { userId, tenantId })
  │
  ▼
chat.send Core Handler
  │
  ├─ 3. 消息验证 & 清理
  ├─ 4. 写入 JSONL 会话文件
  │     ~/.openclaw/agents/<agentId>/sessions/<sessionId>.jsonl
  │
  ▼
resolveAgentRoute()  ← src/routing/resolve-route.ts
  │
  ├─ 5. 按 bindings 配置匹配路由规则
  ├─ 6. 确定 agentId（最具体优先）
  ├─ 7. 生成 sessionKey = "agent:<agentId>:<mainKey>"
  │
  ▼
runEmbeddedPiAgent()  ← src/agents/pi-embedded-runner/run.ts
  │
  ├─ 8. 解析工作区目录
  ├─ 9. 解析模型（provider/modelId）
  ├─ 10. 初始化认证配置（auth profiles）
  ├─ 11. 初始化上下文引擎（context engine）
  │
  ▼
runEmbeddedAttempt()
  │
  ├─ 12. 加载工作区引导文件（bootstrap-cache）
  │       ├─ 首次：从磁盘读取 AGENTS.md / SOUL.md / TOOLS.md / IDENTITY.md / USER.md
  │       └─ 后续：从内存缓存读取（按 sessionKey 缓存）
  │
  ├─ 13. 解析 Skills
  │       ├─ 有 skillsSnapshot → 直接使用快照
  │       └─ 无快照 → 扫描 workspace/skills/ + ~/.openclaw/skills/ + bundled
  │
  ├─ 14. 构建系统提示词 buildEmbeddedSystemPrompt()
  │       ├─ 工具列表（按策略过滤）
  │       ├─ Skills 列表（XML 格式，仅名称+描述+路径）
  │       ├─ 工作区目录
  │       ├─ 文档路径
  │       ├─ 时区信息
  │       ├─ 运行时信息（host/os/model/agentId）
  │       └─ Project Context（注入引导文件内容）
  │
  ├─ 15. 读取对话历史（JSONL）
  │       ├─ limitHistoryTurns()（按 token 预算）
  │       └─ sanitizeSessionHistory()（修复角色顺序）
  │
  ├─ 16. 运行 before_prompt_build hooks（插件钩子）
  │
  ▼
LLM API 调用（Anthropic / OpenAI / vLLM 等）
  │
  │  POST /v1/messages (Anthropic) 或 /v1/chat/completions (OpenAI)
  │  Body: { system, messages, tools, model, stream: true, ... }
  │
  ▼
subscribeEmbeddedPiSession()  ← src/agents/pi-embedded-subscribe.ts
  │
  ├─ 17. 处理流式响应
  │       ├─ 文本块 → 分块发送（blockStreaming）
  │       ├─ 工具调用 → 执行工具 → 追加 tool_result → 继续 LLM 调用
  │       └─ 推理块（thinking）→ 按 reasoningLevel 决定是否显示
  │
  ├─ 18. 写入响应到 JSONL 会话文件
  │
  ▼
Channel 消息分发
  │
  ├─ 19. 格式化回复（Markdown / 纯文本）
  ├─ 20. 分块发送（超长消息）
  └─ 21. 发送到对应渠道（WhatsApp / Telegram / Discord / Web 等）
```

---

## 八、关键设计决策总结

| 问题                             | 答案           | 机制                                                               |
| -------------------------------- | -------------- | ------------------------------------------------------------------ |
| 工作区文件是否每条消息重新加载？ | **否**         | `bootstrap-cache.ts` 按 sessionKey 内存缓存，session 滚动时失效    |
| Skills 是否每条消息重新加载？    | **否**         | `skillsSnapshot` 快照机制，有快照时跳过文件扫描                    |
| Skills 完整内容是否注入 Prompt？ | **否**         | 只注入名称+描述+路径，Agent 按需用 `read` 工具加载 SKILL.md        |
| 系统提示词是否每次重新生成？     | **是**         | 每次 `runEmbeddedAttempt` 重新组装，但内容稳定（利于 Prompt 缓存） |
| 子 Agent 的 Prompt 有何不同？    | **精简版**     | `promptMode=minimal`，省略 Skills、Memory、Self-Update 等章节      |
| 路由如何确定目标 Agent？         | **最具体优先** | peer > guildId > teamId > accountId > channel > 默认               |
| 同一 session 并发消息如何处理？  | **串行化**     | 每个 session 有独立 Lane，消息入队顺序执行                         |

---

## 九、aiemas 模块的消息持久化（补充）

```
chat.send 触发
  │
  ├─ mas4s wrapper 拦截
  │   ├─ 提取 masAuth（userId, tenantId）
  │   └─ recordSenderContext(sessionKey, { userId, tenantId })
  │       └─ senderMap.set(sessionKey, { userId, tenantId })
  │
  ├─ 核心处理器执行
  │   └─ 发出 SessionTranscriptUpdate 事件
  │
  ▼
SessionTranscriptStore.handleUpdate()
  │
  ├─ 从 senderMap 查找 { userId, tenantId }
  ├─ 创建 StoredMessage（含 userId/tenantId）
  └─ 推入缓冲区
       │
       ├─ [500ms 定时] 或 [缓冲区满 100 条]
       ▼
  SQLite (mas4s.db) session_messages 表
       ├─ sessionKey, sessionId, userId, tenantId
       ├─ role, content, timestamp, seq
       └─ archivedDate（按日归档）
```

---

## 十、对话过程中的 Context 管理

### 10.1 Context Engine 架构

OpenClaw 使用可插拔的 **ContextEngine** 接口管理对话上下文，通过 `plugins.slots.contextEngine` 配置选择引擎，默认使用内置的 `LegacyContextEngine`。

```
resolveContextEngine(config)
  │
  ├─ 读取 config.plugins.slots.contextEngine（默认 "legacy"）
  ├─ 从注册表查找对应工厂函数
  └─ 实例化并包装 SessionKeyCompat 适配层
```

**ContextEngine 接口的核心方法：**

| 方法            | 调用时机                     | 作用                               |
| --------------- | ---------------------------- | ---------------------------------- |
| `bootstrap()`   | session 首次运行前           | 初始化引擎状态，可导入历史消息     |
| `ingest()`      | 每条消息产生后               | 将消息摄入引擎存储                 |
| `ingestBatch()` | 一轮对话结束后               | 批量摄入一轮的所有消息             |
| `assemble()`    | 每次 LLM 调用前              | 在 token 预算内组装模型上下文      |
| `afterTurn()`   | 每轮对话完成后               | 执行后处理（持久化、触发压缩决策） |
| `compact()`     | 上下文溢出或超时时           | 压缩历史，减少 token 占用          |
| `maintain()`    | bootstrap/turn/compaction 后 | 执行 transcript 维护（重写、修剪） |
| `dispose()`     | run 结束时                   | 释放资源                           |

### 10.2 默认引擎（LegacyContextEngine）的行为

`LegacyContextEngine` 是向后兼容的直通实现：

```typescript
// ingest: 无操作，SessionManager 负责消息持久化
async ingest() { return { ingested: false }; }

// assemble: 直通，由 attempt.ts 中的 sanitize→validate→limit→repair 流水线处理
async assemble(params) {
  return { messages: params.messages, estimatedTokens: 0 };
}

// afterTurn: 无操作，legacy 流程直接在 SessionManager 中持久化
async afterTurn() {}

// compact: 委托给运行时的 compactEmbeddedPiSessionDirect
async compact(params) { return delegateCompactionToRuntime(params); }
```

### 10.3 对话历史的组装流水线

每次 LLM 调用前，历史消息经过以下处理链：

```
JSONL 会话文件
  │  读取全量历史
  ▼
limitHistoryTurns(messages, limit)
  │  按 token 预算限制历史轮数
  │  DM 会话：channels.<channel>.dmHistoryLimit
  │  群组/频道：channels.<channel>.historyLimit
  ▼
sanitizeSessionHistory(messages)
  │  修复角色顺序（user/assistant 必须交替）
  │  清理无效消息块
  │  修复孤立的 tool_result（无对应 tool_use）
  ▼
contextEngine.assemble({ messages, tokenBudget, prompt })
  │  在 token 预算内选择要发送的消息
  │  可选：检索增强（RAG 引擎）
  ▼
发送给 LLM API
```

### 10.4 上下文窗口管理

`resolveContextWindowInfo()` 按以下优先级确定 token 预算：

```
优先级 1：config.models.providers.<provider>.models[].contextWindow（手动配置）
优先级 2：模型元数据中的 contextWindow（自动发现）
优先级 3：config.agents.defaults.contextTokens（全局上限）
优先级 4：默认值（按模型类型）
```

硬性保护：

- `CONTEXT_WINDOW_HARD_MIN_TOKENS = 16,000` — 低于此值拒绝运行
- `CONTEXT_WINDOW_WARN_BELOW_TOKENS = 32,000` — 低于此值发出警告

### 10.5 上下文压缩（Compaction）

当上下文接近或超过 token 预算时，触发自动压缩：

```
触发条件
  ├─ 上下文溢出（LLM 返回 context_length_exceeded 错误）
  ├─ 请求超时且 token 使用率 > 65%
  └─ afterTurn 中的主动压缩决策

压缩流程（compactEmbeddedPiSession）
  │
  ├─ 1. pruneHistoryForContextShare()
  │       按 maxHistoryShare（默认 50%）分配历史 token 预算
  │       将历史分成多个 chunk，从最旧的开始丢弃
  │       修复孤立的 tool_result
  │
  ├─ 2. summarizeChunks()
  │       对被丢弃的 chunk 调用 LLM 生成摘要
  │       摘要注入为 user 消息保留在历史中
  │
  ├─ 3. 写回 JSONL 会话文件
  │       保留：摘要消息 + 最近的 N 轮对话
  │       丢弃：被摘要覆盖的旧消息
  │
  └─ 4. 触发 after_compaction hooks（插件钩子）
```

**压缩重试策略：**

- 上下文溢出：最多 3 次压缩尝试（`MAX_OVERFLOW_COMPACTION_ATTEMPTS`）
- 超时触发：最多 2 次压缩尝试（`MAX_TIMEOUT_COMPACTION_ATTEMPTS`）
- 工具结果截断：作为最后手段，截断超大 tool_result

---

## 十一、对话过程中的 Memory 管理

### 11.1 Memory 的两个层次

OpenClaw 的记忆系统分为两个层次：

| 层次               | 存储位置                                      | 加载方式                    | 适用场景                  |
| ------------------ | --------------------------------------------- | --------------------------- | ------------------------- |
| **工作区记忆文件** | `workspace/memory/YYYY-MM-DD.md`、`MEMORY.md` | 注入系统提示词（bootstrap） | 长期记忆、精选笔记        |
| **向量记忆搜索**   | `~/.openclaw/memory/<agentId>.sqlite`         | 运行时语义检索（RAG）       | 大量历史、跨 session 检索 |

### 11.2 工作区记忆文件（静态记忆）

**文件结构：**

```
workspace/
  MEMORY.md              ← 精选长期记忆（仅主私有 session 加载）
  memory/
    2026-01-15.md        ← 每日记忆日志
    2026-01-16.md
    ...
```

**加载时机：**

`MEMORY.md` 作为引导文件之一，在 session 首次运行时通过 `loadWorkspaceBootstrapFiles()` 读取，注入到系统提示词的 `# Project Context` 部分。与其他引导文件一样，**按 sessionKey 缓存，不是每条消息都重新加载**。

每日记忆文件（`memory/YYYY-MM-DD.md`）不自动注入，需要 Agent 根据 AGENTS.md 中的指令主动用 `read` 工具读取（通常在 session 开始时读取今天和昨天的记忆）。

**记忆写入：**

Agent 通过 `write`/`edit` 工具直接写入记忆文件。`resolveMemoryFlushPlan()` 提供记忆刷新计划（由记忆插件注册），包含：

- `softThresholdTokens` — 触发刷新的 token 阈值
- `forceFlushTranscriptBytes` — 强制刷新的 transcript 字节数
- `relativePath` — 写入路径（如 `memory/2026-01-16.md`）

### 11.3 向量记忆搜索（动态记忆 RAG）

**架构：**

```
memory-search 插件（可选，需配置）
  │
  ├─ 存储：SQLite（~/.openclaw/memory/<agentId>.sqlite）
  │         ├─ 向量索引（sqlite-vec 扩展）
  │         └─ FTS 全文索引（unicode61 / trigram tokenizer）
  │
  ├─ 数据来源（sources）
  │   ├─ "memory"   ← workspace/memory/*.md 文件
  │   └─ "sessions" ← 会话 JSONL（需开启 experimental.sessionMemory）
  │
  └─ 嵌入提供商（provider）
      ├─ "auto"     ← 自动选择
      ├─ 本地模型   ← ONNX/本地推理
      └─ 远程 API   ← OpenAI / 自定义 endpoint
```

**同步策略（sync）：**

| 触发方式       | 配置项                 | 默认值              |
| -------------- | ---------------------- | ------------------- |
| session 开始时 | `sync.onSessionStart`  | `true`              |
| 搜索时（按需） | `sync.onSearch`        | `true`              |
| 文件变更监听   | `sync.watch`           | `true`，防抖 1500ms |
| 定时同步       | `sync.intervalMinutes` | `0`（禁用）         |

**会话记忆同步触发条件（满足任一）：**

- 新增字节数 > `sync.sessions.deltaBytes`（默认 100KB）
- 新增消息数 > `sync.sessions.deltaMessages`（默认 50 条）
- 压缩后强制同步（`sync.sessions.postCompactionForce: true`）

**检索配置（query）：**

```
混合检索（hybrid search）
  ├─ 向量相似度（默认权重 0.7）
  ├─ 全文检索 FTS（默认权重 0.3）
  ├─ MMR 去重（默认关闭）
  └─ 时间衰减（默认关闭，半衰期 30 天）

默认参数：
  maxResults: 6
  minScore: 0.35
  candidateMultiplier: 4（候选集 = maxResults × 4）
```

**记忆检索在 Prompt 中的呈现：**

`buildMemoryPromptSection()` 由记忆插件注册，注入到系统提示词的 `## Memory` 部分（非子 Agent 模式）。该部分告知 Agent 如何使用 `memory_search` 工具检索相关记忆，以及引用格式（`citationsMode`）。

### 11.4 Memory 在 Prompt 中的完整注入路径

```
buildAgentSystemPrompt()
  │
  ├─ buildMemorySection()
  │   └─ buildMemoryPromptSection()  ← 由记忆插件注册的 builder
  │       └─ 注入 ## Memory 章节
  │           ├─ 如何使用 memory_search 工具
  │           └─ 引用格式说明
  │
  └─ # Project Context
      ├─ ## AGENTS.md（含记忆使用规则）
      ├─ ## SOUL.md
      ├─ ## MEMORY.md（如存在，精选长期记忆）
      └─ ...其他引导文件
```

### 11.5 Memory 配置示例

```json5
{
  agents: {
    defaults: {
      memorySearch: {
        enabled: true,
        sources: ["memory", "sessions"], // 同时索引记忆文件和会话历史
        provider: "auto",
        store: {
          path: "~/.openclaw/memory/{agentId}.sqlite",
          vector: { enabled: true },
          fts: { tokenizer: "unicode61" },
        },
        sync: {
          onSessionStart: true,
          watch: true,
          watchDebounceMs: 1500,
          sessions: {
            deltaBytes: 100000,
            deltaMessages: 50,
            postCompactionForce: true,
          },
        },
        query: {
          maxResults: 6,
          minScore: 0.35,
          hybrid: {
            enabled: true,
            vectorWeight: 0.7,
            textWeight: 0.3,
          },
        },
      },
    },
  },
}
```

---

## 十二、Context + Memory 完整加载时序

```
新 Session 第一条消息
  │
  ├─ [一次性] bootstrap-cache 未命中
  │   └─ loadWorkspaceBootstrapFiles()
  │       读取 AGENTS.md / SOUL.md / TOOLS.md / IDENTITY.md
  │       USER.md / HEARTBEAT.md / MEMORY.md
  │       → 缓存到 bootstrap-cache[sessionKey]
  │
  ├─ [一次性] contextEngine.bootstrap()
  │   └─ 初始化引擎状态（legacy: 无操作）
  │
  ├─ [一次性] memory sync（如启用）
  │   └─ sync.onSessionStart = true
  │       → 扫描 workspace/memory/*.md
  │       → 生成嵌入向量
  │       → 写入 SQLite 向量索引
  │
  └─ 构建系统提示词
      ├─ ## Memory 章节（memory_search 工具使用指南）
      └─ # Project Context（注入 MEMORY.md 等引导文件）

─────────────────────────────────────────────────────

后续每条消息（同一 Session）
  │
  ├─ [缓存命中] bootstrap-cache[sessionKey] → 直接使用
  │
  ├─ [按需] memory_search 工具调用
  │   └─ Agent 主动触发语义检索
  │       ├─ sync.onSearch = true → 先同步再检索
  │       ├─ 混合检索（向量 + FTS）
  │       └─ 返回 top-K 相关片段注入对话
  │
  ├─ 历史消息组装
  │   ├─ limitHistoryTurns()（按 historyLimit 截断）
  │   ├─ sanitizeSessionHistory()（修复角色顺序）
  │   └─ contextEngine.assemble()（token 预算内选择消息）
  │
  └─ LLM 调用
      │
      ├─ 成功 → contextEngine.afterTurn()
      │           └─ 后处理、主动压缩决策
      │
      └─ 上下文溢出 / 超时
          └─ contextEngine.compact()
              ├─ pruneHistoryForContextShare()
              ├─ summarizeChunks()（LLM 生成摘要）
              └─ 写回 JSONL，重试

─────────────────────────────────────────────────────

文件变更（workspace/memory/*.md 被修改）
  │
  └─ [后台] 文件监听器触发（防抖 1500ms）
      └─ 增量同步到 SQLite 向量索引
```

---

## 十三、关键设计决策补充

| 问题                       | 答案                                                         | 机制                               |
| -------------------------- | ------------------------------------------------------------ | ---------------------------------- |
| MEMORY.md 何时加载？       | session 首次运行时，之后缓存                                 | bootstrap-cache，同其他引导文件    |
| 每日记忆文件如何加载？     | Agent 主动 `read` 工具读取                                   | AGENTS.md 中的指令驱动             |
| 向量记忆何时同步？         | session 开始、搜索时、文件变更、定时                         | sync 配置控制                      |
| 上下文溢出如何处理？       | 自动压缩 + LLM 摘要                                          | compaction 流水线，最多 3 次重试   |
| 历史记录如何限制？         | 按 historyLimit 截断最旧的轮次                               | limitHistoryTurns()，可按渠道配置  |
| ContextEngine 可以替换吗？ | 可以，通过插件注册                                           | `plugins.slots.contextEngine` 配置 |
| 记忆检索结果如何注入？     | Agent 调用 memory_search 工具，结果作为 tool_result 进入对话 | 工具调用机制，非系统提示词注入     |
