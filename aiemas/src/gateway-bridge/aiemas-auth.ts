import type { Mas4sGatewayPlugin, GatewayClient, SendToConnIdFn } from "./aiemas-types.js";
import { str, sendToConnId, buildConnectedUsers } from "./aiemas-utils.js";
import { MasAuthContext, NULL_MAS_AUTH, setMasAuth as setMasAuthContext } from "./context.js";

export interface AuthContext {
  plugin: Mas4sGatewayPlugin;
  getMasAuth: (client: GatewayClient) => MasAuthContext | null;
  getActiveClients: () => Set<GatewayClient>;
  log: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
  ADMIN_SCOPE: string;
  READ_SCOPE: string;
  WRITE_SCOPE: string;
  integrationMod: {
    extractMasTokenFromUrl: (req: { url?: string }) => string | undefined;
  };
}

export function registerAuthHandlers(extraHandlers: Record<string, unknown>, ctx: AuthContext) {
  const { plugin, getMasAuth, getActiveClients, log } = ctx;

  // ── auth.login ──
  const coreLogin = extraHandlers["auth.login"] as ((opts: unknown) => Promise<void>) | undefined;
  if (coreLogin) {
    extraHandlers["auth.login"] = async (opts: {
      params: Record<string, unknown>;
      client: GatewayClient;
      respond: (ok: boolean, payload?: unknown, error?: unknown, meta?: unknown) => void;
    }) => {
      let loginOk = false;
      let loginPayload: Record<string, unknown> | undefined;

      await coreLogin({
        ...opts,
        respond: (ok: boolean, payload: unknown, error: unknown, meta: unknown) => {
          loginOk = ok;
          if (ok && typeof payload === "object" && payload !== null) {
            loginPayload = payload as Record<string, unknown>;
          }
          opts.respond(ok, payload, error, meta);
        },
      });

      if (loginOk && loginPayload) {
        try {
          const user = loginPayload["user"] as Record<string, unknown> | undefined;
          const loginUserId = str(user?.["userId"]);
          const loginTenantId = str(user?.["tenantId"]);

          if (loginUserId && loginTenantId) {
            const activeClients = getActiveClients();
            plugin.bridge.pushUserPresence(
              loginUserId,
              loginTenantId,
              true,
              buildConnectedUsers(activeClients, getMasAuth),
              ((connId: string, event: string, data: unknown) =>
                sendToConnId(connId, activeClients, event, data)) as SendToConnIdFn,
            );
          }
        } catch (err) {
          log.warn(`mas4s login bridge resolution failed: ${String(err)}`);
        }
      }
    };
  }

  // ── auth.logout ──
  const coreLogout = extraHandlers["auth.logout"] as ((opts: unknown) => Promise<void>) | undefined;
  if (coreLogout) {
    extraHandlers["auth.logout"] = async (opts: {
      params: Record<string, unknown>;
      client: GatewayClient;
      respond: (ok: boolean, payload?: unknown, error?: unknown, meta?: unknown) => void;
    }) => {
      const masAuth = getMasAuth(opts.client) ?? NULL_MAS_AUTH;
      const logoutUserId = masAuth.userId;
      const logoutTenantId = masAuth.tenantId;

      await coreLogout(opts);

      if (logoutUserId && logoutTenantId) {
        try {
          const activeClients = getActiveClients();
          plugin.bridge.pushUserPresence(
            logoutUserId,
            logoutTenantId,
            false,
            buildConnectedUsers(activeClients, getMasAuth),
            ((connId: string, event: string, data: unknown) =>
              sendToConnId(connId, activeClients, event, data)) as SendToConnIdFn,
          );
        } catch (err) {
          log.warn(`mas4s pushUserPresence (logout) failed: ${String(err)}`);
        }
      }
    };
  }
}

export function onClientConnected(
  client: GatewayClient,
  upgradeReq: { url?: string },
  ctx: AuthContext,
) {
  const {
    plugin,
    integrationMod,
    getMasAuth,
    getActiveClients,
    log,
    ADMIN_SCOPE,
    READ_SCOPE,
    WRITE_SCOPE,
  } = ctx;

  try {
    const masToken = integrationMod.extractMasTokenFromUrl({ url: upgradeReq.url });
    const masAuth = plugin.bridge.authenticateConnect({ masToken });
    setMasAuthContext(client, masAuth);

    if (masAuth.userId && masAuth.tenantId) {
      const activeClients = getActiveClients();
      plugin.bridge.pushUserPresence(
        masAuth.userId,
        masAuth.tenantId,
        true,
        buildConnectedUsers(activeClients, getMasAuth),
        ((connId: string, event: string, data: unknown) =>
          sendToConnId(connId, activeClients, event, data)) as SendToConnIdFn,
      );
    }

    if (masAuth.displayName && client.connect?.client) {
      client.connect.client.displayName = masAuth.displayName;
    }

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
    log.warn(`mas4s auth failed for conn=${client.connId ?? "unknown"}: ${String(err)}`);
    setMasAuthContext(client, NULL_MAS_AUTH);

    // If a token was provided but failed, we might want to drop the connection
    const urlParams = new URL(upgradeReq.url ?? "/", "http://localhost").searchParams;
    if (urlParams.has("masToken") && client.socket) {
      client.socket.close(4008, "MAS_AUTH_FAILED");
    }
  }
}

export function onClientDisconnected(client: GatewayClient, ctx: AuthContext) {
  const { plugin, getMasAuth, getActiveClients, log } = ctx;

  try {
    const masAuth = getMasAuth(client) ?? NULL_MAS_AUTH;
    log.info(
      `mas4s onClientDisconnected conn=${client.connId ?? "unknown"} userId=${masAuth.userId ?? "null"}`,
    );
    if (masAuth.userId) {
      plugin.bridge.logout(masAuth.userId);
      if (masAuth.tenantId) {
        const activeClients = getActiveClients();
        plugin.bridge.pushUserPresence(
          masAuth.userId,
          masAuth.tenantId,
          false,
          buildConnectedUsers(activeClients, getMasAuth),
          ((connId: string, event: string, data: unknown) =>
            sendToConnId(connId, activeClients, event, data)) as SendToConnIdFn,
        );
      }
    }
  } catch (err) {
    log.warn(
      `mas4s onClientDisconnected failed for conn=${client.connId ?? "unknown"}: ${String(err)}`,
    );
  }
}

export function wrapRespond(
  client: GatewayClient,
  respond: (ok: boolean, payload?: unknown, error?: unknown, meta?: unknown) => void,
  ctx: AuthContext,
) {
  const { plugin, getMasAuth } = ctx;
  return (ok: boolean, payload: unknown, error: unknown, meta: unknown) => {
    // If the response contains a new masToken (e.g. from session.create or auth.login),
    // we sync it to the bridge presence.
    if (ok && typeof payload === "object" && payload !== null) {
      const p = payload as Record<string, unknown>;
      const masToken = str(p["masToken"]);
      if (masToken) {
        // Since we don't have resolveMasToken, we use authenticateConnect to verify and get context
        try {
          const masAuth = plugin.bridge.authenticateConnect({ masToken });
          if (masAuth && masAuth.userId !== null) {
            setMasAuthContext(client, masAuth);
          }
        } catch {
          // ignore
        }
      }
    }

    // Always ensure the caller has masAuth context if possible
    if (!ok && error && typeof error === "object") {
      const masAuth = getMasAuth(client) ?? NULL_MAS_AUTH;
      if (masAuth.userId === null) {
        // Potentially inject 'unauthorized' if MAS bridge requires it
      }
    }

    respond(ok, payload, error, meta);
  };
}
