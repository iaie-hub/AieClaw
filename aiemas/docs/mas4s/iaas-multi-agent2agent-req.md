# 术语

**sessionKey**: 由3部分组成：agent:{agentId}:group:{sessionUuid}。
**A2A**: Agent to Agent。Agent分析意图需要其它Agent的帮助时，需要调用session_send，将请求发送给目标Agent。例如：编排Agent需要查询虚拟机列表时，需要调用aieiaas-resource的session_send。

# 背景

aiemas/docs/mas4s/iaas-multi-agent-send-error.md中描述了当前A2A通信存在的问题。Agent调用session_send时，子 agent由于没有活跃的session，导致无法收到消息。

.kiro/specs/agent-topology-dag/design.md中描述了Agent拓扑关系DAG功能。该功能可以帮助用户更好地理解Agent之间的关系，也可以帮助开发者更好地理解Agent之间的通信方式。

/Users/admin/.openclaw/workspace-aieiaas/AGENTS.md中描述了Agent之间的关系。

# 需求

针对A2A通信存在的问题，即子 Agent 没有活跃的 session，导致无法收到消息。请参考.kiro/specs/agent-topology-dag/design.md中的Agent拓扑关系DAG功能，当创建Agent的session时，根据Agent的拓扑关系，自动创建所有子Agent的session。例如：编排Agent的session创建时，自动创建子Agent: **aieiaas-resource**、**aieiaas-model**、**aieiaas-task**、**aieiaas-monitor** 的session。父Agent及所有子Agent的sessionKey中的sessionUuid保持一致。这样，当父Agent调用session_send时，可根据自身的sessionUuid生成子Agent的sessionKey，子Agent就能收到消息。当父Agent的session被删除时，所有子Agent的session也一并删除。
