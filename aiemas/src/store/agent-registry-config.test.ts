import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { initDatabase } from "./database.js";
import {
  getAgentRegistryConfig,
  saveAgentRegistryConfig,
  migrateFromEnvIfEmpty,
} from "./agent-registry-config.js";
import type { DatabaseSync } from "node:sqlite";

function tmpDbPath(): string {
  return join(tmpdir(), `mas4s-test-${randomUUID()}`, "mas4s.db");
}

describe("getAgentRegistryConfig", () => {
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
    process.env.AGENT_REGISTRY_URL = "http://localhost:9000";

    try {
      const config = getAgentRegistryConfig(db);
      expect(config.id).toBe("default");
      expect(config.registryUrl).toBe("http://localhost:9000");
      expect(config.apiKey).toBeNull();
    } finally {
      process.env = originalEnv;
    }
  });

  it("returns DB values when record exists", () => {
    const now = Date.now();
    db.prepare(
      `INSERT INTO agent_registry (id, api_key, registry_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run("default", "api-ar-key123", "http://localhost:8000", now, now);

    const config = getAgentRegistryConfig(db);
    expect(config.apiKey).toBe("api-ar-key123");
    expect(config.registryUrl).toBe("http://localhost:8000");
  });
});

describe("saveAgentRegistryConfig", () => {
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
    saveAgentRegistryConfig(db, {
      apiKey: "api-ar-test",
      registryUrl: "http://localhost:8000",
    });

    const row = db.prepare("SELECT * FROM agent_registry WHERE id = 'default'").get() as Record<string, unknown>;
    expect(row).toBeDefined();
    expect(row.api_key).toBe("api-ar-test");
    expect(row.registry_url).toBe("http://localhost:8000");
  });

  it("preserves existing fields when updating partial config", () => {
    const now = Date.now();
    db.prepare(
      `INSERT INTO agent_registry (id, api_key, registry_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run("default", "old-key", "http://old:8000", now, now);

    saveAgentRegistryConfig(db, { apiKey: "new-key" });

    const row = db.prepare("SELECT * FROM agent_registry WHERE id = 'default'").get() as Record<string, unknown>;
    expect(row.api_key).toBe("new-key");
    expect(row.registry_url).toBe("http://old:8000");
    expect(row.created_at).toBe(now);
  });
});

describe("migrateFromEnvIfEmpty", () => {
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
      "AGENT_REGISTRY_URL=http://migrated:8000",
    ].join("\n");

    writeFileSync(join(tmpHome, ".openclaw", ".env"), envContent);

    const originalHome = process.env.HOME;
    process.env.HOME = tmpHome;
    try {
      migrateFromEnvIfEmpty(db);

      const row = db.prepare("SELECT * FROM agent_registry WHERE id = 'default'").get() as Record<string, unknown>;
      expect(row).toBeDefined();
      expect(row.registry_url).toBe("http://migrated:8000");
      expect(row.api_key).toBeNull();
    } finally {
      process.env.HOME = originalHome;
    }
  });
});
