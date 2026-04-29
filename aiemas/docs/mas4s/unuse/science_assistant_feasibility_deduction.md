# 可行性推演与架构决断 Agent (Science Assistant: Feasibility Deduction)

## 1. 概述 (Overview)

**Science Assistant: Feasibility Deduction** 是专门用于科研课题可行性深度推演与技术架构决断的智能 Agent。其核心目标是在正式启动实验（阶段 4）之前，基于阶段 2 产出的文献底座（`literature_graph.json`），对拟定的研究架构进行全方位的软硬件雷区扫描、逻辑闭环验证及沙盘推演。

该 Agent 由极简状态机引擎（Thin Engine）驱动，通过参数化数学建模与全球技术生态实时查证，明确输出方案的《通用风险矩阵》与《标准化降维妥协方案》，确保科研投入的每一分算力都建立在工程可落地、逻辑自洽的基础之上。

## 2. 核心 SOP 流程 (Standard Operating Procedure)

Agent 的执行逻辑由极简状态机引擎驱动，核心流程如下：

1.  **输入接收**：同时接收阶段 2 的文献图谱 (`literature_graph.json`) 与阶段 1 的课题定义 (`pi_result.json`)。
2.  **全域上下文解析**：对输入进行深度解析，建立技术组件与假说的映射。
3.  **逻辑建模**：基于解析结果建立数学模型，并产生三路数据流：
    - **维度 A**：核心变量、技术路线与目标阈值（直接流向最终报告）。
    - **维度 B**：通用技术需求清单（分发至“现实锚点查证”节点）。
    - **维度 C**：通用技术需求清单 + 约束条件（分发至“沙盘推演”节点）。
4.  **双轨并行查证/压测**：
    - **现实锚点查证**：输出组件健康度、License 风险报告及物理瓶颈警告。
    - **沙盘推演**：输出优缺点分析、风险矩阵及标准化降维方案。
5.  **决断报告合成**：聚合上述所有维度信息，产出最终推演报告。

**人类锚点 (HITL) 逻辑：**

- **[回滚打回]**：若发现理论存在逻辑自洽性问题或不可逾越的物理墙限制，强制回滚至阶段 1 或 2。
- **[原地重试]**：若需修改边界约束条件，则清除状态回滚至步骤 4（沙盘推演）重新执行。
- **[批准流转]**：架构可行，流转至阶段 4。

### 步骤 1：全域上下文解析 (Global Context Ingestion)

- **技能调用**：[`mas4s-feasibility-deduction-context-ingestion`](file:///Users/admin/clawd/skills/mas4s-feasibility-deduction-context-ingestion/SKILL.md) (参考：[技能文档](../1skills/mas4s_feasibility_deduction_context_ingestion.md))
- **输入**：`literature_graph.json`（文献底座）及 `pi_result.json`（课题定义）。
- **作用**：解析假说与底座之间的技术映射关系，提取实现该假说所需的关键技术组件、依赖项及资源基准。
- **输出**：`deduction_context.json`。

### 步骤 2：逻辑建模 (Logical Modeling)

- **技能调用**：[`mas4s-feasibility-deduction-logical-modeling`](file:///Users/admin/clawd/skills/mas4s-feasibility-deduction-logical-modeling/SKILL.md) (参考：[技能文档](../1skills/mas4s_feasibility_deduction_logical_modeling.md))
- **输入**：`deduction_context.json`。
- **作用**：构建参数化数学模型。验证假说在逻辑链条上是否存在悖论，并输出技术路线与资源需求。
- **输出**：
  - **核心变量、技术路线、目标阈值** -> 传递至步骤 5。
  - **通用技术需求清单** -> 传递至步骤 3。
  - **通用技术需求清单 + 约束条件** -> 传递至步骤 4。

### 步骤 3：现实锚点查证 (Reality Anchor Verification)

- **技能调用**：[`mas4s-feasibility-deduction-reality-verification`](file:///Users/admin/clawd/skills/mas4s-feasibility-deduction-reality-verification/SKILL.md) (参考：[技能文档](../1skills/mas4s_feasibility_deduction_reality_verification.md))
- **输入**：`通用技术需求清单`。
- **作用**：在全球技术生态中验证工程存活性。物理拦截死库或 License 冲突。
- **输出**：组件健康度、License 风险报告、物理瓶颈警告 -> 传递至步骤 5。

### 步骤 4：沙盘推演 (Sandbox Deduction)

- **技能调用**：[`mas4s-feasibility-deduction-sandbox-deduction`](file:///Users/admin/clawd/skills/mas4s-feasibility-deduction-sandbox-deduction/SKILL.md) (参考：[技能文档](../1skills/mas4s_feasibility_deduction_sandbox_deduction.md))
- **输入**：`通用技术需求清单 + 约束条件`。
- **作用**：基于物理事实进行理论推演，识别性能瓶颈。
- **输出**：优缺点、风险矩阵、标准化降维方案 -> 传递至步骤 5。

### 步骤 5：可行性推演报告 (Feasibility Deduction Report)

- **技能调用**：[`mas4s-feasibility-deduction-report`](file:///Users/admin/clawd/skills/mas4s-feasibility-deduction-report/SKILL.md) (参考：[技能文档](../1skills/mas4s_feasibility_deduction_report.md))
- **作用**：汇总所有维度数据，产出最终决断报告。
- **人类锚点 (HITL)**：
  - **[批准流转]**：架构可行，流转至阶段 4。
  - **[原地重试]**：若需“修改约束条件”，则清空状态回滚至**步骤 4**重新推演。
  - **[回滚打回]**：若“理论存在逻辑自洽性问题或物理墙限制”，则携带错误日志强制回滚至**阶段 1 或阶段 2**。
- **输出**：
  - `feasibility_decision_report_cn.md`（综合决策报告 - 中文）
  - `feasibility_decision_report_en.md`（综合决策报告 - 英文）
  - `feasibility_decision_logic.json` / `feasibility_decision_logic_cn.json` / `feasibility_decision_logic_en.json`（下游逻辑载荷 - 双语/纯中文/纯英文）
  - `feasibility_decision_visual.json` / `feasibility_decision_visual_cn.json` / `feasibility_decision_visual_en.json`（UI 可视化态势数据 - 双语/纯中文/纯英文）

## 3. SOP 观测方案 (Observation)

Agent 的执行过程在 AIEMAS 平台中是透明可观测的：

- **状态机监控**：前端通过 Thin Engine 的状态流转图实时显示当前处于哪个原子 Skill 执行阶段。
- **进度日志**：每个技能在执行时通过 `ProgressReporter` 产生 `progress.jsonl`。
- **详细方案**：参考 [Agent SOP 观测方案](../agent_sop_observation.md)。

### 3.1 Skill 改造要求 (Skill Modification Requirements)

所有 `mas4s-feasibility-deduction-` 前缀的核心 Skill 必须满足以下规范：

- **集成 ProgressReporter**：实时上报逻辑推演、网络查证、压测模拟的进度。
- **支持 run_id 参数**：用于隔离不同次推演任务的进度与临时结果。
- **支持强制重新执行 (force)**：推演过程对环境依赖较高，默认支持增量检查中间结果。
- **物理拦截上报**：在步骤 3 发现致命错误时，必须通过 `ProgressReporter` 发送 `FATAL_FLAW` 类型消息，以便前端即时反馈给用户。

## 4. 相关文档 (Related Docs)

- [Agent 定义](../../../docs/concepts/agent.md)
- [Agent 工作区](../../../docs/concepts/agent-workspace.md)
- [阶段 2：Literature Ground Agent](./science_assistant_literature_ground.md)
- [阶段 4：Experiment Design Agent](./science_assistant_experiment_design.md)
- [双锚点科研 SOP 总览](./science_assistant.md)
