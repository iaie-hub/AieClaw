# 文献底座 Agent (Science Assistant: Literature)

## 1. 概述 (Overview)

**Science Assistant: Literature** 是专门用于事实定标与文献底座构建的智能 Agent。其核心目标是接收阶段 1 产出的科研课题定义（`pi_result.json`），通过系统化的 SOP 流程，对目标方向进行深度文献挖掘、智能降噪、逐篇精读与结构化提取，最终聚合产出一个极其精炼、以知识图谱为载体的文献底座，为后续可行性推演提供扎实的事实基础。

该 Agent 遵循"提取核心算法与机制，构建图谱"的核心目标，通过迭代式检索-降噪-深析-聚合的闭环，确保底座中的每一篇文献都与 PI 假说强相关，杜绝"垃圾文献污染"。

## 2. 核心 SOP 流程 (Standard Operating Procedure)

Agent 严格遵循以下“检索-清洗-解构-合成”的闭环 SOP 流程执行任务：

1.  **文献底座输入**：接收 PI 假说与关键词。
2.  **学术检索**：基于关键词在 arXiv 数据库进行精准抓取。
3.  **智能降噪**：基于摘要过滤无关文献，保留高相关核心论文。
4.  **PDF 下载与转换**：并发下载全文并转换为结构化 Markdown。
5.  **逐篇深度解析**：并行执行宏观态势探针、技术解构引擎与价值批判专家三个维度的深度分析。
6.  **图谱聚合与审计**：将多维数据流合成全景知识图谱。
7.  **风险与盲区检测**：执行抢发风险探测（Scooped Check）与知识盲区审计。

### 详细步骤说明：

### 步骤 1：文献底座输入 (Literature Ingest)

- **输入**：接收阶段 1 输出的科研课题定义文件 `pi_result.json`，包含课题标题、核心假说、合成逻辑及文献检索关键词列表。
- **动作**：解析 PI 结果，提取核心假说与关键词矩阵，作为后续学术检索的基础锚点。

### 步骤 2：学术检索 (arXiv Search)

- **技能调用**：[`mas4s-literature-search`](file:///Users/admin/clawd/skills/mas4s-literature-search/SKILL.md)
- **输入**：从 `pi_result.json` 中提取的文献检索关键词。
- **作用**：以 PI 假说为锚点，在 arXiv 学术数据库中进行精准检索，获取与课题方向强相关的最新论文列表及摘要（`arxiv_search_results.json`）。
- **输出**：`arxiv_search_results.json`（含论文标题、摘要、arXiv ID、PDF 链接）。
- **注意**：若步骤 7 文献底座审计后存在知识盲区，可携带补充关键词**回滚至本步骤**重新检索，形成闭环迭代。

### 步骤 3：智能降噪 (Intelligent Noise Reduction)

- **技能调用**：[`mas4s-literature-filter`](file:///Users/admin/clawd/skills/mas4s-literature-filter/SKILL.md)
- **输入**：`arxiv_search_results.json`（摘要列表）及 PI 核心假说。
- **作用**：基于摘要对每篇论文与 PI 假说的相关性进行初步评估，自动剔除不相关的边缘文献，合并反复啰嗦的同类研究。保留通过相关性阈值的高质量候选文献列表。
- **输出**：`filtered_papers.json`（精简后的高相关文献列表，含 arXiv ID 与 PDF 链接）。

### 步骤 4：PDF 下载 (PDF Download)

- **技能调用**：[`mas4s-literature-download`](file:///Users/admin/clawd/skills/mas4s-literature-download/SKILL.md)
- **输入**：`filtered_papers.json` 中的 PDF 链接列表。
- **作用**：并发批量下载降噪后的候选论文 PDF 文件至本地工作区。强制校验下载完整性，死链或无法访问的文献直接标记丢弃。
- **输出**：下载完成的 PDF 文件集合。为了便于集中管理，每篇论文按 arXiv ID 建立独立子目录，存放于 `~/.openclaw/workspace-<agentId>/task/<run_id>/papers/<arXiv.ID>/`。

### 步骤 5：PDF 转 Markdown (PDF to Markdown)

- **技能调用**：[`mas4s-literature-parse`](file:///Users/admin/clawd/skills/mas4s-literature-parse/SKILL.md)
- **输入**：步骤 4 下载的 PDF 文件。
- **作用**：逐篇将 PDF 转换为结构化 Markdown 文本，保留章节标题、公式、表格等结构信息，为后续精读与提取提供标准化的文本输入。
- **输出**：每篇论文对应一份 Markdown 文件，保存至该论文的专用子目录：`~/.openclaw/workspace-<agentId>/task/<run_id>/papers/<arXiv.ID>/`。

### 步骤 6：逐篇深度解析 (Per-Paper Deep Analysis)

> 按"认知上下文"将 6 个目标字段拆分为 3 个独立 Skill 并行执行，每个 Skill 独立落盘，最后由步骤 7 图谱聚合与全景审计节点进行 Merge。

**输入（三个 Skill 共用）**：步骤 5 产出的单篇 Markdown 文本及 PI 核心假说。

**逐篇执行**：三个 Skill 对每篇论文**并发**独立触发（默认并发数为 16），每篇三个输出文件（JSON）均实时保存至该论文的专用子目录：`~/.openclaw/workspace-<agentId>/task/<run_id>/papers/<arXiv.ID>/`。

#### Skill A：宏观态势探针 (Macro Probe Skill)

- **技能调用**：[`mas4s-literature-probe`](file:///Users/admin/clawd/skills/mas4s-literature-probe/SKILL.md)
- **负责字段**：`发表元信息`、`理论基础`、`一句话公式`、`提纯摘要`
- **认知深度**：浅层抽象。快速抓取核心定位与理论脉络，作为防御“课题被抢发”的先头部队。
- **输出**：`paper_macro_feature.json`（含 `is_published`, `research_objective`, `theoretical_basis`, `one_sentence_formula`, `refined_abstract`）

  | 字段                     | 说明                                                          |
  | :----------------------- | :------------------------------------------------------------ |
  | **is_published**         | 标记该预印本是否经过正式发表（期刊/会议），用于特征表元信息。 |
  | **research_objective**   | 一句话总结研究目标，用于拼凑领域全景。                        |
  | **theoretical_basis**    | 识别文章借用的经典理论或视角，作为综述主干。                  |
  | **one_sentence_formula** | “用 [方法A] 解决 [问题B]，以揭示 [规律/目标C]”的硬核逻辑。    |
  | **refined_abstract**     | 提炼核心贡献、数据集、指标与结论的 3 句话逻辑链。             |

#### Skill B：硬核解构引擎 (Technical Deconstruction Skill)

- **技能调用**：[`mas4s-literature-deconstruct`](file:///Users/admin/clawd/skills/mas4s-literature-deconstruct/SKILL.md)
- **负责字段**：`核心构念`、`实验范式`、`测量工具`、`量化结果`、`算法细节`
- **认知深度**：深层逻辑链。将论文解构为可复用的实验组件与量化证据，指导我方变量设计。
- **输出**：`paper_technical_details.json`（含 `core_constructs`, `empirical_design`, `measurement_tools`, `key_findings`, `algorithm`）

  | 字段                  | 说明                                                  |
  | :-------------------- | :---------------------------------------------------- |
  | **core_constructs**   | 提取自变量、因变量、中介/调节变量及其操作化定义。     |
  | **empirical_design**  | 提取实验/模拟范式、被试特征、样本量、因子设计。       |
  | **measurement_tools** | 提取量表、行为指标、信效度及关键测量工具。            |
  | **key_findings**      | 提取统计显著结果、效应大小（Effect Size）及意外发现。 |
  | **algorithm**         | 提取论文提出或使用的核心算法、模型架构及关键超参数.   |

#### Skill C：价值批判专家 (Critical Review Skill)

- **技能调用**：[`mas4s-literature-critique`](file:///Users/admin/clawd/skills/mas4s-literature-critique/SKILL.md)
- **负责字段**：`设计启示`、`局限审计`、`优劣势分析`、`技术边界`
- **认知深度**：深度评价与批判。专注于主观启发价值：判断该文献是否可为课题突破口，以及其致命缺陷是否代表了研究机会。
- **输出**：`paper_critical_review.json`（含 `direct_inspiration`, `limitations_and_future_work`, `pros_and_strengths`, `cons_and_weaknesses`, `boundary_limitations`）

  | 字段                            | 说明                                                  |
  | :------------------------------ | :---------------------------------------------------- |
  | **direct_inspiration**          | 具体产出：可复用的范式、需控制的变量、改进的刺激材料. |
  | **limitations_and_future_work** | 作者承认的不足或发现的逻辑漏洞，标记研究的创新切入点. |
  | **pros_and_strengths**          | 识别文献真正的核心优势（非广告语）.                   |
  | **cons_and_weaknesses**         | 挖掘根本性缺陷或存疑的假设.                           |
  | **boundary_limitations**        | 探测技术失效的特定边界条件，为可行性推演提供风险基准. |

### 步骤 7：文献全景合成与图谱构建中枢 (Literature Base Synthesizer) (Map-Reduce 增强版)

- **技能调用**：[`mas4s-literature-synthesize`](file:///Users/admin/clawd/skills/mas4s-literature-synthesize/SKILL.md)
- **输入**：步骤 6 三个 Skill 产出的每篇论文的结构化 JSON 集，以及 PI 核心假说。
- **作用**：扮演“文献全景合成建筑师”与“情报分发中枢”角色。采用 **Map-Reduce 架构** 处理大规模文献，产出“三位一体”交付物：
  - **可视化图谱 (Graph)**：构建符合前端标准的 `nodes` 和 `edges`，呈现技术流派的演进、继承与对抗关系。
  - **理论框架 (Framework)**：基于“构念池-命题集-机制链-路径图”四步法建构，解释实验现象的逻辑结构。
  - **机器数据源 (Feeds)**：输出强类型 JSON，为阶段 3 推演提供基准 (Baselines) 与工程瓶颈数组。
  - **文献特征表 (Synthesis Table)**：生成纵向对比的学术台账（输出中英双语的 md 与 json 共 4 份文件），供人类 PI 审计。
- **核心审计与探测**：
  - **抢发风险探测 (Scooped Check)**：对比 PI 假说与图谱，若发现 100% 撞车，触发 `SCOOPED` 警报并提供 Pivot 建议。
  - **双语双轨落盘**：严格输出 `literature_graph_en.json` (驱动后续阶段) 与 `_cn.json` (前端展示)。
- **输出**：`literature_graph.json` (完整包)、`literature_visualization_graph_*.json` (独立图谱数据)、`literature_synthesis_table_*.md/json` (4份特征表)、`literature_references.bib` (标准 BibTeX 引用数据库) 及人机共读审计报告。
- **HITL 机制**：生成的全景将挂起状态机，等待人类 PI 进行 `[Approve/Retry/Rollback]` 决策。

#### 附：理论框架的设计规范 (Theoretical Framework Design)

理论框架不是文献的堆砌，而是**解释你的实验现象的逻辑结构**。它由多次从特征表中涌现的模式构建而成。

**1. 从特征表到框架的建构路径（四步法）**

- **第一步：聚类概念，画出构念池**
  把“核心构念”列中所有变量剥离出来，按角色分类（前因、核心过程、结果、边界条件），合并同义词，得到约 10-25 个标准化构念.
- **第二步：识别关系，形成命题集**
  从“关键发现”列中，提取变量间的关系反复出现的正/负向关系，写成可检验的命题，例如：
  > _P1：任务相似度正向影响早期学习速度，但负向影响长期记忆留存（时间×相似度的交互）. _
  > _P2：当反馈延迟时，P1 中的交互作用被调节，高相似度的负效应消失. _
- **第三步：引入边界与机制，确立理论模型**
  将“调节变量”（边界条件）和“解释机制”（为何发生）放入框架，形成完整的逻辑链条. 用一段话说明：
  > _基于信息瓶颈理论，任务相似度过高会导致共享表征过度压缩，牺牲特定任务的细节留存（机制）. 而交替训练可视为强行插入去相关噪声，降低压缩压力. 当反馈延迟降低学习率时，这种压缩得到缓解（边界）. _
- **第四步：图示化，成为论文的核心模型图**
  将模型画成带箭头的路径图，标注出构念、假设 H1/H2、机制与边界，这就是你实验设计和论文 Hypothesis Development 部分的核心蓝图.

**2. 理论框架如何直接指导实验和写作**

- **实验设计**：模型的每一个箭头就是一个待检验的假设，确定你要操纵谁、测量谁、控制谁. 调节变量决定了你需要设计什么区组或连续条件.
- **论文撰写**：
  - **引言**：用框架中的“矛盾”或“空白”引出问题.
  - **文献综述**：围绕框架中的构念分层论述（先谈自变量，再谈因变量，再谈两者间的机制与争议），引用特征表中已发表文献.
  - **假设推演**：严格按照框架中命题的逻辑顺序，逐条论证为 H1, H2, H3a, H3b.
  - **方法**：框架决定了你需要复现的范式、测量工具和对照条件.
  - **讨论**：将结果映射回框架图示中每一条路径是否被支持，解释冲突.

#### 附：文献特征表的设计规范 (Literature Characterization Table Design)

这张表的核心目的是将每篇论文“拆解”成可比较、可统计的标准化信息，便于你发现领域内通用的变量、方法、争议点和空缺。

**1. 表格的核心维度（每一列）**

建议包含以下四大类栏目，可根据研究领域微调：

| 类别         | 栏目名称                    | 提取重点与用途                                                                                                     |
| ------------ | --------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| **元信息**   | 作者/年份/arXiv ID          | 唯一标识，便于回溯. **务必注明 v1/v2 等版本号**（arXiv 文章会更新）.                                               |
|              | 是否已正式发表（期刊/会议） | 标记该预印本是否经过同行评审，后续分析时可加权参考.                                                                |
| **理论核心** | 研究问题/目标               | 一句话总结，用于拼凑领域全景.                                                                                      |
|              | 核心构念与定义              | 自变量、因变量、中介/调节变量是什么？如何操作化定义？——直接指导你的实验变量设计.                                   |
|              | 理论视角/基础               | 文章借用了哪个经典理论（如认知负荷理论、社会交换理论）？这些理论会成为你论文文献综述的主干.                        |
| **方法实证** | 研究范式/实验设计           | 属于观察性、调查、真实验、计算模拟还是田野实验？被试特征、样本量、因子设计（如 2×2 区组）是什么？——直接模仿或改进. |
|              | 测量工具/指标               | 用了哪些量表、行为指标、生理记录装置？信效度如何？——直接选取你的测量工具.                                          |
|              | 关键发现/效应量             | 统计上显著的结果、效应大小（d/η²）、意外发现或零结果. **零结果和负结果同样重要**，能帮你避坑.                      |
| **启示反哺** | 对我的实验设计的直接启示    | 具体写出：我可以复用哪个范式？该控制哪个变量？怎样改进刺激材料？                                                   |
|              | 局限性与未来工作            | 作者自己承认的不足，或者你发现的逻辑漏洞——这是你研究的**机会点和创新切入点**.                                      |

> **提取技巧**：从摘要提取“问题-方法-结果”，从引言最后一段提取“假设/理论”，从方法与图表脚注提取“指标和效应量”，从讨论前半部分提取“直接启示”，从局限性段落提取“未来工作”.

**2. 文献特征表示例（实际应纵向排列）**

| 栏目           | 内容示例                                                                                |
| -------------- | --------------------------------------------------------------------------------------- |
| **arXiv 信息** | Doe et al. (2026) arXiv:2301.00001v2 · 未正式发表                                       |
| **研究问题**   | 多任务学习中共享表示对灾难性遗忘的影响                                                  |
| **核心构念**   | IV：任务相似度（余弦距离）；DV：旧任务准确率降幅；中介：特征泛化梯度                    |
| **理论基础**   | 信息瓶颈理论、弹性权重巩固                                                              |
| **实验设计**   | 模拟任务系列，组内：训练序列（交替/集中）× 任务相似度（高/低），被试内平衡              |
| **关键发现**   | 高相似度+交替训练使遗忘减少18%，但学习速度下降（η²=0.14）；极低相似度下集中训练反而更好 |
| **对我的启示** | 采用交替训练范式；将“任务相似度”作为操作检查指标；预注册时需考虑学习速度-遗忘的权衡     |
| **局限/机会**  | 仅用人工合成任务；未考虑情感动机影响——**我的实验可引入真实场景和动机变量**              |

> 若在图谱审计中发现已有论文完全覆盖 PI 假说的核心贡献，Agent 将立即触发 `SCOOPED` 警报并暂停流程，将该发现连同“避坑指南”及“转向建议 (Pivot Suggestion)”上报用户，由用户决定是否**回滚至阶段 1**重新选题，或调整方向后继续.

## 3. SOP 观测方案 (Observation)

Agent 的执行过程在 AIEMAS 平台中是透明可观测的：

- **步骤追踪**：前端通过 [SOP 定义](../../../docs/concepts/agent-workspace.md) 实时显示当前所处阶段.
- **进度日志**：每个技能在执行时会产生 `progress.jsonl`，前端可实时观测其内部进度.
- **详细方案**：参考 [Agent SOP 观测方案](../agent_sop_observation.md)。

### 3.1 Skill 改造要求 (Skill Modification Requirements)

为了支持 Agent 多次运行 SOP 流程并确保进度观测的隔离性，本 Agent 使用的所有核心 Skill 必须完成以下改造：

- **集成 ProgressReporter**：使用 `lib.progress` 模块，在执行的关键节点上报进度.
- **支持 run_id 参数 (必需)**：Skill 必须接收 `run_id` 命令行参数.
  - **作用**：用于物理隔离不同次执行的进度文件.
  - **逻辑**：如果传入了 `run_id`，进度文件路径应包含该 ID，例如：`~/.openclaw/workspace-<agentId>/task/<run_id>/progress_<skill>.jsonl`.
  - **参考**：参见 [`pdf_to_markdown` 技能定义](file:///Users/admin/clawd/skills/pdf_to_markdown/SKILL.md) 中的 `run_id` 参数规范.
- **标准化进度行**：上报的 JSONL 行 must 包含正确的 `type` (start/item/log/done) 及 `skill` 字段，确保后端 `ProgressWatcher` 能够正确解析并广播.
- **逐篇进度上报 (步骤 6 专项)**：步骤 6 三个 Skill（Macro Probe、Technical Deconstruction、Critical Review）须各自在每篇论文处理开始与完成时上报进度行，`item` 字段包含论文 arXiv ID，`skill` 字段区分来源 Skill，支持前端实时展示逐篇、分 Skill 的处理进度.
- **支持增量执行与强制重新执行 (仅限分析类技能)**：除步骤 7 的图谱聚合技能外，所有论文处理类 Skill 必须支持通过 `force` 参数控制执行逻辑. 如果目标 JSON 结果文件已存在且 `force` 为 `false`，则跳过分析（增量模式）；如果 `force` 为 `true`，则强制重新分析并覆盖原文件. 步骤 7 技能由于逻辑复杂，暂不要求增量支持，每次运行均全量重新合成.

## 4. 相关文档 (Related Docs)

- [Agent 定义](../../../docs/concepts/agent.md)
- [双锚点科研 SOP 总览](./science_assistant.md)
- [阶段 1：Topic Agent](./science_assistant_1topic.md)
- [阶段 3：Design Agent](./science_assistant_3design.md)
