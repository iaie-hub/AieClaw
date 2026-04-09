import type { DatabaseSync } from "node:sqlite";
import type { CacheService } from "../cache/cache-service.js";
import { validateEdges, saveTopology, loadAllTopologies } from "../store/topology-store.js";
import type { GatewayClient, GatewayContext } from "./aiemas-utils.js";
import type { Mas4sGatewayPlugin } from "./mas4s-gateway-plugin.js";

export interface AgentContext {
  plugin?: Mas4sGatewayPlugin;
  db: DatabaseSync;
  cacheService: CacheService;
  setCurrentRequestContext?: (context: GatewayContext, client: GatewayClient) => void;
  clearRequestContext?: () => void;
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
      if (setCurrentRequestContext) {
        setCurrentRequestContext(opts.context, opts.client);
      }
      try {
        await origAgentsImport(opts);
      } finally {
        if (clearRequestContext) {
          clearRequestContext();
        }
      }
    };
  }

  // ── aiemas.agents.topology.list ──
  extraHandlers["aiemas.agents.topology.list"] = (opts: {
    params: Record<string, unknown>;
    respond: (ok: boolean, payload: unknown, error: unknown) => void;
  }) => {
    const { params, respond } = opts;
    const rootAgentId = params.rootAgentId as string | undefined;

    if (rootAgentId) {
      const topology = ctx.cacheService.topologyCache.getTopology(rootAgentId);
      respond(true, { rootAgentId, topology: topology ?? { edges: [] } }, null);
    } else {
      const rows = loadAllTopologies(ctx.db);
      respond(true, { topologies: rows }, null);
    }
  };

  // ── aiemas.agents.topology.save ──
  extraHandlers["aiemas.agents.topology.save"] = (opts: {
    params: Record<string, unknown>;
    respond: (ok: boolean, payload: unknown, error: unknown) => void;
  }) => {
    const { params, respond } = opts;
    const rootAgentId = params.rootAgentId as string | undefined;
    const topology = params.topology as { edges?: Array<{ from: string; to: string }> } | undefined;

    if (!rootAgentId) {
      respond(false, null, { code: "INVALID_PARAMS", message: "rootAgentId required" });
      return;
    }

    if (!topology || !Array.isArray(topology.edges)) {
      respond(false, null, { code: "INVALID_PARAMS", message: "topology required" });
      return;
    }

    const validation = validateEdges(topology.edges);
    if (!validation.valid) {
      respond(false, null, { code: "INVALID_PARAMS", message: validation.message });
      return;
    }

    const topologyTree = { edges: topology.edges };
    saveTopology(ctx.db, rootAgentId, topologyTree);
    ctx.cacheService.topologyCache.update(rootAgentId, topologyTree);

    respond(true, { ok: true }, null);
  };
}
