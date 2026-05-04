## 阶段 4 - 步骤 1：数据资产构建 (Data Asset Building) 设计方案

### 一、 设计理念

1.  **数据溯源与物理锚定 (Data Lineage & Sourcing)**：将 PREP 协议中对数据的抽象要求，转化为真实物理世界中可溯源的数据流向。无论是下载公开基准测试、API 抓取还是大模型合成，都必须记录明确的来源、版本与特征。
2.  **绝对防污染护栏 (Strict Anti-Contamination)**：在实验中，测试集泄漏 (Data Leakage) 是最致命的逻辑缺陷。管线代码必须从数学或算法层面（如聚类去重、哈希比对）保证初始化集（Training/Init）与测试集（Test）零重叠。
3.  **物理代码隔离抽取 (Physical Script Isolation)**：数据处理通常涉及大规模 Pandas 操作，让 LLM 将复杂的预处理流水线直接写在 JSON 中极易引发转义崩溃。本步骤强制通过正则提取外部 Markdown 代码块来落盘物理 Python 脚本。
4.  **工程鲁棒性约束 (Engineering Robustness)**：在系统提示词级别硬编码防御规则，例如防范 Pandas 迭代保存时的 JSON 序列化崩溃，以及强制通过 `os.makedirs` 创建目录防范 `FileNotFoundError`。

### 二、 设计方案

#### 数据资产构建中枢矩阵

| 维度核心模块                              | 核心内容                                                                       | 目标下游受众                              |
| :---------------------------------------- | :----------------------------------------------------------------------------- | :---------------------------------------- |
| **数据预处理管线 (Preprocessing Script)** | 数据拉取、清洗、去重、切割及落盘的完整自动化代码 (`preprocessing_script.py`)。 | 人类 PI (通过 CI 或手动触发落盘) / 阶段 5 |
| **资产合规报告 (Data Asset Report)**      | 数据溯源链路、预计划的 EDA 指标及防污染手段的理论论证报告。                    | 阶段 5 (实验执行) 合规性校验              |
| **依赖清单 (Dependency Manifest)**        | 执行该预处理脚本所需的第三方库清单 (`requirements.txt`)。                      | 环境冻结与容器化 (阶段4步骤4)             |
| **数据简报 (Data Asset Brief)**           | 供快速查阅的中英双语数据资产简要说明 (`data_asset_brief.md`)。                 | 人类 PI (HITL 审计)                       |

### 三、 实现流程

| 步骤 | 动作                 | 说明                                                                         |
| :--- | :------------------- | :--------------------------------------------------------------------------- |
| 1    | 情报加载与跨目录寻址 | 向上游 `workspace-design` 寻址并加载 `eval_protocol_en.json`。               |
| 2    | HITL 反馈注入        | 检查当前环境是否存在 `fatal_error.log` 或 `human_feedback.txt`。             |
| 3    | LLM 逻辑推演         | 大模型在 `<think>` 中推演数据来源、EDA 计划及防污染划分的落地方案。          |
| 4    | 代码与数据隔离抽取   | 使用正则独立提取大模型输出的 JSON 报告框架与包含预处理脚本的 Python 代码块。 |
| 5    | 多维资产落盘         | 拆分生成独立运行的 `.py` 脚本、`.txt` 依赖及中英双语报告与 Markdown 简报。   |

### 四、 输入参数

所有文件集中存放于 `~/.openclaw/workspace-implement/task/{run_id}/`，输入文件支持跨 Agent 目录的智能回退寻址。

| 参数名       | 类型   | 必填 | 说明                             |
| :----------- | :----- | :--- | :------------------------------- |
| **run_id**   | String | 是   | 执行 ID。                        |
| **agent_id** | String | 否   | Agent ID，当前默认 `implement`。 |

**必需输入文件**：

- `~/.openclaw/workspace-design/task/{run_id}/eval_protocol_en.json`

### 五、 输出参数与使用说明

此步骤的物理输出资产决定了后续实验代码能否获取正确的底层数据。以下为固定输出文件及其**严格的使用方法**：

- **`preprocessing_script.py`**：由智能体生成的完整 Python 预处理流水线脚本。
  - **使用说明**：该脚本**不会由智能体自动运行**。由于数据拉取可能耗时且占用巨大空间，人类研究员需在受控环境（或依托 CI 管道）**手动执行该脚本**（`python preprocessing_script.py`）。脚本运行后，会在本地落盘真正供后续步骤读取的物理数据集（如 `init_set.jsonl`, `test_set.jsonl`）。
- **`data_asset_report.json`**：中英混合的资产验证报告。
  - **使用说明**：它是实验防泄漏逻辑的数学承诺。在阶段 5（实验执行阶段）自动汇整结果时，该 JSON 将作为基准对比文件，用于核实落盘的数据集统计学特征是否匹配报告预期。
- **`data_asset_report_en.json` / `_cn.json`**：纯英/纯中双语版本的数据验证报告。
- **`requirements.txt`**：运行 `preprocessing_script.py` 的必备依赖。
- **`data_asset_brief.md`**：数据健康度简报，供人类 PI 在 Web UI 快速审计。

### 六、 核心维度与字段定义

| 类别           | 字段名称                               | 描述                                                           |
| :------------- | :------------------------------------- | :------------------------------------------------------------- |
| **预处理逻辑** | `required_dependencies`                | Python 依赖库列表。                                            |
|                | `cleaning_and_normalization_rules`     | 描述处理噪声数据、异常值和格式对齐的文本规则。                 |
| **健康度报告** | `data_sourcing_and_lineage`            | 描述原始数据的确切获取方式（来源、格式、版本逻辑）。           |
|                | `exploratory_data_analysis_plan`       | 预先定义要在实验开始前计算的 EDA 指标以验证健康度。            |
|                | `split_and_contamination_verification` | 说明在代码层面如何保证 PREP 中定义的数据划分，确保零数据泄漏。 |

### 七、 示例

#### 7.1 运行示例

```bash
python scripts/mas4s_implement_data_build.py '{"run_id": "run_20260430"}'
```

#### 7.2 数据资产简报示例

> # 阶段 4 步骤 1：数据资产构建报告 (Data Asset Brief)
>
> ## 1. 数据溯源与获取 (Data Sourcing & Lineage)
>
> 从 HuggingFace `Anthropic/hh-rlhf` 数据集实时拉取。选取包含“拒绝回答”安全标识的子集。版本锁定为 commit hash `abcd123`。
>
> ## 2. 防污染切割验证 (Contamination Verification)
>
> 代码层面使用 `hashlib.sha256` 对 prompt 进行散列化。构建集合 `init_hashes` 和 `test_hashes`，并在保存前执行 `assert len(init_hashes.intersection(test_hashes)) == 0`，以物理断言确保数据零泄漏。

### 八、 SOP 观测支持

- **进度上报**：在关键点上报 `正在构建数据资产与预处理管线...` 与 `正在执行中英双语拆分落盘...`。
- **进度文件路径**：`~/.openclaw/workspace-implement/task/<run_id>/progress_mas4s_implement_data_build.jsonl`
- **极致的防御性编程约束**：Prompt 内部已集成针对 Pandas 的 JSON 序列化缺陷补丁以及 `os.makedirs` 的强制防范，保证了生成的 `preprocessing_script.py` 可以“即开即用”而不爆低级运行时异常。
