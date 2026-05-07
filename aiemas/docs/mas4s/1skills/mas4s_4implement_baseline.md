## 阶段 4 - 步骤 3：基线复现与评估管线 (Baseline Pipeline) 设计方案

### 一、 设计理念

1.  **接口强一致性 (Interface Uniformity)**：通过抽象基类（Abstract Base Class / Wrapper Interface），强制所有对比基线（如大模型 API、本地权重微调、检索增强等异构系统）实现统一的标准调用接口（如 `predict()` 和 `reset()`），彻底消灭由于接口不对齐导致的运行时崩溃。
2.  **强制指标数据落地 (Metric Grounding)**：评估管线的任务不仅是跑通模型，更是要记录能用于计算 PREP 协议中各项评估指标（如 DSR、MTTR）的原始数据。系统通过延迟计算思维，强制在主循环中埋点记录时间戳、输出结果和成败标识等日志。
3.  **状态防泄漏护栏 (Contamination Check)**：针对严格的“冷启动 (Cold Start)”要求，代码主循环必须包含防止运行间状态泄漏的逻辑断言。例如在每次实例化新的测试案例或 Agent 时强制执行环境和记忆 `reset()`。
4.  **物理隔离脚本 (Physical Script Isolation)**：将负责多态适配的基线包装器（Wrappers）和负责执行的主循环（Pipeline Runner）拆分为两个独立的 Python 脚本，以保证代码的低耦合和易调试性，同时采用外围正则截取策略规避 JSON 字符转义缺陷。

### 二、 设计方案

#### 基线评估管线中枢矩阵

| 维度核心模块                                    | 核心内容                                                                                              | 目标下游受众        |
| :---------------------------------------------- | :---------------------------------------------------------------------------------------------------- | :------------------ |
| **基线包装器脚本 (Baseline Wrappers Script)**   | 包含统一的接口抽象及所有基线（SOTA、Naive、Ablation）的包装子类实现 (`baseline_wrappers.py`)。        | 评估管线            |
| **评估主循环脚本 (Evaluation Pipeline Script)** | 包含负责加载数据、实例化模型、触发预测、防污染断言及记录埋点的外层主循环 (`evaluation_pipeline.py`)。 | 阶段 5 (实验执行)   |
| **复现与管线简报 (Report & Brief)**             | 中英双语的统一接口设计说明与指标日志跟踪策略报告。                                                    | 人类 PI (HITL 审计) |

### 三、 实现流程

| 步骤 | 动作                 | 说明                                                                                               |
| :--- | :------------------- | :------------------------------------------------------------------------------------------------- |
| 1    | 情报加载与跨目录寻址 | 向上游 `workspace-design` 寻址并加载 `baseline_manifest_en.json` 与 `eval_protocol_en.json`。      |
| 2    | HITL 反馈注入        | 检查当前环境是否存在 `fatal_error.log` (回滚) 或 `human_feedback.txt` (重试)，作为修正最高优先级。 |
| 3    | LLM 逻辑推演         | 调用大模型，在 `<think>` 中推演统一接口设计、基线映射落地、指标跟踪逻辑与防泄漏策略。              |
| 4    | 代码与数据隔离抽取   | 使用正则独立提取大模型输出在 Markdown 代码块中的两个 Python 脚本片段。                             |
| 5    | 多维资产落盘         | 分离输出 `.py` 代码文件以及双语版的 `baseline_reproduction_report.json` 与 Markdown 简报文件。     |

### 四、 输入参数

所有文件集中存放于 `~/.openclaw/workspace-implement/task/{run_id}/`，输入文件支持跨 Agent 目录的智能回退寻址。

| 参数名       | 类型   | 必填 | 说明                             |
| :----------- | :----- | :--- | :------------------------------- |
| **run_id**   | String | 是   | 执行 ID。                        |
| **agent_id** | String | 否   | Agent ID，当前默认 `implement`。 |

**必需输入文件**：

- `~/.openclaw/workspace-design/task/{run_id}/baseline_manifest_en.json`
- `~/.openclaw/workspace-design/task/{run_id}/eval_protocol_en.json`

### 五、 输出参数与使用说明

**固定输出文件**：

- **`baseline_wrappers.py`**：所有对比基线的统一包装器实现源码。
  - **使用说明**：该文件作为所有对比方法的底层统一接口提供方，被主执行脚本调用，无需人工干预。
- **`evaluation_pipeline.py`**：自动执行全部基线测试并记录指标的主循环脚本。
  - **使用说明**：该脚本包含了整个评测的入口点（Entry Point）。在 Stage 5 执行阶段，它将被一键调用运行。在此之前，人类可以对其进行代码审查以确认指标采集埋点无遗漏。
- **`baseline_reproduction_report.json`**：中英混合的原始评估管线报告数据。
- **`baseline_reproduction_report_en.json` / `_cn.json`**：纯英/纯中双语版评估管线报告。
  - **使用说明**：用于后续评估阶段和论文写作阶段提取统一接口的架构说明和埋点策略描述。
- **`baseline_reproduction_brief.md`**：供人类快速审计的基线复现与评估设计简报。

### 六、 核心维度与字段定义

| 类别         | 字段名称                     | 描述                                                                               |
| :----------- | :--------------------------- | :--------------------------------------------------------------------------------- |
| **代码生成** | `baseline_wrappers_script`   | 包含 ABC 抽象接口及具体基线实现的 Python 源码。                                    |
|              | `evaluation_pipeline_script` | 包含评估主执行循环与各项指标日志记录落地的 Python 源码。                           |
| **管线报告** | `unified_interface_design`   | 解释用于统一异构基线调用链路（如 API 与本地权重）的架构模式。                      |
|              | `metric_tracking_strategy`   | 解释管线主循环在不拖慢执行的前提下，如何安全有效地记录各类指标（如违规时间戳等）。 |

### 七、 示例

#### 7.1 运行示例

```bash
python scripts/mas4s_implement_baseline.py '{"run_id": "run_20260430"}'
```

#### 7.2 评估管线简报示例

> # 阶段 4 步骤 3：基线复现与评估管线报告 (Baseline Pipeline Brief)
>
> ## 1. 统一接口设计 (Unified Interface Design)
>
> 设计了 `AbstractBaseline` 基类，强制实现 `setup(config)` 和 `predict(input_state)` 方法。针对检索增强基线，在 `setup` 中初始化了向量数据库连接；针对纯 LLM 基线，则复用了统一的 API 适配器。
>
> ## 2. 指标追踪与落地策略 (Metric Tracking Strategy)
>
> 管线主循环使用了 `JSONLines` 日志追加模式（`append mode`），在每次 `predict()` 调用前后记录 `t_start` 和 `t_end`。当检测到防越狱违规标识时，立即记录 `violation_event=True`，彻底解耦了数据收集与指标统计，保证了程序不崩溃。

### 八、 SOP 观测支持

- **进度上报**：在关键点上报 `正在构建基线包装器与评估主循环...` 与 `正在执行中英双语拆分落盘...`。
- **进度文件路径**：`~/.openclaw/workspace-implement/task/<run_id>/progress_mas4s_implement_baseline.jsonl`
- **容错机制**：基于上游统一的物理代码隔离抽取方案，LLM 在 JSON 中只输出简述字段，而将数千行基线代码与管线代码置于外部，避免长字符串解析崩溃。
