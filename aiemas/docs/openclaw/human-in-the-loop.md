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

### 8.5 allow-always 持久化

用户选择 `allow-always` 后，`addAllowlistEntry()` 将命令的实际解析路径写入对应 agent 的 `allowlist`，下次相同命令自动放行，无需再次审核。

## 9. 完整审核时序图

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
```

## 10. Telegram 审核配置示例

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
