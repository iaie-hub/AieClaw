# Agent-to-Agent (A2A) 通信实现分析

## 总览

AieClaw 中的 Agent-to-Agent 通信基于 **Gateway 中间层** 实现，所有跨 agent 的消息发送均通过 `callGateway` 进行，不存在 agent 之间的直接 socket/内存调用。

## 文档索引

| 文档                                                                                   | 内容                                                 |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| [agent2agent-sessions-send-and-receive.md](./agent2agent-sessions-send-and-receive.md) | `sessions_send` 消息发送 + 目标 Session 消息接收方案 |
| [agent2agent-sessions-spawn.md](./agent2agent-sessions-spawn.md)                       | `sessions_spawn` 子 Agent 创建                       |
| [agent2agent-protocol-and-lanes.md](./agent2agent-protocol-and-lanes.md)               | 通信协议、Gateway 方法、Lane 机制                    |
| [agent2agent-ping-pong-flow.md](./agent2agent-ping-pong-flow.md)                       | Ping-Pong 多轮对话机制                               |
| [agent2agent-history-sync.md](./agent2agent-history-sync.md)                           | 历史消息同步方案                                     |
| [agent2agent-access-control.md](./agent2agent-access-control.md)                       | 权限控制体系                                         |
| [agent2agent-announce.md](./agent2agent-announce.md)                                   | Announce 异步结果回传机制                            |

---

## 整体架构图

```
┌──────────────────────────────────────────────────────────────────┐
│                         Gateway 进程                              │
│                                                                    │
│  ┌────────────┐   method:"agent"    ┌─────────────────────────┐  │
│  │  Agent A   │ ─────────────────→  │  Agent B session        │  │
│  │  session   │                     │  (内部 channel, nested) │  │
│  └─────┬──────┘ ←─────────────────  └───────────────────┬─────┘  │
│        │         announce/steer/reply                    │        │
│        │                                                 │        │
│        └────── sessions_history ────────────────────────┘        │
│                  (chat.history RPC, 80KB上限, redact)             │
│                                                                    │
│  subagentRuns Map (进程内注册表, 父子关系/生命周期)                  │
│  Session Store   (文件系统, 按 agentId 分目录, 元数据持久化)         │
└──────────────────────────────────────────────────────────────────┘
```

---

## 关键设计原则

| 原则           | 实现方式                                                         |
| -------------- | ---------------------------------------------------------------- |
| **无直接通信** | 所有 A2A 消息经 Gateway 路由，保持隔离                           |
| **异步推送**   | subagent 完成用 announce 推送，父 agent 不轮询                   |
| **权限双层**   | Visibility + A2A Policy，默认关闭，需显式配置                    |
| **数据隔离**   | Session Store 按 agentId 分目录，Registry 是进程内全局状态       |
| **安全清洗**   | 跨 session 读取历史时强制 redact 凭证、删除图片 base64           |
| **幂等性**     | 每次 Gateway 调用携带 `idempotencyKey`（UUID）防重复执行         |
| **追溯性**     | 每条跨 session 消息携带 `inputProvenance`，记录来源 session/tool |

---

## 相关源文件索引

| 文件                                           | 功能                                       |
| ---------------------------------------------- | ------------------------------------------ |
| `src/agents/tools/sessions-send-tool.ts`       | `sessions_send` 工具主实现                 |
| `src/agents/tools/sessions-send-tool.a2a.ts`   | A2A Flow（Ping-Pong + Announce）           |
| `src/agents/tools/sessions-send-helpers.ts`    | Ping-Pong 上下文构建、轮次配置             |
| `src/agents/tools/sessions-access.ts`          | A2A 权限策略（Policy + Visibility Guard）  |
| `src/agents/tools/sessions-history-tool.ts`    | `sessions_history` 工具                    |
| `src/agents/subagent-spawn.ts`                 | `sessions_spawn` 子 agent 创建             |
| `src/agents/subagent-control.ts`               | 子 agent 控制（list/kill/steer）           |
| `src/agents/subagent-announce-delivery.ts`     | Announce 异步回传 + 重试                   |
| `src/agents/subagent-registry.ts`              | 子 agent 注册表（CRUD）                    |
| `src/agents/subagent-registry-memory.ts`       | 进程内全局 `subagentRuns` Map              |
| `src/agents/tools/agent-step.ts`               | 单步 agent 调用（Ping-Pong 内部使用）      |
| `src/gateway/server-methods/agent.ts`          | Gateway `agent` 方法处理器（消息接收入口） |
| `src/agents/agent-command.ts`                  | Agent 命令执行入口（agentCommandInternal） |
| `src/agents/pi-embedded-runner/run/attempt.ts` | Agent 运行逻辑（session 创建、LLM 推理）   |
| `src/process/command-queue.ts`                 | Lane 队列调度（消息排队与并发控制）        |
| `src/process/lanes.ts`                         | Lane 常量定义（Main/Nested/Subagent/Cron） |
| `src/utils/message-channel-constants.ts`       | `INTERNAL_MESSAGE_CHANNEL` 常量定义        |
| `src/sessions/input-provenance.ts`             | `inputProvenance` 类型与判断工具           |
