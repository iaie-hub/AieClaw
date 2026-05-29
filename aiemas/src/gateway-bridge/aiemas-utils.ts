import type {
  GatewayClient,
  GatewayContext,
  CommonContext,
  SimpleHandler,
  SimpleHandlers,
} from "./aiemas-types.js";
import type { MasAuthContext } from "./context.js";
import { getMasAuth as _getMasAuth, NULL_MAS_AUTH as _NULL_MAS_AUTH } from "./context.js";
import * as nodePath from "node:path";
import * as nodeOs from "node:os";

/**
 * Get the standardized temporary download directory path for agents.
 * Format: ~/.openclaw/aiemas/data/download/{yyyymm}/{agentId}
 */
export function getAgentDownloadTempDir(agentId: string): string {
  const now = new Date();
  const yyyymm = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  return nodePath.join(nodeOs.homedir(), ".openclaw", "aiemas", "data", "download", yyyymm, agentId);
}

/**
 * Type-safe string extractor for Record<string, unknown>.
 */
export function str(val: unknown): string | undefined {
  return typeof val === "string" ? val : undefined;
}

/**
 * Coerce unknown value to string (never returns undefined).
 * Used by gateway plugin handlers for param extraction.
 */
export function strCoerce(v: unknown): string {
  return typeof v === "string"
    ? v
    : v == null
      ? ""
      : typeof v === "object"
        ? JSON.stringify(v)
        : String(v as string | number | boolean | symbol | bigint);
}

/**
 * Build a standard error shape for gateway responses.
 */
export function errorShape(code: string, message: string): { code: string; message: string } {
  return { code, message };
}

/**
 * Extract caller auth from a gateway client object.
 * Returns NULL_MAS_AUTH when client has no auth context.
 */
export function getCallerAuth(client: unknown) {
  if (client != null && typeof client === "object") {
    return _getMasAuth(client) ?? _NULL_MAS_AUTH;
  }
  return _NULL_MAS_AUTH;
}

/**
 * Re-export types from aiemas-types for backward compatibility.
 */
export type {
  GatewayClient,
  GatewayContext,
  CommonContext,
  SimpleHandler,
  SimpleHandlers,
} from "./aiemas-types.js";

/**
 * Helper to build connected users map for bridge methods.
 */
export function buildConnectedUsers(
  activeClients: Set<GatewayClient>,
  getMasAuth: (client: GatewayClient) => MasAuthContext | null,
): Map<string, MasAuthContext> {
  const map = new Map<string, MasAuthContext>();
  for (const client of activeClients) {
    if (client.connId) {
      const auth = getMasAuth(client);
      if (auth) {
        map.set(client.connId, auth);
      }
    }
  }
  return map;
}

/**
 * Send a message to a specific connection ID.
 */
export function sendToConnId(
  connId: string,
  activeClients: Set<GatewayClient>,
  event: string,
  data: unknown,
): void {
  for (const client of activeClients) {
    if (client.connId === connId && client.socket) {
      client.socket.send(JSON.stringify({ type: "event", event, data }));
      break;
    }
  }
}
