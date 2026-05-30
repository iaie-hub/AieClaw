import type { DatabaseSync } from "node:sqlite";

export interface ClawHubHandlersDeps {
  db: DatabaseSync;
}

/** Default AgentRegistry HTTP port. */
export const DEFAULT_REGISTRY_PORT = 8000;
export const DEFAULT_REGISTRY_URL = `http://localhost:${DEFAULT_REGISTRY_PORT}`;

/**
 * Derive the AgentRegistry HTTP base URL.
 *
 * Resolution order:
 * 1. registryUrl explicitly configured in DB
 * 2. AGENT_REGISTRY_URL environment variable
 * 3. Derive from natsUrl host with default HTTP port (8000)
 * 4. Fall back to http://localhost:8000
 */
export function getRegistryBaseUrl(registryUrl: string | null, natsUrl: string | null): string {
  if (registryUrl) {
    return registryUrl.replace(/\/+$/, "");
  }
  const envUrl = process.env.AGENT_REGISTRY_URL;
  if (envUrl) {
    return envUrl.replace(/\/+$/, "");
  }

  if (!natsUrl) {
    return DEFAULT_REGISTRY_URL;
  }
  // natsUrl is like "nats://host:port" — derive HTTP URL from the host
  try {
    const match = natsUrl.match(/^nats:\/\/([^:/]+)(?::(\d+))?/);
    if (match?.[1]) {
      return `http://${match[1]}:${DEFAULT_REGISTRY_PORT}`;
    }
  } catch {
    // ignore parse errors
  }
  return DEFAULT_REGISTRY_URL;
}

/**
 * Mask an API key for display: show first 8 chars + "****" + last 8 chars.
 * Returns null if the key is null/empty.
 */
export function maskApiKey(apiKey: string | null): string | null {
  if (!apiKey) {
    return null;
  }
  if (apiKey.length <= 16) {
    return apiKey;
  }
  return apiKey.slice(0, 8) + "****" + apiKey.slice(-8);
}
