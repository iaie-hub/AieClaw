# 科研课题对齐 Agent (Science Assistant: Idea Align)

## 1. 概述 (Overview)

**Science Assistant: Idea Align** 是一款专门用于科研课题打磨与对齐的智能 Agent。其核心目标是接收用户初步的科研构想（`user_idea`），通过系统化的 SOP 流程，结合全网工程实践与最新学术前沿，最终产出一个逻辑严密、创新性强且具备可行性的科研课题定义。

该 Agent 在流程中兼具“发散创新”与“严苛评审”的双重角色，确保课题既有前瞻性又符合工程实际。

## 2. 核心 SOP 流程 (Standard Operating Procedure)

Agent 严格遵循以下五步 SOP 流程执行任务：

### 步骤 1：Idea 输入 (Idea Ingest)

- **输入**：接收用户初始的科研构想或初步探索方向（`user_idea`）。
- **动作**：初步理解用户意图，确定后续检索的核心锚点。

### 步骤 2：Query Expansion (检索增强)

- **技能调用**：[`mas4s-query-expand`](file:///Users/admin/clawd/skills/mas4s-query-expand/SKILL.md) (参考：[技能文档](../1skills/mas4s_query_expand.md))
- **作用**：利用增强检索词确保对领域现状及学术边界的全面覆盖。将模糊的 `user_idea` 扩展为多维度的检索词矩阵。

### 步骤 3：多源检索 (Multi-source Retrieval)

- **Web 检索**：
  - **技能调用**：[`mas4s-ali-web-search`](file:///Users/admin/clawd/skills/mas4s-ali-web-search/SKILL.md) (参考：[技能文档](../1skills/mas4s_ali_web_search.md))
  - **作用**：获取工程实践、商业现状及实际痛点，确保课题具备现实意义。
- **学术检索**：
  - **技能调用**：[`mas4s-arxiv-search`](file:///Users/admin/clawd/skills/mas4s-arxiv-search/SKILL.md) (参考：[技能文档](../1skills/mas4s_arxiv_search.md))
  - **作用**：获取最新学术论文、理论框架及 SOTA 算法，确保课题具备学术前沿性。

### 步骤 4：头脑风暴 (Brainstorming)

- **技能调用**：[`mas4s-brain-storm`](file:///Users/admin/clawd/skills/mas4s-brain-storm/SKILL.md) (参考：[技能文档](../1skills/mas4s_brain_storm.md))
- **作用**：基于检索结果进行深度头脑风暴，形成发散性的创新构想报告。
- **输出**：创新构想发散报告。

### 步骤 5：课题评审收敛 (Principal Investigation & Convergence)

- **技能调用**：[`mas4s-principal-investigate`](file:///Users/admin/clawd/skills/mas4s-principal-investigate/SKILL.md) (参考：[技能文档](../1skills/mas4s_principal_investigate.md))
- **输入**：头脑风暴报告及现实约束条件（`reality_constraints`）。
- **作用**：对头脑风暴报告进行无情的逻辑批判与机制重构，产出最终收敛的科研课题。
- **输出**：最终科研课题定义书。

## 3. SOP 观测方案 (Observation)

Agent 的执行过程在 AIEMAS 平台中是透明可观测的：

- **步骤追踪**：前端通过 [SOP 定义](../../../docs/concepts/agent-workspace.md) 实时显示当前所处阶段。
- **进度日志**：每个技能在执行时会产生 `progress.jsonl`，前端可实时观测其内部进度。
- **详细方案**：参考 [Agent SOP 观测方案](../agent_sop_observation.md)。

### 3.1 Skill 改造要求 (Skill Modification Requirements)

为了支持 Agent 多次运行 SOP 流程并确保进度观测的隔离性，本 Agent 使用的所有核心 Skill 必须完成以下改造：

- **集成 ProgressReporter**：使用 `lib.progress` 模块，在执行的关键节点上报进度。
- **支持 run_id 参数 (必需)**：Skill 必须接收 `run_id` 命令行参数。
  - **作用**：用于物理隔离不同次执行的进度文件。
  - **逻辑**：如果传入了 `run_id`，进度文件路径应包含该 ID，例如：`~/.openclaw/workspace-<agentId>/<run_id>_<skill>.progress.jsonl`。
  - **参考**：参见 [`pdf_to_markdown` 技能定义](file:///Users/admin/clawd/skills/pdf_to_markdown/SKILL.md) 中的 `run_id` 参数规范。
- **标准化进度行**：上报的 JSONL 行必须包含正确的 `type` (start/item/log/done) 及 `skill` 字段，确保后端 `ProgressWatcher` 能够正确解析并广播。

## 4. 相关文档 (Related Docs)

- [Agent 定义](../../../docs/concepts/agent.md)
- [Agent 工作区](../../../docs/concepts/agent-workspace.md)
- [技能文档索引](../1skills/)
