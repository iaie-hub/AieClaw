作为科研 SOP 系统架构师，我为你设计了 Stage 5 步骤 3：**运行监控与异常记录 (Monitor & Logging)** 的设计方案。

本设计严格遵循“**只读不写，见死不救，直接报警**”的强监控理念。在科研执行阶段，试图“热修复”代码是引发数据造假和不可复现的万恶之源。因此，本智能体被彻底剥夺了代码修改权，其唯一武器是**记录异常 (Anomaly Logging)** 和**触发熔断回滚 (Circuit Breaking & Rollback)**。

---

# 阶段 5 - 步骤 3：运行监控与异常记录 (Monitor & Logging) 设计方案

### 一、 设计理念

1. **绝对只读与不可篡改 (Immutable Observation)**：监控智能体只允许读取容器的资源探针读数（Telemetry）与各任务的运行日志（stdout/stderr）。如果发现诸如 `NaN loss`, `CUDA OOM` 或 `KeyError`，**严禁生成修复补丁去覆盖原始代码**。实验现场必须保持冻结。
2. **异常的分级响应 (Tiered Anomaly Response)**：
   - **可容忍异常 (Warning/Minor)**：如某个基线模型耗时过长但未超时，或发生资源抖动。记录至 Anomaly Log，不中断整体批处理。
   - **局部失败 (Task-Level Failure)**：某个特定的消融实验因超参不兼容崩溃。记录为 Severe，但不中止全局，交由步骤 4（结果汇整）处理为缺失数据。
   - **系统级灾难 (Global Fatal)**：如全局数据集加载失败、GPU 彻底掉线、所有任务连续报同一错误。**立即触发 `ABORT_REQUIRED`**，中断全量运行并生成携带有明确 `fatal_error_log` 的 Rollback 指令。
3. **静默失败探测 (Silent Failure Detection)**：不能仅依靠进程的退出码 (Exit Code)。某些代码在发生数值溢出时仍会返回 0。监控必须利用 LLM 的语义理解能力扫描日志，捕获“幽灵错误”。

### 二、 监控中枢矩阵

| 维度核心模块                       | 核心内容                                                                             | 目标下游受众                   |
| :--------------------------------- | :----------------------------------------------------------------------------------- | :----------------------------- |
| **异常事件清单 (Anomalies Array)** | 结构化的异常记录（按严重程度分类），用于转换并追加至 `execution_anomaly_log.jsonl`。 | 阶段 5 步骤 4 (结果汇整) 与 PI |
| **全局熔断决策 (Global Status)**   | 指示系统继续监控 (`MONITORING`) 或立即拔掉电源 (`ABORT_REQUIRED`)。                  | 顶层调度器 (Orchestrator)      |
| **打回载荷 (Rollback Payload)**    | 仅在触发熔断时填充，包含给 Stage 3/4 的修复建议。                                    | 阶段 4 容器化 / 阶段 3 协议    |

---

### 三、 运行机制与生命周期

步骤 3 紧盯着步骤 2 启动的 `run_orchestrator.py` 进程，以及该进程拉起的所有子任务进程。

#### 1. 异步唤醒 (Asynchronous Polling)

监控脚本 `mas4s_execution_monitor.py` 作为旁路守护进程（Sidecar Daemon）运行，进入轮询循环（如每隔 30 秒触发一次）。

#### 2. 情报切片与 LLM 推演

在每一次轮询周期中，探针会：

- 截取尾部最新的日志（Tail Logs）。
- 抓取当前的 `resource_telemetry`（CPU/GPU 水位）。
- 调用 LLM 进行异常分诊判断。

#### 3. 状态机分流处理

- **MONITORING**：将非致命异常追加（Append）至 `execution_anomaly_log.jsonl`，继续监控。
- **ABORT_REQUIRED**：发生系统性灾难时，强制终止（SIGKILL）全量运行进程树，生成 Rollback 载荷并中断生命周期。

---

### 四、 Prompt 模板管理 (Prompt Template Management)

为了维护单一事实来源 (Single Source of Truth)，具体的系统级 Prompt 模板已迁移并同步至 Python 执行脚本 `mas4s_execution_monitor.py` 中。设计方案不再保存 Prompt 文本，以防止文档与代码逻辑脱节。

---

### 五、 输出文件说明 (Output Files Specification)

#### 1. 持续监控产物

- **`execution_anomaly_log.jsonl`**：结构化的异常流水账。每一行是一个独立发现的异常事件，包含时间戳、任务 ID、严重程度和双语描述。

#### 2. 熔断回滚产物 (仅在 ABORT_REQUIRED 时)

- **`rollback_payload.json`**：包含致命错误日志和目标回退阶段的完整 JSON。
- **`rollback_payload_en.json` / `_cn.json`**：双语拆分后的回滚载荷。
