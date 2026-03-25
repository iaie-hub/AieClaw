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

/**
 * A stored message as returned by `session.history.range`.
 * `content` is the plain-text serialisation produced by SessionTranscriptStore.
 */
export interface StoredMessageForSummary {
  role: string;
  content: string;
  senderLabel?: string | null;
  timestamp: number;
}

// ── Content extraction ───────────────────────────────────────────────────────

/**
 * Extract text lines and tool-call pairs directly from `session.history.range`
 * stored messages, whose `content` is the plain-text format written by
 * SessionTranscriptStore.extractContent():
 *
 *   - "[thinking] <text with \\n escaped>"  → skip (internal reasoning)
 *   - "[tool_use:name] <json-args>"         → collect as tool call
 *   - "[tool_result] <text>"                → pair with preceding tool call
 *   - everything else                       → visible text line
 *
 * Tool calls and their results are stored together in a single assistant
 * message separated by "\n", so we parse line-by-line.
 */
export function extractContentFromStoredMessages(
  messages: StoredMessageForSummary[],
): ExtractedContent {
  const textLines: string[] = [];
  const toolPairs: ToolPair[] = [];

  for (const m of messages) {
    const role = m.role;
    const content = typeof m.content === "string" ? m.content : "";

    if (role === "user") {
      const text = content.trim();
      if (text) {
        textLines.push(`${m.senderLabel ?? "用户"}: ${text}`);
      }
      continue;
    }

    if (role === "assistant") {
      const lines = content.split("\n");
      const visibleLines: string[] = [];
      let pendingToolName: string | null = null;
      let pendingToolArgs: unknown = {};

      for (const line of lines) {
        if (line.startsWith("[thinking] ")) {
          continue;
        }
        const toolUseMatch = /^\[tool_use:([^\]]+)\](?: (.*))?$/.exec(line);
        if (toolUseMatch) {
          pendingToolName = toolUseMatch[1];
          try {
            pendingToolArgs = JSON.parse(toolUseMatch[2] ?? "{}");
          } catch {
            pendingToolArgs = toolUseMatch[2] ?? "";
          }
          continue;
        }
        const toolResultMatch = /^\[tool_result\] (.*)$/.exec(line);
        if (toolResultMatch) {
          if (pendingToolName) {
            toolPairs.push({
              name: pendingToolName,
              arguments: pendingToolArgs,
              result: toolResultMatch[1].replace(/\\n/g, "\n"),
              isError: false,
            });
            pendingToolName = null;
            pendingToolArgs = {};
          }
          continue;
        }
        const trimmed = line.trim();
        if (trimmed) {
          visibleLines.push(trimmed);
        }
      }

      // tool_use with no matching tool_result — record with placeholder result
      if (pendingToolName) {
        toolPairs.push({
          name: pendingToolName,
          arguments: pendingToolArgs,
          result: "success",
          isError: false,
        });
      }

      const text = visibleLines.join("\n").trim();
      if (text) {
        textLines.push(`助手: ${text}`);
      }
    }
  }

  return { textLines, toolPairs };
}

/**
 * Extract text lines and tool-call pairs from chat history messages (ContentBlock[] format).
 * Kept for callers that still use the ChatHistoryMessage shape.
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

export async function generateSummaryWithLLM(
  textLines: string[],
  toolPairs: ToolPair[],
  _generatedBy: string,
  config?: { baseUrl: string; apiKey: string; model: string },
): Promise<LLMSummaryResult> {
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

  if (textLines.length === 0 && toolPairs.length === 0) {
    throw new TenantServiceError(NO_MESSAGES_TO_SUMMARIZE, "No messages to summarize");
  }

  const generatedAt = Date.now();

  // ── Text summary ────────────────────────────────────────────────────────────
  let textSummary: string | null = null;
  if (textLines.length > 0) {
    // console.log(
    //   `[mas4s:summary] Text lines to summarize (${textLines.length}):\n${textLines.join("\n")}`,
    // );
    const conversationLog = textLines.join("\n");
    const textPrompt = `以下是需要分析的多人多 Agent 协作对话记录：

<conversation_log>
${conversationLog}
</conversation_log>

请严谨追踪身份，提取核心信息并生成协作摘要：`;

    const textSystemPrompt = `你是一个专业的多用户多 Agent 协作网络的对话记录分析与摘要专家。

# 输出规则（最高优先级，必须严格遵守）
- 直接输出摘要内容。
- 严禁输出任何思考过程、推理步骤、自我纠正、括号注释或对本指令的解读。
- 严禁输出类似 "(Note: ...)"、"(Correction: ...)"、"Let's look closely..."、"Wait, checking..."、"*Constraint:*" 等内容。
- 严禁复述或引用本 system prompt 的任何内容。

# Guidelines
1. 精准的身份识别：明确标记每一个想法、动作和结论的具体归属，不混淆不同用户和不同 Agent。
2. 绝不遗漏任何用户的想法（最高优先级）：完整保留所有参与用户表达的想法、计划、期望或潜在目标，与提出者绑定记录。
3. 严格过滤 Agent 的思考过程：不将任何 Agent 的内部推理纳入摘要，仅基于最终输出的可见回复和实际触发的系统动作进行总结。
4. 梳理协作链路：关注交互流转，如"[用户A] 提出需求 -> [Agent X] 给出方案 -> 系统反馈结果"。
5. 客观简明沉淀：提炼关键上下文作为长期记忆素材。

# Output Format
请严格按照以下 Markdown 结构输出：

**📅 协作概览**
- **核心主题**：[一句话概括]
- **👥 活跃参与者**：
  - **人类用户**：[列出所有用户]
  - **AI Agents**：[列出所有 Agent]
- **关键时间/状态**：[关键时间节点或系统初始状态]

**💡 各参与者的核心想法/意图 (绝不遗漏)**
- **[[用户/Agent 名称]]**：[该角色表达的全部想法、计划、期望]
- **[[用户/Agent 名称]]**：[...]

**🎯 关键协作链路与执行动作**
- **[协作节点1]**：**[[发起用户]]** 提出需求 -> **[[响应 Agent]]** 给出方案或执行动作 -> 系统结果
- **[协作节点2]**：...

**🧠 知识沉淀与全局备忘 (长期记忆)**
- **角色/设定记录**：[Agent 设定、用户偏好等]
- **系统/文件状态**：[文件路径、系统变化、未完成待办等]`;

    textSummary = await callLLM(baseUrl, apiKey, model, textPrompt, textSystemPrompt);
    // console.log(`[mas4s:summary] Generated text summary:\n${textSummary}`);
  }

  // ── Tool summary ────────────────────────────────────────────────────────────
  let toolSummary: string | null = null;
  if (toolPairs.length > 0) {
    const toolRecords = toolPairs
      .map((tp) => {
        const status = tp.isError ? "[failure]" : "[success]";
        const args = typeof tp.arguments === "string" ? tp.arguments : JSON.stringify(tp.arguments);
        return `${status} ${tp.name}(${args})`;
      })
      .join("\n");

    // console.log(`[mas4s:summary] Tool pairs to summarize (${toolPairs.length}):\n${toolRecords}`);
    const toolPrompt = `以下是需要分析的工具调用日志：

<tool_logs>
${toolRecords}
</tool_logs>

请聚合逻辑动作并生成语义化摘要：`;

    const toolSystemPrompt = `你是一个专业的 Agent 工具调用与执行日志分析专家。

# 输出规则（最高优先级，必须严格遵守）
- 直接输出摘要内容。
- 严禁输出任何思考过程、推理步骤、自我纠正、括号注释或对本指令的解读。
- 严禁输出类似 "(Note: ...)"、"Wait, checking..."、"*Constraint:*" 等内容。

# Guidelines
1. 语义聚合（核心要求）：将目标相近的连续调用合并为一个逻辑动作，不逐条翻译日志。
2. 意图推断：透过工具调用推断 Agent 的真实意图。
3. 状态关注：捕捉执行结果，对失败调用简要说明。
4. 资产提取：提取核心文件路径、数据库表、关键命令，不写绝对长路径。
5. 极简客观：只陈述执行了什么动作和结果如何。

# Output Format
**⚙️ 核心执行意图**
- [一句话概括这批工具调用的高层任务]

**🛠️ 动作轨迹 (按逻辑聚合)**
- **[动作模块1]**：[语义动作描述] -> (执行状态: 成功/包含失败)
  - 细节：[具体操作]
- **[动作模块2]**：...

**📁 涉及的核心资产 (指纹)**
- **读取/查询**：[关键文件名或查询目标]
- **修改/执行**：[变更资产或高危命令]

**⚠️ 异常与报错提示**
- [全部成功则填"无异常，全部调用成功"；有失败则列出]`;

    toolSummary = await callLLM(baseUrl, apiKey, model, toolPrompt, toolSystemPrompt);
    // console.log(`[mas4s:summary] Generated tool summary:\n${toolSummary}`);
  }

  return { textSummary, toolSummary, generatedAt };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Strip thinking/reasoning preamble from LLM output.
 * Handles multiple thinking tag styles and header-based sections:
 *   - <think>...</think>       (DeepSeek-R1)
 *   - <thinking>...</thinking> (Claude extended thinking / some open models)
 *   - <reasoning>...</reasoning>
 *   - "Thinking Process:" / "Reasoning:" / "Chain-of-Thought:" headed sections
 */
function stripThinkingPreamble(text: string): string {
  // Strip all known thinking/reasoning block tags
  let result = text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/<reasoning>[\s\S]*?<\/reasoning>/gi, "")
    .trim();

  const thinkingHeaderRe = /^(?:thinking process|reasoning|chain[- ]of[- ]thought)\s*:/im;
  if (thinkingHeaderRe.test(result)) {
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
 * Send a streaming chat-completion request to an OpenAI-compatible endpoint.
 * Using streaming avoids gateway timeouts on long conversations — the connection
 * stays alive while tokens arrive, and we reassemble the full text before returning.
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

  // console.log(`[mas4s:callLLM] systemPrompt:\n${systemPrompt ?? defaultSystemPrompt}`);
  // console.log(`[mas4s:callLLM] userMessage:\n${userMessage}`);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt ?? defaultSystemPrompt },
        { role: "user", content: userMessage },
      ],
      temperature: 0.9,
      // Disable thinking mode for Qwen3-series models — thinking content leaks
      // into the output when the server does not separate reasoning_content.
      enable_thinking: false,
      stream: true,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`LLM request failed (${res.status}): ${body}`);
  }

  if (!res.body) {
    throw new Error("LLM response has no body");
  }

  // Accumulate streamed SSE chunks into full content and reasoning_content strings.
  let content = "";
  let reasoningContent = "";
  const decoder = new TextDecoder();
  const reader = res.body.getReader();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      // Keep the last (potentially incomplete) line in the buffer
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) {
          continue;
        }
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") {
          break;
        }

        let chunk: {
          choices?: Array<{
            delta?: { content?: string | null; reasoning_content?: string | null };
          }>;
        };
        try {
          chunk = JSON.parse(data) as typeof chunk;
        } catch {
          // Malformed chunk — skip
          continue;
        }

        const delta = chunk.choices?.[0]?.delta;
        if (delta?.content) {
          content += delta.content;
        }
        if (delta?.reasoning_content) {
          reasoningContent += delta.reasoning_content;
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  // When reasoning_content is present (Qwen3 thinking mode with server-side separation),
  // use only content. Otherwise strip any inline thinking tags from the assembled text.
  const raw = reasoningContent.length > 0 ? content.trim() : stripThinkingPreamble(content.trim());
  return raw;
}
