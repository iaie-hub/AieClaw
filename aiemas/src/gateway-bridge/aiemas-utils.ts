import type { SubsystemLogger } from "../../../src/logging/subsystem.js";
import type { MasAuthContext } from "./context.js";
import type { Mas4sGatewayPlugin } from "./mas4s-gateway-plugin.js";

/**
 * Minimal interface for a Gateway client.
 * Using optional properties to align with core's GatewayClient base type.
 */
export type GatewayClient = {
  connId?: string;
  socket?: {
    send: (frame: string) => void;
    close: (code?: number, reason?: string) => void;
  };
  connect?: {
    client?: {
      displayName?: string;
    };
    scopes?: string[];
  };
} & Record<string, unknown>;

/**
 * Minimal interface for Gateway request context.
 */
export interface GatewayContext {
  broadcast: (event: string, payload: unknown, opts?: { dropIfSlow?: boolean }) => void;
  [key: string]: unknown;
}

/**
 * Shared context for common operations.
 */
export interface CommonContext {
  plugin: Mas4sGatewayPlugin;
  getMasAuth: (client: unknown) => MasAuthContext | null;
  getActiveClients: () => Set<GatewayClient>;
  extractUuid: (sessionKey: string) => string;
  loadSessionRow: (sessionKey: string) => Record<string, unknown> | null;
  log: SubsystemLogger;
}

/**
 * Type-safe string extractor for Record<string, unknown>.
 */
export function str(val: unknown): string | undefined {
  return typeof val === "string" ? val : undefined;
}

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
