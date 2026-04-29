## 宏观态势探针 Skill (Macro Probe Skill) 设计方案

### 一、 设计理念

1.  **快速定性**：作为文献深析的第一梯队，旨在以极小的计算开销建立对文献的“宏观初印象”。
2.  **公式化抽象**：强制模型使用统一的“一句话公式”描述，消除语言风格差异，便于跨论文对比。
3.  **Scooped 预警**：快速识别论文核心目标，判断是否与 PI 假说发生直接碰撞（被抢发）。

### 二、 设计方案

该 Skill 专注于浅层抽象，从 Title、Abstract 和 Introduction 中提取核心逻辑。

| 负责字段                 | 说明                                           | 认知深度 |
| :----------------------- | :--------------------------------------------- | :------- |
| **one_sentence_formula** | "用 [方法A] 解决 [问题B]，以揭示 [规律/目标C]" | 极简抽象 |
| **refined_abstract**     | 3 句话精简摘要（背景/Gap -> 方案 -> 结论）     | 中层概括 |

### 三、 实现流程

| 步骤 | 动作     | 说明                                                    |
| :--- | :------- | :------------------------------------------------------ |
| 1    | 数据加载 | 读取 `parsed_papers.json` 及 PI 核心假说。              |
| 2    | 逐篇精炼 | 针对每篇论文的 Markdown 全文进行宏观特征提取。          |
| 3    | 结果落盘 | 在论文 arXiv ID 目录下生成 `paper_macro_feature.json`。 |

### 四、 输入参数

| 参数名             | 类型   | 必填 | 默认值       | 说明              |
| :----------------- | :----- | :--- | :----------- | :---------------- |
| **run_id**         | String | 是   | -            | 执行 ID。         |
| **agent_id**       | String | 否   | "evidence"   | 当前 Agent ID。   |
| **input_agent_id** | String | 否   | "idea-align" | 阶段 1 Agent ID。 |

**输入文件 1**：`~/.openclaw/workspace-idea-align/task/{run_id}/pi_result.json`
**输入文件 2**：`~/.openclaw/workspace-evidence/task/{run_id}/parsed_papers.json`

### 五、 输出参数

**输出文件**：`~/.openclaw/workspace-evidence/task/{run_id}/papers/{arxiv_id}/paper_macro_feature.json`

| 字段名                   | 类型   | 说明                       |
| :----------------------- | :----- | :------------------------- |
| **one_sentence_formula** | String | 一句话公式描述。           |
| **refined_abstract**     | String | 提炼后的精简摘要（中文）。 |
| **chain_of_thought**     | Object | 三步思维链推演。           |

### 六、 示例

#### 6.1 运行示例

```bash
python3 scripts/mas4s_evidence_deep_analysis_macro_probe.py '{"run_id": "run_222"}'
```

#### 6.2 输出示例 (`paper_macro_feature.json`)

```json
{
  "chain_of_thought": {
    "step_1_noise_reduction": "...",
    "step_2_triad_extraction": "...",
    "step_3_abstract_condensation": "..."
  },
  "macro_features": {
    "one_sentence_formula": "用生物启发式的选择性遗忘框架解决 LLM Agent 内存管理冗余问题，以揭示内存裁剪与安全性之间的平衡规律。",
    "refined_abstract": "针对 LLM Agent 内存管理中忽视遗忘机制导致效率低下的问题，本文提出了 FSFM 框架。通过模拟人类海马体索引与遗忘曲线，实现了被动衰减与主动删除的结合。实验证明该方法显著提升了访问效率并消除了安全风险。"
  }
}
```

### 七、 Prompt

【Role Definition】
You are an elite "Scientific Sentinel" (科研哨兵) and "Macro Intelligence Probe". Your mission is to rapidly scan full-text academic papers and extract their highest-level cognitive features. You act as the first line of defense against the "Scooped" (课题已被抢发) risk. You do not care about minor experimental details; you only care about the core "Method", "Problem", and "Ultimate Objective".

【Downstream Handover Protocol】
Your output will be merged into a Knowledge Graph and presented to a human Principal Investigator (PI) for a rapid "Scoop Check". Therefore:

1. Your output must be highly condensed and strictly objective.
2. You MUST strictly adhere to the JSON schema provided below. Do not alter the key names or structure.
3. Output ONLY a valid JSON object. Do not wrap it in markdown code blocks (e.g., ```json) and do not include any preamble or conversational text. Your output MUST start exactly with "{{" and end exactly with "}}".
4. Ensure all double quotes within your string values are properly escaped (e.g., \") to prevent JSON parsing errors.

【Input Information】

1. Paper Full Text (Markdown): {paper_markdown_text}

【Execution Protocol & Chain of Thought】
You MUST conduct a rigorous 3-step Chain of Thought within the `"chain_of_thought"` JSON object.
_CRITICAL ATTENTION RULE_: Since you are receiving the full text, you MUST prioritize information found in the `Title`, `Abstract`, and `Introduction`. Ignore deep mathematical proofs or hyper-specific experimental configurations in the later sections.

- **Step 1: Noise Reduction & Targeting (降噪与锚定):** Briefly state which sections of the text you are extracting the core logic from.
- **Step 2: Triad Extraction (三元提取):** Explicitly isolate the three core variables:
  - [方法A / Method A]: What is the core proposed algorithm, framework, or intervention?
  - [问题B / Problem B]: What is the exact bottleneck or gap being addressed?
  - [规律/目标C / Objective C]: What is the ultimate theoretical finding, overarching goal, or performance plateau broken?
- **Step 3: Abstract Condensation (摘要提纯):** Strip away the fluff from the original abstract. Synthesize a 3-sentence logic chain: (1) Background/Gap -> (2) Proposed Solution -> (3) Core Conclusion.

【Output Format Requirements】
Please strictly populate the values for the following JSON structure. The descriptions in the values below indicate what you should generate:

{{
  "chain_of_thought": {{
    "step_1_noise_reduction": "Identify the text regions holding the macro logic. (Explain in Chinese)",
    "step_2_triad_extraction": "Isolate Method A, Problem B, and Objective C. (Explain in Chinese)",
    "step_3_abstract_condensation": "Plan the 3-sentence logical flow for the refined abstract. (Explain in Chinese)"
  }},
"macro_features": {{
    "one_sentence_formula": "Summarize the core logic using EXACTLY this template: '用 [方法A] 解决 [问题B]，以揭示 [规律/目标C]。'. DO NOT deviate from this structure.",
    "refined_abstract": "A highly condensed, structured abstract (MAX 3 sentences). Sentence 1: The gap. Sentence 2: The method. Sentence 3: The defining conclusion. Use professional academic Chinese."
  }}
}}

【Language Output Constraint】
Even though the instructions and JSON keys are in English, the string VALUES within the JSON MUST be generated entirely in professional academic Chinese (Mandarin), keeping only necessary English academic terms in parentheses.

### 八、 SOP 观测支持

- **进度上报**：按论文逐篇上报 `item`。
- **进度文件路径**：`~/.openclaw/workspace-<agentId>/task/<run_id>/progress_mas4s_macro_probe.jsonl`
