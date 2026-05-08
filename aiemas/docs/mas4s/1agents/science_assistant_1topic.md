# 课题对齐 Agent (Science Assistant: Topic)

## 1. 概述 (Overview)

**Science Assistant: Topic** 是一款专门用于科研课题打磨与对齐的智能 Agent。其核心目标是接收用户初步的科研构想（`user_idea`），通过系统化的 SOP 流程，将其转化为边界清晰、有创新潜力、可证伪的科学问题。

该 Agent 融合了“检索增强”的工程实践与“FINER+PICO”的科研规范，确保课题既有学术前沿性又符合科学方法论，为后续的文献底座构建（阶段 2）提供精准的目标导向。

## 2. 核心 SOP 流程 (Standard Operating Procedure)

Agent 严格遵循以下五步 SOP 流程执行任务：

### 步骤 1：检索增强 (Query Expansion)

- **技能调用**：[`mas4s-topic-expand`](file:///Users/admin/.openclaw/skills/mas4s-topic-expand/SKILL.md)
- **输入**：用户初始科研构想纯文本（`idea.txt`）。
- **动作**：将模糊构想扩展为多维度的检索词矩阵，确保对领域现状及学术边界的全面覆盖。
- **输出**：`idea_query_expand.json`。

### 步骤 2：多源检索与现实锚点 (Multi-source Retrieval & Reality Anchor)

- **人类锚点**：检索条件确认。
- **Web 检索**：
  - **技能调用**：[`mas4s-topic-web`](file:///Users/admin/.openclaw/skills/mas4s-topic-web/SKILL.md)
  - **输出**：`web_search_results.json` (含行业痛点、工程实践、商业现状)。
- **学术检索**：
  - **技能调用**：[`mas4s-topic-arxiv`](file:///Users/admin/.openclaw/skills/mas4s-topic-arxiv/SKILL.md)
  - **输出**：`arxiv_search_results.json` (含最新论文摘要、SOTA 算法、理论框架)。
- **现实锚点**：基于双轨检索结果，识别研究重叠度，排除已被充分研究的“红海”课题。

### 步骤 3：候选问题发散 (Candidate Topic Generation)

- **技能调用**：[`mas4s-topic-generate`](file:///Users/admin/.openclaw/skills/mas4s-topic-generate/SKILL.md)
- **输入**：`web_search_results.json` 及 `arxiv_search_results.json`。
- **动作**：基于解耦后的现实与学术双维上下文，多角度发散推演 5 个具有创新潜力的候选研究问题。
- **人类锚点**：研究方向引导。
- **输出**：`candidate_topics.json`。

### 步骤 4：评分排序与框架构建 (Ranking & Framework Framing)

- **技能调用**：[`mas4s-topic-frame`](file:///Users/admin/.openclaw/skills/mas4s-topic-frame/SKILL.md)
- **动作**：
  1. **评分排序**：按 FINER + 可证伪性框架对候选问题进行评分。
  2. **框架构建**：为胜出项构建完整 PICO/PEOS 框架，并撰写明确的假设声明（H₀/H₁）。
- **输出**：`ranked_framed_hypothesis.json`。

### 步骤 5：课题审计与课题定型 (Principal Investigation & Convergence)

- **技能调用**：[`mas4s-topic-investigate`](file:///Users/admin/.openclaw/skills/mas4s-topic-investigate/SKILL.md)
- **输入**：`ranked_framed_hypothesis.json`、`idea_query_expand.json` (来自步骤 1)。
- **人类锚点**：研究方向决策。
- **输出**：
  - `innovation_assessment_brief.md`：创新性评估简报（含证据差距声明）。
  - `pi_result.json`：最终科研课题 definition 书（Principal Investigation Result）。

---

### 辅助步骤：课题重构 (Topic Pivot)

> **触发条件**：当发生 `[Rollback]`（下游打回）或用户在评审阶段提出否定反馈（Feedback）时触发。

- **技能调用**：[`mas4s-topic-pivot`](file:///Users/admin/.openclaw/skills/mas4s-topic-pivot/SKILL.md)
- **输入**：`pi_result.json` 及 `user_feedback`。
- **作用**：解析失败逻辑，吸收反馈约束，执行"旧逻辑拆解 → 冲突与对齐 → 概念修剪 → 新种子孕育"，产出修正后的 `idea.txt`。
- **流转**：重回步骤 1。

## 3. SOP 观测方案 (Observation)

Agent 的执行过程在 AIEMAS 平台中是透明可观测的：

- **步骤追踪**：前端通过 [SOP 定义](../../../docs/concepts/agent-workspace.md) 实时显示当前所处阶段。
- **进度日志**：每个技能在执行时通过 `ProgressReporter` 产生 `progress.jsonl`。
- **详细方案**：参考 [Agent SOP 观测方案](../agent_sop_observation.md)。

### 3.1 Skill 改造要求 (Skill Modification Requirements)

- **集成 ProgressReporter**：上报发散、评分、对齐等关键节点的进度。
- **支持 run_id 参数 (必需)**：用于物理隔离不同次执行的进度文件。
- **标准化进度行**：包含正确的 `type` (start/item/log/done) 及 `skill` 字段。

## 4. 相关文档 (Related Docs)

- [Agent 定义](../../../docs/concepts/agent.md)
- [双锚点科研 SOP 总览](./science_assistant.md)
- [阶段 2：Literature Agent](./science_assistant_2literature.md)
- [阶段 3：Design Agent](./science_assistant_3design.md)
