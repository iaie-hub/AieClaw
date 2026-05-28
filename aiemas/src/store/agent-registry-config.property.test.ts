/**
 * Property-based tests for AgentRegistry config persistence layer.
 */

import { randomUUID } from "node:crypto";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as fc from "fast-check";
import { describe, it, expect, afterEach } from "vitest";
import { initDatabase } from "./database.js";
import {
  getAgentRegistryConfig,
  migrateFromEnvIfEmpty,
} from "./agent-registry-config.js";

// Track temp paths for cleanup
const tempPaths: string[] = [];

function tmpDbPath(): string {
  const p = join(tmpdir(), `mas4s-prop-arcfg-${randomUUID()}`, "mas4s.db");
  tempPaths.push(p);
  return p;
}

afterEach(() => {
  for (const p of tempPaths.splice(0)) {
    try {
      rmSync(join(p, ".."), { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
});

const configValueArb = fc.string({ minLength: 1, maxLength: 128 }).filter((s) => {
  return !s.includes("\n") && !s.includes("\r") && !s.startsWith("#");
});

const nullableConfigValueArb = fc.oneof(fc.constant(null), configValueArb);

// ---------------------------------------------------------------------------
// Property 1: Config resolution priority
// ---------------------------------------------------------------------------

describe("Property 1: Config resolution priority", () => {
  it("DB non-null value takes priority over env var; DB null falls back to env var", () => {
    fc.assert(
      fc.property(nullableConfigValueArb, nullableConfigValueArb, (dbVal, envVal) => {
        const dbPath = tmpDbPath();
        const db = initDatabase(dbPath);

        const now = Date.now();
        db.prepare(
          `INSERT INTO agent_registry
            (id, api_key, registry_url, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?)`,
        ).run(
          "default",
          null,
          dbVal,
          now,
          now,
        );

        const originalEnv = { ...process.env };
        if (envVal !== null) {
          process.env.AGENT_REGISTRY_URL = envVal;
        } else {
          delete process.env.AGENT_REGISTRY_URL;
        }

        try {
          const config = getAgentRegistryConfig(db);
          if (dbVal !== null) {
            expect(config.registryUrl).toBe(dbVal);
          } else {
            expect(config.registryUrl).toBe(envVal);
          }
        } finally {
          process.env = originalEnv;
          db.close();
        }
      }),
      { numRuns: 50 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: Env migration correctness
// ---------------------------------------------------------------------------

const envFileValueArb = fc
  .string({ minLength: 1, maxLength: 64 })
  .filter((s) => {
    const trimmed = s.trim();
    return (
      trimmed.length > 0 &&
      !trimmed.includes("\n") &&
      !trimmed.includes("\r") &&
      !trimmed.includes("=") &&
      !trimmed.includes('"') &&
      !trimmed.includes("'") &&
      !trimmed.startsWith("#")
    );
  })
  .map((s) => s.trim());

describe("Property 2: Env migration correctness", () => {
  it("migration writes .env values to DB exactly when table is empty", () => {
    fc.assert(
      fc.property(envFileValueArb, (envVal) => {
        const dbPath = tmpDbPath();
        const db = initDatabase(dbPath);

        const tmpHome = join(tmpdir(), `home-prop-${randomUUID()}`);
        tempPaths.push(tmpHome);
        mkdirSync(join(tmpHome, ".openclaw"), { recursive: true });

        writeFileSync(join(tmpHome, ".openclaw", ".env"), `AGENT_REGISTRY_URL=${envVal}`);

        const originalHome = process.env.HOME;
        process.env.HOME = tmpHome;

        try {
          migrateFromEnvIfEmpty(db);

          const row = db
            .prepare("SELECT * FROM agent_registry WHERE id = 'default'")
            .get() as Record<string, unknown> | undefined;

          expect(row).toBeDefined();
          expect(row!.registry_url).toBe(envVal);
          expect(row!["api_key"]).toBeNull();
        } finally {
          process.env.HOME = originalHome;
          db.close();
        }
      }),
      { numRuns: 50 },
    );
  });
});
