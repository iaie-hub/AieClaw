## 阶段 3 - 步骤 3：提案方案蓝图 (Method Blueprint) 设计方案

### 一、 设计理念

1.  **从假说到架构的飞跃 (Hypothesis-to-Architecture Leap)**：将阶段 1 的核心假说与阶段 3 步骤 1 的数学形式化定义转化为具体的算法模块、数据结构或系统流程。
2.  **模块化设计与契约化接口 (Modular Design & Contractual Interfaces)**：方案蓝图不仅是概念描述，更需定义每个核心模块的功能边界与输入输出契约，为阶段 4（代码实现）提供直接的模块化指南。
3.  **创新点显式化 (Explicit Innovation)**：通过“三句话创新声明 (Innovation Statement)”，将本提案相对于 SOTA 基线的改进点进行原子化描述，确保科研贡献的清晰度。
4.  **数据流向闭环 (Data-Flow Closure)**：确保从输入空间到输出空间的处理链条在逻辑上是完备的，且中间状态（如 Memory, State, Message）有明确的转换逻辑。

### 二、 设计方案

#### 方案蓝图中枢矩阵

| 维度核心模块                              | 核心内容                                         | 目标下游受众      |
| :---------------------------------------- | :----------------------------------------------- | :---------------- |
| **三句话创新声明 (Innovation Statement)** | 针对基线局限性提出的三条原子化改进声明。         | 阶段 6 (论文撰写) |
| **模块化架构 (Modular Architecture)**     | 系统组件划分（Components）、职责定义、层级结构。 | 阶段 4 (代码实现) |
| **数据流向 (Data Flow)**                  | 数据在模块间的流转、变换与持久化逻辑。           | 阶段 4 (代码实现) |
| **核心机制说明 (Key Mechanisms)**         | 算法核心逻辑、逻辑推演步、处理流程。             | 阶段 4 / 人类 PI  |

### 三、 实现流程

| 步骤 | 动作               | 说明                                                                                     |
| :--- | :----------------- | :--------------------------------------------------------------------------------------- |
| 1    | 上下文情报聚合     | 读取 `pi_result_en.json`、`problem_formulation_en.json` 和 `baseline_manifest_en.json`。 |
| 2    | 架构逻辑推演       | 根据目标函数与变量定义设计核心组件，并参考基线的优点进行“防御性改进”。                   |
| 3    | 模块职责与契约定义 | 为每个组件分配具体任务（Role），并描述其输入输出逻辑。                                   |
| 4    | 创新声明提取       | 对齐 `baseline_manifest` 中的 Gap，凝练出三句具有攻击性的创新点描述。                    |
| 5    | 双语持久化         | 拆分为 `_en.json` 与 `_cn.json`，并渲染 Markdown 方案报告。                              |

### 四、 输入参数

所有文件集中存放于 `~/.openclaw/workspace-design/task/{run_id}/`。

| 参数名       | 类型   | 必填 | 说明                      |
| :----------- | :----- | :--- | :------------------------ |
| **run_id**   | String | 是   | 执行 ID。                 |
| **agent_id** | String | 否   | Agent ID，默认 `design`。 |

**必需输入文件**：

- `~/.openclaw/workspace-topic/task/{run_id}/pi_result_en.json`
- `~/.openclaw/workspace-design/task/{run_id}/problem_formulation_en.json`
- `~/.openclaw/workspace-design/task/{run_id}/baseline_manifest_en.json`

### 五、 输出参数

**固定输出文件**：

- `method_blueprint.json`：中英混合原始数据（含模块化契约）。
- `method_blueprint_en.json`：纯英文版（Stage 4 机器输入）。
- `method_blueprint_cn.json`：纯中文版（前端渲染）。
- `method_blueprint.md`：高层设计蓝图报告（人读版）。

### 六、 核心维度与字段定义

| 类别         | 字段名称                     | 描述                                                         |
| :----------- | :--------------------------- | :----------------------------------------------------------- |
| **创新声明** | `innovation_statement`       | 包含三条具体的创新点声明。                                   |
| **系统架构** | `components`                 | 包含 `name`, `role`, `input_interface`, `output_interface`。 |
|              | `data_flow_logic`            | 描述数据从输入到输出的流水线步骤。                           |
| **算法核心** | `key_mechanisms`             | 描述核心算法逻辑（如：奖励函数设计、记忆索引策略等）。       |
| **预期行为** | `expected_emergent_behavior` | 描述系统在运行时的预期表现。                                 |

### 七、 示例

#### 7.1 运行示例

```bash
python3 scripts/mas4s_design_method_blueprint.py '{"run_id": "run_20260430"}'
```

#### 7.2 创新声明示例 (Innovation Statement)

1. **共生记忆机制**：不同于 [2401.00001] 的独立存储，本方法通过共享的故障索引实现跨智能体记忆同步。
2. **预测性遗忘策略**：引入衰减函数替代标准 FIFO，优先保留与当前任务目标相关的高价值样本。
3. **闭环反馈修正**：在执行层引入实时校验模块，能够在线修正由于长序列推理产生的语义偏移。

### 八、 SOP 观测支持

- **进度上报**：上报 `正在构思核心算法模块架构...` 与 `正在撰写创新声明与数据流图...`。
- **进度文件路径**：`~/.openclaw/workspace-design/task/<run_id>/progress_mas4s_design_method_blueprint.jsonl`
- **模块化展示**：支持在前端以组件化列表展示设计成果。
