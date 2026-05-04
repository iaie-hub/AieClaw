## 阶段 3 - 步骤 1：问题形式化 (Problem Formalization) 设计方案

### 一、 设计理念

1.  **科学向工程的桥接 (Scientific-to-Engineering Bridge)**：作为阶段 3 (Design) 的首个步骤，其核心任务是将阶段 1 产出的抽象科学假说转化为数学上严谨、计算机代码可实现的问题陈述。
2.  **数据裁剪与 Token 优化 (Pruning & Optimization)**：针对阶段 2 产出的全量文献图谱可能导致的 Token 爆炸问题，脚本执行精准裁剪，仅提取“理论框架 (Theoretical Framework)”与“机器数据流 (Downstream Feeds)”作为 LLM 的推理上下文。
3.  **双语双轨落盘 (Bilingual Persistence)**：严格遵循 AIEMAS 架构规范，输出 `en_US`（驱动后续代码实现阶段）与 `zh_CN`（用于前端展示与人类审阅）双重 JSON 体系。
4.  **强制溯源锚点 (Metric Anchoring)**：所有定义的评估指标必须在文献图谱中找到对应的 `[arxiv_id]` 溯源，确保实验设计阶段的指标在现有学术框架下具有可计算性。

### 二、 设计方案

#### 问题形式化中枢矩阵

| 维度核心模块                          | 核心内容                                                              | 目标下游受众           |
| :------------------------------------ | :-------------------------------------------------------------------- | :--------------------- |
| **形式化定义 (Formal Definition)**    | 输入空间 $\mathcal{X}$、输出空间 $\mathcal{Y}$ 与目标函数的数学定义。 | 阶段 4 (代码实现)      |
| **变量操作化映射 (Variable Mapping)** | 自变量的计算类型（连续/布尔等）与取值范围，因变量清单。               | 阶段 4 (代码实现)      |
| **指标公理体系 (Metrics Axiom)**      | 包含 LaTeX 公式、文献溯源锚点与可计算性检查的指标系统。               | 阶段 4 / 阶段 5 (评估) |
| **形式化简报 (Brief)**                | 供人类 PI 快速审计实验设计逻辑的 Markdown 报告。                      | 人类 PI (HITL 审计)    |

### 三、 实现流程

| 步骤 | 动作           | 说明                                                                                              |
| :--- | :------------- | :------------------------------------------------------------------------------------------------ |
| 1    | 情报加载与寻址 | 跨 Agent 寻址加载阶段 1 的 `pi_result_en.json` 与阶段 2 的 `literature_graph_en.json`。           |
| 2    | 数据精准裁剪   | 丢弃图谱中冗余的 visualization 数据，保留理论框架与 Feeds，极大程度优化 Token 消耗。              |
| 3    | HITL 反馈注入  | 检查是否存在 `fatal_error.log` (回滚) 或 `human_feedback.txt` (重试)，并将其置于 LLM 最高优先级。 |
| 4    | LLM 形式化推演 | 调用大模型进行逻辑推演，生成包含 `_en` 与 `_cn` 键值的混合 JSON。                                 |
| 5    | 双语拆分与落盘 | 使用 `split_bilingual_data` 拆分为 `_en.json` 与 `_cn.json`，并渲染 Markdown 简报。               |

### 四、 输入参数

所有文件集中存放于 `~/.openclaw/workspace-design/task/{run_id}/`，输入文件支持跨目录寻址。

| 参数名       | 类型   | 必填 | 说明                      |
| :----------- | :----- | :--- | :------------------------ |
| **run_id**   | String | 是   | 执行 ID。                 |
| **agent_id** | String | 否   | Agent ID，默认 `design`。 |

**必需输入文件**：

- `~/.openclaw/workspace-topic/task/{run_id}/pi_result_en.json`
- `~/.openclaw/workspace-literature/task/{run_id}/literature_graph_en.json`

### 五、 输出参数

**固定输出文件**：

- `problem_formulation.json`：中英混合原始数据。
- `problem_formulation_en.json`：纯英文版（Stage 4 机器输入）。
- `problem_formulation_cn.json`：纯中文版（前端渲染）。
- `problem_formulation_brief.md`：形式化审计简报。

### 六、 核心维度与字段定义

| 类别           | 字段名称             | 描述                                                             |
| :------------- | :------------------- | :--------------------------------------------------------------- |
| **形式化定义** | `input_space`        | 使用 LaTeX 定义输入集合 $\mathcal{X}$。                          |
|                | `objective_function` | 待优化的目标函数数学表达。                                       |
| **变量映射**   | `computational_type` | 定义变量在代码中的表现形式（Discrete, Continuous, Boolean 等）。 |
|                | `levels_or_range`    | 定义变量的取值空间或分类水平。                                   |
| **指标体系**   | `formula`            | 指标的 LaTeX 计算公式。                                          |
|                | `literature_anchor`  | 文献图谱中对应的 `[arxiv_id]`，用于证明指标的合法性。            |

### 七、 示例

#### 7.1 运行示例

```bash
python3 scripts/mas4s_design_problem_formalize.py '{"run_id": "run_20260430"}'
```

#### 7.2 形式化简报示例

> ## 1. 形式化定义
>
> ### 1.3 目标函数 (Objective Function)
>
> $\min_{\theta} \mathcal{L}(\theta) = \sum_{i=1}^N \| f_{\theta}(x_i) - y_i \|^2 + \lambda \Omega(\theta)$
>
> ## 3. 指标公理体系
>
> | 指标名称                 | 计算公式                                               | 文献溯源锚点                  | 可计算性 |
> | :----------------------- | :----------------------------------------------------- | :---------------------------- | :------- |
> | 遗忘率 (Forgetting Rate) | $FR = \frac{1}{k-1}\sum_{j=1}^{k-1} a_{k,j} - a_{j,j}$ | Lopez-Paz et al. [1706.08840] | True     |

### 八、 SOP 观测支持

- **进度上报**：上报 `正在执行问题形式化推演...` 与 `正在执行中英双语拆分落盘...`。
- **进度文件路径**：`~/.openclaw/workspace-design/task/<run_id>/progress_mas4s_design_problem_formalize.jsonl`
- **容错机制**：集成 `robust_json_loads`，对 LLM 输出的 LaTeX 符号及中文引号具有强鲁棒性。
