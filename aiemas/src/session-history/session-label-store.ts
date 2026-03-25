import type { DatabaseSync } from "node:sqlite";

export interface SessionLabelEntry {
  sessionKey: string;
  label: string | null;
  displayName: string | null;
  updatedAt: number;
}

/**
 * Upsert label/displayName for a sessionKey.
 * Only updates fields that are explicitly provided (non-undefined).
 * Skips the write entirely if both values are null/undefined.
 */
export function upsertSessionLabel(
  db: DatabaseSync,
  sessionKey: string,
  patch: { label?: string | null; displayName?: string | null },
): void {
  const hasLabel = patch.label !== undefined;
  const hasDisplayName = patch.displayName !== undefined;
  if (!hasLabel && !hasDisplayName) {
    return;
  }

  const existing = getSessionLabel(db, sessionKey);
  const now = Date.now();

  if (!existing) {
    db.prepare(
      `INSERT INTO session_labels (sessionKey, label, displayName, updatedAt)
       VALUES (?, ?, ?, ?)`,
    ).run(
      sessionKey,
      hasLabel ? (patch.label ?? null) : null,
      hasDisplayName ? (patch.displayName ?? null) : null,
      now,
    );
    return;
  }

  // Merge: only overwrite fields that are explicitly provided.
  const nextLabel = hasLabel ? (patch.label ?? null) : existing.label;
  const nextDisplayName = hasDisplayName ? (patch.displayName ?? null) : existing.displayName;

  db.prepare(
    `UPDATE session_labels SET label = ?, displayName = ?, updatedAt = ? WHERE sessionKey = ?`,
  ).run(nextLabel, nextDisplayName, now, sessionKey);
}

/** Get the persisted label entry for a sessionKey, or null if not found. */
export function getSessionLabel(db: DatabaseSync, sessionKey: string): SessionLabelEntry | null {
  const row = db
    .prepare(
      `SELECT sessionKey, label, displayName, updatedAt FROM session_labels WHERE sessionKey = ?`,
    )
    .get(sessionKey) as SessionLabelEntry | undefined;
  return row ?? null;
}

/** List all persisted label entries, ordered by most recently updated. */
export function listSessionLabels(db: DatabaseSync): SessionLabelEntry[] {
  return db
    .prepare(
      `SELECT sessionKey, label, displayName, updatedAt FROM session_labels ORDER BY updatedAt DESC`,
    )
    .all() as unknown as SessionLabelEntry[];
}

/** Delete the label entry for a sessionKey (e.g. on session delete). */
export function deleteSessionLabel(db: DatabaseSync, sessionKey: string): void {
  db.prepare(`DELETE FROM session_labels WHERE sessionKey = ?`).run(sessionKey);
}
