# Exec Approval Followup Fix

## Problem

当用户批准 exec 工具调用后，系统应该继续执行命令并发送结果给用户。但实际上，followup 机制在批准后失败，导致工具调用停止。

### 症状

从 gateway 日志可以看到：

```
22:32:50+08:00 [ws] ⇄ res ✓ exec.approval.waitDecision 10509ms
22:32:50+08:00 [gateway] mas4s onClientDisconnected conn=63767864…ba06
22:32:52+08:00 [ws] ⇄ res ✗ agent 50ms errorCode=INVALID_REQUEST errorMessage=Error: Channel is required (no configured channels detected).
```

1. ✓ 审核决策正确返回
2. ✗ 但 followup agent 工具调用失败，错误是"Channel is required"

### 根本原因

`sendExecApprovalFollowup` 函数使用 `callGatewayTool("agent", ...)` 来发送 followup 消息。但是：

1. 当原始请求来自 WS（Web Socket）而不是消息渠道时，`turnSourceChannel` 和 `turnSourceTo` 为空
2. 代码将这些空值传递给 `agent` 工具的 `channel` 和 `to` 参数
3. `agent` 工具要求 `channel` 是必需的（通过 `resolveMessageChannelSelection`）
4. 因此调用失败，followup 消息无法发送

### 解决方案

使用 `sessions.send` 工具而不是 `agent` 工具：

- `sessions.send` 不需要 `channel` 参数
- `sessions.send` 可以直接通过 `sessionKey` 发送消息到任何会话
- 这样即使没有配置消息渠道，followup 也能正常工作

## 修改

### 文件：`src/agents/bash-tools.exec-approval-followup.ts`

**改动：**

- 将 `callGatewayTool("agent", ...)` 改为 `callGatewayTool("sessions.send", ...)`
- 添加诊断日志以便追踪 followup 流程

**原因：**

- `sessions.send` 是发送会话间消息的标准方式
- 不依赖于消息渠道配置
- 支持 `sessionKey` 直接寻址

### 文件：`src/agents/bash-tools.exec-host-gateway.ts`

**改动：**

- 在审核注册时添加日志
- 在审核决策返回时添加日志
- 在 exec 完成后发送 followup 时添加日志

**原因：**

- 帮助诊断 followup 流程中的问题
- 记录关键的状态转换

## 测试

运行以下命令验证修复：

```bash
# 检查语法
pnpm tsgo

# 运行相关测试
pnpm test -- src/agents/bash-tools.exec-approval-followup.ts
pnpm test -- src/agents/bash-tools.exec-host-gateway.ts
```

## 预期行为

修复后，exec 审核流程应该：

1. 用户批准 exec 命令
2. `exec.approval.waitDecision` 返回决策
3. 命令执行
4. `sessions.send` 发送 followup 消息（不再失败）
5. Agent 收到 followup 消息并回复用户

## 相关文档

- `aiemas/docs/openclaw/human-in-the-loop.md` — 完整的审核机制文档
- `src/agents/bash-tools.exec-approval-followup.ts` — followup 实现
- `src/agents/bash-tools.exec-host-gateway.ts` — gateway exec 处理
