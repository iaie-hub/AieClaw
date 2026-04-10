# 术语

**sessionKey**: 由3部分组成：agent:{agentId}:group:{sessionUuid}。
**A2A**: Agent to Agent。Agent分析意图需要其它Agent的帮助时，需要调用session_send，将请求发送给目标Agent。例如：编排Agent需要查询虚拟机列表时，需要调用aieiaas-resource的session_send。

# 背景

aiemas/docs/mas4s/iaas-multi-agent-send-error.md中描述了当前A2A通信存在的问题。Agent调用session_send时，子 agent由于没有活跃的session，导致无法收到消息。

针对A2A通信存在的问题，即子 Agent 没有活跃的 session，导致无法收到消息。请参考.kiro/specs/agent-topology-dag/design.md中的Agent拓扑关系DAG功能，当创建Agent的session时，根据Agent的拓扑关系，自动创建所有子Agent的session。例如：编排Agent的session创建时，自动创建子Agent: **aieiaas-resource**、**aieiaas-model**、**aieiaas-task**、**aieiaas-monitor** 的session。

.kiro/specs/agent-topology-dag/design.md中描述了Agent拓扑关系DAG功能。该功能可以帮助用户更好地理解Agent之间的关系，也可以帮助开发者更好地理解Agent之间的通信方式。

/Users/admin/.openclaw/workspace-aieiaas/AGENTS.md中描述了Agent之间的关系。
.kiro/specs/a2a-session-cascade/design.md中描述了aiemas.sessions.create级联创建根agent及子Agent的session的实现方案。

# 需求

session_send调用是在agent的AGENTS.md（如/Users/admin/.openclaw/workspace-aieiaas/AGENTS.md）中显式说明，因此子agent的seesionKey需能通过描述准确生成。

**sessionKey**: 由3部分组成：agent:{agentId}:group:{sessionUuid}。创建根 Agent 的session后，提取返回key中的sessionUuid，为子 Agent 构建key，并在创建了Agent时设置key参数。

aiemas/src/gateway-bridge/aiemas-session.test.ts中同步添加自动化测试用例。

# 参考文档

- aiemas/docs/mas4s/iaas-multi-agent-send-error.md
- aiemas/docs/openclaw/agent2agent.md
- .kiro/specs/a2a-session-cascade/design.md

# 约束

- 遵循中AGENTS.md
- /Users/admin/.openclaw/workspace-aieiaas/AGENTS.md定义的agent aieiaas只是A2A的场景，代码中不应与具体A2A场景绑定
