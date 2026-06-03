import type { GatewaySessionRow, SessionRunStatus } from "../lib/types.js";
import type { MessageContentItem } from "../lib/chat-types.js";
import type { ChatMessage } from "./chat-types.js";
import { normalizeMessage } from "../lib/message-normalizer.js";

// ── Sessions View Types ───────────────────────────────────────────────────────

/**
 * sessions.list API 返回的会话条目。
 * 用于独立 Sessions View 页面的会话列表展示。
 */
export interface SessionListItem {
  key: string;
  kind: string;
  updatedAt: number;
  sessionId: string;
  status: string;
  modelProvider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
  startedAt: number;
  endedAt: number;
  runtimeMs: number;
  hasActiveRun: boolean;
  contextTokens: number;
  label?: string;
  displayName?: string;
}

// ── Content Normalization ─────────────────────────────────────────────────────

/**
 * 将消息 content 规范化为 MessageContentItem 数组。
 * 处理两种格式：
 *   - string: 包装为单个 { type: "text", text } 项
 *   - array:  直接映射每个元素，确保 type 和 text 字段存在
 */
export function normalizeContent(content: unknown): MessageContentItem[] {
  if (typeof content === "string") {
    return [{ type: "text", text: content }];
  }
  if (Array.isArray(content)) {
    return content.map((item: Record<string, unknown>) => ({
      type: (typeof item.type === "string" ? item.type : "text") as MessageContentItem["type"],
      text: typeof item.text === "string" ? item.text : undefined,
      thinking: typeof item.thinking === "string" ? item.thinking : undefined,
      name: typeof item.name === "string" ? item.name : undefined,
      args: item.args,
      isError: typeof item.isError === "boolean" ? item.isError : undefined,
    }));
  }
  return [];
}

// ── Chat History Mapping ──────────────────────────────────────────────────────

/**
 * 将 chat.history API 响应中的原始消息数组转换为 ChatMessage[] 格式。
 * 使用现有 normalizeMessage 进行完整规范化（处理 structured prefixes、
 * inbound metadata stripping、tool_call 识别等）。
 */
export function mapHistoryToChatMessages(rawMessages: unknown[]): ChatMessage[] {
  return rawMessages.map((raw) => normalizeMessage(raw) as ChatMessage);
}

// ── Session List Sorting ──────────────────────────────────────────────────────

/**
 * 按 updatedAt 降序排序会话列表（最近更新的在前）。
 * 返回新数组，不修改原始数组。
 */
export function sortSessionsByUpdatedAt(sessions: SessionListItem[]): SessionListItem[] {
  return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
}

// ── Existing Types ────────────────────────────────────────────────────────────

/** 会话摘要（与后端 SessionSummary 等价） */
export interface SessionSummary {
  sessionKey: string;
  textSummary: string | null;
  toolSummary: string | null;
  generatedAt: number;
  generatedBy: string;
}

/**
 * mas4s 会话 = GatewaySessionRow（kind:"group"）+ mas4s 专属扩展。
 * status 直接复用 GatewaySessionRow.status。
 */
export interface MasSession extends GatewaySessionRow {
  /** 发起者（initiated）vs 参与者（participated），决定审批按钮可见性 */
  masType: "initiated" | "participated";
  hasNotification: boolean;
  notificationCount: number;
  participants: MasParticipant[];
  /** 归档时间戳，NULL/undefined 表示未归档 */
  archivedAt?: number | null;
  /** 是否已有持久化摘要 */
  hasSummary?: boolean;
}

export interface MasParticipant {
  id: string;
  name: string;
  isInitiator: boolean;
}

/** 从 GatewaySessionRow.status 派生 UI Tag type */
export function resolveStatusType(
  status: SessionRunStatus | undefined,
): "danger" | "warning" | "success" | "info" {
  switch (status) {
    case "failed":
    case "killed":
      return "danger";
    case "timeout":
      return "warning";
    case "done":
      return "success";
    case "running":
    default:
      return "info";
  }
}
