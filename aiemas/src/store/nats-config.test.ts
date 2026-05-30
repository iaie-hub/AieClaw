import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDatabase } from "./database.js";
import { getNatsConfig, saveNatsConfig, migrateNatsFromEnvIfEmpty } from "./nats-config.js";

function tmpDbPath(): string {
  return join(tmpdir(), `mas4s-test-${randomUUID()}`, "mas4s.db");
}

describe("getNatsConfig", () => {
  let dbPath: string;
  let db: DatabaseSync;

  beforeEach(() => {
    dbPath = tmpDbPath();
    db = initDatabase(dbPath);
  });

  afterEach(() => {
    db.close();
    try {
      rmSync(join(dbPath, ".."), { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("returns env var fallbacks when no DB record exists", () => {
    const originalEnv = { ...process.env };
    process.env.AGENT_REGISTRY_NATS_URL = "nats://test:4222";
    process.env.AGENT_REGISTRY_AGENT_ID = "test-agent";
    delete process.env.AGENT_REGISTRY_NATS_TOKEN;
    delete process.env.AGENT_REGISTRY_AGENT_NAME;
    delete process.env.AGENT_REGISTRY_BOUND_AGENT_ID;

    try {
      const config = getNatsConfig(db);
      expect(config.id).toBe("default");
      expect(config.natsUrl).toBe("nats://test:4222");
      expect(config.agentId).toBe("test-agent");
      expect(config.natsToken).toBeNull();
    } finally {
      process.env = originalEnv;
    }
  });

  it("returns DB values when record exists", () => {
    const now = Date.now();
    db.prepare(
      `INSERT INTO nats_config (id, nats_url, nats_token, agent_id, agent_name, bound_agent_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("default", "nats://db:4222", "db-token", "db-agent", "DB Agent", "bound-1", now, now);

    const config = getNatsConfig(db);
    expect(config.natsUrl).toBe("nats://db:4222");
    expect(config.natsToken).toBe("db-token");
    expect(config.agentId).toBe("db-agent");
    expect(config.agentName).toBe("DB Agent");
    expect(config.boundAgentId).toBe("bound-1");
  });
});

describe("saveNatsConfig", () => {
  let dbPath: string;
  let db: DatabaseSync;

  beforeEach(() => {
    dbPath = tmpDbPath();
    db = initDatabase(dbPath);
  });

  afterEach(() => {
    db.close();
    try {
      rmSync(join(dbPath, ".."), { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("inserts a new record when none exists", () => {
    saveNatsConfig(db, {
      natsUrl: "nats://localhost:4222",
      natsToken: "test-token",
    });

    const row = db.prepare("SELECT * FROM nats_config WHERE id = 'default'").get() as Record<
      string,
      unknown
    >;
    expect(row).toBeDefined();
    expect(row.nats_url).toBe("nats://localhost:4222");
    expect(row.nats_token).toBe("test-token");
  });

  it("preserves existing fields when updating partial config", () => {
    const now = Date.now();
    db.prepare(
      `INSERT INTO nats_config (id, nats_url, nats_token, agent_id, agent_name, bound_agent_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("default", "nats://old:4222", "old-token", "old-id", "Old Name", "old-bound", now, now);

    saveNatsConfig(db, { natsUrl: "nats://new:4222" });

    const row = db.prepare("SELECT * FROM nats_config WHERE id = 'default'").get() as Record<
      string,
      unknown
    >;
    expect(row.nats_url).toBe("nats://new:4222");
    expect(row.nats_token).toBe("old-token");
    expect(row.created_at).toBe(now);
  });
});

describe("migrateNatsFromEnvIfEmpty", () => {
  let dbPath: string;
  let db: DatabaseSync;
  let tmpHome: string;

  beforeEach(() => {
    dbPath = tmpDbPath();
    db = initDatabase(dbPath);
    tmpHome = join(tmpdir(), `home-test-${randomUUID()}`);
    mkdirSync(join(tmpHome, ".openclaw"), { recursive: true });
  });

  afterEach(() => {
    db.close();
    try {
      rmSync(join(dbPath, ".."), { recursive: true, force: true });
    } catch {
      // ignore
    }
    try {
      rmSync(tmpHome, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("migrates env vars from .env file when table is empty", () => {
    const envContent = [
      "AGENT_REGISTRY_NATS_URL=nats://migrated:4222",
      "AGENT_REGISTRY_NATS_TOKEN=migrated-token",
      "AGENT_REGISTRY_AGENT_ID=migrated-agent",
      "AGENT_REGISTRY_AGENT_NAME=Migrated Agent",
      "AGENT_REGISTRY_BOUND_AGENT_ID=bound-migrated",
    ].join("\n");

    writeFileSync(join(tmpHome, ".openclaw", ".env"), envContent);

    const originalHome = process.env.HOME;
    process.env.HOME = tmpHome;
    try {
      migrateNatsFromEnvIfEmpty(db);

      const row = db.prepare("SELECT * FROM nats_config WHERE id = 'default'").get() as Record<
        string,
        unknown
      >;
      expect(row).toBeDefined();
      expect(row.nats_url).toBe("nats://migrated:4222");
      expect(row.nats_token).toBe("migrated-token");
      expect(row.agent_id).toBe("migrated-agent");
      expect(row.agent_name).toBe("Migrated Agent");
      expect(row.bound_agent_id).toBe("bound-migrated");
    } finally {
      process.env.HOME = originalHome;
    }
  });
});
