import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { requireNodeSqlite } from "../../../src/memory/sqlite.js";

/**
 * Default database path: ~/.openclaw/aiemas/mas4s.db
 */
export const DEFAULT_DB_PATH = `${process.env.HOME ?? "~"}/.openclaw/aiemas/mas4s.db`;

/**
 * Initialize the SQLite database at the given path.
 * Creates the directory structure if it doesn't exist,
 * configures WAL mode, busy_timeout, and foreign keys,
 * then ensures the mas4s schema is in place.
 */
export function initDatabase(dbPath: string = DEFAULT_DB_PATH): DatabaseSync {
  // Ensure the directory exists
  mkdirSync(dirname(dbPath), { recursive: true });

  const { DatabaseSync } = requireNodeSqlite();
  const db = new DatabaseSync(dbPath);

  // WAL mode: improves concurrent read/write performance
  db.exec("PRAGMA journal_mode=WAL");
  // busy_timeout: auto-retry on concurrent writes instead of failing immediately
  db.exec("PRAGMA busy_timeout=5000");
  // Enable foreign key constraints
  db.exec("PRAGMA foreign_keys=ON");

  ensureMas4sSchema(db);
  return db;
}

/**
 * Create all mas4s tables and indexes if they don't already exist.
 */
export function ensureMas4sSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tenants (
      tenantId TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      createdAt INTEGER NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      userId TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      displayName TEXT NOT NULL,
      passwordHash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'member', 'viewer')),
      tenantId TEXT NOT NULL REFERENCES tenants(tenantId),
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'approved', 'rejected')),
      createdAt INTEGER NOT NULL
    );
  `);

  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_users_tenant_username
    ON users(tenantId, username);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_ownership (
      sessionKey TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(userId),
      tenantId TEXT NOT NULL REFERENCES tenants(tenantId),
      createdAt INTEGER NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_memberships (
      sessionKey TEXT NOT NULL,
      userId TEXT NOT NULL REFERENCES users(userId),
      role TEXT NOT NULL CHECK(role IN ('owner', 'participant')),
      joinedAt INTEGER NOT NULL,
      PRIMARY KEY (sessionKey, userId)
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_memberships_user
    ON session_memberships(userId);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_presence (
      userId TEXT PRIMARY KEY REFERENCES users(userId),
      lastSeenAt INTEGER NOT NULL,
      isOnline INTEGER NOT NULL DEFAULT 0,
      lastLoginAt INTEGER,
      lastOfflineAt INTEGER
    );
  `);

  // Idempotent migration: add lastLoginAt/lastOfflineAt columns to user_presence if they don't exist
  const presenceCols = db.prepare("PRAGMA table_info(user_presence)").all() as Array<{
    name: string;
  }>;
  if (!presenceCols.some((c) => c.name === "lastLoginAt")) {
    db.exec("ALTER TABLE user_presence ADD COLUMN lastLoginAt INTEGER");
  }
  if (!presenceCols.some((c) => c.name === "lastOfflineAt")) {
    db.exec("ALTER TABLE user_presence ADD COLUMN lastOfflineAt INTEGER");
  }

  // Idempotent migration: add archivedAt column to session_ownership if it doesn't exist
  const cols = db.prepare("PRAGMA table_info(session_ownership)").all() as Array<{ name: string }>;
  if (!cols.some((c) => c.name === "archivedAt")) {
    db.exec("ALTER TABLE session_ownership ADD COLUMN archivedAt INTEGER");
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_summaries (
      sessionKey TEXT PRIMARY KEY,
      textSummary TEXT,
      toolSummary TEXT,
      generatedAt INTEGER NOT NULL,
      generatedBy TEXT NOT NULL
    );
  `);
}
