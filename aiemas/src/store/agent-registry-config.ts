import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

/**
 * Single-row configuration record for AgentRegistry integration.
 * The `id` is always "default" (singleton pattern).
 */
export interface AgentRegistryConfigRecord {
  id: "default";
  apiKey: string | null;
  registryUrl: string | null;
  createdAt: number;
  updatedAt: number;
}

/**
 * Read the AgentRegistry config from the database.
 * Priority: DB value ?? env var value ?? null
 */
export function getAgentRegistryConfig(db: DatabaseSync): AgentRegistryConfigRecord {
  const row = db
    .prepare("SELECT * FROM agent_registry WHERE id = 'default'")
    .get() as RawConfigRow | undefined;

  const now = Date.now();

  if (!row) {
    return {
      id: "default",
      apiKey: null,
      registryUrl: process.env.AGENT_REGISTRY_URL ?? null,
      createdAt: now,
      updatedAt: now,
    };
  }

  return {
    id: "default",
    apiKey: row.api_key ?? null,
    registryUrl: row.registry_url ?? process.env.AGENT_REGISTRY_URL ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Save (upsert) AgentRegistry config to the database.
 * Uses INSERT OR REPLACE with the fixed id='default'.
 */
export function saveAgentRegistryConfig(
  db: DatabaseSync,
  config: Partial<Omit<AgentRegistryConfigRecord, "id" | "createdAt" | "updatedAt">>,
): void {
  const now = Date.now();

  // Read existing record to preserve fields not being updated
  const existing = db
    .prepare("SELECT * FROM agent_registry WHERE id = 'default'")
    .get() as RawConfigRow | undefined;

  const apiKey = config.apiKey !== undefined ? config.apiKey : (existing?.api_key ?? null);
  const registryUrl = config.registryUrl !== undefined ? config.registryUrl : (existing?.registry_url ?? null);
  const createdAt = existing?.created_at ?? now;

  db.prepare(
    `INSERT OR REPLACE INTO agent_registry
      (id, api_key, registry_url, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run("default", apiKey, registryUrl, createdAt, now);
}

/**
 * Migrate AGENT_REGISTRY_URL variable from `~/.openclaw/.env` into the database
 * if the agent_registry table has no record with id = 'default'.
 */
export function migrateFromEnvIfEmpty(db: DatabaseSync): void {
  try {
    const existing = db
      .prepare("SELECT id FROM agent_registry WHERE id = 'default'")
      .get() as { id: string } | undefined;

    if (existing) {
      return;
    }

    const envVars = readOpenClawEnvFile();
    if (!envVars) {
      return;
    }

    const registryUrl = envVars.AGENT_REGISTRY_URL ?? null;
    if (!registryUrl) {
      return;
    }

    const now = Date.now();
    db.prepare(
      `INSERT OR REPLACE INTO agent_registry
        (id, api_key, registry_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      "default",
      null,
      registryUrl,
      now,
      now,
    );
  } catch (err) {
    console.error("[agent-registry-config] Migration from .env failed:", err);
  }
}

// ── Internal helpers ──

interface RawConfigRow {
  id: string;
  api_key: string | null;
  registry_url: string | null;
  created_at: number;
  updated_at: number;
}

/**
 * Parse `~/.openclaw/.env` and return a key-value record.
 */
function readOpenClawEnvFile(): Record<string, string> | null {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "~";
  const envPath = join(home, ".openclaw", ".env");

  try {
    const content = readFileSync(envPath, "utf8");
    return parseEnvContent(content);
  } catch {
    return null;
  }
}

function parseEnvContent(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) {
      continue;
    }
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && value) {
      result[key] = value;
    }
  }
  return result;
}
