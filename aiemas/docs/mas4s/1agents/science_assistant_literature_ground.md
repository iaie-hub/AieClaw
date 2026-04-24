# 事实定标与文献底座 Agent (Science Assistant: Literature Ground)

## 1. 概述 (Overview)

**Science Assistant: Literature Ground** 是专门用于事实定标与文献底座构建的智能 Agent。其核心目标是接收阶段 1 产出的科研课题定义（`principal_investigate_result.json`），通过系统化的 SOP 流程，对目标方向进行深度文献挖掘、智能降噪、逐篇精读与结构化提取，最终聚合产出一个极其精炼、以知识图谱为载体的文献底座，为后续可行性推演提供扎实的事实基础。

该 Agent 遵循"提取核心算法与机制，构建图谱"的核心目标，通过迭代式检索-降噪-深析-聚合的闭环，确保底座中的每一篇文献都与 PI 假说强相关，杜绝"垃圾文献污染"。

## 2. 核心 SOP 流程 (Standard Operating Procedure)

Agent 严格遵循以下七步 SOP 流程执行任务：

### 步骤 1：文献底座输入 (Literature Ground Ingest)

- **输入**：接收阶段 1 输出的科研课题定义文件 `pi_result.json`，包含课题标题、核心假说、合成逻辑及文献检索关键词列表。
- **动作**：解析 PI 结果，提取核心假说与关键词矩阵，作为后续学术检索的基础锚点。

### 步骤 2：学术检索 (arXiv Search)

- **技能调用**：[`mas4s-literature-ground-arxiv-search`](file:///Users/admin/clawd/skills/mas4s-literature-ground-arxiv-search/SKILL.md) (参考：[技能文档](../1skills/mas4s_literature_ground_arxiv_search.md))
- **输入**：从 `pi_result.json` 中提取的文献检索关键词。
- **作用**：以 PI 假说为锚点，在 arXiv 学术数据库中进行精准检索，获取与课题方向强相关的最新论文列表及摘要（`arxiv_search_results.json`）。
- **输出**：`arxiv_search_results.json`（含论文标题、摘要、arXiv ID、PDF 链接）。
- **注意**：若步骤 7 图谱审查后存在知识盲区，可携带补充关键词**回滚至本步骤**重新检索，形成闭环迭代。

### 步骤 3：智能降噪 (Intelligent Noise Reduction)

- **技能调用**：[`mas4s-literature-ground-noise-reduction`](file:///Users/admin/clawd/skills/mas4s-literature-ground-noise-reduction/SKILL.md) (参考：[技能文档](../1skills/mas4s_literature_ground_noise_reduction.md))
- **输入**：`arxiv_search_results.json`（摘要列表）及 PI 核心假说。
- **作用**：基于摘要对每篇论文与 PI 假说的相关性进行初步评估，自动剔除不相关的边缘文献，合并反复啰嗦的同类研究。保留通过相关性阈值的高质量候选文献列表。
- **输出**：`filtered_papers.json`（精简后的高相关文献列表，含 arXiv ID 与 PDF 链接）。

### 步骤 4：PDF 下载 (PDF Download)

- **技能调用**：[`mas4s-literature-ground-pdf-download`](file:///Users/admin/clawd/skills/mas4s-literature-ground-pdf-download/SKILL.md) (参考：[技能文档](../1skills/mas4s_literature_ground_pdf_download.md))
- **输入**：`filtered_papers.json` 中的 PDF 链接列表。
- **作用**：并发批量下载降噪后的候选论文 PDF 文件至本地工作区。强制校验下载完整性，死链或无法访问的文献直接标记丢弃。
- **输出**：下载完成的 PDF 文件集合。为了便于集中管理，每篇论文按 arXiv ID 建立独立子目录，存放于 `~/.openclaw/workspace-<agentId>/task/<run_id>/papers/<arXiv.ID>/`。

### 步骤 5：PDF 转 Markdown (PDF to Markdown)

- **技能调用**：[`mas4s-literature-ground-pdf-to-markdown`](file:///Users/admin/clawd/skills/mas4s-literature-ground-pdf-to-markdown/SKILL.md) (参考：[技能文档](../1skills/mas4s_literature_ground_pdf_to_markdown.md))
- **输入**：步骤 4 下载的 PDF 文件。
- **作用**：逐篇将 PDF 转换为结构化 Markdown 文本，保留章节标题、公式、表格等结构信息，为后续精读与提取提供标准化的文本输入。
- **输出**：每篇论文对应一份 Markdown 文件，保存至该论文的专用子目录：`~/.openclaw/workspace-<agentId>/task/<run_id>/papers/<arXiv.ID>/`。

### 步骤 6：逐篇深度解析 (Per-Paper Deep Analysis)

> 按"认知上下文"将 6 个目标字段拆分为 3 个独立 Skill 并行执行，每个 Skill 独立落盘，最后由步骤 7 图谱聚合节点进行 Merge。

**输入（三个 Skill 共用）**：步骤 5 产出的单篇 Markdown 文本及 PI 核心假说。

**逐篇执行**：三个 Skill 对每篇论文**并发**独立触发，每篇三个输出文件（JSON）均实时保存至该论文的专用子目录：`~/.openclaw/workspace-<agentId>/task/<run_id>/papers/<arXiv.ID>/`。

#### Skill A：宏观态势探针 (Macro Probe Skill)

- **技能调用**：[`mas4s-literature-ground-macro-probe`](file:///Users/admin/clawd/skills/mas4s-literature-ground-macro-probe/SKILL.md) (参考：[技能文档](../1skills/mas4s_literature_ground_macro_probe.md))
- **负责字段**：`一句话公式描述`、`摘要（提炼版）`
- **认知深度**：浅层抽象。快速抓取核心定位，作为防御"课题被抢发"的先头部队。两个字段均属高度概括，天然共享同一认知上下文。
- **输出**：`paper_macro_feature.json`（含 `one_sentence_formula`、`summary` 两个字段）

  | 字段                     | 格式说明                                             |
  | :----------------------- | :--------------------------------------------------- |
  | **one_sentence_formula** | "用 \[方法A\] 解决 \[问题B\]，以揭示 \[规律/目标C\]" |
  | **summary**              | 提炼论文核心贡献、数据集、评价指标与结论的精简摘要。 |

#### Skill B：硬核解构引擎 (Technical Deconstruction Skill)

- **技能调用**：[`mas4s-literature-ground-technical-deconstruction`](file:///Users/admin/clawd/skills/mas4s-literature-ground-technical-deconstruction/SKILL.md) (参考：[技能文档](../1skills/mas4s_literature_ground_technical_deconstruction.md))
- **负责字段**：`算法提取`、`实验方法提取`、`实验结果提取`
- **认知深度**：深层逻辑链。三者构成严密的因果链（采用 A 算法 → 设计 B 实验 → 得到 C 结果），必须由同一大模型在同一 Context 下处理，以确保内部逻辑自洽，避免算法与结果"牛头不对马嘴"。
- **输出**：`paper_technical_details.json`（含 `algorithm`、`experiment_method`、`experiment_result` 三个字段）

  | 字段                  | 说明                                                                |
  | :-------------------- | :------------------------------------------------------------------ |
  | **algorithm**         | 提取论文中提出或使用的核心算法、模型架构及关键超参数。              |
  | **experiment_method** | 提取实验设计、数据集、评价指标及对照组配置。                        |
  | **experiment_result** | 提取关键量化结果（含 SOTA 对比数据）及其对 PI 假说的支撑/反驳关系。 |

#### Skill C：价值批判专家 (Critical Review Skill)

- **技能调用**：[`mas4s-literature-ground-critical-review`](file:///Users/admin/clawd/skills/mas4s-literature-ground-critical-review/SKILL.md) (参考：[技能文档](../1skills/mas4s_literature_ground_critical_review.md))
- **负责字段**：`精读（Pros/Cons/局限性）`
- **认知深度**：深度评价与批判。剥离 Skill B 的客观事实抽取，专注于主观评价：判断该文献对 PI 假说的启发价值，以及其致命缺陷是否可作为课题突破口。
- **输出**：`paper_critical_review.json`（含 `pros`、`cons`、`limitations`、`relevance_to_pi` 四个字段）

### 步骤 7：图谱聚合与审查 (Knowledge Graph Aggregation & Review)

- **技能调用**：[`mas4s-literature-ground-knowledge-graph`](file:///Users/admin/clawd/skills/mas4s-literature-ground-knowledge-graph/SKILL.md) (参考：[技能文档](../1skills/mas4s_literature_ground_knowledge_graph.md))
- **输入**：步骤 6 三个 Skill 产出的每篇论文的 `paper_macro_feature.json`、`paper_technical_details.json`、`paper_critical_review.json`，以及 PI 核心假说。
- **作用**：将所有论文的结构化知识条目聚合为统一的文献知识图谱（`literature_graph.json`），执行以下审查：
  - 识别支撑 PI 假说的正向证据链与反驳证据。
  - 标记知识空白区域，生成补充检索建议。
  - 检测是否存在已完全覆盖 PI 假说的论文（**课题被抢发 Scooped** 检测）。
- **输出**：`literature_graph.json`（知识图谱）及 `literature_ground_report.md`（人类可读的文献底座报告）。
- **Feedback 循环**：若图谱存在明显知识盲区，携带补充关键词**回滚至步骤 2**重新扩展检索，直至底座完整。

> **人类锚点：课题被抢发 (Scooped)**
>
> 若在图谱审查中发现已有论文完全覆盖 PI 假说的核心贡献，Agent 将立即触发 `SCOOPED` 警报并暂停流程，将该发现连同"避坑指南"上报用户，由用户决定是否**回滚至阶段 1**重新选题，或调整方向后继续。

## 3. SOP 观测方案 (Observation)

Agent 的执行过程在 AIEMAS 平台中是透明可观测的：

- **步骤追踪**：前端通过 [SOP 定义](../../../docs/concepts/agent-workspace.md) 实时显示当前所处阶段。
- **进度日志**：每个技能在执行时会产生 `progress.jsonl`，前端可实时观测其内部进度。
- **详细方案**：参考 [Agent SOP 观测方案](../agent_sop_observation.md)。

### 3.1 Skill 改造要求 (Skill Modification Requirements)

为了支持 Agent 多次运行 SOP 流程并确保进度观测的隔离性，本 Agent 使用的所有核心 Skill 必须完成以下改造：

- **集成 ProgressReporter**：使用 `lib.progress` 模块，在执行的关键节点上报进度。
- **支持 run_id 参数 (必需)**：Skill 必须接收 `run_id` 命令行参数。
  - **作用**：用于物理隔离不同次执行的进度文件。
  - **逻辑**：如果传入了 `run_id`，进度文件路径应包含该 ID，例如：`~/.openclaw/workspace-<agentId>/task/<run_id>/progress_<skill>.jsonl`。
  - **参考**：参见 [`pdf_to_markdown` 技能定义](file:///Users/admin/clawd/skills/pdf_to_markdown/SKILL.md) 中的 `run_id` 参数规范。
- **标准化进度行**：上报的 JSONL 行必须包含正确的 `type` (start/item/log/done) 及 `skill` 字段，确保后端 `ProgressWatcher` 能够正确解析并广播。
- **逐篇进度上报 (步骤 6 专项)**：步骤 6 三个 Skill（Macro Probe、Technical Deconstruction、Critical Review）须各自在每篇论文处理开始与完成时上报进度行，`item` 字段包含论文 arXiv ID，`skill` 字段区分来源 Skill，支持前端实时展示逐篇、分 Skill 的处理进度。

## 4. 相关文档 (Related Docs)

- [Agent 定义](../../../docs/concepts/agent.md)
- [Agent 工作区](../../../docs/concepts/agent-workspace.md)
- [技能文档索引](../1skills/)
- [阶段 1：Idea Align Agent](./science_assistant_literature_ground.md)
- [双锚点科研 SOP 总览](./science_assistant.md)
