import type { createSubsystemLogger } from "../logging/subsystem.js";
import type { GatewayRequestContext, GatewayRequestHandlers } from "./server-methods/types.js";
import {
  attachGatewayWsConnectionHandler,
  type GatewayWsSharedHandlerParams,
} from "./server/ws-connection.js";
import type { GatewayWsClient } from "./server/ws-types.js";

type GatewayWsRuntimeParams = GatewayWsSharedHandlerParams & {
  logGateway: ReturnType<typeof createSubsystemLogger>;
  logHealth: ReturnType<typeof createSubsystemLogger>;
  logWsControl: ReturnType<typeof createSubsystemLogger>;
  extraHandlers: GatewayRequestHandlers;
  broadcast: (
    event: string,
    payload: unknown,
    opts?: {
      dropIfSlow?: boolean;
      stateVersion?: { presence?: number; health?: number };
    },
  ) => void;
  context: GatewayRequestContext;
  onClientConnected?: (client: GatewayWsClient, upgradeReq: { url?: string }) => void;
  onSessionCreated?: (sessionKey: string, label: string, client: GatewayWsClient) => void;
  onClientDisconnected?: (client: GatewayWsClient) => void;
};

export function attachGatewayWsHandlers(params: GatewayWsRuntimeParams) {
  attachGatewayWsConnectionHandler({
    wss: params.wss,
    clients: params.clients,
    port: params.port,
    gatewayHost: params.gatewayHost,
    canvasHostEnabled: params.canvasHostEnabled,
    canvasHostServerPort: params.canvasHostServerPort,
    resolvedAuth: params.resolvedAuth,
    rateLimiter: params.rateLimiter,
    browserRateLimiter: params.browserRateLimiter,
    gatewayMethods: params.gatewayMethods,
    events: params.events,
    logGateway: params.logGateway,
    logHealth: params.logHealth,
    logWsControl: params.logWsControl,
    extraHandlers: params.extraHandlers,
    broadcast: params.broadcast,
    buildRequestContext: () => params.context,
    onClientConnected: params.onClientConnected,
    onSessionCreated: params.onSessionCreated,
    onClientDisconnected: params.onClientDisconnected,
  });
}
