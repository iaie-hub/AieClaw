# Agent-to-Agent (A2A) 通信实现分析

> ⚠️ 本文档已拆分到 `aiemas/docs/mas4s/multi-agent/` 目录，请查阅对应文件。

## 文档索引

| 文档                                                                                                      | 内容                                                 |
| --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| [agent2agent-README.md](../mas4s/multi-agent/agent2agent-README.md)                                       | 总览、架构图、设计原则、源文件索引                   |
| [agent2agent-sessions-send-and-receive.md](../mas4s/multi-agent/agent2agent-sessions-send-and-receive.md) | `sessions_send` 消息发送 + 目标 Session 消息接收方案 |
| [agent2agent-sessions-spawn.md](../mas4s/multi-agent/agent2agent-sessions-spawn.md)                       | `sessions_spawn` 子 Agent 创建                       |
| [agent2agent-protocol-and-lanes.md](../mas4s/multi-agent/agent2agent-protocol-and-lanes.md)               | 通信协议、Gateway 方法、Lane 机制                    |
| [agent2agent-ping-pong-flow.md](../mas4s/multi-agent/agent2agent-ping-pong-flow.md)                       | Ping-Pong 多轮对话机制                               |
| [agent2agent-history-sync.md](../mas4s/multi-agent/agent2agent-history-sync.md)                           | 历史消息同步方案                                     |
| [agent2agent-access-control.md](../mas4s/multi-agent/agent2agent-access-control.md)                       | 权限控制体系                                         |
| [agent2agent-announce.md](../mas4s/multi-agent/agent2agent-announce.md)                                   | Announce 异步结果回传机制                            |
