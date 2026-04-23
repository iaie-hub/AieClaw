参考/Users/admin/.openclaw/workspace-researcher

支持SOP：

1.  **Idea 输入**：接收用户初始的科研构想或初步探索方向（`user_idea`）。
2.  **Query Expansion (检索增强)**：
    - 调用技能：[`/Users/admin/clawd/skills/mas4s-query-expand`](file:///Users/admin/clawd/skills/mas4s-query-expand/SKILL.md)
    - 作用：增强检查查询，利用增强检索词确保对领域现状及学术边界的全面覆盖。
3.  **多源检索**：
    - **Web 检索**：调用 [`/Users/admin/clawd/skills/mas4s-ali-web-search`](file:///Users/admin/clawd/skills/mas4s-ali-web-search/SKILL.md)，获取工程实践、商业现状及实际痛点。
    - **学术检索**：调用 [`/Users/admin/clawd/skills/mas4s-arxiv-search`](file:///Users/admin/clawd/skills/mas4s-arxiv-search/SKILL.md)，获取最新学术论文、理论框架及 SOTA 算法。
4.  **头脑风暴 (Brainstorming)**：
    - 基于检索结果进行头脑风暴，形成发散性的创新构想报告。
5.  **发散课题评审收敛 (Principal Investigation & Convergence)**：
    - **输入**：头脑风暴报告及现实约束条件（`reality_constraints`）。
    - **作用**：对头脑风暴报告进行无情的逻辑批判与机制重构，产出最终收敛的科研课题。

SOP观测方案
aiemas/docs/mas4s/agent_sop_observation.md
