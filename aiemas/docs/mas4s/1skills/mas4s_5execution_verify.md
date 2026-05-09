作为科研 SOP 系统架构师，我将为你输出完整的《阶段 5 - 步骤 1：实验环境检核 (Env-Verify) 设计方案》以及经过严格转义与防逃逸测试的系统级 Prompt 模板。

---

# 阶段 5 - 步骤 1：实验环境检核 (Env-Verify) 设计方案

### 一、 设计理念

1. **绝对门控与防幽灵环境 (Strict Gatekeeping)**：在启动耗时且昂贵的全量实验前，必须物理校验宿主机（Host Node）的真实资源分配（GPU 显存、驱动、内核）是否满足阶段 4 冻结的 `environment_snapshot` 要求，防止环境不匹配导致的秒级崩溃。
2. **零容忍现场篡改 (Zero-Tolerance for Live-Patching)**：实验现场绝不允许动态修改核心逻辑代码以绕过报错。如果冒烟测试（Mini-experiment）失败，必须硬性拦截，触发 `[回退]` 返回上游进行合规的重新构建，以此捍卫执行完整性。
3. **自愈辅助与物理隔离 (Self-Healing via Physical Isolation)**：当触发打回重构时，大模型在指出报错的同时，可通过外部 Markdown 代码块生成“诊断脚本”或“热修复指令（Patch）”。此举既提升了上游 Agent 的 Rollback 成功率，又通过隔离代码与 JSON 彻底规避了序列化转义灾难。

### 二、 实验环境检核中枢矩阵

| 维度核心模块                         | 核心内容                                                                  | 目标下游受众                      |
| :----------------------------------- | :------------------------------------------------------------------------ | :-------------------------------- |
| **检核认证报告 (Verification Cert)** | 中英双语的通过证明，记录当前宿主机的硬件指纹、镜像哈希及准入结论。        | 阶段 5 步骤 2 (全量运行) 准入凭证 |
| **打回载荷 (Rollback Payload)**      | 当检核失败时生成的结构化致命错误日志 (`fatal_error_log`) 及目标重试阶段。 | 阶段 4 容器化 / 阶段 3 方案设计   |
| **辅助诊断补丁 (Diagnostic Patch)**  | (可选) 一段不属于正式流程的 Python/Bash 代码段，用于指导上游环境的修复。  | 阶段 4 容器化 Agent (修复依赖用)  |

### 三、 实现流程

| 步骤 | 动作                         | 说明                                                                                                               |
| :--- | :--------------------------- | :----------------------------------------------------------------------------------------------------------------- |
| 1    | **实体探针与资产加载**       | 读取 `environment_snapshot_en.json`，并由外部调度器注入宿主机真实探测数据 (`host_probe_data`) 和冒烟测试运行日志。 |
| 2    | **LLM 逻辑推演 (`<think>`)** | 审计资源供需，分析冒烟测试退出的报错堆栈，并作出状态机路由决策 (Approve 签发证书 或 Rollback 提取致命错误)。       |
| 3    | **结构化决策落盘**           | 输出符合双语要求与平铺结构的 JSON 对象，通过解析判断是否中断后续流水线。                                           |
| 4    | **可选补丁隔离抽取**         | 若触发回滚，正则截取位于 JSON 尾部的 `python` 诊断代码保存为临时 `.py`，随 Rollback 指令一起传递给上游。           |

### 四、 核心输出结构 Schema 定义

以下字段必须满足严格的强类型校验：

| 字段名称                      | 类型   | 说明                                                                          |
| :---------------------------- | :----- | :---------------------------------------------------------------------------- |
| `status`                      | Enum   | 枚举值：`PASSED` 或 `FAILED`。控制状态机步进或回滚。                          |
| `audit_results`               | Object | 硬件资源是否达标、确定性约束是否满足、冒烟测试的 Exit Code 记录。             |
| `env_verification_cert_en/cn` | Object | 签发的环境检核证书。包含签名时间、容器哈希与硬件指纹。                        |
| `rollback_payload_en/cn`      | Object | 仅当 `status` 为 `FAILED` 时填充，必须包含精准的 `fatal_error_log` 溯源信息。 |

---

### 五、 Prompt 模板管理 (Prompt Template Management)

为了维护单一事实来源 (Single Source of Truth)，具体的系统级 Prompt 模板已迁移并同步至 Python 执行脚本 `mas4s_execution_verify.py` 中。设计方案不再保存 Prompt 文本，以防止文档与代码逻辑脱节。

---

### 六、 宿主机探测数据 (Host Probe Data) 示例

该数据由外部调度器动态生成，作为技能的输入文件 `host_probe_data.json`（或 `host_probe_data.txt`）提供。

```json
{
  "timestamp": "2026-05-03T19:38:00Z",
  "os": {
    "platform": "linux",
    "distribution": "Ubuntu 22.04.3 LTS",
    "kernel": "5.15.0-84-generic",
    "architecture": "x86_64"
  },
  "cpu": {
    "model": "AMD EPYC 7763 64-Core Processor",
    "logical_cores": 128,
    "physical_cores": 64,
    "current_usage_percent": 12.5
  },
  "memory": {
    "total_gb": 512.0,
    "available_gb": 448.2,
    "used_gb": 63.8,
    "usage_percent": 12.4
  },
  "gpu": {
    "driver_version": "535.104.05",
    "cuda_version": "12.2",
    "devices": [
      {
        "index": 0,
        "name": "NVIDIA A100-SXM4-80GB",
        "vram_total_mb": 81920,
        "vram_free_mb": 79800,
        "vram_used_mb": 2120,
        "temperature": "32C",
        "power_draw": "65W"
      }
    ]
  },
  "docker": {
    "version": "24.0.6",
    "nvidia_runtime_installed": true
  }
}
```

---

### 七、 输出文件说明 (Output Files Specification)

根据检核结果（`status`），技能会生成不同类型的产出文件：

#### 1. 检核通过 (PASSED)

当环境完全匹配且冒烟测试成功时，生成以下文件：

- **`env_verification_cert.json`**：包含环境检核证书的完整 JSON。
- **`env_verification_cert_en.json` / `_cn.json`**：双语拆分后的证书，供后续“全量运行”步骤作为准入凭证。

#### 2. 检核失败 (FAILED)

当检测到硬件不足、环境冲突或冒烟测试崩溃时，生成以下文件：

- **`rollback_payload.json`**：包含致命错误日志（`fatal_error_log`）和目标重试阶段（通常为 `I` - Implementation）的 JSON。
- **`rollback_payload_en.json` / `_cn.json`**：双语拆分后的回滚载荷，用于引导上游 Agent 进行自愈修复。
- **`diagnostic_patch.py`**（可选）：由 LLM 自动生成的诊断脚本或修复补丁。该文件经过物理隔离提取，可直接被上游 Agent 执行或参考。
