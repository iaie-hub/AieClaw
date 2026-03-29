import type { DatabaseSync } from "node:sqlite";

/** Timeout threshold in milliseconds (15 minutes). */
const OFFLINE_THRESHOLD_MS = 15 * 60 * 1000;

/** Database update interval for heartbeats (10 minutes). */
const DB_UPDATE_INTERVAL_MS = 10 * 60 * 1000;

interface PresenceStatus {
  isOnline: boolean;
  lastSeenAt: number;
  lastDbUpdateAt: number;
}

/** In-memory cache for user presence. */
const presenceCache = new Map<string, PresenceStatus>();

/**
 * Update a user's presence: set isOnline=1 and lastSeenAt=now.
 * Creates the record if it doesn't exist (UPSERT).
 * If isActualLogin is true, also updates lastLoginAt.
 */
export function updatePresence(db: DatabaseSync, userId: string, isActualLogin = false): void {
  const now = Date.now();
  const cached = presenceCache.get(userId);

  // Determine if we need to write to the database:
  // 1. Is it a fresh login?
  // 2. Is the user currently offline in our cache?
  // 3. Has it been longer than DB_UPDATE_INTERVAL_MS since the last DB write?
  const shouldUpdateDb =
    isActualLogin ||
    !cached ||
    !cached.isOnline ||
    now - cached.lastDbUpdateAt > DB_UPDATE_INTERVAL_MS;

  if (shouldUpdateDb) {
    if (isActualLogin) {
      db.prepare(
        `INSERT INTO user_presence (userId, lastSeenAt, isOnline, lastLoginAt)
         VALUES (?, ?, 1, ?)
         ON CONFLICT(userId) DO UPDATE SET lastSeenAt = excluded.lastSeenAt, isOnline = 1, lastLoginAt = excluded.lastLoginAt`,
      ).run(userId, now, now);
    } else {
      db.prepare(
        `INSERT INTO user_presence (userId, lastSeenAt, isOnline)
         VALUES (?, ?, 1)
         ON CONFLICT(userId) DO UPDATE SET lastSeenAt = excluded.lastSeenAt, isOnline = 1`,
      ).run(userId, now);
    }
    console.log(
      `[mas4s:presence] updatePresence(DB) userId=${userId} lastSeenAt=${now} isActualLogin=${isActualLogin}`,
    );
  }

  // Always update the memory cache
  presenceCache.set(userId, {
    isOnline: true,
    lastSeenAt: now,
    lastDbUpdateAt: shouldUpdateDb ? now : (cached?.lastDbUpdateAt ?? now),
  });

  if (!shouldUpdateDb) {
    // console.log(`[mas4s:presence] updatePresence(CacheOnly) userId=${userId} lastSeenAt=${now}`);
  }
}

/**
 * Mark a user as offline immediately.
 */
export function markOffline(db: DatabaseSync, userId: string): void {
  const now = Date.now();
  db.prepare(
    `INSERT INTO user_presence (userId, lastSeenAt, isOnline, lastOfflineAt)
     VALUES (?, ?, 0, ?)
     ON CONFLICT(userId) DO UPDATE SET lastSeenAt = excluded.lastSeenAt, isOnline = 0, lastOfflineAt = excluded.lastOfflineAt`,
  ).run(userId, now, now);

  // Sync cache
  presenceCache.set(userId, {
    isOnline: false,
    lastSeenAt: now,
    lastDbUpdateAt: now,
  });
  // console.log(`[mas4s:presence] markOffline userId=${userId} lastSeenAt=${now}`);
}

/**
 * Get a user's presence status.
 */
export function getPresence(
  db: DatabaseSync,
  userId: string,
): { isOnline: boolean; lastSeenAt: number | null } {
  // Try memory cache first
  const cached = presenceCache.get(userId);
  if (cached) {
    return { isOnline: cached.isOnline, lastSeenAt: cached.lastSeenAt };
  }

  const row = db
    .prepare("SELECT isOnline, lastSeenAt FROM user_presence WHERE userId = ?")
    .get(userId) as { isOnline: number; lastSeenAt: number } | undefined;
  if (!row) {
    return { isOnline: false, lastSeenAt: null };
  }

  const status = { isOnline: row.isOnline === 1, lastSeenAt: row.lastSeenAt };

  // Populate cache for subsequent reads
  presenceCache.set(userId, {
    isOnline: status.isOnline,
    lastSeenAt: status.lastSeenAt ?? 0,
    lastDbUpdateAt: status.lastSeenAt ?? 0,
  });

  return status;
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
