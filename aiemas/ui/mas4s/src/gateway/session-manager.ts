import type { GatewayBrowserClient } from "../lib/gateway.js";
import { normalizeMessage } from "../lib/message-normalizer.js";
import type { GatewaySessionRow } from "../lib/types.js";
import { SummaryStore } from "../store/summary-store.js";
import type { ChatMessage, MessageContentItem } from "../types/chat-types.js";
import type { MasSession } from "../types/session-types.js";
import { getSummary } from "./session-archive.js";

// ── splitHistoryMessage ───────────────────────────────────────────────────────

/**
 * Split a single history message into multiple messages when it contains
 * tool_call items. This mirrors the real-time view where:
 *   - thinking + text render together in one bubble (msg-agent._renderContent)
 *   - each tool_call (with its immediately following tool_result) is one bubble
 *
 * Strategy: scan items sequentially; emit a new bubble only when a tool_call
 * is encountered. thinking and text items always stay together.
 *
 * If the message contains no tool_call items, it is returned as-is.
 */
function splitHistoryMessage(msg: ChatMessage): ChatMessage[] {
  const { content } = msg;

  const hasToolCall = content.some((c) => c.type === "tool_call");

  // Nothing to split — no tool calls
  if (!hasToolCall) {
    return [msg];
  }

  const result: ChatMessage[] = [];
  // Accumulates thinking + text items until a tool_call is encountered
  let pendingItems: MessageContentItem[] = [];

  const flushPending = () => {
    if (pendingItems.length > 0) {
      result.push({ ...msg, content: [...pendingItems] });
      pendingItems = [];
    }
  };

  for (let i = 0; i < content.length; i++) {
    const item = content[i];
    if (!item) {
      continue;
    }

    if (item.type === "tool_call") {
      // Flush any accumulated thinking/text before this tool call
      flushPending();
      const toolItems: MessageContentItem[] = [item];
      // Attach immediately following tool_result if present
      const next = content[i + 1];
      if (next?.type === "tool_result") {
        toolItems.push(next);
        i++;
      }
      result.push({ ...msg, content: toolItems });
    } else if (item.type === "tool_result") {
      // Orphaned tool_result (no preceding tool_call in this message) — own bubble
      flushPending();
      result.push({ ...msg, content: [item] });
    } else {
      // thinking, text, or other — accumulate together
      pendingItems.push(item);
    }
  }

  flushPending();

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
  const agentId = opts.agentId ?? "default";
  const reasoningLevel = opts.reasoningLevel ?? "stream";

  const result = await client.request<{
    sessionKey?: string;
    sessionId?: string;
    error?: { message?: string };
  }>("aiemas.sessions.create", {
    agentId,
    label: opts.label,
    reasoningLevel,
  });

  if (!result.sessionKey) {
    throw new Error(result.error?.message ?? "aiemas.sessions.create failed");
  }

  return {
    key: result.sessionKey,
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
 * displayName 已由服务端 enrichSessionRow 从 session_labels 表注入，无需前端二次查询。
 */
export async function fetchSessions(client: GatewayBrowserClient): Promise<MasSession[]> {
  const result = await client.request<{ sessions: GatewaySessionRow[] }>(
    "aiemas.sessions.list",
    {},
  );
  const rows = result.sessions ?? [];
  const sessions = rows.map((row) => rowToMasSession(row));

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

  // Backend returns messages in ASC order (oldest first) — no reversal needed.
  // 先拆分，保证拆分后子消息顺序与原始顺序一致
  const messages = ([...(result.messages ?? [])] as unknown[]).flatMap((raw: unknown) =>
    splitHistoryMessage(normalizeMessage(raw) as ChatMessage),
  );

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
  await client.request("aiemas.sessions.delete", { sessionKey });
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

  // 通过 aiemas.sessions.list 获取完整 row（含 label/status 等）
  const listResult = await client.request<{ sessions: GatewaySessionRow[] }>(
    "aiemas.sessions.list",
    {},
  );
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
/**
 * 更新会话关联的 Agent。
 */
export async function updateSessionAgent(
  client: GatewayBrowserClient,
  sessionKey: string,
  agentId: string,
): Promise<void> {
  await client.request("session.agent.update", { sessionKey, agentId });
}
