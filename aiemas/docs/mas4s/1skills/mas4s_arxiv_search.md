## arXiv 学术搜索 Agent (Arxiv Search) 设计方案

### 一、 设计理念

1. **学术边界对齐**：专注获取 SOTA 论文与理论突破。
2. **渐进式降级检索**：从严到宽的降级逻辑，确保稳健性。
3. **低噪情报提取**：仅提取标题、作者及核心摘要。

### 二、 设计方案

#### 降级检索矩阵

| 场景     | 动作         | 目的                        |
| :------- | :----------- | :-------------------------- |
| **首选** | 原始布尔检索 | 精确匹配。                  |
| **次选** | 语法简化     | 移除引号和括号。            |
| **保底** | 关键词截断   | 逐步减少关键词（8→4→2→1）。 |

### 三、 实现流程

| 步骤 | 动作       | 说明                                             |
| :--- | :--------- | :----------------------------------------------- |
| 1    | 输入解析   | 读取 `idea_query_expand.json`，优先 `query_en`。 |
| 2    | 循环搜索   | 遍历检索式列表调用 arXiv。                       |
| 3    | 动态降级   | 无结果时触发渐进式降级。                         |
| 4    | 结果标准化 | 统一为 `id`, `title`, `author`, `summary`。      |
| 5    | JSON 交付  | 保存至 `arxiv_search_results.json`。             |

### 四、 输入参数

所有文件集中存放于 `~/.openclaw/workspace-{agent_id}/task/{run_id}/`。

| 参数名         | 类型    | 必填 | 默认值              | 说明                        |
| :------------- | :------ | :--- | :------------------ | :-------------------------- |
| **run_id**     | String  | 是   | -                   | 执行 ID，用于定位运行目录。 |
| **agent_id**   | String  | 否   | "idea-align"        | Agent ID。                  |
| **numResults** | Integer | 否   | 20                  | 每个检索式返回的结果数量。  |
| **mirror**     | String  | 否   | "https://arxiv.org" | 镜像地址。                  |

**固定输入文件**：`idea_query_expand.json`

### 五、 输出参数

**固定输出文件**：`arxiv_search_results.json`

| 字段名                | 类型   | 说明             |
| :-------------------- | :----- | :--------------- |
| **query**             | String | 原始英文检索式。 |
| **results**           | Array  | 论文结果列表。   |
| **results[].id**      | String | arXiv 论文 ID。  |
| **results[].title**   | String | 论文标题。       |
| **results[].author**  | String | 作者列表。       |
| **results[].summary** | String | 核心摘要。       |

### 六、 示例

#### 6.1 运行示例

```bash
python3 scripts/mas4s_arxiv_search.py '{"run_id": "run_20260423"}'
```

#### 6.2 目录结构示例

```
~/.openclaw/workspace-idea-align/task/run_20260423/
├── idea_query_expand.json              # 输入
├── arxiv_search_results.json           # 输出
└── progress_mas4s_arxiv_search.jsonl
```

### 七、 Prompt

> [!NOTE]
> 本技能为**确定性工具技能**，不包含大模型 System Prompt。核心逻辑由 Python 脚本驱动 arXiv 爬虫。

### 八、 SOP 观测支持

- **进度文件路径**：`~/.openclaw/workspace-<agentId>/task/<run_id>/progress_mas4s_arxiv_search.jsonl`
- **上报机制**：`lib.progress.ProgressReporter`
