import type { DatabaseSync } from "node:sqlite";
import { TenantServiceError } from "../errors.js";
import type { TenantService } from "../index.js";
import type { Mas4sGatewayPlugin } from "./aiemas-types.js";
import { strCoerce, errorShape, getCallerAuth, type SimpleHandlers } from "./aiemas-utils.js";
import type { GatewayAuthBridge } from "./bridge.js";

export interface AiemasSessionsHandlersDeps {
  bridge: GatewayAuthBridge;
  tenantService: TenantService;
  db: DatabaseSync;
  /** Lazy reference to the plugin object (set after plugin is constructed). */
  getPlugin: () => Mas4sGatewayPlugin;
}

export function registerAiemasSessionsHandlers(
  handlers: SimpleHandlers,
  deps: AiemasSessionsHandlersDeps,
): void {
  const { bridge, tenantService, db, getPlugin } = deps;

  // ── aiemas.sessions.create ──
  handlers["aiemas.sessions.create"] = async ({ params, client, respond, dispatchGateway }) => {
    const auth = getCallerAuth(client);
    try {
      const agentId = strCoerce(params["agentId"]);
      if (!agentId) {
        respond(false, undefined, errorShape("INVALID_PARAMS", "agentId required"));
        return;
      }
      const label = typeof params["label"] === "string" ? params["label"] : undefined;
      const userId = auth.userId ?? null;
      const tenantId = strCoerce(auth.tenantId ?? "");
      const plugin = getPlugin();
      const { createSessionCascadeService } = await import("./aiemas-session.js");
      const cascadeService = createSessionCascadeService({
        db,
        callGateway: async (method, callParams) => {
          if (dispatchGateway) {
            return await dispatchGateway(method, callParams, client);
          }
          if (!plugin.gatewayDispatch) {
            throw new Error("gatewayDispatch not available");
          }
          return await plugin.gatewayDispatch(method, callParams, client);
        },
        topologyCache: tenantService.cacheService.topologyCache,
        recordSessionCreated: (sessionKey, uid, tid) => {
          bridge.onSessionCreated(sessionKey, "", {
            userId: uid,
            tenantId: tid,
            masRole: auth.masRole,
          });
        },
        deleteSessionRecords: (sessionKey) => {
          bridge.onSessionDeleted(sessionKey);
        },
        loadGatewaySessionRow: (sessionKey: string) => {
          if (!plugin.loadGatewaySessionRow) {
            throw new Error("loadGatewaySessionRow not available");
          }
          return plugin.loadGatewaySessionRow(sessionKey);
        },
      });

      const result = await cascadeService.cascadeCreate({ agentId, userId, tenantId, label });
      respond(true, result, undefined);
    } catch (err) {
      const e =
        err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
      respond(false, undefined, errorShape(e.code, e.message));
    }
  };

  // ── aiemas.sessions.delete ──
  handlers["aiemas.sessions.delete"] = async ({ params, client, respond, dispatchGateway }) => {
    const auth = getCallerAuth(client);
    try {
      const sessionKey = strCoerce(params["sessionKey"]);
      if (!sessionKey) {
        respond(false, undefined, errorShape("INVALID_PARAMS", "sessionKey required"));
        return;
      }

      if (auth.userId) {
        const access = bridge.checkSessionAccess(sessionKey, auth);
        if (!access.allowed) {
          respond(false, undefined, errorShape(access.code, access.message));
          return;
        }
      }

      const plugin = getPlugin();
      const { createSessionCascadeService } = await import("./aiemas-session.js");
      const cascadeService = createSessionCascadeService({
        db,
        callGateway: async (method, callParams) => {
          if (dispatchGateway) {
            return await dispatchGateway(method, callParams, client);
          }
          if (!plugin.gatewayDispatch) {
            throw new Error("gatewayDispatch not available");
          }
          return await plugin.gatewayDispatch(method, callParams, client);
        },
        topologyCache: tenantService.cacheService.topologyCache,
        recordSessionCreated: (sk: string, uid: string, tid: string) => {
          bridge.onSessionCreated(sk, "", {
            userId: uid,
            tenantId: tid,
            masRole: auth.masRole,
          });
        },
        deleteSessionRecords: (sk: string) => {
          bridge.onSessionDeleted(sk);
        },
        loadGatewaySessionRow: (sk: string) => {
          if (!plugin.loadGatewaySessionRow) {
            throw new Error("loadGatewaySessionRow not available");
          }
          return plugin.loadGatewaySessionRow(sk);
        },
      });

      await cascadeService.cascadeDelete({ sessionKey });
      respond(true, { ok: true }, undefined);
    } catch (err) {
      const e =
        err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
      respond(false, undefined, errorShape(e.code, e.message));
    }
  };

  // ── aiemas.sessions.list ──
  handlers["aiemas.sessions.list"] = async ({ client, respond, dispatchGateway }) => {
    try {
      const plugin = getPlugin();
      const { createSessionCascadeService } = await import("./aiemas-session.js");
      const cascadeService = createSessionCascadeService({
        db,
        callGateway: async (method, callParams) => {
          if (dispatchGateway) {
            return await dispatchGateway(method, callParams, client);
          }
          if (!plugin.gatewayDispatch) {
            throw new Error("gatewayDispatch not available");
          }
          return await plugin.gatewayDispatch(method, callParams, client);
        },
        topologyCache: tenantService.cacheService.topologyCache,
        recordSessionCreated: (sessionKey: string, uid: string, tid: string) => {
          bridge.onSessionCreated(sessionKey, "", { userId: uid, tenantId: tid, masRole: null });
        },
        deleteSessionRecords: (sk: string) => {
          bridge.onSessionDeleted(sk);
        },
        loadGatewaySessionRow: (sessionKey: string) => {
          if (!plugin.loadGatewaySessionRow) {
            throw new Error("loadGatewaySessionRow not available");
          }
          return plugin.loadGatewaySessionRow(sessionKey);
        },
      });

      const result = await cascadeService.listRootSessions();
      respond(true, result, undefined);
    } catch (err) {
      const e =
        err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
      respond(false, undefined, errorShape(e.code, e.message));
    }
  };
}
