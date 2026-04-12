# 需求文档：A2A 通信 — AIEMAS 工具注入点 + `aiemas_sessions_send`

## 简介

本功能基于方案 G（新版）实现 A2A（Agent-to-Agent）通信能力。核心思路是在 `Mas4sIntegration` 接口中新增 `resolveAgentTools` 方法，建立通用的 AIEMAS Agent 工具注入点，然后实现 `aiemas_sessions_send` 工具。该工具接收 `agentId` + `message` 参数，内部根据 `aiemas_sessions.descendantSessions` 自动解析目标 sessionKey，再通过依赖注入的 `callSessionsSend` 回调调用 `sessions_send` 完成实际调度。Agent 用户无需了解 sessionKey 派生规则或 session 级联机制等内部实现细节。

本功能依赖已完成的 `a2a-session-cascade` spec（session 级联创建机制），`aiemas_sessions` 表和 `descendantSessions` 字段是本功能的数据基础。

## 术语表

- **Mas4sIntegration**：Gateway 核心中 AIEMAS 集成的接口定义，位于 `src/gateway/mas4s-integration.ts`，提供 `extraHandlers`、`interceptRequest`、`filterBroadcast` 等集成点
- **resolveAgentTools**：`Mas4sIntegration` 接口中新增的方法，用于将 AIEMAS 提供的 Agent 工具注入到 `createOpenClawTools()` 的工具集中
- **createOpenClawTools**：Gateway 核心中创建 Agent 工具列表的函数，位于 `src/agents/openclaw-tools.ts`，LLM 在运行时可调用的所有工具均在此注册
- **aiemas_sessions_send**：AIEMAS 提供的 Agent 工具，封装 `sessions_send` 的调用，接收 `agentId` + `message` 参数，自动解析目标 sessionKey
- **callSessionsSend**：依赖注入的回调函数，由 `initMas4sIntegration` 在桥接层构造，内部调用 `createSessionsSendTool().execute()` 完成实际的 `sessions_send` 调用
- **aiemas_sessions 表**：持久化根 Agent session 记录的数据库表，存储在 `mas4s.db` 中，其 `descendantSessions` 字段维护所有后代 Agent 的 sessionKey 和 sessionId 映射
- **descendantSessions**：`aiemas_sessions` 表中的 JSON 字段，格式为 `[{"agentId":"xxx","sessionKey":"agent:xxx:group:yyy","sessionId":"zzz"}]`，记录根 Agent 的所有后代 Agent session 信息
- **SessionCascadeService**：已实现的 session 级联服务，位于 `aiemas/src/gateway-bridge/aiemas-session.ts`，负责级联创建和删除后代 Agent session
- **TopologyCache**：内存中的拓扑关系缓存，维护 rootAgentId → TopologyTree 的映射
- **AnyAgentTool**：Gateway 核心中 Agent 工具的通用类型定义，所有注册到 `createOpenClawTools()` 的工具均实现此接口
- **agentSessionKey**：当前 Agent 的 sessionKey，格式为 `agent:{agentId}:group:{sessionUuid}`，由 `createOpenClawTools` 的 options 传入
- **AGENTS.md**：Agent 的工作空间配置文件，定义 Agent 的行为规则、路由表和调度方式

## 需求

### 需求 1：扩展 Mas4sIntegration 接口 — 新增 resolveAgentTools 方法

**用户故事：** 作为系统架构师，我希望 `Mas4sIntegration` 接口提供通用的 Agent 工具注入能力，以便 AIEMAS 可以向 Agent 工具集中注入自定义工具，而无需直接修改 Gateway 核心的工具注册代码。

#### 验收标准

1. THE Mas4sIntegration 接口 SHALL 新增一个可选的 `resolveAgentTools` 方法，该方法接收包含 `agentSessionKey` 和 `config` 的上下文对象，返回 AnyAgentTool 数组
2. WHEN `resolveAgentTools` 方法未定义时（如 AIEMAS 插件未加载），THE createOpenClawTools 函数 SHALL 正常返回现有工具列表，不受影响
3. WHEN `resolveAgentTools` 方法已定义且返回非空数组时，THE createOpenClawTools 函数 SHALL 将返回的工具追加到现有工具列表末尾
4. THE `resolveAgentTools` 方法 SHALL 在 `createOpenClawTools()` 中插件工具解析之前调用，确保 AIEMAS 工具优先于插件工具注册
5. IF `resolveAgentTools` 方法执行时抛出异常，THEN THE createOpenClawTools 函数 SHALL 捕获异常并记录警告日志，继续返回现有工具列表

### 需求 2：实现 aiemas_sessions_send 工具

**用户故事：** 作为编排 Agent 的使用者，我希望通过 `aiemas_sessions_send` 工具只传 `agentId` 和 `message` 即可向子 Agent 发送消息，无需了解 sessionKey 派生规则或 session 级联机制。

#### 验收标准

1. THE aiemas_sessions_send 工具 SHALL 接收以下参数：`agentId`（必填，目标子 Agent 的 ID）、`message`（必填，要发送的消息）、`timeoutSeconds`（可选，等待回复的超时秒数，默认 30）
2. WHEN aiemas_sessions_send 被调用时，THE 工具 SHALL 从工具上下文中获取调用者的 agentSessionKey，并从中提取 sessionUuid
3. WHEN 调用者的 agentSessionKey 在 `aiemas_sessions` 表中存在记录时，THE 工具 SHALL 从该记录的 `descendantSessions` 字段中查找与目标 `agentId` 匹配的 sessionKey
4. IF `descendantSessions` 中未找到目标 agentId 的记录，THEN THE 工具 SHALL 使用 sessionUuid 按派生规则构造目标 sessionKey（格式：`agent:{agentId}:group:{sessionUuid}`）作为 fallback
5. WHEN 调用者的 agentSessionKey 在 `aiemas_sessions` 表中不存在记录时，THE 工具 SHALL 直接使用 sessionUuid 按派生规则构造目标 sessionKey 作为 fallback
6. WHEN 目标 sessionKey 确定后，THE 工具 SHALL 通过 `callSessionsSend` 回调调用 `sessions_send`，传入 `sessionKey`、`message` 和 `timeoutSeconds` 参数
7. THE aiemas_sessions_send 工具 SHALL 返回 `callSessionsSend` 回调的执行结果，保持与 `sessions_send` 相同的返回格式
8. IF 调用者的 agentSessionKey 为空或无法解析 sessionUuid，THEN THE 工具 SHALL 返回包含错误信息的 JSON 结果

### 需求 3：依赖注入 — callSessionsSend 回调构造

**用户故事：** 作为系统架构师，我希望 `aiemas_sessions_send` 工具通过依赖注入调用 `sessions_send`，AIEMAS 代码不直接导入 Gateway 核心模块，以保持架构边界清晰。

#### 验收标准

1. THE `callSessionsSend` 回调 SHALL 在 `initMas4sIntegration` 函数中构造，内部调用 `createSessionsSendTool().execute()` 完成实际的 `sessions_send` 调用
2. THE `callSessionsSend` 回调 SHALL 接收 `sessionKey`、`message` 和 `timeoutSeconds` 参数，返回 `sessions_send` 工具的执行结果
3. THE `callSessionsSend` 回调 SHALL 继承调用者的 `agentSessionKey`、`agentChannel` 和 `config` 上下文，确保权限检查、同步等待、A2A Flow 等能力完整保留
4. THE `createAiemasSessionsSendTool` 函数 SHALL 实现在 `aiemas/src/gateway-bridge/aiemas-tools.ts` 中，仅定义工具的参数 schema 和 sessionKey 解析逻辑，不导入任何 Gateway 核心模块（`src/` 目录下的模块）

### 需求 4：在 initMas4sIntegration 中注册工具

**用户故事：** 作为系统开发者，我希望 AIEMAS 工具通过 `resolveAgentTools` 注入点注册到 Agent 工具集中，由 `initMas4sIntegration` 在桥接层完成工具实例的创建和依赖注入。

#### 验收标准

1. THE `initMas4sIntegration` 函数 SHALL 在返回的 `Mas4sIntegration` 对象中实现 `resolveAgentTools` 方法
2. WHEN `resolveAgentTools` 被调用时，THE 方法 SHALL 创建 `aiemas_sessions_send` 工具实例，传入 `db`（数据库实例）、`topologyCache`（拓扑缓存）和 `callSessionsSend`（依赖注入回调）
3. THE `callSessionsSend` 回调 SHALL 在 `resolveAgentTools` 内部构造，使用 `createSessionsSendTool` 创建 `sessions_send` 工具实例，并将调用者的 `agentSessionKey` 和 `config` 传入
4. THE `resolveAgentTools` 方法 SHALL 返回工具数组，支持未来扩展更多 AIEMAS 工具

### 需求 5：修改 AGENTS.md — 调度方式改为 aiemas_sessions_send

**用户故事：** 作为编排 Agent 的使用者，我希望 AGENTS.md 中的调度方式使用 `aiemas_sessions_send` 工具，只需传 `agentId` 和 `message`，无需手动派生 sessionKey。

#### 验收标准

1. THE `.openclaw/workspace-aieiaas/AGENTS.md` 中的调度方式章节 SHALL 将所有 `sessions_send` 调用替换为 `aiemas_sessions_send` 调用
2. THE 调度方式示例 SHALL 仅包含 `agentId`、`message` 和 `timeoutSeconds` 参数，不包含 `sessionKey` 参数
3. THE AGENTS.md SHALL 移除"子 Agent SessionKey 派生规则"章节（如果存在），因为 Agent 用户不再需要了解 sessionKey 派生规则
4. THE AGENTS.md SHALL 移除"会话启动时获取 sessionKey"步骤（如果存在），因为 Agent 用户不再需要获取自己的 sessionKey 来构造子 Agent 的 sessionKey
5. THE AGENTS.md 中的调度方式注意事项 SHALL 说明子 Agent 的 session 已通过级联机制预创建，`aiemas_sessions_send` 会自动解析目标 sessionKey

### 需求 6：架构边界与 Import 约束

**用户故事：** 作为系统架构师，我希望本功能的实现严格遵守架构边界约束，AIEMAS 代码不直接导入 Gateway 核心模块，Gateway 核心对 AIEMAS 的改动最小化。

#### 验收标准

1. THE `aiemas/src/gateway-bridge/aiemas-tools.ts` 文件 SHALL 不包含任何从 `src/` 目录（Gateway 核心）导入的 import 语句
2. THE `src/gateway/mas4s-integration.ts` 的改动 SHALL 仅限于：接口新增 `resolveAgentTools` 方法定义、`initMas4sIntegration` 返回值中实现该方法
3. THE `src/agents/openclaw-tools.ts` 的改动 SHALL 仅限于：在工具列表构建完成后、插件工具解析之前，调用 `resolveAgentTools` 注入 AIEMAS 工具
4. THE Gateway 核心对 AIEMAS 的改动 SHALL 不超过 3 个文件（`mas4s-integration.ts` 接口定义、`mas4s-integration.ts` 实现、`openclaw-tools.ts` 注入调用）
5. THE `aiemas_sessions_send` 工具的 sessionKey 解析逻辑 SHALL 仅依赖 `aiemas/src/store/aiemas-sessions-store.ts` 和 `aiemas/src/utils/session-utils.ts` 中的函数，不依赖 Gateway 核心模块

### 需求 7：错误处理与容错

**用户故事：** 作为编排 Agent 的使用者，我希望 `aiemas_sessions_send` 在各种异常情况下提供清晰的错误信息，不导致 Agent 运行中断。

#### 验收标准

1. IF 调用者的 agentSessionKey 为空或 undefined，THEN THE aiemas_sessions_send 工具 SHALL 返回 JSON 格式的错误结果，包含 `status: "error"` 和描述性错误信息
2. IF 从 agentSessionKey 中无法提取有效的 sessionUuid，THEN THE aiemas_sessions_send 工具 SHALL 返回 JSON 格式的错误结果
3. IF `callSessionsSend` 回调执行失败（如 Gateway 超时或网络错误），THEN THE aiemas_sessions_send 工具 SHALL 将错误信息包装为 JSON 格式返回，不抛出未捕获的异常
4. IF `aiemas_sessions` 表查询失败（如数据库连接问题），THEN THE aiemas_sessions_send 工具 SHALL 回退到使用派生规则构造 sessionKey，并记录警告日志
5. WHEN `resolveAgentTools` 在 `createOpenClawTools` 中被调用时抛出异常，THE createOpenClawTools 函数 SHALL 记录警告日志并继续返回不含 AIEMAS 工具的工具列表
