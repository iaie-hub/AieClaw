# 方法部分自动编撰 (Methodology Drafting)

## 1. 技能概述 (Overview)

`mas4s-writing-method-draft` 是论文写作阶段的第一步核心技能。它的任务是建立论文的理论地基。该技能通过同时读取“理论设计蓝图”与“实际执行代码”，提取出系统架构、数学定义和核心算法逻辑，并将其转化为符合 LaTeX 学术标准的 Methodology 章节。

## 2. 核心逻辑 (Core Logic)

1.  **现实对齐审计 (Reality Alignment)**：智能体会对比 Stage 3 的设计与 Stage 4 的代码。如果代码中对设计做了简化（例如某个复杂的反馈回路在代码中被简化为线性加权），智能体**必须按照代码的实际逻辑**进行撰写，并在 JSON 简报中说明差异。
2.  **符号表构建 (Notation Construction)**：基于代码中的变量名和类名，映射出一套规范的数学符号体系（如 $ \mathcal{M} $ 代表 Memory Class），确保全篇符号统一。
3.  **叙事骨架生成**：
    - **3.1 Problem Formalization**: 定义状态空间、动作空间与目标函数。
    - **3.2 Overall Architecture**: 描述系统的高层模块划分。
    - **3.3 Core Components**: 深入描述每个核心模块的内部逻辑。
    - **3.4 Main Algorithm**: 基于代码主循环，生成 `algorithm2e` 格式的伪代码。

## 3. 输入输出 (Input & Output)

- **输入**：
  - `method_blueprint_en.json` (Stage 3): 理论设计方案。
  - `method_implementation.py` (Stage 4): 物理源代码。
- **输出**：
  - `section_method.tex`: 包含方法章节全文的 LaTeX 源码片段。
  - `results_aggregation.json` (更新): 包含写作简报与符号映射表。

## 4. 调用示例 (Usage)

### Python 调用

```bash
python scripts/mas4s_writing_method_draft.py '{"run_id":"run_20260428"}'
```

### 参数说明

- `run_id`: 必填。实验运行 ID。
- `human_feedback`: 可选。如果用户对之前生成的版本不满意，可在此传入改进建议。

## 5. 设计约束 (Design Constraints)

- **严禁幻觉**：禁止描述代码中未实现的任何算法特性。
- **物理隔离**：所有的 LaTeX 代码必须输出在 JSON 结构体之外的 Markdown 代码块中，防止反序列化错误。
- **数学规范**：必须使用标准 LaTeX 环境（`equation`, `align`, `algorithm`）。

## 6. 异常处理 (Error Handling)

- 如果 `method_implementation.py` 缺失，技能将强制中断并提示“无法进行现实对齐，请先完成 Stage 4”。
- 如果生成的 LaTeX 代码过长（超过 8k token），技能将自动分拆或在摘要中提示。
