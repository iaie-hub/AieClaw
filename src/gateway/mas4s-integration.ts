/**
 * Opt-in integration point for the mas4s multi-tenant RBAC plugin.
 *
 * This module lazily loads the mas4s gateway plugin and adapts its
 * handlers/hooks to the gateway's type system. The gateway core has
 * zero hard dependencies on aiemas — if the plugin fails to load,
 * the gateway continues without multi-tenant features.
 */

import type { createSubsystemLogger } from "../logging/subsystem.js";
import { ADMIN_SCOPE, READ_SCOPE, WRITE_SCOPE } from "./method-scopes.js";
import { sessionsHandlers } from "./server-methods/sessions.js";
import type { GatewayRequestHandler, GatewayRequestHandlers } from "./server-methods/types.js";
import type { GatewayWsClient } from "./server/ws-types.js";

type SubsystemLogger = ReturnType<typeof createSubsystemLogger>;

export interface Mas4sIntegration {
  extraHandlers: GatewayRequestHandlers;
  onClientConnected: (client: GatewayWsClient, upgradeReq: { url?: string }) => void;
  onSessionCreated: (sessionKey: string, label: string, client: GatewayWsClient) => void;
  /**
   * Pre-request interceptor: check RBAC + session access before dispatching.
   * Returns null to allow, or an error shape to reject.
   */
  interceptRequest: (
    method: string,
    params: Record<string, unknown>,
    client: GatewayWsClient | null,
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
  filterSessionsList: (sessions: unknown[], client: GatewayWsClient | null) => unknown[];
  /**
   * Called when a WS client disconnects. Marks the user offline if authenticated.
   */
  onClientDisconnected: (client: GatewayWsClient) => void;
}

const NOOP_INTEGRATION: Mas4sIntegration = {
  extraHandlers: {},
  onClientConnected: () => {},
  onClientDisconnected: () => {},
  onSessionCreated: () => {},
  interceptRequest: () => ({ allowed: true }),
  filterBroadcast: () => null,
  filterSessionsList: (sessions) => sessions,
};

/**
 * Attempt to initialize the mas4s plugin. Returns a noop integration
 * on failure so the gateway can start without it.
 */
export async function initMas4sIntegration(log: SubsystemLogger): Promise<Mas4sIntegration> {
  try {
    const { createMas4sGatewayPlugin } =
      await import("../../aiemas/src/gateway-bridge/mas4s-gateway-plugin.js");
    const contextMod = await import("../../aiemas/src/gateway-bridge/context.js");
    const integrationMod = await import("../../aiemas/src/gateway-bridge/integration.js");

    const plugin = await createMas4sGatewayPlugin();
    log.info("mas4s multi-tenant plugin loaded");

    // Helper: send an event frame to a specific WS client by connId
    const sendToConnId = (
      connId: string,
      clients: Set<GatewayWsClient>,
      event: string,
      data: unknown,
    ) => {
      for (const c of clients) {
        if (c.connId === connId) {
          try {
            c.socket.send(JSON.stringify({ type: "event", event, payload: data }));
          } catch {
            /* ignore */
          }
          break;
        }
      }
    };

    // Shared reference to the live clients set — updated by _setActiveClients.
    // Declared early so onClientDisconnected and auth.login wrapper can close over it.
    let activeClients: Set<GatewayWsClient> = new Set();
    const setActiveClients = (c: Set<GatewayWsClient>) => {
      activeClients = c;
    };

    // Helper: build connId → MasAuthContext map from current activeClients
    const buildConnectedUsers = () => {
      const map = new Map<
        string,
        import("../../aiemas/src/gateway-bridge/context.js").MasAuthContext
      >();
      for (const c of activeClients) {
        const auth = contextMod.getMasAuth(c);
        if (auth) {
          map.set(c.connId, auth);
        }
      }
      return map;
    };

    // Adapt SimpleHandler → GatewayRequestHandler
    const extraHandlers: GatewayRequestHandlers = {};
    for (const [method, handler] of Object.entries(plugin.extraHandlers)) {
      const adapted: GatewayRequestHandler = async (opts) => {
        // Bridge respond signature: SimpleHandler uses (ok, payload, error: unknown)
        // while GatewayRequestHandler uses RespondFn (ok, payload?, error?: ErrorShape)
        const respond = (ok: boolean, payload: unknown, error: unknown) => {
          opts.respond(ok, payload ?? undefined, error as Parameters<typeof opts.respond>[2]);
        };
        await handler({ params: opts.params, client: opts.client, respond });
      };
      extraHandlers[method] = adapted;
    }

    const onClientConnected: Mas4sIntegration["onClientConnected"] = (client, upgradeReq) => {
      try {
        const masToken = integrationMod.extractMasTokenFromUrl(
          upgradeReq as import("node:http").IncomingMessage,
        );
        const masAuth = plugin.bridge.authenticateConnect({ masToken });
        contextMod.setMasAuth(client, masAuth);

        // Inject displayName into client.connect.client so chat.send can populate SenderName.
        // This mirrors how channel integrations (e.g. Feishu) pass sender identity via MsgContext.
        if (masAuth.displayName && client.connect?.client) {
          client.connect.client.displayName = masAuth.displayName;
        }

        // Grant gateway scopes to authenticated MAS users so they can pass core authorization.
        // User-level filtering is still performed by mas4s interceptRequest (RBAC).
        if (masAuth.userId && client.connect) {
          const scopes = client.connect.scopes ?? [];
          if (masAuth.masRole === "admin") {
            if (!scopes.includes(ADMIN_SCOPE)) {
              scopes.push(ADMIN_SCOPE);
            }
          } else {
            if (!scopes.includes(READ_SCOPE)) {
              scopes.push(READ_SCOPE);
            }
            if (!scopes.includes(WRITE_SCOPE)) {
              scopes.push(WRITE_SCOPE);
            }
          }
          client.connect.scopes = scopes;
        }
      } catch (err) {
        log.warn(`mas4s auth failed for conn=${client.connId}: ${String(err)}`);
        contextMod.setMasAuth(client, contextMod.NULL_MAS_AUTH);

        const urlParams = new URL(
          (upgradeReq as import("node:http").IncomingMessage).url ?? "/",
          "http://localhost",
        ).searchParams;
        if (urlParams.has("masToken")) {
          client.socket.close(4008, "MAS_AUTH_FAILED");
        }
      }
    };

    const onSessionCreated: Mas4sIntegration["onSessionCreated"] = (sessionKey, label, client) => {
      try {
        const masAuth = contextMod.getMasAuth(client) ?? contextMod.NULL_MAS_AUTH;
        plugin.bridge.onSessionCreated(sessionKey, label, masAuth);
      } catch (err) {
        log.warn(`mas4s onSessionCreated failed for session=${sessionKey}: ${String(err)}`);
      }
    };

    const interceptRequest: Mas4sIntegration["interceptRequest"] = (method, params, client) => {
      try {
        const masAuth = client
          ? (contextMod.getMasAuth(client) ?? contextMod.NULL_MAS_AUTH)
          : contextMod.NULL_MAS_AUTH;
        return plugin.bridge.interceptMethod(method, params, masAuth);
      } catch (err) {
        log.warn(`mas4s interceptRequest failed for method=${method}: ${String(err)}`);
        return { allowed: true };
      }
    };

    const filterBroadcast: Mas4sIntegration["filterBroadcast"] = (event, payload, clients) => {
      try {
        // Build connectedUsers map: connId → MasAuthContext
        const connectedUsers = new Map<
          string,
          import("../../aiemas/src/gateway-bridge/context.js").MasAuthContext
        >();
        for (const c of clients) {
          const auth = contextMod.getMasAuth(c);
          if (auth) {
            connectedUsers.set(c.connId, auth);
          }
        }
        if (connectedUsers.size === 0) {
          return null;
        }

        const targetUserIds = plugin.bridge.filterBroadcastTargets(event, payload, connectedUsers);
        if (targetUserIds === null) {
          return null;
        }

        // Map userId set → connId set
        const connIds = new Set<string>();
        for (const [connId, auth] of connectedUsers.entries()) {
          if (auth.userId !== null && targetUserIds.has(auth.userId)) {
            connIds.add(connId);
          }
        }
        return connIds;
      } catch (err) {
        log.warn(`mas4s filterBroadcast failed for event=${event}: ${String(err)}`);
        return null;
      }
    };

    const filterSessionsList: Mas4sIntegration["filterSessionsList"] = (sessions, client) => {
      try {
        const masAuth = client
          ? (contextMod.getMasAuth(client) ?? contextMod.NULL_MAS_AUTH)
          : contextMod.NULL_MAS_AUTH;
        return plugin.bridge.filterSessionsForUser(sessions, masAuth);
      } catch (err) {
        log.warn(`mas4s filterSessionsList failed: ${String(err)}`);
        return sessions;
      }
    };

    const onClientDisconnected: Mas4sIntegration["onClientDisconnected"] = (client) => {
      try {
        const masAuth = contextMod.getMasAuth(client) ?? contextMod.NULL_MAS_AUTH;
        log.info(
          `mas4s onClientDisconnected conn=${client.connId} userId=${masAuth.userId ?? "null"}`,
        );
        if (masAuth.userId) {
          plugin.bridge.logout(masAuth.userId);
          // Broadcast offline status to same-tenant peers
          if (masAuth.tenantId) {
            plugin.bridge.pushUserPresence(
              masAuth.userId,
              masAuth.tenantId,
              false,
              buildConnectedUsers(),
              (connId, event, data) => sendToConnId(connId, activeClients, event, data),
            );
          }
        }
      } catch (err) {
        log.warn(`mas4s onClientDisconnected failed for conn=${client.connId}: ${String(err)}`);
      }
    };

    // Wrap session.invite and session.removeMember to push real-time notifications.
    const origInvite = extraHandlers["session.invite"];
    if (origInvite) {
      extraHandlers["session.invite"] = async (opts) => {
        const targetUserId =
          typeof opts.params["targetUserId"] === "string" ? opts.params["targetUserId"] : "";
        const sessionKey =
          typeof opts.params["sessionKey"] === "string" ? opts.params["sessionKey"] : "";
        let inviteOk = false;
        let invitePayload: unknown;

        await origInvite({
          ...opts,
          respond: (ok, payload, error, meta) => {
            inviteOk = ok;
            invitePayload = payload;
            opts.respond(ok, payload, error, meta);
          },
        });

        if (inviteOk && targetUserId && sessionKey) {
          try {
            const connectedUsers = buildConnectedUsers();
            const callerAuth = opts.client
              ? (contextMod.getMasAuth(opts.client) ?? contextMod.NULL_MAS_AUTH)
              : contextMod.NULL_MAS_AUTH;
            const member =
              invitePayload && typeof invitePayload === "object"
                ? ((invitePayload as Record<string, unknown>)["member"] as
                    | Record<string, unknown>
                    | undefined)
                : undefined;
            plugin.bridge.pushSessionJoined(
              targetUserId,
              {
                sessionKey,
                label: String((opts.params["label"] as string | undefined) ?? sessionKey),
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

    const origRemoveMember = extraHandlers["session.removeMember"];
    if (origRemoveMember) {
      extraHandlers["session.removeMember"] = async (opts) => {
        const targetUserId =
          typeof opts.params["targetUserId"] === "string" ? opts.params["targetUserId"] : "";
        const sessionKey =
          typeof opts.params["sessionKey"] === "string" ? opts.params["sessionKey"] : "";
        let removeOk = false;

        await origRemoveMember({
          ...opts,
          respond: (ok, payload, error, meta) => {
            removeOk = ok;
            opts.respond(ok, payload, error, meta);
          },
        });

        if (removeOk && targetUserId && sessionKey) {
          try {
            const connectedUsers = buildConnectedUsers();
            const callerAuth = opts.client
              ? (contextMod.getMasAuth(opts.client) ?? contextMod.NULL_MAS_AUTH)
              : contextMod.NULL_MAS_AUTH;
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

    // Wrap auth.login to broadcast user.presence online after successful login.
    // Note: onClientConnected fires before login (masToken not yet in URL at WS upgrade),
    // so we must broadcast here when we know the userId and tenantId from the login result.
    const origAuthLogin = extraHandlers["auth.login"];
    if (origAuthLogin) {
      extraHandlers["auth.login"] = async (opts) => {
        let loginOk = false;
        let loginUserId: string | undefined;
        let loginTenantId: string | undefined;

        await origAuthLogin({
          ...opts,
          respond: (ok, payload, error, meta) => {
            loginOk = ok;
            if (ok && payload && typeof payload === "object") {
              const p = payload as Record<string, unknown>;
              // login response shape: { ok, token, user: { userId, tenantId, ... } }
              const user = p["user"] as Record<string, unknown> | undefined;
              loginUserId = typeof user?.["userId"] === "string" ? user["userId"] : undefined;
              loginTenantId = typeof user?.["tenantId"] === "string" ? user["tenantId"] : undefined;
            }
            opts.respond(ok, payload, error, meta);
          },
        });

        if (loginOk && loginUserId && loginTenantId) {
          try {
            plugin.bridge.pushUserPresence(
              loginUserId,
              loginTenantId,
              true,
              buildConnectedUsers(),
              (connId, event, data) => sendToConnId(connId, activeClients, event, data),
            );
          } catch (err) {
            log.warn(`mas4s pushUserPresence (login) failed: ${String(err)}`);
          }
        }
      };
    }

    // Wrap user.logout to broadcast user.presence offline before the user disconnects.
    const origUserLogout = extraHandlers["user.logout"];
    if (origUserLogout) {
      extraHandlers["user.logout"] = async (opts) => {
        const masAuth = opts.client
          ? (contextMod.getMasAuth(opts.client) ?? contextMod.NULL_MAS_AUTH)
          : contextMod.NULL_MAS_AUTH;
        const logoutUserId = masAuth.userId;
        const logoutTenantId = masAuth.tenantId;

        await origUserLogout(opts);

        if (logoutUserId && logoutTenantId) {
          try {
            plugin.bridge.pushUserPresence(
              logoutUserId,
              logoutTenantId,
              false,
              buildConnectedUsers(),
              (connId, event, data) => sendToConnId(connId, activeClients, event, data),
            );
          } catch (err) {
            log.warn(`mas4s pushUserPresence (logout) failed: ${String(err)}`);
          }
        }
      };
    }

    // Wrap sessions.resolve to enforce membership check after key resolution.
    // sessions.resolve params can carry sessionId/label/spawnedBy instead of key,
    // so _extractSessionKey returns undefined and the pre-request interceptor cannot
    // check membership before the handler runs. We override it as an extraHandler
    // (which takes priority over coreGatewayHandlers) and validate the resolved key
    // against session_memberships before returning it to the caller.
    const coreSessionsResolve = sessionsHandlers["sessions.resolve"];
    if (coreSessionsResolve) {
      extraHandlers["sessions.resolve"] = async (opts) => {
        const masAuth = opts.client
          ? (contextMod.getMasAuth(opts.client) ?? contextMod.NULL_MAS_AUTH)
          : contextMod.NULL_MAS_AUTH;

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
          respond: (ok, payload, error, meta) => {
            if (ok && payload && typeof payload === "object") {
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

    return {
      extraHandlers,
      onClientConnected,
      onClientDisconnected,
      onSessionCreated,
      interceptRequest,
      filterBroadcast,
      filterSessionsList,
      /** Internal: allows server.impl.ts to keep the clients reference up to date */
      _setActiveClients: setActiveClients,
    } as Mas4sIntegration & { _setActiveClients: (c: Set<GatewayWsClient>) => void };
  } catch (err) {
    log.info(`mas4s plugin not available, skipping: ${String(err)}`);
    return NOOP_INTEGRATION;
  }
}
