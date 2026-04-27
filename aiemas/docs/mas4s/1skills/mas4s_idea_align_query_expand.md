## 检索增强查询拓展 Agent (Query Expand) 设计方案

### 一、 设计理念

核心理念：**"解构 -> 映射 -> 路由 -> 封装"**

1. **深度思维链 (Chain of Thought)**：通过 CoT 提炼核心实体、映射学术同义词、寻找跨学科关联点。
2. **四维立体覆盖**：SOTA / GAPS / CROSS_DISCIPLINE / IMPLEMENTATION。
3. **双擎差异化路由**：中文引擎用中英混编布尔式；英文引擎用纯英文学术布尔式。

### 二、 设计方案

#### 2.1 检索维度矩阵

| 维度                 | 搜索意图           | 核心关键词模板                             |
| :------------------- | :----------------- | :----------------------------------------- |
| **SOTA**             | 获取最新基线与综述 | review, survey, state of the art, 综述     |
| **GAPS**             | 挖掘缺陷与挑战     | limitations, bottlenecks, challenges, 痛点 |
| **CROSS_DISCIPLINE** | 跨学科借用         | cross-disciplinary, bio-inspired, 跨界     |
| **IMPLEMENTATION**   | 工程部署与优化     | deployment, optimization, benchmark, 落地  |

#### 2.2 强制约束

- 精确匹配：`""` 包裹专业短语。
- 逻辑绑定：`query_cn` 必须混合中英文。
- 结构化输出：纯净可解析 JSON，严禁冗余文本。

### 三、 实现流程

| 步骤 | 动作             | 说明                                               |
| :--- | :--------------- | :------------------------------------------------- |
| 1    | 思维链解析 (CoT) | 在 `chain_of_thought` 中完成概念解构与跨学科分析。 |
| 2    | 实体与术语提取   | 拆解为中英双语核心实体，映射同义词池。             |
| 3    | 四维检索式构建   | 生成 4 个维度的布尔表达式。                        |
| 4    | 差异化语法适配   | 百度用中英混合；arXiv 用纯英文。                   |
| 5    | JSON 输出        | 保存至 `idea_query_expand.json`。                  |

### 四、 输入参数

所有文件集中存放于 `~/.openclaw/workspace-{agent_id}/task/{run_id}/`。

| 参数名       | 类型   | 必填 | 说明                                          |
| :----------- | :----- | :--- | :-------------------------------------------- |
| **run_id**   | String | 是   | 执行 ID，用于定位运行目录。                   |
| **agent_id** | String | 否   | Agent ID，默认 `idea-align`。                 |
| **idea**     | String | 否   | 研究想法字符串（提供时自动写入 `idea.txt`）。 |

**固定输入文件**：`idea.txt`

### 五、 输出参数

**固定输出文件**：`idea_query_expand.json`

| 字段名                  | 类型   | 说明                     |
| :---------------------- | :----- | :----------------------- |
| **extracted_concepts**  | Array  | 提取的核心概念列表。     |
| **queries**             | Array  | 4 个维度的查询对象数组。 |
| **queries[].dimension** | String | 维度名称。               |
| **queries[].query_cn**  | String | 中英双语布尔检索式。     |
| **queries[].query_en**  | String | 纯英文布尔检索式。       |
| **queries[].purpose**   | String | 检索目的。               |

### 六、 示例

#### 6.1 运行示例

```bash
python3 scripts/mas4s_idea_align_query_expand.py '{"idea": "研究多智能体协作中的长期记忆管理", "run_id": "run_20260423"}'
```

#### 6.2 目录结构示例

```
~/.openclaw/workspace-idea-align/task/run_20260423/
├── idea.txt                          # 输入
├── idea_query_expand.json            # 输出
└── progress_mas4s_idea_align_query_expand.jsonl  # 进度日志
```

#### 6.3 输出示例

```json
{
  "extracted_concepts": ["多智能体/Multi-Agent", "长期记忆/Long-term Memory"],
  "queries": [
    {
      "dimension": "SOTA",
      "query_cn": "(多智能体 OR \"Multi-Agent\") AND (长期记忆) AND (综述)",
      "query_en": "(\"Multi-Agent System\") AND (\"Long-term Memory\") AND (survey)",
      "purpose": "获取该领域的最新基线与综述"
    }
  ]
}
```

### 七、 Prompt

> [!IMPORTANT]
> 以下为脚本中使用的完整 System Prompt，与脚本保持一致。

````text
【Role Definition】
You are an elite "Dual-Engine Academic Intelligence Expert." Your task is to transform a user's initial research idea into a highly precise, structured JSON object containing Boolean queries.

You must generate TWO distinct queries for EACH dimension:
1. `query_cn`: Optimized for Baidu Search. It MUST be a Bilingual Boolean query (mixing Chinese and English).
2. `query_en`: Optimized for arXiv/Academic APIs. It MUST be a Pure English Boolean query.

【CRITICAL OPTIMIZATION CONSTRAINTS】
To prevent API search failures caused by overly long or complex queries, you MUST STRICTLY adhere to these limits:
- MAX 2 SYNONYMS PER CONCEPT: Within any OR block `(...)`, you can have a maximum of 2 terms (e.g., `(A OR B)` is allowed, `(A OR B OR C)` is FORBIDDEN).
- PRECISION OVER EXHAUSTION: Discard marginal synonyms. Pick only the absolute highest-frequency academic terms.
- SHORT QUERIES: Keep the entire query string as short and concise as possible while retaining core meaning.

【Execution Protocol & Few-Shot Examples】
You MUST construct concise queries across 4 strict dimensions: SOTA, GAPS, CROSS_DISCIPLINE, and IMPLEMENTATION.

First, conduct a Chain of Thought within the `"chain_of_thought"` JSON field. Analyze the idea, extract core entities, pick ONLY the top 1-2 synonyms, and construct the queries.

--- START OF EXAMPLES ---
Assuming the User Idea is: "研究多智能体协作中的长期记忆 management"

{
  "chain_of_thought": {
    "step_1_deconstruction": "Core entities: 'Multi-agent' and 'Long-term memory'.",
    "step_2_strict_synonym_selection": "Multi-agent: MAS, Agent. Long-term memory: Memory Mechanism. SOTA keywords: review, survey.",
    "step_3_query_construction": "I will strictly limit OR operators. SOTA will use basic terms. GAPS will use 'limitations'. CROSS_DISCIPLINE will map to 'neuroscience'."
  },
  "extracted_concepts": ["多智能体/Multi-Agent", "长期记忆/Long-term Memory"],
  "queries": [
    {
      "dimension": "SOTA",
      "query_cn": "(多智能体 OR MAS) AND (长期记忆) AND (综述 OR review)",
      "query_en": "(\"Multi-Agent\") AND (\"Long-term Memory\") AND (survey OR review)",
      "purpose": "获取该领域的最新基线与综述 (Baselines & Reviews)"
    },
    {
      "dimension": "GAPS",
      "query_cn": "(多智能体) AND (记忆同步 OR 状态冲突) AND (局限性 OR bottlenecks)",
      "query_en": "(\"Multi-Agent\") AND (\"Memory Synchronization\") AND (limitations OR bottlenecks)",
      "purpose": "挖掘现有记忆方案的缺陷 (Identify Flaws)"
    },
    {
      "dimension": "CROSS_DISCIPLINE",
      "query_cn": "(智能体 OR Agent) AND (记忆网络 OR 遗忘曲线) AND (神经科学)",
      "query_en": "(\"Multi-Agent\") AND (\"Forgetting Curve\") AND (neuroscience OR psychology)",
      "purpose": "寻找认知科学/生物学的跨学科借用 (Cross-disciplinary borrowing)"
    },
    {
      "dimension": "IMPLEMENTATION",
      "query_cn": "(多智能体) AND (向量数据库 OR Mem0) AND (部署 OR 性能优化)",
      "query_en": "(\"LLM Agent\") AND (\"Vector Database\") AND (deployment OR optimization)",
      "purpose": "寻找底层架构部署的工程挑战 (Engineering Challenges)"
    }
  ]
}
--- END OF EXAMPLES ---

【Output Format Requirements】
- You MUST output ONLY a pure, parsable JSON object.
- DO NOT wrap the output in Markdown code blocks (e.g., ```json).
- DO NOT include any introductory or concluding text before or after the JSON.
- The very first key in your JSON MUST be `"chain_of_thought"`.
````

---

### 八、 SOP 观测支持

- **进度文件路径**：`~/.openclaw/workspace-<agentId>/task/<run_id>/progress_mas4s_idea_align_query_expand.jsonl`
- **上报机制**：`lib.progress.ProgressReporter`
