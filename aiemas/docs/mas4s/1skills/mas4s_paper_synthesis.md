在元智能体系统架构（Agentic Workflow）的工程落地中，**数据流的流转协议**是连接“局部感知”与“全局决策”的支柱。

为了实现多篇文献的 6 维度数据向“多维文献交叉合成与审查”节点的精准传递，我们需要定义一套**“批次缓冲区（Batch Buffer）”**协议。

### 1. 数据流转架构：批次聚合模型

在你的 `Literature Ground` Agent 内部，数据流遵循**“并行提取 -> 列表挂载 -> 统一喂入”**的模式。

- **Step 1 (Parallel Extraction)**：对于 arXiv 检索到的 $N$ 篇论文，系统并发启动 $N \times 3$ 个子任务（Skill A/B/C）。
- **Step 2 (Memory/Buffer Construction)**：每个任务返回的 JSON 片段被实时追加到一个名为 `analyzed_papers_buffer` 的 Python 列表中。
- **Step 3 (Orchestration)**：当所有并发任务完成后，编排器（Orchestrator）将该列表作为**单一变量**注入到聚合节点的 Prompt 中。

### 2. 接口协议：输入 JSON 结构定义

聚合节点接收的 `ANALYZED_PAPERS_LIST` 变量应具备以下标准结构，确保 LLM 能够通过键名（Key）快速定位跨文献的冲突点：

```json
[
  {
    "paper_id": "arXiv:2404.XXXX",
    "title": "...",
    "data_streams": {
      "macro_probe": { "formula": "...", "abstract": "..." },
      "technical_deconstruction": { "algorithm": "...", "method": "...", "results": "..." },
      "critical_review": { "cons_and_weaknesses": "...", "heuristic_value": "..." }
    }
  },
  {
    "paper_id": "arXiv:2403.YYYY",
    "data_streams": { ... }
  }
]
```

---

### 3. 终极聚合 Prompt：多维文献交叉合成 (Multi-Paper Synthesis)

为了适配 `.format()` 注入，我更新了聚合节点的 Prompt。它现在的核心逻辑是**“横向扫描”**——即不再按“篇”读，而是按“维度”读，寻找不同文献在同一维度上的对抗性。

```text
【Role Definition】
You are the "Master Synthesis Architect" (文献全景合成建筑师). Your task is to process a BATCH of structured research intelligence (6 streams per paper) and generate a unified "SOTA Landscape" and "Conflict Matrix".

【Input Information】
--- Research Blueprint: PI's Original Hypothesis ---
{PI_HYPOTHESIS}

--- Data Buffer: Analyzed Papers Array ---
{ANALYZED_PAPERS_LIST}

【Execution Protocol & Chain of Thought】
Before generating the final JSON, you MUST output your reasoning in `<think>...</think>`.
1. Taxonomy Grouping: Scan all `one_sentence_formula` fields. Cluster papers into 2-3 technical schools.
2. Contradiction Search: Compare `exp_results` and `cons_and_weaknesses` across different papers. Identify where authors disagree.
3. Gap Mapping: Compare the unified clusters against {PI_HYPOTHESIS}. Is our idea a duplicate or a breakthrough?

【Output Format Requirements】
Output ONLY a valid JSON object.

{{
  "sota_landscape": {{
    "clusters": [
      {{
        "theme": "技术流派名称",
        "papers": ["ID1", "ID2"],
        "combined_logic": "该流派的统一逻辑路径"
      }}
    ],
    "conflict_matrix": [
      {{
        "variable": "争议变量 (如：显存占用)",
        "debate": "文献 A 声称有效，但文献 B 的精读报告指出在大规模场景下崩溃。",
        "our_pivot": "我们应如何利用这一冲突点？"
      }}
    ]
  }},
  "scoop_protection_report": {{
    "risk_level": "[CRITICAL / HIGH / MEDIUM / LOW]",
    "killer_paper_id": "最威胁我们的那篇论文ID",
    "differentiation_strategy": "针对最相似文献的差异化突围建议"
  }},
  "hitl_gateway": {{
    "recommendation": "[Approve] / [Retry] / [Rollback]",
    "reasoning": "给人类 PI 的一句话决策建议。"
  }}
}}

【Language Output Constraint】
All generated text inside the `<think>` tags and the string VALUES within the JSON MUST be generated entirely in professional academic Chinese (Mandarin).
```

---

### 4. 视觉化理解：文献图谱聚合逻辑

为了让你直观感受 6 个数据流如何被“揉碎”并重新“重组”为图谱，我为你准备了一个**多维文献合成模拟器**。你可以观察到个体文献的零散特征（节点）是如何在算法和结果的引力下汇聚成技术流派（簇），并暴露出创新空间的。

```json?chameleon
{"component":"LlmGeneratedComponent","props":{"height":"800px","prompt":"作为一个‘多维文献合成模拟器’。系统模拟接收 5 篇文献的 6 维度提取数据。\n\n核心逻辑：\n1. 初始状态：展示 5 个代表论文的‘数据卡片’，每张卡片含：一句话公式、算法关键词、准确率结果、局限性。\n2. 功能：‘执行跨文献合成’。点击后，系统通过 D3.js 物理力导向图展示：\n   - 节点关联：算法相似的论文会相互吸引成簇。\n   - 冲突标记：如果两篇论文对同一基线的提升数据差异巨大，连线变为红色并闪烁，点击可查看‘争议点’。\n   - 抢发雷达：输入一个‘PI 假说’，系统会在图谱中扫描其位置。如果与现有节点重合度极高，标记为红色警告区域。\n3. 下方显示‘聚合审查报告’，动态汇总当前的‘技术流派’、‘行业共识’与‘尚未解决的痛点’。\n4. 交互：用户可以拖动论文卡片，观察图谱如何重组。\n5. 界面：使用深色科技风格，中文 UI。","id":"im_d78e75c7317b350b"}}
```

### 🐍 Python 编排层伪代码示例

在你的 `Literature Ground` Sub-Agent 脚本中，实现逻辑如下：

```python
# 1. 获取所有篇章的提取结果
all_results = []
for paper in papers_list:
    # 这里并发调用 Skill A, B, C 并汇聚成单篇的 dictionary
    extraction = {
        "paper_id": paper.id,
        "data_streams": {
            "macro": call_skill_a(paper.content),
            "tech": call_skill_b(paper.content),
            "critical": call_skill_c(paper.content)
        }
    }
    all_results.append(extraction)

# 2. 注入聚合节点
aggregation_prompt = template.format(
    PI_HYPOTHESIS=initial_idea,
    ANALYZED_PAPERS_LIST=json.dumps(all_results, ensure_ascii=False)
)

# 3. 获取最终合成 JSON，供人类点击 Approve/Rollback
final_report = llm.call(aggregation_prompt)
```

这种设计确保了数据流的**完整性**和**原子性**：每一篇文献的 6 个维度都作为不可分割的“特征向量”参与到全局的对撞与合成中。
