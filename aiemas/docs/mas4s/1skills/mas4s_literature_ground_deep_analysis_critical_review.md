## 价值批判专家 Skill (Critical Review Skill) 设计方案

### 一、 设计理念

1.  **祛魅与批判**：不盲从论文结论，通过交叉验证发现作者隐藏的局限性与失败场景。
2.  **启发式挖掘**：剥离具体的实验数据，关注其背后的研究范式或方法论对 PI 假说的启发价值。
3.  **边界探测**：明确界定该技术的“失效阈值”，为后续可行性推演提供风险基准。

### 二、 设计方案

该 Skill 专注于主观评价与启发价值，从 Discussion、Limitations 和 Conclusion 章节中提取批判性见解。

| 负责字段 | 说明 | 认知深度 |
| :--- | :--- | :--- |
| **pros_and_strengths** | 真正的核心优势（非广告语） | 深度评价 |
| **cons_and_weaknesses** | 根本性缺陷或存疑的假设 | 批判层 |
| **boundary_limitations** | 技术失效的特定边界条件 | 风险层 |
| **heuristic_value** | 对我方研究的直接参考价值 | 战略层 |

### 三、 实现流程

| 步骤 | 动作 | 说明 |
| :--- | :--- | :--- |
| 1 | 数据加载 | 读取 `parsed_papers.json` 及 PI 核心假说。 |
| 2 | 价值审计 | 针对每篇论文的 Markdown 全文进行批判性审计。 |
| 3 | 结果落盘 | 在论文 arXiv ID 目录下生成 `paper_critical_review.json`。 |

### 四、 输入参数

| 参数名 | 类型 | 必填 | 默认值 | 说明 |
| :--- | :--- | :--- | :--- | :--- |
| **run_id** | String | 是 | - | 执行 ID。 |
| **agent_id** | String | 否 | "literature-ground" | 当前 Agent ID。 |

**输入文件**：`~/.openclaw/workspace-literature-ground/task/{run_id}/parsed_papers.json`

### 五、 输出参数

**输出文件**：`~/.openclaw/workspace-literature-ground/task/{run_id}/papers/{arxiv_id}/paper_critical_review.json`

| 字段名 | 类型 | 说明 |
| :--- | :--- | :--- |
| **pros_and_strengths** | String | 文献核心优点。 |
| **cons_and_weaknesses** | String | 文献核心缺点。 |
| **boundary_limitations** | String | 技术边界与局限。 |
| **heuristic_value** | String | 启发价值。 |

### 六、 示例

#### 6.1 运行示例

```bash
python3 scripts/mas4s_literature_ground_deep_analysis_critical_review.py '{"run_id": "run_222"}'
```

#### 6.2 输出示例 (`paper_critical_review.json`)

```json
{
  "chain_of_thought": {
    "step_1_claim_audit": "...",
    "step_2_limitation_hunting": "...",
    "step_3_strategic_value": "..."
  },
  "critical_review": {
    "pros_and_strengths": "通过引入离线睡眠阶段进行记忆固化，这种时间解耦的思路非常具有鲁棒性。",
    "cons_and_weaknesses": "遗忘机制完全依赖预定义的价值标签，缺乏对动态演化上下文的自适应能力。",
    "boundary_limitations": "在极高并发的实时交互场景下，睡眠阶段的延迟可能导致关键记忆丢失。",
    "heuristic_value": "其‘NREM/REM’分级固化的算法架构可以直接借鉴到我们 PI 假说的内存分层设计中。"
  }
}
```

### 七、 Prompt

【Role Definition】
You are a ruthless but fair "Critical Review Expert" (价值批判专家) and a senior reviewer for top-tier journals (e.g., Nature, NeurIPS). Your objective is to evaluate the provided academic paper, not to praise it, but to critically expose its boundaries, flaws, and true heuristic value. You pierce through the author's survivorship bias to find the hidden caveats.

【Downstream Handover Protocol】
Your output will be used by the human Principal Investigator to make Go/No-Go decisions on whether to borrow this paper's methodology. Therefore:

1. You MUST strictly adhere to the JSON schema provided below.
2. Output ONLY a valid JSON object. Do not wrap it in markdown code blocks (e.g., ```json) and do not include any preamble text. Your output MUST start exactly with "{{" and end exactly with "}}".
3. Ensure all double quotes within your string values are properly escaped (e.g., \").

【Input Information】

1. Paper Full Text (Markdown): {paper_markdown_text}

【Execution Protocol & Chain of Thought】
You MUST conduct a rigorous 3-step Chain of Thought within the `"chain_of_thought"` JSON object.
_CRITICAL ATTENTION RULE_: Focus your attention heavily on the `Discussion`, `Limitations`, `Conclusion`, and the fine print in the `Experiments` section.

- **Step 1: Claim vs. Evidence Audit:** Contrast the author's grand claims in the Abstract/Intro with the actual data in the Results. Is there a gap?
- **Step 2: Limitation Hunting:** Scan specifically for self-admitted limitations, constrained testing environments, or edge cases where the method fails.
- **Step 3: Strategic Value Extraction:** Determine what specific mechanism or philosophy from this paper can be recycled or improved upon for future research.

【Output Format Requirements】
Please strictly populate the values for the following JSON structure:

{{
  "chain_of_thought": {{
    "step_1_claim_audit": "Audit the gap between the paper's claims and its actual evidence. (Explain in Chinese)",
    "step_2_limitation_hunting": "Identify the hidden boundaries and admitted flaws. (Explain in Chinese)",
    "step_3_strategic_value": "Assess the true heuristic value of this work. (Explain in Chinese)"
  }},
"critical_review": {{
    "pros_and_strengths": "What did this paper genuinely do well? (Focus on methodology robustness or novel perspectives).",
    "cons_and_weaknesses": "What are the fundamental flaws or highly questionable assumptions in their approach?",
    "boundary_limitations": "Under what specific conditions will this method break or become invalid? (e.g., 'Only works on static graphs', 'Requires massive compute').",
    "heuristic_value": "What specific algorithmic fragment, metric, or conceptual paradigm should we borrow or deeply investigate for our own research?"
  }}
}}

【Language Output Constraint】
All string VALUES within the JSON MUST be generated entirely in professional academic Chinese (Mandarin), keeping English technical terms in parentheses where appropriate. Be extremely critical and objective in your tone.

### 八、 SOP 观测支持

- **进度上报**：按论文逐篇上报 `item`。
- **进度文件路径**：`~/.openclaw/workspace-<agentId>/task/<run_id>/progress_mas4s_critical_review.jsonl`
