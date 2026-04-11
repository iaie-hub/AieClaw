import type { SubsystemLogger } from "../../../src/logging/subsystem.js";
import type { MasAuthContext } from "./context.js";
import { getMasAuth as _getMasAuth, NULL_MAS_AUTH as _NULL_MAS_AUTH } from "./context.js";
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
 * Generic handler type matching GatewayRequestHandlers entries.
 */
export type SimpleHandler = (opts: {
  params: Record<string, unknown>;
  client: unknown;
  respond: (ok: boolean, payload: unknown, error: unknown) => void;
  dispatchGateway?: (
    method: string,
    params: Record<string, unknown>,
    client?: unknown,
  ) => Promise<unknown>;
}) => void | Promise<void>;

export type SimpleHandlers = Record<string, SimpleHandler>;

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
