## 阶段 3 - 步骤 2：基线确立与方法空间扫描 (Baseline Scan) 设计方案

### 一、 设计理念

1.  **文献特征到基准清单的转化 (Literature-to-Manifest Conversion)**：将阶段 2 产出的碎片化文献特征（Synthesis Table）与机器数据流（Feeds）整合，通过聚类与评估，转化为可执行的基准方法清单。
2.  **分层基准体系 (Graded Baseline Hierarchy)**：将基准分为三个层次，确保对比的全面性：
    - **SOTA 基准 (State-of-the-Art)**：当前学术界的最高性能标准，用于证明方案的先进性。
    - **朴素基准 (Naive/Vanilla)**：基础架构或经典方法，用于验证方案的“性能下限”。
    - **消融基准 (Ablation-Ready)**：与我方方案高度相关、可进行关键组件替换对比的方法。
3.  **灵感溯源与差异分析 (Lineage & Gap Analysis)**：明确每一项基准与我方提案的“血缘”关系（灵感来源）以及“功能鸿沟”，为后续 `method_blueprint` 的创新声明提供支撑。
4.  **工程可行性初筛 (Engineering Feasibility)**：基于 Feeds 中的硬件依赖与代码开源状态，对基准的可复现性进行初步评级，避免选择“不可复现的空中楼阁”作为对比。

### 二、 设计方案

#### 基准扫描中枢矩阵

| 维度核心模块                         | 核心内容                                         | 目标下游受众            |
| :----------------------------------- | :----------------------------------------------- | :---------------------- |
| **基准清单 (Baseline Manifest)**     | 方法名称、分类标签（SOTA/Naive）、关键技术路径。 | 阶段 4 (代码实现)       |
| **对比维度 (Comparison Matrix)**     | 优点、缺点、资源消耗、适用场景的结构化对比。     | 阶段 3 (Blueprint 设计) |
| **灵感映射 (Inspiration Map)**       | 明确该基准为我方方案贡献了哪些具体灵感点。       | 阶段 6 (论文撰写)       |
| **复现指数 (Reproducibility Index)** | 代码可用性、数据集可得性、算力估算的综合评分。   | 阶段 5 (实验执行)       |

### 三、 实现流程

| 步骤 | 动作           | 说明                                                                          |
| :--- | :------------- | :---------------------------------------------------------------------------- |
| 1    | 情报加载与寻址 | 加载阶段 1 的 `pi_result_en.json` 与阶段 2 的 `literature_graph_en.json`。    |
| 2    | 方法空间聚类   | 利用 LLM 识别文献中提到的所有算法、模型与系统架构，根据任务目标进行功能聚类。 |
| 3    | 基准评级与筛选 | 选取 2-3 个 SOTA 基准，1-2 个朴素基准，并识别潜在的消融对比对象。             |
| 4    | 差异化推演     | 针对每一项入选基准，分析其针对当前课题的局限性 (Gap) 与我方的改进空间。       |
| 5    | 双语持久化     | 拆分为 `_en.json` 与 `_cn.json`，并渲染 Markdown 审计简报。                   |

### 四、 输入参数

所有文件集中存放于 `~/.openclaw/workspace-design/task/{run_id}/`，输入文件支持跨目录寻址。

| 参数名       | 类型   | 必填 | 说明                      |
| :----------- | :----- | :--- | :------------------------ |
| **run_id**   | String | 是   | 执行 ID。                 |
| **agent_id** | String | 否   | Agent ID，默认 `design`。 |

**必需输入文件**：

- `~/.openclaw/workspace-topic/task/{run_id}/pi_result_en.json`
- `~/.openclaw/workspace-literature/task/{run_id}/literature_graph_en.json`
- `~/.openclaw/workspace-design/task/{run_id}/problem_formulation_en.json` (由步骤 1 产出)

### 五、 输出参数

**固定输出文件**：

- `baseline_manifest.json`：中英混合原始数据。
- `baseline_manifest_en.json`：纯英文版（Stage 4 机器输入）。
- `baseline_manifest_cn.json`：纯中文版（前端渲染）。
- `baseline_manifest_brief.md`：基准清单审计简报。

### 六、 核心维度与字段定义

| 类别         | 字段名称             | 描述                                                   |
| :----------- | :------------------- | :----------------------------------------------------- |
| **基础信息** | `method_name`        | 基准方法的正式名称。                                   |
|              | `category`           | 基准类别：`SOTA`, `Naive`, `Ablation_Candidate`。      |
| **技术特征** | `pros_cons`          | 核心优势与局限性的平衡对比。                           |
|              | `reproducibility`    | 代码/权重可用性评级 (High, Medium, Low)。              |
| **灵感关联** | `inspiration_points` | 具体说明该方法在机制设计上提供了什么参考。             |
|              | `innovation_gap`     | 明确指出该方法在当前课题场景下的不足，即我方的突破点。 |

### 七、 示例

#### 7.1 运行示例

```bash
python3 scripts/mas4s_design_baseline_scan.py '{"run_id": "run_20260430"}'
```

#### 7.2 基准清单简报示例

> ## 2. 基准清单与方法空间扫描
>
> ### 2.1 SOTA 基准 (State-of-the-Art)
>
> | 方法名称    | 文献来源                | 核心优势         | 局限性 (Gap)                   | 复现指数 |
> | :---------- | :---------------------- | :--------------- | :----------------------------- | :------- |
> | Agent-Llama | Pan et al. [2401.00001] | 长序列推理能力强 | 资源消耗巨大，难以在边缘端部署 | High     |
>
> ### 2.3 灵感溯源映射
>
> - **启发点 1**：参考 [2310.00002] 的记忆增强机制，用于解决动态环境下的知识遗忘。
> - **差异点**：相比现有研究，我方方案将引入“预测性遗忘”机制，以提升搜索效率。

### 八、 SOP 观测支持

- **进度上报**：上报 `正在扫描方法空间并聚类基准...` 与 `正在推演基准对比矩阵...`。
- **进度文件路径**：`~/.openclaw/workspace-design/task/<run_id>/progress_mas4s_design_baseline_scan.jsonl`
- **鲁棒性**：处理 LaTeX 嵌套与 JSON 截断错误。
