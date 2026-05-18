/**
 * RegistrationManager — builds the AgentCard and manages register/deregister lifecycle.
 *
 * - buildAgentCard(): resolves configured skills from the installed skill registry,
 *   maps them to AgentSkill entries, and assembles the full AgentCard.
 * - register(): wraps the AgentCard in a RegistryEnvelope and sends it to
 *   "registry.agent.register" via NATS request-reply (10 s timeout).
 * - deregister(): sends a deregistration envelope to "registry.agent.deregister"
 *   (5 s timeout); logs failure but does not throw.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8,
 *               3.1, 3.2, 3.3, 3.4, 3.5, 3.6,
 *               8.1, 8.2, 8.3
 */

import { v4 as uuidv4 } from "uuid";
import { createEnvelope, deserializeEnvelope, serializeEnvelope } from "./envelope.js";
import { createLogger } from "./logger.js";
import type {
  AgentCard,
  AgentSkill,
  InstalledSkill,
  RegisterResult,
  RegistrationManagerOptions,
  TopicAssignment,
} from "./types.js";

const log = createLogger("registration");

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface RegistrationManager {
  buildAgentCard(agentId: string): Promise<AgentCard>;
  register(): Promise<RegisterResult>;
  deregister(): Promise<void>;
  readonly assignedTopics: TopicAssignment | null;
  readonly ttlMs: number | null;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a RegistrationManager bound to the given config and NATS client.
 *
 * Requirements: 2.1–2.8, 3.1–3.6, 8.1–8.3
 */
export function createRegistrationManager(
  options: RegistrationManagerOptions,
): RegistrationManager {
  const { config, natsClient, getInstalledSkills, getAgentDescription } = options;

  let _assignedTopics: TopicAssignment | null = null;
  let _ttlMs: number | null = null;
  /** The effective agent_id used for registration (base id + UUID suffix). */
  let _effectiveAgentId: string = `${config.agentId}-${uuidv4().slice(0, 8)}`;

  // -------------------------------------------------------------------------
  // buildAgentCard
  // -------------------------------------------------------------------------

  async function buildAgentCard(agentId: string): Promise<AgentCard> {
    log.debug(`building AgentCard`, { agentId, configuredSkills: config.skills });

    const [installedSkills, description] = await Promise.all([
      getInstalledSkills(),
      getAgentDescription ? getAgentDescription() : Promise.resolve(config.agentName),
    ]);
    log.debug(`resolved installed skills`, {
      count: installedSkills.length,
      names: installedSkills.map((s) => s.name),
    });

    // Build a lookup map by name for O(1) resolution.
    const skillByName = new Map<string, InstalledSkill>();
    for (const skill of installedSkills) {
      skillByName.set(skill.name, skill);
    }

    const skills: AgentSkill[] = [];

    for (const configuredName of config.skills) {
      const source = skillByName.get(configuredName);
      if (!source) {
        // Requirement 2.6: log warning for unresolved names, skip entry.
        log.warn(`skill name not found in installed skills — skipping`, {
          skillName: configuredName,
        });
        console.warn(
          `[agent-registry] buildAgentCard: skill name "${configuredName}" not found in installed skills — skipping`,
        );
        continue;
      }

      log.debug(`mapped skill`, { name: source.name, id: source.id, tags: source.tags });

      // Requirement 2.6: map id, name, description, tags always;
      // include examples/inputModes/outputModes only when present.
      const skill: AgentSkill = {
        id: source.id,
        name: source.name,
        description: source.description,
        tags: source.tags,
      };

      if (source.examples !== undefined) {
        skill.examples = source.examples;
      }
      if (source.inputModes !== undefined) {
        skill.inputModes = source.inputModes;
      }
      if (source.outputModes !== undefined) {
        skill.outputModes = source.outputModes;
      }

      skills.push(skill);
    }

    const card: AgentCard = {
      // A2A standard fields
      name: config.agentName, // Requirement 2.3
      description,
      version: "1.0.0",
      url: `nats://a2a.agent.unicast.${agentId}`,
      capabilities: {
        streaming: false,
        pushNotifications: false,
        longRunningOperations: true, // Requirement 2.7
        stateTransitionHistory: false,
      },
      skills,
      defaultInputModes: ["text/plain"],
      defaultOutputModes: ["text/plain"],
      // Registry extension fields
      agent_id: agentId,
      mac: "00:00:00:00:00:00", // Requirement 2.5 — never expose host MAC
      transport: "mq", // Requirement 2.4
      status: "online",
    };

    log.info(`AgentCard built`, {
      agent_id: card.agent_id,
      name: card.name,
      transport: card.transport,
      skillCount: card.skills.length,
      skills: card.skills.map((s) => s.name),
    });

    return card;
  }

  // -------------------------------------------------------------------------
  // register
  // -------------------------------------------------------------------------

  /** Maximum number of retries when agent_id conflicts occur. */
  const MAX_CONFLICT_RETRIES = 5;

  async function register(): Promise<RegisterResult> {
    log.info(`starting registration`, {
      baseAgentId: config.agentId,
      effectiveAgentId: _effectiveAgentId,
    });

    // Retry loop: on AGENT_ID_CONFLICT, regenerate the UUID suffix and retry.
    for (let attempt = 0; attempt <= MAX_CONFLICT_RETRIES; attempt++) {
      let card: AgentCard;
      try {
        card = await buildAgentCard(_effectiveAgentId);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error(`failed to build AgentCard`, message);
        console.error(`[agent-registry] register: failed to build AgentCard: ${message}`);
        return { ok: false, error: message };
      }

      const replyInbox = natsClient.newInbox();

      const envelope = createEnvelope({
        request_id: uuidv4(),
        message_type: "req",
        source: _effectiveAgentId,
        seq: 0,
        action: "register",
        resource_type: "agent",
        payload: card as unknown as Record<string, unknown>,
        reply_to: replyInbox,
      });

      log.debug(`sending registration request`, {
        subject: "registry.agent.register",
        messageId: envelope.message_id,
        agentId: _effectiveAgentId,
        attempt,
        replyInbox,
      });

      const requestBytes = serializeEnvelope(envelope);

      let responseBytes: Uint8Array;
      try {
        responseBytes = await new Promise<Uint8Array>((resolve, reject) => {
          const timer = setTimeout(() => {
            sub.unsubscribe();
            reject(new Error("registration request timed out after 10 s"));
          }, 10000);

          const sub = natsClient.subscribe(replyInbox, (bytes) => {
            clearTimeout(timer);
            sub.unsubscribe();
            resolve(bytes);
          });

          natsClient.publish("registry.agent.register", requestBytes);
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error(`registration request failed`, {
          subject: "registry.agent.register",
          error: message,
        });
        console.error(
          `[agent-registry] register: request to registry.agent.register failed: ${message}`,
        );
        return { ok: false, error: message };
      }

      let responseEnvelope;
      try {
        responseEnvelope = deserializeEnvelope(responseBytes);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error(`failed to parse RegisterResponse`, message);
        console.error(`[agent-registry] register: failed to parse RegisterResponse: ${message}`);
        return { ok: false, error: message };
      }

      log.debug(`received registration response`, {
        action: responseEnvelope.action,
        source: responseEnvelope.source,
        payload: responseEnvelope.payload,
      });

      const payload = responseEnvelope.payload as {
        success?: boolean;
        agent_id?: string;
        topics?: TopicAssignment;
        ttl?: number;
        error?: string;
      };

      if (payload.success === true) {
        const topics = payload.topics as TopicAssignment;
        const ttlMs = payload.ttl as number;
        const effectiveAgentId = payload.agent_id ?? _effectiveAgentId;
        _effectiveAgentId = effectiveAgentId;
        _assignedTopics = topics;
        _ttlMs = ttlMs;
        log.info(`registration successful`, {
          baseAgentId: config.agentId,
          effectiveAgentId,
          unicast: topics.unicast,
          multicast: topics.multicast,
          broadcast: topics.broadcast,
          ttlMs,
          heartbeatIntervalMs: Math.floor(ttlMs / 3),
        });
        return { ok: true, agentId: effectiveAgentId, topics, ttlMs };
      }

      // Check for AGENT_ID_CONFLICT — regenerate suffix and retry.
      if (payload.error === "AGENT_ID_CONFLICT" && attempt < MAX_CONFLICT_RETRIES) {
        const newSuffix = uuidv4().slice(0, 8);
        _effectiveAgentId = `${config.agentId}-${newSuffix}`;
        log.warn(`agent_id conflict — regenerating suffix and retrying`, {
          attempt: attempt + 1,
          newEffectiveAgentId: _effectiveAgentId,
        });
        continue;
      }

      // Non-conflict error or retries exhausted — fail.
      const errorMsg = payload.error ?? "Registry returned success=false with no error message";
      log.error(`Registry rejected registration`, { agentId: _effectiveAgentId, error: errorMsg });
      console.error(`[agent-registry] register: Registry rejected registration: ${errorMsg}`);
      return { ok: false, error: errorMsg };
    }

    // Should not reach here, but satisfy TypeScript.
    return { ok: false, error: "registration failed after max conflict retries" };
  }

  // -------------------------------------------------------------------------
  // deregister
  // -------------------------------------------------------------------------

  async function deregister(): Promise<void> {
    log.info(`sending deregistration request`, { agentId: _effectiveAgentId });

    const replyInbox = natsClient.newInbox();

    // Requirement 8.2: wrap payload in RegistryEnvelope with action "deregister".
    const envelope = createEnvelope({
      request_id: uuidv4(),
      message_type: "req",
      source: _effectiveAgentId,
      seq: 0,
      action: "deregister",
      resource_type: "agent",
      payload: { agent_id: _effectiveAgentId },
      reply_to: replyInbox,
    });

    const requestBytes = serializeEnvelope(envelope);

    try {
      // Requirement 8.1: publish to "registry.agent.deregister" with 5 s timeout.
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          sub.unsubscribe();
          reject(new Error("deregistration request timed out after 5 s"));
        }, 5000);

        const sub = natsClient.subscribe(replyInbox, (_bytes) => {
          clearTimeout(timer);
          sub.unsubscribe();
          resolve();
        });

        natsClient.publish("registry.agent.deregister", requestBytes);
      });
      log.info(`deregistration acknowledged`, { agentId: _effectiveAgentId });
    } catch (err) {
      // Requirement 8.3: log failure with agent_id and error reason; do not throw.
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`deregistration failed (proceeding with shutdown)`, {
        agentId: _effectiveAgentId,
        error: message,
      });
      console.error(
        `[agent-registry] deregister: failed for agent_id="${_effectiveAgentId}": ${message}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Return the manager object
  // -------------------------------------------------------------------------

  return {
    buildAgentCard,
    register,
    deregister,
    get assignedTopics(): TopicAssignment | null {
      return _assignedTopics;
    },
    get ttlMs(): number | null {
      return _ttlMs;
    },
  };
}
