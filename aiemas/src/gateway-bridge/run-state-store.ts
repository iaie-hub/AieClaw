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

/**
 * Reset all active SOP run states on gateway startup.
 *
 * When the gateway stops, all running SOP processes are interrupted but the DB
 * still has stale `isChatting=true` rows and SOP snapshots with "running" steps.
 * This function marks all sessions as not chatting and finalizes any in-progress
 * SOP steps so the frontend shows them as completed (not stuck in "running").
 */
export function resetAllRunStatesOnStartup(db: DatabaseSync): number {
  const now = Date.now();

  // Find all rows that are still marked as chatting
  const rows = db
    .prepare(`SELECT sessionUuid, sopState FROM session_run_state WHERE isChatting = 1`)
    .all() as { sessionUuid: string; sopState: string | null }[];

  if (rows.length === 0) {
    return 0;
  }

  const update = db.prepare(
    `UPDATE session_run_state SET isChatting = 0, sopState = ?, updatedAt = ? WHERE sessionUuid = ?`,
  );

  for (const row of rows) {
    let snapshotJson = row.sopState;

    // Finalize any "running" steps in the SOP snapshot
    if (snapshotJson) {
      try {
        const snapshot = JSON.parse(snapshotJson) as SOPSnapshot;
        let changed = false;
        for (let i = 0; i < snapshot.stepStatuses.length; i++) {
          if (snapshot.stepStatuses[i] === "running") {
            snapshot.stepStatuses[i] = "completed";
            changed = true;
          }
        }
        if (changed) {
          snapshot.completedAt = now;
          snapshotJson = JSON.stringify(snapshot);
        }
      } catch {
        // Malformed JSON — clear it
        snapshotJson = null;
      }
    }

    update.run(snapshotJson, now, row.sessionUuid);
  }

  return rows.length;
}
