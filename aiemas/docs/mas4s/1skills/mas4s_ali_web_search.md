## 阿里网页搜索 Agent (Ali Web Search) 设计方案

### 一、 设计理念

1. **工程情报对齐**：专注获取工程痛点、行业现状、落地瓶颈。
2. **多源并发抓取**：针对多个中文检索维度并发检索。
3. **时效性优先**：默认过滤近一年结果。

### 二、 设计方案

- **检索引擎**：阿里云统一搜索 API (`LiteAdvanced`)。
- **检索式处理**：直接使用 `query_cn` 中英混编布尔检索式。
- **结果精简**：仅保留 `title`, `link`, `publishedTime`, `snippet`。

### 三、 实现流程

| 步骤 | 动作        | 说明                                                |
| :--- | :---------- | :-------------------------------------------------- |
| 1    | 输入解析    | 读取 `idea_query_expand.json` 中的 `queries` 数组。 |
| 2    | API 检索    | 循环调用阿里云搜索 API。                            |
| 3    | 结果聚合    | 将搜索结果与原始 query 关联。                       |
| 4    | JSON 序列化 | 保存至 `web_search_results.json`。                  |

### 四、 输入参数

所有文件集中存放于 `~/.openclaw/workspace-{agent_id}/task/{run_id}/`。

| 参数名         | 类型    | 必填 | 默认值       | 说明                        |
| :------------- | :------ | :--- | :----------- | :-------------------------- |
| **run_id**     | String  | 是   | -            | 执行 ID，用于定位运行目录。 |
| **agent_id**   | String  | 否   | "idea-align" | Agent ID。                  |
| **numResults** | Integer | 否   | 20           | 每个检索式返回的结果数量。  |
| **timeRange**  | String  | 否   | "OneYear"    | 时间范围。                  |

**固定输入文件**：`idea_query_expand.json`

### 五、 输出参数

**固定输出文件**：`web_search_results.json`

| 字段名                | 类型   | 说明             |
| :-------------------- | :----- | :--------------- |
| **query**             | String | 原始中文检索式。 |
| **results**           | Array  | 搜索结果列表。   |
| **results[].title**   | String | 网页标题。       |
| **results[].link**    | String | 原始链接。       |
| **results[].snippet** | String | 网页摘要。       |

### 六、 示例

#### 6.1 运行示例

```bash
python3 scripts/mas4s_ali_web_search.py '{"run_id": "run_20260423"}'
```

#### 6.2 目录结构示例

```
~/.openclaw/workspace-idea-align/task/run_20260423/
├── idea_query_expand.json             # 输入（由 query-expand 产出）
├── web_search_results.json            # 输出
└── progress_mas4s_ali_web_search.jsonl
```

### 七、 Prompt

> [!NOTE]
> 本技能为**确定性工具技能**，不包含大模型 System Prompt。核心逻辑由 Python 脚本驱动 API 调用。

### 八、 SOP 观测支持

- **进度文件路径**：`~/.openclaw/workspace-<agentId>/task/<run_id>/progress_mas4s_ali_web_search.jsonl`
- **上报机制**：`lib.progress.ProgressReporter`
