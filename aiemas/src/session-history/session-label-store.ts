import type { DatabaseSync } from "node:sqlite";
import { extractUuidFromKey, extractAgentNameFromKey } from "../utils/session-utils.js";

export interface SessionLabelEntry {
  sessionUuid: string;
  label: string | null;
  displayName: string | null;
  currentAgentId: string | null;
  updatedAt: number;
}

/**
 * Upsert label/displayName/currentAgentId for a session.
 * Accepts sessionKey and handles UUID extraction internally.
 */
export function upsertSessionLabel(
  db: DatabaseSync,
  sessionKey: string,
  patch: { label?: string | null; displayName?: string | null; currentAgentId?: string | null },
): void {
  const uuid = extractUuidFromKey(sessionKey);
  const now = Date.now();

  const existing = getSessionLabel(db, uuid);

  if (!existing) {
    const agentId = patch.currentAgentId ?? extractAgentNameFromKey(sessionKey);
    db.prepare(
      `INSERT INTO session_labels (sessionUuid, label, displayName, currentAgentId, updatedAt)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(uuid, patch.label ?? null, patch.displayName ?? null, agentId, now);
    return;
  }

  // Merge: only overwrite fields that are explicitly provided.
  const nextLabel = patch.label !== undefined ? patch.label : existing.label;
  const nextDisplayName =
    patch.displayName !== undefined ? patch.displayName : existing.displayName;
  const nextAgentId =
    patch.currentAgentId !== undefined ? patch.currentAgentId : existing.currentAgentId;

  db.prepare(
    `UPDATE session_labels SET label = ?, displayName = ?, currentAgentId = ?, updatedAt = ? WHERE sessionUuid = ?`,
  ).run(nextLabel, nextDisplayName, nextAgentId, now, uuid);
}

/** Get the persisted label entry for a sessionUuid or sessionKey, or null if not found. */
export function getSessionLabel(db: DatabaseSync, identifier: string): SessionLabelEntry | null {
  const uuid = identifier.includes(":") ? extractUuidFromKey(identifier) : identifier;
  const row = db
    .prepare(
      `SELECT sessionUuid, label, displayName, currentAgentId, updatedAt FROM session_labels WHERE sessionUuid = ?`,
    )
    .get(uuid) as SessionLabelEntry | undefined;
  return row ?? null;
}

/** List all persisted label entries, ordered by most recently updated. */
export function listSessionLabels(db: DatabaseSync): SessionLabelEntry[] {
  return db
    .prepare(
      `SELECT sessionUuid, label, displayName, currentAgentId, updatedAt FROM session_labels ORDER BY updatedAt DESC`,
    )
    .all() as unknown as SessionLabelEntry[];
}

/** Delete the label entry for a session (accepts sessionUuid or sessionKey). */
export function deleteSessionLabel(db: DatabaseSync, identifier: string): void {
  const uuid = identifier.includes(":") ? extractUuidFromKey(identifier) : identifier;
  db.prepare(`DELETE FROM session_labels WHERE sessionUuid = ?`).run(uuid);
}
