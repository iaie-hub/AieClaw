import type { GatewayBrowserClient } from "../lib/gateway.js";
import { normalizeMessage } from "../lib/message-normalizer.js";
import type { GatewaySessionRow } from "../lib/types.js";
import { SummaryStore } from "../store/summary-store.js";
import type { ChatMessage, MessageContentItem } from "../types/chat-types.js";
import type { MasSession } from "../types/session-types.js";
import { getSummary } from "./session-archive.js";

// ── splitHistoryMessage ───────────────────────────────────────────────────────

/**
 * Split a single history message into multiple messages when it contains mixed
 * content types (thinking, tool_call, text). This mirrors the real-time view
 * where each type is rendered as a separate bubble.
 *
 * Preserves the original content order by scanning items sequentially and
 * emitting a new bubble whenever the "group type" changes:
 *   - thinking items group together
 *   - each tool_call (with its immediately following tool_result) is one bubble
 *   - text items group together
 *
 * If the message contains only one type, it is returned as-is.
 */
function splitHistoryMessage(msg: ChatMessage): ChatMessage[] {
  const { content } = msg;

  const hasThinking = content.some((c) => c.type === "thinking");
  const hasToolCall = content.some((c) => c.type === "tool_call");

  // Nothing to split — single type content
  if (!hasThinking && !hasToolCall) {
    return [msg];
  }

  const result: ChatMessage[] = [];
  let currentGroup: MessageContentItem[] = [];
  // "thinking" | "tool" | "text"
  let currentType: string | null = null;

  const flushGroup = () => {
    if (currentGroup.length > 0) {
      result.push({ ...msg, content: [...currentGroup] });
      currentGroup = [];
    }
    currentType = null;
  };

  for (let i = 0; i < content.length; i++) {
    const item = content[i];
    if (!item) {
      continue;
    }

    if (item.type === "thinking") {
      if (currentType !== "thinking") {
        flushGroup();
        currentType = "thinking";
      }
      currentGroup.push(item);
    } else if (item.type === "tool_call") {
      // Each tool_call starts a new bubble
      flushGroup();
      currentType = "tool";
      const toolItems: MessageContentItem[] = [item];
      // Attach immediately following tool_result if present
      const next = content[i + 1];
      if (next?.type === "tool_result") {
        toolItems.push(next);
        i++;
      }
      result.push({ ...msg, content: toolItems });
      currentType = null;
    } else if (item.type === "tool_result") {
      // Orphaned tool_result (no preceding tool_call in this message) — own bubble
      flushGroup();
      result.push({ ...msg, content: [item] });
    } else {
      // text or other
      if (currentType !== "text") {
        flushGroup();
        currentType = "text";
      }
      currentGroup.push(item);
    }
  }

  flushGroup();

  return result.length > 0 ? result : [msg];
}

// ── session.label.get 响应类型 ────────────────────────────────────────────────

interface SessionLabelResult {
  sessionKey: string;
  label: string | null;
  displayName: string | null;
  updatedAt: number | null;
}

/**
 * 从 aiemas DB 查询持久化的 label/displayName。
 * 当 sessions.list 返回的 label/displayName 均为 null 时作为 fallback。
 */
export async function fetchSessionLabel(
  client: GatewayBrowserClient,
  sessionKey: string,
): Promise<SessionLabelResult | null> {
  try {
    const result = await client.request<SessionLabelResult>("session.label.get", { sessionKey });
    return result;
  } catch {
    return null;
  }
}

/**
 * 通过 WebSocket chat.history 拉取会话历史消息。
 * 返回规范化后的 ChatMessage 数组（最新消息在末尾）。
 */
export async function fetchSessionHistory(
  client: GatewayBrowserClient,
  sessionKey: string,
  limit = 200,
): Promise<ChatMessage[]> {
  const result = await client.request<{ messages?: unknown[] }>("chat.history", {
    sessionKey,
    limit,
  });
  return (result.messages ?? []).map((raw) => normalizeMessage(raw) as ChatMessage);
}

/**
 * 发起新会话：在 gateway 创建 group session，返回 masType="initiated" 的 MasSession。
 *
 * sessionKey 格式约定：含 ":group:" 的 key，gateway 自动将 kind 派生为 "group"。
 * 格式：`agent:{agentId}:group:mas-{uuid8}`
 * 不传 kind 字段（sessions.patch schema 不接受）。
 */
export async function createSession(
  client: GatewayBrowserClient,
  opts: {
    label: string;
    agentId?: string;
    participants?: string[];
    /** 是否启用思考流式输出，默认 "stream" */
    reasoningLevel?: "stream" | "on" | "off";
  },
): Promise<MasSession> {
  const uuid = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const agentId = opts.agentId ?? "default";
  const key = `agent:${agentId}:group:mas-${uuid}`;
  const reasoningLevel = opts.reasoningLevel ?? "stream";

  const result = await client.request<{
    ok?: boolean;
    key?: string;
    sessionId?: string;
    error?: { message?: string };
  }>("sessions.create", {
    key,
    label: opts.label,
    reasoningLevel,
  });

  // gateway returns ok:false with an error shape on failure (e.g. label conflict)
  if (result.ok === false) {
    throw new Error(result.error?.message ?? "sessions.create failed");
  }

  return {
    key: result.key ?? key,
    kind: "group",
    label: opts.label,
    updatedAt: Date.now(),
    status: "running",
    masType: "initiated",
    hasNotification: false,
    notificationCount: 0,
    participants: (opts.participants ?? []).map((name, i) => ({
      id: `p-${i}`,
      name,
      isInitiator: i === 0,
    })),
  } as MasSession;
}

/**
 * 将 GatewaySessionRow 归一化为 MasSession。
 * label 优先使用 row.label，回退到 row.displayName（gateway 从 channel/subject 派生），
 * 再回退到 persistedLabel（来自 aiemas DB session_labels 表），
 * 确保渲染层始终有可用的显示名称。
 */
function rowToMasSession(row: GatewaySessionRow, persistedLabel?: string | null): MasSession {
  let masType: "initiated" | "participated" = "initiated";
  if (row.masRole === "participant") {
    masType = "participated";
  }

  return {
    ...row,
    label: row.label ?? row.displayName ?? persistedLabel ?? undefined,
    kind: row.kind === "group" ? "group" : row.kind,
    masType,
    hasNotification: false,
    notificationCount: 0,
    participants: [],
  };
}

/**
 * 拉取当前用户有权限的会话列表（按 session_memberships 过滤）。
 * 在连接成功后调用，用于恢复历史会话。
 * 对 label/displayName 均为 null 的会话，fallback 查询 aiemas DB 的持久化 label。
 */
export async function fetchSessions(client: GatewayBrowserClient): Promise<MasSession[]> {
  const result = await client.request<{ sessions: GatewaySessionRow[] }>("sessions.list", {});
  const rows = result.sessions ?? [];

  // Batch-fetch persisted labels for rows that have no label/displayName from gateway.
  // This covers sessions whose label was lost due to reset path issues.
  const needsLabelFallback = rows.filter((r) => !r.label && !r.displayName);
  const labelMap = new Map<string, string | null>();
  if (needsLabelFallback.length > 0) {
    await Promise.all(
      needsLabelFallback.map(async (row) => {
        const entry = await fetchSessionLabel(client, row.key);
        const resolved = entry?.label ?? entry?.displayName ?? null;
        labelMap.set(row.key, resolved);
      }),
    );
  }

  const sessions = rows.map((row) => rowToMasSession(row, labelMap.get(row.key)));

  // Batch-load persisted summaries for sessions that have one (requirement 4.10)
  const withSummary = sessions.filter((s) => s.hasSummary === true);
  if (withSummary.length > 0) {
    const summaryStore = SummaryStore.instance;
    await Promise.all(
      withSummary.map(async (session) => {
        try {
          const summary = await getSummary(client, session.key);
          if (summary) {
            summaryStore.set(session.key, summary);
          }
        } catch {
          // Single failure must not block other sessions
        }
      }),
    );
  }

  return sessions;
}
export interface SessionHistoryRangeResult {
  messages: ChatMessage[]; // reversed to ASC (oldest first)
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
  truncated: boolean;
  hasSummary: boolean;
  sessionStats: {
    firstMsgAt: number | null;
    lastMsgAt: number | null;
    totalMsgCount: number;
  };
}

/**
 * 通过 session.history.range 拉取会话历史。
 * - from/to 均为可选，不传时查询全部消息。
 * - 支持分页（page/pageSize），由调用方显式指定，无内置默认值。
 * - 后端返回 DESC 顺序，此函数反转为 ASC 后返回。
 */
export async function fetchSessionHistoryRange(
  client: GatewayBrowserClient,
  sessionKey: string,
  opts?: { from?: number; to?: number; page?: number; pageSize?: number },
): Promise<SessionHistoryRangeResult> {
  const result = await client.request<{
    messages?: unknown[];
    total?: number;
    page?: number;
    pageSize?: number;
    totalPages?: number;
    truncated?: boolean;
    hasSummary?: boolean;
    sessionStats?: {
      firstMsgAt?: number | null;
      lastMsgAt?: number | null;
      totalMsgCount?: number;
    };
  }>("session.history.range", {
    sessionKey,
    ...(opts?.pageSize != null ? { pageSize: opts.pageSize } : {}),
    ...(opts?.from != null ? { from: opts.from } : {}),
    ...(opts?.to != null ? { to: opts.to } : {}),
    ...(opts?.page != null ? { page: opts.page } : {}),
  });

  // 先反转（DESC → ASC），再拆分，保证拆分后子消息顺序与原始顺序一致
  const messages = ([...(result.messages ?? [])] as unknown[])
    .toReversed() // DESC → ASC (mutates the copy above, safe)
    .flatMap((raw: unknown) => splitHistoryMessage(normalizeMessage(raw) as ChatMessage));

  return {
    messages,
    total: result.total ?? messages.length,
    page: result.page ?? 1,
    pageSize: result.pageSize ?? messages.length,
    totalPages: result.totalPages ?? 1,
    truncated: result.truncated ?? false,
    hasSummary: result.hasSummary ?? false,
    sessionStats: {
      firstMsgAt: result.sessionStats?.firstMsgAt ?? null,
      lastMsgAt: result.sessionStats?.lastMsgAt ?? null,
      totalMsgCount: result.sessionStats?.totalMsgCount ?? 0,
    },
  };
}

export async function renameSession(
  client: GatewayBrowserClient,
  sessionKey: string,
  label: string,
  reasoningLevel?: "stream" | "on" | "off",
): Promise<void> {
  const patch: Record<string, unknown> = { key: sessionKey, label };
  if (reasoningLevel !== undefined) {
    patch["reasoningLevel"] = reasoningLevel;
  }
  await client.request("sessions.patch", patch);
}

/**
 * 删除会话：通过 sessions.delete 请求删除指定会话及其消息记录。
 */
export async function deleteSession(
  client: GatewayBrowserClient,
  sessionKey: string,
): Promise<void> {
  await client.request("sessions.delete", { key: sessionKey, deleteTranscript: true });
}

/**
 * 加入已有会话：通过 sessions.resolve 验证 sessionKey 存在，
 * 再通过 sessions.list 获取完整 row，返回 masType="participated" 的 MasSession。
 */
export async function joinSession(
  client: GatewayBrowserClient,
  sessionKey: string,
): Promise<MasSession> {
  const resolved = await client.request<{ ok: boolean; key: string }>("sessions.resolve", {
    key: sessionKey,
  });

  if (!resolved.ok) {
    throw new Error(`会话不存在或已过期：${sessionKey}`);
  }

  const canonicalKey = resolved.key;

  // 通过 sessions.list 获取完整 row（含 label/status 等）
  const listResult = await client.request<{ sessions: GatewaySessionRow[] }>("sessions.list", {});
  const row = listResult.sessions.find((s) => s.key === canonicalKey);

  if (row) {
    return rowToMasSession(row);
  }
  return {
    key: canonicalKey,
    kind: "group" as const,
    updatedAt: null,
    masType: "participated",
    hasNotification: false,
    notificationCount: 0,
    participants: [],
  } as MasSession;
}
