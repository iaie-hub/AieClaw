# 全稿整合与格式校对 (Final Integration)

## 1. 技能概述 (Overview)

`mas4s-writing-integrate` 是 MAS4S 论文写作流水线的最后一步。该技能扮演“学术排版员”的角色，负责创建 `main.tex` 主控文件，并利用 LaTeX 的 `\input` 机制将前序步骤生成的章节片段（Abstract, Intro, Method, Experiment, Discussion）组装成全文，最后触发物理编译生成 PDF。

## 2. 核心逻辑 (Core Logic)

1.  **骨架与血肉分离 (Modular Assembly)**：`main.tex` 只包含导言区（Preamble）和组装指令，不含具体正文内容，确保数据来源的唯一性。
2.  **防御性导言区**：自动加载 `algorithm2e` (算法)、`booktabs` (表格)、`graphicx` (绘图) 等核心宏包，确保前序步骤生成的复杂格式能成功编译。
3.  **自动化编译流水线**：脚本会自动尝试调用 `pdflatex` 和 `bibtex` 进行多次交叉编译，以生成带有正确引用和目录的 `main.pdf`。

## 3. 输入输出 (Input & Output)

- **输入**：
  - `pi_result_en.json` (Stage 1): 用于提取论文标题与作者信息。
  - 所有前序片段：`section_abstract.tex`, `section_intro.tex`, `section_method.tex`, `section_experiment.tex`, `section_discussion_related.tex`。
  - `references.bib` (Stage 2): 参考文献数据库。
- **输出**：
  - `main.tex`: 组装后的主控文件。
  - `main.pdf`: (可选) 最终编译生成的论文预览。
  - `integration_report.json`: 排版与编译审计简报。

## 4. 调用示例 (Usage)

### Python 调用

```bash
python scripts/mas4s_writing_integrate.py '{"run_id":"run_20260428"}'
```

### 参数说明

- `run_id`: 必填。
- `compile`: (可选) 布尔值，是否尝试在本地触发 `pdflatex` 编译，默认为 `true`。

## 5. 设计约束 (Design Constraints)

- **只写框架**：严禁在 `main.tex` 中重写正文。
- **环境降级**：若宿主机未安装 LaTeX 环境，脚本将仅保存 `.tex` 源文件并发出警告，不强制阻塞流水线。
