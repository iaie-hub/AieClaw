# Skill: mas4s-literature-pdf-to-markdown

## 设计理念 (Design Philosophy)

学术论文通常采用复杂的多栏排版，并包含大量的数学公式、图表和引用，传统的 OCR 或规则解析方法难以保证语义的完整性。`mas4s-literature-pdf-to-markdown` 技能通过引入**多模态大模型 (VLM)** 视觉解析能力，将 PDF 逐页转换为高保真的 Markdown 文献。

本技能通过 300 DPI 的高清晰度图像渲染与深度视觉推理（Chain of Thought），精准处理公式提取与版面识别，并内置了针对 VLM 调用波动的**双轮鲁棒重试机制**。

## 解决方案架构 (Solution Architecture)

### 核心功能

- **视觉驱动解析**：将 PDF 页面渲染为 300 DPI 图像，利用 VLM 的视觉感知能力进行文字、标题、公式及表格的结构化提取。
- **思维链 (CoT) 指引**：Prompt 要求模型在解析前输出 `<think>` 块，分析页面布局（单/双栏）和元素优先级，确保阅读顺序准确。
- **鲁棒重试与拯救**：
  - **单页重试**：VLM 调用超时或失败后 sleep 2 秒，单页最多重试 5 次。
  - **全量重试 (第二轮)**：首轮结束后，针对所有失败的论文进行最后一轮集中修复尝试（同样 5 次机会，2 秒间隔）。
- **结构化回写**：更新输入元数据，增加 `markdown_path` 字段，为后续的深度分析 agent 提供标准的文本输入。

### 输入 (Input)

- `downloaded_papers.json`：由下载技能产出的已获取全文的文献列表。
  - `pdf_path`: PDF 物理路径
  - `id`: 论文 ID

### 输出 (Output)

- **物理文件**：与 PDF 同目录下的 Markdown 文件（同名 `.md`）。
- **结果清单**：`parsed_papers.json`（复制输入文件并增加 `markdown_path` 字段）。

## 任务执行 SOP (Standard Operating Procedure)

1. **环境初始化**：读取 `run_id`，初始化 `ProgressReporter` 追踪解析进度。
2. **任务队列构建**：解析 `downloaded_papers.json`，检查 PDF 文件是否存在。
3. **第一轮转换**：
   - **图像化**：使用 `PyMuPDF` 以 300 DPI 将 PDF 页面转为 Base64 图像。
   - **并发调用**：多线程并发调用 VLM（如 Qwen-VL 或 GPT-4o）。
   - **异常拦截**：若单页转换失败，sleep 2s 重试。若单篇论文有页面彻底失败，标记该论文进入 `failed_list`。
4. **第二轮拯救**：
   - 针对 `failed_list` 中的论文，清空已有的中间状态，重新执行全流程转换。
5. **元数据持久化**：
   - 统计成功篇目，生成 `parsed_papers.json`。
   - 在 PDF 所在子目录生成最终的 `.md` 文件。

## 异常处理 (Exception Handling)

- **VLM 限制**：若模型输出包含 Thinking Block，自动进行过滤以保证 Markdown 纯净度。
- **超长页面**：若单页内容过多导致 Context 溢出，记录错误并标记为转换失败，触发重试。
- **并发控制**：动态控制并发线程数，防止触发下游 API 的 Rate Limit。
