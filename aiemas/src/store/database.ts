import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { requireNodeSqlite } from "../../../packages/memory-host-sdk/src/host/sqlite.js";

/**
 * Default database path: ~/.openclaw/aiemas/db/mas4s.db
 */
export const DEFAULT_DB_PATH = `${process.env.HOME ?? "~"}/.openclaw/aiemas/db/mas4s.db`;

/**
 * Default message database path: ~/.openclaw/aiemas/db/mas4s.message.db
 * Separated from the main DB for performance isolation.
 */
export const DEFAULT_MESSAGE_DB_PATH = `${process.env.HOME ?? "~"}/.openclaw/aiemas/db/mas4s.message.db`;

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
      sessionUuid TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(userId),
      tenantId TEXT NOT NULL REFERENCES tenants(tenantId),
      createdAt INTEGER NOT NULL,
      archivedAt INTEGER
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_memberships (
      sessionUuid TEXT NOT NULL,
      userId TEXT NOT NULL REFERENCES users(userId),
      role TEXT NOT NULL CHECK(role IN ('owner', 'participant')),
      joinedAt INTEGER NOT NULL,
      PRIMARY KEY (sessionUuid, userId)
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

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_run_state (
      sessionUuid TEXT PRIMARY KEY,
      runId       TEXT,
      sopState    TEXT,
      isChatting  INTEGER NOT NULL DEFAULT 0,
      updatedAt   INTEGER NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_topologies (
      rootAgentId TEXT PRIMARY KEY,
      topology    TEXT NOT NULL,
      updatedAt   INTEGER NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS aiemas_sessions (
      sessionUuid       TEXT PRIMARY KEY,
      sessionKey        TEXT NOT NULL UNIQUE,
      sessionId         TEXT NOT NULL,
      agentId           TEXT NOT NULL,
      label             TEXT,
      currentAgentId    TEXT,
      userId            TEXT NOT NULL,
      tenantId          TEXT NOT NULL,
      descendantSessions TEXT NOT NULL,
      createdAt         INTEGER NOT NULL,
      updatedAt         INTEGER NOT NULL
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_aiemas_sessions_agentId
    ON aiemas_sessions(agentId);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_aiemas_sessions_userId
    ON aiemas_sessions(userId);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_aiemas_sessions_tenantId
    ON aiemas_sessions(tenantId);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_registry (
      id             TEXT PRIMARY KEY DEFAULT 'default',
      api_key        TEXT,
      nats_url       TEXT,
      nats_token     TEXT,
      agent_id       TEXT,
      agent_name     TEXT,
      bound_agent_id TEXT,
      created_at     INTEGER NOT NULL,
      updated_at     INTEGER NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS nats_config (
      id             TEXT PRIMARY KEY DEFAULT 'default',
      nats_url       TEXT,
      nats_token     TEXT,
      agent_id       TEXT,
      agent_name     TEXT,
      bound_agent_id TEXT,
      created_at     INTEGER NOT NULL,
      updated_at     INTEGER NOT NULL
    );
  `);

  // ── Migration: add new columns if upgrading from old schema ──
  try {
    db.exec("ALTER TABLE agent_registry ADD COLUMN registry_url TEXT;");
  } catch {
    // Already exists
  }
  try {
    db.exec("ALTER TABLE aiemas_sessions ADD COLUMN currentAgentId TEXT;");
  } catch {
    // Already exists
  }
  try {
    db.exec("ALTER TABLE aiemas_sessions ADD COLUMN updatedAt INTEGER NOT NULL DEFAULT 0;");
  } catch {
    // Already exists
  }

  // ── Migration: copy existing NATS settings from agent_registry to nats_config if empty ──
  try {
    const hasNatsRecord = db.prepare("SELECT id FROM nats_config WHERE id = 'default'").get();
    if (!hasNatsRecord) {
      const oldRegistry = db
        .prepare("SELECT * FROM agent_registry WHERE id = 'default'")
        .get() as any;
      if (
        oldRegistry &&
        (oldRegistry.nats_url ||
          oldRegistry.nats_token ||
          oldRegistry.agent_id ||
          oldRegistry.agent_name ||
          oldRegistry.bound_agent_id)
      ) {
        const now = Date.now();
        db.prepare(`
          INSERT INTO nats_config (id, nats_url, nats_token, agent_id, agent_name, bound_agent_id, created_at, updated_at)
          VALUES ('default', ?, ?, ?, ?, ?, ?, ?)
        `).run(
          oldRegistry.nats_url ?? null,
          oldRegistry.nats_token ?? null,
          oldRegistry.agent_id ?? null,
          oldRegistry.agent_name ?? null,
          oldRegistry.bound_agent_id ?? null,
          oldRegistry.created_at ?? now,
          now,
        );
      }
    }
  } catch (err) {
    // Ignore migration failures
  }

  // Drop legacy session_labels table if it still exists
  db.exec("DROP TABLE IF EXISTS session_labels;");

  // Migration: if old schema had sessionKey as PK,
  // recreate the table with sessionUuid as PK.
  const pkCol = (
    db.prepare("PRAGMA table_info(aiemas_sessions)").all() as Array<{
      name: string;
      pk: number;
    }>
  ).find((c) => c.pk === 1);
  if (pkCol && pkCol.name === "sessionKey") {
    db.exec(`
      CREATE TABLE aiemas_sessions_new (
        sessionUuid       TEXT PRIMARY KEY,
        sessionKey        TEXT NOT NULL UNIQUE,
        sessionId         TEXT NOT NULL,
        agentId           TEXT NOT NULL,
        label             TEXT,
        currentAgentId    TEXT,
        userId            TEXT NOT NULL,
        tenantId          TEXT NOT NULL,
        descendantSessions TEXT NOT NULL,
        createdAt         INTEGER NOT NULL,
        updatedAt         INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO aiemas_sessions_new
        (sessionUuid, sessionKey, sessionId, agentId, label, currentAgentId, userId, tenantId, descendantSessions, createdAt, updatedAt)
      SELECT sessionUuid, sessionKey, sessionId, agentId, label, currentAgentId, userId, tenantId, descendantSessions, createdAt, updatedAt
      FROM aiemas_sessions;
      DROP TABLE aiemas_sessions;
      ALTER TABLE aiemas_sessions_new RENAME TO aiemas_sessions;
      CREATE INDEX IF NOT EXISTS idx_aiemas_sessions_agentId ON aiemas_sessions(agentId);
      CREATE INDEX IF NOT EXISTS idx_aiemas_sessions_userId ON aiemas_sessions(userId);
      CREATE INDEX IF NOT EXISTS idx_aiemas_sessions_tenantId ON aiemas_sessions(tenantId);
    `);
  }
}

/**
 * Initialize the message SQLite database at the given path.
 * Separate from the main mas4s.db for performance isolation.
 */
export function initMessageDatabase(dbPath: string = DEFAULT_MESSAGE_DB_PATH): DatabaseSync {
  mkdirSync(dirname(dbPath), { recursive: true });

  const { DatabaseSync } = requireNodeSqlite();
  const db = new DatabaseSync(dbPath);

  db.exec("PRAGMA journal_mode=WAL");
  db.exec("PRAGMA busy_timeout=5000");

  ensureMessageSchema(db);
  return db;
}

/**
 * Create the session_messages table and indexes if they don't exist.
 * Also creates session_msg_statistic which maintains per-session aggregate
 * counters (earliest/latest timestamp, total message count, latest seq).
 */
export function ensureMessageSchema(db: DatabaseSync): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_messages (
      id          TEXT    PRIMARY KEY,
      sessionUuid TEXT    NOT NULL,
      sessionKey  TEXT    NOT NULL,
      sessionId   TEXT    NOT NULL,
      userId      TEXT    NULL,
      tenantId    TEXT    NULL,
      role        TEXT    NOT NULL
                  CHECK(role IN ('user','assistant','tool','approval','system','progress','summary','agent')),
      content     TEXT    NOT NULL,
      timestamp   INTEGER NOT NULL,
      seq         INTEGER NOT NULL DEFAULT 0,
      archivedDate TEXT   NULL,
      toolCallId  TEXT    NULL,
      toolName    TEXT    NULL,
      parentSessionUuid TEXT NULL,
      sourceAgentId TEXT  NULL
    );
  `);

  // Migration: add parentSessionUuid if it doesn't exist (node:sqlite best-effort)
  try {
    db.exec("ALTER TABLE session_messages ADD COLUMN parentSessionUuid TEXT NULL;");
  } catch {
    // Already exists
  }

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_session_messages_uuid_ts
    ON session_messages(sessionUuid, timestamp);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_session_messages_parent_uuid
    ON session_messages(parentSessionUuid);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_session_messages_session_id
    ON session_messages(sessionId);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_session_messages_sid_seq
    ON session_messages(sessionId, seq);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_msg_statistic (
      sessionUuid   TEXT    PRIMARY KEY,
      sessionKey    TEXT    NOT NULL,
      sessionId     TEXT    NOT NULL,
      firstMsgAt    INTEGER NOT NULL,
      lastMsgAt     INTEGER NOT NULL,
      msgCount      INTEGER NOT NULL DEFAULT 0,
      lastSeq       INTEGER NOT NULL DEFAULT 0,
      parentSessionUuid TEXT NULL
    );
  `);

  try {
    db.exec("ALTER TABLE session_msg_statistic ADD COLUMN parentSessionUuid TEXT NULL;");
  } catch {
    // Already exists
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_summaries (
      sessionUuid  TEXT    PRIMARY KEY,
      sessionKey   TEXT    NOT NULL,
      sessionId    TEXT    NOT NULL,
      textSummary  TEXT    NULL,
      toolSummary  TEXT    NULL,
      generatedAt  INTEGER NOT NULL,
      generatedBy  TEXT    NOT NULL,
      parentSessionUuid TEXT NULL
    );
  `);

  try {
    db.exec("ALTER TABLE session_summaries ADD COLUMN parentSessionUuid TEXT NULL;");
  } catch {
    // Already exists
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS session_media (
      id          TEXT    PRIMARY KEY,
      sessionUuid TEXT    NOT NULL,
      sessionKey  TEXT    NOT NULL,
      mediaPath   TEXT    NOT NULL,
      mimeType    TEXT    NULL,
      createdAt   INTEGER NOT NULL,
      parentSessionUuid TEXT NULL
    );
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_session_media_uuid
    ON session_media(sessionUuid);
  `);

  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_session_media_parent_uuid
    ON session_media(parentSessionUuid);
  `);
}
