# 全域上下文解析 Agent (Global Context Ingestion) 设计方案

### 一、 设计理念

1.  **桥接虚实**：作为科研假说（理论）与文献底座（现实）之间的核心桥梁。
2.  **提取基准**：从 SOTA 文献中提取硬性的技术瓶颈与标准度量衡（Metrics），为后续压测建立基准。
3.  **消除歧义**：将 PI 的宏观假说拆解为具体的工程变量与技术路径。

### 二、 设计方案

#### 映射逻辑

| 输入维度                       | 提取内容                      | 作用                       |
| :----------------------------- | :---------------------------- | :------------------------- |
| **Stage 1 (PI Result)**        | 核心假说、自变量/因变量       | 确定推演的终极目标。       |
| **Stage 2 (Literature Graph)** | SOTA 基线、工程瓶颈、标准指标 | 确定推演的现实约束与边界。 |
| **合成输出**                   | 技术路径、挑战阈值            | 为逻辑建模提供参数化输入。 |

### 三、 实现流程

| 步骤 | 动作       | 说明                                              |
| :--- | :--------- | :------------------------------------------------ |
| 1    | 情报对齐   | 读取 Stage 1 的 `pi_result.json`。                |
| 2    | 底座加载   | 读取 Stage 2 的 `literature_graph.json`。         |
| 3    | 上下文合成 | 调用 LLM 解析假说与底座的映射关系，提取技术路径。 |
| 4    | 报告生成   | 产出 `deduction_context.json`（全域上下文）。     |

### 四、 输入参数

| 参数名          | 类型   | 必填 | 默认值                  | 说明                      |
| :-------------- | :----- | :--- | :---------------------- | :------------------------ |
| **run_id**      | String | 是   | -                       | 执行 ID。                 |
| **agent_id**    | String | 否   | "feasibility-deduction" | 当前 Agent ID (Phase 3)。 |
| **pi_agent_id** | String | 否   | "idea-align"            | 阶段 1 Agent ID。         |
| **lg_agent_id** | String | 否   | "literature-ground"     | 阶段 2 Agent ID。         |

**输入文件 1**：`~/.openclaw/workspace-idea-align/task/{run_id}/pi_result.json`
**输入文件 2**：`~/.openclaw/workspace-literature-ground/task/{run_id}/literature_graph.json`

### 五、 输出参数

**输出文件**：`deduction_context.json` (双语版), `deduction_context_en.json` (纯英版), `deduction_context_cn.json` (纯中版)

| 字段名                | 类型   | 说明                                 |
| :-------------------- | :----- | :----------------------------------- |
| **chain_of_thought**  | Object | LLM 的推演思维链（中英文）。         |
| **deduction_context** | Object | 核心推演上下文，含变量、路径与阈值。 |

### 六、 示例

#### 6.1 运行示例

```bash
python3 scripts/mas4s_feasibility_deduction_context_ingestion.py '{"run_id": "run_20260426"}'
```

#### 6.2 目录结构示例

```
# 输入来源
~/.openclaw/workspace-idea-align/task/run_20260426/pi_result.json
~/.openclaw/workspace-literature-ground/task/run_20260426/literature_graph.json

# 当前输出
~/.openclaw/workspace-feasibility-deduction/task/run_20260426/
├── deduction_context.json               # 输出：全域上下文 (双语)
├── deduction_context_en.json            # 输出：全域上下文 (英)
├── deduction_context_cn.json            # 输出：全域上下文 (中)
└── progress_mas4s_feasibility_deduction_context_ingestion.jsonl
```

### 七、 Prompt

【Role Definition】
You are a "Principal Systems Architect" (首席系统架构师) and "Context Ingestion Engine" (上下文解析引擎). Your mission is to serve as the critical bridge between theoretical research and engineering reality. You will rapidly ingest the Principal Investigator's (PI) research hypothesis from Stage 1 and align it with the reality of the scientific literature and engineering bottlenecks from Stage 2.

【Downstream Handover Protocol】
Your output will be ingested by the "Logical Modeling" skill to generate mathematical models and technical requirement lists. Therefore:

1. Your output must be highly structured, precise, and purely objective. You must resolve any ambiguity between the PI's goals and the SOTA literature.
2. You MUST strictly adhere to the JSON schema provided below. Do not alter the key names or structure.
3. Output ONLY a valid JSON object. Do not wrap it in markdown code blocks (e.g., ```json) and do not include any preamble or conversational text. Your output MUST start exactly with "{{" and end exactly with "}}".
4. Ensure all double quotes within your string values are properly escaped (e.g., \") to prevent JSON parsing errors.

【Input Information】

1. Stage 1 PI Result JSON (课题假说定义): {stage_1_pi_result_json}
2. Stage 2 Literature Graph JSON (文献底座与瓶颈): {stage_2_literature_graph_json}

【Execution Protocol & Chain of Thought】
You MUST conduct a rigorous 3-step Chain of Thought within the `"chain_of_thought"` JSON object.
_CRITICAL ATTENTION RULE_: You are looking for the intersection of "What the PI wants to do" and "What the current engineering/literature reality allows". Pay special attention to "engineering_bottlenecks" and "standard_metrics" from Stage 2 to establish strict target thresholds.

- **Step 1: Hypothesis Deconstruction (假说解构):** Extract the core independent and dependent variables from Stage 1. Identify the PI's ultimate goal.
- **Step 2: Literature Alignment & Bottleneck Identification (文献对齐与瓶颈识别):** Cross-reference the PI's goal with Stage 2's SOTA landscape and engineering bottlenecks. Identify the exact technical components needed and the friction points (e.g., scalability limits, concurrency issues).
- **Step 3: Context Synthesis (推演基准合成):** Synthesize the concrete "Technical Route" (how to build it) and the "Target Thresholds" (how to measure success or failure based on literature baselines).

【Output Format Requirements】
Please strictly populate the values for the following JSON structure. The descriptions in the values below indicate what you should generate:

{{
  "chain_of_thought": {{
    "step_1_hypothesis_deconstruction": "Analyze the PI's core variables and intent from Stage 1. (Explain in Chinese)",
    "step_2_literature_alignment": "Map the PI's intent against SOTA baselines and engineering bottlenecks from Stage 2. (Explain in Chinese)",
    "step_3_context_synthesis": "Plan the technical route and extract concrete, measurable target thresholds. (Explain in Chinese)"
  }},
"deduction_context": {{
    "core_variables": {{
      "independent_variable_en": "The extracted independent variable in English.",
      "independent_variable_cn": "提取的自变量（中文）。",
      "dependent_variable_en": "The extracted dependent variable in English.",
      "dependent_variable_cn": "提取的因变量（中文）。"
    }},
"technical_route_en": "A concise, step-by-step engineering/methodological path to implement the hypothesis based on inputs (MAX 3 sentences).",
"technical_route_cn": "基于输入，简洁地描述实现该假说的工程/方法学路径（最多 3 句）。",
"target_thresholds": [
{{
"metric_name_en": "Name of the evaluation metric (e.g., Task Accuracy, Consensus Latency).",
"metric_name_cn": "评估指标名称（中文）。",
"baseline_target_en": "The required SOTA baseline or threshold to beat (e.g., > 85% under 20% injection).",
"baseline_target_cn": "需要达到的 SOTA 基线或挑战阈值（中文）。"
}}
]
}}
}}

【Language Output Constraint】
You MUST provide both English and Chinese versions for the `deduction_context` fields as specified in the JSON keys. Use professional, precise academic and engineering terminology for both languages.

### 八、 SOP 观测支持

- **进度文件路径**：`~/.openclaw/workspace-feasibility-deduction/task/<run_id>/progress_mas4s_feasibility_deduction_context_ingestion.jsonl`
- **上报机制**：`lib.progress.ProgressReporter`
