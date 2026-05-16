/**
 * MessageRouter — dispatches inbound NATS messages to the appropriate
 * OpenClaw agent session based on the topic pattern.
 *
 * Topic patterns:
 *  - a2a.agent.unicast.*   → handleUnicast
 *  - a2a.agent.group.*     → handleMulticast
 *  - a2a.agent.broadcast.* → handleBroadcast
 *  - a2a.discussion.*      → handleCollaborationTopic (topicId = discussionId)
 *  - a2a.cotask.*          → handleCollaborationTopic (topicId = taskId)
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10
 */

import { deserializeEnvelope } from "./envelope.js";
import { createLogger, fmtEnvelope } from "./logger.js";
import type { MessageRouterOptions, RegistryEnvelope } from "./types.js";

const log = createLogger("router");

// ---------------------------------------------------------------------------
// MessageRouter interface
// ---------------------------------------------------------------------------

export interface MessageRouter {
  handleUnicast(envelope: RegistryEnvelope): Promise<void>;
  handleMulticast(envelope: RegistryEnvelope): Promise<void>;
  handleBroadcast(envelope: RegistryEnvelope): Promise<void>;
  handleCollaborationTopic(topicId: string, envelope: RegistryEnvelope): Promise<void>;
  /** Create an inbound message handler for a given topic. */
  createInboundHandler(topic: string): (bytes: Uint8Array) => void;
}

// ---------------------------------------------------------------------------
// Topic pattern matching helpers
// ---------------------------------------------------------------------------

/**
 * Return true when the topic matches the given prefix pattern.
 * e.g. matchesPrefix("a2a.agent.unicast.", "a2a.agent.unicast.agent-1") → true
 */
function matchesPrefix(prefix: string, topic: string): boolean {
  return topic.startsWith(prefix);
}

/**
 * Extract the trailing segment after the given prefix.
 * e.g. segmentAfter("a2a.discussion.", "a2a.discussion.disc-123") → "disc-123"
 */
function segmentAfter(prefix: string, topic: string): string {
  return topic.slice(prefix.length);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a MessageRouter that routes inbound NATS messages to the correct
 * OpenClaw agent session.
 *
 * Requirements: 6.1–6.10
 */
export function createMessageRouter(options: MessageRouterOptions): MessageRouter {
  const {
    boundAgentId,
    arbiter,
    createSession,
    getOrCreateSession,
    getLeastLoadedSession,
  } = options;

  // -------------------------------------------------------------------------
  // handleUnicast — Requirement 6.3
  // -------------------------------------------------------------------------

  async function handleUnicast(envelope: RegistryEnvelope): Promise<void> {
    log.info(`← unicast message`, {
      source: envelope.source,
      action: envelope.action,
      seq: envelope.seq,
      msg_id: envelope.message_id,
    });
    log.debug(`unicast envelope detail`, fmtEnvelope(envelope));
    const session = getOrCreateSession(envelope.source, boundAgentId);
    await session.dispatch(envelope);
  }

  // -------------------------------------------------------------------------
  // handleMulticast — Requirement 6.4
  // -------------------------------------------------------------------------

  async function handleMulticast(envelope: RegistryEnvelope): Promise<void> {
    log.info(`← multicast message`, {
      source: envelope.source,
      action: envelope.action,
      seq: envelope.seq,
      msg_id: envelope.message_id,
    });
    log.debug(`multicast envelope detail`, fmtEnvelope(envelope));
    let session;
    try {
      session = getLeastLoadedSession(boundAgentId);
      log.debug(`multicast: routed to least-loaded session`, { activeTasks: session.activeTaskCount });
    } catch {
      // No sessions exist — create a new one keyed by the sender source
      log.debug(`multicast: no existing sessions — creating new session for source=${envelope.source}`);
      session = createSession(envelope.source, boundAgentId);
    }
    await session.dispatch(envelope);
  }

  // -------------------------------------------------------------------------
  // handleBroadcast — Requirements 6.5, 6.6, 6.8
  // -------------------------------------------------------------------------

  async function handleBroadcast(envelope: RegistryEnvelope): Promise<void> {
    log.info(`← broadcast message`, {
      action: envelope.action,
      source: envelope.source,
      msg_id: envelope.message_id,
    });
    log.debug(`broadcast envelope detail`, fmtEnvelope(envelope));

    switch (envelope.action) {
      case "discussion.created":
        log.info(`broadcast: discussion.created — forwarding to arbiter`, {
          discussion_id: envelope.payload["discussion_id"] ?? envelope.payload["id"],
        });
        await arbiter.processDiscussionCreated(envelope.payload);
        break;

      case "cotask.created":
        log.info(`broadcast: cotask.created — forwarding to arbiter`, {
          task_id: envelope.payload["task_id"] ?? envelope.payload["id"],
        });
        await arbiter.processCotaskCreated(envelope.payload);
        break;

      default:
        // Requirement 6.8: log and discard unknown broadcast actions
        log.warn(`broadcast action not handled — discarding`, { action: envelope.action });
        console.info(
          `[agent-registry] router: broadcast action '${envelope.action}' — discarding`,
        );
        break;
    }
  }

  // -------------------------------------------------------------------------
  // handleCollaborationTopic — Requirement 6.7
  // -------------------------------------------------------------------------

  async function handleCollaborationTopic(
    topicId: string,
    envelope: RegistryEnvelope,
  ): Promise<void> {
    log.info(`← collaboration topic message`, {
      topicId,
      action: envelope.action,
      source: envelope.source,
      seq: envelope.seq,
      msg_id: envelope.message_id,
    });
    log.debug(`collaboration envelope detail`, fmtEnvelope(envelope));
    const session = getOrCreateSession(topicId, boundAgentId);
    await session.dispatch(envelope);
  }

  // -------------------------------------------------------------------------
  // createInboundHandler — Requirements 6.1, 6.2
  // -------------------------------------------------------------------------

  function createInboundHandler(topic: string): (bytes: Uint8Array) => void {
    return (bytes: Uint8Array): void => {
      log.debug(`raw bytes received on topic "${topic}"`, { bytes: bytes.length });

      // Requirement 6.1: parse the message body as a RegistryEnvelope
      let envelope: RegistryEnvelope;
      try {
        envelope = deserializeEnvelope(bytes);
      } catch (err) {
        // Requirement 6.2: log parse error with truncated raw bytes, discard
        const truncated = bytes.slice(0, 512);
        const preview = Buffer.from(truncated).toString("utf8").slice(0, 512);
        log.error(`parse error — discarding message`, {
          topic,
          error: String(err),
          rawPreview: preview,
        });
        console.error(
          `[agent-registry] router: parse error on subject "${topic}": ${String(err)}. Raw bytes (truncated): ${preview}`,
        );
        return;
      }

      log.debug(`parsed envelope on topic "${topic}"`, {
        action: envelope.action,
        source: envelope.source,
        seq: envelope.seq,
        msg_id: envelope.message_id,
        resource_type: envelope.resource_type,
      });

      // Dispatch to the correct handler based on topic pattern
      let handlerPromise: Promise<void>;

      if (matchesPrefix("a2a.agent.unicast.", topic)) {
        handlerPromise = handleUnicast(envelope);
      } else if (matchesPrefix("a2a.agent.group.", topic)) {
        handlerPromise = handleMulticast(envelope);
      } else if (matchesPrefix("a2a.agent.broadcast.", topic)) {
        handlerPromise = handleBroadcast(envelope);
      } else if (matchesPrefix("a2a.discussion.", topic)) {
        const discussionId = segmentAfter("a2a.discussion.", topic);
        handlerPromise = handleCollaborationTopic(discussionId, envelope);
      } else if (matchesPrefix("a2a.cotask.", topic)) {
        const taskId = segmentAfter("a2a.cotask.", topic);
        handlerPromise = handleCollaborationTopic(taskId, envelope);
      } else {
        // Unknown topic pattern — log and discard
        log.warn(`unrecognized topic pattern — discarding`, { topic });
        console.warn(
          `[agent-registry] router: unrecognized topic pattern "${topic}" — discarding`,
        );
        return;
      }

      // Fire-and-forget; errors are logged but do not crash the subscription handler
      handlerPromise.catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        log.error(`error handling message`, { topic, error: message });
        console.error(
          `[agent-registry] router: error handling message on topic "${topic}": ${message}`,
        );
      });
    };
  }

  // -------------------------------------------------------------------------
  // Public MessageRouter interface
  // -------------------------------------------------------------------------

  return {
    handleUnicast,
    handleMulticast,
    handleBroadcast,
    handleCollaborationTopic,
    createInboundHandler,
  };
}
