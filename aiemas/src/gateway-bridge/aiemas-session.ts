import { str, sendToConnId, buildConnectedUsers, type GatewayClient } from "./aiemas-utils.js";
import { MasAuthContext, NULL_MAS_AUTH } from "./context.js";
import type { Mas4sGatewayPlugin } from "./mas4s-gateway-plugin.js";

export interface SessionContext {
  plugin: Mas4sGatewayPlugin;
  getMasAuth: (client: GatewayClient) => MasAuthContext | null;
  getActiveClients: () => Set<GatewayClient>;
  loadSessionRow: (sessionKey: string) => Record<string, unknown> | null;
  extractUuid: (sessionKey: string) => string;
  log: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
}

export function registerSessionHandlers(
  extraHandlers: Record<string, unknown>,
  sessionsHandlers: Record<string, unknown>,
  ctx: SessionContext,
) {
  const { plugin, getMasAuth, getActiveClients, loadSessionRow, extractUuid, log } = ctx;

  // ── session.invite ──
  const origInvite = extraHandlers["session.invite"] as
    | ((opts: unknown) => Promise<void>)
    | undefined;
  if (origInvite) {
    extraHandlers["session.invite"] = async (opts: {
      params: Record<string, unknown>;
      client: GatewayClient;
      respond: (ok: boolean, payload?: unknown, error?: unknown, meta?: unknown) => void;
    }) => {
      const targetUserId = str(opts.params["targetUserId"]);
      const sessionKey = str(opts.params["sessionKey"]);
      let inviteOk = false;
      let invitePayload: Record<string, unknown> | undefined;

      await origInvite({
        ...opts,
        respond: (ok: boolean, payload: unknown, error: unknown, meta: unknown) => {
          inviteOk = ok;
          if (ok && typeof payload === "object" && payload !== null) {
            invitePayload = payload as Record<string, unknown>;
          }
          opts.respond(ok, payload, error, meta);
        },
      });

      if (inviteOk && targetUserId && sessionKey) {
        try {
          const activeClients = getActiveClients();
          const connectedUsers = buildConnectedUsers(activeClients, getMasAuth);
          const callerAuth = getMasAuth(opts.client) ?? NULL_MAS_AUTH;
          const member = invitePayload?.["member"] as Record<string, unknown> | undefined;

          const sessionRow = loadSessionRow(sessionKey);
          const sessionLabel =
            str(sessionRow?.["displayName"] ?? sessionRow?.["label"] ?? sessionKey) ?? sessionKey;

          plugin.bridge.pushSessionJoined(
            targetUserId,
            {
              sessionKey,
              label: sessionLabel,
              invitedBy: callerAuth.userId ?? "",
              joinedAt: member ? Number(member["joinedAt"] ?? Date.now()) : Date.now(),
            },
            connectedUsers,
            (connId, event, data) => sendToConnId(connId, activeClients, event, data),
          );
        } catch (err) {
          log.warn(`mas4s pushSessionJoined failed: ${String(err)}`);
        }
      }
    };
  }

  // ── session.removeMember ──
  const origRemoveMember = extraHandlers["session.removeMember"] as
    | ((opts: unknown) => Promise<void>)
    | undefined;
  if (origRemoveMember) {
    extraHandlers["session.removeMember"] = async (opts: {
      params: Record<string, unknown>;
      client: GatewayClient;
      respond: (ok: boolean, payload?: unknown, error?: unknown, meta?: unknown) => void;
    }) => {
      const targetUserId = str(opts.params["targetUserId"]);
      const sessionKey = str(opts.params["sessionKey"]);
      let removeOk = false;

      await origRemoveMember({
        ...opts,
        respond: (ok: boolean, payload: unknown, error: unknown, meta: unknown) => {
          removeOk = ok;
          opts.respond(ok, payload, error, meta);
        },
      });

      if (removeOk && targetUserId && sessionKey) {
        try {
          const activeClients = getActiveClients();
          const connectedUsers = buildConnectedUsers(activeClients, getMasAuth);
          const callerAuth = getMasAuth(opts.client) ?? NULL_MAS_AUTH;
          plugin.bridge.pushSessionRemoved(
            targetUserId,
            { sessionKey, removedBy: callerAuth.userId ?? "" },
            connectedUsers,
            (connId, event, data) => sendToConnId(connId, activeClients, event, data),
          );
        } catch (err) {
          log.warn(`mas4s pushSessionRemoved failed: ${String(err)}`);
        }
      }
    };
  }

  // ── session.archive ──
  const origArchive = extraHandlers["session.archive"] as
    | ((opts: unknown) => Promise<void>)
    | undefined;
  if (origArchive) {
    extraHandlers["session.archive"] = async (opts: {
      params: Record<string, unknown>;
      client: GatewayClient;
      respond: (ok: boolean, payload?: unknown, error?: unknown, meta?: unknown) => void;
    }) => {
      const sessionKey = str(opts.params["sessionKey"]);
      let archiveOk = false;
      let archivePayload: Record<string, unknown> | undefined;

      await origArchive({
        ...opts,
        respond: (ok: boolean, payload: unknown, error: unknown, meta: unknown) => {
          archiveOk = ok;
          if (ok && typeof payload === "object" && payload !== null) {
            archivePayload = payload as Record<string, unknown>;
          }
          opts.respond(ok, payload, error, meta);
        },
      });

      if (archiveOk && sessionKey && archivePayload) {
        try {
          const activeClients = getActiveClients();
          const connectedUsers = buildConnectedUsers(activeClients, getMasAuth);
          const callerAuth = getMasAuth(opts.client) ?? NULL_MAS_AUTH;
          plugin.bridge.pushSessionArchived(
            sessionKey,
            {
              sessionKey,
              archivedAt: Number(archivePayload["archivedAt"] ?? Date.now()),
              archivedBy: callerAuth.userId ?? "",
            },
            connectedUsers,
            (connId, event, data) => sendToConnId(connId, activeClients, event, data),
          );
        } catch (err) {
          log.warn(`mas4s pushSessionArchived failed: ${String(err)}`);
        }
      }
    };
  }

  // ── session.unarchive ──
  const origUnarchive = extraHandlers["session.unarchive"] as
    | ((opts: unknown) => Promise<void>)
    | undefined;
  if (origUnarchive) {
    extraHandlers["session.unarchive"] = async (opts: {
      params: Record<string, unknown>;
      client: GatewayClient;
      respond: (ok: boolean, payload?: unknown, error?: unknown, meta?: unknown) => void;
    }) => {
      const sessionKey = str(opts.params["sessionKey"]);
      let unarchiveOk = false;

      await origUnarchive({
        ...opts,
        respond: (ok: boolean, payload: unknown, error: unknown, meta: unknown) => {
          unarchiveOk = ok;
          opts.respond(ok, payload, error, meta);
        },
      });

      if (unarchiveOk && sessionKey) {
        try {
          const activeClients = getActiveClients();
          const connectedUsers = buildConnectedUsers(activeClients, getMasAuth);
          const callerAuth = getMasAuth(opts.client) ?? NULL_MAS_AUTH;
          plugin.bridge.pushSessionUnarchived(
            sessionKey,
            { sessionKey, unarchivedBy: callerAuth.userId ?? "" },
            connectedUsers,
            (connId, event, data) => sendToConnId(connId, activeClients, event, data),
          );
        } catch (err) {
          log.warn(`mas4s pushSessionUnarchived failed: ${String(err)}`);
        }
      }
    };
  }

  // ── session.summary.generate ──
  const origSummaryGenerate = extraHandlers["session.summary.generate"] as
    | ((opts: unknown) => Promise<void>)
    | undefined;
  if (origSummaryGenerate) {
    extraHandlers["session.summary.generate"] = async (opts: {
      params: Record<string, unknown>;
      client: GatewayClient;
      respond: (ok: boolean, payload?: unknown, error?: unknown, meta?: unknown) => void;
    }) => {
      const sessionKey = str(opts.params["sessionKey"]);
      let generateOk = false;
      let generatePayload: Record<string, unknown> | undefined;

      await origSummaryGenerate({
        ...opts,
        respond: (ok: boolean, payload: unknown, error: unknown, meta: unknown) => {
          generateOk = ok;
          if (ok && typeof payload === "object" && payload !== null) {
            generatePayload = payload as Record<string, unknown>;
          }
          opts.respond(ok, payload, error, meta);
        },
      });

      if (generateOk && sessionKey && generatePayload?.["persisted"] === true) {
        try {
          const activeClients = getActiveClients();
          const connectedUsers = buildConnectedUsers(activeClients, getMasAuth);
          plugin.bridge.pushSummaryUpdated(
            sessionKey,
            {
              sessionKey,
              generatedAt: Number(generatePayload["generatedAt"] ?? Date.now()),
            },
            connectedUsers,
            (connId: string, event: string, data: unknown) =>
              sendToConnId(connId, activeClients, event, data),
          );
        } catch (err) {
          log.warn(`mas4s pushSummaryUpdated failed: ${String(err)}`);
        }
      }
    };
  }

  // ── sessions.delete ──
  const coreSessionsDelete = sessionsHandlers["sessions.delete"] as
    | ((opts: unknown) => Promise<void>)
    | undefined;
  if (coreSessionsDelete) {
    extraHandlers["sessions.delete"] = async (opts: {
      params: Record<string, unknown>;
      client: GatewayClient;
      respond: (ok: boolean, payload?: unknown, error?: unknown, meta?: unknown) => void;
    }) => {
      const sessionKey = str(opts.params["key"]);
      let deleteOk = false;

      await coreSessionsDelete({
        ...opts,
        respond: (ok: boolean, payload: unknown, error: unknown, meta: unknown) => {
          deleteOk = ok;
          opts.respond(ok, payload, error, meta);
        },
      });

      if (deleteOk && sessionKey) {
        try {
          plugin.bridge.onSessionDeleted(sessionKey);
        } catch (err) {
          log.warn(`mas4s onSessionDeleted failed for session=${sessionKey}: ${String(err)}`);
        }
        try {
          const uuid = extractUuid(sessionKey);
          plugin.clearRunState(uuid);
        } catch (err) {
          log.warn(`mas4s clearRunState (delete) failed for session=${sessionKey}: ${String(err)}`);
        }
      }
    };
  }

  // ── sessions.resolve ──
  const coreSessionsResolve = sessionsHandlers["sessions.resolve"] as
    | ((opts: unknown) => Promise<void>)
    | undefined;
  if (coreSessionsResolve) {
    extraHandlers["sessions.resolve"] = async (opts: {
      params: Record<string, unknown>;
      client: GatewayClient;
      respond: (ok: boolean, payload?: unknown, error?: unknown, meta?: unknown) => void;
    }) => {
      const masAuth = getMasAuth(opts.client) ?? NULL_MAS_AUTH;

      // Compat mode: no userId, skip membership check
      if (masAuth.userId === null) {
        await coreSessionsResolve(opts);
        return;
      }

      let resolvedKey: string | undefined;
      let resolveOk = false;

      // Run the core handler, capturing the resolved key from the response
      await coreSessionsResolve({
        ...opts,
        respond: (ok: boolean, payload: unknown, error: unknown, meta: unknown) => {
          if (ok && typeof payload === "object" && payload !== null) {
            const key = (payload as Record<string, unknown>)["key"];
            if (typeof key === "string") {
              resolvedKey = key;
              resolveOk = true;
            }
          }
          if (!ok) {
            // Pass through errors (session not found etc.) unchanged
            opts.respond(ok, payload, error, meta);
          }
        },
      });

      if (!resolveOk || !resolvedKey) {
        // Core handler already responded with an error above
        return;
      }

      // Now check membership for the resolved key
      const accessResult = plugin.bridge.checkSessionAccess(resolvedKey, masAuth);
      if (!accessResult.allowed) {
        opts.respond(false, undefined, {
          code: accessResult.code,
          message: accessResult.message,
        });
        return;
      }

      opts.respond(true, { ok: true, key: resolvedKey }, undefined);
    };
  }

  // ── session.run.state ──
  const origRunState = extraHandlers["session.run.state"] as
    | ((opts: unknown) => Promise<void>)
    | undefined;
  if (origRunState) {
    extraHandlers["session.run.state"] = async (opts: {
      params: Record<string, unknown>;
      client: GatewayClient;
      respond: (ok: boolean, payload?: unknown, error?: unknown, meta?: unknown) => void;
    }) => {
      let runStateOk = false;
      let runStatePayload: Record<string, unknown> | undefined;

      await origRunState({
        ...opts,
        respond: (ok: boolean, payload: unknown, error: unknown, meta: unknown) => {
          runStateOk = ok;
          if (ok && typeof payload === "object" && payload !== null) {
            runStatePayload = payload as Record<string, unknown>;
          }
          // Don't forward yet — we'll re-respond below with enriched data
          if (!ok) {
            opts.respond(ok, payload, error, meta);
          }
        },
      });

      if (!runStateOk || !runStatePayload) {
        return;
      }

      // Enrichment logic is currently in mas4s-integration.ts via SOPTracker.
      // We'll pass the enriched payload back.
      // The actual enrichment will be done in the wrapper calling this.
      opts.respond(true, runStatePayload, undefined);
    };
  }
}

export function onSessionCreated(
  sessionKey: string,
  label: string,
  client: GatewayClient,
  ctx: SessionContext,
) {
  const { plugin, getMasAuth, log } = ctx;
  try {
    const masAuth = getMasAuth(client) ?? NULL_MAS_AUTH;
    plugin.bridge.onSessionCreated(sessionKey, label, masAuth);
  } catch (err) {
    log.warn(`mas4s onSessionCreated failed for session=${sessionKey}: ${String(err)}`);
  }
}

export function filterSessionsList(
  sessions: unknown[],
  client: GatewayClient,
  ctx: SessionContext,
) {
  const { plugin, getMasAuth, log } = ctx;
  try {
    const masAuth = getMasAuth(client) ?? NULL_MAS_AUTH;
    return plugin.bridge.filterSessionsForUser(sessions, masAuth);
  } catch (err) {
    log.warn(`mas4s filterSessionsList failed: ${String(err)}`);
    return sessions;
  }
}
