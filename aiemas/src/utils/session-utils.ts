import { normalizeAgentId } from "../../../src/routing/session-key.js";
import { normalizeLowercaseStringOrEmpty } from "../../../src/shared/string-coerce.js";

/**
 * Extract sessionUuid from sessionKey.
 * Format: agent:{agentId}:group:{sessionUuid} -> {sessionUuid}
 */
export function extractUuidFromKey(sessionKey: string): string {
  const parts = sessionKey.split(":");
  return parts[parts.length - 1];
}

/**
 * Extract agentId (name) from sessionKey.
 * Format: agent:{agentId}:group:{sessionUuid} -> {agentId}
 */
export function extractAgentNameFromKey(sessionKey: string): string {
  if (!sessionKey) {
    return "Agent";
  }
  const parts = sessionKey.split(":");
  if (parts.length >= 2 && parts[0] === "agent") {
    return parts[1];
  }
  return "Agent";
}

/**
 * Construct sessionKey from agentId and sessionUuid.
 */
export function constructKeyFromUuid(agentId: string, sessionUuid: string): string {
  return `agent:${normalizeAgentId(agentId)}:group:${normalizeLowercaseStringOrEmpty(sessionUuid)}`;
}
