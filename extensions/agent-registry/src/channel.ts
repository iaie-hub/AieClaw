/**
 * channel.ts — agent-registry channel plugin assembly.
 *
 * Wires together all sub-modules (config, NATS client, registration, heartbeat,
 * router, outbound, arbiter) and exposes the plugin via `createChatChannelPlugin`.
 *
 * Lifecycle (gateway.startAccount):
 *  1. Parse config; on failure → status unavailable, return
 *  2. Status connecting; create NATSClient; connect(); on failure → unavailable
 *  3. Status registering; register(); on failure → unavailable
 *  4. Subscribe to unicast / multicast / broadcast topics
 *  5. Start heartbeatManager.start(ttlMs)
 *  6. arbiter.initialize()
 *  7. Status registered
 *  8. Wait for abortSignal (stop signal)
 *  9. Teardown: status disconnected → stop heartbeat → dispose arbiter →
 *     deregister (5 s) → unsubscribeAll → drain (5 s) → close
 *     Force-close if total teardown > 10 s.
 *
 * Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 3.3, 3.6, 4.1, 4.2, 4.3, 4.4, 4.5,
 *               5.8, 8.1, 11.3, 11.4, 11.5, 11.6
 */

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import { createInbox } from "nats";
import type { ChannelGatewayContext } from "openclaw/plugin-sdk/channel-contract";
import { createChatChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import type { ChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import { waitUntilAbort } from "openclaw/plugin-sdk/channel-lifecycle";
import { dispatchInboundDirectDmWithRuntime } from "openclaw/plugin-sdk/direct-dm";
import { buildAgentSessionKey, buildAgentMainSessionKey } from "openclaw/plugin-sdk/routing";
import { discoverAgents } from "./agent-discovery.js";
import type { DiscoverAgentsParams } from "./agent-discovery.js";
import { createCollaborationArbiter } from "./arbiter.js";
import type { ArbiterSession } from "./arbiter.js";
import { parseConfig } from "./config.js";
import { createCowork } from "./cowork-initiator.js";
import type { CreateCoworkParams } from "./cowork-initiator.js";
import { sendCoworkMessage } from "./cowork-sender.js";
import type { SendCoworkMessageParams } from "./cowork-sender.js";
import { createOutboundAdapter } from "./outbound.js";
import { createMessageRouter } from "./router.js";
import { createStatusAdapter } from "./status.js";
import { setAgentRegistryToolRuntime } from "./tools.js";
import type {
  AgentRegistryConfig,
  AgentSession,
  InstalledSkill,
  NATSSubscription,
  RegistryEnvelope,
} from "./types.js";
import { sendMessage } from "./unicast-sender.js";
import type { SendMessageParams } from "./unicast-sender.js";

function resolveWorkerUrl(currentModuleUrl: string): URL {
  const currentPath = fileURLToPath(currentModuleUrl);
  const distMarker = `${path.sep}dist${path.sep}`;
  const distIndex = currentPath.lastIndexOf(distMarker);
  if (distIndex >= 0) {
    const distRoot = currentPath.slice(0, distIndex + distMarker.length - 1);
    return pathToFileURL(path.join(distRoot, "extensions", "agent-registry", "channel.worker.js"));
  }
  const extension = path.extname(currentPath) || ".js";
  return new URL(`../channel.worker${extension}`, currentModuleUrl);
}

// ---------------------------------------------------------------------------
// Resolved account type (minimal — no credentials stored in config)
// ---------------------------------------------------------------------------

type ResolvedAgentRegistryAccount = {
  accountId: string;
};

// ---------------------------------------------------------------------------
// Session tracking
// ---------------------------------------------------------------------------

/**
 * Tracks active agent sessions so the heartbeat can report the correct count.
 * Each session is keyed by its sessionKey.
 *
 * Sessions are never automatically cleaned up — they persist for the lifetime
 * of the channel connection. This ensures that ongoing conversations retain
 * their OpenClaw session context regardless of idle periods between messages.
 */
class SessionTracker {
  readonly sessions = new Map<string, AgentSession>();
  onActiveTaskCountChange?: (totalActiveTasks: number) => void;

  add(key: string, session: AgentSession): void {
    this.sessions.set(key, session);
    // New sessions start with 0 active tasks — no count change needed.
  }

  remove(key: string): void {
    this.sessions.delete(key);
    this.onActiveTaskCountChange?.(this.totalActiveTaskCount());
  }

  get(key: string): AgentSession | undefined {
    return this.sessions.get(key);
  }

  count(): number {
    return this.sessions.size;
  }

  /** Sum of activeTaskCount across all tracked sessions. */
  totalActiveTaskCount(): number {
    let total = 0;
    for (const session of this.sessions.values()) {
      total += session.activeTaskCount;
    }
    return total;
  }

  /** Notify the worker of the current total active task count. */
  notifyActiveTaskCount(): void {
    this.onActiveTaskCountChange?.(this.totalActiveTaskCount());
  }

  clear(): void {
    this.sessions.clear();
    this.onActiveTaskCountChange?.(0);
  }
}

// ---------------------------------------------------------------------------
// AgentSession implementation using the plugin SDK dispatch pipeline
// ---------------------------------------------------------------------------

/**
 * Create an AgentSession that dispatches inbound A2A envelopes to the
 * Bound_Agent via the OpenClaw reply dispatch pipeline.
 *
 * The session is keyed by `sessionKey` (e.g. "unicast:agent-123") and
 * dispatches each envelope as a direct-DM turn to the bound agent.
 *
 * Requirements: 6.3, 6.4, 6.7
 */
function createAgentSession(params: {
  sessionKey: string;
  /** Controls how outbound responses are routed by the OutboundAdapter. */
  sessionContextKind: "unicast" | "cowork";
  agentId: string;
  boundAgentId: string;
  config: AgentRegistryConfig;
  cfg: Parameters<typeof dispatchInboundDirectDmWithRuntime>[0]["cfg"];
  channelRuntime: Parameters<typeof dispatchInboundDirectDmWithRuntime>[0]["runtime"];
  outboundAdapter: ReturnType<typeof createOutboundAdapter>;
  sessionTracker: SessionTracker;
  /** Controller for setting/clearing the pending session key override used by resolveAgentRoute. */
  sessionOverrideCtrl?: {
    set: (key: string | undefined) => void;
    resolveStorePath?: () => string;
    readSessionUpdatedAt?: (storePath: string, sessionKey: string) => number | undefined;
  };
  /** Set to register active outbound sessions for cross-session self-message filtering. */
  activeOutboundSessions?: Set<string>;
  /**
   * Fixed OpenClaw session key derived from the inbound envelope's session field
   * at AgentSession creation time. When set, dispatch() uses this value directly
   * instead of dynamically parsing envelope.session on each call — eliminating
   * the pendingSessionKeyOverride race condition for parallel sessions from the
   * same source agent.
   */
  fixedOpenClawSessionKey?: string;
}): AgentSession {
  const {
    sessionKey,
    sessionContextKind,
    agentId,
    cfg,
    channelRuntime,
    outboundAdapter,
    sessionTracker,
    sessionOverrideCtrl,
    activeOutboundSessions,
    fixedOpenClawSessionKey,
  } = params;
  const boundAgentId = params.boundAgentId;

  let activeTaskCount = 0;

  const session: AgentSession = {
    async dispatch(envelope: RegistryEnvelope): Promise<void> {
      activeTaskCount++;
      sessionTracker.notifyActiveTaskCount();
      try {
        // Resolve the OpenClaw session key override.
        // When fixedOpenClawSessionKey is set (session was known at creation time),
        // use it directly — no dynamic parsing needed, no race condition.
        // When not set (legacy session=null path), fall back to dynamic resolution
        // from envelope.session for backward compatibility.
        let resolvedSessionKeyOverride: string | undefined;
        if (fixedOpenClawSessionKey) {
          resolvedSessionKeyOverride = fixedOpenClawSessionKey;
        } else if (envelope.session && sessionOverrideCtrl) {
          const parts = envelope.session.split(":");
          // Format: agent:{agentId}:group:{sessionUuid}
          if (parts.length >= 4 && parts[0] === "agent" && parts[2] === "group") {
            const sessionUuid = parts.slice(3).join(":");
            const candidateKey = `agent:${boundAgentId}:group:${sessionUuid}`;

            // Verify the session exists before overriding
            let sessionExists = true; // optimistic default
            if (sessionOverrideCtrl.resolveStorePath && sessionOverrideCtrl.readSessionUpdatedAt) {
              try {
                const storePath = sessionOverrideCtrl.resolveStorePath();
                const updatedAt = sessionOverrideCtrl.readSessionUpdatedAt(storePath, candidateKey);
                sessionExists = updatedAt !== undefined;
              } catch {
                // If we can't check, assume it exists (optimistic)
                sessionExists = true;
              }
            }

            if (sessionExists) {
              resolvedSessionKeyOverride = candidateKey;
            }
          }
        }

        const messageText =
          typeof envelope.payload["text"] === "string"
            ? envelope.payload["text"]
            : typeof envelope.payload["message"] === "string"
              ? envelope.payload["message"]
              : JSON.stringify(envelope.payload);

        const peer = { kind: "direct" as const, id: envelope.source || sessionKey };

        // Set the override before dispatching so resolveAgentRoute picks it up
        sessionOverrideCtrl?.set(resolvedSessionKeyOverride);
        try {
          await dispatchInboundDirectDmWithRuntime({
            cfg,
            runtime: channelRuntime,
            channel: "agent-registry",
            channelLabel: "Agent Registry",
            accountId: agentId,
            peer,
            senderId: envelope.source,
            senderAddress: `agent-registry:${envelope.source}`,
            recipientAddress: `agent-registry:${agentId}`,
            conversationLabel: `A2A:${envelope.source}`,
            rawBody: messageText,
            messageId: envelope.message_id,
            timestamp: envelope.timestamp,
            deliver: async (payload) => {
              // Deliver the agent's response back via the outbound adapter.
              const responseText =
                typeof payload === "object" && payload !== null && "text" in payload
                  ? String((payload as Record<string, unknown>)["text"] ?? "")
                  : "";

              if (responseText) {
                const sessionContext =
                  sessionContextKind === "cowork"
                    ? ({ kind: "cowork", coworkId: sessionKey, isComplete: false } as const)
                    : ({ kind: "unicast", sourceAgentId: envelope.source } as const);

                await outboundAdapter.send({
                  responseText,
                  inboundEnvelope: envelope,
                  sessionContext,
                  sessionSeq: 0,
                  isSessionComplete: false,
                  senderSessionKey: envelope.session ?? undefined,
                });
              }
            },
            onRecordError: (err) => {
              console.error(
                `[agent-registry] session record error for ${sessionKey}: ${String(err)}`,
              );
            },
            onDispatchError: (err, info) => {
              console.error(
                `[agent-registry] session dispatch error for ${sessionKey} (${info.kind}): ${String(err)}`,
              );
            },
          });
        } finally {
          sessionOverrideCtrl?.set(undefined);
        }
      } finally {
        activeTaskCount--;
        sessionTracker.notifyActiveTaskCount();
      }
    },

    get activeTaskCount(): number {
      return activeTaskCount;
    },
  };

  sessionTracker.add(sessionKey, session);
  return session;
}

// ---------------------------------------------------------------------------
// ArbiterSession implementation
// ---------------------------------------------------------------------------

/**
 * Create an ArbiterSession that wraps an AgentSession with
 * `sendAndAwaitResponse` capability for the CollaborationArbiter.
 *
 * Uses `runtime.llm.complete` for a lightweight synchronous prompt-response
 * cycle without creating a full session turn.
 *
 * Requirements: 6.9
 */
function createArbiterSessionImpl(params: {
  agentId: string;
  boundAgentId: string;
  channelRuntime: NonNullable<ChannelGatewayContext["channelRuntime"]>;
  sessionTracker: SessionTracker;
}): ArbiterSession {
  const { boundAgentId, channelRuntime } = params;

  // The arbiter session uses the plugin runtime's llm.complete for
  // lightweight prompt-response cycles (no full session overhead).
  // The channelRuntime is cast to access the full PluginRuntime surface
  // that the gateway injects for external channel plugins.
  const runtime = channelRuntime as unknown as {
    llm?: {
      complete: (params: {
        messages: Array<{ role: string; content: string }>;
        agentId?: string;
        purpose?: string;
        signal?: AbortSignal;
      }) => Promise<{ text: string }>;
    };
  };

  let disposed = false;

  return {
    async sendAndAwaitResponse(prompt: string, timeoutMs: number): Promise<string> {
      if (disposed) {
        throw new Error("ArbiterSession has been disposed");
      }

      if (!runtime.llm?.complete) {
        // Fallback: if llm.complete is not available, return a conservative "no"
        console.warn(
          "[agent-registry] arbiter: llm.complete not available — defaulting to 'no' for collaboration decision",
        );
        return "no";
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const result = await runtime.llm.complete({
          messages: [{ role: "user", content: prompt }],
          agentId: boundAgentId,
          purpose: "agent-registry collaboration decision",
          signal: controller.signal,
        });
        return result.text;
      } finally {
        clearTimeout(timer);
      }
    },

    dispose(): void {
      disposed = true;
    },
  };
}

// ---------------------------------------------------------------------------
// getInstalledSkills — stub using plugin runtime skill snapshot
// ---------------------------------------------------------------------------

/**
 * Resolve the list of installed OpenClaw skills for AgentCard construction.
 *
 * Uses the plugin runtime's agent workspace to build a skill snapshot.
 * Returns an empty array if the runtime surface is unavailable.
 *
 * Requirements: 2.1, 2.6
 */
async function getInstalledSkillsFromRuntime(
  channelRuntime: NonNullable<ChannelGatewayContext["channelRuntime"]>,
  agentId: string,
): Promise<InstalledSkill[]> {
  // The channelRuntime is the full PluginRuntime surface for external plugins.
  // Cast to access the agent workspace and skill snapshot builder.
  const runtime = channelRuntime as unknown as {
    agent?: {
      resolveAgentWorkspaceDir?: (params: { cfg: unknown; agentId: string }) => string;
    };
    config?: {
      current?: () => unknown;
    };
  };

  try {
    if (!runtime.agent?.resolveAgentWorkspaceDir || !runtime.config?.current) {
      return [];
    }

    const cfg = runtime.config.current();
    const workspaceDir = runtime.agent.resolveAgentWorkspaceDir({ cfg, agentId });

    // Dynamically import the skill snapshot builder to avoid bundling it
    // into the plugin's static import graph.
    const { buildWorkspaceSkillSnapshot } = await import("openclaw/plugin-sdk/agent-harness").catch(
      () => ({ buildWorkspaceSkillSnapshot: null }),
    );

    if (!buildWorkspaceSkillSnapshot) {
      return [];
    }

    const snapshot = buildWorkspaceSkillSnapshot(workspaceDir, { config: cfg as never });
    const skills: InstalledSkill[] = (snapshot.skills ?? []).map(
      (skill: {
        id?: string;
        name?: string;
        description?: string;
        tags?: string[];
        examples?: string[];
        inputModes?: string[];
        outputModes?: string[];
      }) => ({
        id: String(skill.id ?? skill.name ?? ""),
        name: String(skill.name ?? ""),
        description: String(skill.description ?? ""),
        tags: Array.isArray(skill.tags) ? skill.tags.map(String) : [],
        ...(Array.isArray(skill.examples) ? { examples: skill.examples.map(String) } : {}),
        ...(Array.isArray(skill.inputModes) ? { inputModes: skill.inputModes.map(String) } : {}),
        ...(Array.isArray(skill.outputModes) ? { outputModes: skill.outputModes.map(String) } : {}),
      }),
    );

    return skills;
  } catch (err) {
    console.warn(`[agent-registry] getInstalledSkills: failed to resolve skills: ${String(err)}`);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Teardown helper
// ---------------------------------------------------------------------------

/**
 * Execute the full teardown sequence with a 10-second force-close deadline.
 * Requirements: 1.4, 4.5, 8.1, 11.5
 */
async function runTeardown(params: {
  statusAdapter: ReturnType<typeof createStatusAdapter>;
  heartbeatManager: ReturnType<typeof createHeartbeatManager>;
  arbiter: ReturnType<typeof createCollaborationArbiter>;
  registrationManager: ReturnType<typeof createRegistrationManager>;
  natsClient: ReturnType<typeof createNATSClient>;
  sessionTracker: SessionTracker;
  activeSubscriptions: NATSSubscription[];
}): Promise<void> {
  const {
    statusAdapter,
    heartbeatManager,
    arbiter,
    registrationManager,
    natsClient,
    sessionTracker,
    activeSubscriptions,
  } = params;

  const TEARDOWN_TIMEOUT_MS = 10_000;
  const DEREGISTER_TIMEOUT_MS = 5_000;
  const DRAIN_TIMEOUT_MS = 5_000;

  const forceCloseTimer = setTimeout(() => {
    console.error("[agent-registry] teardown exceeded 10 s — force-closing NATS connection");
    natsClient.close().catch(() => {});
  }, TEARDOWN_TIMEOUT_MS);

  try {
    // 1. Set status disconnected
    statusAdapter.setStatus("disconnected");

    // 2. Stop heartbeat
    heartbeatManager.stop();

    // 3. Dispose arbiter
    arbiter.dispose();

    // 4. Deregister (best-effort, 5 s timeout)
    await Promise.race([
      registrationManager.deregister(),
      new Promise<void>((resolve) => setTimeout(resolve, DEREGISTER_TIMEOUT_MS)),
    ]);

    // 5. Unsubscribe all active subscriptions
    for (const sub of activeSubscriptions) {
      try {
        sub.unsubscribe();
      } catch {
        // best-effort
      }
    }
    activeSubscriptions.length = 0;
    await natsClient.unsubscribeAll();

    // 6. Drain (5 s)
    await natsClient.drain(DRAIN_TIMEOUT_MS);

    // 7. Close
    await natsClient.close();

    // Clear session tracker
    sessionTracker.clear();
  } finally {
    clearTimeout(forceCloseTimer);
  }
}

// ---------------------------------------------------------------------------
// Plugin assembly
// ---------------------------------------------------------------------------

export const agentRegistryPlugin: ChannelPlugin<ResolvedAgentRegistryAccount> =
  createChatChannelPlugin({
    base: {
      id: "agent-registry",
      meta: {
        id: "agent-registry",
        label: "Agent Registry",
        selectionLabel: "Agent Registry (A2A)",
        docsPath: "/channels/agent-registry",
        docsLabel: "agent-registry",
        blurb: "A2A Agent Registry channel via NATS JetStream.",
        order: 200,
      },
      capabilities: {
        chatTypes: ["direct"],
        polls: false,
        threads: false,
        media: false,
        reactions: false,
        edit: false,
        reply: false,
      },
      config: {
        listAccountIds: () => ["default"],
        resolveAccount: (_cfg, accountId) => ({
          accountId: accountId ?? "default",
        }),
        isEnabled: (_account, cfg) => {
          // Enabled when the AGENT_REGISTRY_NATS_URL env var is present
          // (the channel is activated by env vars, not by config keys).
          const channels = (cfg as Record<string, unknown>)["channels"] as
            | Record<string, unknown>
            | undefined;
          const channelCfg = channels?.["agent-registry"] as Record<string, unknown> | undefined;
          return channelCfg?.["enabled"] !== false;
        },
        isConfigured: () => {
          return Boolean(process.env["AGENT_REGISTRY_NATS_URL"]);
        },
      },
      setup: {
        applyAccountConfig: (params) => params.cfg,
      },
      gateway: {
        startAccount: async (ctx: ChannelGatewayContext<ResolvedAgentRegistryAccount>) => {
          const { cfg, abortSignal, log, channelRuntime } = ctx;

          log?.info?.("[agent-registry] Starting Agent Registry channel...");

          const statusAdapter = createStatusAdapter();
          const sessionTracker = new SessionTracker();
          const activeSubscriptions: NATSSubscription[] = [];

          // ----------------------------------------------------------------
          // Step 1: Parse config
          // ----------------------------------------------------------------
          let config: AgentRegistryConfig;
          try {
            config = parseConfig(process.env);
            log?.info?.(
              `[agent-registry] Configuration parsed successfully. agentId="${config.agentId}", natsUrl="${config.natsUrl}"`,
            );
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log?.error?.(`[agent-registry] configuration error: ${message}`);
            statusAdapter.setStatus("unavailable");
            return;
          }

          const boundAgentId = config.boundAgentId ?? "default";

          // -------------------------------          // ----------------------------------------------------------------
          // Step 2: Spawn worker and setup proxy NATS client
          // ----------------------------------------------------------------
          statusAdapter.setStatus("connecting");
          log?.info?.(`[agent-registry] Initializing NATS client via worker thread...`);

          const getInstalledSkills = async (): Promise<InstalledSkill[]> => {
            if (!channelRuntime) return [];
            return getInstalledSkillsFromRuntime(channelRuntime, boundAgentId);
          };

          const getAgentDescription = async (): Promise<string> => {
            if (!channelRuntime) {
              log?.warn?.(
                `[agent-registry] getAgentDescription: channelRuntime unavailable — falling back to agent name`,
              );
              return config.agentName;
            }
            const rt = channelRuntime as unknown as {
              agent?: {
                resolveAgentWorkspaceDir?: (cfg: unknown, agentId: string) => string;
              };
              config?: { current?: () => unknown };
            };
            const rtCfg = rt.config?.current?.() ?? {};
            const workspaceDir = rt.agent?.resolveAgentWorkspaceDir?.(rtCfg, boundAgentId) ?? null;

            log?.info?.(
              `[agent-registry] getAgentDescription: boundAgentId="${boundAgentId}" workspaceDir=${workspaceDir ?? "(null)"}`,
            );

            if (!workspaceDir) {
              log?.warn?.(
                `[agent-registry] getAgentDescription: could not resolve workspace dir for agent "${boundAgentId}" — falling back to agent name`,
              );
              return config.agentName;
            }
            try {
              const { readFile } = await import("node:fs/promises");
              const { join } = await import("node:path");
              const agentsMdPath = join(workspaceDir, "AGENTS.md");
              log?.info?.(
                `[agent-registry] getAgentDescription: reading AGENTS.md from "${agentsMdPath}"`,
              );
              const content = await readFile(agentsMdPath, "utf8");
              if (!content) {
                log?.warn?.(
                  `[agent-registry] getAgentDescription: AGENTS.md is empty at "${agentsMdPath}" — falling back to agent name`,
                );
                return config.agentName;
              }
              log?.info?.(
                `[agent-registry] getAgentDescription: loaded AGENTS.md (${content.length} chars, truncated to 4000)`,
              );
              return content.slice(0, 4000);
            } catch (err) {
              log?.warn?.(
                `[agent-registry] getAgentDescription: failed to read AGENTS.md for agent "${boundAgentId}": ${String(err)} — falling back to agent name`,
              );
              return config.agentName;
            }
          };

          const skills = (await getInstalledSkills()).map((s) => s.name);
          const description = await getAgentDescription();

          const workerUrl = resolveWorkerUrl(import.meta.url);
          log?.info?.(`[agent-registry] Spawning worker thread from URL: ${workerUrl.href}`);
          const worker = new Worker(workerUrl);

          let effectiveAgentId = config.agentId;
          let workerTopics: any = null;
          let workerTtlMs = 150000;

          const handlers = new Map<string, Set<(bytes: Uint8Array) => void>>();

          const natsClient = {
            connect: async (): Promise<void> => {
              worker.on("message", (msg: any) => {
                if (msg.type === "MESSAGE") {
                  const subjectHandlers = handlers.get(msg.subject);
                  if (subjectHandlers) {
                    for (const handler of subjectHandlers) {
                      try {
                        handler(msg.payload);
                      } catch (err) {
                        log?.error?.(
                          `[agent-registry] handler threw on subject "${msg.subject}": ${String(err)}`,
                        );
                      }
                    }
                  }
                } else if (msg.type === "STATUS") {
                  statusAdapter.setStatus(msg.status);
                } else if (msg.type === "REGISTERED") {
                  if (msg.ok) {
                    effectiveAgentId = msg.agentId;
                    workerTopics = msg.topics;
                    workerTtlMs = msg.ttlMs;
                  }
                }
              });

              worker.postMessage({
                type: "START",
                config,
                skills,
                description,
              });

              return new Promise<void>((resolve, reject) => {
                let resolved = false;

                const onRegisterMsg = (msg: any) => {
                  if (msg.type === "REGISTERED") {
                    if (msg.ok) {
                      worker.off("message", onRegisterMsg);
                      worker.off("error", onError);
                      worker.off("exit", onExit);
                      resolved = true;
                      resolve();
                    } else if (!msg.willRetry) {
                      // Terminal failure — worker will not retry
                      worker.off("message", onRegisterMsg);
                      worker.off("error", onError);
                      worker.off("exit", onExit);
                      reject(new Error(msg.error || "Worker registration failed"));
                    }
                    // If willRetry is true, keep listening — worker will send
                    // another REGISTERED message when it succeeds.
                  }
                };

                const onError = (err: Error) => {
                  worker.off("message", onRegisterMsg);
                  worker.off("error", onError);
                  worker.off("exit", onExit);
                  reject(err);
                };

                const onExit = (code: number) => {
                  worker.off("message", onRegisterMsg);
                  worker.off("error", onError);
                  worker.off("exit", onExit);
                  if (!resolved) {
                    reject(new Error(`Worker exited with code ${code} before registration`));
                  }
                };

                worker.on("message", onRegisterMsg);
                worker.on("error", onError);
                worker.on("exit", onExit);
              });
            },
            publish: (subject: string, payload: Uint8Array): void => {
              worker.postMessage({ type: "PUBLISH", subject, payload });
            },
            subscribe: (subject: string, handler: (msg: Uint8Array) => void): NATSSubscription => {
              let subjectHandlers = handlers.get(subject);
              if (!subjectHandlers) {
                subjectHandlers = new Set();
                handlers.set(subject, subjectHandlers);
                worker.postMessage({ type: "SUBSCRIBE", subject });
              }
              subjectHandlers.add(handler);

              return {
                subject,
                unsubscribe: () => {
                  const sh = handlers.get(subject);
                  if (sh) {
                    sh.delete(handler);
                    if (sh.size === 0) {
                      handlers.delete(subject);
                      worker.postMessage({ type: "UNSUBSCRIBE", subject });
                    }
                  }
                },
              };
            },
            unsubscribeAll: async (): Promise<void> => {
              handlers.clear();
            },
            drain: async (timeoutMs: number): Promise<void> => {
              // Worker handles drain on stop
            },
            close: async (): Promise<void> => {
              worker.postMessage({ type: "STOP" });
              return new Promise<void>((resolve) => {
                worker.once("exit", () => resolve());
              });
            },
            newInbox: (): string => {
              return createInbox();
            },
            get isConnected(): boolean {
              return true;
            },
          };

          sessionTracker.onActiveTaskCountChange = (totalActiveTasks) => {
            worker.postMessage({ type: "UPDATE_SESSION_COUNT", count: totalActiveTasks });
          };

          try {
            await natsClient.connect();
            log?.info?.("[agent-registry] Worker-based connection and registration established.");
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log?.error?.(`[agent-registry] worker initialization failed: ${message}`);
            statusAdapter.setStatus("unavailable");
            return;
          }

          const registrationManager = {
            register: async () => ({
              ok: true as const,
              agentId: effectiveAgentId,
              topics: workerTopics,
              ttlMs: workerTtlMs,
            }),
            deregister: async () => {},
          };

          const heartbeatManager = {
            start: (intervalMs: number) => {},
            stop: () => {},
            get isRunning() {
              return true;
            },
          };

          const outboundAdapter = createOutboundAdapter({
            getAgentId: () => effectiveAgentId,
            natsClient,
          });

          // ----------------------------------------------------------------
          // Inject agentRegistry helpers into channelRuntime so Agent skills
          // can call runtime.agentRegistry.createCowork() directly.
          // NOTE: moved below messageRouter creation so the subscription
          // handler can close over the fully constructed messageRouter.
          // ----------------------------------------------------------------

          // Mutable session key override — set by createAgentSession.dispatch()
          // when an inbound envelope carries a session field, consumed by
          // resolveAgentRoute to route to the correct OpenClaw session.
          let pendingSessionKeyOverride: string | undefined;

          // Tracks session keys that are active outbound sessions on this instance.
          // Used by the MessageRouter to distinguish same-session loopbacks (discard)
          // from cross-session communication (process) when source === self.
          const activeOutboundSessions = new Set<string>();

          type DirectDmRuntimeShape = Parameters<
            typeof dispatchInboundDirectDmWithRuntime
          >[0]["runtime"];
          const directDmRuntime: DirectDmRuntimeShape = {
            channel: {
              ...channelRuntime,
              routing: {
                ...channelRuntime.routing,
                resolveAgentRoute: (routeParams: any) => {
                  const route = channelRuntime.routing.resolveAgentRoute(routeParams);
                  if (boundAgentId) {
                    route.agentId = boundAgentId;

                    if (pendingSessionKeyOverride) {
                      // Use the session key derived from inbound envelope.session
                      route.sessionKey = pendingSessionKeyOverride;
                      route.mainSessionKey = buildAgentMainSessionKey({
                        agentId: boundAgentId,
                        mainKey: "main",
                      }).toLowerCase();
                      route.lastRoutePolicy = "session";
                    } else {
                      const dmScope = routeParams.cfg?.session?.dmScope ?? "main";
                      const identityLinks = routeParams.cfg?.session?.identityLinks;

                      route.sessionKey = buildAgentSessionKey({
                        agentId: boundAgentId,
                        channel: routeParams.channel,
                        accountId: routeParams.accountId,
                        peer: routeParams.peer,
                        dmScope,
                        identityLinks,
                      }).toLowerCase();

                      route.mainSessionKey = buildAgentMainSessionKey({
                        agentId: boundAgentId,
                        mainKey: "main",
                      }).toLowerCase();

                      route.lastRoutePolicy =
                        route.sessionKey === route.mainSessionKey ? "main" : "session";
                    }
                  }
                  return route;
                },
              },
            } as any,
          };

          // Session override controller — bridges createAgentSession dispatch
          // with the resolveAgentRoute override above.
          const sessionOverrideCtrl = {
            set: (key: string | undefined) => {
              pendingSessionKeyOverride = key;
            },
            resolveStorePath: () => {
              try {
                return channelRuntime.session.resolveStorePath(cfg.session?.store);
              } catch {
                return "";
              }
            },
            readSessionUpdatedAt: (storePath: string, sessionKey: string) => {
              if (!storePath) return undefined;
              try {
                return channelRuntime.session.readSessionUpdatedAt({ storePath, sessionKey });
              } catch {
                return undefined;
              }
            },
          };

          // Session factory functions for the router
          const createSession = (sourceAgentId: string, _agentId: string): AgentSession => {
            const key = `unicast:${sourceAgentId}`;
            const existing = sessionTracker.get(key);
            if (existing) return existing;
            return createAgentSession({
              sessionKey: key,
              sessionContextKind: "unicast",
              agentId: config.agentId,
              boundAgentId,
              config,
              cfg,
              channelRuntime: directDmRuntime,
              outboundAdapter,
              sessionTracker,
              sessionOverrideCtrl,
              activeOutboundSessions,
            });
          };

          const getOrCreateSession = (
            key: string,
            _agentId: string,
            envelope?: RegistryEnvelope,
          ): AgentSession => {
            const existing = sessionTracker.get(key);
            if (existing) {
              return existing;
            }
            // Detect session kind from key prefix so the OutboundAdapter routes
            // responses to the correct NATS subject:
            //   cw-*    → a2a.cowork.{coworkId}
            //   anything else → a2a.agent.unicast.{source}
            const kind: "cowork" | "unicast" =
              key.startsWith("cw-") || key.startsWith("cowork-") ? "cowork" : "unicast";

            // Derive fixedOpenClawSessionKey from the envelope's session field
            // at creation time. This binds the AgentSession to a specific OpenClaw
            // session key, eliminating the pendingSessionKeyOverride race condition.
            let fixedOpenClawSessionKey: string | undefined;
            const envelopeSession = envelope?.session;
            if (envelopeSession) {
              const parts = envelopeSession.split(":");
              // Format: agent:{agentId}:group:{sessionUuid}
              if (parts.length >= 4 && parts[0] === "agent" && parts[2] === "group") {
                const sessionUuid = parts.slice(3).join(":");
                fixedOpenClawSessionKey = `agent:${boundAgentId}:group:${sessionUuid}`;
              }
            }

            return createAgentSession({
              sessionKey: key,
              sessionContextKind: kind,
              agentId: config.agentId,
              boundAgentId,
              config,
              cfg,
              channelRuntime: directDmRuntime,
              outboundAdapter,
              sessionTracker,
              sessionOverrideCtrl,
              activeOutboundSessions,
              fixedOpenClawSessionKey,
            });
          };

          const getLeastLoadedSession = (_agentId: string): AgentSession => {
            let leastLoaded: AgentSession | undefined;
            let minCount = Infinity;
            for (const [, session] of sessionTracker["sessions"]) {
              if (session.activeTaskCount < minCount) {
                minCount = session.activeTaskCount;
                leastLoaded = session;
              }
            }
            if (!leastLoaded) {
              throw new Error("No sessions available");
            }
            return leastLoaded;
          };

          // A mutable reference to the message router, used by the arbiter's
          // createCollaborationTopicHandler and by the agentRegistry injection
          // below. Both are resolved at call-time (well after startup), so
          // messageRouter is guaranteed to be set when they execute.
          let messageRouterRef: ReturnType<typeof createMessageRouter> | null = null;

          const arbiter = createCollaborationArbiter({
            boundAgentId,
            getEffectiveAgentId: () => effectiveAgentId,
            natsClient,
            createArbiterSession: (_agentId: string): AgentSession => {
              if (!channelRuntime) {
                // Stub session when channelRuntime is unavailable
                const stub: AgentSession = {
                  dispatch: async () => {},
                  get activeTaskCount() {
                    return 0;
                  },
                };
                return stub;
              }
              const arbiterSession = createArbiterSessionImpl({
                agentId: config.agentId,
                boundAgentId,
                channelRuntime,
                sessionTracker,
              });
              // Wrap ArbiterSession as AgentSession
              const agentSession: AgentSession = {
                dispatch: async (envelope: RegistryEnvelope) => {
                  const text =
                    typeof envelope.payload["text"] === "string"
                      ? envelope.payload["text"]
                      : typeof envelope.payload["message"] === "string"
                        ? envelope.payload["message"]
                        : JSON.stringify(envelope.payload);
                  // For arbiter sessions, dispatch is a no-op since
                  // sendAndAwaitResponse is used directly by the arbiter.
                  void text;
                },
                get activeTaskCount() {
                  return 0;
                },
              };
              // Attach sendAndAwaitResponse and dispose to the session
              // so the arbiter can use it as an ArbiterSession.
              (agentSession as unknown as ArbiterSession).sendAndAwaitResponse =
                arbiterSession.sendAndAwaitResponse.bind(arbiterSession);
              (agentSession as unknown as ArbiterSession).dispose =
                arbiterSession.dispose.bind(arbiterSession);
              return agentSession;
            },
            configuredSkills: config.skills,
            /**
             * Returns the inbound message handler for a given collaboration topic.
             * Closes over `messageRouterRef` which is set immediately after
             * createMessageRouter() returns. By the time any broadcast arrives and
             * the arbiter decides to join, messageRouterRef is always non-null.
             */
            createCollaborationTopicHandler: (topic: string) => {
              return (bytes: Uint8Array): void => {
                if (messageRouterRef) {
                  messageRouterRef.createInboundHandler(topic)(bytes);
                } else {
                  console.warn(
                    `[agent-registry] arbiter: createCollaborationTopicHandler called before messageRouter was ready — topic="${topic}"`,
                  );
                }
              };
            },
            /**
             * Build capability context from the bound agent's AGENTS.md and TOOLS.md.
             * Injected into every collaboration decision prompt so the LLM can reason
             * about whether the agent is a good fit based on its actual role and skills.
             * Files are truncated to keep prompt size within llm.complete limits.
             */
            getCapabilityContext: async (): Promise<string> => {
              if (!channelRuntime) return "";
              const rt = channelRuntime as unknown as {
                agent?: {
                  resolveAgentWorkspaceDir?: (cfg: unknown, agentId: string) => string;
                };
                config?: { current?: () => unknown };
              };
              const rtCfg = rt.config?.current?.() ?? {};
              const workspaceDir =
                rt.agent?.resolveAgentWorkspaceDir?.(rtCfg, boundAgentId) ?? null;
              if (!workspaceDir) return "";

              const { readFile } = await import("node:fs/promises");
              const { join } = await import("node:path");
              async function readWorkspaceFile(filename: string): Promise<string> {
                try {
                  return await readFile(join(workspaceDir!, filename), "utf8");
                } catch {
                  return "";
                }
              }

              const [agentsMd, toolsMd] = await Promise.all([
                readWorkspaceFile("AGENTS.md"),
                readWorkspaceFile("TOOLS.md"),
              ]);

              const parts: string[] = [];
              // Truncate to avoid overflowing llm.complete context window
              if (agentsMd) {
                parts.push(`### Operating Instructions (AGENTS.md)\n${agentsMd.slice(0, 3000)}`);
              }
              if (toolsMd) {
                parts.push(`### Tool Notes (TOOLS.md)\n${toolsMd.slice(0, 1000)}`);
              }
              return parts.join("\n\n");
            },
          });

          const messageRouter = createMessageRouter({
            boundAgentId,
            natsClient,
            arbiter,
            createSession,
            getOrCreateSession,
            getLeastLoadedSession,
            getEffectiveAgentId: () => effectiveAgentId,
            activeOutboundSessions,
          });

          // Resolve the deferred router reference so arbiter and agentRegistry
          // injection closures can use it at call-time.
          messageRouterRef = messageRouter;

          // ----------------------------------------------------------------
          // Inject agentRegistry helpers into channelRuntime so Agent skills
          // can call runtime.agentRegistry.createCowork() directly.
          //
          // This runs AFTER messageRouter is created so the subscription
          // handler can close over the fully constructed router.
          //
          // When createCowork() succeeds, the creator
          // immediately subscribes to the returned topic via the MessageRouter
          // so that incoming messages from joining agents are handled as proper
          // collaboration sessions (Gap 2 fix).
          // ----------------------------------------------------------------
          if (channelRuntime) {
            const rt = channelRuntime as Record<string, unknown>;
            const agentRegistryApi = {
              createCowork: async (params: CreateCoworkParams) => {
                const result = await createCowork(params, effectiveAgentId, natsClient);
                if (result.ok && params.senderSessionKey && activeOutboundSessions) {
                  activeOutboundSessions.add(params.senderSessionKey);
                }
                if (result.ok) {
                  // Creator subscribes to the cowork topic so that messages
                  // from joining agents are routed through the MessageRouter and
                  // dispatched to a proper collaboration AgentSession.
                  const handler = messageRouter.createInboundHandler(result.topic);
                  activeSubscriptions.push(natsClient.subscribe(result.topic, handler));
                  log?.info?.(
                    `[agent-registry] creator subscribed to cowork topic "${result.topic}"`,
                  );
                }
                return result;
              },

              sendMessage: (params: SendMessageParams) => {
                if (params.senderSessionKey && activeOutboundSessions) {
                  activeOutboundSessions.add(params.senderSessionKey);
                }
                return sendMessage(params, effectiveAgentId, natsClient);
              },

              sendCoworkMessage: (params: SendCoworkMessageParams) => {
                if (params.senderSessionKey && activeOutboundSessions) {
                  activeOutboundSessions.add(params.senderSessionKey);
                }
                return sendCoworkMessage(params, effectiveAgentId, natsClient);
              },

              discoverAgents: async (params?: DiscoverAgentsParams) => {
                return discoverAgents(params ?? {}, effectiveAgentId, natsClient);
              },
            };
            rt["agentRegistry"] = agentRegistryApi;

            // Bridge the runtime to the registered tools so they can call
            // the same API at tool-execution time.
            setAgentRegistryToolRuntime(agentRegistryApi);
          }

          // ----------------------------------------------------------------
          // Step 3: Register with the Agent Registry
          // ----------------------------------------------------------------
          statusAdapter.setStatus("registering");
          log?.info?.(
            `[agent-registry] Registering agent "${config.agentId}" with the Agent Registry...`,
          );

          const registerResult = await registrationManager.register();
          if (!registerResult.ok) {
            log?.error?.(
              `[agent-registry] registration failed: ${registerResult.error ?? "unknown error"}`,
            );
            statusAdapter.setStatus("unavailable");
            await natsClient.close().catch(() => {});
            return;
          }

          // Update the effective agent_id from the registry response.
          // This may differ from config.agentId if a suffix was assigned.
          effectiveAgentId = registerResult.agentId ?? config.agentId;

          const topics = registerResult.topics!;
          const ttlMs = registerResult.ttlMs!;
          log?.info?.(
            `[agent-registry] Registration successful. effectiveAgentId="${effectiveAgentId}", unicast="${topics.unicast}", broadcast="${topics.broadcast}", TTL: ${ttlMs}ms.`,
          );

          // ----------------------------------------------------------------
          // Step 4: Subscribe to topics
          // ----------------------------------------------------------------

          const subscribeToTopics = (topicAssignment: typeof topics): void => {
            // Unicast topic
            try {
              log?.info?.(
                `[agent-registry] Subscribing to unicast topic: "${topicAssignment.unicast}"`,
              );
              const unicastSub = natsClient.subscribe(
                topicAssignment.unicast,
                messageRouter.createInboundHandler(topicAssignment.unicast),
              );
              activeSubscriptions.push(unicastSub);
            } catch (err) {
              log?.error?.(
                `[agent-registry] failed to subscribe to unicast topic ${topicAssignment.unicast}: ${String(err)}`,
              );
              statusAdapter.setStatus("unavailable");
            }

            // Multicast topics
            for (const multicastTopic of topicAssignment.multicast) {
              try {
                log?.info?.(`[agent-registry] Subscribing to multicast topic: "${multicastTopic}"`);
                const multicastSub = natsClient.subscribe(
                  multicastTopic,
                  messageRouter.createInboundHandler(multicastTopic),
                );
                activeSubscriptions.push(multicastSub);
              } catch (err) {
                log?.error?.(
                  `[agent-registry] failed to subscribe to multicast topic ${multicastTopic}: ${String(err)}`,
                );
                // Requirement 4.4: log error for that topic and continue
              }
            }

            // Broadcast topic
            try {
              log?.info?.(
                `[agent-registry] Subscribing to broadcast topic: "${topicAssignment.broadcast}"`,
              );
              const broadcastSub = natsClient.subscribe(
                topicAssignment.broadcast,
                messageRouter.createInboundHandler(topicAssignment.broadcast),
              );
              activeSubscriptions.push(broadcastSub);
            } catch (err) {
              log?.error?.(
                `[agent-registry] failed to subscribe to broadcast topic ${topicAssignment.broadcast}: ${String(err)}`,
              );
              statusAdapter.setStatus("unavailable");
            }
          };

          subscribeToTopics(topics);

          // ----------------------------------------------------------------
          // Step 5: Start heartbeat
          // ----------------------------------------------------------------
          log?.info?.(`[agent-registry] Starting heartbeat manager (interval: ${ttlMs}ms)...`);
          heartbeatManager.start(ttlMs);

          // ----------------------------------------------------------------
          // Step 6: Initialize arbiter
          // ----------------------------------------------------------------
          log?.info?.("[agent-registry] Initializing collaboration arbiter...");
          await arbiter.initialize();

          // ----------------------------------------------------------------
          // Step 7: Set status registered
          // ----------------------------------------------------------------
          statusAdapter.setStatus("registered");
          log?.info?.(`[agent-registry] registered as agent_id="${effectiveAgentId}"`);

          // ----------------------------------------------------------------
          // Reconnect handler
          // ----------------------------------------------------------------
          const handleReconnect = async (): Promise<void> => {
            if (abortSignal.aborted) return;

            statusAdapter.setStatus("registering");

            // Re-register
            const reRegisterResult = await registrationManager.register();
            if (!reRegisterResult.ok) {
              log?.error?.(
                `[agent-registry] re-registration failed: ${reRegisterResult.error ?? "unknown error"}`,
              );
              statusAdapter.setStatus("unavailable");
              return;
            }

            // Update effective agent_id on re-registration
            effectiveAgentId = reRegisterResult.agentId ?? config.agentId;

            const newTopics = reRegisterResult.topics!;
            const newTtlMs = reRegisterResult.ttlMs!;

            // Unsubscribe old topics
            for (const sub of activeSubscriptions) {
              try {
                sub.unsubscribe();
              } catch {
                // best-effort
              }
            }
            activeSubscriptions.length = 0;

            // Re-subscribe to new topics
            subscribeToTopics(newTopics);

            // Restart heartbeat with new TTL
            heartbeatManager.start(newTtlMs);

            statusAdapter.setStatus("registered");
            log?.info?.(`[agent-registry] re-registered as agent_id="${effectiveAgentId}"`);
          };

          // ----------------------------------------------------------------
          // Wait for stop signal
          // ----------------------------------------------------------------
          await waitUntilAbort(abortSignal);

          // ----------------------------------------------------------------
          // Teardown
          // ----------------------------------------------------------------
          await runTeardown({
            statusAdapter,
            heartbeatManager,
            arbiter,
            registrationManager,
            natsClient,
            sessionTracker,
            activeSubscriptions,
          });

          // Clear the tool runtime bridge so tools fail gracefully after stop.
          setAgentRegistryToolRuntime(null);

          log?.info?.("[agent-registry] stopped");
        },
      },
    },
  });
