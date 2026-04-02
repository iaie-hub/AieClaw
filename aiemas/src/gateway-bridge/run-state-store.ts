/**
 * Persistent run-state store for SOP recovery after WebSocket reconnect.
 *
 * Stores a minimal SOP snapshot (step statuses + currentStepIndex) so the
 * frontend can restore SOP progress after a page refresh or reconnect.
 * Time-series fields (startedAt, completedAt, elapsed, ts) are intentionally
 * omitted — they are ephemeral and not needed to reconstruct the visual state.
 */

import type { DatabaseSync } from "node:sqlite";
import type { SOPStepStatus } from "../sop-tracker/types.js";

/**
 * Minimal SOP snapshot stored in DB.
 * Only the fields required to reconstruct the sop-pipeline UI are persisted.
 */
export interface SOPSnapshot {
  sopName: string;
  sopLabel: string;
  /** Ordered list of step statuses, parallel to the SOP definition steps array. */
  stepStatuses: SOPStepStatus[];
  currentStepIndex: number;
  /** Set when all steps have reached a terminal status. */
  completedAt?: number;
}

export interface RunStateRow {
  sessionUuid: string;
  runId: string | null;
  sopSnapshot: SOPSnapshot | null;
  isChatting: boolean;
  updatedAt: number;
}

/**
 * Upsert run state for a session. Only the provided fields are updated;
 * omitted fields retain their current DB value.
 */
export function upsertRunState(
  db: DatabaseSync,
  sessionUuid: string,
  patch: {
    runId?: string;
    sopSnapshot?: SOPSnapshot;
    isChatting?: boolean;
  },
): void {
  const now = Date.now();
  const existing = getRunState(db, sessionUuid);

  if (!existing) {
    const snapshotJson = patch.sopSnapshot != null ? JSON.stringify(patch.sopSnapshot) : null;
    db.prepare(
      `INSERT INTO session_run_state (sessionUuid, runId, sopState, isChatting, updatedAt)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      sessionUuid,
      patch.runId ?? null,
      snapshotJson,
      patch.isChatting != null ? (patch.isChatting ? 1 : 0) : 0,
      now,
    );
  } else {
    const newRunId = patch.runId !== undefined ? patch.runId : existing.runId;
    const newSnapshot = patch.sopSnapshot !== undefined ? patch.sopSnapshot : existing.sopSnapshot;
    const newIsChatting = patch.isChatting !== undefined ? patch.isChatting : existing.isChatting;
    const snapshotJson = newSnapshot != null ? JSON.stringify(newSnapshot) : null;
    db.prepare(
      `UPDATE session_run_state
       SET runId=?, sopState=?, isChatting=?, updatedAt=?
       WHERE sessionUuid=?`,
    ).run(newRunId ?? null, snapshotJson, newIsChatting ? 1 : 0, now, sessionUuid);
  }
}

/** Retrieve the persisted run state for a session, or null if not found. */
export function getRunState(db: DatabaseSync, sessionUuid: string): RunStateRow | null {
  const row = db
    .prepare(
      `SELECT sessionUuid, runId, sopState, isChatting, updatedAt
       FROM session_run_state WHERE sessionUuid=?`,
    )
    .get(sessionUuid) as
    | {
        sessionUuid: string;
        runId: string | null;
        sopState: string | null;
        isChatting: number;
        updatedAt: number;
      }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    sessionUuid: row.sessionUuid,
    runId: row.runId,
    sopSnapshot: row.sopState ? (JSON.parse(row.sopState) as SOPSnapshot) : null,
    isChatting: row.isChatting === 1,
    updatedAt: row.updatedAt,
  };
}

/** Remove the run state for a session (on reset/delete/clear). */
export function clearRunState(db: DatabaseSync, sessionUuid: string): void {
  db.prepare(`DELETE FROM session_run_state WHERE sessionUuid=?`).run(sessionUuid);
}
