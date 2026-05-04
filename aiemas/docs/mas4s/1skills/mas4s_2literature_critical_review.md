## 价值批判专家 Skill (Critical Review Skill) 设计方案

### 一、 设计理念

1.  **祛魅与批判**：不盲从论文结论，通过交叉验证发现作者隐藏的局限性与失败场景。
2.  **启发式挖掘**：剥离具体的实验数据，关注其背后的研究范式或方法论对 PI 假说的启发价值。
3.  **边界探测**：明确界定该技术的“失效阈值”，为后续可行性推演提供风险基准。
4.  **特征表支撑**：承担文献全景特征表中的“启示反哺”维度字段提取。

### 二、 设计方案

该 Skill 专注于主观评价与启发价值，从 Discussion、Limitations 和 Conclusion 章节中提取批判性见解。

| 负责字段                        | 说明                                                       | 认知深度 |
| :------------------------------ | :--------------------------------------------------------- | :------- |
| **direct_inspiration**          | 对我方实验设计的直接启示（复用范式、控制变量、改进材料等） | 战略层   |
| **limitations_and_future_work** | 局限性与未来工作（作者承认的不足、逻辑漏洞、机会点）       | 批判层   |
| **pros_and_strengths**          | 真正的核心优势（非广告语）                                 | 深度评价 |
| **cons_and_weaknesses**         | 根本性缺陷或存疑的假设                                     | 批判层   |
| **boundary_limitations**        | 技术失效的特定边界条件                                     | 风险层   |

### 三、 实现流程

| 步骤 | 动作     | 说明                                                      |
| :--- | :------- | :-------------------------------------------------------- |
| 1    | 数据加载 | 读取 `parsed_papers.json` 及 PI 核心假说。                |
| 2    | 价值审计 | 针对每篇论文的 Markdown 全文进行批判性审计。              |
| 3    | 结果落盘 | 在论文 arXiv ID 目录下生成 `paper_critical_review.json`。 |

### 四、 输入参数

| 参数名       | 类型   | 必填 | 默认值     | 说明            |
| :----------- | :----- | :--- | :--------- | :-------------- |
| **run_id**   | String | 是   | -          | 执行 ID。       |
| **agent_id** | String | 否   | "evidence" | 当前 Agent ID。 |

**输入文件**：`~/.openclaw/workspace-literature/task/{run_id}/parsed_papers.json`

### 五、 输出参数

**输出文件**：`~/.openclaw/workspace-literature/task/{run_id}/papers/{arxiv_id}/paper_critical_review.json`

| 字段名                          | 类型   | 说明                                 |
| :------------------------------ | :----- | :----------------------------------- |
| **direct_inspiration**          | String | 对我方研究的直接参考价值与具体启示。 |
| **limitations_and_future_work** | String | 文献局限性与未来研究方向。           |
| **pros_and_strengths**          | String | 文献核心优点。                       |
| **cons_and_weaknesses**         | String | 文献核心缺点。                       |
| **boundary_limitations**        | String | 技术边界与局限。                     |

### 六、 示例

#### 6.1 运行示例

```bash
python3 scripts/mas4s_evidence_deep_analysis_critical_review.py '{"run_id": "run_222"}'
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
    "direct_inspiration": "采用交替训练范式；将“任务相似度”作为操作检查指标；预注册时需考虑学习速度-遗忘的权衡。",
    "limitations_and_future_work": "仅用人工合成任务；未考虑情感动机影响——我们的实验可引入真实场景和动机变量。",
    "pros_and_strengths": "通过引入离线睡眠阶段进行记忆固化，这种时间解耦的思路非常具有鲁棒性。",
    "cons_and_weaknesses": "遗忘机制完全依赖预定义的价值标签，缺乏对动态演化上下文的自适应能力。",
    "boundary_limitations": "在极高并发的实时交互场景下，睡眠阶段的延迟可能导致关键记忆丢失。"
  }
}
```

### 八、 SOP 观测支持

- **进度上报**：按论文逐篇上报 `item`。
- **进度文件路径**：`~/.openclaw/workspace-<agentId>/task/<run_id>/progress_mas4s_critical_review.jsonl`
