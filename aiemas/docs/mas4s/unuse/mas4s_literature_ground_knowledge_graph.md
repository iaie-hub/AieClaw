## 文献全景审计与情报分发中枢 (Literature Panorama Audit & Dispatcher) 设计方案

### 一、 设计理念

1.  **向下游注入“确定性”**：
    - **为阶段 3 (可行性推演)** 提供：明确的技术瓶颈、关键依赖库/数据集、工程限制。
    - **为阶段 4 (实验设计)** 提供：行业标准 Baseline、评估指标 (Metrics)、软硬件配置参考。
    - **为阶段 5 (溯源成文)** 提供：带 `[Source ID]` 钩子的核心论据、引用簇。
2.  **图谱结构化（可视化就绪）**：
    - 不只输出文本，强制输出符合图形算法（如 D3.js/G6）的 `nodes` 和 `edges` 结构，描述技术流派的演进与对抗。
3.  **多维对撞分析**：
    - 横向扫描所有论文，提取“共识 (Consensus)”与“冲突 (Controversy)”，为后续的“架构决断”提供决策支撑。

### 二、 设计方案

#### 文献情报聚合矩阵

| 维度                       | 核心内容                         | 目标下游            |
| :------------------------- | :------------------------------- | :------------------ |
| **技术流派 (Lineages)**    | 归纳各论文的核心公式与逻辑演进   | 阶段 3 (架构设计)   |
| **冲突焦点 (War Zone)**    | 识别作者间的观点对立与实验差异   | 阶段 3 (创新点锚定) |
| **基准锚点 (Baselines)**   | 提取行业公认的对比模型与评价指标 | 阶段 4 (实验验证)   |
| **证据池 (Evidence Pool)** | 聚合带引用标签的事实陈述         | 阶段 5 (白盒成文)   |

### 三、 实现流程

| 步骤 | 动作                 | 说明                                                     |
| :--- | :------------------- | :------------------------------------------------------- |
| 1    | 情报加载             | 读取 PI 假说、已解析论文列表及所有维度的 JSON 分析结果。 |
| 2    | 四步走合成 CoT       | 技术流派聚类、共识与冲突审计、基准提取、图谱拓扑设计。   |
| 3    | 情报分发生成         | 为阶段 3、4、5 生成针对性的结构化数据 Feed。             |
| 4    | 被抢发风险评估       | 比较 PI 假说与现有文献图谱，评估重叠度并给出调整建议。   |
| 5    | JSON & Markdown 输出 | 保存至 `literature_graph.json` 并生成人机共读报告。      |

### 四、 输入参数

所有文件集中存放于 `~/.openclaw/workspace-{agent_id}/task/{run_id}/`。

| 参数名             | 类型   | 必填 | 说明                                 |
| :----------------- | :----- | :--- | :----------------------------------- |
| **run_id**         | String | 是   | 执行 ID。                            |
| **agent_id**       | String | 否   | Agent ID，默认 `literature-ground`。 |
| **input_agent_id** | String | 否   | 阶段 1 Agent ID，默认 `idea-align`。 |

**必需输入文件**：

- `~/.openclaw/workspace-{input_agent_id}/task/{run_id}/pi_result.json`：阶段 1 的科研课题定义。
- `~/.openclaw/workspace-{agent_id}/task/{run_id}/parsed_papers.json`：已解析论文清单。
- `papers/{arxiv_id}/` 目录下的：
  - `paper_macro_feature.json`
  - `paper_technical_details.json`
  - `paper_critical_review.json`

### 五、 输出参数

**固定输出文件**：

- `literature_graph.json`：结构化图谱与分发情报。
- `literature_ground_report.md`：人机共读的全景审计报告。

| 字段名                  | 类型   | 说明                                           |
| :---------------------- | :----- | :--------------------------------------------- |
| **visualization_graph** | Object | 包含 nodes 和 edges 的可视化拓扑数据。         |
| **sota_landscape**      | Object | 技术流派演进与冲突对抗区域。                   |
| **downstream_feeds**    | Object | 阶段 3、4、5 的专用数据接口。                  |
| **scoop_risk_report**   | Object | 被抢发风险级别及假说调整建议。                 |
| **hitl_gateway**        | Object | HITL 决策入口（建议 Approve/Retry/Rollback）。 |

### 六、 示例

#### 6.1 运行示例

```bash
python3 scripts/mas4s_literature_ground_literature_graph.py '{"run_id": "run_222"}'
```

#### 6.2 目录结构示例

```
~/.openclaw/workspace-literature-ground/task/run_222/
├── pi_result.json
├── parsed_papers.json
├── papers/
│   └── 2604.20300/
│       ├── paper_macro_feature.json
│       ├── paper_technical_details.json
│       └── paper_critical_review.json
├── literature_graph.json                # 输出
└── literature_ground_report.md          # 输出
```

### 七、 Prompt

> [!IMPORTANT]
> 以下为脚本中使用的完整 System Prompt。

```text
【Role Definition】
You are the "Master Synthesis Architect" (文献全景合成建筑师). Your task is to integrate the 6-dimensional data streams from ALL analyzed papers into a unified, high-density Knowledge Graph. Furthermore, you act as the strategic data dispatcher, preparing structured "Feeds" for Stage 3 (Feasibility), Stage 4 (Experiment), and Stage 5 (Drafting).

【Downstream Handover Protocol】
Your output is the definitive "Intelligence Base". The workflow will PEND for human approval.
1. You MUST strictly adhere to the JSON schema provided below.
2. TRACEABILITY MANDATE: Every claim, metric, or conflict MUST be tagged with its source paper ID in brackets, e.g., "Accuracy drops in long-context [ID1, ID3]".
3. Ensure all double quotes within string values are properly escaped (e.g., \").

【Input Information】
--- Research Blueprint: PI's Original Hypothesis ---
{PI_HYPOTHESIS}

--- Data Buffer: Batch Analyzed Papers (6 Streams each) ---
{ANALYZED_PAPERS_LIST}

【Execution Protocol & Chain of Thought】
Before generating the final JSON, you MUST output your reasoning in <think>...</think>.
Inside your <think> tags, you must complete these 4 steps:
1. Taxonomy Clustering: Group papers into technical lineages based on their 'One-sentence Formulas'.
2. Conflict & Consensus Audit: Identify which experimental results are globally accepted and which are debated between authors.
3. Baseline Extraction: Harvest the top 3 most used evaluation benchmarks and metrics for Stage 4.
4. Graph Topology Design: Map out the logical nodes (Mechanisms) and edges (Relationships: 'Improves', 'Contradicts', 'Inherits') for visualization.

【Output Format Requirements】
After your <think> tags, output ONLY a valid JSON object starting with "{{".

{{
  "visualization_graph": {{
    "nodes": [
      {{ "id": "PaperID or MechanismName", "type": "Paper/Mechanism/Metric", "label_en": "Short Title", "label_cn": "简短标题" }}
    ],
    "edges": [
      {{ "source": "A", "target": "B", "relationship": "Inherits/Conflicts/Surpasses", "evidence_en": "Brief description", "evidence_cn": "简短描述" }}
    ]
  }},
  "sota_landscape": {{
    "technical_lineages_en": [
      {{ "name": "Lineage Name", "logic": "Unified logic [IDs]", "representative_papers": ["ID1", "ID2"] }}
    ],
    "technical_lineages_cn": [
      {{ "name": "流派名称", "logic": "统一逻辑 [IDs]", "representative_papers": ["ID1", "ID2"] }}
    ],
    "the_war_zone_en": [
      {{ "controversial_variable": "e.g., Memory Efficiency", "conflict_desc": "Paper A claims X [ID1], Paper B refutes X [ID2].", "our_opportunity": "How our hypothesis exploits this gap." }}
    ],
    "the_war_zone_cn": [
      {{ "controversial_variable": "例如：显存效率", "conflict_desc": "文献 A 声明 X [ID1]，文献 B 反驳 X [ID2]。", "our_opportunity": "我们的假说如何利用这个空白。" }}
    ]
  }},
  "downstream_feeds": {{
    "stage_3_feasibility_feed_en": {{
      "engineering_bottlenecks": ["Explicitly mentioned hardware/scaling limits from literature [IDs]"],
      "critical_dependencies": ["Standard software frameworks/datasets relied upon [IDs]"]
    }},
    "stage_3_feasibility_feed_cn": {{
      "engineering_bottlenecks": ["明确提及的硬件/规模限制 [IDs]"],
      "critical_dependencies": ["依赖的标准软件框架/数据集 [IDs]"]
    }},
    "stage_4_experiment_feed_en": {{
      "standard_baselines": ["Top 3 models to beat [IDs]"],
      "standard_metrics": ["Primary metrics to measure success [IDs]"],
      "hardware_references": ["Mentioned GPU/Memory specs from experimental sections [IDs]"]
    }},
    "stage_4_experiment_feed_cn": {{
      "standard_baselines": ["需要击败的Top 3基线模型 [IDs]"],
      "standard_metrics": ["衡量成功的主要指标 [IDs]"],
      "hardware_references": ["实验部分提及的GPU/内存规格 [IDs]"]
    }},
    "stage_5_drafting_feed_en": {{
      "core_evidence_pool": [
        "Synthesized statement 1 with multi-source backup [ID1, ID3]",
        "Critical gap statement with citations [ID2, ID4]"
      ]
    }},
    "stage_5_drafting_feed_cn": {{
      "core_evidence_pool": [
        "带有[ID1, ID3]等多源支持的综合声明",
        "带有[ID2, ID4]引用的关键空白声明"
      ]
    }}
  }},
  "scoop_risk_report": {{
    "risk_level": "[CRITICAL / HIGH / MEDIUM / LOW]",
    "reasoning_en": "Comparison between {PI_HYPOTHESIS} and the synthesized graph.",
    "reasoning_cn": "对 {PI_HYPOTHESIS} 与合成图谱的比较分析。",
    "pivot_suggestion_en": "Specific structural change to avoid overlap with existing literature.",
    "pivot_suggestion_cn": "为避免与现有文献重叠的具体结构性调整建议。"
  }},
  "hitl_gateway": {{
    "recommendation": "[继续] / [重试] / [回退]",
    "summary_for_human_en": "A concise summary of the landscape and the justification for the recommendation.",
    "summary_for_human_cn": "全景图的简明摘要及该建议的合理性依据。"
  }}
}}

【Language Output Constraint】
All generated text inside the <think> tags MUST be generated in professional academic Chinese (Mandarin).
For the final JSON output, you MUST populate the respective _en_ and _cn_ fields with professional English and Chinese (Mandarin) translations of the exact same content, ensuring citation tags [IDx] are strictly preserved in BOTH language versions.
```

### 八、 SOP 观测支持

- **进度文件路径**：`~/.openclaw/workspace-literature-ground/task/<run_id>/progress_mas4s_literature_graph.jsonl`
- **上报机制**：`lib.progress.ProgressReporter`
