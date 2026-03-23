import type { DatabaseSync } from "node:sqlite";

/** Timeout threshold in milliseconds (15 minutes). */
const OFFLINE_THRESHOLD_MS = 15 * 60 * 1000;

/**
 * Update a user's presence: set isOnline=1 and lastSeenAt=now.
 * Creates the record if it doesn't exist (UPSERT).
 */
export function updatePresence(db: DatabaseSync, userId: string): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO user_presence (userId, lastSeenAt, isOnline)
     VALUES (?, ?, 1)
     ON CONFLICT(userId) DO UPDATE SET lastSeenAt = excluded.lastSeenAt, isOnline = 1`,
  ).run(userId, now);
  console.log(`[mas4s:presence] updatePresence userId=${userId} lastSeenAt=${now}`);
}

/**
 * Mark a user as offline immediately.
 */
export function markOffline(db: DatabaseSync, userId: string): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO user_presence (userId, lastSeenAt, isOnline)
     VALUES (?, ?, 0)
     ON CONFLICT(userId) DO UPDATE SET lastSeenAt = excluded.lastSeenAt, isOnline = 0`,
  ).run(userId, now);
  console.log(`[mas4s:presence] markOffline userId=${userId} lastSeenAt=${now}`);
}

/**
 * Get a user's presence status.
 */
export function getPresence(
  db: DatabaseSync,
  userId: string,
): { isOnline: boolean; lastSeenAt: number | null } {
  const row = db
    .prepare("SELECT isOnline, lastSeenAt FROM user_presence WHERE userId = ?")
    .get(userId) as { isOnline: number; lastSeenAt: number } | undefined;
  if (!row) {
    return { isOnline: false, lastSeenAt: null };
  }
  return { isOnline: row.isOnline === 1, lastSeenAt: row.lastSeenAt };
}

/**
 * Start a background scanner that marks users offline when their
 * lastSeenAt exceeds the 15-minute threshold.
 * Returns a cleanup function to stop the scanner.
 */
export function startOfflineScanner(db: DatabaseSync, intervalMs: number = 60_000): () => void {
  const timer = setInterval(() => {
    const cutoff = Date.now() - OFFLINE_THRESHOLD_MS;
    db.prepare("UPDATE user_presence SET isOnline = 0 WHERE isOnline = 1 AND lastSeenAt < ?").run(
      cutoff,
    );
  }, intervalMs);

  return () => clearInterval(timer);
}
