作为科研 SOP 系统架构师，我将为你输出完整的《阶段 5 - 步骤 4：结果自动汇整 (Result Aggregation) 设计方案》以及专为防止 P-Hacking 设计的审计型系统 Prompt。

---

# 阶段 5 - 步骤 4：结果自动汇整 (Result Aggregation) 设计方案

### 一、 设计理念

1. **协议依从性审计 (PREP Compliance Auditing)**：科研诚信的底线在于“预注册（Pre-registration）”。系统必须严格比对阶段 3 生成的 `eval_protocol.json`。任何在协议中承诺但未出现的数据将被标记为 `[Missing]`；任何在执行中产生但未在协议中声明的指标将被强制打上 `[Exploratory]` (探索性) 标签，与预注册核心结果进行物理隔离，防止选择性报告。
2. **多源数据统一映射 (Unified Data Alignment)**：基于 `execution_manifest.json`，将散落在各个任务隔离目录下的孤岛数据（如 `results/task_001/metrics.json`）进行自动化清洗、对齐，形成一张高维度的标准化对比总表（Standardized Summary Table）。
3. **统计学与可视化代码生成 (Statistical Test Isolation)**：大模型不擅长直接进行高精度的数学计算。因此，大模型只负责整理均值/方差总表 JSON，而将严谨的假设检验（如 T-Test, Wilcoxon）和绘图（如 Matplotlib/Seaborn）逻辑剥离到外部的 Python 脚本中生成，确保统计学的绝对严谨与可视化美观。

### 二、 汇整中枢矩阵

| 维度核心模块                            | 核心内容                                                                                       | 目标下游受众                   |
| :-------------------------------------- | :--------------------------------------------------------------------------------------------- | :----------------------------- |
| **结果汇总表 (Results Summary)**        | 中英双语的纯净指标对比矩阵（类似于论文中的 Main Results Table）。                              | 阶段 6 论文写作 (Writing)      |
| **合规比对报告 (Compliance Report)**    | 明确指出 `Missing`, `Registered`, `Exploratory` 指标的审计报告。                               | 人类 PI 审查 / 阶段 6 讨论章节 |
| **统计与绘图脚本 (Stat & Plot Script)** | 由 Markdown 块隔离提取的物理脚本 `statistical_analysis.py`，用于计算 p-value 并生成 PDF 图表。 | 物理执行器 (宿主机/容器)       |

### 三、 实现流程

| 步骤 | 动作                         | 说明                                                                                                                                                 |
| :--- | :--------------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | **资产全量装载**             | 调度器读取 `eval_protocol.json`、`execution_manifest.json`，并根据 manifest 遍历各任务目录，收集所有 `results.json` 或 `metrics.json`。              |
| 2    | **LLM 审计推演 (`<think>`)** | 对比预注册指标与实际产出。识别异常值、缺失值。规划统计检验方法（如根据样本量选择参数或非参数检验）。                                                 |
| 3    | **结构化汇总落盘**           | 输出符合双语要求的结果总表。若发现严重合规问题（如核心指标缺失），标记状态为 `NON_COMPLIANT`。                                                       |
| 4    | **物理脚本提取与执行**       | 正则截取 JSON 后的 `python` 代码块并落盘为 `statistical_analysis.py`。随后系统自动调用 python 执行该脚本，在 `visualizations/` 目录下生成 PDF 图表。 |

### 四、 核心输出结构 Schema 定义

| 字段名称                       | 类型   | 说明                                                                                         |
| :----------------------------- | :----- | :------------------------------------------------------------------------------------------- |
| `run_id`                       | String | 实验运行的唯一标识符。                                                                       |
| `prep_compliance_report_en/cn` | Object | 审计报告。必须包含 `status` (FULLY_COMPLIANT/PARTIALLY_COMPLIANT/NON_COMPLIANT) 及审计结论。 |
| `results_summary_en/cn`        | Object | 结果汇总。包含 `main_results_table` (各任务配置与指标的映射) 及核心观察 `observations`。     |
| `frozen_at`                    | String | 结果汇整的时间戳。                                                                           |

---

### 五、 Prompt 模板管理 (Prompt Template Management)

为了维护单一事实来源 (Single Source of Truth)，具体的系统级 Prompt 模板已迁移并同步至 Python 执行脚本 `mas4s_execution_aggregate.py` 中。设计方案不再保存 Prompt 文本，以防止文档与代码逻辑脱节。

---

### 六、 输出脚本使用说明 (Statistical Script Usage)

本步骤生成的 `statistical_analysis.py` 是确保实验严谨性的关键组件：

1. **执行方式**：在结果汇整目录执行 `python statistical_analysis.py`。
2. **环境依赖**：该脚本通常依赖 `pandas`, `matplotlib`, `seaborn`, `scipy`。
3. **产出物**：
   - **`visualizations/*.pdf`**：符合学术期刊出版标准的矢量图表（Bar Charts, Line Plots, Heatmaps）。
   - **`statistical_significance.txt`**：包含 p-value 和显著性水平（\* p < 0.05, \*\* p < 0.01）的详细文本报告。
4. **优势**：规避了 LLM 直接在文本中伪造或错算 P-Value 的风险，所有数据分析均基于落盘的 `results_summary_en.json` 进行二次物理运算。
