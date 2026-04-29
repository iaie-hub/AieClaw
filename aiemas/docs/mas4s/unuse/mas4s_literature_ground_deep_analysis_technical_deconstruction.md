## 硬核解构引擎 Skill (Technical Deconstruction Skill) 设计方案

### 一、 设计理念

1.  **客观还原**：剥离文献中的所有修辞，仅保留算法逻辑、实验配置与量化结果。
2.  **因果一致性**：确保提取出的算法改动与观察到的实验结果之间存在逻辑上的闭环。
3.  **标准化度量**：将零散的实验结论转化为可对比的 SOTA 状态与提升百分比，为知识图谱提供结构化数据。

### 二、 设计方案

该 Skill 专注于深层逻辑链，从 Methodology、Experiments 和 Results 章节中提取硬核细节。

| 负责字段                   | 说明                          | 认知深度   |
| :------------------------- | :---------------------------- | :--------- |
| **algorithm**              | 核心机制、数学突破与技术依赖  | 深层逻辑   |
| **experiment_methodology** | 数据集、基准模型与评价指标    | 实验复现层 |
| **experiment_results**     | SOTA 状态、量化提升与潜在代价 | 事实量化层 |

### 三、 实现流程

| 步骤 | 动作     | 说明                                                        |
| :--- | :------- | :---------------------------------------------------------- |
| 1    | 数据加载 | 读取 `parsed_papers.json` 及 PI 核心假说。                  |
| 2    | 硬核解构 | 针对每篇论文的 Markdown 全文进行技术细节解构。              |
| 3    | 结果落盘 | 在论文 arXiv ID 目录下生成 `paper_technical_details.json`。 |

### 四、 输入参数

| 参数名       | 类型   | 必填 | 默认值              | 说明            |
| :----------- | :----- | :--- | :------------------ | :-------------- |
| **run_id**   | String | 是   | -                   | 执行 ID。       |
| **agent_id** | String | 否   | "literature-ground" | 当前 Agent ID。 |

**输入文件**：`~/.openclaw/workspace-literature-ground/task/{run_id}/parsed_papers.json`

### 五、 输出参数

**输出文件**：`~/.openclaw/workspace-literature-ground/task/{run_id}/papers/{arxiv_id}/paper_technical_details.json`

| 字段名                     | 类型   | 说明                 |
| :------------------------- | :----- | :------------------- |
| **algorithm**              | Object | 算法核心与数学逻辑。 |
| **experiment_methodology** | Object | 实验设计与配置。     |
| **experiment_results**     | Object | 量化结果与改进度。   |

### 六、 示例

#### 6.1 运行示例

```bash
python3 scripts/mas4s_literature_ground_deep_analysis_technical_deconstruction.py '{"run_id": "run_222"}'
```

#### 6.2 输出示例 (`paper_technical_details.json`)

```json
{
  "chain_of_thought": {
    "step_1_algorithm_isolation": "...",
    "step_2_experimental_mapping": "...",
    "step_3_causal_verification": "..."
  },
  "technical_details": {
    "algorithm": {
      "core_mechanism": "引入海马体索引（Hippocampal Indexing）理论，通过向量索引管理长短期记忆。",
      "math_or_logic_breakthrough": "定义了基于 Ebbinghaus 遗忘曲线的动态权重衰减函数 $W(t) = e^{-t/S}$。",
      "dependencies": ["PyTorch", "Milvus", "Llama-3-70B"]
    },
    "experiment_methodology": {
      "datasets": ["GAIA Benchmark", "LongBench"],
      "baselines": ["Vanilla RAG", "MemGPT"],
      "metrics": ["Recall@K", "Latency", "VRAM Usage"]
    },
    "experiment_results": {
      "sota_status": "Yes",
      "quantified_improvement": "在长文本召回准确率上比 MemGPT 提升 12.4%，延迟降低 45ms。",
      "anomalies_or_tradeoffs": "计算初始权重时增加了约 5% 的预处理 CPU 开销。"
    }
  }
}
```

### 七、 Prompt

【Role Definition】
You are an elite "Technical Deconstruction Engine" (硬核解构引擎). Your mission is to dissect full-text academic papers like a surgeon, extracting the exact algorithmic mechanics, experimental methodologies, and quantified results. You are completely immune to academic fluff and marketing language; you care ONLY about math, code logic, data, and absolute metrics.

【Downstream Handover Protocol】
Your output forms the fundamental "objective truth" layer of the Knowledge Graph. It will be automatically parsed by a strictly typed system. Therefore:

1. You MUST strictly adhere to the JSON schema provided below.
2. Output ONLY a valid JSON object. Do not wrap it in markdown code blocks (e.g., ```json) and do not include any preamble text. Your output MUST start exactly with "{{" and end exactly with "}}".
3. Ensure all double quotes within your string values are properly escaped (e.g., \").

【Input Information】

1. Paper Full Text (Markdown): {paper_markdown_text}

【Execution Protocol & Chain of Thought】
You MUST conduct a rigorous 3-step Chain of Thought within the `"chain_of_thought"` JSON object.
_CRITICAL ATTENTION RULE_: Focus your extraction primarily on the `Methodology`, `Experiments`, and `Results` sections. Ignore literature reviews and philosophical discussions.

- **Step 1: Algorithm/Mechanism Isolation:** Locate the mathematical formulations, architecture diagrams, or core logical workflows. Define the exact components of the proposed solution.
- **Step 2: Experimental Mapping:** Locate the datasets, baseline models (comparisons), and evaluation metrics used to prove the algorithm's efficacy.
- **Step 3: Causal Verification:** Cross-check the results. Does the quantified improvement actually stem from the proposed algorithm? Are there any unexplainable anomalies in the data tables?

【Output Format Requirements】
Please strictly populate the values for the following JSON structure:

{{
  "chain_of_thought": {{
    "step_1_algorithm_isolation": "Locate and map the core mechanism. (Explain in Chinese)",
    "step_2_experimental_mapping": "Extract baselines, metrics, and datasets. (Explain in Chinese)",
    "step_3_causal_verification": "Verify if the results logically match the proposed method. (Explain in Chinese)"
  }},
"technical_details": {{
    "algorithm": {{
      "core_mechanism": "Precisely describe the algorithmic workflow or system architecture.",
      "math_or_logic_breakthrough": "What is the specific mathematical trick or logical constraint introduced?",
      "dependencies": ["List core frameworks, prior algorithms, or hardware relied upon (e.g., PyTorch, specific LLM, specific sensors)."]
    }},
"experiment_methodology": {{
      "datasets": ["Name of Dataset 1", "Name of Dataset 2"],
      "baselines": ["Name of Baseline Model 1", "Name of Baseline Model 2"],
      "metrics": ["Evaluation Metric 1", "Evaluation Metric 2"]
    }},
"experiment_results": {{
      "sota_status": "Did it achieve State-of-the-Art? (Yes/No/Partial)",
      "quantified_improvement": "Provide absolute numbers (e.g., 'Accuracy improved by 4.5% over Baseline X').",
      "anomalies_or_tradeoffs": "What price was paid for this improvement? (e.g., '10x higher VRAM usage', 'Latency increased'). If none stated, write '未明确报告代价'."
    }}
}}
}}

【Language Output Constraint】
All string VALUES within the JSON MUST be generated entirely in professional academic Chinese (Mandarin), keeping English technical terms in parentheses where appropriate.

### 八、 SOP 观测支持

- **进度上报**：按论文逐篇上报 `item`。
- **进度文件路径**：`~/.openclaw/workspace-<agentId>/task/<run_id>/progress_mas4s_technical_deconstruction.jsonl`
