/**
 * Opt-in integration point for the mas4s multi-tenant RBAC plugin.
 *
 * This module lazily loads the mas4s gateway plugin and adapts its
 * handlers/hooks to the gateway's type system. The gateway core has
 * zero hard dependencies on aiemas — if the plugin fails to load,
 * the gateway continues without multi-tenant features.
 */

import { resolveEnvApiKey } from "../agents/model-auth-env.js";
import type { AnyAgentTool } from "../agents/tools/common.js";
import { createSessionsSendTool } from "../agents/tools/sessions-send-tool.js";
import type { OpenClawConfig } from "../config/config.js";
import { collectConfigRuntimeEnvVars } from "../config/env-vars.js";
import { isValidEnvSecretRefId } from "../config/types.secrets.js";
import { onAgentEvent } from "../infra/agent-events.js";
import type { SubsystemLogger } from "../logging/subsystem.js";
import { resolveSecretInputString } from "../secrets/resolve-secret-input-string.js";
import type { GatewayMessageChannel } from "../utils/message-channel.js";
import { callGateway } from "./call.js";
import { ADMIN_SCOPE, READ_SCOPE, WRITE_SCOPE } from "./method-scopes.js";
import { chatHandlers } from "./server-methods/chat.js";
import { sessionsHandlers } from "./server-methods/sessions.js";
import type { GatewayRequestHandlers, GatewayClient } from "./server-methods/types.js";
import type { GatewayWsClient } from "./server/ws-types.js";
import { loadGatewaySessionRow } from "./session-utils.js";

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
  /**
   * Returns AIEMAS-provided Agent tools.
   * Called by createOpenClawTools() to inject AIEMAS tools into the Agent tool set.
   * Returns undefined or an empty array when no AIEMAS tools are available.
   */
  resolveAgentTools?: (context: {
    agentSessionKey?: string;
    agentChannel?: GatewayMessageChannel;
    config?: OpenClawConfig;
  }) => AnyAgentTool[];
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
    const sessionMod = await import("../../aiemas/src/gateway-bridge/aiemas-session.js");
    const chatMod = await import("../../aiemas/src/gateway-bridge/aiemas-chat.js");
    const authMod = await import("../../aiemas/src/gateway-bridge/aiemas-auth.js");
    const agentMod = await import("../../aiemas/src/gateway-bridge/aiemas-agent.js");
    const { extractUuidFromKey } = await import("../../aiemas/src/utils/session-utils.js");
    const { createAiemasSessionsSendTool } =
      await import("../../aiemas/src/gateway-bridge/aiemas-tools.js");

    // Initialize the plugin
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
        }
      }
    }

    if (llm?.apiKey && config) {
      llm.apiKey = await resolveLlmKey(config, llm.apiKey);
    }

    const plugin = await createMas4sGatewayPlugin({ llm });
    log.info("mas4s multi-tenant plugin loaded");

    // ── Shared reference to the live clients set ──────────────────────────
    let activeClients: Set<GatewayWsClient> = new Set();
    const setActiveClients = (c: Set<GatewayWsClient>) => {
      activeClients = c;
    };

    // ── Request context tracking for AIEMAS agent integration ──────────────
    let _currentRequestContext:
      | import("./server-methods/types.js").GatewayRequestContext
      | undefined;
    let _currentRequestClient: GatewayWsClient | null = null;

    /** Broadcast an event to ALL connected WebSocket clients. */
    const broadcastToAll = (event: string, payload: unknown) => {
      const frame = JSON.stringify({ type: "event", event, payload });
      for (const c of activeClients) {
        try {
          c.socket.send(frame);
        } catch {
          /* ignore dead sockets */
        }
      }
    };

    // ── SOP Tracker + Progress Watcher integration ──────────────────────────
    const { SOPTracker, ProgressWatcher } = await import("../../aiemas/src/sop-tracker/index.js");
    const { homedir: _homedir } = await import("node:os");
    const { join: _join } = await import("node:path");

    // Track toolCallId → skillName mapping for result phase (where args are not available)
    const _toolCallSkillMap = new Map<string, string>();
    // Track toolCallId → runId mapping
    const _toolCallRunIdMap = new Map<string, string>();
    // Track background sessionId → skillName mapping to stop watches later
    const _backgroundSessionToSkillMap = new Map<string, string>();

    const sopTracker = new SOPTracker({
      onStateChange: (statePayload) => {
        log.info(
          `[mas4s:sop] state change: step=${statePayload.currentStepIndex} session=${statePayload.sessionKey}`,
        );
        const latestRunId =
          _toolCallRunIdMap.size > 0
            ? [..._toolCallRunIdMap.values()][_toolCallRunIdMap.size - 1]
            : undefined;
        const payloadWithRunId = latestRunId
          ? { ...statePayload, runId: latestRunId }
          : statePayload;
        broadcastToAll("sop.state", payloadWithRunId);
        try {
          const uuid = extractUuidFromKey(statePayload.sessionKey);
          plugin.upsertRunState(uuid, {
            runId: latestRunId,
            sopSnapshot: {
              sopName: statePayload.sopName,
              sopLabel: statePayload.sopLabel,
              stepStatuses: (statePayload.steps as Array<{ status: string }>).map(
                (s) => s.status as import("../../aiemas/src/sop-tracker/types.js").SOPStepStatus,
              ),
              currentStepIndex: statePayload.currentStepIndex,
              completedAt: statePayload.completedAt,
            },
            isChatting: true,
          });
        } catch (err) {
          log.warn(`[mas4s:sop] upsertRunState failed: ${String(err)}`);
        }
        plugin.transcriptStore.recordProgressEvent({
          sessionKey: statePayload.sessionKey,
          type: "sop:state",
          payload: payloadWithRunId,
          timestamp: statePayload.ts,
        });
      },
    });

    const progressWatcher = new ProgressWatcher({
      pollIntervalMs: 2000,
      onProgress: (progressPayload) => {
        const p = progressPayload.progress;
        log.info(
          `[mas4s:sop] skill progress: ${progressPayload.skill} type=${p.type} session=${progressPayload.sessionKey}`,
        );
        broadcastToAll("skill.progress", progressPayload);
        plugin.transcriptStore.recordProgressEvent({
          sessionKey: progressPayload.sessionKey,
          type: "skill:progress",
          payload: progressPayload,
          timestamp: progressPayload.ts,
        });
      },
    });

    onAgentEvent((evt) => {
      const p = evt as Record<string, unknown>;
      const evtSessionKey = typeof p["sessionKey"] === "string" ? p["sessionKey"] : "";
      if (!evtSessionKey) {
        return;
      }

      if (p["stream"] === "tool") {
        const data = p["data"] as Record<string, unknown> | undefined;
        const phase = typeof data?.["phase"] === "string" ? data["phase"] : "";
        const toolName = typeof data?.["name"] === "string" ? data["name"] : "";
        const toolCallId = typeof data?.["toolCallId"] === "string" ? data["toolCallId"] : "";

        if (toolCallId && (phase === "start" || phase === "result")) {
          // Record tool event
          plugin.transcriptStore.recordToolEvent({
            sessionKey: evtSessionKey,
            toolCallId,
            name: toolName || "tool",
            phase,
            args: phase === "start" ? data?.["args"] : undefined,
            result:
              phase === "result"
                ? (data?.["result"] ?? data?.["partialResult"] ?? data?.["meta"])
                : undefined,
            timestamp: typeof p["ts"] === "number" ? p["ts"] : Date.now(),
          });
        }

        if (toolName && (phase === "start" || phase === "result")) {
          const agentIdMatch = /^agent:([^:]+):/.exec(evtSessionKey);
          const agentId = agentIdMatch?.[1] ?? "default";
          const workspaceDir = _join(_homedir(), ".openclaw", `workspace-${agentId}`);

          let skillName = toolName;
          if (toolName === "exec" && phase === "start") {
            const args = data?.["args"] as Record<string, unknown> | undefined;
            const command = typeof args?.["command"] === "string" ? args["command"] : "";
            const scriptMatch = /\/([a-z_]+)\.py/.exec(command);
            const runIdMatch = /"run_id":\s*"([^"]+)"/.exec(command);
            if (scriptMatch?.[1]) {
              skillName = scriptMatch[1];
              if (toolCallId) {
                _toolCallSkillMap.set(toolCallId, skillName);
              }
            }
            if (runIdMatch?.[1] && toolCallId) {
              _toolCallRunIdMap.set(toolCallId, runIdMatch[1]);
            }
          } else if (toolName === "exec" && phase === "result" && toolCallId) {
            skillName = _toolCallSkillMap.get(toolCallId) ?? "exec";
            _toolCallSkillMap.delete(toolCallId);
          }

          if (["exec", "tool", "read", "process"].includes(skillName)) {
            if (skillName === "process" && phase === "result") {
              const res = data?.["result"] as Record<string, unknown> | undefined;
              const args = data?.["args"] as Record<string, unknown> | undefined;
              const sessionId = (res?.["sessionId"] ?? args?.["sessionId"]) as string | undefined;
              const status = res?.["status"] as string | undefined;
              if (sessionId && (status === "completed" || status === "failed")) {
                const backgroundSkill = _backgroundSessionToSkillMap.get(sessionId);
                if (backgroundSkill) {
                  _backgroundSessionToSkillMap.delete(sessionId);
                  sopTracker.updateStepStatus(
                    evtSessionKey,
                    backgroundSkill,
                    status === "failed" ? "failed" : "completed",
                    typeof p["ts"] === "number" ? p["ts"] : Date.now(),
                  );
                  progressWatcher.stopWatch(`${evtSessionKey}:${backgroundSkill}`);
                }
              }
            }
          } else {
            const res = data?.["result"] as Record<string, unknown> | undefined;
            const status = res?.["status"] as string | undefined;
            if (phase === "result" && status === "running" && res?.["sessionId"]) {
              _backgroundSessionToSkillMap.set(res["sessionId"] as string, skillName);
            }
            sopTracker.onToolEvent({
              sessionKey: evtSessionKey,
              agentId,
              workspaceDir,
              toolName: skillName,
              phase,
              status,
              isError:
                phase === "result" && (typeof res?.["error"] === "string" || status === "error"),
              timestamp: typeof p["ts"] === "number" ? p["ts"] : Date.now(),
            });
            if (phase === "start") {
              const runId = _toolCallRunIdMap.get(toolCallId);
              const progressDir = _join(
                _homedir(),
                ".openclaw",
                `workspace-${agentId}`,
                "workspace",
                "progress",
              );
              const progressFile = _join(
                progressDir,
                runId ? `${runId}_${skillName}.progress.jsonl` : `${skillName}.progress.jsonl`,
              );
              progressWatcher.startWatch({
                key: `${evtSessionKey}:${skillName}`,
                sessionKey: evtSessionKey,
                skill: skillName,
                filePath: progressFile,
              });
            }
            if (phase === "result") {
              _toolCallRunIdMap.delete(toolCallId);
            }
          }
        }
      }
    });

    plugin.bridge.setLoadSessionRow((sessionKey: string) => loadGatewaySessionRow(sessionKey));

    // ExecApprovalManager reference — injected after gateway startup via _setExecApprovalManager.
    let execApprovalManager: import("./exec-approval-manager.js").ExecApprovalManager | null = null;

    // Adapt SimpleHandler → GatewayRequestHandler
    const extraHandlers: GatewayRequestHandlers = {};
    log.info(`[mas4s] plugin.extraHandlers keys: ${Object.keys(plugin.extraHandlers).join(", ")}`);
    for (const [method, handler] of Object.entries(plugin.extraHandlers)) {
      extraHandlers[method] = async (opts) => {
        const respond = (ok: boolean, payload: unknown, error: unknown) => {
          opts.respond(ok, payload ?? undefined, error as Parameters<typeof opts.respond>[2]);
        };
        await handler({
          params: opts.params,
          client: opts.client,
          respond,
          dispatchGateway: async (innerMethod, innerParams, innerClient = opts.client) => {
            const { handleGatewayRequest: dispatch } = await import("./server-methods.js");
            return await new Promise<unknown>((resolve, reject) => {
              void dispatch({
                req: {
                  type: "req" as const,
                  method: innerMethod,
                  params: innerParams,
                  id: `mas4s-internal-${Date.now()}`,
                },
                client: (innerClient ?? null) as GatewayWsClient | null,
                isWebchatConnect: () => false,
                respond: (ok, payload, error) => {
                  if (ok) {
                    resolve(payload);
                    return;
                  }
                  reject(
                    new Error(
                      typeof error === "object" && error
                        ? ((error as { message?: string }).message ?? JSON.stringify(error))
                        : String(error),
                    ),
                  );
                },
                context: opts.context,
                extraHandlers,
              });
            });
          },
        });
      };
    }
    log.info(`[mas4s] adapted extraHandlers keys: ${Object.keys(extraHandlers).join(", ")}`);

    plugin.gatewayDispatch = async (method, params, _client) => {
      const { getPluginRuntimeGatewayRequestScope } =
        await import("../plugins/runtime/gateway-request-scope.js");
      const scope = getPluginRuntimeGatewayRequestScope();
      const context = scope?.context;
      if (!context) {
        throw new Error("Gateway context not available for internal dispatch");
      }

      const { handleGatewayRequest: dispatch } = await import("./server-methods.js");
      return new Promise<unknown>((resolve, reject) => {
        void dispatch({
          req: { type: "req" as const, method, params, id: `mas4s-internal-${Date.now()}` },
          client: scope.client as GatewayWsClient | null,
          isWebchatConnect: scope.isWebchatConnect,
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
          extraHandlers,
        });
      });
    };

    // Initialize module contexts and register delegated handlers
    const commonCtx = {
      plugin,
      getMasAuth: contextMod.getMasAuth as (
        client: unknown,
      ) => import("../../aiemas/src/gateway-bridge/context.js").MasAuthContext,
      getActiveClients: () =>
        activeClients as unknown as Set<
          import("../../aiemas/src/gateway-bridge/aiemas-utils.js").GatewayClient
        >,
      extractUuid: extractUuidFromKey,
      loadSessionRow: loadGatewaySessionRow,
      log,
    };
    plugin.loadGatewaySessionRow = loadGatewaySessionRow;
    const authCtx = {
      ...commonCtx,
      integrationMod: {
        extractMasTokenFromUrl: (req: { url?: string }) =>
          integrationMod.extractMasTokenFromUrl(
            req as unknown as import("node:http").IncomingMessage,
          ),
      },
      ADMIN_SCOPE,
      READ_SCOPE,
      WRITE_SCOPE,
    };
    const chatCtx = {
      ...commonCtx,
      sopTracker: {
        recordChatEvent: (params: {
          sessionKey: string;
          event: string;
          payload: unknown;
          ts: number;
        }) => {
          if (params.event === "assistant-final") {
            const p = params.payload as { text: string; runId?: string };
            plugin.transcriptStore.recordAssistantFinal({
              sessionKey: params.sessionKey,
              runId: p.runId || `final-${Date.now()}`,
              text: p.text || "",
              timestamp: params.ts,
            });
          } else if (params.event === "sop:state" || params.event === "skill:progress") {
            plugin.transcriptStore.recordProgressEvent({
              sessionKey: params.sessionKey,
              type: params.event,
              payload: params.payload,
              timestamp: params.ts,
            });
          }
        },
      },
      broadcastToAll,
    };
    const agentCtx = {
      plugin,
      db: plugin.db,
      cacheService: plugin.tenantService.cacheService,
      setCurrentRequestContext: (ctx: unknown, cli: unknown) => {
        _currentRequestContext = ctx as
          | import("./server-methods/types.js").GatewayRequestContext
          | undefined;
        _currentRequestClient = cli as GatewayWsClient | null;
      },
      clearRequestContext: () => {
        _currentRequestContext = undefined;
        _currentRequestClient = null;
      },
      getCallGateway: () => {
        if (!plugin.gatewayDispatch) {
          return null;
        }
        const dispatch = plugin.gatewayDispatch;
        return (method: string, callParams: Record<string, unknown>) =>
          dispatch(method, callParams, null);
      },
      sessionCallbacks: {
        recordSessionCreated: (sessionKey: string, uid: string, tid: string) => {
          plugin.bridge.onSessionCreated(sessionKey, "", {
            userId: uid,
            tenantId: tid,
            masRole: null,
          });
        },
        deleteSessionRecords: (sessionKey: string) => {
          plugin.bridge.onSessionDeleted(sessionKey);
        },
      },
    };

    sessionMod.registerSessionHandlers(
      extraHandlers,
      sessionsHandlers,
      commonCtx as unknown as import("../../aiemas/src/gateway-bridge/aiemas-utils.js").CommonContext,
    );
    chatMod.registerChatHandlers(
      extraHandlers,
      chatHandlers,
      chatCtx as unknown as import("../../aiemas/src/gateway-bridge/aiemas-chat.js").ChatContext,
    );
    authMod.registerAuthHandlers(
      extraHandlers,
      authCtx as unknown as import("../../aiemas/src/gateway-bridge/aiemas-auth.js").AuthContext,
    );
    agentMod.registerAgentHandlers(
      extraHandlers,
      agentCtx as unknown as import("../../aiemas/src/gateway-bridge/aiemas-agent.js").AgentContext,
    );
    log.info(`[mas4s] final extraHandlers keys: ${Object.keys(extraHandlers).join(", ")}`);

    return {
      extraHandlers,
      onClientConnected: (client, upgradeReq) =>
        authMod.onClientConnected(
          client as unknown as import("../../aiemas/src/gateway-bridge/aiemas-utils.js").GatewayClient,
          upgradeReq,
          authCtx as unknown as import("../../aiemas/src/gateway-bridge/aiemas-auth.js").AuthContext,
        ),
      onClientDisconnected: (client) =>
        authMod.onClientDisconnected(
          client as unknown as import("../../aiemas/src/gateway-bridge/aiemas-utils.js").GatewayClient,
          authCtx as unknown as import("../../aiemas/src/gateway-bridge/aiemas-auth.js").AuthContext,
        ),
      onSessionCreated: (sessionKey, label, client) =>
        sessionMod.onSessionCreated(
          sessionKey,
          label,
          client as unknown as import("../../aiemas/src/gateway-bridge/aiemas-utils.js").GatewayClient,
          commonCtx as unknown as import("../../aiemas/src/gateway-bridge/aiemas-utils.js").CommonContext,
        ),
      interceptRequest: (method, params, client) => {
        const masAuth = client
          ? (contextMod.getMasAuth(
              client as unknown as import("../../aiemas/src/gateway-bridge/aiemas-utils.js").GatewayClient,
            ) ?? contextMod.NULL_MAS_AUTH)
          : contextMod.NULL_MAS_AUTH;
        const result = plugin.bridge.interceptMethod(method, params, masAuth);
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
                const displayName =
                  masAuth.displayName ||
                  (client as unknown as GatewayWsClient).connect?.client?.displayName ||
                  null;
                plugin.transcriptStore.recordApprovalEvent({
                  sessionKey,
                  type: "user-resolve",
                  payload: { id, decision, resolvedBy: displayName, ts: Date.now() },
                  timestamp: Date.now(),
                });
              }
            }
          } catch (err) {
            log.warn(`mas4s interceptRequest: approval capture failed: ${String(err)}`);
          }
        }
        return result;
      },
      filterBroadcast: (event, payload, clients) =>
        chatMod.filterBroadcast(
          event,
          payload,
          Array.from(
            clients,
          ) as unknown as import("../../aiemas/src/gateway-bridge/aiemas-utils.js").GatewayClient[],
          chatCtx as unknown as import("../../aiemas/src/gateway-bridge/aiemas-chat.js").ChatContext,
        ),
      filterSessionsList: (sessions, client) =>
        sessionMod.filterSessionsList(
          sessions,
          client as unknown as import("../../aiemas/src/gateway-bridge/aiemas-utils.js").GatewayClient,
          commonCtx as unknown as import("../../aiemas/src/gateway-bridge/aiemas-utils.js").CommonContext,
        ),
      _setActiveClients: setActiveClients,
      _setExecApprovalManager: (manager) => {
        execApprovalManager = manager;
      },
      resolveAgentTools: (context) => {
        try {
          const tools: AnyAgentTool[] = [];
          const callSessionsSend = async (params: {
            sessionKey: string;
            message: string;
            timeoutSeconds?: number;
          }) => {
            const sendTool = createSessionsSendTool({
              agentSessionKey: context.agentSessionKey,
              agentChannel: context.agentChannel,
              config: context.config,
              callGateway,
            });
            return sendTool.execute("aiemas-internal", {
              sessionKey: params.sessionKey,
              message: params.message,
              timeoutSeconds: params.timeoutSeconds ?? 30,
            });
          };
          tools.push(
            createAiemasSessionsSendTool(
              { db: plugin.db, callSessionsSend },
              { agentSessionKey: context.agentSessionKey },
            ),
          );
          return tools;
        } catch (err) {
          log.warn(`[mas4s] resolveAgentTools failed: ${String(err)}`);
          return [];
        }
      },
    };
  } catch (err) {
    log.info(`mas4s plugin not available, skipping: ${String(err)}`);
    return NOOP_INTEGRATION;
  }
}
