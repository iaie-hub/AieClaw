# 实验设计 Agent (Science Assistant: Design)

## 1. 概述 (Overview)

**Science Assistant: Design** 是专门用于将抽象科研课题转化为具象化、可执行、可评估实验蓝图的智能 Agent。其核心目标是接收阶段 1 产出的科研课题定义（`pi_result.json`）与阶段 2 产出的文献底座（`literature_graph_en.json`），通过形式化定义问题、扫描基线方法、设计创新蓝图并制定预注册式评估协议（PREP），确保科研工作在进入代码实现阶段前具有严密的逻辑支撑与科学的评估基准。

该 Agent 遵循“问题形式化驱动，基线对齐，评估先行”的核心理念，确保实验设计既能回答核心假说，又能在学术边界上实现可观测的突破。

## 2. 核心 SOP 流程 (Standard Operating Procedure)

Agent 严格遵循以下五步 SOP 流程执行任务：

1.  **问题形式化**：将科学假说转化为严谨的计算机科学问题陈述。
2.  **基线确立与方法空间扫描**：确立 SOTA 基线清单与方法族系。
3.  **提案方案蓝图**：设计核心算法或系统架构的高层蓝图。
4.  **预注册式评估协议 (PREP)**：锁定评估指标、数据集与统计检验方案。
5.  **资源与伦理预检**：评估算力需求、数据许可及潜在伦理风险。

### 详细步骤说明：

### 步骤 1：问题形式化 (Problem Formalization)

- **详细设计**：[mas4s_3design_problem_formalize.md](../1skills/mas4s_3design_problem_formalize.md)
- **技能调用**：[`mas4s-design-formalize`](file:///Users/admin/clawd/skills/mas4s-design-formalize/SKILL.md)
- **输入**：`pi_result.json`（阶段 1）+ `literature_graph_en.json`（阶段 2）。
- **动作**：将模糊的科学问题转化为严格的 CS 问题陈述。包括确定问题类别（如分类、优化、生成）、给出数学/逻辑形式化定义，并建立初步的指标公理体系。
- **输出**：`problem_formulation.json`。

### 步骤 2：基线确立与方法空间扫描 (Baseline Scan)

- **详细设计**：[mas4s_3design_baseline_scan.md](../1skills/mas4s_3design_baseline_scan.md)
- **技能调用**：[`mas4s-design-baseline`](file:///Users/admin/clawd/skills/mas4s-design-baseline/SKILL.md)
- **输入**：`literature_graph_en.json`（阶段 2 文献特征表与图谱）。
- **动作**：从文献底座中提取、聚类现有方法，生成分级基线清单（SOTA 基线、朴素基线、消融基线）。明确每个基线的优缺点及其与我方提案的灵感来源映射。
- **输出**：`baseline_manifest.json`。

### 步骤 3：提案方案蓝图 (Method Blueprint)

- **详细设计**：[mas4s_3design_method_blueprint.md](../1skills/mas4s_3design_method_blueprint.md)
- **技能调用**：[`mas4s-design-blueprint`](file:///Users/admin/clawd/skills/mas4s-design-blueprint/SKILL.md)
- **输入**：`problem_formulation.json` + `baseline_manifest.json` + `pi_result.json`。
- **动作**：基于问题定义与基线对比，生成算法或系统架构的高层蓝图。包含核心机制说明、模块化设计、数据流向图，以及三句话的创新声明（Innovation Statement）。
- **输出**：`method_blueprint.md`（人读版）+ `method_blueprint.json`（机读版）。

### 步骤 4：预注册式评估协议 (PREP Spec)

- **详细设计**：[mas4s_3design_prep_spec.md](../1skills/mas4s_3design_prep_spec.md)
- **技能调用**：[`mas4s-design-prep`](file:///Users/admin/clawd/skills/mas4s-design-prep/SKILL.md)
- **输入**：`problem_formulation.json` + `baseline_manifest.json` + `method_blueprint.json`。
- **动作**：明确实验评估的每一个细节，包括使用的具体指标、数据集划分方案、统计检验方法、消融实验设计以及对有效性威胁（Threats to Validity）的预判。
- **输出**：`eval_protocol.json`（一旦冻结，后续阶段如有偏离需显式说明）。

### 步骤 5：资源与伦理预检 (Resource & Ethics Check)

- **详细设计**：[mas4s_3design_resource_ethics_check.md](../1skills/mas4s_3design_resource_ethics_check.md)
- **技能调用**：[`mas4s-design-ethics`](file:///Users/admin/clawd/skills/mas4s-design-ethics/SKILL.md)
- **输入**：`method_blueprint.json` + `eval_protocol.json`。
- **动作**：估算实验所需的计算资源（GPU 小时、内存等）、检查数据与 API 的许可合规性，并评估模型可能存在的偏见与伦理风险。
- **输出**：`resource_ethics_report.json`。

---

## 3. 实验设计规范 (Design Specification)

为了确保实验设计的严密性，Agent 在产出交付物时需遵循以下规范：

### 3.1 预注册式评估协议 (PREP) 规范

PREP 是实验设计的核心锚点，旨在杜绝“HARKing”（假设在结果已知后提出）。其包含以下要素：

| 要素           | 说明                                                                                           |
| :------------- | :--------------------------------------------------------------------------------------------- |
| **主要假说**   | 需与阶段 1 的 H₁ 保持严格一致，并转化为具体的指标预期（如“方法 A 在准确率上显著优于基线 B”）。 |
| **评估指标**   | 必须包含主指标（Primary Metrics）与辅助指标，并说明计算公式。                                  |
| **数据集协议** | 明确训练集/验证集/测试集的划分比例，以及防数据污染的策略。                                     |
| **消融实验**   | 列出所有计划剥离的组件及其对应的消融版本名称。                                                 |
| **统计检验**   | 预设显著性水平（α 值）及使用的检验方法（如 t-test, ANOVA）。                                   |

### 3.2 现实锚点与约束

- **基线可复现性校验**：自动检查所引用的基线是否有公开代码或权重，若缺失则在 `baseline_manifest.json` 中标记高风险。
- **数据污染探测**：基于文献底座信息，扫描测试集是否在现有文献的已知训练语料中出现。
- **协议哈希锁定**：评估协议生成后附带内容哈希，后续在阶段 5（实验执行）中会自动比对。

## 4. SOP 观测方案 (Observation)

Agent 的执行过程在 AIEMAS 平台中是透明可观测的：

- **步骤追踪**：前端通过 [SOP 定义](../../../docs/concepts/agent-workspace.md) 实时显示当前所处阶段。
- **进度日志**：每个技能在执行时通过 `ProgressReporter` 产生 `progress.jsonl`，上报关键决策点的逻辑推理。
- **详细方案**：参考 [Agent SOP 观测方案](../agent_sop_observation.md)。

### 4.1 Skill 改造要求 (Skill Modification Requirements)

- **集成 ProgressReporter**：上报形式化推演、基线匹配、方案生成等关键节点的进度。
- **支持 run_id 参数 (必需)**：用于物理隔离不同次执行的进度文件。
- **标准化进度行**：包含正确的 `type` (start/item/log/done) 及 `skill` 字段。

## 5. 相关文档 (Related Docs)

- [Agent 定义](../../../docs/concepts/agent.md)
- [双锚点科研 SOP 总览](./science_assistant.md)
- [阶段 1：Topic Agent](./science_assistant_1topic.md)
- [阶段 2：Literature Agent](./science_assistant_2literature.md)
- [阶段 4：Implementation Agent](./science_assistant_4implement.md)
