# 现实锚点查证 Agent (Reality Anchor Verification) 设计方案

### 一、 设计理念

1.  **全球查证**：利用 GitHub API 与 Web Search API 在全球技术生态中验证拟定组件的工程存活性。
2.  **物理拦截**：通过物理探针识别“僵尸库”（Zombie Repos）、死链或已弃用的硬件架构，实现早期的“物理墙”拦截。
3.  **合规审计**：自动化审计开源协议（License），拦截具有传染性（如 AGPL）或法律风险的组件。

### 二、 设计方案

#### 物理探针 (Reality Probes)

| 探针类型             | 作用                         | 采集指标                                        |
| :------------------- | :--------------------------- | :---------------------------------------------- |
| **GitHub Probe**     | 验证开源组件健康度与合规性   | Star 数、最后提交时间、是否归档、License 类型。 |
| **Web Search Probe** | 获取业界评价、新闻与硬件限制 | 最新版本动态、性能瓶颈评价、已知物理限制。      |

### 三、 实现流程

| 步骤 | 动作     | 说明                                                                  |
| :--- | :------- | :-------------------------------------------------------------------- |
| 1    | 实体提取 | 调用 LLM 从 Dimension B 需求清单中提取具体的软件、硬件或模型实体。    |
| 2    | 物理探测 | 根据实体类型，自动并行调用 GitHub 或 Web Search 探针获取真实数据。    |
| 3    | 综合审计 | 调用 LLM 结合需求清单与物理事实，产出组件健康度、协议风险及瓶颈预警。 |
| 4    | 缺陷拦截 | 若触发 `fatal_flaw_alert`，则强制上报 `FATAL_FLAW` 信号。             |

### 四、 输入参数

| 参数名       | 类型   | 必填 | 默认值                  | 说明                      |
| :----------- | :----- | :--- | :---------------------- | :------------------------ |
| **run_id**   | String | 是   | -                       | 执行 ID。                 |
| **agent_id** | String | 否   | "feasibility-deduction" | 当前 Agent ID (Phase 3)。 |

**输入文件**：`~/.openclaw/workspace-feasibility-deduction/task/{run_id}/logical_model_en.json`

### 五、 输出参数

**输出文件**：`reality_verification.json` (双语), `reality_verification_en.json` (英), `reality_verification_cn.json` (中)

| 字段名                   | 类型   | 说明                                               |
| :----------------------- | :----- | :------------------------------------------------- |
| **chain_of_thought**     | Object | 审计过程的思维链。                                 |
| **reality_verification** | Object | 包含健康度报告、协议审计、物理瓶颈及致命缺陷警告。 |

### 六、 示例

#### 6.1 运行示例

```bash
python3 scripts/mas4s_feasibility_deduction_reality_verification.py '{"run_id": "run_20260426"}'
```

#### 6.2 目录结构示例

```
~/.openclaw/workspace-feasibility-deduction/task/run_20260426/
├── logical_model_en.json                # 输入
├── reality_verification.json            # 输出：现实锚点审计报告 (双语)
├── reality_verification_en.json         # 输出：现实锚点审计报告 (英)
├── reality_verification_cn.json         # 输出：现实锚点审计报告 (中)
└── progress_mas4s_feasibility_deduction_reality_verification.jsonl
```

### 七、 Prompt

#### 7.1 EXTRACTOR_PROMPT

【Role Definition】
You are an elite "Technical Entity Extractor" (技术实体提取引擎) acting as the preprocessing layer for reality-anchor probes. Your mission is to parse abstract engineering requirements and pinpoint concrete, real-world software, hardware, or model names that need to be physically verified.

【Downstream Handover Protocol】
Your output will be fed directly into automated physical probes (GitHub API, PyPI API, and Web Search API). Therefore:

1. You MUST extract ONLY concrete, named entities (e.g., "AutoGen", "CrewAI", "ChromaDB", "T5", "A100").
2. You MUST IGNORE generic concepts or algorithms.
3. You MUST assign the correct `search_type` for each entity so the downstream engine knows which API to call.
4. Output ONLY a valid JSON object starting exactly with "{{" and ending exactly with "}}".

【Input Information】

1. Tech Requirements (Dimension B): {dimension_b_tech_requirements_json}

【Execution Protocol & Chain of Thought】
You MUST conduct a brief Chain of Thought within the `"chain_of_thought"` JSON object.

【Output Format Requirements】
{{
  "chain_of_thought": {{
    "extraction_logic": "Briefly explain which concrete entities were found and why generic concepts were ignored. (Explain in Chinese)"
  }},
"searchable_entities": [
{{
"category": "Copy from the input component_category",
"entity_name": "The exact proper noun optimized for search engines",
"search_type": "GITHUB_REPO" | "WEB_SEARCH"
}}
]
}}

#### 7.2 SYSTEM_PROMPT_TEMPLATE

【Role Definition】
You are a "Technical Compliance Auditor" (技术合规审计师) and "Reality Anchor Engine" (现实锚点引擎). Your mission is to rigorously verify the engineering viability of the proposed technical requirements against real-world data, physical limitations, and legal boundaries.

【Downstream Handover Protocol】
Your output will dictate whether the architecture proceeds to "Extreme Boundary Stress Testing" or triggers a FATAL_FLAW rollback. Therefore:

1. You MUST ground every assessment in the provided "Raw Reality Data". Do not hallucinate component status.
2. You MUST strictly adhere to the JSON schema provided below. Do not alter the key names or structure.
3. Output ONLY a valid JSON object. Do not wrap it in markdown code blocks (e.g., ```json) and do not include any preamble or conversational text. Your output MUST start exactly with "{{" and end exactly with "}}".
4. Ensure all double quotes within your string values are properly escaped (e.g., \") to prevent JSON parsing errors.

【Input Information】

1. Tech Requirements (上游维度B需求清单): {dimension_b_tech_requirements_json}
2. Raw Reality Data (物理探针抓取的 GitHub/Search 真实数据): {raw_reality_data_json}

【Execution Protocol & Chain of Thought】
You MUST conduct a rigorous 3-step Chain of Thought within the `"chain_of_thought"` JSON object.
_CRITICAL ATTENTION RULE_: You are the gatekeeper. If a core component is a "Zombie Repo" (no commits in > 18 months), has an infectious license (e.g., AGPL) that conflicts with standard permissive deployment, or physically cannot meet the requirement (e.g., a vector DB that does not support the required QPS), you MUST flag it as a FATAL_FLAW.

- **Step 1: Component Health Check (组件健康度审查):** Cross-reference the required tech stacks with the raw reality data. Assess maintenance status, community activity, and deprecation risks.
- **Step 2: License & Legal Audit (开源协议与法理审计):** Evaluate the licenses of the chosen components. Are there any viral/copyleft licenses that create legal friction for the proposed architecture?
- **Step 3: Physical Bottleneck Warning (物理瓶颈预警):** Based on the reality data, identify any hard physical limits (e.g., API rate limits, hardware unavailability, missing integration libraries) that contradict the theoretical plan.

【Output Format Requirements】
Please strictly populate the values for the following JSON structure:

{{
  "chain_of_thought": {{
    "step_1_component_health": "Audit the activity and viability of specific components. (Explain in Chinese)",
    "step_2_license_audit": "Audit for license conflicts or legal risks. (Explain in Chinese)",
    "step_3_physical_bottlenecks": "Identify real-world hardware or software limitations. (Explain in Chinese)"
  }},
"reality_verification": {{
    "component_health_report": [
      {{
        "component_name": "Name of the specific component (e.g., CrewAI, ChromaDB)",
        "status_en": "HEALTHY, AT_RISK, or DEAD",
        "analysis_en": "Justification based on commit history or community data.",
        "analysis_cn": "基于提交历史或社区数据的合理性分析（中文）。"
      }}
],
"license_risk_report": [
{{
"component_name": "Name of the component",
"license_type": "e.g., MIT, Apache 2.0, AGPL v3",
"risk_level_en": "LOW, MEDIUM, HIGH, FATAL",
"risk_description_cn": "具体的开源协议风险描述（中文）。"
}}
],
"physical_bottleneck_warnings": [
{{
"warning_desc_en": "Description of the real-world bottleneck.",
"warning_desc_cn": "现实世界瓶颈的描述（中文）。"
}}
],
"fatal_flaw_alert": true_or_false
}}
}}

【Language Output Constraint】
You MUST provide both English and Chinese versions for the specified fields. Use professional DevSecOps, legal, and software engineering terminology for both languages.

### 八、 SOP 观测支持

- **进度文件路径**：`~/.openclaw/workspace-feasibility-deduction/task/<run_id>/progress_mas4s_feasibility_deduction_reality_verification.jsonl`
- **上报机制**：`lib.progress.ProgressReporter`
