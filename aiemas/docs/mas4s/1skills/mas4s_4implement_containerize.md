## 阶段 4 - 步骤 4：容器化与环境冻结 (Containerization) 设计方案

### 一、 设计理念

1.  **环境绝对不可变 (Immutable Environment)**：学术实验饱受“在我的机器上能跑 (It works on my machine)”之苦。本步骤通过生成标准化 `Dockerfile`，将操作系统版本、系统依赖、CUDA/CUDNN 版本及 Python 依赖项物理冻结，消除底层环境差异。
2.  **随机性收敛与锁定 (Determinism & Seed Locking)**：在深度学习和多智能体实验中，随机种子的漂移是不可复现的核心元凶。通过在环境快照 `environment_snapshot.json` 中显式记录全局 Seed 及各种哈希盐值（Hash Salts），保证容器化后的计算图确定性。
3.  **冒烟测试验证闭环 (End-to-End Mini-Experiment)**：光有容器不够，必须证明其能跑通。该步骤要求设计一份极小规模的数据冒烟测试（Mini-Experiment），只有容器内顺利跑通整个评估管线（Evaluation Pipeline），才能准入最终的耗时且昂贵的 Stage 5。

### 二、 设计方案

#### 环境容器化中枢矩阵

| 维度核心模块                                  | 核心内容                                                                                          | 目标下游受众           |
| :-------------------------------------------- | :------------------------------------------------------------------------------------------------ | :--------------------- |
| **容器构建文件 (Dockerfile)**                 | 定义基础镜像（Base Image）、系统级依赖包（apt-get）、依赖环境拷贝与入口脚本。                     | Stage 5 (实验执行集群) |
| **迷你实验验证脚本 (Mini-Experiment Script)** | 一份可在容器中自动运行、利用 AST 校验确保逻辑真实、使用少量样本执行快速端到端验证的 Python 脚本。 | CI / CD 验证系统       |
| **环境快照与简报 (Snapshot & Brief)**         | 中英双语的环境快照参数（包括基础镜像、硬件需求及确定性保证）报告。                                | 人类 PI (HITL 审计)    |

### 三、 实现流程

| 步骤 | 动作               | 说明                                                                                                                                             |
| :--- | :----------------- | :----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | 依赖探针扫描       | 寻址加载之前步骤产生的 `requirements.txt` 及算法代码特征。                                                                                       |
| 2    | 镜像与驱动推断     | 大模型依据依赖推断最优的 Base Image。强制约束：GPU 环境使用 `pytorch/pytorch:2.11.0-cuda13.0-cudnn9-devel`，CPU 环境使用 `python:3.11.15-slim`。 |
| 3    | LLM 逻辑推演       | 在 `<think>` 中推演 Dockerfile 分层优化策略、全局 Seed 注入方式及迷你实验设计。                                                                  |
| 4    | 代码与数据隔离抽取 | 使用正则独立提取大模型输出的 JSON 环境快照框架以及 `Dockerfile` / `mini_experiment.py` 脚本片段。                                                |
| 5    | 多维资产落盘       | 分离输出无代码的 JSON 报告数据（含双语版）、物理配置文件及中英文态 Markdown 简报。                                                               |

### 四、 输入参数

所有文件集中存放于 `~/.openclaw/workspace-implement/task/{run_id}/`，输入文件支持跨 Agent 目录的智能回退寻址。

| 参数名       | 类型   | 必填 | 说明                             |
| :----------- | :----- | :--- | :------------------------------- |
| **run_id**   | String | 是   | 执行 ID。                        |
| **agent_id** | String | 否   | Agent ID，当前默认 `implement`。 |

**必需输入文件**：

- `eval_protocol_en.json`（来自 Stage 3：实验协议）
- `preprocessing_script.py`（来自步骤 1：数据预处理脚本）
- `method_implementation.py`（来自步骤 2：提案算法实现）
- `unit_test_report_en.json`（来自步骤 2：用于提取 `dependency_manifest`）
- `baseline_wrappers.py`（来自步骤 3：基线适配器）
- `evaluation_pipeline.py`（来自步骤 3：评测管线入口）
- `requirements.txt`（备用，来自步骤 2）

### 五、 输出参数与使用说明

此步骤的物理输出资产是保证代码能安全过渡至 Stage 5 执行环节的最后一层护栏。以下为固定输出文件及其**严格的使用方法**：

- **`Dockerfile`**：标准的容器构建描述文件。
  - **使用说明**：由人类或自动化平台执行 `docker build -t mas4s_exp:<run_id> .` 进行镜像编译。它锁定了一切底层运行时环境。
  - **国内镜像加速强制规范**：
    - 在运行 `pip install` 前，必须先运行 `pip config set global.index-url https://mirrors.tuna.tsinghua.edu.cn/pypi/web/simple`。
    - 在运行任何 `apt-get` 动作前，必须先运行：`RUN sed -i 's@deb.debian.org@mirrors.aliyun.com@g' /etc/apt/sources.list.d/debian.sources && sed -i 's@security.debian.org@mirrors.aliyun.com@g' /etc/apt/sources.list.d/debian.sources`。
- **`mini_experiment.py`**：迷你实验自动验证脚本。
  - **使用说明**：在构建好镜像后，需执行 `docker run mas4s_exp:<run_id> python mini_experiment.py` 进行冒烟测试。脚本内置 AST 校验，严禁内联（Inline）核心算法类。如果运行失败，系统将拦截进入 Stage 5 的申请。
- **`environment_snapshot.json`**：包含 `environment_snapshot_en` 与 `environment_snapshot_cn` 双语版的环境参数快照。
  - **使用说明**：作为论文写作阶段 (Stage 6) 撰写“实验设置 (Experimental Setup)” 章节的核心依据材料。
- **`environment_snapshot_en.json` / `_cn.json`**：纯英/纯中双语版环境快照。
- **`containerize_brief.md`**：供人类快速审计的容器化与环境简报。

### 六、 核心维度与字段定义

| 类别         | 字段名称                 | 描述                                                       |
| :----------- | :----------------------- | :--------------------------------------------------------- |
| **物理资产** | `dockerfile_content`     | 包含 `FROM`, `RUN`, `ENV` 等标准指令的 Dockerfile 字符串。 |
|              | `mini_experiment_script` | 用于执行微量数据冒烟测试的 Python 脚本字符串。             |
| **快照参数** | `base_image`             | 使用的精确 Docker 基础镜像标签。                           |
|              | `hardware_requirements`  | 最低硬件要求（如显存、内存、计算卡型号）。                 |
|              | `determinism_guarantees` | 解释系统如何在容器、语言及库级别控制随机性。               |
| **元数据**   | `frozen_at`              | 容器冻结的 ISO 8601 时间戳。                               |

### 七、 示例

#### 7.1 运行示例

```bash
python scripts/mas4s_implement_containerize.py '{"run_id": "run_20260430"}'
```

#### 7.2 容器化环境简报示例

> # 阶段 4 步骤 4：容器化与环境快照简报 (Containerization Brief)
>
> ## 1. 基础镜像与依赖 (Base Image & Dependencies)
>
> 推断到项目依赖 `torch==2.1.0`，因此选用 `nvidia/cuda:12.1.0-cudnn8-runtime-ubuntu22.04` 作为基础镜像，保证 GPU 驱动映射无误。
>
> ## 2. 确定性保证 (Determinism Guarantees)
>
> Dockerfile 注入了 `ENV PYTHONHASHSEED=42`；同时在 `mini_experiment.py` 中强制覆盖所有调用的全局 `SEED=42`，并设置 `CUBLAS_WORKSPACE_CONFIG=:4096:8` 以确保算子确定性。
>
> ## 3. 冒烟测试设计 (Mini-Experiment)
>
> 迷你实验将从 `method_implementation` 导入算法类，利用模拟数据执行一次完整的 Forward Pass，并断言输出维度正确，确保环境依赖无冲突。

### 八、 SOP 观测支持

- **进度上报**：在关键点上报 `正在构建实验环境快照与 Dockerfile...` 与 `正在执行双语拆分落盘...`。
- **进度文件路径**：`~/.openclaw/workspace-implement/task/<run_id>/progress_mas4s_implement_containerize.jsonl`
- **防逃逸设计**：严格约束 `Dockerfile` 中不包含任何特权模式 (`--privileged`) 或不安全的挂载动作逻辑，保障集群运行时的宿主机安全。

### 九、 验证操作指南 (Verification Operation Guide)

容器化脚本生成后，必须由外部调度器或 CI 系统执行以下物理验证步骤，以产生阶段 5 所需的准入凭证：

#### 1. 构建实验镜像

使用产出的 `Dockerfile` 构建隔离的实验环境镜像。

```bash
docker build -t mas4s_exp:${RUN_ID} .
```

#### 2. 执行冒烟测试 (Smoke Test)

在容器内运行产出的 `mini_experiment.py`，验证端到端逻辑是否在冻结环境下依然自洽。

```bash
docker run --rm \
  -v $(pwd)/data:/data \
  mas4s_exp:${RUN_ID} \
  python mini_experiment.py > mini_experiment.log 2>&1
echo $? > mini_experiment_exit_code.txt
```

#### 3. 产出验证资产

执行结束后，系统需确保以下资产被正确保存并传递至阶段 5：

- **`mini_experiment_exit_code.txt`**：必须为 `0` 方可准入执行阶段。
- **`mini_experiment.log`**：包含详细的冒烟测试 stdout/stderr 日志，用于环境审计。

> [!IMPORTANT]
> 以上两个文件是 **阶段 5 步骤 1 (Env-Verify)** 的必需输入。如果冒烟测试失败，必须阻断流程，触发阶段 4 的回滚（Rollback）修复。
