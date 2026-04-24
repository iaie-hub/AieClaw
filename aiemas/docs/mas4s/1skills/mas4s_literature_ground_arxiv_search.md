## 事实定标学术搜索 Agent (Literature Ground arXiv Search) 设计方案

### 一、 设计理念

1.  **高精度对齐**：基于 PI 阶段产出的核心假说与关键词矩阵进行精准对齐搜索。
2.  **深度挖掘**：不仅获取摘要，还通过渐进式降级确保检索覆盖面，为后续 PDF 下载与精读提供高质量候选。
3.  **标准化输出**：产出包含 arXiv ID、标题、摘要及 PDF 链接的标准化 JSON，无缝对接后续下载环节。

### 二、 设计方案

#### 降级检索矩阵

| 场景     | 动作         | 目的                         |
| :------- | :----------- | :--------------------------- |
| **重试** | 失败重试     | sleep 2s 重试 3 次确保稳定。 |
| **首选** | 原始布尔检索 | 精确匹配。                   |
| **次选** | 语法简化     | 移除引号和括号。             |
| **保底** | 关键词截断   | 逐步减少关键词（8→4→2→1）。  |

### 三、 实现流程

| 步骤 | 动作       | 说明                                                                    |
| :--- | :--------- | :---------------------------------------------------------------------- |
| 1    | 输入解析   | 读取 `pi_result.json`。                                                 |
| 2    | 关键词提取 | 从 `search_and_retrieval_strategy.literature_keywords` 提取关键词数组。 |
| 3    | 循环搜索   | 遍历关键词数组，**对每个关键词独立发起一次** arXiv 检索。               |
| 4    | 动态降级   | 无结果时触发渐进式降级逻辑。                                            |
| 5    | 结果标准化 | 统一为 `id`, `title`, `author`, `summary`, `link`。                     |
| 6    | JSON 交付  | 保存至 `arxiv_search_results.json`。                                    |

### 四、 输入参数

| 参数名             | 类型    | 必填 | 默认值              | 说明                                |
| :----------------- | :------ | :--- | :------------------ | :---------------------------------- |
| **run_id**         | String  | 是   | -                   | 执行 ID，用于定位运行目录。         |
| **agent_id**       | String  | 否   | "literature-ground" | 当前 Agent ID (Phase 2)。           |
| **input_agent_id** | String  | 否   | "idea-align"        | 阶段 1 Agent ID，用于寻找输入文件。 |
| **numResults**     | Integer | 否   | 20                  | 每个检索式返回的结果数量。          |
| **mirror**         | String  | 否   | "https://arxiv.org" | 镜像地址。                          |

**固定输入路径**：`~/.openclaw/workspace-{input_agent_id}/task/{run_id}/pi_result.json`

### 五、 输出参数

**固定输出文件**：`arxiv_search_results.json`
| 字段名 | 类型 | 说明 |
| :-------------------- | :----- | :----------------------------------- |
| **query** | String | 原始检索关键词。 |
| **results** | Array | 论文结果列表。 |
| **results[].id** | String | arXiv 论文 ID。 |
| **results[].title** | String | 论文标题。 |
| **results[].author** | String | 作者列表。 |
| **results[].summary** | String | 核心摘要。 |
| **results[].link** | String | 论文详情页链接。 |
| **results[].pdf_link**| String | 论文 PDF 直接下载链接。 |

### 六、 示例

#### 6.1 运行示例

```bash
python3 scripts/mas4s_literature_ground_arxiv_search.py '{"run_id": "run_20260424"}'
```

#### 6.2 目录结构示例

```
# 阶段 1 目录 (输入)
~/.openclaw/workspace-idea-align/task/run_20260424/
└── pi_result.json

# 阶段 2 目录 (输出)
~/.openclaw/workspace-literature-ground/task/run_20260424/
├── arxiv_search_results.json
└── progress_mas4s_literature_ground_arxiv_search.jsonl
```

### 七、 Prompt

> [!NOTE]
> 本技能为**确定性工具技能**，不包含大模型 System Prompt。核心逻辑由 Python 脚本驱动 arXiv 爬虫。

### 八、 SOP 观测支持

- **进度文件路径**：`~/.openclaw/workspace-<agentId>/task/<run_id>/progress_mas4s_literature_ground_arxiv_search.jsonl`
- **上报机制**：`lib.progress.ProgressReporter`
