## 智能文献降噪 Agent (Intelligent Noise Reduction) 设计方案

### 一、 设计理念

1.  **事实锚定**：以 PI 产出的核心假说（Hypothesis）为唯一锚点。
2.  **暴力降噪**：在昂贵的 PDF 下载与深度阅读之前，通过摘要（Summary）进行首轮相关性审计。
3.  **阻断冗余**：剔除边缘学科论文，仅保留对课题具有实质性启发或反驳价值的文献。

### 二、 设计方案

#### 降级与决策矩阵

| 决策        | 触发条件                                         | 后续动作               |
| :---------- | :----------------------------------------------- | :--------------------- |
| **KEEP**    | 摘要明确涉及核心变量或方法论，与 PI 假说强相关。 | 进入 PDF 下载队列。    |
| **DISCARD** | 仅关键词重合，但属于不同领域或应用场景。         | 阻断，不进行后续处理。 |
| **DOUBT**   | 存在跨学科启发可能性或不确定相关性。             | **保守处理：KEEP**。   |

### 三、 实现流程

| 步骤 | 动作     | 说明                                                |
| :--- | :------- | :-------------------------------------------------- |
| 1    | 情报对齐 | 读取阶段 1 的 `pi_result.json`（PI 假说锚点）。     |
| 2    | 摘要加载 | 读取 arXiv 搜索产出的 `arxiv_search_results.json`。 |
| 3    | 智能审计 | 调用 LLM（如 Gemini 2.0 Pro）对摘要进行相关性评估。 |
| 4    | 报告生成 | 产出 `denoising_report.json`（决策依据）。          |
| 5    | 过滤输出 | 保存 `filtered_papers.json`（精简后的文献列表）。   |

### 四、 输入参数

| 参数名             | 类型   | 必填 | 默认值       | 说明                                |
| :----------------- | :----- | :--- | :----------- | :---------------------------------- |
| **run_id**         | String | 是   | -            | 执行 ID，用于定位运行目录。         |
| **agent_id**       | String | 否   | "evidence"   | 当前 Agent ID (Phase 2)。           |
| **input_agent_id** | String | 否   | "idea-align" | 阶段 1 Agent ID，用于寻找 PI 假说。 |

**输入文件 1 (锚点)**：`~/.openclaw/workspace-idea-align/task/{run_id}/pi_result.json`
**输入文件 2 (原文)**：`~/.openclaw/workspace-literature/task/{run_id}/arxiv_search_results.json`

### 五、 输出参数

**输出文件 1 (报告)**：`denoising_report.json`
**输出文件 2 (结果)**：`filtered_papers.json`

| 字段名         | 类型   | 说明                               |
| :------------- | :----- | :--------------------------------- |
| **arxiv_id**   | String | arXiv 论文 ID。                    |
| **action**     | String | 决策动作 (KEEP / DISCARD)。        |
| **confidence** | String | 信心指数 (HIGH / MEDIUM / LOW)。   |
| **reason**     | String | 决策理由（中英文结合，精准简练）。 |

### 六、 示例

#### 6.1 运行示例

```bash
python3 scripts/mas4s_evidence_noise_reduction.py '{"run_id": "run_20260424"}'
```

#### 6.2 目录结构示例

```
# 输入来源
~/.openclaw/workspace-idea-align/task/run_20260424/pi_result.json

# 当前输出
~/.openclaw/workspace-literature/task/run_20260424/
├── arxiv_search_results.json           # 输入
├── denoising_report.json               # 输出：审计报告
├── filtered_papers.json                # 输出：过滤后的文献
└── progress_mas4s_intelligent_denoising.jsonl
```

### 七、 Prompt

> [!TIP]
> 该技能使用思维链（Chain of Thought）技术，在返回最终决策前先进行逻辑推演。

（此处略去完整 Prompt，详见脚本实现）

### 八、 SOP 观测支持

- **进度文件路径**：`~/.openclaw/workspace-<agentId>/task/<run_id>/progress_mas4s_intelligent_denoising.jsonl`
- **上报机制**：`lib.progress.ProgressReporter`
