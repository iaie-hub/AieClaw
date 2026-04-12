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
  /** Optional: factory for callGateway, used for topology sync. Provided at runtime. */
  getCallGateway?: () =>
    | ((method: string, params: Record<string, unknown>) => Promise<unknown>)
    | null;
  /** Optional: load gateway session row for cascade service. */
  loadGatewaySessionRow?: (sessionKey: string) => unknown;
  /** Optional: callbacks for session ownership, used for topology sync. */
  sessionCallbacks?: {
    recordSessionCreated: (sessionKey: string, userId: string, tenantId: string) => void;
    deleteSessionRecords: (sessionKey: string) => void;
  };
}

export function registerAgentHandlers(extraHandlers: Record<string, unknown>, ctx: AgentContext) {
  const {
    setCurrentRequestContext: _setCurrentRequestContext,
    clearRequestContext: _clearRequestContext,
  } = ctx;

  const origAgentsImport = extraHandlers["aiemas.agents.import"] as
    | ((opts: unknown) => Promise<void>)
    | undefined;
  if (origAgentsImport) {
    extraHandlers["aiemas.agents.import"] = async (opts: {
      client: GatewayClient;
      context: GatewayContext;
    }) => {
      // Manual context management removed here as it's now handled by the integration wrapper.
      await origAgentsImport(opts);
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
  extraHandlers["aiemas.agents.topology.save"] = async (opts: {
    params: Record<string, unknown>;
    respond: (ok: boolean, payload: unknown, error: unknown) => void;
    dispatchGateway?: (method: string, params: Record<string, unknown>) => Promise<unknown>;
  }) => {
    const { params, respond, dispatchGateway } = opts;
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

    // Capture old topology BEFORE updating the cache
    const oldTopology = ctx.cacheService.topologyCache.getTopology(rootAgentId);
    console.log(
      `[mas4s:topology.save] rootAgentId=${rootAgentId}, oldEdgesCount=${oldTopology?.edges?.length ?? 0}, newEdgesCount=${topology.edges.length}`,
    );

    const topologyTree = { edges: topology.edges };
    saveTopology(ctx.db, rootAgentId, topologyTree);
    ctx.cacheService.topologyCache.update(rootAgentId, topologyTree);

    respond(true, { ok: true }, null);

    // Trigger incremental session sync after cache is updated (fire-and-forget, wrapped in try/catch)
    if ((dispatchGateway || ctx.getCallGateway) && ctx.sessionCallbacks) {
      const callGateway = dispatchGateway ?? ctx.getCallGateway?.();
      if (callGateway) {
        console.log(
          `[mas4s:topology.save] Triggering incremental session sync for rootAgentId=${rootAgentId}`,
        );
        const tenantId = typeof params.tenantId === "string" ? params.tenantId : "";
        try {
          const { createSessionCascadeService } = await import("./aiemas-session.js");
          const cascadeService = createSessionCascadeService({
            db: ctx.db,
            callGateway,
            topologyCache: ctx.cacheService.topologyCache,
            recordSessionCreated: ctx.sessionCallbacks.recordSessionCreated,
            deleteSessionRecords: ctx.sessionCallbacks.deleteSessionRecords,
            loadGatewaySessionRow: ctx.loadGatewaySessionRow ?? (() => null),
          });
          await cascadeService.syncTopologyChanges({
            rootAgentId,
            oldTopology,
            newTopology: topologyTree,
            tenantId,
          });
        } catch (syncErr) {
          console.warn(
            `[mas4s:topology.save] syncTopologyChanges failed for rootAgentId=${rootAgentId}: ${String(syncErr)}`,
          );
        }
      }
    }
  };
}
