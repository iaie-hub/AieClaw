# 讨论与相关工作自动编撰 (Discussion & Related Work Drafting)

## 1. 技能概述 (Overview)

`mas4s-writing-discussion-draft` 是论文写作阶段的第三步。该技能通过整合 Stage 2 的文献全景图谱（`literature_graph.json`）和 Stage 5 的实验结果，撰写 Related Work 和 Discussion 章节。

## 2. 核心逻辑 (Core Logic)

1.  **绝对闭卷引用 (Closed-Book Citation)**：文中出现的所有 `\cite{}` 必须且只能来源于输入的文献图谱，彻底杜绝“幽灵引用”。
2.  **推测性标记隔离 (Speculative Tagging)**：对于没有直接数值支撑的机制猜想，必须显式标注 `[Speculative]`，以示学术诚实。
3.  **局限性强制披露 (Mandatory Limitations)**：必须客观描述研究局限性，并与 Stage 1 的原始假设扣回。
4.  **正则引用护栏 (Anti-Hallucination Guard)**：在 Python 脚本层面对生成的引用 Key 进行硬核校验。

## 3. 输入输出 (Input & Output)

- **输入**：
  - `topic_locking_en.json` (Stage 1): 原始假设与科学问题。
  - `literature_graph_en.json` (Stage 2): 全景文献图谱（引用唯一来源）。
  - `results_summary_en.json` (Stage 5): 实验结果汇总。
- **输出**：
  - `section_discussion_related.tex`: 包含相关工作、讨论及局限性的 LaTeX 源码。
  - `discussion_draft_report.json`: 包含引用统计与推测性主张清单的报告。

## 4. 调用示例 (Usage)

### Python 调用

```bash
python scripts/mas4s_writing_discussion_draft.py '{"run_id":"run_20260428"}'
```

### 参数说明

- `run_id`: 必填。
- `human_feedback`: 可选。

## 5. 设计约束 (Design Constraints)

- **引用校验**：脚本会自动扫描 `\cite{}` 并对比文献图谱，若发现幽灵引用将抛出警告或自动修正。
- **物理隔离**：LaTeX 内容必须独立于 JSON 输出。
