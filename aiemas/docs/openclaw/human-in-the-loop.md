# OpenClaw 人工审核机制（Human-in-the-Loop / Exec Approvals）

本文档详细描述 OpenClaw 对 `exec`（shell 命令执行）工具的人工审核机制，包括触发条件、审核流程、通知渠道、配置方式及 `exec-approvals.json` 的完整实现。

## 1. 审核触发条件

核心判断逻辑在 `src/infra/exec-approvals.ts` 的 `requiresExecApproval()`：

```typescript
export function requiresExecApproval(params: {
  ask: ExecAsk; // "off" | "on-miss" | "always"
  security: ExecSecurity; // "deny" | "allowlist" | "full"
  analysisOk: boolean;
  allowlistSatisfied: boolean;
}): boolean {
  return (
    params.ask === "always" ||
    (params.ask === "on-miss" &&
      params.security === "allowlist" &&
      (!params.analysisOk || !params.allowlistSatisfied))
  );
}
```

### 1.1 三种安全模式（`security`）

| 值          | 行为                                         |
| ----------- | -------------------------------------------- |
| `deny`      | 完全禁止 exec，无论 ask 设置（**系统默认**） |
| `allowlist` | 只允许白名单命令；不在白名单则触发审核       |
| `full`      | 允许所有命令，不触发审核                     |

### 1.2 三种询问模式（`ask`）

| 值        | 行为                               |
| --------- | ---------------------------------- |
| `off`     | 从不询问（白名单外直接拒绝）       |
| `on-miss` | 白名单未命中时询问（**系统默认**） |
| `always`  | 每次都询问                         |

### 1.3 强制触发审核的额外条件

即使命令命中白名单，以下情况也会强制触发审核：

- heredoc 执行（命令含 `<<` 语法）
- 检测到命令混淆（obfuscation）

### 1.4 必要前提：`host` 必须为 `"gateway"`

审核逻辑只在 `host === "gateway"` 时进入（`src/agents/bash-tools.exec.ts`）：

```typescript
if (host === "gateway" && !bypassApprovals) {
  const gatewayResult = await processGatewayAllowlist({ ... });
}
```

`host` 默认值为 `"sandbox"`，此时整个审核分支被跳过。必须在 `openclaw.json` 中显式配置：

```json
{
  "tools": {
    "exec": {
      "host": "gateway",
      "security": "allowlist",
      "ask": "on-miss"
    }
  }
}
```

## 2. 审核流程（阻塞式）

审核请求会**阻塞** agent 执行，直到用户决策或超时（默认 120 秒）：

```
exec 工具调用
    │
    ▼
src/agents/bash-tools.exec-host-gateway.ts
    │  evaluateShellAllowlist() → 检查白名单
    │  requiresExecApproval() → 判断是否需要审核
    │
    ▼（需要审核）
src/agents/bash-tools.exec-host-shared.ts
    │  createAndRegisterDefaultExecApprovalRequest()
    │  → registerExecApprovalRequestForHostOrThrow()
    │
    ▼
src/gateway/server-methods/exec-approval.ts  exec.approval.request handler
    │  1. 创建 approval record（含 id、command、cwd、agentId、sessionKey、expiresAtMs）
    │  2. manager.register(record, timeoutMs) → 返回 decisionPromise（阻塞等待）
    │  3. broadcast("exec.approval.requested", { id, request, createdAtMs, expiresAtMs })
    │     ↑ 仅发给有 operator.approvals scope 的 WS 客户端
    │  4. opts.forwarder.handleRequested() → 转发到消息渠道（Telegram/Discord 等）
    │  5. await decisionPromise  ← 阻塞，等待用户决策
    │
    ▼（用户决策）
exec.approval.resolve handler
    │  manager.resolve(approvalId, decision, resolvedBy)
    │  broadcast("exec.approval.resolved", { id, decision, resolvedBy, ts })
    │
    ▼
decisionPromise 解除阻塞
    │  decision: "allow-once" | "allow-always" | "deny"
    │
    ▼
evaluateSystemRunPolicy() → allowed: true/false
    │
    ▼（allowed）
exec 工具继续执行
```

## 3. 审核通知渠道

`src/infra/exec-approval-forwarder.ts` 的 `createExecApprovalForwarder` 负责把审核请求转发到消息渠道：

**转发目标解析优先级（`resolveForwardTargets`）：**

1. `mode: "session"` — 当前 turn 的来源 channel（`turnSourceChannel`/`turnSourceTo`）
2. `mode: "targets"` — 配置中显式指定的 `approvals.exec.targets`
3. `mode: "both"` — 两者都发

**Web UI（通过 WS 事件）：**

```json
{
  "type": "event",
  "event": "exec.approval.requested",
  "payload": {
    "id": "approval-uuid",
    "request": {
      "command": "rm -rf /tmp/test",
      "cwd": "/home/user",
      "agentId": "main",
      "sessionKey": "agent:main:main",
      "host": "gateway",
      "security": "allowlist",
      "ask": "on-miss"
    },
    "createdAtMs": 1710000000000,
    "expiresAtMs": 1710000120000
  }
}
```

**Telegram/Discord（文本消息，`src/infra/exec-approval-reply.ts`）：**

````
Approval required.
Run:
```txt
/approve abc123 allow-once
````

Pending command:

```sh
rm -rf /tmp/test
```

Other options:

```txt
/approve abc123 allow-always
/approve abc123 deny
```

Host: gateway
CWD: /home/user
Expires in: 120s
Full id: `approval-uuid`

```

## 4. 决策选项

| 决策 | 含义 |
|------|------|
| `allow-once` | 本次允许，下次同样命令仍需审核 |
| `allow-always` | 允许并将命令模式加入白名单（持久化到 `~/.openclaw/exec-approvals.json`） |
| `deny` | 拒绝执行 |

`allow-always` 会调用 `addAllowlistEntry()` 将命令模式写入 `~/.openclaw/exec-approvals.json`，后续相同命令自动放行。

> **重要：`allow-always` 与 followup 循环风险**
>
> 当 agent 在单次任务中需要执行多条命令时，对第一条命令选择 `allow-always` 后，
> gateway 会启动 `exec-approval-followup` agent run 来继续任务。
> 如果模型指令遵循能力不足（例如使用本地/开源模型），该 followup run 可能重新规划任务
> 并再次发出相同命令序列，触发新一轮审核，形成循环。
>
> **建议：** 对统计、查询类只读命令优先使用 `allow-always` 将其加入白名单，
> 而不是在任务执行中途反复选择 `allow-always`。
> 对写操作命令使用 `allow-once`，避免 followup 循环。

## 5. 超时 fallback 策略

`askFallback` 配置决定审核超时后的行为（`src/node-host/exec-policy.ts`）：

| `askFallback` | 超时后行为 |
|---------------|-----------|
| `deny`（默认）| 拒绝执行，返回错误 |
| `allowlist` | 若命令在白名单则放行，否则拒绝 |

超时后 agent 会收到 followup 消息：
```

Exec denied (gateway id=<approvalId>, approval-timeout): <command>

````

## 6. WS 事件 scope 控制

审核相关事件受 scope 保护（`src/gateway/server-broadcast.ts`）：

```typescript
const EVENT_SCOPE_GUARDS: Record<string, string[]> = {
  "exec.approval.requested": ["operator.approvals"],
  "exec.approval.resolved": ["operator.approvals"],
};
````

客户端需在 `connect` 请求中声明 `scopes: ["operator.approvals"]` 或 `scopes: ["operator.admin"]` 才能收到审核事件。

对应的 RPC 方法也受同样的 scope 保护（`src/gateway/method-scopes.ts`）：

- `exec.approval.request` — 发起审核请求
- `exec.approval.waitDecision` — 等待审核决策
- `exec.approval.resolve` — 提交审核决策

## 7. 子 Agent（sessions_spawn）的审核

子 agent 本身没有独立的审核门，但有两层间接控制：

1. `sessions_spawn` 被列在 `DANGEROUS_ACP_TOOLS`（`src/security/dangerous-tools.ts`），在 ACP 场景下强制要求用户确认：

```typescript
export const DANGEROUS_ACP_TOOL_NAMES = [
  "exec",
  "spawn",
  "shell",
  "sessions_spawn",
  "sessions_send",
  "gateway",
  "fs_write",
  "fs_delete",
  "fs_move",
  "apply_patch",
] as const;

export const DANGEROUS_ACP_TOOLS = new Set<string>(DANGEROUS_ACP_TOOL_NAMES);
```

2. 子 agent 执行的 exec 命令同样走上述审核流程，子 agent 执行危险命令时仍会触发人工审核。

## 8. exec-approvals.json 实现

### 8.1 文件结构

`~/.openclaw/exec-approvals.json` 是审核配置的持久化存储，结构如下：

```json
{
  "version": 1,
  "socket": {
    "path": "~/.openclaw/exec-approvals.sock",
    "token": "<auto-generated>"
  },
  "defaults": {
    "security": "allowlist",
    "ask": "on-miss",
    "askFallback": "deny",
    "autoAllowSkills": false
  },
  "agents": {
    "main": {
      "allowlist": [
        { "id": "uuid-1", "pattern": "git *", "lastUsedAt": 1710000000000 },
        { "id": "uuid-2", "pattern": "npm test" }
      ]
    }
  }
}
```

### 8.2 配置优先级合并逻辑

`resolveExecApprovalsFromFile()`（`src/infra/exec-approvals.ts`）的合并顺序：

```
系统默认值（DEFAULT_SECURITY="deny", DEFAULT_ASK="on-miss"）
    ↓ 被 openclaw.json tools.exec 覆盖（作为 overrides 传入）
    ↓ 被 exec-approvals.json defaults 覆盖
    ↓ 被 exec-approvals.json agents["*"]（通配符）覆盖
    ↓ 被 exec-approvals.json agents["<agentId>"] 覆盖
```

`security` 取 `minSecurity`（更严格的一方），`ask` 取 `maxAsk`（更宽松的一方）：

```typescript
const hostSecurity = minSecurity(params.security, approvals.agent.security);
const hostAsk = approvals.agent.ask === "off" ? "off" : maxAsk(params.ask, approvals.agent.ask);
```

### 8.3 白名单 pattern 匹配规则

白名单 pattern 通过 `matchesExecAllowlistPattern()`（`src/infra/exec-allowlist-pattern.ts`）匹配，规则：

- `*` — 匹配单段路径中的任意字符（不跨 `/`），例如 `/opt/homebrew/bin/*` 匹配该目录下所有二进制
- `**` — 匹配任意深度路径，例如 `/Users/admin/clawd/**/*`
- `~` 前缀自动展开为 home 目录
- 匹配目标是命令的**实际解析路径**（`resolvedPath`），而非原始命令字符串

不含路径分隔符（`/`、`\`、`~`）的 pattern 会被跳过（不参与匹配）。

### 8.4 safeBins 机制

`safeBins` 是白名单的补充，用于免配置放行常见安全工具（如 `cat`、`ls`、`grep` 等）。满足以下全部条件才放行：

1. 命令名在 `safeBins` 列表中
2. 实际解析路径在 `safeBinTrustedDirs` 受信目录下
3. 命令参数符合该工具的 `safeBinProfiles` 安全策略（防止参数注入）

**推荐的 safeBins 基础配置（适用于代码/统计类任务）：**

```json
{
  "tools": {
    "exec": {
      "host": "gateway",
      "security": "allowlist",
      "ask": "on-miss",
      "safeBins": [
        "jq",
        "cut",
        "uniq",
        "head",
        "tail",
        "tr",
        "wc",
        "git",
        "find",
        "du",
        "ls",
        "awk",
        "sed",
        "sort",
        "echo",
        "cat",
        "grep"
      ],
      "safeBinTrustedDirs": ["/bin", "/usr/bin", "/opt/homebrew/bin", "/usr/local/bin"]
    }
  }
}
```

将常用只读命令加入 `safeBins` 是避免 followup 循环的最直接手段：命令直接放行，不进入审核流程，也就不会触发 followup agent run。

### 8.5 allow-always 持久化

用户选择 `allow-always` 后，`addAllowlistEntry()` 将命令的实际解析路径写入对应 agent 的 `allowlist`，下次相同命令自动放行，无需再次审核。

## 9. Followup 循环问题（已知风险）

### 9.1 问题描述

当 agent 在单次任务中执行多条需要审核的命令时，可能出现以下循环：

```
用户发送任务
  → agent 执行命令 A → 触发审核
  → 审核通过 → exec-approval-followup 启动新 agent run（idempotencyKey: exec-approval-followup:<id>）
  → 新 run 重新规划任务，再次执行命令 A、B、C
  → 每条命令再次触发审核
  → 每次审核通过又启动新 followup run
  → gateway lane 队列积压（lane wait exceeded: queueAhead=N↑）
  → 最终需要手动 SIGINT 终止 gateway
```

诊断特征（gateway 日志）：

- `exec-approval-followup:<id>` runId 反复出现
- `lane wait exceeded: lane=session:agent:default:group:... queueAhead=N` 数字持续增长
- 相同命令被重复审核多次

### 9.2 根本原因

`exec-approval-followup` 机制（`src/agents/bash-tools.exec-approval-followup.ts`）在审核通过、命令执行完成后，通过 `callGatewayTool("agent", ...)` 向 agent 发送一条 followup 消息，让 agent 将结果回复给用户。

followup prompt 为：

```
An async command the user already approved has completed.
Do not run the command again.

Exact completion details:
<result>

Reply to the user in a helpful way.
```

当模型（尤其是本地/开源模型）指令遵循能力不足时，会忽略 "Do not run the command again" 指令，将 followup 当作新任务起点，重新规划并执行整个命令序列。

### 9.3 彻底解决方案

**层次一：配置层（最优先，成本最低）**

将所有只读/统计类命令加入 `safeBins`，使其直接放行，不进入审核流程：

```json
{
  "tools": {
    "exec": {
      "host": "gateway",
      "security": "allowlist",
      "ask": "on-miss",
      "safeBins": [
        "jq",
        "cut",
        "uniq",
        "head",
        "tail",
        "tr",
        "wc",
        "git",
        "find",
        "du",
        "ls",
        "awk",
        "sed",
        "sort",
        "echo",
        "cat",
        "grep"
      ],
      "safeBinTrustedDirs": ["/bin", "/usr/bin", "/opt/homebrew/bin", "/usr/local/bin"]
    },
    "agents": {
      "defaults": {
        "maxSteps": 40
      }
    }
  }
}
```

`maxSteps` 作为兜底：即使循环发生，agent 也会在达到步数上限后自动终止。

**层次二：代码层（彻底修复 followup prompt）**

`src/agents/bash-tools.exec-approval-followup.ts` 中的 `buildExecApprovalFollowupPrompt` 需要更强的指令约束，防止模型重新规划任务：

```typescript
// 原始实现（过于宽松，模型可能忽略约束）
export function buildExecApprovalFollowupPrompt(resultText: string): string {
  return [
    "An async command the user already approved has completed.",
    "Do not run the command again.",
    "",
    "Exact completion details:",
    resultText.trim(),
    "",
    "Reply to the user in a helpful way.",
    "If it succeeded, share the relevant output.",
    "If it failed, explain what went wrong.",
  ].join("\n");
}

// 改进版（多重约束，适配指令遵循能力弱的模型）
export function buildExecApprovalFollowupPrompt(resultText: string): string {
  return [
    "An async command the user already approved has completed.",
    "The command has already been executed — do not call exec or any other tool.",
    "Do not re-run the command. Do not start new tasks.",
    "",
    "Exact completion details:",
    resultText.trim(),
    "",
    "Reply to the user with the relevant output above.",
    "If it succeeded, share the key results.",
    "If it failed, explain what went wrong.",
    "Do not call any tools.",
  ].join("\n");
}
```

**层次三：架构层（长期方向）**

理想的 followup 机制应该是"继续当前 run"而非"启动新 run"。当前实现通过 `callGatewayTool("agent", ...)` 启动一个全新的 agent run，新 run 没有原始任务的工具调用上下文，模型只能从 followup prompt 推断意图，容易误判。

长期改进方向：在 followup run 中注入原始任务的 tool call 历史作为上下文，让模型明确知道"我已经执行了哪些步骤，现在只需要汇报结果"。

## 10. 完整审核时序图

```
Agent                    Gateway                    UI/Telegram
  │                         │                           │
  │── exec tool call ──────►│                           │
  │                         │── 检查白名单 ─────────────│
  │                         │   requiresExecApproval()  │
  │                         │                           │
  │                         │── broadcast ─────────────►│
  │                         │   "exec.approval.requested"│
  │                         │   { id, command, expiresAtMs }
  │                         │                           │
  │                         │── forwarder ─────────────►│ Telegram 消息
  │                         │   handleRequested()       │ "Approval required..."
  │                         │                           │
  │   (阻塞等待，最长 120s)  │                           │
  │                         │                           │
  │                         │◄── exec.approval.resolve ─│ 用户回复 /approve
  │                         │    { id, decision }       │
  │                         │                           │
  │                         │── broadcast ─────────────►│
  │                         │   "exec.approval.resolved"│
  │                         │   { id, decision, resolvedBy }
  │                         │                           │
  │◄── decision resolved ───│                           │
  │    allow-once/deny       │                           │
  │                         │                           │
  │── 继续执行 or 返回错误 ──│                           │
  │                         │                           │
  │   (命令执行完成)         │                           │
  │                         │                           │
  │                         │── sendExecApprovalFollowup►│ ⚠ 新 agent run
  │                         │   idempotencyKey=         │   (循环风险点)
  │                         │   exec-approval-followup: │
  │                         │   <approvalId>            │
```

## 11. Telegram 审核配置示例

```json
{
  "approvals": {
    "exec": {
      "enabled": true,
      "mode": "session",
      "targets": [{ "channel": "telegram", "to": "123456789" }]
    }
  }
}
```
