import { TenantServiceError } from "../errors.js";
import type { TenantService, TenantServiceConfig } from "../index.js";
import { createTenantService } from "../index.js";
import {
  upsertSessionLabel,
  getSessionLabel,
  listSessionLabels,
  deleteSessionLabel,
} from "../session-history/session-label-store.js";
import { deleteSummary, deleteSessionMessages } from "../session-history/session-summary-store.js";
import { GatewayAuthBridge } from "./bridge.js";
import { getMasAuth, NULL_MAS_AUTH } from "./context.js";
import { extractMasTokenFromUrl } from "./integration.js";
import type { StoredMessageForSummary } from "./summary-llm.js";

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
  /** Session transcript store for capturing messages. */
  transcriptStore: import("../session-history/session-transcript-store.js").SessionTranscriptStore;
  /** Stop the session label lifecycle event subscription. */
  stopLabelSync: () => void;
  /** Persist a minimal SOP snapshot for reconnect recovery. */
  upsertRunState: (
    sessionUuid: string,
    patch: {
      runId?: string;
      sopSnapshot?: import("./run-state-store.js").SOPSnapshot;
      isChatting?: boolean;
    },
  ) => void;
  /** Clear run state for a session (on reset/delete/clear). */
  clearRunState: (sessionUuid: string) => void;
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

  // Reset stale SOP run states from the previous gateway session.
  // When the gateway stops, all running SOP processes are interrupted but the DB
  // retains isChatting=true and "running" step statuses. Clean them up on startup.
  const { resetAllRunStatesOnStartup } = await import("./run-state-store.js");
  const resetCount = resetAllRunStatesOnStartup(db);
  if (resetCount > 0) {
    console.log(`[mas4s] Reset ${resetCount} stale SOP run state(s) from previous gateway session`);
  }

  // Initialize message capture store in a separate DB for performance isolation
  const { initMessageDatabase } = await import("../store/database.js");
  const messageDbPath = config?.dbPath ? config.dbPath.replace(/\.db$/, ".message.db") : undefined;
  const messageDb = initMessageDatabase(messageDbPath);

  const { SessionTranscriptStore } = await import("../session-history/session-transcript-store.js");
  const transcriptStore = new SessionTranscriptStore(messageDb);
  transcriptStore.start();

  const bridge = new GatewayAuthBridge(tenantService, db, config?.llm, transcriptStore);
  // Subscribe to session lifecycle events to persist label/displayName into mas4s.db.
  // This survives session resets because sessionKey is stable across resets.
  const { onSessionLifecycleEvent } =
    await import("../../../src/sessions/session-lifecycle-events.js");
  const stopLabelSync = onSessionLifecycleEvent((event) => {
    try {
      // On session delete, remove the label, all messages, and summary from message DB.
      if (event.reason === "session-delete") {
        const { extractUuidFromKey } = require("../utils/session-utils.js");
        const uuid = extractUuidFromKey(event.sessionKey);
        deleteSessionLabel(db, uuid);
        deleteSummary(messageDb, uuid);
        deleteSessionMessages(messageDb, uuid);
        return;
      }
      const hasLabel = event.label !== undefined;
      const hasDisplayName = event.displayName !== undefined;
      if (!hasLabel && !hasDisplayName) {
        return;
      }
      upsertSessionLabel(db, event.sessionKey, {
        ...(hasLabel ? { label: event.label ?? null } : {}),
        ...(hasDisplayName ? { displayName: event.displayName ?? null } : {}),
      });
    } catch (err) {
      console.error("[mas4s:label-sync] upsertSessionLabel error:", err);
    }
  });

  const extraHandlers: SimpleHandlers = {
    "chat.send": async ({ params: _params, client: _client, respond }) => {
      // Note: This handler is replaced by the mas4s-integration wrapper,
      // which calls recordSenderContext before the core handler.
      // This handler is kept for reference but is not actually invoked.
      respond(true, {}, undefined);
    },

    "session.history.range": async ({ params, client, respond }) => {
      const auth = getCallerAuth(client);
      try {
        const sessionKey = str(params["sessionKey"]);
        if (!sessionKey) {
          respond(false, undefined, errorShape("INVALID_PARAMS", "sessionKey required"));
          return;
        }

        // Permission check: verify access when userId is present
        if (auth.userId) {
          const access = bridge.checkSessionAccess(sessionKey, auth);
          if (!access.allowed) {
            respond(false, undefined, errorShape(access.code, access.message));
            return;
          }
        }

        const { queryHistoryRange } = await import("../session-history/session-history-query.js");

        // from/to are optional: when absent the query returns all messages.
        const resolvedFrom = typeof params["from"] === "number" ? params["from"] : undefined;
        const resolvedTo = typeof params["to"] === "number" ? params["to"] : undefined;
        const resolvedSid =
          typeof params["sessionId"] === "string" ? params["sessionId"] : undefined;
        const buffered = transcriptStore.getBuffered(
          sessionKey,
          resolvedFrom,
          resolvedTo,
          resolvedSid,
        );

        const { extractUuidFromKey } = await import("../utils/session-utils.js");
        const sessionUuid = extractUuidFromKey(sessionKey);

        const queryParams = {
          sessionUuid,
          sessionKey,
          sessionId: resolvedSid,
          from: resolvedFrom,
          to: resolvedTo,
          page: typeof params["page"] === "number" ? params["page"] : undefined,
          pageSize: typeof params["pageSize"] === "number" ? params["pageSize"] : undefined,
          bufferedCount: buffered.length,
        };
        console.log("[mas4s:session.history.range] params:", JSON.stringify(queryParams));
        const result = queryHistoryRange(messageDb, {
          sessionUuid,
          sessionKey,
          sessionId: resolvedSid,
          from: resolvedFrom,
          to: resolvedTo,
          page: queryParams.page,
          pageSize: queryParams.pageSize,
          buffered,
          resolveDisplayName: (userId) => tenantService.resolveDisplayName(userId),
        });
        console.log(
          `[mas4s:session.history.range] result: total=${result.total} page=${result.page}/${result.totalPages} messages=${result.messages.length} hasSummary=${result.hasSummary}`,
        );
        respond(true, result, undefined);
      } catch (err) {
        const e =
          err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
        respond(false, undefined, errorShape(e.code, e.message));
      }
    },

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

        // Access check
        const access = bridge.checkSessionAccess(sessionKey, { ...auth, userId: callerUserId });
        if (!access.allowed) {
          respond(false, undefined, errorShape(access.code, access.message));
          return;
        }

        const { extractUuidFromKey } = await import("../utils/session-utils.js");
        const uuid = extractUuidFromKey(sessionKey);

        const { getSummary } = await import("../session-history/session-summary-store.js");
        const summary = getSummary(messageDb, uuid);
        respond(true, { summary }, undefined);
      } catch (err) {
        const e =
          err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
        respond(false, undefined, errorShape(e.code, e.message));
      }
    },

    "session.label.get": async ({ params, client, respond }) => {
      const auth = getCallerAuth(client);
      try {
        const sessionKey = str(params["sessionKey"]);
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
        const entry = getSessionLabel(db, sessionKey);
        respond(
          true,
          {
            sessionKey,
            label: entry?.label ?? null,
            displayName: entry?.displayName ?? null,
            updatedAt: entry?.updatedAt ?? null,
          },
          undefined,
        );
      } catch (err) {
        const e =
          err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
        respond(false, undefined, errorShape(e.code, e.message));
      }
    },

    "session.label.list": async ({ client, respond }) => {
      const auth = getCallerAuth(client);
      try {
        if (!auth.userId) {
          respond(false, undefined, errorShape("AUTH_REQUIRED", "Authentication required"));
          return;
        }
        const all = listSessionLabels(db);
        respond(true, { labels: all }, undefined);
      } catch (err) {
        const e =
          err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
        respond(false, undefined, errorShape(e.code, e.message));
      }
    },

    "session.run.state": async ({ params, client, respond }) => {
      const auth = getCallerAuth(client);
      try {
        const sessionKey = str(params["sessionKey"]);
        if (!sessionKey) {
          respond(false, undefined, errorShape("INVALID_PARAMS", "sessionKey required"));
          return;
        }
        // Permission check: verify access when userId is present (compat mode skips)
        if (auth.userId) {
          const access = bridge.checkSessionAccess(sessionKey, auth);
          if (!access.allowed) {
            respond(false, undefined, errorShape(access.code, access.message));
            return;
          }
        }

        const { extractUuidFromKey } = await import("../utils/session-utils.js");
        const { getRunState } = await import("./run-state-store.js");
        const sessionUuid = extractUuidFromKey(sessionKey);
        const row = getRunState(db, sessionUuid);

        const isChatting = row?.isChatting ?? false;
        const runId = isChatting ? (row?.runId ?? undefined) : undefined;

        // Return the minimal snapshot; mas4s-integration.ts wraps this handler
        // to enrich stepStatuses with label/icon from live SOPTracker memory.
        respond(
          true,
          {
            sessionKey,
            isChatting,
            runId,
            sopSnapshot: row?.sopSnapshot ?? null,
          },
          undefined,
        );
      } catch (err) {
        const e =
          err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
        respond(false, undefined, errorShape(e.code, e.message));
      }
    },

    "session.agent.update": async ({ params, client, respond }) => {
      const auth = getCallerAuth(client);
      try {
        const sessionKey = str(params["sessionKey"]);
        const agentId = str(params["agentId"]);
        if (!sessionKey || !agentId) {
          respond(
            false,
            undefined,
            errorShape("INVALID_PARAMS", "sessionKey and agentId required"),
          );
          return;
        }

        const userId = auth.userId;
        if (!userId) {
          respond(false, undefined, errorShape("AUTH_REQUIRED", "Authentication required"));
          return;
        }

        // Permission check: only owner can change agent
        const { extractUuidFromKey } = await import("../utils/session-utils.js");
        const uuid = extractUuidFromKey(sessionKey);
        const role = bridge.getSessionRole(uuid, userId);
        if (role !== "owner") {
          respond(
            false,
            undefined,
            errorShape("SESSION_ACCESS_DENIED", "Only the session owner can change the agent"),
          );
          return;
        }

        upsertSessionLabel(db, sessionKey, { currentAgentId: agentId });
        respond(true, { ok: true, agentId }, undefined);
      } catch (err) {
        const e =
          err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
        respond(false, undefined, errorShape(e.code, e.message));
      }
    },
  };

  const { upsertRunState: _upsertRunState, clearRunState: _clearRunState } =
    await import("./run-state-store.js");

  const plugin: Mas4sGatewayPlugin = {
    bridge,
    tenantService,
    extraHandlers,
    extractMasTokenFromUrl,
    gatewayDispatch: null,
    transcriptStore,
    stopLabelSync,
    upsertRunState: (sessionUuid, patch) => _upsertRunState(db, sessionUuid, patch),
    clearRunState: (sessionUuid) => _clearRunState(db, sessionUuid),
  };

  return plugin;
}

/**
 * Build a fetchHistory callback that calls the gateway's session.history.range method
 * via the integration-layer dispatch function and extracts the messages array.
 * Fetches the latest 1000 messages for summary generation.
 */
function buildFetchHistory(
  plugin: Mas4sGatewayPlugin,
  sessionKey: string,
  client: unknown,
): () => Promise<StoredMessageForSummary[]> {
  return async () => {
    if (!plugin.gatewayDispatch) {
      console.warn("[mas4s] gatewayDispatch not set, cannot fetch chat history");
      return [];
    }
    const payload = (await plugin.gatewayDispatch(
      "session.history.range",
      { sessionKey, pageSize: 1000, page: 1 },
      client,
    )) as { messages?: StoredMessageForSummary[] } | undefined;
    return payload?.messages ?? [];
  };
}
