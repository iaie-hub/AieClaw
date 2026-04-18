/**
 * MAS session utilities for frontend.
 */

/**
 * Extract sessionUuid from sessionKey.
 * Format: agent:{agentId}:group:{sessionUuid} -> {sessionUuid}
 */
export function extractUuidFromKey(sessionKey: string): string {
  if (!sessionKey) {
    return "";
  }
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
 * 从 agentId 和 sessionUuid 构建 sessionKey。
 * 与 extractAgentNameFromKey / extractUuidFromKey 形成往返一致性。
 * buildSessionKey(extractAgentNameFromKey(key), extractUuidFromKey(key)) === key
 */
export function buildSessionKey(agentId: string, sessionUuid: string): string {
  return `agent:${agentId}:group:${sessionUuid}`;
}
