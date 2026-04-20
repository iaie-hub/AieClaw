import type { DatabaseSync } from "node:sqlite";
import type { StoredMessage } from "./session-transcript-store.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface HistoryRangeParams {
  sessionUuid: string;
  sessionKey?: string;
  /** When specified, only return messages for this sessionId */
  sessionId?: string;
  /**
   * Unix ms lower bound (inclusive). When omitted, no lower bound is applied
   * and the query returns messages from the beginning of the session.
   */
  from?: number;
  /**
   * Unix ms upper bound (inclusive). When omitted, no upper bound is applied
   * and the query returns messages up to the latest.
   */
  to?: number;
  /**
   * Page number (1-based). Combined with pageSize for cursor-free pagination.
   * Default: 1.
   */
  page?: number;
  /**
   * Number of messages per page. Default 50, max 1000.
   * When both page/pageSize and the legacy limit param are provided,
   * pageSize takes precedence.
   */
  pageSize?: number;
  /**
   * @deprecated Use pageSize instead. Removed — no longer accepted.
   */
  limit?: never;
  /** Buffer messages not yet persisted, merged with DB results */
  buffered?: StoredMessage[];
  /**
   * Optional resolver: given a userId returns the user's current displayName.
   * When provided, each message is enriched with a senderLabel field.
   * Kept as a callback so callers can use an in-memory cache instead of a DB query.
   */
  resolveDisplayName?: (userId: string) => string | undefined;
}

/** StoredMessage enriched with the sender's current displayName. */
export type StoredMessageWithSender = StoredMessage & { senderLabel: string | null };

export interface HistoryRangeResult {
  messages: StoredMessageWithSender[]; // timestamp ASC order (oldest first)
  total: number; // total count matching the filter (before pagination)
  page: number; // current page (1-based)
  pageSize: number; // effective page size
  totalPages: number; // ceil(total / pageSize)
  truncated: boolean; // true when total > pageSize (kept for backward compat)
  hasSummary: boolean; // whether any message in the full result has role='summary'
  /** Session-level aggregate statistics from session_msg_statistic. */
  sessionStats: {
    firstMsgAt: number | null; // earliest message timestamp (ms), null if no messages
    lastMsgAt: number | null; // latest message timestamp (ms), null if no messages
    totalMsgCount: number; // total persisted message count across all time
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Map a raw SQLite row to a StoredMessage, handling nullable fields. */
function rowToStoredMessage(row: Record<string, unknown>): StoredMessage {
  return {
    id: row["id"] as string,
    sessionUuid: row["sessionUuid"] as string,
    sessionKey: row["sessionKey"] as string,
    sessionId: row["sessionId"] as string,
    userId: (row["userId"] as string | null) ?? null,
    tenantId: (row["tenantId"] as string | null) ?? null,
    role: row["role"] as StoredMessage["role"],
    content: row["content"] as string,
    timestamp: row["timestamp"] as number,
    seq: row["seq"] as number,
    archivedDate: (row["archivedDate"] as string | null) ?? null,
    toolCallId: (row["toolCallId"] as string | null) ?? null,
    toolName: (row["toolName"] as string | null) ?? null,
    parentSessionUuid: (row["parentSessionUuid"] as string | null) ?? null,
    sourceAgentId: (row["sourceAgentId"] as string | null) ?? null,
  };
}

/**
 * Deduplicate messages by id. DB messages are written first, then buffer
 * messages overwrite them — so buffer takes priority for the same id.
 */
function dedupeById(messages: StoredMessage[]): StoredMessage[] {
  const map = new Map<string, StoredMessage>();
  for (const msg of messages) {
    map.set(msg.id, msg);
  }
  return Array.from(map.values());
}

// ── Query ────────────────────────────────────────────────────────────────────

export function queryHistoryRange(
  db: DatabaseSync,
  params: HistoryRangeParams,
): HistoryRangeResult {
  // ── Pagination params ──────────────────────────────────────────────────────
  // Default pageSize 100 per product requirement.
  const pageSize = Math.min(params.pageSize ?? 100, 1000);
  const page = Math.max(params.page ?? 1, 1);
  const offset = (page - 1) * pageSize;

  // ── Build conditional SQL ──────────────────────────────────────────────────
  // from/to are truly optional: omitting them removes the time filter entirely.
  let sql = "SELECT * FROM session_messages WHERE sessionUuid = ?";
  const sqlParams: unknown[] = [params.sessionUuid];

  if (params.from !== undefined) {
    sql += " AND timestamp >= ?";
    sqlParams.push(params.from);
  }
  if (params.to !== undefined) {
    sql += " AND timestamp <= ?";
    sqlParams.push(params.to);
  }
  if (params.sessionId !== undefined) {
    sql += " AND sessionId = ?";
    sqlParams.push(params.sessionId);
  }

  sql += " ORDER BY timestamp DESC";

  // ── Query DB ───────────────────────────────────────────────────────────────
  const stmt = db.prepare(sql);
  const rawRows = stmt.all(...(sqlParams as Parameters<typeof stmt.all>)) as Record<
    string,
    unknown
  >[];
  const dbMessages = rawRows.map(rowToStoredMessage);

  // ── Merge buffer messages ──────────────────────────────────────────────────
  const buffered = (params.buffered ?? []).filter(
    (m) =>
      m.sessionUuid === params.sessionUuid &&
      (params.from === undefined || m.timestamp >= params.from) &&
      (params.to === undefined || m.timestamp <= params.to) &&
      (params.sessionId === undefined || m.sessionId === params.sessionId),
  );

  // DB messages first, then buffer — buffer overwrites DB for same id.
  // Sort DESC (newest first) for LIMIT efficiency, reversed to ASC before return.
  const merged = dedupeById([...dbMessages, ...buffered]).toSorted(
    (a, b) => b.timestamp - a.timestamp,
  );

  // ── Pagination ─────────────────────────────────────────────────────────────
  const total = merged.length;
  const hasSummary = merged.some((m) => (m.role as string) === "summary");
  const totalPages = Math.max(Math.ceil(total / pageSize), 1);
  const messages = merged.slice(offset, offset + pageSize);

  // ── Enrich with senderLabel ────────────────────────────────────────────────
  // Only resolve display names for user messages; assistant/tool messages
  // render as "Agent" in the UI (senderLabel=null), matching real-time behavior.
  const { resolveDisplayName } = params;
  const enriched: StoredMessageWithSender[] = messages.map(
    (m) =>
      Object.assign(m, {
        senderLabel:
          m.role === "agent" && m.sourceAgentId
            ? `Agent: ${m.sourceAgentId}`
            : m.role === "user" && m.userId && resolveDisplayName
              ? (resolveDisplayName(m.userId) ?? null)
              : null,
      }) as StoredMessageWithSender,
  );

  // ── Session-level statistics from session_msg_statistic ──────────────────
  // Read the pre-aggregated row so we never need a COUNT(*) on session_messages.
  let sessionStats: HistoryRangeResult["sessionStats"] = {
    firstMsgAt: null,
    lastMsgAt: null,
    totalMsgCount: 0,
  };
  try {
    let statSql =
      "SELECT firstMsgAt, lastMsgAt, msgCount FROM session_msg_statistic WHERE sessionUuid = ?";
    const statParams: unknown[] = [params.sessionUuid];
    if (params.sessionId) {
      statSql += " AND sessionId = ?";
      statParams.push(params.sessionId);
    } else {
      // If no sessionId specified, return the most recent session's stats for this key.
      statSql += " ORDER BY lastMsgAt DESC LIMIT 1";
    }

    const statRow = db.prepare(statSql).get(...(statParams as Parameters<typeof stmt.get>)) as
      | { firstMsgAt: number; lastMsgAt: number; msgCount: number }
      | undefined;
    if (statRow) {
      sessionStats = {
        firstMsgAt: statRow.firstMsgAt,
        lastMsgAt: statRow.lastMsgAt,
        totalMsgCount: statRow.msgCount,
      };
    }
  } catch {
    // session_msg_statistic may not exist on older DBs — degrade gracefully.
  }

  return {
    // Reverse from DESC (DB fetch order) to ASC (oldest first) before returning.
    messages: enriched.toReversed(),
    total,
    page,
    pageSize,
    totalPages,
    truncated: total > pageSize,
    hasSummary,
    sessionStats,
  };
}
