import type { DatabaseSync } from "node:sqlite";

// ── Types ────────────────────────────────────────────────────────────────────

export interface StoredSummary {
  sessionUuid: string;
  sessionKey: string;
  sessionId: string;
  textSummary: string | null;
  toolSummary: string | null;
  generatedAt: number;
  generatedBy: string;
}

// ── Store functions ───────────────────────────────────────────────────────────

/**
 * Insert or replace a session summary in the session_summaries table.
 * Uses INSERT OR REPLACE for upsert semantics (one summary per (sessionKey, sessionId)).
 */
export function upsertSummary(
  db: DatabaseSync,
  params: {
    sessionUuid: string;
    sessionKey: string;
    sessionId: string;
    textSummary: string | null;
    toolSummary: string | null;
    generatedAt: number;
    generatedBy: string;
  },
): StoredSummary {
  const { sessionUuid, sessionKey, sessionId, textSummary, toolSummary, generatedAt, generatedBy } =
    params;
  db.prepare(
    `INSERT OR REPLACE INTO session_summaries
       (sessionUuid, sessionKey, sessionId, textSummary, toolSummary, generatedAt, generatedBy)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(sessionUuid, sessionKey, sessionId, textSummary, toolSummary, generatedAt, generatedBy);
  return { sessionUuid, sessionKey, sessionId, textSummary, toolSummary, generatedAt, generatedBy };
}

/**
 * Get the persisted summary for a sessionKey and optional sessionId.
 * When sessionId is omitted, returns the latest summary for that sessionKey.
 * Returns null if no summary exists.
 */
export function getSummary(
  db: DatabaseSync,
  sessionUuid: string,
  sessionId?: string,
): StoredSummary | null {
  if (sessionId) {
    const row = db
      .prepare(
        `SELECT sessionUuid, sessionKey, sessionId, textSummary, toolSummary, generatedAt, generatedBy
           FROM session_summaries WHERE sessionUuid = ? AND sessionId = ?`,
      )
      .get(sessionUuid, sessionId) as StoredSummary | undefined;
    return row ?? null;
  }

  const row = db
    .prepare(
      `SELECT sessionUuid, sessionKey, sessionId, textSummary, toolSummary, generatedAt, generatedBy
         FROM session_summaries WHERE sessionUuid = ? ORDER BY generatedAt DESC LIMIT 1`,
    )
    .get(sessionUuid) as StoredSummary | undefined;
  return row ?? null;
}

/**
 * Delete the summary for a sessionKey and optional sessionId.
 * Idempotent: does not throw if no summary exists.
 */
export function deleteSummary(db: DatabaseSync, sessionUuid: string, sessionId?: string): void {
  if (sessionId) {
    db.prepare("DELETE FROM session_summaries WHERE sessionUuid = ? AND sessionId = ?").run(
      sessionUuid,
      sessionId,
    );
    return;
  }
  db.prepare("DELETE FROM session_summaries WHERE sessionUuid = ?").run(sessionUuid);
}

/**
 * Delete all messages and statistic rows for a sessionKey from mas4s.message.db.
 * Called when a session is permanently deleted.
 * Idempotent: does not throw if no rows exist.
 */
export function deleteSessionMessages(db: DatabaseSync, sessionUuid: string): void {
  db.prepare("DELETE FROM session_messages WHERE sessionUuid = ?").run(sessionUuid);
  db.prepare("DELETE FROM session_msg_statistic WHERE sessionUuid = ?").run(sessionUuid);
}
