import type { DatabaseSync } from "node:sqlite";

// ── Types ────────────────────────────────────────────────────────────────────

export interface StoredSummary {
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
    sessionKey: string;
    sessionId: string;
    textSummary: string | null;
    toolSummary: string | null;
    generatedAt: number;
    generatedBy: string;
  },
): StoredSummary {
  const { sessionKey, sessionId, textSummary, toolSummary, generatedAt, generatedBy } = params;
  db.prepare(
    `INSERT OR REPLACE INTO session_summaries
       (sessionKey, sessionId, textSummary, toolSummary, generatedAt, generatedBy)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(sessionKey, sessionId, textSummary, toolSummary, generatedAt, generatedBy);
  return { sessionKey, sessionId, textSummary, toolSummary, generatedAt, generatedBy };
}

/**
 * Get the persisted summary for a sessionKey and optional sessionId.
 * When sessionId is omitted, returns the latest summary for that sessionKey.
 * Returns null if no summary exists.
 */
export function getSummary(
  db: DatabaseSync,
  sessionKey: string,
  sessionId?: string,
): StoredSummary | null {
  if (sessionId) {
    const row = db
      .prepare(
        `SELECT sessionKey, sessionId, textSummary, toolSummary, generatedAt, generatedBy
           FROM session_summaries WHERE sessionKey = ? AND sessionId = ?`,
      )
      .get(sessionKey, sessionId) as StoredSummary | undefined;
    return row ?? null;
  }

  const row = db
    .prepare(
      `SELECT sessionKey, sessionId, textSummary, toolSummary, generatedAt, generatedBy
         FROM session_summaries WHERE sessionKey = ? ORDER BY generatedAt DESC LIMIT 1`,
    )
    .get(sessionKey) as StoredSummary | undefined;
  return row ?? null;
}

/**
 * Delete the summary for a sessionKey and optional sessionId.
 * Idempotent: does not throw if no summary exists.
 */
export function deleteSummary(db: DatabaseSync, sessionKey: string, sessionId?: string): void {
  if (sessionId) {
    db.prepare("DELETE FROM session_summaries WHERE sessionKey = ? AND sessionId = ?").run(
      sessionKey,
      sessionId,
    );
    return;
  }
  db.prepare("DELETE FROM session_summaries WHERE sessionKey = ?").run(sessionKey);
}

/**
 * Delete all messages and statistic rows for a sessionKey from mas4s.message.db.
 * Called when a session is permanently deleted.
 * Idempotent: does not throw if no rows exist.
 */
export function deleteSessionMessages(db: DatabaseSync, sessionKey: string): void {
  db.prepare("DELETE FROM session_messages WHERE sessionKey = ?").run(sessionKey);
  db.prepare("DELETE FROM session_msg_statistic WHERE sessionKey = ?").run(sessionKey);
}
