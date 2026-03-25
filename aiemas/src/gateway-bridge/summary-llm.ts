/**
 * LLM-based session summary generation.
 *
 * Extracts conversation text and tool-call pairs from chat history,
 * then calls an OpenAI-compatible LLM to produce concise summaries.
 */

import { TenantServiceError, LLM_NOT_CONFIGURED, NO_MESSAGES_TO_SUMMARIZE } from "../errors.js";

// ── Types ────────────────────────────────────────────────────────────────────

/** A paired tool invocation and its result. */
export interface ToolPair {
  name: string;
  arguments: unknown;
  result: string;
  isError: boolean;
}

/** Content block inside a ChatHistoryMessage. */
interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  arguments?: unknown;
}

/** A single message from `chat.history` response. */
export interface ChatHistoryMessage {
  role: "user" | "assistant" | "toolResult";
  content: ContentBlock[];
  timestamp: number;
  senderLabel?: string;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
}

/** Result of extracting content for summary generation. */
export interface ExtractedContent {
  textLines: string[];
  toolPairs: ToolPair[];
}

// ── Content extraction ───────────────────────────────────────────────────────

/**
 * Extract text lines and tool-call pairs from chat history messages.
 *
 * - `user` messages → text prefixed with senderLabel (or "用户")
 * - `assistant` messages → text prefixed with "助手"; toolCall entries collected
 * - `toolResult` messages → paired with their toolCall via toolCallId
 */
export function extractContentForSummary(messages: ChatHistoryMessage[]): ExtractedContent {
  const textLines: string[] = [];
  const toolCallMap = new Map<string, { name: string; arguments: unknown }>();
  const toolPairs: ToolPair[] = [];

  for (const m of messages) {
    if (m.role === "user") {
      const text = m.content
        .filter((c): c is ContentBlock & { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("")
        .trim();
      if (text) {
        textLines.push(`${m.senderLabel ?? "用户"}: ${text}`);
      }
    } else if (m.role === "assistant") {
      // Exclude thinking blocks — only extract visible text
      const text = m.content
        .filter(
          (c): c is ContentBlock & { type: "text"; text: string } =>
            c.type === "text" && c.thinking == null,
        )
        .map((c) => c.text)
        .join("")
        .trim();
      if (text) {
        textLines.push(`助手: ${text}`);
      }

      // Collect tool calls
      for (const c of m.content) {
        if (c.type === "toolCall" && c.id) {
          toolCallMap.set(c.id, { name: c.name ?? "unknown", arguments: c.arguments ?? {} });
        }
      }
    } else if (m.role === "toolResult") {
      const call = m.toolCallId ? toolCallMap.get(m.toolCallId) : undefined;
      const resultText = m.content
        .filter((c): c is ContentBlock & { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("")
        .trim();
      toolPairs.push({
        name: call?.name ?? m.toolName ?? "unknown",
        arguments: call?.arguments ?? {},
        result: resultText || (m.isError ? "failure" : "success"),
        isError: m.isError ?? false,
      });
    }
  }

  return { textLines, toolPairs };
}

// ── LLM summary generation ──────────────────────────────────────────────────

/** Result returned by `generateSummaryWithLLM`. */
export interface LLMSummaryResult {
  textSummary: string | null;
  toolSummary: string | null;
  generatedAt: number;
}

/**
 * Call an OpenAI-compatible LLM to generate text and tool-call summaries.
 *
 * Environment variables:
 * - `MAS4S_LLM_BASE_URL` – base URL of the LLM API (e.g. `https://api.openai.com/v1`)
 * - `MAS4S_LLM_API_KEY`  – bearer token
 * - `MAS4S_LLM_MODEL`    – model identifier (e.g. `gpt-4o-mini`)
 *
 * Throws `LLM_NOT_CONFIGURED` when env vars are missing.
 * Throws `NO_MESSAGES_TO_SUMMARIZE` when both inputs are empty.
 */
export async function generateSummaryWithLLM(
  textLines: string[],
  toolPairs: ToolPair[],
  _generatedBy: string,
  config?: { baseUrl: string; apiKey: string; model: string },
): Promise<LLMSummaryResult> {
  // Validate env
  const baseUrl = config?.baseUrl ?? process.env.MAS4S_LLM_BASE_URL;
  const apiKey = config?.apiKey ?? process.env.MAS4S_LLM_API_KEY;
  const model = config?.model ?? process.env.MAS4S_LLM_MODEL;

  if (!baseUrl || !apiKey || !model) {
    console.error(
      `[mas4s] LLM not configured: baseUrl=${baseUrl}, hasApiKey=${Boolean(apiKey)}, model=${model}`,
    );
    throw new TenantServiceError(
      LLM_NOT_CONFIGURED,
      "LLM environment variables are not configured",
    );
  }

  console.log(
    `[mas4s] Calling LLM: model=${model}, baseUrl=${baseUrl}, apiKeyLength=${apiKey?.length ?? 0}`,
  );

  // Nothing to summarize
  if (textLines.length === 0 && toolPairs.length === 0) {
    throw new TenantServiceError(NO_MESSAGES_TO_SUMMARIZE, "No messages to summarize");
  }

  const generatedAt = Date.now();

  // Generate text summary (skip if no text lines)
  let textSummary: string | null = null;
  if (textLines.length > 0) {
    console.log(
      `[mas4s:summary] Text lines to summarize (${textLines.length}):\n${textLines.join("\n")}`,
    );
    const conversationLog = textLines.join("\n");
    const textPrompt = `# Input Context
以下是需要分析的多人多 Agent 协作对话记录：

<conversation_log>
${conversationLog}
</conversation_log>

请根据上述要求，严谨追踪身份，提取核心信息并生成协作摘要：`;
    const textSystemPrompt = `# Role
你是一个专业的 **多用户多 Agent 协作网络** 的对话记录分析与摘要专家。你的任务是从包含多名人类用户、多个 AI Agent 以及系统异步反馈的复杂对话记录中，提取核心脉络并生成结构化摘要。

# Guidelines
1. **精准的身份识别（Multi-Role Tracking）**：在整个摘要过程中，必须明确标记每一个想法、动作和结论的**具体归属**。绝不能混淆不同用户（如：管理员、USER1、普通访客等）的发言，也不能混淆不同 Agent（如：Age、其他专业 Agent）的输出。
2. **🎯 绝不遗漏任何用户的想法（最高优先级）**：必须精准捕捉并完整保留**所有参与用户**在对话中表达的想法、计划、期望或潜在目标。即使是随口一提、尚未成型的构思，也必须与具体的提出者绑定并记录，绝不允许为了精简而删减用户的意图。
3. **🚫 严格过滤所有 Agent 的思考过程**：绝对不要将任何 Agent 的内部思考过程、推理轨迹（如被 \`<think>\`、\`<thought>\` 等标签包裹的内容，或是自我纠错的中间步骤）纳入摘要。仅基于 Agent **最终输出的可见回复**和**实际触发的系统动作**进行总结。
4. **梳理协作链路**：关注交互的流转过程，例如：“[用户A] 提出需求 -> [Agent X] 给出方案 -> [用户B] 补充意见 -> [Agent Y] 执行动作 -> 系统反馈结果”。
5. **客观简明沉淀**：使用精炼、客观的语言，提取对话中暴露的关键上下文（设定、文件、环境状态等）作为整个系统的长期记忆素材。

# Output Format
请严格按照以下 Markdown 结构输出你的摘要：

**📅 协作概览**
- **核心主题**：[一句话概括本次多方协作的主要内容与进度]
- **👥 活跃参与者**：
  - **人类用户**：[列出参与对话的所有用户，如：管理员、USER1 等]
  - **AI Agents**：[列出参与响应的所有 Agent，如：Age 等]
- **关键时间/状态**：[提取对话中明确提到的关键时间节点或系统环境初始状态]

**💡 各参与者的核心想法/意图 (绝不遗漏)**
- **[[用户/Agent 名称]]**：[详细列出该角色在此次对话中表达的全部想法、计划、期望或核心提议。有几个人表达了想法，就列出几项]
- **[[用户/Agent 名称]]**：[...]

**🎯 关键协作链路与执行动作**
- **[协作节点1]**：**[[发起用户]]** 提出需求/想法 -> **[[响应 Agent]]** 最终给出的方案或执行的动作 -> 系统结果如何
- **[协作节点2]**：...
*(注：需清晰体现出多人、多 Agent 之间的交互接力)*

**🧠 知识沉淀与全局备忘 (长期记忆)**
- **角色/设定记录**：[需记住的 Agent 设定、各个用户的特定偏好等]
- **系统/文件状态**：[已创建的文件路径、系统环境变化、未完成的待办事项等]

# Input Context
以下是需要分析的多人多 Agent 协作对话记录：
<conversation_log>
{{在此处插入对话记录}}
</conversation_log>

请根据上述要求，严谨追踪身份，提取核心信息并生成协作摘要：`;
    textSummary = await callLLM(baseUrl, apiKey, model, textPrompt, textSystemPrompt);
    console.log(`[mas4s:summary] Generated text summary:\n${textSummary}`);
  }

  // Generate tool summary (skip if no tool pairs)
  let toolSummary: string | null = null;
  if (toolPairs.length > 0) {
    const toolRecords = toolPairs
      .map((tp) => {
        const status = tp.isError ? "[failure]" : "[success]";
        const args = typeof tp.arguments === "string" ? tp.arguments : JSON.stringify(tp.arguments);
        return `${status} ${tp.name}(${args})`;
      })
      .join("\n");

    console.log(`[mas4s:summary] Tool pairs to summarize (${toolPairs.length}):\n${toolRecords}`);
    const toolPrompt = `# Input Context
以下是需要分析的工具调用日志：

<tool_logs>
${toolRecords}
</tool_logs>

请根据上述要求，聚合逻辑动作并生成语义化摘要：`;
    const toolSystemPrompt = `# Role
你是一个专业的 Agent 工具调用与执行日志分析专家。你的任务是将底层、琐碎的 API/命令调用记录，转化为人类和其他 Agent 易于理解的**高层语义动作摘要**。

# Guidelines
1. **语义聚合（核心要求）**：绝不要像流水账一样逐条翻译日志！必须将目标相近的连续调用合并为一个“逻辑动作”。（例如：连续 \`read\` 多个历史对话文件，应总结为“检索/加载历史记忆记录”）。
2. **意图推断**：透过工具调用的表面现象，推断 Agent 尝试完成的真实意图（例如：查探目录、修改配置、验证身份等）。
3. **状态关注**：敏锐捕捉执行结果（\`[success]\` 或 \`[error]/[fail]\`）。对于失败的调用，需简要指明尝试了什么但失败了；如果全部成功，则一笔带过。
4. **资产提取**：提取操作中涉及的核心文件路径、数据库表、关键命令或 URL，作为“执行指纹”保留，过滤掉无关紧要的临时变量。
5. **极简客观**：只陈述“执行了什么动作”和“结果如何”，不要去猜测 Agent 的内心活动。

# Output Format
请严格按照以下 Markdown 结构输出你的摘要：

**⚙️ 核心执行意图**
- [一句话概括这批工具调用主要是为了完成什么高层任务]

**🛠️ 动作轨迹 (按逻辑聚合)**
- **[动作模块1]**：[描述聚合后的语义动作，如“环境探测”或“记忆检索”] -> (执行状态: 成功/包含失败)
  - 细节：[简述具体干了什么，如“列出了 /tmp 目录列表”或“读取了某某文件”]
- **[动作模块2]**：...

**📁 涉及的核心资产 (指纹)**
- **读取/查询**：[列出关键的文件名或查询目标，不写绝对长路径，写相对路径或文件名即可]
- **修改/执行**：[列出发生变更的资产或执行的关键高危命令]

**⚠️ 异常与报错提示**
- [如果全部成功，请填写“无异常，全部调用成功”。如果有失败，列出失败的具体动作及报错原因]

# Input Context
以下是需要分析的工具调用日志：
<tool_logs>
{{在此处插入工具调用日志}}
</tool_logs>

请根据上述要求，聚合逻辑动作并生成语义化摘要：`;
    toolSummary = await callLLM(baseUrl, apiKey, model, toolPrompt, toolSystemPrompt);
    console.log(`[mas4s:summary] Generated tool summary:\n${toolSummary}`);
  }

  return { textSummary, toolSummary, generatedAt };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Strip thinking/reasoning preamble from LLM output.
 *
 * Some models (e.g. Claude with extended thinking, DeepSeek-R1) emit a
 * reasoning block before the final answer. We only want the final answer.
 *
 * Patterns handled:
 * - "Thinking Process:\n...\n\nFinal answer" → keep only the part after the last blank line
 * - "<think>...</think>" XML-style tags → strip the tag and its content
 * - Numbered reasoning steps followed by a blank line + prose → keep prose only
 */
function stripThinkingPreamble(text: string): string {
  // Strip <think>...</think> blocks (DeepSeek-R1 style)
  let result = text.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();

  // Strip "Thinking Process:" headed sections: everything up to the last blank-line boundary
  // before a non-indented paragraph that looks like the actual answer.
  const thinkingHeaderRe = /^(?:thinking process|reasoning|chain[- ]of[- ]thought)\s*:/im;
  if (thinkingHeaderRe.test(result)) {
    // Split on double newlines; the last non-empty paragraph is the answer.
    const paragraphs = result
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (paragraphs.length > 1) {
      result = paragraphs[paragraphs.length - 1]!;
    }
  }

  return result.trim();
}

/**
 * Send a single chat-completion request to an OpenAI-compatible endpoint.
 * @param baseUrl - Base URL of the LLM API
 * @param apiKey - Bearer token
 * @param model - Model identifier
 * @param userMessage - User prompt (caller-specified)
 * @param systemPrompt - Optional system prompt (defaults to generic summary instruction)
 */
async function callLLM(
  baseUrl: string,
  apiKey: string,
  model: string,
  userMessage: string,
  systemPrompt?: string,
): Promise<string> {
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;

  const defaultSystemPrompt =
    "你是一个会话摘要助手。你只输出最终摘要文本，不要输出思考过程、推理步骤或任何前言。直接给出简洁的摘要内容。";

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: "system",
          content: systemPrompt ?? defaultSystemPrompt,
        },
        { role: "user", content: userMessage },
      ],
      temperature: 0.3,
      max_tokens: 1024,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LLM request failed (${res.status}): ${body}`);
  }

  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const raw = json.choices?.[0]?.message?.content?.trim() ?? "";
  return stripThinkingPreamble(raw);
}
