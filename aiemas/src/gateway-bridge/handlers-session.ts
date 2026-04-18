import type { DatabaseSync } from "node:sqlite";
import { TenantServiceError } from "../errors.js";
import type { TenantService } from "../index.js";
import type { SessionTranscriptStore } from "../session-history/session-transcript-store.js";
import type { Mas4sGatewayPlugin } from "./aiemas-types.js";
import { strCoerce, errorShape, getCallerAuth, type SimpleHandlers } from "./aiemas-utils.js";
import type { GatewayAuthBridge } from "./bridge.js";
import type { StoredMessageForSummary } from "./summary-llm.js";

export interface SessionHandlersDeps {
  bridge: GatewayAuthBridge;
  tenantService: TenantService;
  db: DatabaseSync;
  messageDb: DatabaseSync;
  transcriptStore: SessionTranscriptStore;
  sessionStore: ReturnType<
    typeof import("../store/aiemas-sessions-store.js").createAiemasSessionsStore
  >;
  /** Lazy reference to the plugin object (set after plugin is constructed). */
  getPlugin: () => Mas4sGatewayPlugin;
}

export function registerSessionHandlers(handlers: SimpleHandlers, deps: SessionHandlersDeps): void {
  const { bridge, tenantService, db, messageDb, transcriptStore, sessionStore, getPlugin } = deps;

  // ── chat.send (placeholder, replaced by mas4s-integration wrapper) ──
  handlers["chat.send"] = async ({ respond }) => {
    respond(true, {}, undefined);
  };

  // ── session.history.range ──
  handlers["session.history.range"] = async ({ params, client, respond }) => {
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

      const { queryHistoryRange } = await import("../session-history/session-history-query.js");

      const resolvedTo = typeof params["to"] === "number" ? params["to"] : Date.now();
      const resolvedFrom =
        typeof params["from"] === "number" ? params["from"] : resolvedTo - 30 * 24 * 60 * 60 * 1000;
      const resolvedSid = typeof params["sessionId"] === "string" ? params["sessionId"] : undefined;
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
  };

  // ── session.invite ──
  handlers["session.invite"] = async ({ params, client, respond }) => {
    const auth = getCallerAuth(client);
    try {
      const callerUserId = auth.userId;
      if (!callerUserId) {
        respond(false, undefined, errorShape("AUTH_REQUIRED", "Authentication required"));
        return;
      }
      const result = bridge.inviteToSession({
        sessionKey: strCoerce(params["sessionKey"]),
        targetUserId: strCoerce(params["targetUserId"]),
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
  };

  // ── session.removeMember ──
  handlers["session.removeMember"] = async ({ params, client, respond }) => {
    const auth = getCallerAuth(client);
    try {
      const callerUserId = auth.userId;
      if (!callerUserId) {
        respond(false, undefined, errorShape("AUTH_REQUIRED", "Authentication required"));
        return;
      }
      const result = bridge.removeMember({
        sessionKey: strCoerce(params["sessionKey"]),
        targetUserId: strCoerce(params["targetUserId"]),
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
  };

  // ── session.members ──
  handlers["session.members"] = async ({ params, client, respond }) => {
    const auth = getCallerAuth(client);
    try {
      const callerUserId = auth.userId;
      if (!callerUserId) {
        respond(false, undefined, errorShape("AUTH_REQUIRED", "Authentication required"));
        return;
      }
      const members = bridge.listSessionMembers(strCoerce(params["sessionKey"]), callerUserId);
      respond(true, { members }, undefined);
    } catch (err) {
      const e =
        err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
      respond(false, undefined, errorShape(e.code, e.message));
    }
  };

  // ── session.leave ──
  handlers["session.leave"] = async ({ params, client, respond }) => {
    const auth = getCallerAuth(client);
    try {
      const callerUserId = auth.userId;
      if (!callerUserId) {
        respond(false, undefined, errorShape("AUTH_REQUIRED", "Authentication required"));
        return;
      }
      const result = bridge.leaveSession(strCoerce(params["sessionKey"]), callerUserId);
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
  };

  // ── session.archive ──
  handlers["session.archive"] = async ({ params, client, respond }) => {
    const auth = getCallerAuth(client);
    try {
      const callerUserId = auth.userId;
      if (!callerUserId) {
        respond(false, undefined, errorShape("AUTH_REQUIRED", "Authentication required"));
        return;
      }
      const sessionKey = strCoerce(params["sessionKey"]);
      const fetchHistory = buildFetchHistory(getPlugin(), sessionKey, client);
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
  };

  // ── session.unarchive ──
  handlers["session.unarchive"] = async ({ params, client, respond }) => {
    const auth = getCallerAuth(client);
    try {
      const callerUserId = auth.userId;
      if (!callerUserId) {
        respond(false, undefined, errorShape("AUTH_REQUIRED", "Authentication required"));
        return;
      }
      const sessionKey = strCoerce(params["sessionKey"]);
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
  };

  // ── session.summary.generate ──
  handlers["session.summary.generate"] = async ({ params, client, respond }) => {
    const auth = getCallerAuth(client);
    try {
      const callerUserId = auth.userId;
      if (!callerUserId) {
        respond(false, undefined, errorShape("AUTH_REQUIRED", "Authentication required"));
        return;
      }
      const sessionKey = strCoerce(params["sessionKey"]);
      const fetchHistory = buildFetchHistory(getPlugin(), sessionKey, client);
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
  };

  // ── session.summary.get ──
  handlers["session.summary.get"] = async ({ params, client, respond }) => {
    const auth = getCallerAuth(client);
    try {
      const callerUserId = auth.userId;
      if (!callerUserId) {
        respond(false, undefined, errorShape("AUTH_REQUIRED", "Authentication required"));
        return;
      }
      const sessionKey = strCoerce(params["sessionKey"]);

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
  };

  // ── session.label.get ──
  handlers["session.label.get"] = async ({ params, client, respond }) => {
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
      const entry = sessionStore.getSessionLabel(sessionKey);
      respond(
        true,
        {
          sessionKey,
          label: entry?.label ?? null,
          updatedAt: entry?.updatedAt ?? null,
        },
        undefined,
      );
    } catch (err) {
      const e =
        err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
      respond(false, undefined, errorShape(e.code, e.message));
    }
  };

  // ── session.label.list ──
  handlers["session.label.list"] = async ({ client, respond }) => {
    const auth = getCallerAuth(client);
    try {
      if (!auth.userId) {
        respond(false, undefined, errorShape("AUTH_REQUIRED", "Authentication required"));
        return;
      }
      const all = sessionStore.listSessionLabels();
      respond(true, { labels: all }, undefined);
    } catch (err) {
      const e =
        err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
      respond(false, undefined, errorShape(e.code, e.message));
    }
  };

  // ── session.run.state ──
  handlers["session.run.state"] = async ({ params, client, respond }) => {
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

      const { extractUuidFromKey } = await import("../utils/session-utils.js");
      const { getRunState } = await import("./run-state-store.js");
      const sessionUuid = extractUuidFromKey(sessionKey);
      const row = getRunState(db, sessionUuid);

      const isChatting = row?.isChatting ?? false;
      const runId = isChatting ? (row?.runId ?? undefined) : undefined;

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
  };

  // ── session.agent.update ──
  handlers["session.agent.update"] = async ({ params, client, respond }) => {
    const auth = getCallerAuth(client);
    try {
      const sessionKey = strCoerce(params["sessionKey"]);
      const agentId = strCoerce(params["agentId"]);
      if (!sessionKey || !agentId) {
        respond(false, undefined, errorShape("INVALID_PARAMS", "sessionKey and agentId required"));
        return;
      }

      const userId = auth.userId;
      if (!userId) {
        respond(false, undefined, errorShape("AUTH_REQUIRED", "Authentication required"));
        return;
      }

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

      sessionStore.upsertSessionLabel(sessionKey, { currentAgentId: agentId });
      respond(true, { ok: true, agentId }, undefined);
    } catch (err) {
      const e =
        err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
      respond(false, undefined, errorShape(e.code, e.message));
    }
  };
}

/**
 * Build a fetchHistory callback that calls the gateway's session.history.range method
 * via the integration-layer dispatch function and extracts the messages array.
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
