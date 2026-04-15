# `sessions_spawn` 工具 — 创建子 Agent

**源文件：** `src/agents/subagent-spawn.ts`

---

## 1. 参数与前置检查

```typescript
type SpawnSubagentParams = {
  task: string; // 子 agent 要执行的任务描述
  label?: string; // 标识符（用于父 agent 识别子 session）
  agentId?: string; // 目标 agent id，不填则继承发送方 agentId
  model?: string; // 模型覆盖（"provider/model" 格式）
  thinking?: string; // 思考等级覆盖
  runTimeoutSeconds?: number; // 运行超时秒数（0=不限制）
  thread?: boolean; // 是否绑定到消息线程
  mode?: "run" | "session";
  cleanup?: "delete" | "keep";
  sandbox?: "inherit" | "require";
  expectsCompletionMessage?: boolean;
  attachments?: Attachment[]; // 文件附件
  attachMountPath?: string;
};
```

前置检查（按顺序，任一失败立即返回）：

| 检查项                                               | 失败结果              |
| ---------------------------------------------------- | --------------------- |
| `agentId` 格式合法性（`isValidAgentId`）             | `status: "error"`     |
| `callerDepth >= maxSpawnDepth`（默认 5 层）          | `status: "forbidden"` |
| `activeChildren >= maxChildrenPerAgent`（默认 5 个） | `status: "forbidden"` |
| `requireAgentId=true` 但未提供 `agentId`             | `status: "forbidden"` |
| 目标 agentId 不在 `allowAgents` 白名单               | `status: "forbidden"` |
| 沙盒 session 尝试 spawn 非沙盒子 agent               | `status: "forbidden"` |

---

## 2. Spawn 流程（六步）

```
步骤 1: 生成 childSessionKey
  └── "agent:{targetAgentId}:subagent:{crypto.randomUUID()}"

步骤 2: sessions.patch — 写入子 session 初始元数据
  └── { spawnDepth, subagentRole, subagentControlScope, model?, thinkingLevel? }

步骤 3: 持久化 model 到 Session Store（如指定了 model）
  └── updateSessionStore(storePath, { model, modelProvider })

步骤 4: 线程绑定（thread=true 时）
  └── hookRunner.runSubagentSpawning → channel plugin 分配或绑定线程

步骤 5: 物化附件（如有 attachments）
  └── materializeSubagentAttachments → 写入磁盘，返回系统提示后缀

步骤 6: 写入 lineage 元数据（spawnedBy + workspaceDir）
  └── sessions.patch(childSessionKey, { spawnedBy: requesterKey, spawnedWorkspaceDir })

步骤 7: 提交子 agent 运行
  └── callGateway("agent", {
        message: childTaskMessage,     // "[Subagent Context]... [Subagent Task]: {task}"
        sessionKey: childSessionKey,
        lane: "subagent",
        deliver: false,
        idempotencyKey: crypto.randomUUID(),
        extraSystemPrompt: childSystemPrompt + attachmentSuffix,
        thinking: thinkingOverride,
        timeout: runTimeoutSeconds,
        label,
        spawnedBy: requesterKey,
        workspaceDir: resolvedWorkspaceDir,
      })
  → 返回 { childSessionKey, runId, status: "accepted" }
```

---

## 3. 子 agent 系统提示注入

`buildSubagentSystemPrompt` 注入以下上下文（`extraSystemPrompt`）：

- 请求方 session key + 原始来源（channel/to/threadId）
- 当前 spawnDepth/maxSpawnDepth
- auto-announce 行为说明（禁止轮询，等待 completion event）

`childTaskMessage`（作为子 agent 的第一条用户消息）：

```
[Subagent Context] You are running as a subagent (depth 1/5). Results auto-announce to your requester; do not busy-poll for status.
[Subagent Task]: <task 内容>
```
