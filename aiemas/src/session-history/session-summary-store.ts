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
  parentSessionUuid: string | null;
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
    parentSessionUuid?: string | null;
  },
): StoredSummary {
  const {
    sessionUuid,
    sessionKey,
    sessionId,
    textSummary,
    toolSummary,
    generatedAt,
    generatedBy,
    parentSessionUuid = null,
  } = params;
  db.prepare(
    `INSERT OR REPLACE INTO session_summaries
       (sessionUuid, sessionKey, sessionId, textSummary, toolSummary, generatedAt, generatedBy, parentSessionUuid)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    sessionUuid,
    sessionKey,
    sessionId,
    textSummary,
    toolSummary,
    generatedAt,
    generatedBy,
    parentSessionUuid,
  );
  return {
    sessionUuid,
    sessionKey,
    sessionId,
    textSummary,
    toolSummary,
    generatedAt,
    generatedBy,
    parentSessionUuid,
  };
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
        `SELECT sessionUuid, sessionKey, sessionId, textSummary, toolSummary, generatedAt, generatedBy, parentSessionUuid
           FROM session_summaries WHERE sessionUuid = ? AND sessionId = ?`,
      )
      .get(sessionUuid, sessionId) as StoredSummary | undefined;
    return row ?? null;
  }

  const row = db
    .prepare(
      `SELECT sessionUuid, sessionKey, sessionId, textSummary, toolSummary, generatedAt, generatedBy, parentSessionUuid
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
  // Cascading delete for summaries
  db.prepare("DELETE FROM session_summaries WHERE sessionUuid = ? OR parentSessionUuid = ?").run(
    sessionUuid,
    sessionUuid,
  );
}

/**
 * Delete all messages and statistic rows for a sessionKey from mas4s.message.db.
 * Called when a session is permanently deleted. Cascades to sub-agents.
 * Idempotent: does not throw if no rows exist.
 */
export function deleteSessionMessages(db: DatabaseSync, sessionUuid: string): void {
  // Cascading delete: remove the session itself AND any sub-sessions that point to it as parent.
  db.prepare("DELETE FROM session_messages WHERE sessionUuid = ? OR parentSessionUuid = ?").run(
    sessionUuid,
    sessionUuid,
  );
  db.prepare(
    "DELETE FROM session_msg_statistic WHERE sessionUuid = ? OR parentSessionUuid = ?",
  ).run(sessionUuid, sessionUuid);
  db.prepare("DELETE FROM session_summaries WHERE sessionUuid = ? OR parentSessionUuid = ?").run(
    sessionUuid,
    sessionUuid,
  );
}
