/**
 * Configuration schema, validation, and NATS connect options for the agent-registry plugin.
 *
 * Reads six AGENT_REGISTRY_* environment variables, validates them with Zod,
 * and returns a typed AgentRegistryConfig. Also exports buildNatsConnectOptions
 * for constructing the nats.js ConnectionOptions object.
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 1.2, 1.7
 */

import { z } from "zod";
import type { AgentRegistryConfig } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Validate that a NATS URL port component is a valid integer in [1, 65535].
 * The regex already constrains the port to 1–5 digits; this superRefine
 * additionally rejects values like "00000" or "99999".
 */
function isValidPort(url: string): boolean {
  const match = url.match(/^nats:\/\/[^:]+:(\d{1,5})$/);
  if (!match) return false;
  const port = parseInt(match[1]!, 10);
  return port >= 1 && port <= 65535;
}

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const AgentRegistryEnvSchema = z.object({
  AGENT_REGISTRY_NATS_URL: z
    .string({ required_error: "AGENT_REGISTRY_NATS_URL is required" })
    .min(1, "AGENT_REGISTRY_NATS_URL must not be empty")
    .regex(
      /^nats:\/\/[^:]+:\d{1,5}$/,
      "AGENT_REGISTRY_NATS_URL: must match pattern nats://{host}:{port} where port is 1-65535",
    )
    .refine(isValidPort, {
      message:
        "AGENT_REGISTRY_NATS_URL: must match pattern nats://{host}:{port} where port is 1-65535",
    }),

  AGENT_REGISTRY_AGENT_ID: z
    .string({ required_error: "AGENT_REGISTRY_AGENT_ID is required" })
    .min(1, "AGENT_REGISTRY_AGENT_ID must not be empty")
    .max(
      64,
      "AGENT_REGISTRY_AGENT_ID: must be at most 64 characters (alphanumeric, hyphens, underscores)",
    )
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      "AGENT_REGISTRY_AGENT_ID: must contain only alphanumeric characters, hyphens, and underscores (max 64 chars)",
    ),

  AGENT_REGISTRY_AGENT_NAME: z
    .string({ required_error: "AGENT_REGISTRY_AGENT_NAME is required" })
    .min(1, "AGENT_REGISTRY_AGENT_NAME must not be empty")
    .max(128, "AGENT_REGISTRY_AGENT_NAME: must be at most 128 characters"),

  AGENT_REGISTRY_NATS_TOKEN: z
    .string()
    .max(512, "AGENT_REGISTRY_NATS_TOKEN: must be at most 512 characters")
    .optional(),

  AGENT_REGISTRY_SKILLS: z
    .string()
    .optional()
    .transform((val) => {
      if (!val || val.trim() === "") return [];
      return val
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
    })
    .pipe(
      z.array(
        z
          .string()
          .min(1, "AGENT_REGISTRY_SKILLS: each skill name must not be empty")
          .max(128, "AGENT_REGISTRY_SKILLS: each skill name must be at most 128 characters"),
      ),
    ),

  AGENT_REGISTRY_BOUND_AGENT_ID: z
    .string()
    .max(64, "AGENT_REGISTRY_BOUND_AGENT_ID: must be at most 64 characters")
    .optional()
    .transform((val) => (val === "" ? undefined : val)),
});

// ---------------------------------------------------------------------------
// parseConfig
// ---------------------------------------------------------------------------

/**
 * Parse and validate all AGENT_REGISTRY_* environment variables.
 *
 * Throws a descriptive error on validation failure that names the specific
 * field, states the violated constraint, and provides the expected format.
 *
 * Requirements: 9.1–9.7, 1.7
 */
export function parseConfig(env: NodeJS.ProcessEnv): AgentRegistryConfig {
  const result = AgentRegistryEnvSchema.safeParse(env);

  if (!result.success) {
    const issues = result.error.issues;
    // Build a human-readable message for the first (most relevant) issue.
    // Each Zod message already names the field and constraint per the schema.
    const messages = issues.map((issue) => {
      // For missing required fields, the path may be empty; use the message directly.
      const path = issue.path.length > 0 ? issue.path.join(".") : null;
      if (path) {
        return `${path}: ${issue.message}`;
      }
      return issue.message;
    });
    throw new Error(`agent-registry configuration error:\n${messages.join("\n")}`);
  }

  const data = result.data;

  return {
    natsUrl: data.AGENT_REGISTRY_NATS_URL,
    agentId: data.AGENT_REGISTRY_AGENT_ID,
    agentName: data.AGENT_REGISTRY_AGENT_NAME,
    natsToken: data.AGENT_REGISTRY_NATS_TOKEN,
    skills: data.AGENT_REGISTRY_SKILLS,
    boundAgentId: data.AGENT_REGISTRY_BOUND_AGENT_ID,
  };
}

// ---------------------------------------------------------------------------
// buildNatsConnectOptions
// ---------------------------------------------------------------------------

/**
 * Options subset compatible with nats.js ConnectionOptions.
 * Kept as a plain object to avoid importing nats types at config layer.
 */
export interface NatsConnectOptions {
  servers: string;
  token?: string;
  reconnect: boolean;
  maxReconnectAttempts: number;
  reconnectTimeWait: number;
  maxReconnectTimeWait: number;
}

/**
 * Build the nats.js connect options from a validated AgentRegistryConfig.
 *
 * Includes the token when present. Reconnect strategy is delegated to nats.js:
 * exponential backoff starting at 1 s, capped at 30 s, unlimited retries.
 *
 * Requirements: 1.2, 1.3
 */
export function buildNatsConnectOptions(config: AgentRegistryConfig): NatsConnectOptions {
  const options: NatsConnectOptions = {
    servers: config.natsUrl,
    reconnect: true,
    maxReconnectAttempts: -1,
    reconnectTimeWait: 1000,
    maxReconnectTimeWait: 30000,
  };

  if (config.natsToken !== undefined) {
    options.token = config.natsToken;
  }

  return options;
}
