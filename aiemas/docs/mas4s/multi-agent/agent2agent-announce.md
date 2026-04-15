# Announce 异步结果回传机制

**源文件：** `src/agents/subagent-announce-delivery.ts`, `src/agents/subagent-announce.ts`

子 agent 完成任务后，通过 announce 机制将结果异步推送回父 agent：

```
Child Agent 运行完成
  │
  ├─ 构建 triggerMessage（完成通知 prompt，包含任务概要、结果、状态）
  │
  ├─ 检查父 session 状态
  │   │
  │   ├─ [父 session 活跃中] isEmbeddedPiRunActive(sessionId) = true
  │   │   ├─ mode=steer → queueEmbeddedPiMessage(steer)  // 注入父 agent 当前运行
  │   │   └─ mode=followup/collect → enqueueAnnounce()   // 放入队列待处理
  │   │
  │   └─ [父 session 空闲] sendSubagentAnnounceDirectly()
  │       └── callGateway("agent", {
  │             sessionKey: parentKey,
  │             message: triggerMessage,
  │             role: "system",        // 以 system 角色注入
  │             deliver: true/false,   // 是否推送到外部 channel
  │             inputProvenance: { kind: "inter_session", sourceTool: "subagent_announce" }
  │           })
  │
  └─ 父 agent 收到系统消息后自动处理（生成回复或触发进一步动作）
```

## 瞬时错误自动重试

recognize 以下错误为瞬时错误，自动重试（间隔 5s/10s/20s，最多 3 次）：

```
UNAVAILABLE, gateway not connected, gateway closed (1006),
ECONNRESET, ECONNREFUSED, ETIMEDOUT, no active listener ...
```

永久错误（`unsupported channel`, `chat not found`, `bot was kicked` 等）不重试直接失败。
