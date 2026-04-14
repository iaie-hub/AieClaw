/**
 * Central type definitions for AIEMAS gateway bridge.
 * This file contains types only - no circular dependencies with other bridge modules.
 */

import type { IncomingMessage } from "node:http";
import type { DatabaseSync } from "node:sqlite";
import type { SubsystemLogger } from "../../../src/logging/subsystem.js";
import type { TenantService } from "../index.js";
import type { SessionTranscriptStore } from "../session-history/session-transcript-store.js";
import type { GatewayAuthBridge } from "./bridge.js";
import type { MasAuthContext } from "./context.js";
import type { SOPSnapshot } from "./run-state-store.js";

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
 * Callback to dispatch an internal gateway request.
 */
export type GatewayDispatchFn = (
  method: string,
  params: Record<string, unknown>,
  client: unknown,
) => Promise<unknown>;

/**
 * Callback type for sending events to a specific connection.
 */
export type SendToConnIdFn = (connId: string, event: string, data: unknown) => void;

/**
 * Main gateway plugin interface.
 * This is the central contract for the AIEMAS gateway integration.
 */
export interface Mas4sGatewayPlugin {
  bridge: GatewayAuthBridge;
  tenantService: TenantService;
  extraHandlers: SimpleHandlers;
  extractMasTokenFromUrl: (upgradeReq: IncomingMessage) => string | undefined;
  /** Set by integration layer to enable internal gateway calls (e.g. chat.history). */
  gatewayDispatch: GatewayDispatchFn | null;
  /** Session transcript store for capturing messages. */
  transcriptStore: SessionTranscriptStore;
  /** Stop the session label lifecycle event subscription. */
  stopLabelSync: () => void;
  /** Persist a minimal SOP snapshot for reconnect recovery. */
  upsertRunState: (
    sessionUuid: string,
    patch: {
      runId?: string;
      sopSnapshot?: SOPSnapshot;
      isChatting?: boolean;
    },
  ) => void;
  /** Clear run state for a session (on reset/delete/clear). */
  clearRunState: (sessionUuid: string) => void;
  /** SQLite database handle for direct DB operations. */
  db: DatabaseSync;
  /** Load a full GatewaySessionRow (injected from core gateway). */
  loadGatewaySessionRow: (sessionKey: string) => unknown;
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
 * Caller auth type for gateway handlers.
 */
export type CallerAuth = MasAuthContext;
