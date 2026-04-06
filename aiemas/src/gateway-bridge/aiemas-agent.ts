import type { GatewayClient, GatewayContext } from "./aiemas-utils.js";
import type { Mas4sGatewayPlugin } from "./mas4s-gateway-plugin.js";

export interface AgentContext {
  plugin: Mas4sGatewayPlugin;
  setCurrentRequestContext: (context: GatewayContext, client: GatewayClient) => void;
  clearRequestContext: () => void;
}

export function registerAgentHandlers(extraHandlers: Record<string, unknown>, ctx: AgentContext) {
  const { setCurrentRequestContext, clearRequestContext } = ctx;

  const origAgentsImport = extraHandlers["aiemas.agents.import"] as
    | ((opts: unknown) => Promise<void>)
    | undefined;
  if (origAgentsImport) {
    extraHandlers["aiemas.agents.import"] = async (opts: {
      client: GatewayClient;
      context: GatewayContext;
    }) => {
      setCurrentRequestContext(opts.context, opts.client);
      try {
        await origAgentsImport(opts);
      } finally {
        clearRequestContext();
      }
    };
  }
}
