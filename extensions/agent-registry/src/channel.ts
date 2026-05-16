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

import { createChatChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import {
  dispatchInboundDirectDmWithRuntime,
} from "openclaw/plugin-sdk/direct-dm";
import { waitUntilAbort } from "openclaw/plugin-sdk/channel-lifecycle";
import type { ChannelPlugin } from "openclaw/plugin-sdk/channel-core";
import type { ChannelGatewayContext } from "openclaw/plugin-sdk/channel-contract";

import { parseConfig } from "./config.js";
import { createNATSClient } from "./nats-client.js";
import { createRegistrationManager } from "./registration.js";
import { createHeartbeatManager } from "./heartbeat.js";
import { createMessageRouter } from "./router.js";
import { createOutboundAdapter } from "./outbound.js";
import { createCollaborationArbiter } from "./arbiter.js";
import type { ArbiterSession } from "./arbiter.js";
import { createStatusAdapter } from "./status.js";
import { createDiscussion, createCotask } from "./discussion-initiator.js";
import type { CreateDiscussionParams, CreateCotaskParams } from "./discussion-initiator.js";
import type {
  AgentRegistryConfig,
  AgentSession,
  InstalledSkill,
  NATSSubscription,
  RegistryEnvelope,
} from "./types.js";

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
 */
class SessionTracker {
  readonly sessions = new Map<string, AgentSession>();

  add(key: string, session: AgentSession): void {
    this.sessions.set(key, session);
  }

  remove(key: string): void {
    this.sessions.delete(key);
  }

  get(key: string): AgentSession | undefined {
    return this.sessions.get(key);
  }

  count(): number {
    return this.sessions.size;
  }

  clear(): void {
    this.sessions.clear();
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
  agentId: string;
  boundAgentId: string;
  config: AgentRegistryConfig;
  cfg: Parameters<typeof dispatchInboundDirectDmWithRuntime>[0]["cfg"];
  channelRuntime: Parameters<typeof dispatchInboundDirectDmWithRuntime>[0]["runtime"];
  outboundAdapter: ReturnType<typeof createOutboundAdapter>;
  sessionTracker: SessionTracker;
}): AgentSession {
  const {
    sessionKey,
    agentId,
    cfg,
    channelRuntime,
    outboundAdapter,
    sessionTracker,
  } = params;

  let activeTaskCount = 0;

  const session: AgentSession = {
    async dispatch(envelope: RegistryEnvelope): Promise<void> {
      activeTaskCount++;
      try {
        const messageText = typeof envelope.payload["text"] === "string"
          ? envelope.payload["text"]
          : JSON.stringify(envelope.payload);

        const peer = { kind: "direct" as const, id: envelope.source || sessionKey };

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
            // Deliver the agent's response back via the outbound adapter
            const responseText =
              typeof payload === "object" && payload !== null && "text" in payload
                ? String((payload as Record<string, unknown>)["text"] ?? "")
                : "";

            if (responseText) {
              await outboundAdapter.send({
                responseText,
                inboundEnvelope: envelope,
                sessionContext: { kind: "unicast", sourceAgentId: envelope.source },
                sessionSeq: 0,
                isSessionComplete: false,
              });
            }
          },
          onRecordError: (err) => {
            console.error(`[agent-registry] session record error for ${sessionKey}: ${String(err)}`);
          },
          onDispatchError: (err, info) => {
            console.error(
              `[agent-registry] session dispatch error for ${sessionKey} (${info.kind}): ${String(err)}`,
            );
          },
        });
      } finally {
        activeTaskCount--;
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
      resolveAgentWorkspaceDir?: (params: {
        cfg: unknown;
        agentId: string;
      }) => string;
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
    const { buildWorkspaceSkillSnapshot } = await import(
      "openclaw/plugin-sdk/agent-harness"
    ).catch(() => ({ buildWorkspaceSkillSnapshot: null }));

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
    console.warn(
      `[agent-registry] getInstalledSkills: failed to resolve skills: ${String(err)}`,
    );
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
          const channelCfg = channels?.["agent-registry"] as
            | Record<string, unknown>
            | undefined;
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

          const statusAdapter = createStatusAdapter();
          const sessionTracker = new SessionTracker();
          const activeSubscriptions: NATSSubscription[] = [];

          // ----------------------------------------------------------------
          // Step 1: Parse config
          // ----------------------------------------------------------------
          let config: AgentRegistryConfig;
          try {
            config = parseConfig(process.env);
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log?.error?.(`[agent-registry] configuration error: ${message}`);
            statusAdapter.setStatus("unavailable");
            return;
          }

          const boundAgentId = config.boundAgentId ?? "default";

          // ----------------------------------------------------------------
          // Step 2: Connect to NATS
          // ----------------------------------------------------------------
          statusAdapter.setStatus("connecting");

          const natsClient = createNATSClient({
            url: config.natsUrl,
            token: config.natsToken,
            onDisconnect: () => {
              if (!abortSignal.aborted) {
                statusAdapter.setStatus("reconnecting");
                log?.warn?.("[agent-registry] NATS disconnected — reconnecting");
              }
            },
            onReconnect: () => {
              if (!abortSignal.aborted) {
                log?.info?.("[agent-registry] NATS reconnected — re-registering");
                // Re-register, replace topics, restart heartbeat, re-subscribe
                void handleReconnect().catch((err) => {
                  log?.error?.(
                    `[agent-registry] reconnect handler failed: ${String(err)}`,
                  );
                });
              }
            },
          });

          try {
            await natsClient.connect();
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            log?.error?.(
              `[agent-registry] failed to connect to NATS at ${config.natsUrl}: ${message}`,
            );
            statusAdapter.setStatus("unavailable");
            return;
          }

          // ----------------------------------------------------------------
          // Step 3: Build sub-modules
          // ----------------------------------------------------------------

          const getInstalledSkills = async (): Promise<InstalledSkill[]> => {
            if (!channelRuntime) return [];
            return getInstalledSkillsFromRuntime(channelRuntime, boundAgentId);
          };

          const registrationManager = createRegistrationManager({
            config,
            natsClient,
            getInstalledSkills,
          });

          const heartbeatManager = createHeartbeatManager({
            agentId: config.agentId,
            natsClient,
            getActiveSessionCount: () => sessionTracker.count(),
          });

          const outboundAdapter = createOutboundAdapter({
            agentId: config.agentId,
            natsClient,
          });

          // ----------------------------------------------------------------
          // Inject agentRegistry helpers into channelRuntime so Agent skills
          // can call runtime.agentRegistry.createDiscussion() directly.
          // ----------------------------------------------------------------
          if (channelRuntime) {
            const rt = channelRuntime as Record<string, unknown>;
            rt["agentRegistry"] = {
              createDiscussion: (params: CreateDiscussionParams) =>
                createDiscussion(params, config.agentId, natsClient),
              createCotask: (params: CreateCotaskParams) =>
                createCotask(params, config.agentId, natsClient),
            };
          }

          // Cast channelRuntime to the DirectDmRuntime shape.
          // For external channel plugins, the gateway injects the full
          // PluginRuntimeChannel surface which satisfies DirectDmRuntime.
          type DirectDmRuntimeShape = Parameters<typeof dispatchInboundDirectDmWithRuntime>[0]["runtime"];
          const directDmRuntime = channelRuntime as unknown as DirectDmRuntimeShape;

          // Session factory functions for the router
          const createSession = (sourceAgentId: string, _agentId: string): AgentSession => {
            const key = `unicast:${sourceAgentId}`;
            const existing = sessionTracker.get(key);
            if (existing) return existing;
            return createAgentSession({
              sessionKey: key,
              agentId: config.agentId,
              boundAgentId,
              config,
              cfg,
              channelRuntime: directDmRuntime,
              outboundAdapter,
              sessionTracker,
            });
          };

          const getOrCreateSession = (key: string, _agentId: string): AgentSession => {
            const existing = sessionTracker.get(key);
            if (existing) return existing;
            return createAgentSession({
              sessionKey: key,
              agentId: config.agentId,
              boundAgentId,
              config,
              cfg,
              channelRuntime: directDmRuntime,
              outboundAdapter,
              sessionTracker,
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

          const arbiter = createCollaborationArbiter({
            boundAgentId,
            natsClient,
            createArbiterSession: (_agentId: string): AgentSession => {
              if (!channelRuntime) {
                // Stub session when channelRuntime is unavailable
                const stub: AgentSession = {
                  dispatch: async () => {},
                  get activeTaskCount() { return 0; },
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
                  const text = typeof envelope.payload["text"] === "string"
                    ? envelope.payload["text"]
                    : JSON.stringify(envelope.payload);
                  // For arbiter sessions, dispatch is a no-op since
                  // sendAndAwaitResponse is used directly by the arbiter.
                  void text;
                },
                get activeTaskCount() { return 0; },
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
             * Build capability context from the bound agent's AGENTS.md and TOOLS.md.
             * Injected into every collaboration decision prompt so the LLM can reason
             * about whether the agent is a good fit based on its actual role and skills.
             * Files are truncated to keep prompt size within llm.complete limits.
             */
            getCapabilityContext: async (): Promise<string> => {
              if (!channelRuntime) return "";
              const rt = channelRuntime as unknown as {
                agent?: {
                  resolveAgentWorkspaceDir?: (params: { cfg: unknown; agentId: string }) => string;
                };
                config?: { current?: () => unknown };
              };
              const cfg = rt.config?.current?.() ?? {};
              const workspaceDir =
                rt.agent?.resolveAgentWorkspaceDir?.({ cfg, agentId: boundAgentId }) ?? null;
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
              if (agentsMd) { parts.push(`### Operating Instructions (AGENTS.md)\n${agentsMd.slice(0, 3000)}`); }
              if (toolsMd) { parts.push(`### Tool Notes (TOOLS.md)\n${toolsMd.slice(0, 1000)}`); }
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
          });

          // ----------------------------------------------------------------
          // Step 3: Register with the Agent Registry
          // ----------------------------------------------------------------
          statusAdapter.setStatus("registering");

          const registerResult = await registrationManager.register();
          if (!registerResult.ok) {
            log?.error?.(
              `[agent-registry] registration failed: ${registerResult.error ?? "unknown error"}`,
            );
            statusAdapter.setStatus("unavailable");
            await natsClient.close().catch(() => {});
            return;
          }

          const topics = registerResult.topics!;
          const ttlMs = registerResult.ttlMs!;

          // ----------------------------------------------------------------
          // Step 4: Subscribe to topics
          // ----------------------------------------------------------------

          const subscribeToTopics = (topicAssignment: typeof topics): void => {
            // Unicast topic
            try {
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
          heartbeatManager.start(ttlMs);

          // ----------------------------------------------------------------
          // Step 6: Initialize arbiter
          // ----------------------------------------------------------------
          await arbiter.initialize();

          // ----------------------------------------------------------------
          // Step 7: Set status registered
          // ----------------------------------------------------------------
          statusAdapter.setStatus("registered");
          log?.info?.(`[agent-registry] registered as agent_id="${config.agentId}"`);

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
            log?.info?.(`[agent-registry] re-registered as agent_id="${config.agentId}"`);
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

          log?.info?.("[agent-registry] stopped");
        },
      },
    },
  });
