import crypto from "node:crypto";
import { unlinkSync, statSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";

export interface StoredMedia {
  id: string;
  sessionUuid: string;
  sessionKey: string;
  mediaPath: string;
  mimeType: string | null;
  createdAt: number;
  parentSessionUuid: string | null;
}

/**
 * Record a media file associated with a session.
 * Uses INSERT OR REPLACE to avoid duplicate entries for the same path in the same session.
 */
export function upsertSessionMedia(
  db: DatabaseSync,
  params: {
    sessionUuid: string;
    sessionKey: string;
    mediaPath: string;
    mimeType?: string | null;
    createdAt?: number;
    parentSessionUuid?: string | null;
  },
): void {
  const {
    sessionUuid,
    sessionKey,
    mediaPath,
    mimeType = null,
    createdAt = Date.now(),
    parentSessionUuid = null,
  } = params;

  // We use a hash of (sessionUuid, mediaPath) as the ID to avoid duplicates
  const id = crypto.createHash("sha256").update(`${sessionUuid}:${mediaPath}`).digest("hex");

  db.prepare(
    `INSERT OR REPLACE INTO session_media
       (id, sessionUuid, sessionKey, mediaPath, mimeType, createdAt, parentSessionUuid)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, sessionUuid, sessionKey, mediaPath, mimeType, createdAt, parentSessionUuid);
}

/**
 * Delete all media records and physical files for a session and its descendants.
 * Synchronously deletes files from disk.
 */
export function deleteSessionMedia(db: DatabaseSync, sessionUuid: string): void {
  // 1. Fetch all media paths for this session and sub-sessions
  const rows = db
    .prepare("SELECT mediaPath FROM session_media WHERE sessionUuid = ? OR parentSessionUuid = ?")
    .all(sessionUuid, sessionUuid) as Array<{ mediaPath: string }>;

  // 2. Delete physical files
  for (const row of rows) {
    try {
      const path = row.mediaPath;
      if (path) {
        // Check if file exists before attempting to delete
        try {
          statSync(path);
          unlinkSync(path);
        } catch (err: unknown) {
          if ((err as { code?: string }).code !== "ENOENT") {
            console.warn(`[mas4s:media-store] Failed to delete file ${path}: ${String(err)}`);
          }
        }
      }
    } catch (err) {
      console.warn(`[mas4s:media-store] Unexpected error deleting file: ${String(err)}`);
    }
  }

  // 3. Delete DB rows
  db.prepare("DELETE FROM session_media WHERE sessionUuid = ? OR parentSessionUuid = ?").run(
    sessionUuid,
    sessionUuid,
  );
}
