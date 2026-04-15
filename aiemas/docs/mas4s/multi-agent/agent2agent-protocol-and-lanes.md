# 通信协议与 Lane 机制

---

## 1. 协议层架构

所有跨 session 通信均通过 `callGateway()` 这一统一入口，底层走 WebSocket/IPC 到 Gateway 进程：

```
┌─────────────────────────────────────────────────────────┐
│                    Agent (A / B)                         │
│  callGateway(method, params)                             │
└────────────────────────┬────────────────────────────────┘
                         │ WebSocket / IPC
                         ▼
┌─────────────────────────────────────────────────────────┐
│                   Gateway 进程                           │
│  负责 session 路由、消息队列、运行状态跟踪                   │
└─────────────────────────────────────────────────────────┘
```

## 2. 关键 Gateway 方法

| 方法               | 用途                                                   |
| ------------------ | ------------------------------------------------------ |
| `agent`            | 向指定 sessionKey 注入消息并触发 agent 运行            |
| `agent.wait`       | 阻塞等待指定 runId 完成                                |
| `chat.history`     | 读取指定 session 的消息历史                            |
| `sessions.patch`   | 修改 session 元数据（spawnDepth, model 等）            |
| `sessions.delete`  | 删除 session（错误清理用）                             |
| `sessions.resolve` | 通过 label/agentId 查找 session key                    |
| `send`             | 向指定 channel/to 发出外部消息（Telegram、Discord 等） |

## 3. 消息元数据

每条跨 agent 的 `agent` 方法调用都会携带溯源信息：

```typescript
inputProvenance: {
  kind: "inter_session",
  sourceSessionKey: "agent:requester:...",
  sourceChannel: "internal",
  sourceTool: "sessions_send" | "subagent_announce" | "sessions_spawn"
}
```

## 4. Lane 机制

不同类型的 A2A 调用使用不同的 lane，避免队列干扰：

| Lane 常量             | 值           | 用途                                 |
| --------------------- | ------------ | ------------------------------------ |
| `AGENT_LANE_NESTED`   | `"nested"`   | `sessions_send` 的跨 session 消息    |
| `AGENT_LANE_SUBAGENT` | `"subagent"` | `sessions_spawn` 启动的子 agent 任务 |
