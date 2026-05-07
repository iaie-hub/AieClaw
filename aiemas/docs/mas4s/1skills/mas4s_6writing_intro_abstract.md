# 前言与摘要自动生成 (Introduction & Abstract Drafting)

## 1. 技能概述 (Overview)

`mas4s-writing-intro-abstract` 是论文写作阶段的第四步。该技能通过对前序已生成的 Method、Experiment 和 Discussion 章节进行深度归纳，提取出整篇论文的核心贡献，并编撰摘要（Abstract）与前言（Introduction）。

## 2. 核心逻辑 (Core Logic)

1.  **倒置驱动叙事 (Reverse-Driven Narrative)**：严格归纳前序章节内容，禁止捏造文中未提及的贡献或虚夸实验数据。
2.  **结构化约束**：
    - **Abstract**: 遵循背景 -> 痛点 -> 方案 -> 结果的四句式结构。
    - **Introduction**: 必须以 bulleted list 形式清晰罗列 3-4 点核心贡献（Contributions）。
3.  **双代码块隔离提取**：模型必须依次输出两个独立的 LaTeX 代码块，脚本分别提取落盘为 `section_abstract.tex` 和 `section_intro.tex`。

## 3. 输入输出 (Input & Output)

- **输入**：
  - `topic_locking_en.json` (Stage 1): 原始假设与课题背景。
  - `section_method.tex`: 已生成的方法论章节。
  - `section_experiment.tex`: 已生成的实验结果章节。
  - `section_discussion_related.tex`: 已生成的讨论与相关工作章节。
- **输出**：
  - `section_abstract.tex`: 摘要 LaTeX 片段。
  - `section_intro.tex`: 前言 LaTeX 片段。
  - `intro_abstract_draft_report.json`: 叙事提炼报告。

## 4. 调用示例 (Usage)

### Python 调用

```bash
python scripts/mas4s_writing_intro_abstract.py '{"run_id":"run_20260428"}'
```

### 参数说明

- `run_id`: 必填。
- `human_feedback`: 可选。

## 5. 设计约束 (Design Constraints)

- **零前瞻原则**：摘要中出现的每一个性能指标必须在 `section_experiment.tex` 中有据可查。
- **双块提取**：若模型未按格式输出两个独立的 LaTeX 块，脚本将触发警告。
