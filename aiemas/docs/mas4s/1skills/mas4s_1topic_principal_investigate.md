## 首席审计与课题定型 Agent (Question: Principal Investigation & Convergence) 设计方案

### 一、 设计理念

1. **首席研究员审计 (PI Audit)**：对 Step 4 产出的研究框架进行最后的科学性与创新性审计。
2. **价值主张提炼 (Value Proposition)**：明确解释为何该课题填补了具体的证据差距（Evidence Gap）。
3. **下游初始化 (Stage 2 Initialization)**：将 PICO 框架转化为精准的检索指令，为下一阶段的 Evidence Agent 铺路。**强制继承 Step 1 的初始检索关键词以确保搜索血统的连续性。**

### 二、 设计方案

#### 评估与决策矩阵

| 维度            | 说明                                                                |
| :-------------- | :------------------------------------------------------------------ |
| **PI 灵魂三问** | 核心差异点、失败产出价值、变量可观测性审计。                        |
| **审计简报**    | 撰写面向人类 PI 的创新性评估与执行风险分析。                        |
| **检索指令**    | 提炼 Boolean 检索词，**强制包含初始关键词**，指定推荐数据库。       |
| **HITL 网关**   | 提供 Go/No-Go 建议，引导用户进行 [Approve] / [Retry] / [Rollback]。 |

### 三、 实现流程

| 步骤 | 动作     | 说明                                         |
| :--- | :------- | :------------------------------------------- |
| 1    | 终审审计 | 运行 PI 5 标与灵魂三问审计逻辑。             |
| 2    | 课题定型 | 生成正式学术标题与核心逻辑公式。             |
| 3    | 创新评估 | 合成 `innovation_assessment_brief.md` 简报。 |
| 4    | 检索引导 | 提取 Stage 2 所需的 Evidence Directives。    |
| 5    | 双语分发 | 保存 `pi_result.json` 及其双语拆分版。       |

### 四、 输入参数

所有文件集中存放于 `~/.openclaw/workspace-{agent_id}/task/{run_id}/`。

| 参数名       | 类型   | 必填 | 说明                        |
| :----------- | :----- | :--- | :-------------------------- |
| **run_id**   | String | 是   | 执行 ID，用于定位运行目录。 |
| **agent_id** | String | 否   | Agent ID，默认 `question`。 |

**固定输入文件**：

1. `ranked_framed_hypothesis.json`：由 Step 4 产出。
2. `idea_query_expand.json`：由 Step 1 产出，用于提取 `initial_queries_en`。
3. `fatal_error.log` (可选)
4. `human_feedback.txt` (可选)

### 五、 输出参数

**固定输出文件**：`pi_result.json` (完整)、`innovation_assessment_brief.md` (简报)

| 字段名                          | 类型   | 说明                                   |
| :------------------------------ | :----- | :------------------------------------- |
| **pi_result**                   | Object | 最终科研课题定义（标题、PICO、假设）。 |
| **innovation_assessment_brief** | Object | 创新性评估、知识空白声明与执行风险。   |
| **stage_2_evidence_directives** | Object | 引导下一阶段的检索关键词与排除词。     |
| **hitl_gateway**                | Object | 给人类 PI 的决策建议与执行摘要。       |

### 六、 示例

#### 6.1 运行示例

```bash
python3 scripts/mas4s_question_principal_investigate.py '{"run_id": "run_20260423"}'
```

#### 6.2 目录结构示例

```
~/.openclaw/workspace-topic/task/run_20260423/
├── idea_query_expand.json              # 输入（由 Step 1 产出）
├── ranked_framed_hypothesis.json       # 输入（由 Step 4 产出）
├── pi_result.json                      # 完整输出
├── pi_result_en.json                   # 英文输出
├── pi_result_cn.json                   # 中文输出
├── innovation_assessment_brief.md      # 首席审计简报
└── progress_mas4s_question_principal_investigate.jsonl
```

### 七、 SOP 观测支持

- **进度文件路径**：`~/.openclaw/workspace-<agentId>/task/<run_id>/progress_mas4s_question_principal_investigate.jsonl`
- **上报机制**：`lib.progress.ProgressReporter`
