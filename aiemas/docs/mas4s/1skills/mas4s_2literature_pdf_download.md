# Skill: mas4s-literature-pdf-download

## 设计理念 (Design Philosophy)

在科学研究生命周期中，获取原始文献全文是深度分析的基础。`mas4s-literature-pdf-download` 技能专门负责从 arXiv 等学术平台自动化、高可靠地获取 PDF 文件。

由于学术服务器（如 arXiv）可能存在不稳定性或请求频率限制，本技能内置了**双轮指数级重试机制**与**并发下载能力**，确保在复杂网络环境下最大限度地提高下载成功率。

## 解决方案架构 (Solution Architecture)

### 核心功能

- **并发下载**：基于线程池实现多任务并行下载，显著缩短等待时间。
- **鲁棒重试**：
  - **第一轮尝试**：每篇论文失败后 sleep 2 秒，最多重试 5 次。
  - **第二轮拯救**：第一轮全部结束后，针对失败列表进行最后一轮集中重试（同样 5 次机会，2 秒间隔）。
- **结构化存储**：每篇论文拥有独立的存储空间，便于后续解析（如 PDF 转 Markdown）的物理隔离。
- **数据回写**：更新输入元数据，增加 `pdf_dir` 字段，为下游环节提供明确的文件路径指引。

### 输入 (Input)

- `filtered_papers.json`：由降噪技能产出的精简文献列表。
  - `arxiv_id` / `id`: 论文 ID
  - `pdf_link`: PDF 下载链接

### 输出 (Output)

- **物理文件**：`~/.openclaw/workspace-literature/task/<run_id>/papers/<arXiv.ID>/paper.pdf`
- **结果清单**：`downloaded_papers.json`（复制输入文件并增加 `pdf_dir` 字段）。

## 任务执行 SOP (Standard Operating Procedure)

1. **环境准备**：解析 `run_id`，确定物理存储根目录。
2. **列表解析**：读取 `filtered_papers.json`，构建下载任务队列。
3. **第一轮下载**：
   - 对每个 URL 发起 GET 请求。
   - 若失败，记录异常，sleep 2s 后重试，直至 5 次上限。
   - 记录彻底失败的 ID 到 `failed_list`。
4. **第二轮拯救**：
   - 遍历 `failed_list`，重新发起 5 次重试。
5. **元数据回写**：
   - 遍历原始列表，对成功下载的条目填充 `pdf_dir`。
   - 将最终列表保存为 `downloaded_papers.json`。
6. **进度汇报**：通过 `ProgressReporter` 实时更新下载进度、成功率与失败详情。

## 异常处理 (Exception Handling)

- **死链处理**：若链接 404 或解析失败，在记录日志后标记丢弃。
- **网络超时**：设置合理的 Timeout（如 60s），防止单个慢连接阻塞队列。
- **文件系统**：若磁盘空间不足或无写入权限，立即停止并报错。
