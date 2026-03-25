import type { DatabaseSync } from "node:sqlite";

// ── Types ────────────────────────────────────────────────────────────────────

export interface StoredSummary {
  sessionKey: string;
  textSummary: string | null;
  toolSummary: string | null;
  generatedAt: number;
  generatedBy: string;
}

// ── Store functions ───────────────────────────────────────────────────────────

/**
 * Insert or replace a session summary in the session_summaries table.
 * Uses INSERT OR REPLACE for upsert semantics (one summary per sessionKey).
 */
export function upsertSummary(
  db: DatabaseSync,
  params: {
    sessionKey: string;
    textSummary: string | null;
    toolSummary: string | null;
    generatedAt: number;
    generatedBy: string;
  },
): StoredSummary {
  const { sessionKey, textSummary, toolSummary, generatedAt, generatedBy } = params;
  db.prepare(
    `INSERT OR REPLACE INTO session_summaries
       (sessionKey, textSummary, toolSummary, generatedAt, generatedBy)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(sessionKey, textSummary, toolSummary, generatedAt, generatedBy);
  return { sessionKey, textSummary, toolSummary, generatedAt, generatedBy };
}

/**
 * Get the persisted summary for a sessionKey.
 * Returns null if no summary exists.
 */
export function getSummary(db: DatabaseSync, sessionKey: string): StoredSummary | null {
  const row = db
    .prepare(
      `SELECT sessionKey, textSummary, toolSummary, generatedAt, generatedBy
         FROM session_summaries WHERE sessionKey = ?`,
    )
    .get(sessionKey) as StoredSummary | undefined;
  return row ?? null;
}

/**
 * Delete the summary for a sessionKey.
 * Idempotent: does not throw if no summary exists.
 */
export function deleteSummary(db: DatabaseSync, sessionKey: string): void {
  db.prepare("DELETE FROM session_summaries WHERE sessionKey = ?").run(sessionKey);
}

/**
 * Delete all messages and statistic row for a sessionKey from mas4s.message.db.
 * Called when a session is permanently deleted.
 * Idempotent: does not throw if no rows exist.
 */
export function deleteSessionMessages(db: DatabaseSync, sessionKey: string): void {
  db.prepare("DELETE FROM session_messages WHERE sessionKey = ?").run(sessionKey);
  db.prepare("DELETE FROM session_msg_statistic WHERE sessionKey = ?").run(sessionKey);
}
