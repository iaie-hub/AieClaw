# 串行链式·双锚点科研 SOP（计算机领域·完整版）

**Serial Chained · Dual-Anchor Scientific Research SOP (CS Domain · Full Stack)**

## 阶段流转链

**课题锁定 → 文献底座 → 实验设计 → 实验数据采集 & 代码实现 → 实验执行 → 论文写作**

**流转标识：** `T → L → D → I → E → W`

---

## 核心机制

### 底层铁律

1. **单向状态机流转**：工作流严格按 `T → L → D → I → E → W` 单向执行。
2. **逆向流转**：仅通过明确的 `[Rollback]` 指令触发，携带 `target_stage` 与 `fatal_error_log`。
3. **强类型数据落盘**：上游输出进入下游前必须通过 JSON Schema 校验。
4. **架构解耦**：高层编排 Agent 不直接调用外部 API，所有工具交互封装在子 Agent 中。
5. **思维链路透明**：所有 Agent 输出最终结果前必须输出 `<think>...</think>` 内部推理过程。

### HITL 三轨制人类锚点

每个阶段挂起等待人类决策时，系统暴露三种标准操作路由：

| 指令             | 触发条件                   | 状态路由                                                                          |
| :--------------- | :------------------------- | :-------------------------------------------------------------------------------- |
| **`[Approve]`**  | 当前输出完全符合预期       | 冻结并落盘当前阶段数据，状态机指针跃迁至下一阶段                                  |
| **`[Retry]`**    | 输出有瑕疵或需补充约束     | 拦截落盘，清空当前结果，状态机原地重启。携带 `human_feedback` / `new_constraints` |
| **`[Rollback]`** | 当前困境源于上游根本性错误 | 废弃临时态数据，强制退回指定历史阶段。携带 `target_stage` 与 `fatal_error_log`    |

---

## 阶段 1：课题锁定（Topic）

**流转标识：`T`**
**对应 Agent**：Science Assistant: Topic

**目标**：将模糊的科研构想转化为边界清晰、有创新潜力、可证伪的科学问题。

### 核心步骤

| 步骤 | 名称               | 技能调用                                              | 输出                                                    |
| :--- | :----------------- | :---------------------------------------------------- | :------------------------------------------------------ |
| 1    | 检索增强           | `mas4s-topic-query-expand`                            | `idea_query_expand.json`                                |
| 2    | 多源检索与现实锚点 | `mas4s-topic-web-search` + `mas4s-topic-arxiv-search` | `web_search_results.json` + `arxiv_search_results.json` |
| 3    | 候选问题发散       | `mas4s-topic-candidate-generation`                    | `candidate_topics.json`                                 |
| 4    | 评分排序与框架构建 | `mas4s-topic-finer-framing`                           | `ranked_framed_hypothesis.json`                         |
| 5    | 首席审计与课题定型 | `mas4s-topic-principal-investigate`                   | `innovation_assessment_brief.md` + `pi_result.json`     |

**辅助步骤：课题重构** — 当 `[Rollback]` 触发时，调用 `mas4s-topic-pivot` 解析失败逻辑、吸收反馈、孕育新种子，重回步骤 1。

### 步骤 5 详细设计：首席审计与课题定型

#### 设计理念

1. **首席研究员审计 (PI Audit)**：对步骤 4 产出的研究框架进行最后的科学性与创新性审计。
2. **价值主张提炼 (Value Proposition)**：明确解释为何该课题填补了具体的证据差距。
3. **下游初始化 (Stage 2 Initialization)**：将 PICO 框架转化为精准的检索指令，为阶段 2 的 Literature Agent 铺路。**强制继承步骤 1 的初始检索关键词以确保搜索血统的连续性。**

#### 评估与决策矩阵

| 维度            | 说明                                                                      |
| :-------------- | :------------------------------------------------------------------------ |
| **PI 灵魂三问** | 核心差异点、失败产出价值、变量可观测性审计。                              |
| **审计简报**    | 撰写面向人类 PI 的创新性评估与执行风险分析。                              |
| **检索指令**    | 提炼 Boolean 检索词，**强制包含初始关键词**，指定推荐数据库。             |
| **HITL 网关**   | 提供 Go/No-Go 建议，引导用户进行 `[Approve]` / `[Retry]` / `[Rollback]`。 |

#### 输入参数

| 参数名       | 类型   | 必填 | 说明                        |
| :----------- | :----- | :--- | :-------------------------- |
| **run_id**   | String | 是   | 执行 ID，用于定位运行目录。 |
| **agent_id** | String | 否   | Agent ID，默认 `topic`。    |

**固定输入文件**：

1. `ranked_framed_hypothesis.json`：由步骤 4 产出。
2. `idea_query_expand.json`：由步骤 1 产出，用于提取初始检索关键词。
3. `fatal_error.log`（可选）
4. `human_feedback.txt`（可选）

#### 输出结构：`pi_result.json`

| 字段名                            | 类型   | 说明                                   |
| :-------------------------------- | :----- | :------------------------------------- |
| **pi_result**                     | Object | 最终科研课题定义（标题、PICO、假设）。 |
| **innovation_assessment_brief**   | Object | 创新性评估、知识空白声明与执行风险。   |
| **stage_2_literature_directives** | Object | 引导阶段 2 的检索关键词与排除词。      |
| **hitl_gateway**                  | Object | 给人类 PI 的决策建议与执行摘要。       |

#### 目录结构

```
~/.openclaw/workspace-topic/task/{run_id}/
├── idea_query_expand.json
├── ranked_framed_hypothesis.json
├── pi_result.json                      # 完整输出
├── pi_result_en.json                   # 英文输出
├── pi_result_cn.json                   # 中文输出
├── innovation_assessment_brief.md      # 首席审计简报
└── progress_mas4s_topic_principal_investigate.jsonl
```

### 现实锚点

- **双轨现实锚点**：基于学术与 Web 双源检索，识别研究重叠度，排除“红海”课题。
- **创新性评估简报**：包含明确的证据差距声明。

### 人类锚点

- `[Approve]`：冻结选题 → 流转至**文献底座 (L)**。
- `[Retry]`：补充约束重新生成 → 原地循环。
- `[Rollback]`：下游打回触发课题重构。

### 阶段输出 Schema

- 英文流转：`pi_result_en.json`（含课题标题、核心假说、关键词矩阵、证据差距声明）
- 中文展示：`pi_result_cn.json`

---

## 阶段 2：文献底座（Literature）

**流转标识：`L`**
**对应 Agent**：Science Assistant: Literature

**目标**：为锁定的课题构建透明、可验证、结构化的文献全景知识图谱，确保每一条知识均有据可查。

### 核心步骤

| 步骤 | 名称            | 技能调用                                    | 输出                                                                    |
| :--- | :-------------- | :------------------------------------------ | :---------------------------------------------------------------------- |
| 1    | 文献底座输入    | —（解析 `pi_result.json`）                  | 提取核心假说与关键词矩阵                                                |
| 2    | 学术检索        | `mas4s-literature-arxiv-search`             | `arxiv_search_results.json`                                             |
| 3    | 智能降噪        | `mas4s-literature-noise-reduction`          | `filtered_papers.json`                                                  |
| 4    | PDF 下载        | `mas4s-literature-pdf-download`             | 本地 PDF 集合（按 arXiv ID 分目录）                                     |
| 5    | PDF 转 Markdown | `mas4s-literature-pdf-to-markdown`          | 结构化 Markdown（按 arXiv ID 分目录）                                   |
| 6    | 逐篇深度解析    | 三 Skill 并发：                             |                                                                         |
|      | A: 宏观态势探针 | `mas4s-literature-macro-probe`              | `paper_macro_feature.json`                                              |
|      | B: 硬核解构引擎 | `mas4s-literature-technical-deconstruction` | `paper_technical_details.json`                                          |
|      | C: 价值批判专家 | `mas4s-literature-critical-review`          | `paper_critical_review.json`                                            |
| 7    | 图谱合成与审计  | `mas4s-literature-synthesizer`              | `literature_graph.json`（双语）+ `literature_synthesis_table_*.md/json` |

> 步骤 6 的三个 Skill 对每篇论文**并发独立触发**（默认并发数 16），输出分别落盘至对应论文子目录。

### 步骤 7 详细设计：文献全景合成与图谱构建中枢（Map-Reduce 增强版）

#### 设计理念

1. **防溢出架构**：强制采用 Map-Reduce 架构，先通过并发 Map 节点提取局部子图谱，再通过 Reduce 主节点全局综合。
2. **数据消费者物理隔离**：确立交付物"四位一体"并针对不同受众严格解耦：
   - **可视化图谱 (Graph)**：专供前端 UI 消费，直观呈现技术演进与学术战区。
   - **理论框架 (Framework)**：专供阶段 6 论文写作消费，作为生成 Introduction 和 Discussion 的叙事底料。
   - **机器数据源 (Feeds)**：专供阶段 3 / 4 消费，提供强类型基线、指标和工程瓶颈数组。
   - **文献特征表 (Table)**：为人类 PI 提供纵向对比的学术台账。
3. **双语双轨落盘**：严格输出 `en_US`（LLM 流转）与 `zh_CN`（前端展示）双体系。
4. **强制溯源与防篡改**：所有结论挂载原文献 ID，生成 `frozen_at` 时间戳。

#### 文献情报聚合矩阵

| 维度核心模块                 | 核心内容                                                   | 目标下游受众                 |
| :--------------------------- | :--------------------------------------------------------- | :--------------------------- |
| **可视化图谱 (Graph)**       | `nodes` 和 `edges` 结构，描述演进、继承与对抗。            | 阶段 2（UI 展示/人类 PI）    |
| **理论框架 (Framework)**     | 基于构念池、命题集、机制链与路径图的逻辑结构。             | 阶段 6（论文组装成文）       |
| **文献特征表 (Table)**       | 深度解构文献的理论、方法、结果与启示的纵向对比表。         | 阶段 2（人类 PI 查阅/决策）  |
| **机器数据流 (Feeds)**       | 提取标准 Baseline、Metrics、硬件依赖与工程瓶颈的纯净数组。 | 阶段 3、阶段 4（机器读取）   |
| **抢发审计 (Scooped Alert)** | 探测是否存在与 PI 假说 100% 撞车的文献。                   | HITL 状态机（触发 Rollback） |

#### 实现流程

| 步骤 | 动作            | 说明                                                                           |
| :--- | :-------------- | :----------------------------------------------------------------------------- |
| 1    | 情报加载与降噪  | 读取 PI 假说，聚合步骤 6 三种结构化 JSON，剔除原文与思维链压缩 Token。         |
| 2    | Map 分片压缩    | 将文献按 10-15 篇分批，高并发调用 LLM 提取局部技术共识与变量。                 |
| 3    | Reduce 全局合成 | 将子图谱喂入主干 LLM，生成包含四位一体结构的双语大 JSON。                      |
| 4    | JSON 拆解与落盘 | 拆解为 `literature_graph_en.json` 与 `_cn.json` 分别落盘，生成 Markdown 报告。 |
| 5    | HITL 挂起       | 检查 `scooped_alert`，挂起状态机等待人类 PI 决策。                             |
| 6    | 特征表渲染      | 聚合步骤 6 深析结果，生成纵向排列的文献特征表 Markdown/JSON 文件。             |

#### 输入参数

| 参数名             | 类型   | 必填 | 说明                            |
| :----------------- | :----- | :--- | :------------------------------ |
| **run_id**         | String | 是   | 执行 ID。                       |
| **concurrency**    | Int    | 否   | Map 阶段并发数，默认 8。        |
| **agent_id**       | String | 否   | Agent ID，默认 `literature`。   |
| **input_agent_id** | String | 否   | 阶段 1 Agent ID，默认 `topic`。 |

**必需输入文件**：

- `~/.openclaw/workspace-{input_agent_id}/task/{run_id}/pi_result.json`
- `~/.openclaw/workspace-{agent_id}/task/{run_id}/parsed_papers.json` 及子目录下的 JSON 流。

#### 输出结构：`literature_graph.json`

**固定输出文件**：

- `literature_graph.json`（完整原始大 JSON）
- `literature_graph_en.json`（纯英文版引擎驱动数据）
- `literature_graph_cn.json`（纯中文版前端渲染数据）
- `literature_synthesis_table_cn.md` / `_en.md` / `_cn.json` / `_en.json`（文献综合特征表 4 份）
- `literature_graph_cn.md` / `_en.md`（人机共读审计报告）

#### 文献特征表核心维度与字段定义

| 类别         | 栏目名称           | 承载 Skill   | 提取重点与用途                         |
| :----------- | :----------------- | :----------- | :------------------------------------- |
| **元信息**   | 作者/年份/arXiv ID | 宏观态势探针 | 唯一标识，注明版本号。                 |
|              | 是否已正式发表     | 宏观态势探针 | 标记同行评审状态，加权参考。           |
| **理论核心** | 研究问题/目标      | 宏观态势探针 | 一句话总结，拼凑领域全景。             |
|              | 核心构念与定义     | 硬核解构引擎 | 变量及操作化定义，指导实验变量设计。   |
|              | 理论视角/基础      | 宏观态势探针 | 经典理论借用，成为文献综述主干。       |
| **方法实证** | 研究范式/实验设计  | 硬核解构引擎 | 范式类型、被试、样本量、因子设计。     |
|              | 测量工具/指标      | 硬核解构引擎 | 量表、行为指标、信效度。               |
|              | 关键发现/效应量    | 硬核解构引擎 | 统计显著结果、效应大小、零/负结果。    |
| **启示反哺** | 直接启示           | 价值批判专家 | 可复用范式、需控制变量、改进刺激材料。 |
|              | 局限性与未来工作   | 价值批判专家 | 作者承认的不足，研究的创新切入点。     |

### 现实锚点

- **抢发探测**：自动检测 PI 假说是否已被完全覆盖，触发 `SCOOPED` 警报。
- **生态位验证**：通过知识图谱可视化，校验课题在技术流派中的创新空间。
- **全链路溯源**：图谱节点可追溯至原始 PDF 段落，杜绝幻觉生成。

### 人类锚点

- `[Approve]`：确认底座逻辑完备 → 流转至**实验设计 (D)**。
- `[Retry]`：调整关键词、扩充检索范围 → 原地循环。
- `[Rollback]`：致命抢发或证据链断裂 → 携带 Pivot 建议打回**课题锁定 (T)**。

### 阶段输出 Schema

- 英文流转：`literature_graph_en.json`（含 nodes、edges、特征表、抢发检测结果）
- 中文展示：`literature_graph_cn.json`
- 特征表：`literature_synthesis_table_en.md/json` + `literature_synthesis_table_cn.md/json`

---

## 阶段 3：实验设计（Design）

**流转标识：`D`**
**目标**：将阶段 1 的科学问题与阶段 2 的文献底座转化为可实现的算法/系统方案蓝图，并预先指定严格的评估协议，确保实验公平、可复现地回答研究假设。

### 核心步骤

**步骤 1：问题形式化**

- **技能调用**：`mas4s-design-problem-formalize`
- **输入**：`pi_result.json`（阶段 1）+ `literature_graph_en.json`（阶段 2 特征表中的 SOTA 方法与指标）
- **动作**：将科学问题转化为严格的 CS 问题陈述（问题类别、形式化定义、指标公理体系）
- **输出**：`problem_formulation.json`

**步骤 2：基线确立与方法空间扫描**

- **技能调用**：`mas4s-design-baseline-scan`
- **输入**：`literature_graph_en.json`（阶段 2 特征表+图谱方法族系）
- **动作**：提取、聚类现有方法，生成分级基线清单（SOTA/朴素/消融基线）与灵感来源映射
- **输出**：`baseline_manifest.json`

**步骤 3：提案方案蓝图**

- **技能调用**：`mas4s-design-method-blueprint`
- **输入**：`problem_formulation.json` + `baseline_manifest.json` + `pi_result.json`
- **动作**：生成算法/系统架构高层蓝图（核心机制、模块、数据流、三句话创新声明）
- **输出**：`method_blueprint.md` + `method_blueprint.json`

**步骤 4：预注册式评估协议（PREP）**

- **技能调用**：`mas4s-design-prep-spec`
- **输入**：`problem_formulation.json` + `baseline_manifest.json` + `method_blueprint.json`
- **动作**：明确指标、数据集划分、统计检验、消融方案、有效性威胁
- **输出**：`eval_protocol.json`（冻结后不可单方面修改）

**步骤 5：资源与伦理预检**

- **技能调用**：`mas4s-design-resource-ethics-check`
- **输入**：`method_blueprint.json` + `eval_protocol.json`
- **动作**：估算计算资源、检查数据/API 许可、评估偏见与伦理风险
- **输出**：`resource_ethics_report.json`

### 现实锚点

- **基线可复现性校验**：检查引用基线是否有公开代码/权重，缺失则触发警报。
- **数据污染探测**：扫描测试集是否在已知训练语料中出现。
- **PREP 合规性承诺**：评估协议生成哈希，后续偏离需显式标记为“探索性分析”。

### 人类锚点

- `[Approve]`：冻结方案蓝图与评估协议 → 流转至**代码实现 (I)**。
- `[Retry]`：调整基线、指标或消融设计 → 原地循环。
- `[Rollback]`：方案不可行或已被完全覆盖 → 回退至**课题锁定 (T)** 或**文献底座 (L)**。

### 阶段输出 Schema

- 英文流转：`design_package.json`
- 中文展示：`design_package_cn.json`

---

## 阶段 4：实验数据采集 & 代码实现（Implementation）

**流转标识：`I`**
**目标**：完成所有实验资产的准备，包括数据获取/构造、预处理流水线固化、正式评估代码的编写与单元验证，确保进入实验执行阶段前一切处于“一键运行”状态。

### 核心步骤

**步骤 1：数据资产构建**

- **技能调用**：`mas4s-implement-data-build`
- **输入**：`eval_protocol.json`（阶段 3 PREP）
- **动作**：下载/制备数据、固化预处理流水线、执行探索性分析，生成《数据基准特性报告》，记录溯源信息
- **输出**：`data_asset_report.json` + 数据制备代码

**步骤 2：提案方法代码实现**

- **技能调用**：`mas4s-implement-method`
- **输入**：`method_blueprint.json` + `problem_formulation.json`
- **动作**：将蓝图实现为可运行代码，编写单元测试，生成代码文档与依赖清单
- **输出**：提案方法代码 + `unit_test_report.json`

**步骤 3：基线复现与评估管线**

- **技能调用**：`mas4s-implement-baseline`
- **输入**：`baseline_manifest.json` + `eval_protocol.json`
- **动作**：拉取/复现基线，统一接口，编写标准化评估管线，产出《基线复现准确度报告》
- **输出**：`baseline_reproduction_report.json` + 评估管线代码

**步骤 4：容器化与环境冻结**

- **技能调用**：`mas4s-implement-containerize`
- **输入**：整个项目代码库
- **动作**：生成 Dockerfile，固定随机种子与依赖版本，运行迷你实验验证，记录环境哈希
- **输出**：`Dockerfile` + `environment_snapshot.json` + 迷你实验通过日志

### 现实锚点

- **基线复现准确度报告**：自动对比复现指标与原论文报告值。
- **数据溯源完整性**：所有数据资产记录来源、版本、许可，生成 `DATA_SOURCES.md`。
- **可重复性健康检查**：环境可构建、测试通过、迷你实验端到端无错误方可流转。

### 人类锚点

- `[Approve]`：确认所有资产与代码就绪 → 流转至**实验执行 (E)**。
- `[Retry]`：修复复现偏差、Bug 或环境问题 → 原地循环。
- `[Rollback]`：实现级不可行 → 回退至**实验设计 (D)**。

### 阶段输出 Schema

- 英文流转：`code_asset_package.json`
- 中文展示：`code_asset_package_cn.json`

---

## 阶段 5：实验执行（Execution）

**流转标识：`E`**
**目标**：在严格受控、冻结的环境下，一键启动所有预设实验，自动收集原始结果，杜绝任何临时干预或选择性报告。

### 核心步骤

**步骤 1：实验环境检核**

- **技能调用**：`mas4s-execution-env-verify`
- **输入**：`environment_snapshot.json`（阶段 4）
- **动作**：启动容器，校验硬件、种子、代码哈希一致性，生成检核证书
- **输出**：`env_verification_cert.json`

**步骤 2：一键全量运行**

- **技能调用**：`mas4s-execution-full-run`
- **输入**：`eval_protocol.json`（阶段 3 PREP）+ 阶段 4 冻结的代码与数据
- **动作**：自动运行所有方法、消融、敏感性分析，输出全部落盘并锁定时间戳
- **输出**：`execution_manifest.json`

**步骤 3：运行监控与异常记录**

- **技能调用**：`mas4s-execution-monitor`（与步骤 2 并发）
- **动作**：监控资源使用，捕获运行时错误，生成异常日志，绝不允许现场修改代码
- **输出**：`execution_anomaly_log.jsonl`

**步骤 4：结果自动汇整**

- **技能调用**：`mas4s-execution-result-aggregate`
- **输入**：`execution_manifest.json` + 所有运行输出
- **动作**：汇整纯净结果汇总表，比对 PREP，标记缺失/探索性分析
- **输出**：`results_summary.json` + `prep_compliance_report.json`

### 现实锚点

- **随机种子全链路验证**：检查所有随机化组件的种子固定情况。
- **执行完整性证明**：生成参数哈希、代码版本哈希、日志哈希链。
- **选择性报告防护**：预注册分析缺失或未声明分析出现时高亮警告。

### 人类锚点

- `[Approve]`：确认实验完整、结果无误 → 流转至**论文写作 (W)**。
- `[Retry]`：通常不适用。
- `[Rollback]`：结果无效 → 回退至**代码实现 (I)**，甚至**实验设计 (D)**。

### 阶段输出 Schema

- 英文流转：`execution_package.json`
- 中文展示：`execution_package_cn.json`

---

## 阶段 6：论文写作（Writing）

**流转标识：`W`**
**目标**：基于前序阶段的纯净输出，在沙盒环境中生成符合计算机科学顶级会议/期刊规范的论文初稿，确保方法可复现、主张有据、讨论冷静。

### 核心步骤

**步骤 1：方法部分自动编撰**

- **技能调用**：`mas4s-writing-method-draft`
- **输入**：`method_blueprint.json`（阶段 3）+ 阶段 4 实际代码
- **动作**：生成正式方法论描述、算法伪代码、架构图 LaTeX 描述
- **强制写作顺序**：方法 → 实验设置 → 结果 → 讨论 → 相关工作/引言 → 摘要

**步骤 2：实验设置与结果自动生成**

- **技能调用**：`mas4s-writing-experiment-draft`
- **输入**：`eval_protocol.json`（阶段 3 PREP）+ `results_summary.json`（阶段 5）+ `prep_compliance_report.json`（阶段 5）
- **动作**：从 PREP 转换实验设置，从纯净结果生成客观描述，自动区分主结果/消融/探索性分析，所有结果句附着数据锚点

**步骤 3：讨论结构化成文**

- **技能调用**：`mas4s-writing-discussion-draft`
- **输入**：`results_summary.json` + `literature_graph_en.json`（阶段 2，仅引文献底座）+ `pi_result.json`（阶段 1）
- **动作**：按模板生成讨论（主要发现→文献异同→推测标记→局限→影响），推测性陈述显式标识 `[Speculative]`

**步骤 4：相关工作与引言生成**

- **技能调用**：`mas4s-writing-intro-related`
- **输入**：`discussion_section_draft.tex` + `literature_graph_en.json` + `pi_result.json`
- **动作**：基于文献底座生成相关工作（按方法族系组织），引言以证据差距声明为起点收束至贡献列表

**步骤 5：摘要生成与全稿整合**

- **技能调用**：`mas4s-writing-abstract-integrate`
- **输入**：所有已完成章节
- **动作**：生成摘要，整合全稿，依目标会议/期刊排版，自动生成《可复现性声明》，参考文献由文献底座生成并校验 DOI/撤稿状态

**步骤 6：完整性审查**

- **技能调用**：`mas4s-writing-integrity-check`
- **输入**：`manuscript_draft.tex` + 所有前序阶段输出
- **动作**：生成主张-证据映射报告，检查夸大词汇、抄袭痕迹、双盲合规性、引用完整性

### 现实锚点

- **沙盒断网撰写**：仅访问阶段 1~5 落盘数据，物理阻断互联网幻觉/剽窃。
- **主张-证据映射**：每个科学主张必须有原始数据锚点或文献来源。
- **参考文献全量溯源**：全部引用来自文献底座，DOI 可查验，无撤稿文章。

### 人类锚点

- `[Approve]`：逐字审阅所有主张、映射与格式 → 产出最终送审稿，流程结束。
- `[Retry]`：框选部分重写 → 原地循环，不得改动阶段 5 客观结果。
- `[Rollback]`：论证链缺口或缺失关键实验 → 回退至**实验执行 (E)**，甚至**实验设计 (D)**。

### 阶段输出 Schema

- 英文流转：`manuscript_package.json`（含最终送审稿、可复现性声明、主张-证据映射、完整性审查）
- 中文展示：`manuscript_package_cn.json`
- 最终送审稿：`manuscript_final.tex` + `manuscript_final.pdf`
- 可复现性声明：`reproducibility_statement.md`
- 主张-证据映射：`claim_evidence_map.json`

---

## 全局流转状态机

```
课题锁定(T) ──[Approve]──→ 文献底座(L) ──[Approve]──→ 实验设计(D)
    ↑                         ↑                          ↑
    │                         │                          │
    └───[Rollback]───────────┘                          │
    ↑                                                    │
    └─────────────────[Rollback]─────────────────────────┘

实验设计(D) ──[Approve]──→ 代码实现(I) ──[Approve]──→ 实验执行(E)
    ↑                          ↑                          ↑
    │                          │                          │
    └───[Rollback]────────────┘                          │
    ↑                                                     │
    └───────────────────[Rollback]────────────────────────┘

实验执行(E) ──[Approve]──→ 论文写作(W)
    ↑                          ↑
    │                          │
    └───[Rollback]─────────────┘
    ↑
    └──────────[Rollback]─────────（可跨多阶段跳回至 I / D 阶段）
```

- 所有 `[Retry]` 在当前阶段形成内部闭环，不触发指针跃迁。
- `[Rollback]` 携带 `fatal_error_log` 与 `target_stage`，允许跨多阶段跳回。
- 流转至论文写作的 `[Approve]` 标志着系统完成最终送审稿产出。

---

## Schema 体系设计（全阶段）

| 阶段       | Agent ID     | 英文流转 Schema                                | 中文展示 Schema                                   | 核心输出文件                                                                                                                                |
| :--------- | :----------- | :--------------------------------------------- | :------------------------------------------------ | :------------------------------------------------------------------------------------------------------------------------------------------ |
| 阶段 1 (T) | `topic`      | `schemas/output/topic_output.schema.json`      | `schemas/output/topic_output_cn.schema.json`      | `pi_result_en.json` / `pi_result_cn.json`                                                                                                   |
| 阶段 2 (L) | `literature` | `schemas/output/literature_output.schema.json` | `schemas/output/literature_output_cn.schema.json` | `literature_graph_en.json` / `literature_graph_cn.json` / `literature_synthesis_table_en.md/json` / `literature_synthesis_table_cn.md/json` |
| 阶段 3 (D) | `design`     | `schemas/output/design_output.schema.json`     | `schemas/output/design_output_cn.schema.json`     | `design_package.json` / `design_package_cn.json`                                                                                            |
| 阶段 4 (I) | `code`       | `schemas/output/code_output.schema.json`       | `schemas/output/code_output_cn.schema.json`       | `code_asset_package.json` / `code_asset_package_cn.json`                                                                                    |
| 阶段 5 (E) | `execution`  | `schemas/output/execution_output.schema.json`  | `schemas/output/execution_output_cn.schema.json`  | `execution_package.json` / `execution_package_cn.json`                                                                                      |
| 阶段 6 (W) | `writing`    | `schemas/output/writing_output.schema.json`    | `schemas/output/writing_output_cn.schema.json`    | `manuscript_package.json` / `manuscript_package_cn.json`                                                                                    |

所有输入 Schema 仅包含英文键名；输出同时产生英文版（Agent 间流转）和中文版（前端展示），分别落盘。

---

## 阶段衔接数据流总览

```
pi_result.json ───────────────────→ 文献底座(L)
     (stage_2_literature_directives)      │
                                          ↓
                                  literature_graph_en.json
                                   (含 Feeds / Graph / Framework)
                                          │
                                          ↓  (合并 pi_result.json)
                                    实验设计(D)
                                          │
                                          ↓
                                  design_package.json
                                          │
                                          ↓
                               实验数据采集&代码实现(I)
                                          │
                                          ↓
                                code_asset_package.json
                                          │
                                          ↓
                                    实验执行(E)
                                          │
                                          ↓
                                execution_package.json
                                          │
                                          ↓
                                    论文写作(W)
                                          │
                                          ↓
                                manuscript_package.json
```

每个阶段的输出均经过 JSON Schema 校验后，作为下一阶段的强制输入。阶段间流转仅传递英文版 Schema 数据，中文版并行落盘供前端展示。

---

## 附录：全阶段技能清单汇总

| 阶段  | 技能名称                           | 功能                                                   |
| :---- | :--------------------------------- | :----------------------------------------------------- |
| **T** | `mas4s-topic-expand`               | 检索增强：多维关键词扩展                               |
| T     | `mas4s-topic-web`                  | Web 检索：行业痛点与工程现状                           |
| T     | `mas4s-topic-arxiv`                | 学术检索：最新论文与 SOTA                              |
| T     | `mas4s-topic-generate`             | 候选问题发散                                           |
| T     | `mas4s-topic-frame`                | FINER 评分与 PICO/PEOS 框架构建                        |
| T     | `mas4s-topic-investigate`          | 首席审计与课题定型（含 stage_2_literature_directives） |
| T     | `mas4s-topic-pivot`                | 课题重构（Rollback 触发）                              |
| **L** | `mas4s-literature-search`          | 学术检索：基于 PI 假说精准抓取                         |
| L     | `mas4s-literature-filter`          | 智能降噪：相关性过滤                                   |
| L     | `mas4s-literature-download`        | PDF 批量下载                                           |
| L     | `mas4s-literature-parse`           | PDF 转结构化 Markdown                                  |
| L     | `mas4s-literature-probe`           | 宏观态势探针                                           |
| L     | `mas4s-literature-deconstruct`     | 硬核解构引擎                                           |
| L     | `mas4s-literature-critique`        | 价值批判专家                                           |
| L     | `mas4s-literature-synthesize`      | 图谱合成与全景审计（Map-Reduce 四位一体）              |
| **D** | `mas4s-design-formalize`           | 问题形式化：将科学问题转化为 CS 问题陈述               |
| D     | `mas4s-design-baseline`            | 基线确立：从文献底座提取并分类方法，生成基线清单       |
| D     | `mas4s-design-blueprint`           | 方案蓝图：生成算法/系统架构高层设计                    |
| D     | `mas4s-design-prep`                | PREP 制定：生成预注册式评估协议                        |
| D     | `mas4s-design-ethics`              | 资源与伦理预检                                         |
| **I** | `mas4s-implement-data-build`       | 数据资产构建：下载/制备/探索性分析                     |
| I     | `mas4s-implement-method`           | 提案方法代码实现+单元测试                              |
| I     | `mas4s-implement-baseline`         | 基线复现+统一评估管线                                  |
| I     | `mas4s-implement-containerize`     | 容器化+环境冻结+迷你实验验证                           |
| **E** | `mas4s-execution-env-verify`       | 实验环境检核                                           |
| E     | `mas4s-execution-full-run`         | 一键全量运行                                           |
| E     | `mas4s-execution-monitor`          | 运行时监控与异常记录                                   |
| E     | `mas4s-execution-result-aggregate` | 结果自动汇整+PREP 合规比对                             |
| **W** | `mas4s-writing-method-draft`       | 方法部分自动编撰                                       |
| W     | `mas4s-writing-experiment-draft`   | 实验设置与结果自动生成                                 |
| W     | `mas4s-writing-discussion-draft`   | 讨论结构化成文                                         |
| W     | `mas4s-writing-intro-related`      | 相关工作与引言生成                                     |
| W     | `mas4s-writing-abstract-integrate` | 摘要生成与全稿整合                                     |
| W     | `mas4s-writing-integrity-check`    | 完整性审查（主张-证据映射等）                          |
