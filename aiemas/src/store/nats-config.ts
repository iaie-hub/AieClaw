import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";

export interface NatsConfigRecord {
  id: "default";
  natsUrl: string | null;
  natsToken: string | null;
  agentId: string | null;
  agentName: string | null;
  boundAgentId: string | null;
  createdAt: number;
  updatedAt: number;
}

const ENV_FIELD_MAP: Record<
  string,
  keyof Omit<NatsConfigRecord, "id" | "createdAt" | "updatedAt">
> = {
  AGENT_REGISTRY_NATS_URL: "natsUrl",
  AGENT_REGISTRY_NATS_TOKEN: "natsToken",
  AGENT_REGISTRY_AGENT_ID: "agentId",
  AGENT_REGISTRY_AGENT_NAME: "agentName",
  AGENT_REGISTRY_BOUND_AGENT_ID: "boundAgentId",
};

export function getNatsConfig(db: DatabaseSync): NatsConfigRecord {
  const row = db.prepare("SELECT * FROM nats_config WHERE id = 'default'").get() as
    | RawNatsRow
    | undefined;

  const now = Date.now();

  if (!row) {
    return {
      id: "default",
      natsUrl: process.env.AGENT_REGISTRY_NATS_URL ?? null,
      natsToken: process.env.AGENT_REGISTRY_NATS_TOKEN ?? null,
      agentId: process.env.AGENT_REGISTRY_AGENT_ID ?? null,
      agentName: process.env.AGENT_REGISTRY_AGENT_NAME ?? null,
      boundAgentId: process.env.AGENT_REGISTRY_BOUND_AGENT_ID ?? null,
      createdAt: now,
      updatedAt: now,
    };
  }

  return {
    id: "default",
    natsUrl: row.nats_url ?? process.env.AGENT_REGISTRY_NATS_URL ?? null,
    natsToken: row.nats_token ?? process.env.AGENT_REGISTRY_NATS_TOKEN ?? null,
    agentId: row.agent_id ?? process.env.AGENT_REGISTRY_AGENT_ID ?? null,
    agentName: row.agent_name ?? process.env.AGENT_REGISTRY_AGENT_NAME ?? null,
    boundAgentId: row.bound_agent_id ?? process.env.AGENT_REGISTRY_BOUND_AGENT_ID ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function saveNatsConfig(
  db: DatabaseSync,
  config: Partial<Omit<NatsConfigRecord, "id" | "createdAt" | "updatedAt">>,
): void {
  const now = Date.now();

  const existing = db.prepare("SELECT * FROM nats_config WHERE id = 'default'").get() as
    | RawNatsRow
    | undefined;

  const natsUrl = config.natsUrl !== undefined ? config.natsUrl : (existing?.nats_url ?? null);
  const natsToken =
    config.natsToken !== undefined ? config.natsToken : (existing?.nats_token ?? null);
  const agentId = config.agentId !== undefined ? config.agentId : (existing?.agent_id ?? null);
  const agentName =
    config.agentName !== undefined ? config.agentName : (existing?.agent_name ?? null);
  const boundAgentId =
    config.boundAgentId !== undefined ? config.boundAgentId : (existing?.bound_agent_id ?? null);
  const createdAt = existing?.created_at ?? now;

  db.prepare(
    `INSERT OR REPLACE INTO nats_config
      (id, nats_url, nats_token, agent_id, agent_name, bound_agent_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("default", natsUrl, natsToken, agentId, agentName, boundAgentId, createdAt, now);
}

export function migrateNatsFromEnvIfEmpty(db: DatabaseSync): void {
  try {
    const existing = db.prepare("SELECT id FROM nats_config WHERE id = 'default'").get() as
      | { id: string }
      | undefined;

    if (existing) {
      return;
    }

    const envVars = readOpenClawEnvFile();
    if (!envVars) {
      return;
    }

    const hasAnyVar = Object.keys(ENV_FIELD_MAP).some((key) => envVars[key]);
    if (!hasAnyVar) {
      return;
    }

    const now = Date.now();
    db.prepare(
      `INSERT OR REPLACE INTO nats_config
        (id, nats_url, nats_token, agent_id, agent_name, bound_agent_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      "default",
      envVars.AGENT_REGISTRY_NATS_URL ?? null,
      envVars.AGENT_REGISTRY_NATS_TOKEN ?? null,
      envVars.AGENT_REGISTRY_AGENT_ID ?? null,
      envVars.AGENT_REGISTRY_AGENT_NAME ?? null,
      envVars.AGENT_REGISTRY_BOUND_AGENT_ID ?? null,
      now,
      now,
    );
  } catch (err) {
    console.error("[nats-config] Migration from .env failed:", err);
  }
}

interface RawNatsRow {
  id: string;
  nats_url: string | null;
  nats_token: string | null;
  agent_id: string | null;
  agent_name: string | null;
  bound_agent_id: string | null;
  created_at: number;
  updated_at: number;
}

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
