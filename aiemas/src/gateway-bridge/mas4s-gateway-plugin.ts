import { TenantServiceError } from "../errors.js";
import type { TenantService, TenantServiceConfig } from "../index.js";
import { createTenantService } from "../index.js";
import { GatewayAuthBridge } from "./bridge.js";
import { getMasAuth, NULL_MAS_AUTH } from "./context.js";
import { extractMasTokenFromUrl } from "./integration.js";
import type { ChatHistoryMessage } from "./summary-llm.js";

/**
 * Generic handler type that avoids importing from src/gateway/ directly.
 * Matches the shape of GatewayRequestHandlers entries.
 */
type SimpleHandler = (opts: {
  params: Record<string, unknown>;
  client: unknown;
  respond: (ok: boolean, payload: unknown, error: unknown) => void;
}) => void | Promise<void>;

type SimpleHandlers = Record<string, SimpleHandler>;

/**
 * Callback to dispatch an internal gateway request.
 * Set by the integration layer after plugin creation.
 * Returns the response payload on success, throws on failure.
 */
export type GatewayDispatchFn = (
  method: string,
  params: Record<string, unknown>,
  client: unknown,
) => Promise<unknown>;

export interface Mas4sGatewayPlugin {
  bridge: GatewayAuthBridge;
  tenantService: TenantService;
  extraHandlers: SimpleHandlers;
  extractMasTokenFromUrl: typeof extractMasTokenFromUrl;
  /** Set by integration layer to enable internal gateway calls (e.g. chat.history). */
  gatewayDispatch: GatewayDispatchFn | null;
}

function errorShape(code: string, message: string): { code: string; message: string } {
  return { code, message };
}

function getCallerAuth(client: unknown) {
  if (client != null && typeof client === "object") {
    return getMasAuth(client) ?? NULL_MAS_AUTH;
  }
  return NULL_MAS_AUTH;
}

function str(v: unknown): string {
  return typeof v === "string"
    ? v
    : v == null
      ? ""
      : typeof v === "object"
        ? JSON.stringify(v)
        : String(v as string | number | boolean | symbol | bigint);
}

export async function createMas4sGatewayPlugin(
  config?: TenantServiceConfig,
): Promise<Mas4sGatewayPlugin> {
  const tenantService = createTenantService(config);
  await tenantService.init();

  // Access the internal db via a small workaround: bridge needs db directly.
  // We expose a factory that creates the bridge after init so db is available.
  // Since TenantService doesn't expose db publicly, we create a parallel db ref
  // by re-using the same dbPath via initDatabase.
  const { initDatabase } = await import("../store/database.js");
  const { homedir } = await import("node:os");
  const { join } = await import("node:path");
  const dbPath = config?.dbPath ?? join(homedir(), ".openclaw", "aiemas", "mas4s.db");
  const db = initDatabase(dbPath);

  // Log user count on startup for operational visibility
  const userCountRow = db.prepare("SELECT COUNT(*) AS count FROM users").get() as {
    count: number;
  };
  console.log(`[mas4s] Gateway started: ${userCountRow.count} user(s) in database`);

  const bridge = new GatewayAuthBridge(tenantService, db);

  const extraHandlers: SimpleHandlers = {
    "system.status": async ({ respond }) => {
      try {
        const result = tenantService.getSystemStatus();
        respond(true, result, undefined);
      } catch (err) {
        const e =
          err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
        respond(false, undefined, errorShape(e.code, e.message));
      }
    },

    "user.register": async ({ params, client, respond }) => {
      const auth = getCallerAuth(client);
      try {
        const result = tenantService.registerUser(
          params as unknown as Parameters<TenantService["registerUser"]>[0],
          auth.masRole ?? undefined,
        );
        respond(true, result, undefined);
      } catch (err) {
        const e =
          err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
        respond(false, undefined, errorShape(e.code, e.message));
      }
    },

    "user.list": async ({ params, client, respond }) => {
      const auth = getCallerAuth(client);
      try {
        const tenantId = str(params["tenantId"] ?? auth.tenantId ?? "");
        const callerRole = auth.masRole;
        if (!callerRole) {
          respond(false, undefined, errorShape("AUTH_REQUIRED", "Authentication required"));
          return;
        }
        const result = tenantService.listUsers(tenantId, callerRole);
        respond(true, result, undefined);
      } catch (err) {
        const e =
          err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
        respond(false, undefined, errorShape(e.code, e.message));
      }
    },

    "user.update": async ({ params, client, respond }) => {
      const auth = getCallerAuth(client);
      try {
        const callerRole = auth.masRole;
        if (!callerRole) {
          respond(false, undefined, errorShape("AUTH_REQUIRED", "Authentication required"));
          return;
        }
        const result = tenantService.updateUser(
          params as unknown as Parameters<TenantService["updateUser"]>[0],
          callerRole,
        );
        respond(true, result, undefined);
      } catch (err) {
        const e =
          err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
        respond(false, undefined, errorShape(e.code, e.message));
      }
    },

    "user.approve": async ({ params, client, respond }) => {
      const auth = getCallerAuth(client);
      try {
        const callerRole = auth.masRole;
        if (!callerRole) {
          respond(false, undefined, errorShape("AUTH_REQUIRED", "Authentication required"));
          return;
        }
        tenantService.approveUser(str(params["targetUserId"]), callerRole);
        respond(true, { ok: true }, undefined);
      } catch (err) {
        const e =
          err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
        respond(false, undefined, errorShape(e.code, e.message));
      }
    },

    "user.reject": async ({ params, client, respond }) => {
      const auth = getCallerAuth(client);
      try {
        const callerRole = auth.masRole;
        if (!callerRole) {
          respond(false, undefined, errorShape("AUTH_REQUIRED", "Authentication required"));
          return;
        }
        tenantService.rejectUser(str(params["targetUserId"]), callerRole);
        respond(true, { ok: true }, undefined);
      } catch (err) {
        const e =
          err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
        respond(false, undefined, errorShape(e.code, e.message));
      }
    },

    "auth.login": async ({ params, client, respond }) => {
      try {
        const c = client as {
          remoteAddress?: string;
          socket?: { _socket?: { remoteAddress?: string } };
          _socket?: { remoteAddress?: string };
        };
        const clientIp =
          c?.remoteAddress || c?.socket?._socket?.remoteAddress || c?._socket?.remoteAddress;

        const loginParams = params as Parameters<TenantService["login"]>[0];
        if (clientIp) {
          loginParams.clientIp = clientIp;
        }

        const result = tenantService.login(loginParams);
        if (result.ok) {
          respond(true, result, undefined);
        } else {
          respond(false, undefined, errorShape(result.error, result.error));
        }
      } catch (err) {
        const e =
          err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
        respond(false, undefined, errorShape(e.code, e.message));
      }
    },

    "auth.refresh": async ({ params, respond }) => {
      try {
        const token = str(params["token"]);
        const result = tenantService.refresh(token);
        if (result.ok) {
          respond(true, result, undefined);
        } else {
          respond(false, undefined, errorShape(result.error, result.error));
        }
      } catch (err) {
        const e =
          err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
        respond(false, undefined, errorShape(e.code, e.message));
      }
    },

    "auth.verify": async ({ params, respond }) => {
      try {
        const token = str(params["token"]);
        const result = tenantService.verify(token);
        if (result.ok) {
          respond(true, result, undefined);
        } else {
          respond(false, undefined, errorShape(result.error, result.error));
        }
      } catch (err) {
        const e =
          err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
        respond(false, undefined, errorShape(e.code, e.message));
      }
    },

    "session.invite": async ({ params, client, respond }) => {
      const auth = getCallerAuth(client);
      try {
        const callerUserId = auth.userId;
        if (!callerUserId) {
          respond(false, undefined, errorShape("AUTH_REQUIRED", "Authentication required"));
          return;
        }
        const result = bridge.inviteToSession({
          sessionKey: str(params["sessionKey"]),
          targetUserId: str(params["targetUserId"]),
          callerUserId,
        });
        if (result.ok) {
          respond(true, result, undefined);
        } else {
          respond(false, undefined, errorShape(result.code, result.message));
        }
      } catch (err) {
        const e =
          err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
        respond(false, undefined, errorShape(e.code, e.message));
      }
    },

    "session.removeMember": async ({ params, client, respond }) => {
      const auth = getCallerAuth(client);
      try {
        const callerUserId = auth.userId;
        if (!callerUserId) {
          respond(false, undefined, errorShape("AUTH_REQUIRED", "Authentication required"));
          return;
        }
        const result = bridge.removeMember({
          sessionKey: str(params["sessionKey"]),
          targetUserId: str(params["targetUserId"]),
          callerUserId,
        });
        if (result.ok) {
          respond(true, result, undefined);
        } else {
          respond(false, undefined, errorShape(result.code, result.message));
        }
      } catch (err) {
        const e =
          err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
        respond(false, undefined, errorShape(e.code, e.message));
      }
    },

    "session.members": async ({ params, client, respond }) => {
      const auth = getCallerAuth(client);
      try {
        const callerUserId = auth.userId;
        if (!callerUserId) {
          respond(false, undefined, errorShape("AUTH_REQUIRED", "Authentication required"));
          return;
        }
        const members = bridge.listSessionMembers(str(params["sessionKey"]), callerUserId);
        respond(true, { members }, undefined);
      } catch (err) {
        const e =
          err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
        respond(false, undefined, errorShape(e.code, e.message));
      }
    },

    "session.leave": async ({ params, client, respond }) => {
      const auth = getCallerAuth(client);
      try {
        const callerUserId = auth.userId;
        if (!callerUserId) {
          respond(false, undefined, errorShape("AUTH_REQUIRED", "Authentication required"));
          return;
        }
        const result = bridge.leaveSession(str(params["sessionKey"]), callerUserId);
        if (result.ok) {
          respond(true, result, undefined);
        } else {
          respond(false, undefined, errorShape(result.code, result.message));
        }
      } catch (err) {
        const e =
          err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
        respond(false, undefined, errorShape(e.code, e.message));
      }
    },

    "user.logout": async ({ client, respond }) => {
      const auth = getCallerAuth(client);
      try {
        console.log(`[mas4s:plugin] user.logout userId=${auth.userId ?? "null"}`);
        if (auth.userId) {
          bridge.logout(auth.userId);
        }
        respond(true, { ok: true }, undefined);
      } catch (err) {
        const e =
          err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
        respond(false, undefined, errorShape(e.code, e.message));
      }
    },

    "session.archive": async ({ params, client, respond }) => {
      const auth = getCallerAuth(client);
      try {
        const callerUserId = auth.userId;
        if (!callerUserId) {
          respond(false, undefined, errorShape("AUTH_REQUIRED", "Authentication required"));
          return;
        }
        const sessionKey = str(params["sessionKey"]);
        const fetchHistory = buildFetchHistory(plugin, sessionKey, client);
        const result = await bridge.archiveSession({ sessionKey, callerUserId, fetchHistory });
        if (result.ok) {
          respond(true, result, undefined);
        } else {
          respond(false, undefined, errorShape(result.code, result.message));
        }
      } catch (err) {
        const e =
          err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
        respond(false, undefined, errorShape(e.code, e.message));
      }
    },

    "session.unarchive": async ({ params, client, respond }) => {
      const auth = getCallerAuth(client);
      try {
        const callerUserId = auth.userId;
        if (!callerUserId) {
          respond(false, undefined, errorShape("AUTH_REQUIRED", "Authentication required"));
          return;
        }
        const sessionKey = str(params["sessionKey"]);
        const result = bridge.unarchiveSession({ sessionKey, callerUserId });
        if (result.ok) {
          respond(true, result, undefined);
        } else {
          respond(false, undefined, errorShape(result.code, result.message));
        }
      } catch (err) {
        const e =
          err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
        respond(false, undefined, errorShape(e.code, e.message));
      }
    },

    "session.summary.generate": async ({ params, client, respond }) => {
      const auth = getCallerAuth(client);
      try {
        const callerUserId = auth.userId;
        if (!callerUserId) {
          respond(false, undefined, errorShape("AUTH_REQUIRED", "Authentication required"));
          return;
        }
        const sessionKey = str(params["sessionKey"]);
        const fetchHistory = buildFetchHistory(plugin, sessionKey, client);
        const result = await bridge.generateSummary({ sessionKey, callerUserId, fetchHistory });
        if (result.ok) {
          respond(true, result, undefined);
        } else {
          respond(false, undefined, errorShape(result.code, result.message));
        }
      } catch (err) {
        const e =
          err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
        respond(false, undefined, errorShape(e.code, e.message));
      }
    },

    "session.summary.get": async ({ params, client, respond }) => {
      const auth = getCallerAuth(client);
      try {
        const callerUserId = auth.userId;
        if (!callerUserId) {
          respond(false, undefined, errorShape("AUTH_REQUIRED", "Authentication required"));
          return;
        }
        const sessionKey = str(params["sessionKey"]);
        const result = bridge.getSummary({ sessionKey, callerUserId });
        if (result.ok) {
          respond(true, result, undefined);
        } else {
          respond(false, undefined, errorShape(result.code, result.message));
        }
      } catch (err) {
        const e =
          err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
        respond(false, undefined, errorShape(e.code, e.message));
      }
    },
  };

  const plugin: Mas4sGatewayPlugin = {
    bridge,
    tenantService,
    extraHandlers,
    extractMasTokenFromUrl,
    gatewayDispatch: null,
  };

  return plugin;
}

/**
 * Build a fetchHistory callback that calls the gateway's chat.history method
 * via the integration-layer dispatch function and extracts the messages array.
 */
function buildFetchHistory(
  plugin: Mas4sGatewayPlugin,
  sessionKey: string,
  client: unknown,
): () => Promise<ChatHistoryMessage[]> {
  return async () => {
    if (!plugin.gatewayDispatch) {
      console.warn("[mas4s] gatewayDispatch not set, cannot fetch chat history");
      return [];
    }
    const payload = (await plugin.gatewayDispatch(
      "chat.history",
      { sessionKey, limit: 1000 },
      client,
    )) as { messages?: unknown[] } | undefined;
    return (payload?.messages ?? []) as ChatHistoryMessage[];
  };
}
