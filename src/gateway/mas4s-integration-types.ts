/**
 * Type definitions for Mas4sIntegration.
 * Separated from mas4s-integration.ts to support type imports without circular dependencies.
 */

import type { AnyAgentTool } from "../agents/tools/common.js";
import type { OpenClawConfig } from "../config/config.js";
import type { GatewayMessageChannel } from "../utils/message-channel.js";
import type { GatewayRequestHandlers, GatewayClient } from "./server-methods/types.js";
import type { GatewayWsClient } from "./server/ws-types.js";

/**
 * Interface for optional multi-tenant RBAC integration via aiemas plugin.
 * Provides handlers, request interception, and broadcast filtering.
 */
export interface Mas4sIntegration {
  extraHandlers: GatewayRequestHandlers;
  onClientConnected: (client: GatewayWsClient, upgradeReq: { url?: string }) => void;
  onSessionCreated: (sessionKey: string, label: string, client: GatewayClient) => void;
  /**
   * Pre-request interceptor: check RBAC + session access before dispatching.
   * Returns null to allow, or an error shape to reject.
   */
  interceptRequest: (
    method: string,
    params: Record<string, unknown>,
    client: GatewayClient | null,
  ) => { allowed: true } | { allowed: false; code: string; message: string };
  /**
   * Broadcast filter: returns a Set of connIds that should receive the event,
   * or null to broadcast to all (compat mode / no filtering).
   */
  filterBroadcast: (
    event: string,
    payload: unknown,
    clients: Set<GatewayWsClient>,
  ) => ReadonlySet<string> | null;
  /**
   * Filter sessions.list results to only include sessions the user has membership for.
   */
  filterSessionsList: (sessions: unknown[], client: GatewayClient | null) => unknown[];
  /**
   * Called when a WS client disconnects. Marks the user offline if authenticated.
   */
  onClientDisconnected: (client: GatewayWsClient) => void;
  /**
   * Internal: allows server.impl.ts to keep the clients reference up to date.
   * This is used by the MAS4S bridge to track user presence across all connections.
   */
  _setActiveClients?: (clients: Set<GatewayWsClient>) => void;
  /**
   * Internal: inject the ExecApprovalManager so interceptRequest can record
   * exec.approval.resolve requests to session_messages for history replay.
   */
  _setExecApprovalManager?: (
    manager: import("./exec-approval-manager.js").ExecApprovalManager,
  ) => void;
  /**
   * Returns AIEMAS-provided Agent tools.
   * Called by createOpenClawTools() to inject AIEMAS tools into the Agent tool set.
   * Returns undefined or an empty array when no AIEMAS tools are available.
   */
  resolveAgentTools?: (context: {
    agentSessionKey?: string;
    agentChannel?: GatewayMessageChannel;
    config?: OpenClawConfig;
  }) => AnyAgentTool[];
  /**
   * Returns a set of scopes to automatically grant a newly connected client
   * based on their identity/tenant claims (extracted from headers, auth context, etc).
   * Return null for no auto-grant (compat mode / public scopes only).
   */
  resolveAutoScopes: (connection: {
    url?: string;
    client?: { displayName?: string };
  }) => Set<string> | null;
}
