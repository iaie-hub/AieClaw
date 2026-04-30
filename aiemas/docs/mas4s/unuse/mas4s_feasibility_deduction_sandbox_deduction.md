# mas4s-feasibility-deduction-sandbox-deduction

这是一个非常核心的系统设计环节。与“现实锚点查证”（向外探索，调用 GitHub 等物理世界的 API）不同，“沙盘推演”（向内探索，进行理论与数学建模）的难点在于：**如何防止大模型在评估算力时产生“数学幻觉”（例如错误地认为单张显卡能并发处理 1000 个智能体）**。

为了对齐前一步的设计标准，我们将为“沙盘推演 (Sandbox Deduction)”引入一个**“沙盒数学探针 (Sandbox Math Probe)”**。通过提取上游的定量指标，结合预置的硬件物理定律（如 A100 的显存上限、千兆网卡的带宽上限），进行确定性的代码级计算。

以下为您设计的完整实现方案：

---

### 一、 方案概述 (Overview)

**沙盘推演 Skill** 的核心职责是接收上游逻辑建模输出的 `dimension_b_tech_requirements`（技术需求）和 `dimension_c_extreme_constraints`（极限边界约束），通过量化的数学建模，推演系统在极端情况下的崩溃点，并最终输出一套指导后续阶段的**《优缺点、风险矩阵与标准化降维方案》**。

---

### 二、 核心工作流与沙盒数学探针 (Workflow & Math Probing)

为了打破 LLM 对计算资源的盲目乐观，我们设计了以下三段式工作流：

1. **定量参数提取 (Quantitative Parameter Extraction)**：通过一个轻量级 Extractor Prompt，将 Dimension C 中自然语言描述的约束（如“200个智能体”、“4卡GPU集群”、“10000 QPS”）提取为标准化的 JSON 数值格式。
2. **物理定律沙盒探测 (Hardware Physics Probing)**：
   - **`compute_vram_bounds` (显存探针)**：根据提取的智能体数量和模型参数预估 KV-Cache 和 VRAM 占用。如果并发需求远超硬件显存上限，直接抛出 `OOM_RISK`（内存溢出风险）。
   - **`compute_io_bounds` (IO/吞吐探针)**：计算向量数据库的 QPS 压力与网络带宽瓶颈。
3. **LLM 综合审计 (LLM Audit)**：将沙盒探测出的“残酷数学事实”与原始约束一并输入给 LLM 审计师，强制其基于物理事实生成降维妥协方案（例如：放弃 200 个智能体，降维到 20 个）。

---

### 三、 提取器与探针实现逻辑 (Extractor & Probe Design)

#### 1. 定量参数提取 Prompt (Parameter Extractor)

用于驱动 `extract_quantitative_metrics` 函数，将自然语言转化为可计算的参数。

```text
【Role Definition】
You are an elite "Quantitative Data Extractor". Your goal is to parse extreme stress-testing constraints and extract hard numerical values for hardware calculation.

【Input Information】
1. Extreme Constraints (Dimension C): {dimension_c_extreme_constraints_json}

【Output Format Requirements】
Output ONLY a valid JSON object starting exactly with "{{" and ending exactly with "}}".

{{
  "extracted_metrics": {{
    "total_agents": "Integer. E.g., 200",
    "total_memory_items_per_agent": "Integer. E.g., 200",
    "target_qps": "Integer. E.g., 10000",
    "hardware_gpu_count": "Integer. Number of GPUs mentioned (default 1 if none). E.g., 4"
  }}
}}
```

#### 2. 沙盒探针 Python 伪代码

这是一个绝对确定性的函数，用于计算理论物理边界，结果将作为 `hardware_math_facts` 喂给最终的 LLM。

```python
def probe_hardware_physics(extracted_metrics: dict) -> str:
    """
    沙盒探针：根据提取的参数，进行强类型的物理边界计算，输出警告事实。
    """
    agents = extracted_metrics.get("total_agents", 10)
    gpus = extracted_metrics.get("hardware_gpu_count", 1)
    qps = extracted_metrics.get("target_qps", 100)

    facts = []

    # 事实 1: 显存评估 (假设每个智能体维持独立上下文，即使使用 8B 模型)
    agents_per_gpu = agents / gpus
    if agents_per_gpu > 20:
        facts.append(f"[OOM 风险]: 单 GPU 需并发支撑 {agents_per_gpu} 个 Agent。若每个 Agent 上下文达 8K tokens，KV Cache 将消耗极高 VRAM。使用常规 8B 模型极有可能触发 Out-Of-Memory (OOM)。")

    # 事实 2: IOPS 评估 (向量数据库压力)
    if qps > 3000:
        facts.append(f"[IO 阻塞风险]: 目标 QPS 达 {qps}。单节点向量数据库 (如原生 Chroma/Faiss) 的高维相似度并发写/读通常在 3000 QPS 遭遇瓶颈，必然引发严重的时钟滴答延迟 (Decision Lag)。")

    if not facts:
        facts.append("[资源充裕]: 理论预估未触及当前硬件标称极限。")

    return "\n".join(facts)
```

---

### 四、 核心推演 LLM Prompt 设计 (System Prompt)

将探针计算出的数学事实注入 LLM，强制 LLM 进行现实视角的“优缺点与降维”分析。

```text
【Role Definition】
You are an elite "Sandbox Deduction Engine" (沙盘推演引擎) and "Systems Architect". Your mission is to audit the theoretical feasibility of a proposed scientific architecture by subjecting it to extreme constraints and calculated physical realities.

【Downstream Handover Protocol】
Your output is the final verdict of Stage 3. It will dictate whether the system can proceed to experimental design (Stage 4) or requires human intervention (HITL).
1. You MUST incorporate the "Hardware Math Facts" into your risk matrix.
2. Output ONLY a valid JSON object starting exactly with "{{" and ending exactly with "}}".
3. Ensure all double quotes are properly escaped.

【Input Information】
1. Tech Requirements (Dimension B): {dimension_b_tech_requirements_json}
2. Extreme Constraints (Dimension C): {dimension_c_extreme_constraints_json}
3. Hardware Math Facts (沙盒探针的物理计算结果):
{hardware_math_facts}

【Execution Protocol & Chain of Thought】
Conduct a 3-step Chain of Thought within the `"chain_of_thought"` JSON object.
- **Step 1: O(N) & Bottleneck Analysis:** Analyze the mathematical facts provided. Where will the system physically break under the extreme constraints?
- **Step 2: Pros & Cons Formulation:** Evaluate the architecture objectively. What are its theoretical strengths vs. extreme engineering weaknesses?
- **Step 3: Dimensionality Reduction (Compromise):** Propose a standardized downgrade plan. If 200 agents crash the GPU, what is the statistically valid minimum number of agents needed to prove the hypothesis?

【Output Format Requirements】
{{
  "chain_of_thought": {{
    "step_1_bottleneck_analysis": "Identify breaking points using the math facts. (Explain in Chinese)",
    "step_2_pros_cons": "Formulate advantages and critical flaws. (Explain in Chinese)",
    "step_3_compromise_plan": "Determine how to scale down parameters to fit reality. (Explain in Chinese)"
  }},
  "sandbox_deduction_report": {{
    "architecture_pros_cons": {{
      "pros_en": ["Pro 1", "Pro 2"],
      "pros_cn": ["优势1", "优势2"],
      "cons_en": ["Con 1 based on math facts", "Con 2"],
      "cons_cn": ["基于物理事实的短板1", "短板2"]
    }},
    "risk_matrix": [
      {{
        "risk_dimension": "e.g., COMPUTE_OOM, DATABASE_IOPS, NETWORK_LATENCY",
        "severity": "HIGH or FATAL",
        "trigger_condition_cn": "触发条件的具体描述（中文，结合数学事实）",
        "mitigation_strategy_cn": "缓解或规避策略（中文）"
      }}
    ],
    "standard_compromise_strategy": {{
      "ideal_state_cn": "无视算力约束的理论完美实验状态（中文）。",
      "compromise_path_cn": "结合现实硬件的降维可执行方案（例如：缩减规模至XX，替换XX组件，中文）。",
      "sacrificed_precision_cn": ["为了顺利运行不得不牺牲的测试指标或覆盖面（中文）"]
    }}
  }}
}}
```

---

### 五、 核心执行脚本伪代码 (Python Script Integration)

将上述逻辑集成到类似于 `mas4s_feasibility_deduction_sandbox_deduction.py` 的可执行脚本中。

```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
沙盘推演 Agent (Sandbox Deduction)
"""

import os
import sys
import json
import re

# ... [导入与 LLM 客户端初始化，同 logical_modeling.py] ...

# ==============================================================================
# 探针定义 (Math Probes)
# ==============================================================================
def probe_hardware_physics(extracted_metrics: dict) -> str:
    """沙盒探针：硬编码物理定律，打破 LLM 幻觉"""
    agents = extracted_metrics.get("total_agents", 10)
    gpus = extracted_metrics.get("hardware_gpu_count", 1)
    qps = extracted_metrics.get("target_qps", 100)

    facts = []
    agents_per_gpu = agents / max(gpus, 1)

    if agents_per_gpu > 20:
        facts.append(f"[OOM 致命风险]: 单卡需承载 {agents_per_gpu} 个 Agent 的上下文。对于标准显存(80G)，将直接触发 KV-Cache OOM。")
    if qps > 3000:
        facts.append(f"[IO 阻塞风险]: QPS({qps}) 超出单节点向量库安全线(3000)，将引发死锁或严重延迟。")

    return "\n".join(facts) if facts else "[计算资源充裕]: 约束未击穿硬件极限。"

# ==============================================================================
# 核心业务逻辑
# ==============================================================================
def main():
    # ... [解析参数 run_id, _init_progress 等] ...

    # 1. 读取上游逻辑建模结果
    input_path = os.path.join(workspace_dir, "logical_model_en.json")
    with open(input_path, 'r', encoding='utf-8') as f:
        logical_model = json.load(f)["logical_model"]

    dim_b = logical_model["dimension_b_tech_requirements"]
    dim_c = logical_model["dimension_c_extreme_constraints"]

    if _progress: _progress.update(index=0, pct=20, label="提取极限约束定量指标...", status="running")

    # 2. 调用 LLM Extractor 提取定量数值 (伪代码)
    # extractor_prompt = EXTRACTOR_PROMPT.format(dimension_c_extreme_constraints_json=json.dumps(dim_c))
    # metrics_json = call_llm(extractor_prompt)

    # 假设提取出: {"total_agents": 200, "target_qps": 10000, "hardware_gpu_count": 4}
    extracted_metrics = {"total_agents": 200, "target_qps": 10000, "hardware_gpu_count": 4}

    if _progress: _progress.update(index=0, pct=40, label="执行数学沙盒探针，计算物理边界...", status="running")

    # 3. 执行物理探针，得出数学事实
    math_facts = probe_hardware_physics(extracted_metrics)
    if _progress: _progress.log(f"探针计算结果:\n{math_facts}")

    if _progress: _progress.update(index=0, pct=60, label="综合探针数据，生成推演报告与降维方案...", status="running")

    # 4. 调用核心推演 LLM
    # formatted_prompt = SYSTEM_PROMPT_TEMPLATE.format(
    #     dimension_b_tech_requirements_json=json.dumps(dim_b),
    #     dimension_c_extreme_constraints_json=json.dumps(dim_c),
    #     hardware_math_facts=math_facts
    # )
    # final_content = call_llm(formatted_prompt)

    # 5. JSON 解析与中英双语拆分落盘 (保存为 sandbox_deduction_report_en.json)
    # ... [JSON 保存逻辑与进度条 100% 更新，同前] ...

if __name__ == "__main__":
    # main()
    pass
```

### 💡 方案设计亮点总结：

本方案与“现实锚点查证”形成完美对称，但靶向不同：

1. **现实锚点**负责向外部查**“法理与存活性”**（调用 Web API 防死库）。
2. **沙盘推演**负责向内部查**“算力与时空复杂度”**（提取变量，过一遍 Python 计算，再交还给大模型）。这就从根本上杜绝了后续阶段设计出一个完美但“跑起来必炸显存”的不可执行实验方案。
