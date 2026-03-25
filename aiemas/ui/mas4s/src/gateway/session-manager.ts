import type { GatewayBrowserClient } from "../lib/gateway.js";
import { normalizeMessage } from "../lib/message-normalizer.js";
import type { GatewaySessionRow } from "../lib/types.js";
import { SummaryStore } from "../store/summary-store.js";
import type { ChatMessage } from "../types/chat-types.js";
import type { MasSession } from "../types/session-types.js";
import { getSummary } from "./session-archive.js";

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
 * 确保渲染层始终有可用的显示名称。
 */
function rowToMasSession(row: GatewaySessionRow): MasSession {
  let masType: "initiated" | "participated" = "initiated";
  if (row.masRole === "participant") {
    masType = "participated";
  }

  return {
    ...row,
    label: row.label ?? row.displayName,
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
 */
export async function fetchSessions(client: GatewayBrowserClient): Promise<MasSession[]> {
  const result = await client.request<{ sessions: GatewaySessionRow[] }>("sessions.list", {});
  const sessions = (result.sessions ?? []).map((row) => rowToMasSession(row));

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
  truncated: boolean;
  hasSummary: boolean;
}

/**
 * 通过 session.history.range 拉取会话历史（默认最近 30 天，limit 200）。
 * 后端返回 DESC 顺序，此函数反转为 ASC 后返回。
 */
export async function fetchSessionHistoryRange(
  client: GatewayBrowserClient,
  sessionKey: string,
  opts?: { from?: number; to?: number; limit?: number },
): Promise<SessionHistoryRangeResult> {
  const result = await client.request<{
    messages?: unknown[];
    total?: number;
    truncated?: boolean;
    hasSummary?: boolean;
  }>("session.history.range", {
    sessionKey,
    limit: opts?.limit ?? 200,
    ...(opts?.from != null ? { from: opts.from } : {}),
    ...(opts?.to != null ? { to: opts.to } : {}),
  });

  const messages = (result.messages ?? [])
    .map((raw) => normalizeMessage(raw) as ChatMessage)
    .toReversed(); // DESC → ASC

  return {
    messages,
    total: result.total ?? messages.length,
    truncated: result.truncated ?? false,
    hasSummary: result.hasSummary ?? false,
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
