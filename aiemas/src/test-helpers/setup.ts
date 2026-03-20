/**
 * Test database setup helpers.
 * Feature: mas4s-multi-tenant-rbac
 */

import { randomUUID } from "node:crypto";
import { rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { initDatabase } from "../store/database.js";

/**
 * Create a temporary SQLite database for testing.
 * Returns the db instance and a cleanup function.
 */
export function createTestDatabase(): { db: DatabaseSync; cleanup: () => void } {
  const dbPath = join(tmpdir(), `mas4s-test-${randomUUID()}.db`);
  const db = initDatabase(dbPath);

  return {
    db,
    cleanup: () => {
      try {
        db.close();
      } catch {
        // ignore
      }
      for (const suffix of ["", "-wal", "-shm"]) {
        const p = dbPath + suffix;
        if (existsSync(p)) {
          try {
            rmSync(p);
          } catch {
            /* ignore */
          }
        }
      }
    },
  };
}

/**
 * Create an in-memory SQLite database for testing.
 * Note: uses a temp file instead of :memory: to support WAL mode.
 */
export function createInMemoryDatabase(): { db: DatabaseSync; cleanup: () => void } {
  return createTestDatabase();
}
