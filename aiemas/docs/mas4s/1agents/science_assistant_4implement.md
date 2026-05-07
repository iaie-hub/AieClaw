# 代码实现 Agent (Science Assistant: Implementation)

## 1. 概述 (Overview)

**Science Assistant: Implementation** 是专门用于将阶段 3 产出的实验设计蓝图（`method_blueprint.json`）与评估协议（`eval_protocol.json`）转化为可运行、可验证、工业级实验资产的智能 Agent。其核心目标是构建完整的数据资产、实现提案方法代码、复现基线管线，并通过容器化技术冻结实验环境，确保科研工作在进入阶段 5（实验执行）前处于“一键运行”且“结果可复现”的状态。

该 Agent 遵循“资产代码化，环境不可变，验证单元化”的核心理念，通过自动化的工程实践消除实验过程中的偶然性与不确定性。

## 2. 核心 SOP 流程 (Standard Operating Procedure)

Agent 严格遵循以下四步 SOP 流程执行任务：

1.  **数据资产构建**：制备数据集、固化预处理流水线并生成基准特性报告。
2.  **提案方法代码实现**：将算法蓝图转化为正式代码并完成单元测试。
3.  **基线复现与评估管线**：拉取/复现对比方法并统一评估接口。
4.  **容器化与环境冻结**：封装实验环境，通过迷你实验验证端到端闭环。

### 详细步骤说明：

### 步骤 1：数据资产构建 (Data Asset Building)

- **详细设计**：[mas4s_4implement_data_build.md](../1skills/mas4s_4implement_data_build.md)
- **技能调用**：[`mas4s-implement-data-build`](file:///Users/admin/clawd/skills/mas4s-implement-data-build/SKILL.md)
- **输入**：`eval_protocol.json`（阶段 3）。
- **动作**：下载或生成所需数据集，固化清洗与预处理代码，执行初步的探索性分析（EDA）。记录数据的分布、缺失值情况及版本信息。
- **输出**：`data_asset_report.json` + 数据制备代码脚本 (`preprocessing_script.py`)。
  - **输出文件使用说明**：
    - `data_asset_report.json`（及中英双语版本）：包含数据溯源、健康度验证计划及防泄漏验证策略，此报告将作为“实验执行 (Stage 5)”的重要合规性证明，同时前端会展示 `data_asset_brief.md` 简报。
    - `preprocessing_script.py`：由智能体生成的完整 Python 预处理流水线脚本（内置了严格的防泄漏断言检查，如 `ensure_contamination_free`）。由于数据集通常较大或需特定环境访问，人类研究员需审阅并在受控环境中**手动或通过 CI 执行该脚本**（例如 `python preprocessing_script.py`），从而真正在本地落盘最终供算法实现与评估管线使用的物理数据集（如 `init_set.jsonl`, `test_set.jsonl`）。

### 步骤 2：提案方法代码实现 (Method Implementation)

- **详细设计**：[mas4s_4implement_method.md](../1skills/mas4s_4implement_method.md)
- **技能调用**：[`mas4s-implement-method`](file:///Users/admin/clawd/skills/mas4s-implement-method/SKILL.md)
- **输入**：`method_blueprint.json` + `problem_formulation.json`。
- **动作**：根据算法蓝图编写正式的 Python/C++ 代码，并为核心模块编写单元测试。生成详细的代码文档与第三方依赖清单（requirements.txt/pyproject.toml）。
- **输出**：提案方法源代码 + `unit_test_report.json`。

### 步骤 3：基线复现与评估管线 (Baseline Pipeline)

- **详细设计**：[mas4s_4implement_baseline.md](../1skills/mas4s_4implement_baseline.md)
- **技能调用**：[`mas4s-implement-baseline`](file:///Users/admin/clawd/skills/mas4s-implement-baseline/SKILL.md)
- **输入**：`baseline_manifest.json` + `eval_protocol.json`。
- **动作**：拉取开源基线代码或根据文献逻辑复现基线，封装统一的推理接口（Interface Wrapper），编写能够自动化运行所有对比方法的评估管线。
- **输出**：`baseline_reproduction_report.json` + 评估管线代码。

### 步骤 4：容器化与环境冻结 (Containerization)

- **详细设计**：[mas4s_4implement_containerize.md](../1skills/mas4s_4implement_containerize.md)
- **技能调用**：[`mas4s-implement-containerize`](file:///Users/admin/clawd/skills/mas4s-implement-containerize/SKILL.md)
- **输入**：整个项目代码库（含数据脚本、提案代码、基线代码）。
- **动作**：生成标准的 Dockerfile，锁定 Python/CUDA 依赖版本与随机种子。在容器内运行迷你实验（Mini-Experiment）以验证端到端流程无 Bug。
- **输出**：`Dockerfile` + `environment_snapshot.json` + 迷你实验通过日志。

### 2.1 阶段产出脚本整体联动说明 (Script Linkage & Workflow)

在阶段 4 的四个步骤全部执行完毕后，各个智能体产出的独立脚本将组合成一个高度内聚、自动化的评估实验工厂。它们的整体联动与使用流程如下：

1. **环境准备与基石（人类/CI 触发）**：
   - 首先，在配置了各项 `requirements.txt` 的运行环境中，人类研究员或自动化 CI 系统需**手动运行 `preprocessing_script.py`** (来自步骤 1)。此脚本将在本地落盘真实的物理数据集（如 `init_set.jsonl`，`test_set.jsonl`）。这是后续所有测试的基石。
2. **逻辑自洽准入测试（单元测试）**：
   - 接着，执行 `test_method_implementation.py` (来自步骤 2)。该脚本导入 `method_implementation.py` 并对其执行断言测试。只有全量测试通过，才能证明提案方法在工程上是健壮的。
3. **管线总入口与统一评估（核心循环）**：
   - 当数据就绪且提案方法通过测试后，**`evaluation_pipeline.py`** (来自步骤 3) 将作为整个实验评估的**主入口 (Entry Point)** 被调用运行（在未来的 Stage 5 执行环节）。
   - 该主循环脚本会主动加载落盘的数据集，同时引入 `method_implementation.py`（作为 SOTA 候选）和 `baseline_wrappers.py`（封装的其他基线），在一个统一且隔离的评测循环中让它们在同等测试条件下进行跑分打擂。
4. **冰封实验现场（不可变执行）**：
   - 最终，通过运行 **`Dockerfile`** (来自步骤 4)，将上述所有的脚本流、库依赖版本和数据读取逻辑打包冻结为不可变容器，从而保证后续无论何时何地运行 `evaluation_pipeline.py`，都能得出严格一致的结果。

---

## 3. 实现规范 (Implementation Specification)

为了确保代码 quality 与可复现性，Agent 在产出交付物时需遵循以下规范：

### 3.1 资产包完整性规范

代码实现阶段产出的 `code_asset_package.json` 必须包含以下维度的信息：

| 维度             | 说明                                                                              |
| :--------------- | :-------------------------------------------------------------------------------- |
| **数据溯源**     | 记录每个数据集的原始下载 URL、MD5 哈希及采集日期。                                |
| **测试覆盖度**   | 核心算法逻辑的单元测试覆盖率需达到 80% 以上，并记录在 `unit_test_report` 中。     |
| **复现偏差声明** | 若基线复现值与原论文报告值偏差超过 5%，必须显式标记并分析原因（如硬件平台差异）。 |
| **随机化管理**   | 全局固定 `seed` 并在 `environment_snapshot.json` 中记录。                         |

### 3.2 现实锚点与约束

- **基线复现准确度报告**：自动对比复现指标与原论文报告值，对于偏差过大的基线触发 `REPRO_GAP` 警报。
- **数据溯源完整性**：自动生成 `DATA_SOURCES.md`，记录所有数据资产的来源、版本与许可协议（License）。
- **可重复性健康检查**：必须通过端到端的迷你实验（使用 1% 的数据量跑通全流程）方可允许流转至下一阶段。

## 4. SOP 观测方案 (Observation)

Agent 的执行过程在 AIEMAS 平台中是透明可观测的：

- **步骤追踪**：前端通过 [SOP 定义](../../../docs/concepts/agent-workspace.md) 实时显示当前所处阶段。
- **进度日志**：每个技能在执行时通过 `ProgressReporter` 产生 `progress.jsonl`，上报关键决策点的逻辑推理（如“正在构建基线 A 的推理接口”）。
- **详细方案**：参考 [Agent SOP 观测方案](../agent_sop_observation.md)。

### 4.1 Skill 改造要求 (Skill Modification Requirements)

- **集成 ProgressReporter**：上报数据下载进度、测试通过率、环境镜像构建进度。
- **支持 run_id 参数 (必需)**：用于物理隔离不同次执行的进度文件。
- **标准化进度行**：包含正确的 `type` (start/item/log/done) 及 `skill` 字段。

## 5. 相关文档 (Related Docs)

- [Agent 定义](../../../docs/concepts/agent.md)
- [双锚点科研 SOP 总览](./science_assistant.md)
- [阶段 2：Literature Agent](./science_assistant_2literature.md)
- [阶段 3：Design Agent](./science_assistant_3design.md)
- [阶段 5：Execution Agent](./science_assistant_5execution.md)
