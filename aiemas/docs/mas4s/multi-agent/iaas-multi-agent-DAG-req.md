# 需求

参考workspace-aieiaas/AGENTS.md中核发职责和路由表，aieiaas是多智能体协作架构，用于处理 IaaS 领域的复杂请求。在复杂的 A2A（Agent-to-Agent）通信场景中，消息路由关系本质上是有向图（Directed Graph）。当前A2A通信存在问题（参见aiemas/docs/mas4s/iaas-multi-agent-msg-flow.md）。

**通信机制**：编排 Agent 仅通过生成路由表，利用 sessions_send 进行 A2A（Agent-to-Agent）任务调度。

**业务目标**：开发一个前端可视化界面，让系统架构师能够以“拖拽连线”的流程图方式，动态配置和查看智能体之间的父子调度拓扑关系。

**持久化**：拓扑关系保存在mas4s.db中。aiemas的前端调用agents.list查询到agent列表后，再查询agent之间的拓扑关系。

# UI交互

在智能体卡片底部添加查看拓扑关系的图标按钮，点击后进入二级页面查看智能体间的拓扑关系，页面右上角添加编辑按钮，点击编辑按钮后进入编辑视图。

编辑视图基于原生 JavaScript 和 SVG 技术实现了一个轻量级的流程图编辑器，编辑agent的路由有向图关系。

# 约束

遵循aiemas/AGENTS.md中约束
参考静态页面/Users/admin/Desktop/code/test-html/agent-relation.html中实现
