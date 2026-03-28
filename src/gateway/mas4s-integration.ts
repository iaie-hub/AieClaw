/**
 * Opt-in integration point for the mas4s multi-tenant RBAC plugin.
 *
 * This module lazily loads the mas4s gateway plugin and adapts its
 * handlers/hooks to the gateway's type system. The gateway core has
 * zero hard dependencies on aiemas — if the plugin fails to load,
 * the gateway continues without multi-tenant features.
 */

import { resolveEnvApiKey } from "../agents/model-auth-env.js";
import type { OpenClawConfig } from "../config/config.js";
import { collectConfigRuntimeEnvVars } from "../config/env-vars.js";
import { isValidEnvSecretRefId } from "../config/types.secrets.js";
import type { createSubsystemLogger } from "../logging/subsystem.js";
import { resolveSecretInputString } from "../secrets/resolve-secret-input-string.js";
import { ADMIN_SCOPE, READ_SCOPE, WRITE_SCOPE } from "./method-scopes.js";
import { chatHandlers } from "./server-methods/chat.js";
import { sessionsHandlers } from "./server-methods/sessions.js";
import type {
  GatewayRequestHandler,
  GatewayRequestHandlers,
  GatewayClient,
} from "./server-methods/types.js";
import type { GatewayWsClient } from "./server/ws-types.js";
import { loadGatewaySessionRow } from "./session-utils.js";

type SubsystemLogger = ReturnType<typeof createSubsystemLogger>;

export interface Mas4sIntegration {
  extraHandlers: GatewayRequestHandlers;
  onClientConnected: (client: GatewayWsClient, upgradeReq: { url?: string }) => void;
  onSessionCreated: (sessionKey: string, label: string, client: GatewayClient) => void;
  /**
   * Pre-request interceptor: check RBAC + session access before dispatching.
   * Returns null to allow, or an error shape to reject.
   */
  interceptRequest: (
    method: string,
    params: Record<string, unknown>,
    client: GatewayClient | null,
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
  filterSessionsList: (sessions: unknown[], client: GatewayClient | null) => unknown[];
  /**
   * Called when a WS client disconnects. Marks the user offline if authenticated.
   */
  onClientDisconnected: (client: GatewayWsClient) => void;
  /**
   * Internal: allows server.impl.ts to keep the clients reference up to date.
   * This is used by the MAS4S bridge to track user presence across all connections.
   */
  _setActiveClients?: (clients: Set<GatewayWsClient>) => void;
  /**
   * Internal: inject the ExecApprovalManager so interceptRequest can record
   * exec.approval.resolve requests to session_messages for history replay.
   */
  _setExecApprovalManager?: (
    manager: import("./exec-approval-manager.js").ExecApprovalManager,
  ) => void;
}

const NOOP_INTEGRATION: Mas4sIntegration = {
  extraHandlers: {},
  onClientConnected: () => {},
  onClientDisconnected: () => {},
  onSessionCreated: () => {},
  interceptRequest: () => ({ allowed: true }),
  filterBroadcast: () => null,
  filterSessionsList: (sessions) => sessions,
  _setActiveClients: () => {},
};

async function resolveLlmKey(
  config: OpenClawConfig,
  value: unknown,
  provider?: string,
): Promise<string> {
  if (typeof value !== "string") {
    return "";
  }

  // 1. Try standard secret resolution (handles ${VLLM_API_KEY} etc)
  const resolved = await resolveSecretInputString({
    config,
    value,
    env: process.env,
  });

  if (resolved && resolved !== value) {
    return resolved;
  }

  // 2. Prepare merged environment (process.env + config.env.vars)
  const mergedEnv = { ...process.env, ...collectConfigRuntimeEnvVars(config) };

  // 3. If a provider is known, try auth profile store first (written by `openclaw configure`)
  //    This is the primary storage path: real keys live in auth-profiles.json, not openclaw.json.
  if (provider) {
    try {
      const { ensureAuthProfileStore, resolveApiKeyForProfile, resolveAuthProfileOrder } =
        await import("../agents/auth-profiles.js");
      const store = ensureAuthProfileStore();
      const order = resolveAuthProfileOrder({ cfg: config, store, provider });
      for (const profileId of order) {
        const profileResult = await resolveApiKeyForProfile({ cfg: config, store, profileId });
        if (profileResult?.apiKey) {
          console.log(
            `[mas4s] Resolved LLM key via auth profile "${profileId}" for provider: ${provider}`,
          );
          return profileResult.apiKey;
        }
      }
    } catch (err) {
      console.warn(`[mas4s] Auth profile lookup failed for provider ${provider}: ${String(err)}`);
    }
  }

  // 4. If a provider is known, use the provider-specific env resolver
  if (provider) {
    const envResolved = resolveEnvApiKey(provider, mergedEnv);
    if (envResolved) {
      return envResolved.apiKey;
    }
  }

  // 5. Fallback for plain placeholders like "VLLM_API_KEY"
  if (isValidEnvSecretRefId(value)) {
    const envVal = mergedEnv[value];
    if (envVal) {
      console.log(`[mas4s] Resolved ${value} from merged env (length: ${envVal.length})`);
      return envVal;
    }

    console.warn(`[mas4s] Failed to resolve plain placeholder: ${value}`);
    // CRITICAL: If it looks like an env var but we couldn't find one,
    // DO NOT return the placeholder name as a literal key.
    // However, self-hosted providers (vllm, ollama, sglang, etc.) typically
    // don't require a real API key. Return "none" so the LLM call can proceed.
    if (
      provider &&
      ["vllm", "ollama", "sglang", "litellm", "lmstudio"].includes(provider.toLowerCase())
    ) {
      console.log(`[mas4s] Using placeholder key "none" for self-hosted provider: ${provider}`);
      return "none";
    }
    return "";
  }

  return resolved ?? "";
}

/**
 * Attempt to initialize the mas4s plugin. Returns a noop integration
 * on failure so the gateway can start without it.
 */
export async function initMas4sIntegration(
  log: SubsystemLogger,
  config?: OpenClawConfig,
): Promise<Mas4sIntegration> {
  if (!config) {
    return NOOP_INTEGRATION;
  }
  try {
    const { createMas4sGatewayPlugin } =
      await import("../../aiemas/src/gateway-bridge/mas4s-gateway-plugin.js");
    const contextMod = await import("../../aiemas/src/gateway-bridge/context.js");
    const integrationMod = await import("../../aiemas/src/gateway-bridge/integration.js");

    const aiemasConfig = config?.plugins?.entries?.["aiemas"]?.config ?? {};
    const mas4sConfig = config?.plugins?.entries?.["mas4s"]?.config ?? {};
    let llm = (aiemasConfig["llm"] ?? mas4sConfig["llm"]) as
      | { baseUrl: string; apiKey: string; model: string }
      | undefined;

    // Fallback: if no LLM configured for aiemas, try to reuse one from models.providers
    if (!llm && config?.models?.providers) {
      const providers = config.models.providers;
      const bestKey =
        Object.keys(providers).find((k) => k.toLowerCase() === "openai") ??
        Object.keys(providers).find((k) => k.toLowerCase().includes("deepseek")) ??
        Object.keys(providers).find(
          (k) => k.toLowerCase().includes("vllm") || k.toLowerCase().includes("ollama"),
        ) ??
        Object.keys(providers).find((k) => providers[k].api?.startsWith("openai-"));

      if (bestKey) {
        const p = providers[bestKey];
        const modelId = p.models?.[0]?.id;
        if (p.baseUrl && modelId) {
          // If the key is custom (e.g. "my-vllm"), try to map to a canonical ID for env resolution
          let providerId = bestKey;
          const kLower = bestKey.toLowerCase();
          if (kLower.includes("deepseek")) {
            providerId = "deepseek";
          } else if (kLower.includes("vllm")) {
            providerId = "vllm";
          } else if (kLower.includes("openai")) {
            providerId = "openai";
          } else if (kLower.includes("ollama")) {
            providerId = "ollama";
          }

          llm = {
            baseUrl: p.baseUrl,
            apiKey: await resolveLlmKey(config, p.apiKey, providerId),
            model: modelId,
          };
          console.log(
            `[mas4s] LLM fallback config created using provider key: ${bestKey}, hint: ${providerId}, model: ${modelId}, hasApiKey: ${Boolean(llm.apiKey)}`,
          );
        } else {
          console.warn(
            `[mas4s] Found potential fallback provider ${bestKey}, but it is missing baseUrl (${Boolean(p.baseUrl)}) or models array (${p.models?.length ?? 0})`,
          );
        }
      }
    }

    // Also resolve apiKey if it was provided in plugin config (non-fallback)
    if (llm?.apiKey && config) {
      llm.apiKey = await resolveLlmKey(config, llm.apiKey);
    }

    const plugin = await createMas4sGatewayPlugin({ llm });
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

    // ExecApprovalManager reference — injected after gateway startup via _setExecApprovalManager.
    // Used to look up sessionKey when recording exec.approval.resolve requests.
    let execApprovalManager: import("./exec-approval-manager.js").ExecApprovalManager | null = null;
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

        // Broadcast online presence immediately if successfully authenticated.
        // This ensures peers see the user as "online" even on token-based reconnection (refresh).
        if (masAuth.userId && masAuth.tenantId) {
          plugin.bridge.pushUserPresence(
            masAuth.userId,
            masAuth.tenantId,
            true,
            buildConnectedUsers(),
            (connId, event, data) => sendToConnId(connId, activeClients, event, data),
          );
        }

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
        const result = plugin.bridge.interceptMethod(method, params, masAuth);

        // ── Record exec.approval.resolve user request for history replay ──────
        // Fire-and-forget after RBAC check passes. The approval is still pending
        // at this point, so getSnapshot() can retrieve the sessionKey.
        if (result.allowed && method === "exec.approval.resolve" && execApprovalManager) {
          try {
            const id = typeof params["id"] === "string" ? params["id"] : "";
            const decision = typeof params["decision"] === "string" ? params["decision"] : "";
            if (id && decision) {
              const snapshot = execApprovalManager.getSnapshot(id);
              const sessionKey =
                typeof snapshot?.request?.sessionKey === "string"
                  ? snapshot.request.sessionKey
                  : "";
              if (sessionKey) {
                let displayName: string | null = masAuth.displayName ?? null;
                if (!displayName && client) {
                  displayName = client.connect?.client?.displayName ?? null;
                }
                plugin.transcriptStore.recordApprovalEvent({
                  sessionKey,
                  type: "user-resolve",
                  payload: { id, decision, resolvedBy: displayName, ts: Date.now() },
                  timestamp: Date.now(),
                });
              }
            }
          } catch (err) {
            log.warn(
              `mas4s interceptRequest: approval user-resolve capture failed: ${String(err)}`,
            );
          }
        }

        return result;
      } catch (err) {
        log.warn(`mas4s interceptRequest failed for method=${method}: ${String(err)}`);
        return { allowed: true };
      }
    };

    const filterBroadcast: Mas4sIntegration["filterBroadcast"] = (event, payload, clients) => {
      // ── Intercept broadcast events to capture messages for history storage ──────
      // This replaces the onSessionTranscriptUpdate path for tool calls and assistant
      // final messages, which never pass through the transcript event bus.
      try {
        const p = payload as Record<string, unknown>;
        const evtSessionKey = typeof p["sessionKey"] === "string" ? p["sessionKey"] : "";

        if (evtSessionKey) {
          // 1. Tool call events (agent stream:tool / session.tool)
          if (event === "agent" || event === "session.tool") {
            if (p["stream"] === "tool") {
              const data = p["data"] as Record<string, unknown> | undefined;
              const phase = typeof data?.["phase"] === "string" ? data["phase"] : "";
              const toolCallId = typeof data?.["toolCallId"] === "string" ? data["toolCallId"] : "";
              const name = typeof data?.["name"] === "string" ? data["name"] : "tool";
              if (toolCallId && (phase === "start" || phase === "result")) {
                plugin.transcriptStore.recordToolEvent({
                  sessionKey: evtSessionKey,
                  toolCallId,
                  name,
                  phase,
                  args: phase === "start" ? data?.["args"] : undefined,
                  result:
                    phase === "result"
                      ? (data?.["result"] ?? data?.["partialResult"] ?? data?.["meta"])
                      : undefined,
                  timestamp: typeof p["ts"] === "number" ? p["ts"] : Date.now(),
                });
              }
            }
          }

          // 2. Assistant final message: handled by the transcript event path (handleUpdate).
          // recordAssistantFinal is intentionally not called here to avoid double-writing,
          // since handleUpdate already captures the full assistant message (including
          // thinking + toolCall blocks) from the JSONL transcript event.
        }

        // 3. Approval events → persist to session_messages for history replay
        if (event === "exec.approval.requested") {
          const reqPayload = p as {
            id?: string;
            request?: Record<string, unknown>;
            createdAtMs?: number;
            expiresAtMs?: number;
          };
          const approvalSessionKey =
            typeof reqPayload.request?.["sessionKey"] === "string"
              ? reqPayload.request["sessionKey"]
              : "";
          if (approvalSessionKey && reqPayload.id) {
            plugin.transcriptStore.recordApprovalEvent({
              sessionKey: approvalSessionKey,
              type: "requested",
              payload: {
                id: reqPayload.id,
                command: reqPayload.request?.["command"],
                commandPreview: reqPayload.request?.["commandPreview"],
                cwd: reqPayload.request?.["cwd"],
                resolvedPath: reqPayload.request?.["resolvedPath"],
                host: reqPayload.request?.["host"],
                agentId: reqPayload.request?.["agentId"],
                security: reqPayload.request?.["security"],
                sessionKey: approvalSessionKey,
                createdAtMs: reqPayload.createdAtMs,
                expiresAtMs: reqPayload.expiresAtMs,
              },
              timestamp: reqPayload.createdAtMs ?? Date.now(),
            });
          }
        }

        if (event === "exec.approval.resolved") {
          const resPayload = p as {
            id?: string;
            decision?: string;
            resolvedBy?: string | null;
            ts?: number;
            request?: Record<string, unknown>;
          };
          const approvalSessionKey =
            typeof resPayload.request?.["sessionKey"] === "string"
              ? resPayload.request["sessionKey"]
              : "";
          if (approvalSessionKey && resPayload.id) {
            plugin.transcriptStore.recordApprovalEvent({
              sessionKey: approvalSessionKey,
              type: "resolved",
              payload: {
                id: resPayload.id,
                decision: resPayload.decision,
                resolvedBy: resPayload.resolvedBy,
                ts: resPayload.ts,
              },
              timestamp: resPayload.ts ?? Date.now(),
            });
          }
        }
      } catch (err) {
        log.warn(`mas4s filterBroadcast capture failed for event=${event}: ${String(err)}`);
      }
      // ── Original filterBroadcast logic ───────────────────────────────────────
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
        if (event === "exec.approval.requested" || event === "exec.approval.resolved") {
          log.info(
            `filterBroadcast ${event}: targetUserIds=[${[...targetUserIds].join(",")}] connIds=[${[...connIds].join(",")}] totalClients=${clients.size}`,
          );
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

            const sessionRow = loadGatewaySessionRow(sessionKey);
            const sessionLabel = sessionRow?.displayName ?? sessionRow?.label ?? sessionKey;

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

    // Inject gatewayDispatch so plugin handlers can call core gateway methods (e.g. chat.history).
    // The dispatch captures the adapted handler's context per-request via closure.
    // We wrap archive/summary handlers below to provide the context.
    let currentRequestContext:
      | import("./server-methods/types.js").GatewayRequestContext
      | undefined;
    let currentRequestClient: GatewayWsClient | null = null;

    plugin.gatewayDispatch = async (method, params, _client) => {
      const { handleGatewayRequest: dispatch } = await import("./server-methods.js");
      const context = currentRequestContext;
      if (!context) {
        throw new Error("Gateway context not available for internal dispatch");
      }
      return new Promise<unknown>((resolve, reject) => {
        void dispatch({
          req: { type: "req" as const, method, params, id: `mas4s-internal-${Date.now()}` },
          client: currentRequestClient,
          isWebchatConnect: () => false,
          respond: (ok, payload, error) => {
            if (ok) {
              resolve(payload);
            } else {
              reject(
                new Error(
                  typeof error === "object" && error
                    ? ((error as { message?: string }).message ?? JSON.stringify(error))
                    : String(error),
                ),
              );
            }
          },
          context,
          // Pass extraHandlers so internal dispatches can reach mas4s-registered
          // methods like session.history.range (not in coreGatewayHandlers).
          extraHandlers,
        });
      });
    };

    // Wrap session.archive to push session.archived event to all members on success.
    const origArchive = extraHandlers["session.archive"];
    if (origArchive) {
      extraHandlers["session.archive"] = async (opts) => {
        const sessionKey =
          typeof opts.params["sessionKey"] === "string" ? opts.params["sessionKey"] : "";
        let archiveOk = false;
        let archivePayload: Record<string, unknown> | undefined;

        // Set request context so gatewayDispatch can call chat.history
        currentRequestContext = opts.context;
        currentRequestClient = opts.client as GatewayWsClient | null;
        try {
          await origArchive({
            ...opts,
            respond: (ok, payload, error, meta) => {
              archiveOk = ok;
              if (ok && payload && typeof payload === "object") {
                archivePayload = payload as Record<string, unknown>;
              }
              opts.respond(ok, payload, error, meta);
            },
          });
        } finally {
          currentRequestContext = undefined;
          currentRequestClient = null;
        }

        if (archiveOk && sessionKey && archivePayload) {
          try {
            const connectedUsers = buildConnectedUsers();
            const callerAuth = opts.client
              ? (contextMod.getMasAuth(opts.client) ?? contextMod.NULL_MAS_AUTH)
              : contextMod.NULL_MAS_AUTH;
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

    // Wrap session.unarchive to push session.unarchived event to all members on success.
    const origUnarchive = extraHandlers["session.unarchive"];
    if (origUnarchive) {
      extraHandlers["session.unarchive"] = async (opts) => {
        const sessionKey =
          typeof opts.params["sessionKey"] === "string" ? opts.params["sessionKey"] : "";
        let unarchiveOk = false;

        await origUnarchive({
          ...opts,
          respond: (ok, payload, error, meta) => {
            unarchiveOk = ok;
            opts.respond(ok, payload, error, meta);
          },
        });

        if (unarchiveOk && sessionKey) {
          try {
            const connectedUsers = buildConnectedUsers();
            const callerAuth = opts.client
              ? (contextMod.getMasAuth(opts.client) ?? contextMod.NULL_MAS_AUTH)
              : contextMod.NULL_MAS_AUTH;
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

    // Wrap session.summary.generate to push session.summary.updated when persisted (archived session).
    const origSummaryGenerate = extraHandlers["session.summary.generate"];
    if (origSummaryGenerate) {
      extraHandlers["session.summary.generate"] = async (opts) => {
        const sessionKey =
          typeof opts.params["sessionKey"] === "string" ? opts.params["sessionKey"] : "";
        let generateOk = false;
        let generatePayload: Record<string, unknown> | undefined;

        // Set request context so gatewayDispatch can call chat.history
        currentRequestContext = opts.context;
        currentRequestClient = opts.client as GatewayWsClient | null;
        try {
          await origSummaryGenerate({
            ...opts,
            respond: (ok, payload, error, meta) => {
              generateOk = ok;
              if (ok && payload && typeof payload === "object") {
                generatePayload = payload as Record<string, unknown>;
              }
              opts.respond(ok, payload, error, meta);
            },
          });
        } finally {
          currentRequestContext = undefined;
          currentRequestClient = null;
        }

        if (generateOk && sessionKey && generatePayload?.["persisted"] === true) {
          try {
            const connectedUsers = buildConnectedUsers();
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

    // Wrap sessions.delete to clean up summary records when a session is deleted.
    const coreSessionsDelete = sessionsHandlers["sessions.delete"];
    if (coreSessionsDelete) {
      extraHandlers["sessions.delete"] = async (opts) => {
        const sessionKey = typeof opts.params["key"] === "string" ? opts.params["key"] : "";
        let deleteOk = false;

        await coreSessionsDelete({
          ...opts,
          respond: (ok, payload, error, meta) => {
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
        }
      };
    }

    // Wrap chat.send to broadcast user input to other session members.
    // The core handler does not broadcast 'user' messages via the 'chat' event,
    // only via 'session.message' (transcript updates), which doesn't include
    // sender display names. We add a custom broadcast here to sustain real-time
    // collaboration for aiemas users.
    const coreChatSend = chatHandlers["chat.send"];
    if (coreChatSend) {
      extraHandlers["chat.send"] = async (opts) => {
        const masAuth = opts.client
          ? (contextMod.getMasAuth(opts.client) ?? contextMod.NULL_MAS_AUTH)
          : contextMod.NULL_MAS_AUTH;
        const sessionKey =
          typeof opts.params["sessionKey"] === "string" ? opts.params["sessionKey"] : "";
        const message = typeof opts.params["message"] === "string" ? opts.params["message"] : "";
        const clientRunId =
          typeof opts.params["clientRunId"] === "string" ? opts.params["clientRunId"] : undefined;

        // Record sender context for message capture before core handler runs
        if (sessionKey) {
          plugin.transcriptStore.recordSenderContext(sessionKey, {
            userId: masAuth.userId ?? null,
            tenantId: masAuth.tenantId ?? null,
          });
        }

        // Run core handler first (manages idempotency, persistence, agent run)
        await coreChatSend(opts);

        // Broadcast the user's message to other members in the session.
        // We include runId and senderUserId so the receiving frontend can deduplicate
        // and filterBroadcastTargets can exclude the sender.
        if (masAuth.userId && sessionKey && message) {
          try {
            opts.context.broadcast(
              "chat",
              {
                sessionKey,
                runId: clientRunId,
                state: "user",
                senderUserId: masAuth.userId,
                message: {
                  role: "user",
                  content: message,
                  timestamp: Date.now(),
                  senderLabel: masAuth.displayName || "User",
                },
              },
              { dropIfSlow: true },
            );
          } catch (err) {
            log.warn(`mas4s user message broadcast failed: ${String(err)}`);
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
      /** Internal: inject ExecApprovalManager so interceptRequest can record user resolve requests */
      _setExecApprovalManager: (manager) => {
        execApprovalManager = manager;
      },
    };
  } catch (err) {
    log.info(`mas4s plugin not available, skipping: ${String(err)}`);
    return NOOP_INTEGRATION;
  }
}
