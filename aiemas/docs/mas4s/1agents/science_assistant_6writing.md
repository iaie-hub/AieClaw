# 论文写作 Agent (Science Assistant: Writing)

## 1. 概述 (Overview)

**Science Assistant: Writing** 是 MAS4S 流水线的收官 Agent。其核心目标是基于前序五个阶段（Topic, Literature, Design, Implementation, Execution）产生的全部“纯净资产”，自动编撰符合顶级学术会议（如 NeurIPS, ICML, ICLR, AAAI）规范的科研论文初稿。

该 Agent 遵循“叙事忠于代码，结论基于证据”的原则，通过模块化的写作顺序（方法 → 实验 → 讨论 → 前言 → 摘要），确保论文的每一个主张都有据可查，每一行伪代码都与实际运行的代码 100% 对齐，从源头上杜绝学术不端与结果修饰。

## 2. 核心 SOP 流程 (Standard Operating Procedure)

Agent 严格遵循以下五步 SOP 流程执行任务：

1.  **方法部分自动编撰 (Methodology Drafting)**：基于蓝图与实际代码，生成严谨的方法论描述。
2.  **实验设置与结果编撰 (Experiment & Results)**：基于执行证书、协议与汇整结果，生成图表描述与实验分析。
3.  **讨论与相关工作 (Discussion & Related Work)**：对比文献综述，阐述贡献、局限性与未来方向。
4.  **前言与摘要生成 (Introduction & Abstract)**：基于全篇内容进行高层概括，提取核心贡献。
5.  **全稿整合与格式校对 (Paper Integration & Proofreading)**：组装 LaTeX 拼图，生成可编译的全文。

---

### 详细步骤说明：

### 步骤 1：方法部分自动编撰 (Methodology Drafting)

- **详细设计**：[mas4s_6writing_method_draft.md](../1skills/mas4s_6writing_method_draft.md)
- **技能调用**：[`mas4s-writing-method-draft`](file:///Users/admin/clawd/skills/mas4s-writing-method-draft/SKILL.md)
- **输入**：`method_blueprint.json`（阶段 3）+ `method_implementation.py`（阶段 4）。
- **动作**：执行“现实对齐”审计，以实际代码逻辑为准，生成数学定义、系统架构描述及 `algorithm2e` 格式的伪代码。
- **输出**：`section_method.tex`（方法论章节 LaTeX 片段）。

### 步骤 2：实验设置与结果编撰 (Experiment & Results)

- **详细设计**：[mas4s_6writing_experiment_results.md](../1skills/mas4s_6writing_experiment_results.md)
- **输入**：`eval_protocol.json`（阶段 3）+ `results_summary.json` + `visualizations/`（阶段 5）。
- **动作**：将汇整结果转化为 LaTeX 表格，引用 PDF 图表，描述实验环境（硬件/超参），并撰写客观的结果分析。
- **输出**：`section_experiment.tex`。

### 步骤 3：讨论与相关工作 (Discussion & Related Work)

- **详细设计**：[mas4s_6writing_discussion.md](../1skills/mas4s_6writing_discussion.md)
- **输入**：`literature_synthesis_table.json`（阶段 2）+ `results_summary.json`。
- **动作**：对比基线性能，阐述提案方法的显著性，讨论极端情况下的失效模式，并引用阶段 2 的核心文献进行定位。
- **输出**：`section_discussion.tex` + `section_related_work.tex`。

### 步骤 4：前言与摘要生成 (Introduction & Abstract)

- **详细设计**：[mas4s_6writing_intro_abstract.md](../1skills/mas4s_6writing_intro_abstract.md)
- **输入**：前序所有章节生成的 Text 片段。
- **动作**：从高层逻辑提炼核心动机（Motivation）、问题挑战（Challenge）及本文方案。
- **输出**：`section_intro.tex` + `section_abstract.tex`。

### 步骤 5：全稿整合与格式校对 (Final Integration)

- **详细设计**：[mas4s_6writing_integrate.md](../1skills/mas4s_6writing_integrate.md)
- **输入**：所有 `.tex` 章节片段 + 阶段 2 的 `.bib` 引用文件。
- **动作**：加载 LaTeX 模板（如 `neurips_2024.sty`），使用 `\input` 组装全文，进行引用编号检查与符号一致性最终校对。
- **输出**：`main.tex` (Final Paper Source)。

---

## 3. 实现规范 (Implementation Specification)

### 3.1 代码即事实 (Code is Truth)

写作 Agent 必须强制读取 Stage 4 的源代码。如果论文中的数学描述或伪代码与实际 `method_implementation.py` 逻辑不符，系统必须通过 `<think>` 链条进行强制纠正。禁止描写代码中不存在的特性。

### 3.2 符号表约束 (Notation Constraint)

为防止符号混乱，Agent 在第一步（Method Drafting）中必须输出一份 `notation_table`。后续所有步骤（Experiment, Discussion）必须强制继承并使用该表中的符号。

### 3.3 物理隔离与解耦

每一章节均作为独立的 `.tex` 片段落盘。这种“拼图式”写作允许人类在中间阶段通过 `[Retry]` 仅重写某一特定章节（如结果分析），而无需重新生成整篇论文，极大地节省了 Token 并降低了幻觉风险。

## 4. SOP 观测方案 (Observation)

- **写作进度表**：前端展示“方法论已完成 -> 实验部分撰写中 -> ...”的流水线进度。
- **章节预览**：每完成一个步骤，用户可直接在 UI 中预览该章节的渲染效果。
- **合规审计关联**：在结果章节，UI 会高亮显示该数据是否通过了 Stage 5 的 `prep_compliance_report` 校验。

## 5. 相关文档 (Related Docs)

- [阶段 3：Design Agent](./science_assistant_3design.md)
- [阶段 4：Implementation Agent](./science_assistant_4implement.md)
- [阶段 5：Execution Agent](./science_assistant_5execution.md)
