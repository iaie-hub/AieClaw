# IaaS Multi-Agent A2A 通信问题分析与解决方案

本文记录并分析了 IaaS 多 Agent 协作场景下，由于 Agent-to-Agent (A2A) 通信机制不健全导致的调度失败问题，并详细总结了从初步探索到最终采用 **AIEMAS Tool Injection** 方案的全过程。

---

## 一、问题 (Problem)

### 1.1 问题背景

用户通过 webchat-ui 向编排 Agent（aie-iaas）发送“列出所有虚拟机”，编排 Agent 正确识别意图后尝试通过 `sessions_send` 调度子 Agent（aieiaas-resource），但整个调度链路由于 Session 定位机制缺失而失败。

### 1.2 请求执行路径追踪 (Path Tracing)

1.  **Step 1：意图识别 ✅** —— 编排 Agent 正确识别关键词，按路由表匹配到资源管理领域。
2.  **Step 2：首次 sessions_send ❌** —— 调用 `sessions_send(agentId="aieiaas-resource", message="查询所有虚拟机列表", timeoutSeconds=30)`。返回错误：`"Either sessionKey or label is required"`。编排 Agent 缺少必需的 Session 定位参数。
3.  **Step 3：sessions_list 查找 ⚠️** —— 编排 Agent 试图查找 `Kinds=["subagent"]` 的 session，但仅返回其自身的 session。aieiaas-resource 此时无活跃 session。
4.  **Step 4：错误重试 ❌** —— 编排 Agent 错误地使用自己的 sessionKey 重新调用，导致消息循环。
5.  **Step 5：Gateway 超时 ❌** —— 消息无法路由到目标 Agent，最终触发 `gateway timeout after 10000ms`。

### 1.3 根因分析 (Root Cause Analysis)

1.  **根因 1：sessions_send 的 agentId 参数不能独立定位目标 session**。根据 `sessions-send-tool.ts` 源码，`agentId` 仅配合 `label` 使用，不能独立定位。
2.  **根因 2：aieiaas-resource 子 Agent 没有活跃 session**。`sessions_list` 表明子 Agent 尚未建立任何会话上下文。
3.  **根因 3：AGENTS.md 路由表的调用示例与实际 API 不匹配**。LLM（Qwen3.5）按照错误的示例生成了不完整的调用。
4.  **根因 4：缺少子 Agent session 初始化机制**。设计上未定义子 Agent session 的启动与预创建流程。

---

## 二、方案评估 (Solution Evaluation)

### 2.1 解决路径初步探索 (Paths A-D)

#### 路径 A：通过 label 查找（不可行）

- **思路**：利用 `sessions_send(label="xxx", agentId="aieiaas-resource")`。
- **结论**：不可行。`sessions.resolve` 只能查找已存在的记录，若子 Agent 未曾被触发，则无法通过 label 发现。

#### 路径 B：通过 sessionKey 派生（推荐级别：高）

- **思路**：编排 Agent 从自己的 sessionKey（`agent:aieiaas:{kind}:{suffix}`）派生子 Agent 的 Key。
- **代码级可行性验证**：
  1.  `resolveSessionReference` 会识别标准格式 Key 并直接返回，无需 session 预先存在。
  2.  `visibilityGuard.check` 通过 A2A 策略校验（需配置 `a2aPolicy.enabled=true`）。
  3.  Gateway 的 `agent` 方法在 `loadSessionEntry` 缺失时会自动创建 session。
- **派生规则**：替换第二段 `agentId` 段，其余保持不变。
- **风险**：依赖 LLM 字符串操作的准确性。

#### 路径 C：系统启动时预创建（备选）

- **思路**：通过脚本在 Gateway 启动后为每个子 Agent 预调用 `sessions.create`。
- **优点**：确定性高。**缺点**：增加维护复杂度，且 Key 不随根会话变化。

#### 路径 D：修改 sessions_send 支持 agentId-only 模式（不推荐）

- **结论**：违反架构解耦约束，需修改公共核心代码，成本过高。

#### 方案对比表 (Initial)

| 方案                         | 可行性    | 改动范围       | 确定性 | 推荐度      |
| :--------------------------- | :-------- | :------------- | :----- | :---------- |
| **路径 A：label 查找**       | ❌ 不可行 | —              | —      | —           |
| **路径 B：sessionKey 派生**  | ✅ 可行   | 仅改 AGENTS.md | 中     | ⭐⭐⭐ 推荐 |
| **路径 C：预创建 session**   | ✅ 可行   | 需启动脚本     | 高     | ⭐⭐ 备选   |
| **路径 D：改 sessions_send** | ✅ 可行   | 需改核心代码   | 高     | ⭐ 不推荐   |

### 2.2 Session 生命周期补充说明

- **自动创建**：传入不存在的 sessionKey 时，Gateway 会自动设置 `isNewSession=true` 并持久化 entry。
- **释放机制**：隐式创建的 session 不会自动释放，需通过 webchat UI 或 CLI 手动删除。
- **Key 后缀控制**：`toAgentStoreSessionKey` 逻辑保证了显式传参时 Key 的原样保留。

### 2.3 补充方案评估 (Paths E-F)

#### 方案 E：在 AGENTS.md 中显式指定调度参数

- **思路**：在编排 Agent 的提示词中硬编码派生逻辑。
- **风险**：LLM 可能无法完美执行字符串替换；且系统提示词中不默认包含当前 sessionKey。

#### 方案 F：基于拓扑关系自动构建 (F1-F3)

- **F1：新增 AIEMAS RPC `aiemas.sessions.send`**：工作量极大，且易导致逻辑不一致。
- **F2：在核心 `sessions_send` 中注入 AIEMAS 解析**：违反架构约束。
- **F3：AGENTS.md 指导 + 级联预创建保障（前期最优）**：依赖 `aiemas.sessions.create` 的级联能力，子 Agent session 已共享相同的 `sessionUuid`。

### 2.4 方案 G 深度评估：封装 aiemas_sessions_send 工具

#### 8.1 方案描述

新增 Agent 工具 `aiemas_sessions_send`，接收 `agentId` + `message`，内部根据 `descendantSessions` 自动解析并调用 `sessions_send`。

#### 8.2 架构路径分析

1.  **修改 Gateway 核心**（违规）：直接在 `openclaw-tools.ts` 中添加工具。
2.  **插件工具机制**（不适用）：AIEMAS 非标准插件。
3.  **注入模式**（推荐）：在 Gateway 中建立工具注入钩子。

#### 8.3 实现可行性

- **调用方式 A**：内部执行 `createSessionsSendTool().execute()`。可复用完整逻辑，但面临 Import Boundary 挑战。
- **调用方式 B**：直接通过 `callGateway("agent", ...)` 注入。丢失了同步等待和权限检查。

#### 8.4 最终重新评估：注入点 + aiemas_sessions_send (New G)

- **核心收益**：完全封装内部实现，零代码入侵 Gateway 核心（通过 `Mas4sIntegration` 钩子），支持未来扩展。

---

## 三、方案实施 (Solution Implementation)

### 3.1 核心方案：AIEMAS Tool Injection

方案已于 2026-04-11 完成实施，核心逻辑是将 AIEMAS 工具通过后置钩子注入。

#### 3.1.1 内部实现细节 (Code Analysis Path)

1.  **Mas4sIntegration 扩展**：正式支持 `resolveAgentTools` 钩子。
2.  **下游注入点**：位于 `src/agents/pi-tools.ts` 的 `coding` Profile 管道处理之后，避开了权限白名单的拦截。
3.  **依赖注入模式**：`createAiemasSessionsSendTool` 通过回调方式调用核心 `sessions_send`，实现了协议复用的同时维持了模块边界。

#### 3.1.2 实施清单

| 组件            | 修改内容                                                                                 |
| :-------------- | :--------------------------------------------------------------------------------------- |
| **Core API**    | `src/gateway/mas4s-integration.ts` 新增工具钩子定义。                                    |
| **Tool Set**    | `src/agents/pi-tools.ts` 实现后置工具注入逻辑。                                          |
| **AIEMAS Tool** | `aiemas/src/gateway-bridge/aiemas-tools.ts` 实现 SessionKey 自动解析与派生。             |
| **Prompt**      | `src/agents/system-prompt.ts` 增强引导词，强制模型使用 `aiemas_sessions_send` 进行 A2A。 |
| **Docs**        | `workspace-aieiaas/AGENTS.md` 更新调度示例。                                             |

### 3.2 方案 F3 的具体修改（保留作为派生规则参考）

若需手动维护 SessionKey，需遵循以下逻辑：

- **获取 Key**：调用 `session_status(sessionKey="current")` 获取当前 UUID。
- **派生公式**：将 `agent:aieiaas:group:{uuid}` 替换为 `agent:{childId}:group:{uuid}`。

### 3.3 进阶优化：超时与状态感知增强 (2026-04-12)

1.  **Gateway 状态机增强**：在 `waitForAgentJob` 中捕获 `approval` 事件，支持 `blocked`（等待审批）和 `running`（长耗时处理中）状态。
2.  **SDK 状态透传**：`run-wait.ts` 和 `sessions-send-tool.ts` 能够无损返回非终端状态，避免误报“Agent response timeout”。
3.  **业务语义翻译**：`aiemas_sessions_send` 内部将底层状态映射为指导性建议，例如提示用户：“资源创建正在进行中，请在聊天窗口点击‘审批’以继续。”

---

> [!IMPORTANT]
> **结论**：通过方案 G 的注入模式，我们不仅实现了 A2A 通信的连通性，更构建了具备状态感知能力的多 Agent 协作体系。所有历史上探索过的路径（A-F）均为这一最终形态提供了关键的架构参考。
