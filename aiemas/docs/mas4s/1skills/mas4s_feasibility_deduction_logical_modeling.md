# 逻辑建模 Agent (Logical Modeling) 设计方案

### 一、 设计理念

1.  **逻辑严密化**：将抽象的技术路径转化为可计算、可验证的数学模型。
2.  **工程蓝图化**：识别实现路径中的核心技术组件（Dimension B）。
3.  **压力预设**：为后续的压测环节（Boundary Testing）定义物理边界与资源极限（Dimension C）。

### 二、 设计方案

#### 建模维度

| 维度            | 名称         | 作用                                                    |
| :-------------- | :----------- | :------------------------------------------------------ |
| **Dimension A** | 核心蓝图     | 细化技术路线，评估算法复杂度（Time/Space Complexity）。 |
| **Dimension B** | 技术组件需求 | 拆解具体所需的数据库、计算架构、算法框架等工程指标。    |
| **Dimension C** | 极限边界约束 | 定义压测所需的极端条件（如并发量、故障率阈值等）。      |

### 三、 实现流程

| 步骤 | 动作       | 说明                                          |
| :--- | :--------- | :-------------------------------------------- |
| 1    | 上下文读取 | 读取 `deduction_context.json`。               |
| 2    | 逻辑建模   | 调用 LLM 将技术路径参数化，生成三维逻辑模型。 |
| 3    | 模型落盘   | 产出 `logical_model.json`，并进行中英拆分。   |

### 四、 输入参数

| 参数名       | 类型   | 必填 | 默认值                  | 说明                      |
| :----------- | :----- | :--- | :---------------------- | :------------------------ |
| **run_id**   | String | 是   | -                       | 执行 ID。                 |
| **agent_id** | String | 否   | "feasibility-deduction" | 当前 Agent ID (Phase 3)。 |

**输入文件**：`~/.openclaw/workspace-feasibility-deduction/task/{run_id}/deduction_context.json`

### 五、 输出参数

**输出文件**：`logical_model.json` (双语), `logical_model_en.json` (英), `logical_model_cn.json` (中)

| 字段名               | 类型   | 说明                                |
| :------------------- | :----- | :---------------------------------- |
| **chain_of_thought** | Object | 逻辑建模的思维链过程。              |
| **logical_model**    | Object | 包含 Dimension A/B/C 的参数化模型。 |

### 六、 示例

#### 6.1 运行示例

```bash
python3 scripts/mas4s_feasibility_deduction_logical_modeling.py '{"run_id": "run_20260426"}'
```

#### 6.2 目录结构示例

```
~/.openclaw/workspace-feasibility-deduction/task/run_20260426/
├── deduction_context.json               # 输入
├── logical_model.json                   # 输出：三维逻辑模型 (双语)
├── logical_model_en.json                # 输出：逻辑模型 (英)
├── logical_model_cn.json                # 输出：逻辑模型 (中)
└── progress_mas4s_feasibility_deduction_logical_modeling.jsonl
```

### 七、 Prompt

【Role Definition】
You are an elite "Mathematical Architect" (数学架构师) and "Logical Modeling Engine" (逻辑建模引擎). Your mission is to translate the parsed scientific hypothesis and contextual baselines into a rigorous, parameterized mathematical model and concrete engineering requirement lists.

【Downstream Handover Protocol】
Your output will dictate the execution of the next two critical skills: "Reality Anchor Verification" and "Extreme Boundary Stress Testing". Therefore:

1. Your output must be highly logical, algorithmically sound, and devoid of theoretical paradoxes.
2. You MUST strictly adhere to the JSON schema provided below. Do not alter the key names or structure.
3. Output ONLY a valid JSON object. Do not wrap it in markdown code blocks (e.g., ```json) and do not include any preamble or conversational text. Your output MUST start exactly with "{{" and end exactly with "}}".
4. Ensure all double quotes within your string values are properly escaped (e.g., \") to prevent JSON parsing errors.

【Input Information】

1. Deduction Context JSON (上游上下文解析结果): {deduction_context_json}

【Execution Protocol & Chain of Thought】
You MUST conduct a rigorous 3-step Chain of Thought within the `"chain_of_thought"` JSON object.
_CRITICAL ATTENTION RULE_: You are converting abstract research goals into hard engineering blueprints. You must estimate Big O complexities (e.g., O(N^2) memory footprint) and identify the exact types of tech stacks needed (e.g., Vector DBs, Multi-GPU clusters, Consensus protocols).

- **Step 1: Paradox & Consistency Check (逻辑自洽性查证):** Critically analyze the input technical route. Are there any inherent mathematical or algorithmic paradoxes? Does the proposed route logically lead to the target thresholds?
- **Step 2: Component Breakdown (技术组件拆解):** Translate the technical route into a "Universal Technical Requirements List" (Dimension B). What specific software, hardware, or algorithmic components are absolutely necessary to build this?
- **Step 3: Constraint Formulation (边界约束提炼):** Based on the target thresholds, define the extreme conditions, resource limits, and physical boundaries (Dimension C) that the system must endure during stress testing.

【Output Format Requirements】
Please strictly populate the values for the following JSON structure. The descriptions in the values below indicate what you should generate:

{{
  "chain_of_thought": {{
    "step_1_paradox_check": "Verify logical consistency and mathematical feasibility. (Explain in Chinese)",
    "step_2_component_breakdown": "Deconstruct the route into concrete tech requirements. (Explain in Chinese)",
    "step_3_constraint_formulation": "Define extreme stress-testing constraints. (Explain in Chinese)"
  }},
"logical_model": {{
    "dimension_a_core_blueprint": {{
      "refined_technical_route_en": "The mathematically/logically refined technical route (MAX 3 sentences).",
      "refined_technical_route_cn": "经逻辑严密化后的核心技术路线（最多 3 句）。",
      "complexity_estimation_en": "Estimated computational and spatial complexity (e.g., Time: O(N^2), Space: O(N)).",
      "complexity_estimation_cn": "预估的时间与空间复杂度（中文描述）。"
    }},
"dimension_b_tech_requirements": [
{{
"component_category": "e.g., DATABASE, COMPUTE, FRAMEWORK, ALGORITHM",
"requirement_desc_en": "Specific requirement description (e.g., High-concurrency vector storage with sub-millisecond write latency).",
"requirement_desc_cn": "具体的技术组件需求描述（中文）。"
}}
],
"dimension_c_extreme_constraints": [
{{
"constraint_dimension": "e.g., MEMORY_IO, SCALE, THROUGHPUT",
"extreme_condition_en": "The extreme boundary condition for stress testing (e.g., Simulate 100+ agents with 20% Byzantine nodes).",
"extreme_condition_cn": "用于压力测试的极限边界条件（中文）。"
}}
]
}}
}}

【Language Output Constraint】
You MUST provide both English and Chinese versions for the specified fields within the `logical_model` object. Use professional academic, mathematical, and computer science terminology for both languages.

### 八、 SOP 观测支持

- **进度文件路径**：`~/.openclaw/workspace-feasibility-deduction/task/<run_id>/progress_mas4s_feasibility_deduction_logical_modeling.jsonl`
- **上报机制**：`lib.progress.ProgressReporter`
