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

- **技能调用**：[`mas4s-idea-align-query-expand`](file:///Users/admin/clawd/skills/mas4s-idea-align-query-expand/SKILL.md) (参考：[技能文档](../1skills/mas4s_idea_align_query_expand.md))
- **作用**：利用增强检索词确保对领域现状及学术边界的全面覆盖。将模糊的 `user_idea` 扩展为多维度的检索词矩阵。

### 步骤 3：多源检索 (Multi-source Retrieval)

- **Web 检索**：
  - **技能调用**：[`mas4s-idea-align-ali-web-search`](file:///Users/admin/clawd/skills/mas4s-idea-align-ali-web-search/SKILL.md) (参考：[技能文档](../1skills/mas4s_idea_align_ali_web_search.md))
  - **作用**：获取工程实践、商业现状及实际痛点，确保课题具备现实意义。
- **学术检索**：
  - **技能调用**：[`mas4s-idea-align-arxiv-search`](file:///Users/admin/clawd/skills/mas4s-idea-align-arxiv-search/SKILL.md) (参考：[技能文档](../1skills/mas4s_idea_align_arxiv_search.md))
  - **作用**：获取最新学术论文、理论框架及 SOTA 算法，确保课题具备学术前沿性。

### 步骤 4：头脑风暴 (Brainstorming)

- **技能调用**：[`mas4s-idea-align-brain-storm`](file:///Users/admin/clawd/skills/mas4s-idea-align-brain-storm/SKILL.md) (参考：[技能文档](../1skills/mas4s_idea_align_brain_storm.md))
- **作用**：基于检索结果进行深度头脑风暴，形成发散性的创新构想报告。
- **输出**：创新构想发散报告。

### 步骤 5：课题评审收敛 (Principal Investigation & Convergence)

- **技能调用**：[`mas4s-idea-align-principal-investigate`](file:///Users/admin/clawd/skills/mas4s-idea-align-principal-investigate/SKILL.md) (参考：[技能文档](../1skills/mas4s_idea_align_principal_investigate.md))
- **输入**：头脑风暴报告及现实约束条件（`reality_constraints`）。
- **作用**：对头脑风暴报告进行无情的逻辑批判与机制重构，产出最终收敛的科研课题。
- **输出**：最终科研课题定义书。

### 步骤 6：Idea Pivot (课题重构)

> **触发条件**：当用户在步骤 5 完成课题评审后，对输出课题提出否定反馈时触发，形成闭环迭代。

- **技能调用**：[`mas4s-idea-align-idea-pivot`](file:///Users/admin/clawd/skills/mas4s-idea-align-idea-pivot/SKILL.md) (参考：[技能文档](../1skills/mas4s_idea_align_idea_pivot.md))
- **输入**：
  - `pi_result.json`：步骤 5 的输出（收敛课题 JSON，含标题、假说、合成逻辑、关键词等字段）。
  - `user_feedback`：用户对旧课题的否定理由或修正建议（自然语言字符串）。
- **作用**：以"旧逻辑拆解 → 冲突与对齐 → 概念修剪 → 新种子孕育"四步 CoT，深度解析 PI Agent 的收敛逻辑，吸收用户反馈，剔除被否定的核心变量，注入新约束，产出极简高浓缩的修正科研构想（`revised_research_idea`），确保下游检索增强步骤能够精准展开。
- **输出**：
  - `pivote_idea.json`：完整 JSON，含 CoT 过程与修正后的 idea。
  - `pivote_idea.txt`：仅保存修正后的 idea 纯文本（1-2 句名词短语，≤30 字）。
- **流转**：将 `pivote_idea.txt` 作为新的 `user_idea`，**回滚至步骤 2（检索增强）**，启动下一轮迭代，直至用户批准流转。

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
  - **逻辑**：进度文件集中在 `run_id` 目录中，文件名为 `progress_<skill>.jsonl`，例如：`~/.openclaw/workspace-<agentId>/task/<run_id>/progress_<skill>.jsonl`。
  - **参考**：参见 [`pdf_to_markdown` 技能定义](file:///Users/admin/clawd/skills/pdf_to_markdown/SKILL.md) 中的 `run_id` 参数规范。
- **标准化进度行**：上报的 JSONL 行必须包含正确的 `type` (start/item/log/done) 及 `skill` 字段，确保后端 `ProgressWatcher` 能够正确解析并广播。

## 4. 相关文档 (Related Docs)

- [Agent 定义](../../../docs/concepts/agent.md)
- [Agent 工作区](../../../docs/concepts/agent-workspace.md)
- [技能文档索引](../1skills/)
