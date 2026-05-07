## 宏观态势探针 Skill (Macro Probe Skill) 设计方案

### 一、 设计理念

1.  **快速定性**：作为文献深析的第一梯队，旨在以极小的计算开销建立对文献的“宏观初印象”。
2.  **公式化抽象**：强制模型使用统一的“一句话公式”描述，消除语言风格差异，便于跨论文对比。
3.  **Scooped 预警**：快速识别论文核心目标，判断是否与 PI 假说发生直接碰撞（被抢发）。
4.  **特征表支撑**：承担文献全景特征表中的“元信息”与“理论核心”维度字段提取。

### 二、 设计方案

该 Skill 专注于浅层抽象，从 Title、Abstract 和 Introduction 中提取核心逻辑与背景。

| 负责字段                 | 说明                                           | 认知深度 |
| :----------------------- | :--------------------------------------------- | :------- |
| **is_published**         | 是否已正式发表（期刊/会议/预印本版本号）       | 事实层   |
| **research_objective**   | 研究问题/目标（一句话总结）                    | 宏观抽象 |
| **theoretical_basis**    | 理论视角/基础（借用的经典理论或框架）          | 理论层   |
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
**输入文件 2**：`~/.openclaw/workspace-literature/task/{run_id}/parsed_papers.json`

### 五、 输出参数

**输出文件**：`~/.openclaw/workspace-literature/task/{run_id}/papers/{arxiv_id}/paper_macro_feature.json`

| 字段名                   | 类型   | 说明                                                           |
| :----------------------- | :----- | :------------------------------------------------------------- |
| **is_published**         | String | 是否已发表及发表地（如 "NeurIPS 2024" 或 "arXiv v2 未发表"）。 |
| **research_objective**   | String | 核心研究问题或目标。                                           |
| **theoretical_basis**    | String | 借用的理论基础或视角。                                         |
| **one_sentence_formula** | String | 一句话公式描述。                                               |
| **refined_abstract**     | String | 提炼后的精简摘要（中文）。                                     |
| **chain_of_thought**     | Object | 三步思维链推演。                                               |

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
    "is_published": "arXiv:2301.00001v2 · 未正式发表",
    "research_objective": "多任务学习中共享表示对灾难性遗忘的影响",
    "theoretical_basis": "信息瓶颈理论 (Information Bottleneck Theory)",
    "one_sentence_formula": "用生物启发式的选择性遗忘框架解决 LLM Agent 内存管理冗余问题，以揭示内存裁剪与安全性之间的平衡规律。",
    "refined_abstract": "针对 LLM Agent 内存管理中忽视遗忘机制导致效率低下的问题，本文提出了 FSFM 框架。通过模拟人类海马体索引与遗忘曲线，实现了被动衰减与主动删除的结合。实验证明该方法显著提升了访问效率并消除了安全风险。"
  }
}
```

### 八、 SOP 观测支持

- **进度上报**：按论文逐篇上报 `item`。
- **进度文件路径**：`~/.openclaw/workspace-<agentId>/task/<run_id>/progress_mas4s_macro_probe.jsonl`
