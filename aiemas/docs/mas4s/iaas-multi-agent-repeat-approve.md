# AIEMAS 多 Agent 审批重复触发问题分析与修复

## 1. 问题描述

用户在 AIEMAS webchat 中发送一条消息（如"列出虚拟机列表"），经过 Orchestrator Agent（aieiaas）→ 子 Agent（aieiaas-resource）的 A2A 调用链后，子 Agent 的 `exec` 工具触发了安全审批请求。预期行为是 1 次用户请求只触发 1 次审批，但实际触发了 2 次完全相同的审批请求。

## 2. 涉及的核心模块

| 模块          | 文件                                              | 职责                                                          |
| ------------- | ------------------------------------------------- | ------------------------------------------------------------- |
| AIEMAS 工具   | `aiemas/src/gateway-bridge/aiemas-tools.ts`       | `aiemas_sessions_send` 工具，Orchestrator 调用子 Agent 的入口 |
| AIEMAS 桥接   | `src/gateway/mas4s-integration.ts`                | 将 `aiemas_sessions_send` 与核心 `sessions_send` 桥接         |
| sessions_send | `src/agents/tools/sessions-send-tool.ts`          | 核心跨 session 消息发送工具                                   |
| A2A Flow      | `src/agents/tools/sessions-send-tool.a2a.ts`      | A2A ping-pong 多轮对话 + announce 投递                        |
| run-wait      | `src/agents/run-wait.ts`                          | Agent 运行等待与回复读取                                      |
| agent.wait    | `src/gateway/server-methods/agent-job.ts`         | Gateway 层 Agent 运行状态监听                                 |
| exec 审批     | `src/agents/bash-tools.exec-runtime.ts`           | exec 工具审批提示生成                                         |
| 审批 followup | `src/agents/bash-tools.exec-approval-followup.ts` | 审批通过后注入执行结果                                        |

## 3. 完整调用链时序分析

基于 `gateway-un.log` 日志，1 次 `chat.send` 的完整时序：

```
13:37:48  用户 chat.send "列出虚拟机列表"
          → aieiaas (Orchestrator Agent) 开始运行 [runId=93c159b7]

13:38:06  aieiaas 调用 aiemas_sessions_send(agentId="aieiaas-resource", message="列出所有虚拟机")
          → 内部调用 callSessionsSend → sessions_send.execute()
          → sessions_send 调用 callGateway("agent") 触发 aieiaas-resource 运行 [runId=57037998]
          → sessions_send 调用 callGateway("agent.wait") 等待 aieiaas-resource 完成

13:38:22  aieiaas-resource 开始 LLM 推理

13:38:24  aieiaas-resource 调用 exec 工具: python3 resource_query.py --resource-type vms --query-type list

13:38:27  exec 工具触发第 1 次审批请求 [approvalId=3f0bbffe]
          → [infra:agent-events] emit stream=approval  (approval 事件)

13:38:29  aieiaas-resource 回复审批提示文本后结束运行 (stopReason: stop)
          → [infra:agent-events] emit stream=lifecycle phase=end

13:38:29  agent.wait 返回 { status: "ok" }  ← 关键：返回 ok 而非 blocked
          → sessions_send 的 waitForAgentRunAndReadUpdatedAssistantReply 返回
          → replyText = "需要批准才能执行查询命令。请批准以列出所有虚拟机..."

13:38:30  sessions_send 因 status=ok，调用 startA2AFlow(reply)  ← 问题触发点
          → A2A ping-pong 开始
```

### 分叉点：两条并行路径

**路径 A — A2A Ping-Pong：**

```
13:38:30  ping-pong turn=1: 将 aieiaas-resource 的审批提示转发给 aieiaas
          → aieiaas 回复："请点击允许按钮..."
13:38:52  ping-pong turn=2: 将 aieiaas 的回复转发回 aieiaas-resource
          → aieiaas-resource 收到消息后再次尝试执行任务
          → 触发第 2 次审批请求 [approvalId=fce49310]  ← 重复审批
```

**路径 B — exec-approval-followup：**

```
13:38:45  用户在 UI 点击 allow-once 批准第 1 次审批
13:38:47  exec-approval-followup 将执行结果（25 台 VM JSON）注入 aieiaas-resource
          → aieiaas-resource 格式化并呈现虚拟机列表（正常路径）
```

### 日志统计

| 指标                                | 数值                 |
| ----------------------------------- | -------------------- |
| `[ws:msg] IN` 总数                  | 131 条               |
| `[ws:msg] OUT` 总数                 | 142 条               |
| `chat.send`（用户请求）             | 1 次                 |
| `exec.approval.request`（审批请求） | 2 次                 |
| `exec.approval.resolve`（用户审批） | 2 次                 |
| 执行结果呈现                        | 2 次（内容完全相同） |

## 4. 根因分析

### 4.1 为什么 `agent.wait` 返回 `ok` 而非 `blocked`

`agent.wait`（`src/gateway/server-methods/agent-job.ts`）通过事件监听判断状态：

- `approval` 事件 → 返回 `{ status: "blocked", approvalId }`
- `lifecycle end` 事件 → 返回 `{ status: "ok" }`

两个事件都有 `settled` 守卫，先到的赢。从日志看 `approval` 事件（13:38:27）先于 `lifecycle end`（13:38:29），但 `agent.wait` 最终返回了 `ok`。

原因：`ensureAgentRunListener` 中的全局监听器在 `lifecycle end` 到达时调用 `recordAgentRunSnapshot` 缓存 snapshot。`waitForAgentJob` 内部的监听器在处理 `lifecycle end` 时，先检查 `getCachedAgentRun(runId)`，如果缓存中已有 snapshot 则直接用缓存的 `ok` 状态调用 `finish`。全局监听器和 `waitForAgentJob` 监听器的注册顺序导致了竞争条件。

### 4.2 为什么 Agent 的 run 会正常结束

aieiaas-resource Agent 收到 `exec` 工具的审批提示（toolResult）后，LLM 选择了"回复审批提示文本然后结束"（`stopReason: stop`），而不是"挂起等待审批"。这是 LLM 的正常行为——它无法真正挂起，只能回复文本。

### 4.3 根因总结

**核心问题：当子 Agent 的 `exec` 工具触发审批后，Agent 回复审批提示文本并正常结束运行。`sessions_send` 的 `agent.wait` 返回 `status: "ok"`，触发了 A2A ping-pong 流程。ping-pong 将审批提示在 Orchestrator 和子 Agent 之间来回转发，导致子 Agent 在后续轮次中再次执行相同命令，产生重复审批请求。**

## 5. 方案对比

### 方案 1：在 `aiemas_sessions_send` 中检测审批回复

**思路：** 在 `aiemas/src/gateway-bridge/aiemas-tools.ts` 中，当 `callSessionsSend` 返回 `status: "ok"` 但回复文本匹配审批模式时，返回 `pending-approval` 状态。

**问题：**

- `callSessionsSend` 内部调用 `sendTool.execute()`，`startA2AFlow` 是在 `execute` 内部通过 `void runSessionsSendA2AFlow(...)` 异步启动的
- 当 `aiemas_sessions_send` 拿到返回值时，A2A flow 已经在后台运行了
- **方案 1 单独无法阻止已启动的 ping-pong**，只能改变返回给 Orchestrator 的状态

### 方案 2：在 A2A ping-pong 中检测审批文本

**思路：** 在 `src/agents/tools/sessions-send-tool.a2a.ts` 的 ping-pong 循环入口，检测 `roundOneReply` 是否包含审批标识（如 `Approval required`、`/approve`），如果是则跳过 ping-pong。

**问题：**

- 检测目标是 LLM 生成的文本，不是结构化数据，不同 LLM/语言/prompt 生成的格式可能不同
- 误判风险：正常回复中包含 `/approve` 或 `Approval required` 时会错误跳过 ping-pong
- 修改了通用 A2A 代码路径，影响所有 `sessions_send` 场景，不仅是 AIEMAS

### 方案 2+1 组合

**思路：** 方案 2 在 A2A flow 内部跳过 ping-pong + 方案 1 给 Orchestrator 返回准确状态。

**问题：**

- 修改 2 个文件（`sessions-send-tool.a2a.ts` + `aiemas-tools.ts`）
- 方案 1 实际无法阻止已启动的 A2A flow，"双重保护"是虚假的
- 两处独立的文本检测逻辑需要保持一致，维护负担高
- 文本匹配的脆弱性问题仍然存在

### 方案 3：在 `sessions_send` 的 ok 路径中检测审批文本

**思路：** 在 `src/agents/tools/sessions-send-tool.ts` 中，`result.status === "ok"` 后、`startA2AFlow` 调用前，检测 `replyText` 是否包含审批标识，如果是则不调用 `startA2AFlow`。

**优势（相比方案 2+1）：**

- 只改 1 个文件
- 在 `startA2AFlow` 调用前拦截，彻底阻止 ping-pong 和 announce step
- 一处检测逻辑，维护负担低

**问题：**

- 仍然依赖文本匹配（LLM 生成的 `replyText`）
- 修改了通用 `sessions_send` 代码路径

### 方案 3 改进版：基于 toolResult 确定性输出检测

**思路：** 不检测 LLM 生成的 `replyText`，而是读取 chat history 中 `toolResult` 的原始内容，匹配 `exec` 工具的确定性输出格式 `Approval required (id {slug}, full {id}).`（`bash-tools.exec-runtime.ts` 第 373 行硬编码）。

**实现演进：**

1. **初版：额外调用 `chat.history`**
   - 在 `run-wait.ts` 新增 `detectPendingExecApprovalInHistory` 函数
   - 在 `sessions-send-tool.ts` 的 ok 路径中调用
   - 问题：额外的 `callGateway("chat.history")` 调用，gateway 繁忙时可能超时（实际测试中 `chat.history` 耗时 12.8 秒）

2. **优化版：复用已有 `chat.history` 响应**
   - 修改 `run-wait.ts` 的 `waitForAgentRunAndReadUpdatedAssistantReply`，内部复用已获取的 raw messages 做审批扫描
   - 返回值新增可选字段 `pendingApprovalId`
   - 零额外 gateway 调用
   - 问题：改了 `run-wait.ts` 的内部结构和公共返回类型，与上游仓库同步时冲突概率高

**优势：**

- 检测基于 `exec` 工具的确定性输出，不受 LLM 行为影响
- 匹配目标是工具固定格式，误判概率极低

**问题：**

- 改动散布在 `run-wait.ts`（核心模块）和 `sessions-send-tool.ts` 中
- 与上游仓库同步时冲突风险高

### 方案 4（最终采用）：在 AIEMAS 桥接层禁用 A2A ping-pong

**思路：** 在 `src/gateway/mas4s-integration.ts` 的 `callSessionsSend` 回调中，构造一个覆盖了 `session.agentToAgent.maxPingPongTurns: 0` 的 config，传给 `createSessionsSendTool`。这从根源上禁用了 AIEMAS 跨 Agent 调用时的 A2A ping-pong。

**原理：** `sessions_send` 的 A2A ping-pong 轮次由 `resolvePingPongTurns(cfg)` 从 config 中读取（`session.agentToAgent.maxPingPongTurns`，默认 5，上限 5）。设为 0 后，`runSessionsSendA2AFlow` 中的 ping-pong 循环条件 `maxPingPongTurns > 0` 不满足，直接跳过，仅执行 announce step。

**修改内容：**

```typescript
// src/gateway/mas4s-integration.ts — callSessionsSend 回调
const noPingPongConfig = {
  ...context.config,
  session: {
    ...context.config?.session,
    agentToAgent: {
      ...context.config?.session?.agentToAgent,
      maxPingPongTurns: 0,
    },
  },
};
const sendTool = createSessionsSendTool({
  agentSessionKey: context.agentSessionKey,
  agentChannel: context.agentChannel,
  config: noPingPongConfig, // 覆盖 config
  callGateway,
});
```

同时修复了 `callSessionsSend` 的返回值问题：原代码直接 `return sendTool.execute(...)` 返回完整的 `{ content, details }` 对象，导致 `aiemas-tools.ts` 中的 `blocked`/`running` 状态检测无法命中（`status` 在 `details` 内部）。改为 `return res.details`。

## 6. 方案对比总结

| 维度                | 方案 1       | 方案 2   | 方案 2+1              | 方案 3      | 方案 3 改进          | 方案 4（采用）    |
| ------------------- | ------------ | -------- | --------------------- | ----------- | -------------------- | ----------------- |
| 修改文件数          | 1            | 1        | 2                     | 1           | 2                    | 1                 |
| 修改位置            | aiemas-tools | a2a.ts   | a2a.ts + aiemas-tools | send-tool   | run-wait + send-tool | mas4s-integration |
| 能否阻止 ping-pong  | ✗            | ✓        | ✓                     | ✓           | ✓                    | ✓                 |
| 额外 gateway 调用   | 0            | 0        | 0                     | 0（改进后） | 0                    | 0                 |
| 文本匹配依赖        | LLM 文本     | LLM 文本 | LLM 文本 ×2           | LLM 文本    | 工具确定性输出       | 无                |
| 误判风险            | 无效         | 中       | 中                    | 中          | 低                   | 无                |
| 影响通用代码        | ✗            | ✓        | ✓                     | ✓           | ✓                    | ✗                 |
| 上游同步冲突风险    | 低           | 高       | 高                    | 高          | 高                   | 低                |
| AIEMAS 自身协调能力 | 不利用       | 不利用   | 不利用                | 不利用      | 不利用               | 利用              |

## 7. 为什么方案 4 最优

1. **从根源解决**：AIEMAS 的 Orchestrator 通过显式的 `aiemas_sessions_send` 调用管理多轮协调，不需要通用的 A2A ping-pong 机制。禁用 ping-pong 是语义正确的，不是 workaround。

2. **零文本匹配**：不依赖任何文本检测，不受 LLM 行为、语言、prompt 变化影响。

3. **零额外开销**：不增加任何 gateway 调用，不改变运行时性能特征。

4. **最小改动面**：只改 `src/gateway/mas4s-integration.ts` 一个文件，不动核心模块（`run-wait.ts`、`sessions-send-tool.ts`、`sessions-send-tool.a2a.ts`）。

5. **最低同步冲突风险**：`mas4s-integration.ts` 是 AIEMAS 的桥接层，与上游核心模块的改动正交。

6. **附带修复**：顺带修复了 `callSessionsSend` 返回值的 bug（`return res.details` 替代 `return res`），使 `aiemas-tools.ts` 中的 `blocked`/`running` 状态检测能正确工作。

## 8. 修复后的预期行为

```
用户 chat.send "列出虚拟机列表"
  → aieiaas 调用 aiemas_sessions_send → callSessionsSend
    → sessions_send(maxPingPongTurns=0) 触发 aieiaas-resource
      → aieiaas-resource 调用 exec → 触发审批请求 [1 次]
      → aieiaas-resource 回复审批提示文本，run 结束
    → sessions_send 返回 { status: "ok", reply: "需要审批..." }
    → startA2AFlow 被调用，但 maxPingPongTurns=0，ping-pong 循环跳过
    → 仅执行 announce step（不会触发重复执行）
  → aiemas_sessions_send 返回结果给 aieiaas
  → aieiaas 向用户展示审批提示

用户点击 allow-once
  → exec-approval-followup 注入执行结果到 aieiaas-resource
  → aieiaas-resource 格式化并呈现虚拟机列表
```

全程只有 1 次审批请求，1 次执行结果呈现。
