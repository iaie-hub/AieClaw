## 硬核解构引擎 Skill (Technical Deconstruction Skill) 设计方案

### 一、 设计理念

1.  **客观还原**：剥离文献中的所有修辞，仅保留算法逻辑、实验配置与量化结果。
2.  **因果一致性**：确保提取出的算法改动与观察到的实验结果之间存在逻辑上的闭环。
3.  **标准化度量**：将零散的实验结论转化为可对比的 SOTA 状态与提升百分比，为知识图谱提供结构化数据。
4.  **特征表支撑**：承担文献全景特征表中的“方法实证”与“核心构念”维度字段提取。

### 二、 设计方案

该 Skill 专注于深层逻辑链，从 Methodology、Experiments 和 Results 章节中提取硬核细节。

| 负责字段              | 说明                                                          | 认知深度 |
| :-------------------- | :------------------------------------------------------------ | :------- |
| **core_constructs**   | 核心构念与定义（自变量 IV、因变量 DV、中介/调节变量及其定义） | 变量层   |
| **empirical_design**  | 研究范式/实验设计（范式类型、被试特征、样本量、因子设计）     | 实验层   |
| **measurement_tools** | 测量工具/指标（量表、行为指标、生理记录装置及其信效度）       | 度量层   |
| **key_findings**      | 关键发现/效应量（统计显著结果、效应大小、意外发现、零结果）   | 事实层   |
| **algorithm**         | 核心机制、数学突破与技术依赖                                  | 深层逻辑 |

### 三、 实现流程

| 步骤 | 动作     | 说明                                                        |
| :--- | :------- | :---------------------------------------------------------- |
| 1    | 数据加载 | 读取 `parsed_papers.json` 及 PI 核心假说。                  |
| 2    | 硬核解构 | 针对每篇论文的 Markdown 全文进行技术细节解构。              |
| 3    | 结果落盘 | 在论文 arXiv ID 目录下生成 `paper_technical_details.json`。 |

### 四、 输入参数

| 参数名       | 类型   | 必填 | 默认值     | 说明            |
| :----------- | :----- | :--- | :--------- | :-------------- |
| **run_id**   | String | 是   | -          | 执行 ID。       |
| **agent_id** | String | 否   | "evidence" | 当前 Agent ID。 |

**输入文件**：`~/.openclaw/workspace-literature/task/{run_id}/parsed_papers.json`

### 五、 输出参数

**输出文件**：`~/.openclaw/workspace-literature/task/{run_id}/papers/{arxiv_id}/paper_technical_details.json`

| 字段名                | 类型   | 说明                                       |
| :-------------------- | :----- | :----------------------------------------- |
| **core_constructs**   | Object | 包含 IV, DV, Mediator 的定义及操作化说明。 |
| **empirical_design**  | String | 描述研究范式与因子设计。                   |
| **measurement_tools** | String | 描述所使用的工具、指标与信效度。           |
| **key_findings**      | String | 关键统计发现与效应量。                     |
| **algorithm**         | Object | 算法核心与数学逻辑。                       |

### 六、 示例

#### 6.1 运行示例

```bash
python3 scripts/mas4s_evidence_deep_analysis_technical_deconstruction.py '{"run_id": "run_222"}'
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
    "core_constructs": {
      "iv": "任务相似度 (Task Similarity), 定义为向量余弦距离",
      "dv": "旧任务准确率降幅 (Forgetting Rate)",
      "mediator": "特征泛化梯度 (Feature Generalization Gradient)"
    },
    "empirical_design": "计算模拟实验，2x2 组内因子设计：训练序列（交替/集中）x 任务相似度（高/低）",
    "measurement_tools": "准确率量表 (Accuracy Metric), 特征图可视化工具, 信度 alpha=0.89",
    "key_findings": "高相似度+交替训练使遗忘减少18% (η²=0.14), 显著性 p<0.01",
    "algorithm": {
      "core_mechanism": "引入海马体索引（Hippocampal Indexing）理论，通过向量索引管理长短期记忆。",
      "math_or_logic_breakthrough": "定义了基于 Ebbinghaus 遗忘曲线的动态权重衰减函数 $W(t) = e^{-t/S}$。",
      "dependencies": ["PyTorch", "Milvus", "Llama-3-70B"]
    }
  }
}
```

### 八、 SOP 观测支持

- **进度上报**：按论文逐篇上报 `item`。
- **进度文件路径**：`~/.openclaw/workspace-<agentId>/task/<run_id>/progress_mas4s_technical_deconstruction.jsonl`
