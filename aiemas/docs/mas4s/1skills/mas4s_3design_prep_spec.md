## 阶段 3 - 步骤 4：预注册式评估协议 (PREP Spec) 设计方案

### 一、 设计理念

1.  **预注册约束 (Pre-registration Constraint)**：在实验执行前锁定所有评估细节，旨在杜绝“HARKing”（结果已知后提出假设）现象，确保科研诚信。
2.  **指标分级体系 (Primary & Secondary Metrics)**：明确主指标（用于判定假说是否成立）与辅助指标（用于提供机制解释），防止指标泛滥。
3.  **统计严谨性 (Statistical Rigor)**：预设显著性水平（$\alpha$ 值）、检验方法（如 t-test, ANOVA）及效应量计算逻辑，而非事后选择统计工具。
4.  **效度威胁预判 (Threats to Validity)**：提前识别并记录可能影响实验有效性的因素（如数据污染、硬件偏差），增强研究的稳健性。

### 二、 设计方案

#### 评估协议中枢矩阵

| 维度核心模块                          | 核心内容                                                              | 目标下游受众    |
| :------------------------------------ | :-------------------------------------------------------------------- | :-------------- |
| **主要假说映射 (Hypothesis Mapping)** | 将阶段 1 的 H1 转化为具体的指标预期（如 $M_{ours} > M_{baseline}$）。 | 阶段 5 (评估)   |
| **实验组配置 (Configuration Groups)** | 对照组、实验组、以及所有消融组的详细参数配置。                        | 阶段 4 (实现)   |
| **数据协议 (Data Protocol)**          | 数据集划分（Train/Val/Test）、采样策略、防污染检测。                  | 阶段 4 / 阶段 5 |
| **统计检验方案 (Statistical Plan)**   | 检验方法、置信区间、效应量测量（Effect Size）。                       | 阶段 5 (分析)   |

### 三、 实现流程

| 步骤 | 动作           | 说明                                                                                            |
| :--- | :------------- | :---------------------------------------------------------------------------------------------- |
| 1    | 情报加载与对齐 | 加载 `problem_formulation_en.json`、`baseline_manifest_en.json` 与 `method_blueprint_en.json`。 |
| 2    | 指标优先级锁定 | 从形式化定义中提取指标，标记其为主指标（Primary）或辅助指标（Secondary）。                      |
| 3    | 消融路径设计   | 基于 `ablation_baselines` 定义具体的变量剥离路径。                                              |
| 4    | 统计工具预设   | 根据数据特征自动匹配合适的统计检验方法与显著性标准。                                            |
| 5    | 双语持久化     | 拆分为 `_en.json` 与 `_cn.json`，并生成 `eval_protocol.json`。                                  |

### 四、 输入参数

所有文件集中存放于 `~/.openclaw/workspace-design/task/{run_id}/`。

| 参数名       | 类型   | 必填 | 说明                      |
| :----------- | :----- | :--- | :------------------------ |
| **run_id**   | String | 是   | 执行 ID。                 |
| **agent_id** | String | 否   | Agent ID，默认 `design`。 |

**必需输入文件**：

- `problem_formulation_en.json`
- `baseline_manifest_en.json`
- `method_blueprint_en.json`

### 五、 输出参数

**固定输出文件**：

- `eval_protocol.json`：完整的中英混合评估协议（含统计参数）。
- `eval_protocol_en.json`：纯英文版（Stage 5 分析驱动）。
- `eval_protocol_cn.json`：纯中文版（前端展示）。
- `eval_protocol_brief.md`：预注册协议简报。

### 六、 核心字段定义

| 类别         | 字段名称              | 描述                                                    |
| :----------- | :-------------------- | :------------------------------------------------------ |
| **假说检验** | `metric_expectations` | 指标与预期的对应关系（如：DSR 需达到 > 15% 提升）。     |
| **数据集**   | `dataset_split_ratio` | 训练/验证/测试集的比例及随机种子。                      |
| **统计分析** | `statistical_test`    | 使用的统计检验方法（t-test, permutation test 等）。     |
|              | `significance_level`  | $\alpha$ 值（默认 0.05）。                              |
| **效度预判** | `threats_to_validity` | 包含 `internal`, `external`, `construct` 三类威胁说明。 |

### 七、 示例

#### 7.1 运行示例

```bash
python3 scripts/mas4s_design_prep_spec.py '{"run_id": "run_20260430"}'
```

#### 7.2 评估协议简报示例 (Markdown)

> ## 4. 预注册评估协议 (PREP)
>
> ### 4.1 主要假说检验
>
> - **H1-Validation**: Ours 方案在 **DSR (漂移抑制率)** 指标上应显著优于 **SBM 基线**。
> - **统计方法**: 独立样本 t 检验，效应量 Cohen's d > 0.5。
>
> ### 4.3 消融路径
>
> 1. **移除 FCSM 索引**: 验证“失败中心”机制的贡献。
> 2. **移除跨语言共享**: 验证“共生性”对多语言场景的增益。

### 八、 SOP 观测支持

- **进度上报**：上报 `正在制定实验对照组与采样协议...` 与 `正在计算统计检验效能...`。
- **协议锁定**：文件生成后附带哈希值，任何后续修改将触发审计警报。
