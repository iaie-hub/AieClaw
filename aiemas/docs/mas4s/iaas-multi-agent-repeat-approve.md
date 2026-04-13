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

### 方案 4（初版）：在 AIEMAS 桥接层禁用 A2A ping-pong

**思路：** 在 `src/gateway/mas4s-integration.ts` 的 `callSessionsSend` 回调中，构造一个覆盖了 `session.agentToAgent.maxPingPongTurns: 0` 的 config，传给 `createSessionsSendTool`。这从根源上禁用了 AIEMAS 跨 Agent 调用时的 A2A ping-pong。

**原理：** `sessions_send` 的 A2A ping-pong 轮次由 `resolvePingPongTurns(cfg)` 从 config 中读取（`session.agentToAgent.maxPingPongTurns`，默认 5，上限 5）。设为 0 后，`runSessionsSendA2AFlow` 中的 ping-pong 循环条件 `maxPingPongTurns > 0` 不满足，直接跳过，但 **announce step 仍然无条件执行**。

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
| 能否阻止 ping-pong  | ✗            | ✓        | ✓                     | ✓           | ✓                    | ✓（仅 ping-pong） |
| 能否阻止 announce   | ✗            | ✗        | ✗                     | ✗           | ✗                    | ✗                 |
| 额外 gateway 调用   | 0            | 0        | 0                     | 0（改进后） | 0                    | 0                 |
| 文本匹配依赖        | LLM 文本     | LLM 文本 | LLM 文本 ×2           | LLM 文本    | 工具确定性输出       | 无                |
| 误判风险            | 无效         | 中       | 中                    | 中          | 低                   | 无                |
| 影响通用代码        | ✗            | ✓        | ✓                     | ✓           | ✓                    | ✗                 |
| 上游同步冲突风险    | 低           | 高       | 高                    | 高          | 高                   | 低                |
| AIEMAS 自身协调能力 | 不利用       | 不利用   | 不利用                | 不利用      | 不利用               | 利用              |

## 7. 为什么方案 4 初版被选中（及其局限性）

方案 4 初版在当时的分析中是最优选择，但遗漏了 announce step 的问题（见第 8 节）。其优点仍然成立：

1. **从根源解决**：AIEMAS 的 Orchestrator 通过显式的 `aiemas_sessions_send` 调用管理多轮协调，不需要通用的 A2A ping-pong 机制。禁用 ping-pong 是语义正确的，不是 workaround。

2. **零文本匹配**：不依赖任何文本检测，不受 LLM 行为、语言、prompt 变化影响。

3. **零额外开销**：不增加任何 gateway 调用，不改变运行时性能特征。

4. **最小改动面**：只改 `src/gateway/mas4s-integration.ts` 一个文件，不动核心模块（`run-wait.ts`、`sessions-send-tool.ts`、`sessions-send-tool.a2a.ts`）。

5. **最低同步冲突风险**：`mas4s-integration.ts` 是 AIEMAS 的桥接层，与上游核心模块的改动正交。

6. **附带修复**：顺带修复了 `callSessionsSend` 返回值的 bug（`return res.details` 替代 `return res`），使 `aiemas-tools.ts` 中的 `blocked`/`running` 状态检测能正确工作。

## 8. 方案 4 初版的遗留问题：announce step 未被禁用

### 8.1 问题发现（2026-04-13）

方案 4 初版上线后，`log/gateway-2026-04-13.log` 和 `log/openclaw-2026-04-13.log` 显示相同请求仍然连续触发了 2 次审批。

### 8.2 日志时序还原

| 时间     | 事件                                                                                  | runId                 |
| -------- | ------------------------------------------------------------------------------------- | --------------------- |
| 10:28:56 | 用户 `chat.send` "列出xstack平台上的物理机"                                           | `58e90ed8` (aieiaas)  |
| 10:29:22 | aieiaas 调用 `aiemas_sessions_send` → 触发 aieiaas-resource                           | `377ca38c` (resource) |
| 10:29:52 | aieiaas-resource 调用 `exec`（读取 SKILL.md → 执行 hosts 查询）                       |                       |
| 10:29:55 | **第 1 次审批请求** `exec.approval.request` id=`8a4400b0`                             |                       |
| 10:29:57 | aieiaas-resource run 结束 (stopReason: stop)，`agent.wait` 返回 `status: "ok"`        |                       |
| 10:29:57 | `sessions_send` 触发 `startA2AFlow`，`maxPingPongTurns=0` 跳过 ping-pong              |                       |
| 10:29:57 | **announce step 仍然执行** → 向 aieiaas-resource 发送 "Agent-to-agent announce step." | `ced76820` (announce) |
| 10:30:03 | aieiaas-resource 收到 announce 消息，误以为"命令已批准"，**再次执行相同命令**         |                       |
| 10:30:04 | **第 2 次审批请求** `exec.approval.request` id=`fba23bc6`                             |                       |

### 8.3 根因分析

`runSessionsSendA2AFlow`（`src/agents/tools/sessions-send-tool.a2a.ts`）的结构为：

```
runSessionsSendA2AFlow:
  1. [可选] 等待 waitRunId 完成，读取 primaryReply
  2. [条件] if maxPingPongTurns > 0 → 执行 ping-pong 循环
  3. [无条件] 执行 announce step → runAgentStep("Agent-to-agent announce step.")
```

方案 4 初版设置 `maxPingPongTurns=0` 只跳过了第 2 步的 ping-pong 循环，但第 3 步 announce step 是**无条件执行**的。announce step 将审批提示文本作为上下文（`Round 1 reply: 需要批准才能执行查询命令...`）发送给 aieiaas-resource，LLM 看到后误判为"已批准"，重新执行了相同命令，产生第 2 次审批请求。

### 8.4 修复方案对比

#### 方案 A（采用）：在 `runSessionsSendA2AFlow` 入口 early return

在 `sessions-send-tool.a2a.ts` 的 `runSessionsSendA2AFlow` 函数入口，当 `maxPingPongTurns <= 0` 且已有 `roundOneReply` 时直接返回，跳过整个 A2A flow（包括 announce step）。

**优点：**

- 改动最小（1 处 early return），语义清晰
- `maxPingPongTurns=0` 的语义就是"调用方自行管理多轮协调，不需要 A2A 交互"
- 用 `roundOneReply !== undefined` 作为额外守卫，只在 `status=ok` 路径（已有回复）时跳过，不影响 `timeoutSeconds=0` 的 fire-and-forget 路径

**缺点：**

- 改动了通用的 `sessions-send-tool.a2a.ts`，但影响面可控（仅 `maxPingPongTurns=0` 场景）

#### 方案 B：在 `sessions-send-tool.ts` 调用侧跳过

在 `startA2AFlow` 调用前加 `if (maxPingPongTurns > 0)` 守卫。

**缺点：**

- `sessions-send-tool.ts` 中有多个 `startA2AFlow` 调用点（`timeoutSeconds=0` 和 `status=ok` 两个分支），需要逐一修改
- 改动散布在调用侧，不如在 A2A flow 入口统一拦截清晰

#### 方案 C：新增 `skipAnnounce` 参数

给 `runSessionsSendA2AFlow` 新增 `skipAnnounce` 参数，在 `mas4s-integration.ts` 中传递。

**缺点：**

- 过度设计，目前没有"跳过 ping-pong 但保留 announce"的真实需求
- 需要改 2 个文件（`sessions-send-tool.a2a.ts` + `sessions-send-tool.ts`）

### 8.5 修复实施

**修改文件：** `src/agents/tools/sessions-send-tool.a2a.ts`

在 `runSessionsSendA2AFlow` 函数入口、`try` 块之前新增 early return：

```typescript
  const runContextId = params.waitRunId ?? "unknown";

  // When maxPingPongTurns is 0 and we already have a round-one reply, the
  // caller is handling multi-turn coordination itself (e.g. AIEMAS
  // orchestration via explicit aiemas_sessions_send calls).  Skip both the
  // ping-pong loop *and* the announce step so we don't re-trigger the target
  // agent with stale approval-prompt context, which would cause duplicate
  // exec approval requests.
  if (params.maxPingPongTurns <= 0 && params.roundOneReply !== undefined) {
    return;
  }

  try {
```

### 8.6 修复后的完整预期行为

```
用户 chat.send "列出物理机"
  → aieiaas 调用 aiemas_sessions_send → callSessionsSend
    → sessions_send(maxPingPongTurns=0) 触发 aieiaas-resource
      → aieiaas-resource 调用 exec → 触发审批请求 [1 次]
      → aieiaas-resource 回复审批提示文本，run 结束
    → sessions_send 返回 { status: "ok", reply: "需要审批..." }
    → startA2AFlow 被调用，roundOneReply="需要审批..."
    → runSessionsSendA2AFlow: maxPingPongTurns=0 且 roundOneReply 存在 → early return
    → ping-pong 和 announce step 均被跳过
  → aiemas_sessions_send 返回结果给 aieiaas
  → aieiaas 向用户展示审批提示

用户点击 allow-once
  → exec-approval-followup 注入执行结果到 aieiaas-resource
  → aieiaas-resource 格式化并呈现结果
```

全程只有 1 次审批请求，1 次执行结果呈现。

## 9. 第三类重复审批问题：exec-approval-followup 链式执行中的 LLM 重复调用（2026-04-13）

### 9.1 问题发现

方案 4 + announce early return 修复上线后，4/13 日志验证了 A2A ping-pong/announce 导致的重复审批已被消除（请求 1 "列出物理机" 仅触发 1 次审批）。但请求 2 "查看聚合统计信息" 中，4 种命令各被重复执行了 3~4 次，产生了大量重复审批请求。

**这不是方案 4 的遗留问题，而是一个独立的、不同机制导致的重复审批问题。**

### 9.2 日志数据

2 次用户请求共产生 23 个审批请求（23 个唯一 approvalId），其中：

- 请求 1（"列出物理机"）：1 个审批，无重复 ✅
- 请求 2（"查看聚合统计"）：22 个审批，其中 4 种命令被重复执行

**请求 2 的重复命令统计：**

| 命令（简写）                                        | 首次 approvalId | 首次时间 | 重复次数 | 重复 approvalId                                                                        |
| --------------------------------------------------- | --------------- | -------- | -------- | -------------------------------------------------------------------------------------- |
| `top-by-calls --start-time ... --end-time ...`      | `b7ec5510`      | 11:14:54 | 3        | `928a0fa1`(11:15:19), `5056dbd0`(11:15:59), `0d7f3c7f`(11:16:43)                       |
| `top-by-tokens --start-time ... --end-time ...`     | `2497daa7`      | 11:15:07 | 3        | `f8116536`(11:15:22), `1b67e5cb`(11:15:39), `00a8db54`(11:16:52)                       |
| `apikey-top-calls --start-time ... --end-time ...`  | `a28e09bd`      | 11:15:42 | 4        | `ae9bf72b`(11:15:59), `822cfcc8`(11:16:43), `da0c17b8`(11:16:52), `1ac17c08`(11:17:01) |
| `apikey-top-tokens --start-time ... --end-time ...` | `7713910c`      | 11:15:59 | 3        | `7c3ead9f`(11:16:43), `3f537301`(11:16:52), `2f8a435a`(11:17:01)                       |

去重后实际唯一命令仅 9 种（overview, top-by-calls 无参, top-by-tokens 无参, top-by-calls 带时间, top-by-tokens 带时间, apikey-top-calls, apikey-top-tokens, served-models, apikeys），但产生了 22 个审批请求。

### 9.3 根因分析

#### 9.3.1 exec-approval-followup 的链式执行机制

`exec-approval-followup`（`src/agents/bash-tools.exec-approval-followup.ts`）的工作方式：

1. 用户点击 `allow-once` 批准某个 approvalId
2. 系统执行该命令，获取执行结果
3. 将执行结果作为 `toolResult` 注入到 agent 的 chat history 中
4. **重新触发 agent 运行**（`exec-approval-followup:<approvalId>` runId）
5. agent 看到执行结果后，继续推理下一步操作

关键点：步骤 5 中 agent 不仅会处理当前执行结果，还会**继续执行任务中的后续步骤**，包括调用新的 `exec` 命令。如果新的 `exec` 命令也需要审批，就会产生新的审批请求，用户批准后又触发新的 `exec-approval-followup`，形成链式执行。

#### 9.3.2 链式执行中的 LLM 重复调用

问题出在链式执行的**并发性**和 **LLM 的上下文理解**：

```
时间线（简化）：

11:14:13  用户 allow-once [4930ffaf] (overview)
11:14:17  followup:4930ffaf 开始 → agent 执行 overview 查询成功
11:14:20  agent 继续任务 → 调用 exec(top-by-calls 无参) → 审批 [be25368f]
11:14:26  用户 allow-once [be25368f]
11:14:32  agent 继续 → 调用 exec(top-by-tokens 无参) → 审批 [269e9c73]
11:14:34  followup:be25368f 结束（返回 400 错误：缺 startTime）
11:14:37  followup:be25368f 开始新 run → agent 看到 400 错误
11:14:54  agent 重试 → exec(top-by-calls 带时间) → 审批 [b7ec5510]  ← 首次
11:15:07  agent 继续 → exec(top-by-tokens 带时间) → 审批 [2497daa7]  ← 首次

11:15:12  followup:269e9c73 开始 → agent 看到 top-by-tokens 无参的 400 错误
11:15:19  agent 重试 → exec(top-by-calls 带时间) → 审批 [928a0fa1]  ← 重复！
11:15:22  agent 继续 → exec(top-by-tokens 带时间) → 审批 [f8116536]  ← 重复！

11:15:30  followup:269e9c73 结束
11:15:33  followup:928a0fa1 开始 → agent 看到 top-by-calls 结果
11:15:39  agent 继续 → exec(top-by-tokens 带时间) → 审批 [1b67e5cb]  ← 重复！
11:15:42  agent 继续 → exec(apikey-top-calls) → 审批 [a28e09bd]  ← 首次

... 链式执行持续，每个 followup 都可能触发已经在其他 followup 中执行过的命令
```

#### 9.3.3 根因总结

**核心问题：`exec-approval-followup` 的链式执行机制中，多个 followup run 并发运行在同一个 agent session 上。每个 followup run 的 LLM 推理都基于当时的 chat history，但 chat history 中可能尚未包含其他并发 followup 的执行结果。LLM 看到任务未完成（缺少某些查询结果），就会重新发起相同的查询命令，导致重复审批。**

具体来说：

1. `followup:be25368f` 执行完毕后，agent 继续任务，发起 `top-by-calls 带时间` 和 `top-by-tokens 带时间` 的查询
2. 几乎同时，`followup:269e9c73` 也执行完毕，agent 在另一个 run 中也看到任务未完成，再次发起相同的查询
3. 两个 followup run 的 LLM 推理是独立的，各自不知道对方已经发起了相同的查询
4. 这种"并发 followup → 独立推理 → 重复命令"的模式在整个链式执行过程中反复出现

### 9.4 与前两类重复审批的区别

| 维度       | 第一类（4/12 A2A ping-pong）     | 第二类（4/12 announce step）     | 第三类（4/13 followup 链式）          |
| ---------- | -------------------------------- | -------------------------------- | ------------------------------------- |
| 触发机制   | A2A ping-pong 将审批提示来回转发 | announce step 重新触发 agent     | 多个 followup run 并发推理            |
| 重复来源   | `sessions_send` 的 A2A flow      | `sessions_send` 的 announce step | `exec-approval-followup` 链式执行     |
| 影响范围   | 每个 exec 审批都会重复 1 次      | 每个 exec 审批都会重复 1 次      | 仅在多步骤任务中出现，重复次数不固定  |
| 是否已修复 | ✅ 方案 4 `maxPingPongTurns=0`   | ✅ announce early return         | ❌ 未修复                             |
| 修复层面   | `sessions-send` / A2A flow       | `sessions-send` / A2A flow       | `exec-approval-followup` / agent 调度 |

### 9.5 解决方案分析

#### 方案 A：在 exec-approval-followup 中加入命令去重

**思路：** 在 `exec-approval-followup` 触发 agent run 之前，扫描当前 session 中所有 pending 的审批请求，如果发现相同命令已有 pending 审批，则跳过本次 followup 的后续 exec 调用。

**问题：**

- `exec-approval-followup` 无法预知 agent 将要执行什么命令，去重只能在 `exec` 工具层面实现
- 需要在 `exec` 工具内部维护一个"最近已提交审批的命令"缓存，增加了 exec 工具的复杂度
- 命令参数可能有细微差异（如时间戳），简单字符串匹配可能误判

#### 方案 B：串行化 followup 执行

**思路：** 确保同一 agent session 上的 `exec-approval-followup` run 串行执行，避免并发推理导致的重复。

##### B.1 当前并发问题的根因

`sendExecApprovalFollowup`（`src/agents/bash-tools.exec-approval-followup.ts`）的核心逻辑：

```typescript
// 简化后的关键路径
export async function sendExecApprovalFollowup(params) {
  await callGatewayTool(
    "agent",
    { timeoutMs: 60_000 },
    {
      sessionKey: params.sessionKey,
      role: "system",
      message: buildExecApprovalFollowupPrompt(params.resultText),
      idempotencyKey: `exec-approval-followup:${params.approvalId}`,
    },
    { expectFinal: true },
  );
}
```

调用方是 `bash-tools.exec-host-gateway.ts` 中的 fire-and-forget 异步块：

```typescript
void (async () => {
  const decision = await resolveApprovalDecisionOrUndefined({ approvalId, ... });
  // ... 执行命令 ...
  await sendExecApprovalFollowupResult(followupTarget, summary);
})();
```

每个审批决策独立触发一个 `void (async () => { ... })()` 异步块，这些块之间没有任何协调。当用户快速批准多个审批时，多个 followup 的 `callGatewayTool("agent", ...)` 调用几乎同时到达 gateway，gateway 为同一 sessionKey 并发启动多个 agent run。

每个 agent run 的 LLM 推理基于当时的 chat history，但 chat history 中可能尚未包含其他并发 run 的执行结果（因为那些 run 还在进行中），导致 LLM 重复发起相同的查询命令。

##### B.2 串行化实现方案

**实现位置：** `src/agents/bash-tools.exec-approval-followup.ts`

**核心思路：** 在 `sendExecApprovalFollowup` 内部维护一个 per-sessionKey 的 Promise 链，确保同一 session 上的 followup 调用串行执行。

```typescript
// ── Session-level followup serialization ──────────────────────────
// 同一 session 上的 exec-approval-followup 必须串行执行，否则并发的
// agent run 会基于不完整的 chat history 推理，导致 LLM 重复发起相同命令。
const sessionFollowupChains = new Map<string, Promise<void>>();

function enqueueSessionFollowup(sessionKey: string, fn: () => Promise<void>): Promise<void> {
  const prev = sessionFollowupChains.get(sessionKey) ?? Promise.resolve();
  const next = prev
    .catch(() => {}) // 前一个 followup 失败不阻塞后续
    .then(() => fn());
  sessionFollowupChains.set(sessionKey, next);
  // 链完成后清理引用，避免内存泄漏
  void next.finally(() => {
    if (sessionFollowupChains.get(sessionKey) === next) {
      sessionFollowupChains.delete(sessionKey);
    }
  });
  return next;
}
```

修改 `sendExecApprovalFollowup` 函数，将 `callGatewayTool("agent", ...)` 调用包裹在串行队列中：

```typescript
export async function sendExecApprovalFollowup(
  params: ExecApprovalFollowupParams,
): Promise<boolean> {
  const sessionKey = params.sessionKey?.trim();
  const resultText = params.resultText.trim();
  if (!resultText) return false;

  const isDenied = isExecDeniedResultText(resultText);
  if (isDenied && shouldSuppressExecDeniedFollowup(sessionKey)) return false;

  const deliveryTarget = resolveExternalBestEffortDeliveryTarget({ ... });
  // ... (省略 deliveryTarget 解析，与现有代码相同)

  let sessionError: unknown = null;

  if (sessionKey) {
    try {
      // ★ 关键改动：将 agent 调用包裹在 per-session 串行队列中
      await enqueueSessionFollowup(sessionKey, async () => {
        await callGatewayTool(
          "agent",
          { timeoutMs: 60_000 },
          buildAgentFollowupArgs({ ... }),
          { expectFinal: true },
        );
      });
      return true;
    } catch (err) {
      sessionError = err;
    }
  }

  // ... (fallback 逻辑不变)
}
```

##### B.3 串行化的效果

**修复前（并发）：**

```
11:15:09  followup:be25368f 结束 → agent run 开始
11:15:12  followup:269e9c73 开始 → agent run 开始（并发！）
          两个 run 同时推理，各自看到不完整的 history
11:15:19  followup:be25368f 的 run → exec(top-by-calls 带时间) [首次]
11:15:19  followup:269e9c73 的 run → exec(top-by-calls 带时间) [重复！]
```

**修复后（串行）：**

```
11:15:09  followup:be25368f 结束 → agent run 开始
          followup:269e9c73 进入队列等待
11:15:30  followup:be25368f 的 run 结束（已执行 top-by-calls 带时间）
11:15:30  followup:269e9c73 的 run 开始
          chat history 已包含 top-by-calls 的结果
          LLM 看到结果已存在，跳过重复命令，继续下一步
```

##### B.4 方案评估

**优势：**

- 从根本上消除并发推理导致的重复命令问题
- 改动集中在 `bash-tools.exec-approval-followup.ts` 一个文件
- 不改变 exec 工具、gateway agent 调度、A2A flow 等核心模块
- 不依赖文本匹配或命令去重，对 LLM 行为变化鲁棒
- Promise 链模式简单可靠，无需引入外部队列/锁依赖

**劣势：**

- **性能影响**：多步骤任务的总执行时间会增加。以 4/13 请求 2 为例，22 个审批如果全部串行执行，每个 followup run 约 8~18 秒（LLM 推理 + 命令执行），总时间可能从当前的 ~4 分钟增加到 ~6 分钟
- **用户体验权衡**：串行化减少了重复审批（从 22 个降到 ~9 个唯一命令），但每个审批的等待时间更长。净效果取决于重复审批的比例——如果重复率高（如本例 60%），串行化的总时间反而可能更短
- **边界情况**：denied followup 也会进入队列，可能不必要地阻塞后续 approved followup。可以通过在 `enqueueSessionFollowup` 前判断 `isDenied` 来优化（denied 不入队，直接执行）
- **与上游同步**：改动了 `bash-tools.exec-approval-followup.ts`（核心模块），与上游仓库同步时有冲突风险，但改动面小（新增 ~20 行队列逻辑 + 修改 1 处调用点）

##### B.5 优化变体：仅串行化 approved followup

denied followup 不会触发新的 agent 推理（prompt 明确说"不要重新执行命令"），因此不需要串行化。优化后：

```typescript
export async function sendExecApprovalFollowup(
  params: ExecApprovalFollowupParams,
): Promise<boolean> {
  // ... 前置检查 ...

  const isDenied = isExecDeniedResultText(resultText);

  if (sessionKey) {
    try {
      const agentArgs = buildAgentFollowupArgs({ ... });
      if (isDenied) {
        // denied followup 不入队，直接执行（不会触发新命令）
        await callGatewayTool("agent", { timeoutMs: 60_000 }, agentArgs, { expectFinal: true });
      } else {
        // approved followup 串行执行
        await enqueueSessionFollowup(sessionKey, async () => {
          await callGatewayTool("agent", { timeoutMs: 60_000 }, agentArgs, { expectFinal: true });
        });
      }
      return true;
    } catch (err) {
      sessionError = err;
    }
  }
  // ...
}
```

##### B.6 与其他方案的组合

方案 B 可以与方案 D（白名单 + 批量审批）组合使用：

- **方案 D.2（白名单）** 消除只读查询的审批需求，从源头减少 followup 数量
- **方案 B（串行化）** 作为兜底，确保即使有审批，followup 也不会并发重复

组合后，只读查询直接执行（无审批），写操作的审批 followup 串行执行（无重复），是最完整的解决方案。

##### B.7 实施建议

1. **优先实施方案 D.2（白名单）**：零代码改动，立即消除只读查询的审批
2. **如果白名单不足以覆盖所有场景**（例如写操作也出现重复审批），再实施方案 B
3. 实施方案 B 时，采用 B.5 优化变体（仅串行化 approved followup）
4. 需要添加对应的单元测试，验证串行化行为和 Promise 链的错误隔离

#### 方案 C：在 exec 工具层面实现命令级幂等

**思路：** 在 `bash-tools.exec-runtime.ts` 中，当 exec 工具准备提交审批请求时，检查同一 session 中是否已有相同命令的 pending 审批。如果有，直接返回已有审批的 ID 和状态，而不是创建新的审批请求。

**优势：**

- 在最接近问题发生点的位置拦截
- 不影响 followup 的并发执行能力
- 对用户透明，不改变交互流程

**问题：**

- 需要定义"相同命令"的匹配规则（完全匹配 vs 模糊匹配）
- 需要在 exec 工具中维护 session 级别的审批状态缓存
- 改动了核心的 exec 工具代码

#### 方案 D（推荐）：AIEMAS 层面的批量审批 + 任务编排优化

**思路：** 这是一个 LLM 行为问题而非系统 bug，最合适的解决层面是 AIEMAS 的任务编排和审批策略：

1. **批量审批机制**：在 AIEMAS UI 中实现"全部批准"按钮，用户可以一次性批准同一 agent 的所有 pending 审批，减少交互次数
2. **只读命令白名单**：将 monitor agent 的只读查询命令（`monitor_query_sop.py`、`gateway_statistics_sop.py`）加入 `exec-approvals.json` 的 allowlist，跳过审批
3. **任务计划预审批**：agent 在执行多步骤任务前，先生成完整的执行计划（包含所有需要执行的命令），用户一次性审批整个计划，然后 agent 按计划顺序执行

**优势：**

- 不改动核心代码（exec、followup、sessions_send）
- 从根本上减少审批次数，改善用户体验
- 方案 D.2（白名单）可以立即实施，零代码改动

**实施优先级：**

1. **立即**：将 monitor/resource 的只读查询脚本加入 allowlist（方案 D.2）
2. **短期**：在 AIEMAS UI 中实现批量审批（方案 D.1）
3. **中期**：实现任务计划预审批（方案 D.3）

### 9.6 方案 D.2 实施：配置只读查询命令白名单

修改 `.openclaw/exec-approvals.json`，为 `aieiaas-resource` 和 `aieiaas-monitor` agent 添加只读查询脚本的 allowlist：

```json
{
  "aieiaas-resource": {
    "autoAllowSkills": true,
    "allowlist": [
      {
        "id": "ws-resource-skills-001",
        "pattern": "/Users/admin/.openclaw/workspace-aieiaas-resource/skills/**/*.py",
        "description": "resource workspace - 所有 Skill Python 脚本（只读查询）"
      },
      {
        "id": "ws-resource-python-001",
        "pattern": "/usr/local/bin/python3",
        "description": "Local Python 3 (Resource Skills)"
      },
      {
        "id": "ws-resource-python-002",
        "pattern": "/usr/bin/python3",
        "description": "System Python 3 (Resource Skills)"
      }
    ]
  },
  "aieiaas-monitor": {
    "autoAllowSkills": true,
    "allowlist": [
      {
        "id": "ws-monitor-skills-001",
        "pattern": "/Users/admin/.openclaw/workspace-aieiaas-monitor/skills/**/*.py",
        "description": "monitor workspace - 所有 Skill Python 脚本（只读查询）"
      },
      {
        "id": "ws-monitor-python-001",
        "pattern": "/usr/local/bin/python3",
        "description": "Local Python 3 (Monitor Skills)"
      },
      {
        "id": "ws-monitor-python-002",
        "pattern": "/usr/bin/python3",
        "description": "System Python 3 (Monitor Skills)"
      }
    ]
  }
}
```

注意：当前 `aieiaas-resource` 和 `aieiaas-monitor` 的 allowlist 为空（`"allowlist": []`），但对应的 workspace agent（`workspace-aieiaas-resource`、`workspace-aieiaas-monitor`）已有完整的 allowlist 配置。AIEMAS 通过 `aiemas_sessions_send` 调用子 agent 时，使用的 agentId 是 `aieiaas-resource` / `aieiaas-monitor`（非 workspace 前缀），因此需要将 allowlist 配置复制到这些 agentId 下。

### 9.7 UI 端重复 resolve 问题（附带发现）

日志还发现 5 个 approvalId 被 `exec.approval.resolve` 了 2 次：

| approvalId | 决策          | 说明                                        |
| ---------- | ------------- | ------------------------------------------- |
| `95ccd0fb` | allow-once ×2 | 第 2 次返回 `APPROVAL_NOT_FOUND`            |
| `9c761d43` | allow-once ×2 | 第 2 次返回 `APPROVAL_NOT_FOUND`            |
| `8c0c7c8c` | allow-once ×2 | 第 2 次返回 `APPROVAL_NOT_FOUND`            |
| `8a4400b0` | deny ×2       | 前一次会话残留，2 次均 `APPROVAL_NOT_FOUND` |
| `fba23bc6` | deny ×2       | 前一次会话残留，2 次均 `APPROVAL_NOT_FOUND` |

前 3 个是 UI 前端对同一 approvalId 发送了 2 次 `exec.approval.resolve`（可能是按钮防抖缺失或事件冒泡），后 2 个是用户手动清理前一次会话的残留审批。Gateway 正确返回了 `APPROVAL_NOT_FOUND` 拒绝重复 resolve，后端逻辑无影响。

建议在 AIEMAS UI 的审批按钮上添加防抖（debounce）或 loading 状态锁，避免重复提交。

### 9.8 采用方案：B + D.2 + D.1 组合

三个方案各解决不同层面的问题，互不冲突，叠加后形成完整的防御体系：

| 层面       | 方案            | 解决什么                                            | 改动范围                                                  |
| ---------- | --------------- | --------------------------------------------------- | --------------------------------------------------------- |
| 源头消除   | D.2（白名单）   | 只读查询命令跳过审批，从源头砍掉大部分 followup     | `.openclaw/exec-approvals.json`（配置）                   |
| 兜底防重复 | B（串行化）     | 仍需审批的命令，followup 串行执行，避免并发推理重复 | `src/agents/bash-tools.exec-approval-followup.ts`（代码） |
| 用户体验   | D.1（批量审批） | 多个 pending 审批可一键批准，减少点击次数           | `aiemas/ui/mas4s/`（前端）                                |

**组合后的预期效果（以 4/13 请求 2 "查看聚合统计" 为例）：**

| 指标         | 修复前 | D.2 生效后          | D.2 + B 生效后 |
| ------------ | ------ | ------------------- | -------------- |
| 审批请求数   | 22     | 0（全部白名单放行） | 0              |
| 重复命令数   | 13     | 0                   | 0              |
| 用户点击次数 | 22     | 0                   | 0              |

对于写操作场景（未来可能出现）：

| 指标         | 仅 D.2               | D.2 + B         | D.2 + B + D.1 |
| ------------ | -------------------- | --------------- | ------------- |
| 审批请求数   | N（每个写命令 1 次） | N（不变）       | N（不变）     |
| 重复命令数   | 可能有               | 0（串行化消除） | 0             |
| 用户点击次数 | N                    | N               | 1（批量批准） |

**实施顺序：**

1. **D.2（白名单）**：修改 `.openclaw/exec-approvals.json`，立即生效
2. **B（串行化）**：修改 `src/agents/bash-tools.exec-approval-followup.ts`，采用 B.5 优化变体
3. **D.1（批量审批）**：AIEMAS UI 前端改动，短期实施

### 9.9 实施记录

#### 9.9.1 D.2 实施：配置只读查询命令白名单

将 `workspace-aieiaas-resource` 和 `workspace-aieiaas-monitor` 的 allowlist 配置复制到 `aieiaas-resource` 和 `aieiaas-monitor` agentId 下。

**修改文件：** `.openclaw/exec-approvals.json`

#### 9.9.2 B 实施：串行化 approved followup

在 `sendExecApprovalFollowup` 中新增 per-sessionKey 的 Promise 链，仅串行化 approved followup（B.5 优化变体）。

**修改文件：** `src/agents/bash-tools.exec-approval-followup.ts`

#### 9.9.3 D.1 实施：批量审批 UI

在顶部通知面板（`main-header.ts` 的 `_renderNotifPanel`）中新增批量操作栏：

**修改文件：** `aiemas/ui/mas4s/src/components/main-header.ts`

**改动内容：**

1. 新增 `_onBatchApprove` 方法：遍历所有 `pendingApprovals`，逐个 dispatch `resolve-approval` 事件（decision=`allow-once`）
2. 新增 `_onBatchDeny` 方法：同上，decision=`deny`
3. 在通知面板 header 下方、列表上方新增批量操作栏，包含"全部拒绝"和"全部批准 (N)"两个按钮
4. 批量操作栏仅在有 pending 审批时显示
5. 新增 `.notif-batch-actions` 和 `.notif-batch-btn` 样式

### 9.10 结论

4/13 日志验证了三个层面的问题状态：

1. **A2A ping-pong 重复审批** — ✅ 已修复（方案 4 `maxPingPongTurns=0`）
2. **announce step 重复审批** — ✅ 已修复（announce early return）
3. **followup 链式执行中的 LLM 重复调用** — ✅ 采用 B + D.2 + D.1 组合方案修复
4. **UI 端重复 resolve** — ⚠️ 前端 bug，不影响后端正确性，建议添加按钮防抖

## 10. 第四类问题：白名单生效后的重复输出（2026-04-13 第二次测试）

### 10.1 问题描述

D.2 白名单配置生效后，"列出xstack上的物理机" 请求不再触发审批（0 个 `exec.approval.request`），exec 命令直接执行。但用户在 UI 上看到物理机列表被重复输出了多次。

### 10.2 日志时序还原

```
14:28:24  用户 chat.send "列出xstack上的物理机"
          → aieiaas (orchestrator) 开始运行 [runId=83b599c4]

14:28:49  aieiaas 调用 aiemas_sessions_send → aieiaas-resource
          → chat.history 获取 resource session 历史（耗时 8560ms）
          → agent 方法触发 aieiaas-resource [runId=906c6116]
          → agent.wait 开始等待（timeout=30s）

14:29:16  aieiaas-resource lifecycle start（LLM 推理开始）
          → resource 读取 SKILL.md → 执行 exec(hosts list)
          → 白名单匹配成功，exec 直接执行（无审批）
          → resource 开始 streaming 输出物理机列表
          → 18 条 [agent:nested] 消息 broadcast 到 webchat 客户端  ← 第 1 次显示

14:29:28  agent.wait 超时返回 status="running"（30027ms）
          → sessions_send 收到 status=running，无 roundOneReply
          → aiemas_sessions_send 返回 { status: "running" } 给 orchestrator

14:29:29  orchestrator 收到 tool result（status=running，无实际内容）
14:29:30  orchestrator LLM 开始生成回复（35 个 assistant streaming 事件）
          → orchestrator 基于 "running" 状态，向用户解释"正在查询中"
          → 35 条 assistant streaming 事件 broadcast 到 webchat 客户端  ← 第 2 次显示

14:29:31  aieiaas-resource lifecycle end（resource 完成，但 orchestrator 已不等待）
14:29:32  agent 方法返回 resource 的完整结果（status=ok, 7 台物理机）
          → 但此时 sessions_send 已经返回了 running，这个结果无人接收
          → orchestrator lifecycle end
```

### 10.3 根因分析

**核心问题：白名单生效后，exec 命令直接执行（无审批等待），但 resource agent 的总执行时间（LLM 推理 + exec 执行 + 结果格式化）超过了 `agent.wait` 的 30 秒超时。**

具体原因链：

1. `chat.history` 耗时 8560ms（gateway 繁忙），消耗了大量等待预算
2. resource agent 的 LLM 推理启动较慢（14:29:16 才 start，距 agent 方法调用已过 18 秒）
3. resource agent 从 start 到 end 耗时 15 秒（14:29:16 → 14:29:31），包含 LLM 推理 + exec 执行 + 结果格式化
4. `agent.wait` 的 30 秒超时在 14:29:28 到期，此时 resource 还在执行中
5. `sessions_send` 收到 `status: "running"` 后，将此状态返回给 orchestrator
6. orchestrator 没有拿到 resource 的实际结果，只能基于 "running" 状态生成回复

**重复输出的两个来源：**

| 来源                             | 内容                      | 时间        | 机制                                       |
| -------------------------------- | ------------------------- | ----------- | ------------------------------------------ |
| resource agent 的 streaming 输出 | 完整的物理机列表          | 14:29:16~31 | `[agent:nested]` broadcast 到 webchat      |
| orchestrator 的 streaming 输出   | 基于 "running" 状态的回复 | 14:29:30~31 | orchestrator assistant streaming broadcast |

用户在 UI 上看到的是两个 agent 的 streaming 输出叠加：resource 的完整结果 + orchestrator 的"正在查询"提示（或者 orchestrator 也可能复述了 resource 的结果，取决于 LLM 行为）。

### 10.4 与之前问题的区别

| 维度       | 之前的重复审批问题            | 本次重复输出问题                |
| ---------- | ----------------------------- | ------------------------------- |
| 触发条件   | exec 审批 → A2A/followup 重复 | 白名单放行 → agent.wait 超时    |
| 重复来源   | 同一命令被多次执行            | 同一结果被两个 agent 分别输出   |
| 是否是 bug | 是（系统逻辑缺陷）            | 是（超时处理 + 双重 broadcast） |
| 影响       | 多次审批请求                  | 用户看到重复内容                |

### 10.5 根因深化：前端消息渲染叠加

从 UI 截图看，物理机列表实际重复显示了 10+ 次，远超后端的 2 个 agent run。这说明问题不仅是后端超时，更核心的是**前端消息渲染策略**。

**前端 `event-handler.ts` 的 `handleAgentEvent` 不区分 orchestrator session 和子 agent session。** 两个 session 共享同一个 group UUID（`extractUuidFromKey` 提取末尾 UUID），所有 agent-events 都被渲染到同一个 chat view 中。

**重复输出的来源（多层叠加）：**

| #   | 来源                             | 时间        | 事件类型                                                  | 渲染为                                       |
| --- | -------------------------------- | ----------- | --------------------------------------------------------- | -------------------------------------------- |
| 1   | resource agent streaming 输出    | 14:29:18    | `agent` event (stream=assistant, sessionKey=resource)     | Agent 气泡（物理机列表）                     |
| 2   | resource agent tool events       | 14:29:18~28 | `agent` event (stream=tool, sessionKey=resource)          | ToolResult 卡片（exec 结果）                 |
| 3   | orchestrator tool result         | 14:29:28    | `agent` event (stream=tool, sessionKey=orchestrator)      | ToolResult 卡片（aiemas_sessions_send 结果） |
| 4   | orchestrator assistant streaming | 14:29:30    | `agent` event (stream=assistant, sessionKey=orchestrator) | Agent 气泡（orchestrator 复述结果）          |
| 5   | resource chat final              | 14:29:31    | `chat` event (state=final, sessionKey=resource)           | Agent 气泡（resource 最终输出）              |
| 6   | orchestrator chat final          | 14:29:31    | `chat` event (state=final, sessionKey=orchestrator)       | Agent 气泡（orchestrator 最终输出）          |
| 7+  | resource 的多个 assistant delta  | 14:29:18~31 | 每个 delta 如果 id 不匹配 last msg 则追加新气泡           | 多个 Agent 气泡碎片                          |

**关键放大机制：** `updateChatStream` 只在"最后一条消息 ID 匹配"时做原地更新。中间插入的 tool event 消息会打断 assistant streaming 的连续性，导致后续的 assistant delta 被追加为新气泡而非更新已有气泡。这就是为什么实际重复次数远超 4 次，可达 10+ 次。

### 10.6 解决方案

#### 方案 E.1：增加 `timeoutSeconds`（治标）

将 `aiemas_sessions_send` 的 `timeoutSeconds` 从 30 秒增加到 120 秒，减少 `agent.wait` 超时导致的 `running` 状态返回。

**效果：** 减少超时场景，但不解决子 agent streaming 输出与 orchestrator 输出的叠加问题。

#### 方案 E.2：前端过滤子 agent session 的 streaming 事件（治本）

在 `handleAgentEvent` 和 `handleChatEvent` 中，识别子 agent session（sessionKey 中 agentId 不是当前会话的主 agent），跳过其 assistant streaming 和 chat final 事件的渲染。子 agent 的结果由 orchestrator 通过 tool result 统一呈现。

**改动位置：** `aiemas/ui/mas4s/src/gateway/event-handler.ts`

**核心逻辑：**

```typescript
// 在 handleAgentEvent 入口处：
const agentId = extractAgentNameFromKey(sessionKey);
const activeSession = store.activeSession;
const mainAgentId = activeSession ? extractAgentNameFromKey(activeSession.key) : null;

// 如果事件来自子 agent session（agentId 不是主 agent），
// 跳过 assistant streaming 渲染，避免与 orchestrator 输出重复
if (mainAgentId && agentId !== mainAgentId && stream === "assistant") {
  return;
}
```

**同时需要处理：**

- `handleChatEvent` 中的 `state=final` 也需要同样的过滤
- tool events（stream=tool）来自子 agent 时，可能也需要过滤或折叠
- 需要保留子 agent 的 approval events（不过滤）

#### 方案 E.3：E.1 + E.2 组合（推荐）

- E.1 增加超时，减少 `running` 状态返回
- E.2 前端过滤子 agent streaming，消除重复渲染

**状态：暂不实施，待后续排期。**
