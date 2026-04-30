## 学术论文搜索 Agent (Question: arXiv Search) 设计方案

### 一、 设计理念

1. **学术前沿对齐**：专注获取最新学术论文、理论框架及 SOTA 算法。
2. **多源检索式执行**：针对多个维度生成针对学术库优化的纯英文布尔检索式。
3. **结构化摘要提取**：为后续头脑风暴提供高质量的理论输入。

### 二、 设计方案

- **检索引擎**：arXiv API / Scraper。
- **检索式处理**：优先使用 `query_en` 纯英文布尔检索式。若无结果，执行自动降级策略（去布尔语法、关键词截断）。
- **结果精简**：保留 `id`, `title`, `link`, `author`, `summary`。

### 三、 实现流程

| 步骤 | 动作        | 说明                                                |
| :--- | :---------- | :-------------------------------------------------- |
| 1    | 输入解析    | 读取 `idea_query_expand.json` 中的 `queries` 数组。 |
| 2    | arXiv 检索  | 循环调用 arXiv 检索接口，包含失败重试与降级逻辑。   |
| 3    | 结果聚合    | 将论文摘要与原始 query 关联。                       |
| 4    | JSON 序列化 | 保存至 `arxiv_search_results.json`。                |

### 四、 输入参数

所有文件集中存放于 `~/.openclaw/workspace-{agent_id}/task/{run_id}/`。

| 参数名         | 类型    | 必填 | 默认值              | 说明                        |
| :------------- | :------ | :--- | :------------------ | :-------------------------- |
| **run_id**     | String  | 是   | -                   | 执行 ID，用于定位运行目录。 |
| **agent_id**   | String  | 否   | "question"          | Agent ID。                  |
| **numResults** | Integer | 否   | 20                  | 每个检索式返回的结果数量。  |
| **mirror**     | String  | 否   | "https://arxiv.org" | arXiv 访问镜像地址。        |

**固定输入文件**：`idea_query_expand.json`

### 五、 输出参数

**固定输出文件**：`arxiv_search_results.json`

| 字段名                | 类型   | 说明             |
| :-------------------- | :----- | :--------------- |
| **query**             | String | 原始英文检索式。 |
| **results**           | Array  | 论文结果列表。   |
| **results[].id**      | String | arXiv 论文 ID。  |
| **results[].title**   | String | 论文标题。       |
| **results[].link**    | String | 论文详情页链接。 |
| **results[].author**  | String | 作者列表。       |
| **results[].summary** | String | 核心摘要。       |

### 六、 示例

#### 6.1 运行示例

```bash
python3 scripts/mas4s_question_arxiv_search.py '{"run_id": "run_20260423"}'
```

#### 6.2 目录结构示例

```
~/.openclaw/workspace-topic/task/run_20260423/
├── idea_query_expand.json              # 输入（由 query-expand 产出）
├── arxiv_search_results.json           # 输出
└── progress_mas4s_question_arxiv_search.jsonl
```

### 七、 Prompt

> [!NOTE]
> 本技能为**确定性工具技能**，不包含大模型 System Prompt。核心逻辑由 Python 脚本驱动 arXiv API 调用。

### 八、 SOP 观测支持

- **进度文件路径**：`~/.openclaw/workspace-<agentId>/task/<run_id>/progress_mas4s_question_arxiv_search.jsonl`
- **上报机制**：`lib.progress.ProgressReporter`
