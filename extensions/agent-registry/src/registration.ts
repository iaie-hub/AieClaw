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
  buildAgentCard(): Promise<AgentCard>;
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
  const { config, natsClient, getInstalledSkills } = options;

  let _assignedTopics: TopicAssignment | null = null;
  let _ttlMs: number | null = null;

  // -------------------------------------------------------------------------
  // buildAgentCard
  // -------------------------------------------------------------------------

  async function buildAgentCard(): Promise<AgentCard> {
    log.debug(`building AgentCard`, { agentId: config.agentId, configuredSkills: config.skills });

    const installedSkills: InstalledSkill[] = await getInstalledSkills();
    log.debug(`resolved installed skills`, { count: installedSkills.length, names: installedSkills.map(s => s.name) });

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
        log.warn(`skill name not found in installed skills — skipping`, { skillName: configuredName });
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
      description: "", // No description configured
      version: "1.0.0",
      url: `nats://a2a.agent.unicast.${config.agentId}`,
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
      agent_id: config.agentId, // Requirement 2.2
      mac: "00:00:00:00:00:00", // Requirement 2.5 — never expose host MAC
      transport: "mq", // Requirement 2.4
      status: "online",
    };

    log.info(`AgentCard built`, {
      agent_id: card.agent_id,
      name: card.name,
      transport: card.transport,
      skillCount: card.skills.length,
      skills: card.skills.map(s => s.name),
    });

    return card;
  }

  // -------------------------------------------------------------------------
  // register
  // -------------------------------------------------------------------------

  async function register(): Promise<RegisterResult> {
    log.info(`starting registration`, { agentId: config.agentId, agentName: config.agentName });

    let card: AgentCard;
    try {
      card = await buildAgentCard();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`failed to build AgentCard`, message);
      console.error(`[agent-registry] register: failed to build AgentCard: ${message}`);
      return { ok: false, error: message };
    }

    // Requirement 3.2: wrap AgentCard in RegistryEnvelope with action "register".
    const envelope = createEnvelope({
      request_id: uuidv4(),
      message_type: "req",
      source: config.agentId,
      seq: 0,
      action: "register",
      resource_type: "agent",
      payload: card as unknown as Record<string, unknown>,
      reply_to: null,
    });

    log.debug(`sending registration request`, { subject: "registry.agent.register", messageId: envelope.message_id });

    const requestBytes = serializeEnvelope(envelope);

    let responseBytes: Uint8Array;
    try {
      // Requirement 3.1: publish to "registry.agent.register" with 10 s timeout.
      responseBytes = await natsClient.request(
        "registry.agent.register",
        requestBytes,
        10000,
      );
    } catch (err) {
      // Requirement 3.5: log failure reason on timeout or publish failure.
      const message = err instanceof Error ? err.message : String(err);
      log.error(`registration request failed`, { subject: "registry.agent.register", error: message });
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
      console.error(
        `[agent-registry] register: failed to parse RegisterResponse: ${message}`,
      );
      return { ok: false, error: message };
    }

    log.debug(`received registration response`, {
      action: responseEnvelope.action,
      source: responseEnvelope.source,
      payload: responseEnvelope.payload,
    });

    const payload = responseEnvelope.payload as {
      success?: boolean;
      topics?: TopicAssignment;
      ttl?: number;
      error?: string;
    };

    if (payload.success === true) {
      // Requirement 3.3: store assigned topics and TTL on success.
      const topics = payload.topics as TopicAssignment;
      const ttlMs = payload.ttl as number;
      _assignedTopics = topics;
      _ttlMs = ttlMs;
      log.info(`registration successful`, {
        agentId: config.agentId,
        unicast: topics.unicast,
        multicast: topics.multicast,
        broadcast: topics.broadcast,
        ttlMs,
        heartbeatIntervalMs: Math.floor(ttlMs / 3),
      });
      return { ok: true, topics, ttlMs };
    } else {
      // Requirement 3.4: log error field from response, return ok: false.
      const errorMsg = payload.error ?? "Registry returned success=false with no error message";
      log.error(`Registry rejected registration`, { agentId: config.agentId, error: errorMsg });
      console.error(
        `[agent-registry] register: Registry rejected registration: ${errorMsg}`,
      );
      return { ok: false, error: errorMsg };
    }
  }

  // -------------------------------------------------------------------------
  // deregister
  // -------------------------------------------------------------------------

  async function deregister(): Promise<void> {
    log.info(`sending deregistration request`, { agentId: config.agentId });

    // Requirement 8.2: wrap payload in RegistryEnvelope with action "deregister".
    const envelope = createEnvelope({
      request_id: uuidv4(),
      message_type: "req",
      source: config.agentId,
      seq: 0,
      action: "deregister",
      resource_type: "agent",
      payload: { agent_id: config.agentId },
      reply_to: null,
    });

    const requestBytes = serializeEnvelope(envelope);

    try {
      // Requirement 8.1: publish to "registry.agent.deregister" with 5 s timeout.
      await natsClient.request("registry.agent.deregister", requestBytes, 5000);
      log.info(`deregistration acknowledged`, { agentId: config.agentId });
    } catch (err) {
      // Requirement 8.3: log failure with agent_id and error reason; do not throw.
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`deregistration failed (proceeding with shutdown)`, { agentId: config.agentId, error: message });
      console.error(
        `[agent-registry] deregister: failed for agent_id="${config.agentId}": ${message}`,
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
