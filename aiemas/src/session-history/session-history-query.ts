import type { DatabaseSync } from "node:sqlite";
import type { StoredMessage } from "./session-transcript-store.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface HistoryRangeParams {
  sessionKey: string;
  /** When specified, only return messages for this sessionId */
  sessionId?: string;
  /** Unix ms, default now - 30 days */
  from?: number;
  /** Unix ms, default now */
  to?: number;
  /** Default 200, max 1000 */
  limit?: number;
  /** Buffer messages not yet persisted, merged with DB results */
  buffered?: StoredMessage[];
}

export interface HistoryRangeResult {
  messages: StoredMessage[]; // timestamp DESC order
  total: number; // total count in time range (including buffer)
  truncated: boolean;
  hasSummary: boolean; // whether any message has role='summary'
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Map a raw SQLite row to a StoredMessage, handling nullable fields. */
function rowToStoredMessage(row: Record<string, unknown>): StoredMessage {
  return {
    id: row["id"] as string,
    sessionKey: row["sessionKey"] as string,
    sessionId: row["sessionId"] as string,
    userId: (row["userId"] as string | null) ?? null,
    tenantId: (row["tenantId"] as string | null) ?? null,
    role: row["role"] as StoredMessage["role"],
    content: row["content"] as string,
    timestamp: row["timestamp"] as number,
    seq: row["seq"] as number,
    archivedDate: (row["archivedDate"] as string | null) ?? null,
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
  // ── 3.1 Parameter defaults ─────────────────────────────────────────────────
  const now = Date.now();
  const from = params.from ?? now - 30 * 24 * 60 * 60 * 1000;
  const to = params.to ?? now;
  const limit = Math.min(params.limit ?? 200, 1000);

  // ── 3.2 Build conditional SQL and query DB ─────────────────────────────────
  let sql = "SELECT * FROM session_messages WHERE sessionKey = ? AND timestamp BETWEEN ? AND ?";
  const sqlParams: unknown[] = [params.sessionKey, from, to];

  if (params.sessionId !== undefined) {
    sql += " AND sessionId = ?";
    sqlParams.push(params.sessionId);
  }

  sql += " ORDER BY timestamp DESC";

  const stmt = db.prepare(sql);
  const rawRows = stmt.all(...(sqlParams as Parameters<typeof stmt.all>)) as Record<
    string,
    unknown
  >[];
  const dbMessages = rawRows.map(rowToStoredMessage);

  // ── 3.3 Merge buffer messages, deduplicate, sort ───────────────────────────
  const buffered = (params.buffered ?? []).filter(
    (m) =>
      m.sessionKey === params.sessionKey &&
      m.timestamp >= from &&
      m.timestamp <= to &&
      (params.sessionId === undefined || m.sessionId === params.sessionId),
  );

  // DB messages first, then buffer — buffer overwrites DB for same id
  const merged = dedupeById([...dbMessages, ...buffered]).toSorted(
    (a, b) => b.timestamp - a.timestamp,
  );

  // ── 3.4 Compute result fields ──────────────────────────────────────────────
  const total = merged.length;
  const hasSummary = merged.some((m) => m.role === "summary");
  const messages = merged.slice(0, limit);

  return {
    messages,
    total,
    truncated: messages.length < total,
    hasSummary,
  };
}
