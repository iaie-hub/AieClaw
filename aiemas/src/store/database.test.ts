import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDatabase, ensureMas4sSchema } from "./database.js";

function tmpDbPath(): string {
  return join(tmpdir(), `mas4s-test-${randomUUID()}`, "mas4s.db");
}

describe("initDatabase", () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = tmpDbPath();
  });

  afterEach(() => {
    // Clean up the temp directory
    try {
      rmSync(join(dbPath, ".."), { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it("creates the database file and directory structure", () => {
    const db = initDatabase(dbPath);
    db.close();
    // If we got here without error, the directory and file were created
    expect(true).toBe(true);
  });

  it("sets WAL journal mode", () => {
    const db = initDatabase(dbPath);
    const result = db.prepare("PRAGMA journal_mode").get() as { journal_mode: string };
    expect(result.journal_mode).toBe("wal");
    db.close();
  });

  it("enables foreign key constraints", () => {
    const db = initDatabase(dbPath);
    const result = db.prepare("PRAGMA foreign_keys").get() as { foreign_keys: number };
    expect(result.foreign_keys).toBe(1);
    db.close();
  });

  it("sets busy_timeout to 5000ms", () => {
    const db = initDatabase(dbPath);
    const result = db.prepare("PRAGMA busy_timeout").get() as { timeout: number };
    expect(result.timeout).toBe(5000);
    db.close();
  });
});

describe("ensureMas4sSchema", () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = tmpDbPath();
  });

  afterEach(() => {
    try {
      rmSync(join(dbPath, ".."), { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("creates all four tables", () => {
    const db = initDatabase(dbPath);
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[];
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain("tenants");
    expect(tableNames).toContain("users");
    expect(tableNames).toContain("session_ownership");
    expect(tableNames).toContain("session_memberships");
    db.close();
  });

  it("creates unique index on users(tenantId, username)", () => {
    const db = initDatabase(dbPath);
    const indexes = db
      .prepare("SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='users'")
      .all() as { name: string }[];
    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain("idx_users_tenant_username");
    db.close();
  });

  it("creates index on session_memberships(userId)", () => {
    const db = initDatabase(dbPath);
    const indexes = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='session_memberships'",
      )
      .all() as { name: string }[];
    const indexNames = indexes.map((i) => i.name);
    expect(indexNames).toContain("idx_memberships_user");
    db.close();
  });

  it("enforces UNIQUE constraint on tenantId+username", () => {
    const db = initDatabase(dbPath);
    const now = Date.now();

    // Insert a tenant
    db.prepare("INSERT INTO tenants (tenantId, name, createdAt) VALUES (?, ?, ?)").run(
      "t1",
      "Test Tenant",
      now,
    );

    // Insert a user
    db.prepare(
      "INSERT INTO users (userId, username, displayName, passwordHash, role, tenantId, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("u1", "alice", "Alice", "hash1", "member", "t1", "approved", now);

    // Inserting a duplicate username under the same tenant should fail
    expect(() => {
      db.prepare(
        "INSERT INTO users (userId, username, displayName, passwordHash, role, tenantId, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run("u2", "alice", "Alice2", "hash2", "member", "t1", "approved", now);
    }).toThrow();

    db.close();
  });

  it("enforces CHECK constraint on users.role", () => {
    const db = initDatabase(dbPath);
    const now = Date.now();

    db.prepare("INSERT INTO tenants (tenantId, name, createdAt) VALUES (?, ?, ?)").run(
      "t1",
      "Test",
      now,
    );

    expect(() => {
      db.prepare(
        "INSERT INTO users (userId, username, displayName, passwordHash, role, tenantId, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      ).run("u1", "bob", "Bob", "hash", "superadmin", "t1", "approved", now);
    }).toThrow();

    db.close();
  });

  it("enforces CHECK constraint on session_memberships.role", () => {
    const db = initDatabase(dbPath);
    const now = Date.now();

    db.prepare("INSERT INTO tenants (tenantId, name, createdAt) VALUES (?, ?, ?)").run(
      "t1",
      "Test",
      now,
    );
    db.prepare(
      "INSERT INTO users (userId, username, displayName, passwordHash, role, tenantId, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run("u1", "alice", "Alice", "hash", "member", "t1", "approved", now);

    expect(() => {
      db.prepare(
        "INSERT INTO session_memberships (sessionKey, userId, role, joinedAt) VALUES (?, ?, ?, ?)",
      ).run("s1", "u1", "moderator", now);
    }).toThrow();

    db.close();
  });

  it("is idempotent — calling ensureMas4sSchema twice does not error", () => {
    const db = initDatabase(dbPath);
    // Call again — should be a no-op
    ensureMas4sSchema(db);
    db.close();
  });
});
