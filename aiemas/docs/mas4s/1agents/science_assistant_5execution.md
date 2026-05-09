# 实验执行 Agent (Science Assistant: Execution)

## 1. 概述 (Overview)

**Science Assistant: Execution** 是专门用于将阶段 4 冻结的实验资产在严格受控的环境下进行一键全量运行的智能 Agent。其核心目标是在无人工干预的状态下，启动所有预设实验，自动收集并汇整纯净的原始结果，杜绝任何临时干预或选择性报告（Selective Reporting）。

该 Agent 遵循“环境可信，执行自治，结果防篡改”的核心理念，通过全链路自动化监控与结果校验，确保实验结果能被无缝、客观地交付至阶段 6（论文写作）。

## 2. 核心 SOP 流程 (Standard Operating Procedure)

Agent 严格遵循以下四步 SOP 流程执行任务：

1.  **实验环境检核**：启动容器，校验硬件与冻结快照的一致性。
2.  **一键全量运行**：自动执行所有预注册的评测及消融实验。
3.  **运行监控与异常记录**：实时捕获异常并阻止任何违规的现场代码篡改。
4.  **结果自动汇整**：根据预注册协议比对并生成合规性报告。

### 详细步骤说明：

### 步骤 1：实验环境检核 (Environment Verification)

- **详细设计**：[mas4s_5execution_verify.md](../1skills/mas4s_5execution_verify.md)
- **技能调用**：[`mas4s-execution-verify`](file:///Users/admin/.openclaw/skills/mas4s-execution-verify/SKILL.md)
- **输入**：`environment_snapshot_en.json`（阶段 4）+ 宿主机真实探测数据 (`host_probe_data.json`) + 冒烟测试运行日志。
- **动作**：启动容器，校验当前执行硬件环境、随机种子（Seed）以及代码哈希一致性，验证执行现场与阶段 4 冻结快照是否完全匹配，确保“受控状态”不被破坏。
- **输出**：`env_verification_cert.json`（环境检核证书）。

### 步骤 2：一键全量运行 (Full Run)

- **详细设计**：[mas4s_5execution_run.md](../1skills/mas4s_5execution_run.md)
- **技能调用**：[`mas4s-execution-run`](file:///Users/admin/.openclaw/skills/mas4s-execution-run/SKILL.md)
- **输入**：`eval_protocol.json`（阶段 3 PREP）+ 阶段 4 冻结的代码与数据。
- **动作**：依据评估协议（PREP）中的预注册指令，自动启动主干评测脚本（如 `evaluation_pipeline.py`）。自动运行所有提案方法、基线对比、消融实验以及敏感性分析。所有输出全部无损落盘，并锁定时间戳。
- **输出**：`execution_manifest.json`（完整实验执行清单）。

### 步骤 3：运行监控与异常记录 (Monitor & Logging)

- **详细设计**：[mas4s_5execution_monitor.md](../1skills/mas4s_5execution_monitor.md)
- **技能调用**：[`mas4s-execution-monitor`](file:///Users/admin/.openclaw/skills/mas4s-execution-monitor/SKILL.md)（与步骤 2 并发）
- **输入**：容器内运行时环境。
- **动作**：全过程监控计算资源（CPU/GPU/内存）使用水位，捕获运行时告警或抛出的错误。系统具有严格阻断机制，**绝不允许任何形式的现场修改代码以规避错误**（一旦失败则强制产生包含 `fatal_error_log` 的 Rollback）。
- **输出**：`execution_anomaly_log.jsonl`。

### 步骤 4：结果自动汇整 (Result Aggregation)

- **详细设计**：[mas4s_5execution_aggregate.md](../1skills/mas4s_5execution_aggregate.md)
- **技能调用**：[`mas4s-execution-aggregate`](file:///Users/admin/.openclaw/skills/mas4s-execution-aggregate/SKILL.md)
- **输入**：`execution_manifest.json` + 所有运行输出数据。
- **动作**：清洗并汇整纯净的原始数据为标准化汇总表。系统自动对照 PREP 协议（`eval_protocol.json`），对结果进行合规性比对。对于未完成的指标进行“缺失”标记；对于不在协议内的额外输出进行“探索性分析”显式标记。
- **输出**：`results_summary.json` + `prep_compliance_report.json`。

### 2.1 阶段产出脚本整体联动说明 (Script Linkage & Workflow)

在阶段 5 实验执行过程中，不再产生新的执行逻辑，而是将阶段 3 设计协议与阶段 4 实现资产进行“不可变碰撞”：

1. **环境挂载与激活（不可变证明）**：
   - 调度系统基于阶段 4 产出的 `Dockerfile` 启动沙盒环境。`mas4s-execution-env-verify` 作为门神优先检查运行现场是否遭到污染。一旦产生 `env_verification_cert.json`，证明实验平台处于可信的冷冻态。
2. **自动化实验推演（一键打擂）**：
   - 接着触发 `mas4s-execution-full-run` 调用主评估管线（如 `evaluation_pipeline.py`）。此时测试集、提案逻辑与基线逻辑在同一个硬件与软件上下文下交火，彻底消除复现鸿沟。
   - 同步运行的 `mas4s-execution-monitor` 像黑匣子一样记录全程表现。如果有由于 OOM 或 Bug 导致的宕机，将直接触发向上游的 `[回退]`。
3. **公正无私的裁判（合规聚合）**：
   - 当 `evaluation_pipeline.py` 执行结束后，会留下海量的原始日志 (raw logs) 和评测字典 (metric dictionaries)。`mas4s-execution-result-aggregate` 将基于阶段 3 冻结的 `eval_protocol.json` 对这些结果进行严格的表格化与分类，杜绝科研过程中常见的数据修饰与选择性汇报（P-hacking）。

---

## 3. 实现规范 (Implementation Specification)

为了确保实验过程的绝对客观与合规，Agent 需遵循以下规范：

### 3.1 资产包完整性规范

执行阶段产出的 `execution_package.json` 必须包含以下维度的信息：

| 维度               | 说明                                                                                                     |
| :----------------- | :------------------------------------------------------------------------------------------------------- |
| **执行完整性证明** | 包含阶段启动时的环境哈希、执行过程的关键节点哈希以及最终生成的日志哈希链。                               |
| **执行异常明细**   | 所有 OOM、超时、NaN 值报错需原封不动地被提取记录在 `anomaly_log` 字段。                                  |
| **合规比对报告**   | `prep_compliance_report.json` 必须明确回答：“是否完成了协议内所有指标？”和“是否存在协议外的探索数据？”。 |

### 3.2 现实锚点与约束

- **随机种子全链路验证**：强制检查所有随机化组件在执行开始和结束时的状态机一致性。
- **选择性报告防护**：对于任何预注册协议中声明必须报告却缺失的结果，抛出高优的合规性警告；对于新出现的额外分析数据，强制在后续输出上打上 `[Exploratory]` 的水印标签。
- **隔离断网执行**：在实验启动到结果落盘期间，物理隔离网络环境，防止外部数据对最终验证集评测的干扰。

## 4. SOP 观测方案 (Observation)

Agent 的执行过程在 AIEMAS 平台中是透明可观测的：

- **步骤追踪**：前端通过 [SOP 定义](../../../docs/concepts/agent-workspace.md) 实时显示当前所处阶段。
- **进度日志**：`ProgressReporter` 产生 `progress.jsonl`，细粒度上报诸如“正在进行基线 A vs 提案方法的消融测试 (3/5 组)”等信息。
- **资源看板**：前端展示阶段 5 特有的硬件资源消耗看板，供人类研究员评估其实际工程成本。
- **详细方案**：参考 [Agent SOP 观测方案](../agent_sop_observation.md)。

### 4.1 Skill 改造要求 (Skill Modification Requirements)

- **集成 ProgressReporter**：上报实验运行节点、资源探针读数及合规性比对进度。
- **支持 run_id 参数 (必需)**：用于物理隔离不同次执行的数据与日志。
- **标准化进度行**：包含正确的 `type` (start/item/log/done) 及 `skill` 字段。

## 5. 相关文档 (Related Docs)

- [Agent 定义](../../../docs/concepts/agent.md)
- [双锚点科研 SOP 总览](./science_assistant.md)
- [阶段 3：Design Agent](./science_assistant_3design.md)
- [阶段 4：Implementation Agent](./science_assistant_4implement.md)
- [阶段 6：Writing Agent](./science_assistant_6writing.md)
