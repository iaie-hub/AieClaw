# 阶段 5 - 步骤 2：一键全量运行 (Full Run) 设计方案

### 一、 设计理念

1. **协议到执行的严格映射 (PREP-to-Execution Traceability)**：阶段 3 的 `eval_protocol.json` 只是纸面协议。本步骤必须将协议中的每一项“基线”、“消融配置”精确映射为一个可执行的任务节点，生成 `execution_manifest.json`，确保实验无遗漏。
2. **输出物理隔离 (Output Isolation)**：为了防止多个实验运行时发生数据踩踏，必须为每个评测任务分配绝对独立的输出目录（如 `results/baseline_A/`, `results/ablation_1/`），为后续的结果自动汇整提供纯净的数据源。
3. **容错与断点续跑 (Fault Tolerance & Idempotency)**：昂贵的算力环境不容许因为一个配置的偶然崩溃（如 OOM）导致整个批处理脚本挂起。生成的批量运行脚本必须具备“失败隔离（捕获异常并继续下一个任务）”和“断点续跑（检测到结果已存在则跳过）”的工业级容错能力。

### 二、 执行编排中枢矩阵

| 维度核心模块                      | 核心内容                                                                                                   | 目标下游受众                        |
| :-------------------------------- | :--------------------------------------------------------------------------------------------------------- | :---------------------------------- |
| **执行清单 (Execution Manifest)** | 中英双语的 JSON 结构，记录所有将被执行的任务 (Task ID, 对应 RQ, 执行命令, 预期输出路径)。                  | 阶段 5 步骤 4 (结果汇整) 的校验基准 |
| **全量调度脚本 (Runner Script)**  | 由 Markdown 块隔离提取的物理脚本（如 `run_orchestrator.py` 或 `.sh`），负责自动化循环调用 Stage 4 的管线。 | 物理执行器 (宿主机/容器)            |
| **全量运行简报 (Brief)**          | 面向人类 PI 展示的实验预估批次与规划总览。                                                                 | 前端 UI / 人类 PI 审计              |

### 三、 核心输出结构 Schema 定义 (`execution_manifest.json`)

| 字段名称                | 类型   | 说明                                                                                                                                                                     |
| :---------------------- | :----- | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `run_id`                | String | 全局执行 ID。                                                                                                                                                            |
| `execution_strategy`    | String | 描述调度策略（如 Sequential with try-catch, Parallel 等）。                                                                                                              |
| `tasks_en` / `tasks_cn` | Array  | **核心数组**。每个元素必须包含：`task_id` (唯一标识), `target_rq` (对应研究问题), `configuration_name` (配置名), `command` (终端执行命令), `output_dir` (独立落盘目录)。 |

---

### 四、 Prompt 模板管理 (Prompt Template Management)

为了维护单一事实来源 (Single Source of Truth)，具体的系统级 Prompt 模板已迁移并同步至 Python 执行脚本 `mas4s_execution_run.py` 中。设计方案不再保存 Prompt 文本，以防止文档与代码逻辑脱节。

---

### 五、 实施辅助指南 (Implementation Guide)

在对应的 `mas4s_execution_run.py` 脚本中，解析到 JSON 与代码块后的推荐落地逻辑：

1. **拆分落盘**：将 `tasks_en` 存为 `execution_manifest_en.json`，供 Stage 5 步骤 4 (结果汇整 Agent) 使用；`tasks_cn` 存为 `_cn.json` 供前端渲染进度条（例如：正在执行任务 2/5: 基线对比...）。
2. **执行接管**：大模型在此环节仅输出清单与调度器 `run_orchestrator.py`。随后，底层框架应使用 `subprocess` 在 Docker 环境中物理调用 `python run_orchestrator.py`（或 `bash run_orchestrator.sh`），从而真正启动实验。
3. **监控契约**：生成的 `run_orchestrator` 捕获的任何异常，都将直接写入各自的 `output_dir/error.log` 中。Stage 5 步骤 3 的 Monitor 模块即可通过轮询这些 log 文件，实时生成 `execution_anomaly_log.jsonl`，实现完美解耦。
