## 阶段 4 - 步骤 2：提案方法实现 (Method Implementation) 设计方案

### 一、 设计理念

1.  **从蓝图到物理逻辑的转化 (Blueprint to Execution)**：将阶段 3 产出的高层算法架构和形式化输入输出空间转化为物理上可执行的生产级代码。
2.  **强制 1:1 模块映射 (Modular Mapping Constraint)**：代码结构（类/函数）必须与 `method_blueprint.json` 中的 `modular_design` 保持绝对的一一对应，防范大模型极易写出黑盒式、巨型的“面条代码 (Spaghetti Code)”。
3.  **类型安全的形式化绑定 (Type-Safe Formalization)**：强制使用 Python Type Hints、Dataclasses 或 Pydantic 模型，将变量严格绑定至 `problem_formulation.json` 中定义的 $\mathcal{X}, \mathcal{Y}$ 输入输出空间，防止理论形式化与实际代码的脱节。
4.  **测试驱动与代码物理隔离 (Test-Driven & Physical Isolation)**：不仅要生成核心方法代码，还强制要求生成独立的 `pytest` 单元测试脚本，专注极端边界条件 (Edge Cases)。代码部分不直接放入 JSON，而是通过外部 Markdown 代码块被正则独立抽取，从根本上规避大模型因为未正确转义 `\n` 或 `"` 而导致的 JSON 解析崩溃。

### 二、 设计方案

#### 提案方法实现中枢矩阵

| 维度核心模块                          | 核心内容                                                                     | 目标下游受众                  |
| :------------------------------------ | :--------------------------------------------------------------------------- | :---------------------------- |
| **核心方法脚本 (Core Method Script)** | 包含正式实现的 Python 代码 (`method_implementation.py`)。                    | 基线复现与实验执行 (Stage 5)  |
| **单元测试脚本 (Unit Test Script)**   | 用于测试核心模块边界条件的 `pytest` 脚本 (`test_method_implementation.py`)。 | 可靠性门控                    |
| **依赖清单 (Dependency Manifest)**    | 必需的第三方库列表 (`requirements.txt`)。                                    | 环境冻结与容器化 (阶段4步骤4) |
| **方法实现简报 (Brief)**              | 包含中英双语的测试覆盖与边界条件应对说明。                                   | 人类 PI (HITL 审计)           |

### 三、 实现流程

| 步骤 | 动作                 | 说明                                                                                                     |
| :--- | :------------------- | :------------------------------------------------------------------------------------------------------- |
| 1    | 情报加载与跨目录寻址 | 向上游 `workspace-design` 寻址并加载 `problem_formulation_en.json` 与 `method_blueprint_en.json`。       |
| 2    | HITL 反馈注入        | 检查当前环境是否存在 `fatal_error.log` (回滚) 或 `human_feedback.txt` (重试)，作为修正的最高优先级输入。 |
| 3    | LLM 逻辑推演         | 调用大模型，在 `<think>` 中强制推演 `Space-to-Type` 映射、模块解构以及 `Edge-Case` 测试策略。            |
| 4    | 代码与数据隔离抽取   | 使用正则独立提取大模型在外部 Markdown 块中输出的两段 Python 代码，规避 JSON 长文本转义地雷。             |
| 5    | 多维资产落盘         | 分离输出正式的 `.py` 文件、`.txt` 依赖及双语版 `unit_test_report.json` 与简报文件。                      |

### 四、 输入参数

所有文件集中存放于 `~/.openclaw/workspace-implement/task/{run_id}/`，输入文件支持跨 Agent 目录的智能回退寻址。

| 参数名       | 类型   | 必填 | 说明                             |
| :----------- | :----- | :--- | :------------------------------- |
| **run_id**   | String | 是   | 执行 ID。                        |
| **agent_id** | String | 否   | Agent ID，当前默认 `implement`。 |

**必需输入文件**：

- `~/.openclaw/workspace-design/task/{run_id}/problem_formulation_en.json`
- `~/.openclaw/workspace-design/task/{run_id}/method_blueprint_en.json`

### 五、 输出参数与使用说明

此步骤的物理输出资产是将理论算法落地的核心。以下为固定输出文件及其**使用方法**：

- **`method_implementation.py`**：核心提案方法源代码。
  - **使用说明**：该文件作为基座模块，将被 Stage 5 评估管线调用。无需人工干预运行。
- **`test_method_implementation.py`**：基于 `pytest` 的单元测试代码。
  - **使用说明**：智能体生成后，人类研究员或 CI 系统应当在配置好 `requirements.txt` 的环境中**手动执行**该脚本（例如 `pytest test_method_implementation.py -v`）。只有通过全部边界测试和断言，核心算法才能准入后续对比评估。
- **`requirements.txt`**：第三方依赖列表。
  - **使用说明**：用于 Stage 4 步骤 4（容器化）安装环境，或由研究人员执行 `pip install -r requirements.txt`。
- **`unit_test_report.json`**：中英混合的原始测试报告数据。
- **`unit_test_report_en.json` / `_cn.json`**：纯英/纯中双语版测试与覆盖报告。
  - **使用说明**：用于阶段合规性溯源验证及日志。
- **`method_implementation_brief.md`**：提案方法代码简报，供人类审查。

### 六、 核心维度与字段定义

| 类别           | 字段名称              | 描述                                                         |
| :------------- | :-------------------- | :----------------------------------------------------------- |
| **资产代码化** | `core_method_script`  | Python 核心代码逻辑（通过外部拦截机制回注）。                |
|                | `unit_test_script`    | Python 单元测试逻辑（通过外部拦截机制回注）。                |
|                | `dependency_manifest` | 第三方依赖库列表，如 `["torch>=2.0.0", "numpy"]`。           |
| **测试报告**   | `coverage_strategy`   | 解释单元测试是如何实现对蓝图中定义核心模块的 1:1 覆盖的。    |
|                | `edge_cases_tested`   | 描述为确保鲁棒性，在测试脚本中专门处理的具体边界或崩溃条件。 |

### 七、 示例

#### 7.1 运行示例

```bash
python scripts/mas4s_implement_method.py '{"run_id": "run_20260430"}'
```

#### 7.2 提案方法实现简报示例

> # 阶段 4 步骤 2：提案方法实现报告 (Method Implementation Brief)
>
> ## 1. 依赖清单 (Dependency Manifest)
>
> ```txt
> torch>=2.0.0
> numpy
> ```
>
> ## 2. 单元测试覆盖策略 (Test Coverage Strategy)
>
> 测试脚本使用 `pytest` 实现了对 `AgentMemory` 和 `PolicyValidator` 两个核心类的精确覆盖。每个类均根据 Blueprint 中定义的数据流映射配备了 2 个独立功能测试用例。
>
> ## 3. 边界条件测试验证 (Edge Cases Tested)
>
> 重点在 `test_method_implementation.py` 中测试了 `PolicyValidator` 接收超长文本标记 (如 > 32K) 和空白字典输入时的边界拦截能力，防止底层发生 OOM。

### 八、 SOP 观测支持

- **进度上报**：在关键生命周期点上报 `正在实现提案方法与单元测试...` 与 `正在执行中英双语拆分落盘...`。
- **进度文件路径**：`~/.openclaw/workspace-implement/task/<run_id>/progress_mas4s_implement_method.jsonl`
- **超强鲁棒性设计**：彻底放弃让 LLM 把数千行的代码强塞进 JSON 字符串进行 `\n` 转义。脚本实现了“物理隔离”，在返回纯净 JSON 框架的尾部，拦截解析 Markdown 语法中的原生 Python 块，完美解决超大模型生成代码时的 Parse Error。
