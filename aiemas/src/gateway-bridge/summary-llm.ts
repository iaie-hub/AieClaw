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
      const text = m.content
        .filter((c): c is ContentBlock & { type: "text"; text: string } => c.type === "text")
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
        result: resultText,
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
): Promise<LLMSummaryResult> {
  // Validate env
  const baseUrl = process.env.MAS4S_LLM_BASE_URL;
  const apiKey = process.env.MAS4S_LLM_API_KEY;
  const model = process.env.MAS4S_LLM_MODEL;

  if (!baseUrl || !apiKey || !model) {
    throw new TenantServiceError(
      LLM_NOT_CONFIGURED,
      "LLM environment variables are not configured",
    );
  }

  // Nothing to summarize
  if (textLines.length === 0 && toolPairs.length === 0) {
    throw new TenantServiceError(NO_MESSAGES_TO_SUMMARIZE, "No messages to summarize");
  }

  const generatedAt = Date.now();

  // Generate text summary (skip if no text lines)
  let textSummary: string | null = null;
  if (textLines.length > 0) {
    const textPrompt = [
      "你是一个会话摘要助手。请对以下多智能体协作会话的对话内容生成简洁摘要（不超过 300 字），涵盖主要讨论话题和关键决策。",
      "",
      "对话内容：",
      textLines.join("\n"),
    ].join("\n");
    textSummary = await callLLM(baseUrl, apiKey, model, textPrompt);
  }

  // Generate tool summary (skip if no tool pairs)
  let toolSummary: string | null = null;
  if (toolPairs.length > 0) {
    const toolRecords = toolPairs
      .map((tp) => {
        const status = tp.isError ? "[失败]" : "[成功]";
        const args = typeof tp.arguments === "string" ? tp.arguments : JSON.stringify(tp.arguments);
        return `${status} ${tp.name}(${args}) → ${tp.result}`;
      })
      .join("\n");

    const toolPrompt = [
      "你是一个会话摘要助手。请对以下工具调用记录生成简洁摘要（不超过 300 字），列出执行了哪些工具、主要参数和结果，标注失败的调用。",
      "",
      "工具调用记录：",
      toolRecords,
    ].join("\n");
    toolSummary = await callLLM(baseUrl, apiKey, model, toolPrompt);
  }

  return { textSummary, toolSummary, generatedAt };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Send a single chat-completion request to an OpenAI-compatible endpoint.
 */
async function callLLM(
  baseUrl: string,
  apiKey: string,
  model: string,
  userMessage: string,
): Promise<string> {
  const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: userMessage }],
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

  return json.choices?.[0]?.message?.content?.trim() ?? "";
}
