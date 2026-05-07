# 实验设置与结果自动编撰 (Experiment & Results Drafting)

## 1. 技能概述 (Overview)

`mas4s-writing-experiment-draft` 是论文写作阶段的第二步。该技能通过锚定 Stage 5 产出的客观数据汇总（`results_summary.json`）和合规性报告（`prep_compliance_report.json`），自动撰写论文的 Experiments 章节。

## 2. 核心逻辑 (Core Logic)

1.  **数据锚定 (Data Anchoring)**：每一项性能对比必须从 JSON 中提取真实数值，严禁捏造 p-value 或夸大效应。
2.  **合规性透明 (Compliance Transparency)**：
    - **Registered**: 正常汇报预注册指标。
    - **Missing**: 在实验设置中诚实说明因资源或技术限制导致的缺失。
    - **Exploratory**: 强制在独立的 `Exploratory Analysis` 小节中讨论，严禁与预注册结果混淆。
3.  **LaTeX 安全性 (LaTeX Safety)**：强制使用 `booktabs` 格式生成表格，禁用复杂的跨行跨列操作，确保编译成功率。

## 3. 输入输出 (Input & Output)

- **输入**：
  - `eval_protocol_en.json` (Stage 3): 预注册协议。
  - `results_summary_en.json` (Stage 5): 实验结果汇总。
  - `prep_compliance_report_en.json` (Stage 5): 合规性审计报告。
- **输出**：
  - `section_experiment.tex`: 实验与结果章节的 LaTeX 源码。
  - `method_draft_report.json` (更新): 包含实验写作简报。

## 4. 调用示例 (Usage)

### Python 调用

```bash
python scripts/mas4s_writing_experiment_draft.py '{"run_id":"run_20260428"}'
```

### 参数说明

- `run_id`: 必填。
- `agent_id`: 可选，默认 `writing`。
- `human_feedback`: 可选，用于重试时的反馈。

## 5. 设计约束 (Design Constraints)

- **物理隔离**：LaTeX 源码必须在 JSON 响应外的 Markdown 块中输出。
- **图表占位**：自动插入 `\includegraphics` 占位符，路径指向 `visualizations/` 目录。
