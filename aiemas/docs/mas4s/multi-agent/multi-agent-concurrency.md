# 多 Agent 并发执行需求

## 一、背景

### 1.1 当前架构

用户创建会话时选择的 Agent 为编排 Agent（如 `workspace-aieiaas/AGENTS.md` 中定义的 IaaS Orchestrator）。编排 Agent 配置了拓扑关系，管理多个子 Agent（如 `aieiaas-resource`、`aieiaas-model`、`aieiaas-task`、`aieiaas-monitor`）。

当编排 Agent 收到用户消息时，会根据路由表判断需要调用哪些子 Agent，然后通过 `aiemas_sessions_send` 工具将请求转发给对应的子 Agent。

### 1.2 现状问题

编排 Agent（LLM）在处理需要多个子 Agent 协作的请求时，会**并发调用多次 `aiemas_sessions_send`**。例如用户发送"列出云平台中的物理机列表，模型广场中的模型列表，命令任务列表，Token 调用统计报告"，编排 Agent 会同时发起 4 次 `aiemas_sessions_send` 调用，分别转发给 resource、model、task、monitor 四个子 Agent。

**但实际执行效果是串行的，而非并发。** 从截图可以看到：

- 09:32:08 编排 Agent 同时发起 4 次 `aiemas_sessions_send` 调用
- 09:33:25 才收到 `ToolResult: tool_result`（耗时约 77 秒）

虽然 LLM 并发发起了 4 次工具调用，但子 Agent 的实际执行是串行排队的，效率低下。

### 1.3 根因分析

子 Agent 串行执行的根因在于 Gateway 的 **Lane 队列机制**：

```
aiemas_sessions_send(agentId="aieiaas-resource", message="...")
  → callSessionsSend → sessions_send.execute()
    → callGateway("agent", { sessionKey, lane: "nested", ... })
      → Gateway dispatchAgentRunFromGateway()
        → enqueueCommandInLane("nested", agentTask)
```

**关键约束：**

1. **所有 `sessions_send` 调用共享同一个 `nested` Lane**：`sessions_send` 工具硬编码使用 `AGENT_LANE_NESTED`（即 `"nested"` Lane），所有跨 session 消息都进入同一个队列。

2. **Lane 的 `maxConcurrent` 默认为 1**：`command-queue.ts` 中 Lane 初始化时 `maxConcurrent: 1`，且 `applyGatewayLaneConcurrency` 中没有为 `nested` Lane 设置并发数（只设置了 `main`、`cron`、`subagent` 三个 Lane 的并发数）。

3. **`sessions_send` 是同步等待模式**：`aiemas_sessions_send` 调用 `callSessionsSend` 时使用同步模式（`timeoutSeconds=600`），会调用 `agent.wait` 阻塞等待子 Agent 运行完成后才返回结果。

**串行执行的完整链路：**

```
编排 Agent (LLM) 并发发起 4 次 aiemas_sessions_send
  │
  ├─ 调用 1: aiemas_sessions_send(aieiaas-resource)
  │   → sessions_send → callGateway("agent") → nested Lane 入队
  │   → agent.wait 阻塞等待 resource 完成
  │
  ├─ 调用 2: aiemas_sessions_send(aieiaas-model)
  │   → sessions_send → callGateway("agent") → nested Lane 入队（排在 resource 后面）
  │   → agent.wait 阻塞等待 model 完成
  │
  ├─ 调用 3: aiemas_sessions_send(aieiaas-task)
  │   → sessions_send → callGateway("agent") → nested Lane 入队（排在 model 后面）
  │   → agent.wait 阻塞等待 task 完成
  │
  └─ 调用 4: aiemas_sessions_send(aieiaas-monitor)
      → sessions_send → callGateway("agent") → nested Lane 入队（排在 task 后面）
      → agent.wait 阻塞等待 monitor 完成

nested Lane (maxConcurrent=1):
  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
  │ resource │→ │  model   │→ │   task   │→ │ monitor  │
  └──────────┘  └──────────┘  └──────────┘  └──────────┘
  执行中          排队等待       排队等待       排队等待
```

**结果：** 4 个子 Agent 严格串行执行，总耗时 = resource 耗时 + model 耗时 + task 耗时 + monitor 耗时。如果每个子 Agent 平均耗时 20 秒，总耗时约 80 秒。若能并发执行，总耗时仅为 max(各子 Agent 耗时) ≈ 20 秒。

---

## 二、需求目标

### 2.1 核心目标

**编排 Agent 并发调用多个子 Agent 时，子 Agent 应能并发执行，而非串行排队。**

### 2.2 预期效果

| 指标                | 当前（串行）                         | 目标（并发）                  |
| ------------------- | ------------------------------------ | ----------------------------- |
| 4 个子 Agent 总耗时 | ~80s（各 Agent 耗时之和）            | ~20s（各 Agent 耗时的最大值） |
| 用户感知延迟        | 长，逐个返回                         | 短，几乎同时返回              |
| 资源利用率          | 低，同一时刻只有 1 个子 Agent 在运行 | 高，多个子 Agent 同时运行     |

### 2.3 约束条件

1. **不改动核心 Gateway 的 Lane 队列机制**：Lane 的 `maxConcurrent=1` 是核心设计，保证同一 session 内消息的串行执行，防止并发写入 session 历史导致数据竞争。不应为了 AIEMAS 的需求修改核心行为。
2. **保持 `sessions_send` 工具的通用语义不变**：`sessions_send` 是通用的跨 session 消息工具，其行为不应因 AIEMAS 的需求而改变。
3. **最小入侵原 Gateway**：改动应尽量闭环在 `aiemas/` 目录内，遵循 AIEMAS 架构约束。
4. **保持同步等待语义**：编排 Agent 需要拿到所有子 Agent 的回复后才能汇总结果，因此 `aiemas_sessions_send` 仍需支持同步等待模式。
5. **兼容现有审批机制**：并发执行不应破坏已有的 exec 审批流程（参考 `iaas-multi-agent-repeat-approve.md`）。

---

## 三、问题拆解

实现多 Agent 并发执行需要解决以下两个层面的问题：

### 3.1 问题一：Lane 队列串行瓶颈

**现状：** 所有 `sessions_send` 调用的目标 Agent 运行都进入同一个 `nested` Lane，`maxConcurrent=1` 导致严格串行。

**核心矛盾：** Lane 的串行约束是为了保护**同一 session** 的数据一致性（防止并发写入同一个 session 的 JSONL 历史文件）。但 AIEMAS 的场景中，编排 Agent 并发调用的是**不同子 Agent 的不同 session**，它们之间没有数据竞争，不需要串行化。

**需要解决：** 如何让不同 session 的 Agent 运行能够并发执行，同时保持同一 session 内的串行保证。

### 3.2 问题二：`aiemas_sessions_send` 的同步等待阻塞

**现状：** `aiemas_sessions_send` 内部调用 `callSessionsSend`，后者调用 `sessions_send.execute()`，该函数在同步模式下会：

1. 调用 `callGateway("agent")` 提交 Agent 运行（立即返回 `runId`）
2. 调用 `readLatestAssistantReplySnapshot` 获取 baseline
3. 调用 `waitForAgentRunAndReadUpdatedAssistantReply` 阻塞等待运行完成

虽然步骤 1 是异步提交（fire-and-forget），但步骤 3 的 `agent.wait` 会阻塞当前调用直到 Agent 运行完成。

**但这不是真正的瓶颈：** LLM 并发发起的 4 次 `aiemas_sessions_send` 工具调用，在 Gateway 的工具执行框架中是**并行执行**的（每次工具调用是独立的 async 函数）。4 个 `agent.wait` 调用可以同时等待。真正的瓶颈在于 Lane 队列——即使 4 个 `agent.wait` 同时在等，nested Lane 也只会同时执行 1 个 Agent 运行。

---

## 四、方案设计方向

### 方向 A：提升 nested Lane 并发数

**思路：** 将 `nested` Lane 的 `maxConcurrent` 从 1 提升到更高的值（如 4 或 8）。

**优点：** 改动最小，只需在 `applyGatewayLaneConcurrency` 中增加一行配置。

**风险：**

- `nested` Lane 是所有 `sessions_send` 共享的，不仅 AIEMAS 使用。提升并发数可能导致非 AIEMAS 场景下同一 session 的并发写入问题。
- 需要确认 session 历史文件（JSONL）的写入是否有文件级锁保护。如果没有，并发写入同一 session 的 JSONL 文件会导致数据损坏。
- 改动了核心 Gateway 行为，违反"最小入侵"约束。

**适用条件：** 如果能确认不同 sessionKey 的 Agent 运行之间没有共享状态冲突，且 Lane 机制支持 per-session 的串行保证（而非全局串行），则此方案可行。

### 方向 B：为 AIEMAS 使用独立 Lane

**思路：** AIEMAS 的 `aiemas_sessions_send` 不使用默认的 `nested` Lane，而是为每个子 Agent 分配独立的 Lane（如 `aiemas:<agentId>`），或使用一个 AIEMAS 专用的高并发 Lane。

**优点：**

- 不影响核心 `nested` Lane 的行为
- AIEMAS 的并发控制独立于核心机制

**风险：**

- 需要修改 `callSessionsSend` 的调用方式，使其能指定自定义 Lane
- `sessions_send` 工具当前硬编码 `lane: AGENT_LANE_NESTED`，需要支持 Lane 参数化
- 改动涉及 `sessions-send-tool.ts`（核心模块），与上游同步冲突风险较高

### 方向 C：AIEMAS 层面绕过 Lane 队列

**思路：** `aiemas_sessions_send` 不通过 `sessions_send` 工具，而是直接调用 `callGateway("agent")` 提交 Agent 运行，绕过 Lane 队列的串行约束。

**优点：**

- 完全闭环在 AIEMAS 模块内，不改动核心代码
- 可以自由控制并发策略

**风险：**

- 绕过 Lane 队列意味着失去了 Gateway 的并发保护，需要 AIEMAS 自行保证不会对同一 session 并发写入
- 需要自行实现 `agent.wait` + `chat.history` 的回复读取逻辑
- 实现复杂度较高

### 方向 D：AIEMAS 层面并发提交 + 并发等待

**思路：** 在 `aiemas_sessions_send` 工具层面实现并发优化，不改变底层 `sessions_send` 的行为：

1. 将 `aiemas_sessions_send` 改为**异步提交模式**（`timeoutSeconds=0`），立即返回 `runId`
2. 新增 `aiemas_sessions_wait` 工具，支持**批量等待**多个 `runId` 完成
3. 编排 Agent 的工作流变为：先并发提交所有子 Agent 任务，再批量等待所有结果

**优点：**

- 不改动核心 Gateway 代码
- 编排 Agent 可以控制并发策略
- 与现有 `sessions_send` 的异步模式（`timeoutSeconds=0`）语义一致

**风险：**

- 需要编排 Agent（LLM）理解并正确使用两步式调用模式（先提交、再等待）
- Lane 队列的串行约束仍然存在，子 Agent 仍然串行执行——此方案只解决了"等待"的并发，没有解决"执行"的并发
- **此方案单独无法解决核心问题**，需要与方向 A/B/C 组合

### 方向 E：Per-Session Lane 隔离（推荐探索方向）

**思路：** 修改 Gateway 的 Lane 调度机制，使其支持 **per-session 的串行保证**，而非全局串行。不同 sessionKey 的 Agent 运行可以并发执行，同一 sessionKey 的运行仍然串行。

**实现思路：**

- Lane 的 `maxConcurrent` 含义从"全局最多 N 个并发任务"变为"同一 sessionKey 最多 1 个并发任务，不同 sessionKey 可并发"
- 或者：为每个 sessionKey 动态创建独立的 sub-lane，每个 sub-lane 的 `maxConcurrent=1`

**优点：**

- 从根本上解决问题：不同 session 天然并发，同一 session 天然串行
- 语义正确：Lane 的串行保证本质上是为了保护 session 数据一致性，per-session 隔离是更精确的粒度

**风险：**

- 改动了核心 `command-queue.ts`，影响面较大
- 需要评估内存开销（大量 session 时的 sub-lane 数量）
- 需要全面测试，确保不引入新的并发问题

---

## 五、评估维度

| 维度                | 方向 A        | 方向 B        | 方向 C     | 方向 D      | 方向 E             |
| ------------------- | ------------- | ------------- | ---------- | ----------- | ------------------ |
| 改动范围            | 核心 1 行     | 核心 + AIEMAS | 仅 AIEMAS  | 仅 AIEMAS   | 核心 command-queue |
| 能否实现真并发      | ✓（但有风险） | ✓             | ✓          | ✗（需组合） | ✓                  |
| 同 session 串行保证 | ✗（破坏）     | ✓             | 需自行保证 | 不涉及      | ✓                  |
| 最小入侵原 Gateway  | ✗             | ✗             | ✓          | ✓           | ✗                  |
| 实现复杂度          | 低            | 中            | 高         | 中          | 高                 |
| 上游同步冲突风险    | 低            | 高            | 无         | 低          | 高                 |

---

## 六、参考文档

- [消息发送与接收（sessions_send + 目标 Session 接收）](./agent2agent-sessions-send-and-receive.md)
- [多 Agent 审批重复触发问题分析与修复](./iaas-multi-agent-repeat-approve.md)
- [消息完整流程分析](../message_flow_diagram.md)

### 核心源码参考

| 模块          | 文件                                        | 职责                                              |
| ------------- | ------------------------------------------- | ------------------------------------------------- |
| AIEMAS 工具   | `aiemas/src/gateway-bridge/aiemas-tools.ts` | `aiemas_sessions_send` 工具定义                   |
| AIEMAS 桥接   | `src/gateway/mas4s-integration.ts`          | `callSessionsSend` 回调构造，Lane 配置覆盖        |
| sessions_send | `src/agents/tools/sessions-send-tool.ts`    | 核心跨 session 消息发送，硬编码 `lane: "nested"`  |
| Lane 队列     | `src/process/command-queue.ts`              | Lane 调度，`maxConcurrent` 控制                   |
| Lane 定义     | `src/process/lanes.ts`                      | `CommandLane.Nested` 等 Lane 枚举                 |
| Lane 并发配置 | `src/gateway/server-lanes.ts`               | `applyGatewayLaneConcurrency`，未配置 nested Lane |
| Agent 运行    | `src/agents/agent-command.ts`               | `agentCommandInternal`，Agent 运行入口            |
| 运行等待      | `src/agents/run-wait.ts`                    | `agent.wait` + `chat.history` 回复读取            |
