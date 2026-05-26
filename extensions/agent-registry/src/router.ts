/**
 * MessageRouter — dispatches inbound NATS messages to the appropriate
 * OpenClaw agent session based on the topic pattern.
 *
 * Topic patterns:
 *  - a2a.agent.unicast.*   → handleUnicast
 *  - a2a.agent.group.*     → handleMulticast
 *  - a2a.agent.broadcast.* → handleBroadcast
 *  - a2a.cowork.*          → handleCollaborationTopic (topicId = coworkId)
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10
 */

import { emitAgentEvent, emitSessionTranscriptUpdate } from "openclaw/plugin-sdk/agent-harness-runtime";
import { emitCollabEvent } from "openclaw/plugin-sdk/collab-runtime";
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
 * e.g. segmentAfter("a2a.cowork.", "a2a.cowork.cw-123") → "cw-123"
 */
function segmentAfter(prefix: string, topic: string): string {
  return topic.slice(prefix.length);
}

/**
 * Derive the SessionTracker key for a unicast message using source + session.
 *
 * When the envelope carries a session field, the key includes both source and
 * session to isolate parallel conversations from the same agent. When session
 * is absent (legacy or external agents), falls back to source-only for backward
 * compatibility.
 */
function deriveUnicastSessionKey(source: string, session: string | null): string {
  if (session) {
    return `unicast:${source}:${session}`;
  }
  return `unicast:${source}`;
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
    getEffectiveAgentId,
    activeOutboundSessions,
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
      request_id: envelope.request_id,
      reply_to: envelope.reply_to,
      payload: envelope.payload,
    });
    log.debug(`unicast envelope detail`, fmtEnvelope(envelope));
    const key = deriveUnicastSessionKey(envelope.source, envelope.session);
    const session = getOrCreateSession(key, boundAgentId, envelope);
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
      request_id: envelope.request_id,
      reply_to: envelope.reply_to,
      payload: envelope.payload,
    });
    log.debug(`multicast envelope detail`, fmtEnvelope(envelope));
    let session;
    try {
      session = getLeastLoadedSession(boundAgentId);
      log.debug(`multicast: routed to least-loaded session`, {
        activeTasks: session.activeTaskCount,
      });
    } catch {
      // No sessions exist — create a new one keyed by the sender source
      log.debug(
        `multicast: no existing sessions — creating new session for source=${envelope.source}`,
      );
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
      request_id: envelope.request_id,
      reply_to: envelope.reply_to,
      payload: envelope.payload,
    });
    log.debug(`broadcast envelope detail`, fmtEnvelope(envelope));

    switch (envelope.action) {
      case "cowork.created":
        log.info(`broadcast: cowork.created — forwarding to arbiter`, {
          cowork_id: envelope.payload["cowork_id"] ?? envelope.payload["id"],
        });
        await arbiter.processCoworkCreated(envelope.payload);
        break;

      default:
        // Requirement 6.8: log and discard unknown broadcast actions
        log.warn(`broadcast action not handled — discarding`, { action: envelope.action });
        console.info(`[agent-registry] router: broadcast action '${envelope.action}' — discarding`);
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
      request_id: envelope.request_id,
      reply_to: envelope.reply_to,
      payload: envelope.payload,
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

      log.info(`← inbound message`, {
        topic,
        action: envelope.action,
        source: envelope.source,
        seq: envelope.seq,
        session: envelope.session,
        msg_id: envelope.message_id,
        resource_type: envelope.resource_type,
        payload: envelope.payload,
      });

      // 1. 如果是响应消息 (res)，直接通过实时事件发送给 UI 显示，跳过 LLM 处理。
      // 注意：必须放在防环拦截器之前，否则在单 Agent 场景中（自己发给自己）UI 就收不到自己回的 res 消息了。
      if (envelope.message_type === "res") {
        log.info(`directly emitting res message to UI, bypassing LLM`, {
          topic,
          source: envelope.source,
          session: envelope.session,
          request_id: envelope.request_id,
          msg_id: envelope.message_id,
          payload: envelope.payload,
        });
        if (envelope.session) {
          // 实时流改造：将响应文本组装为标准的 "assistant" 和 "lifecycle" 闭环事件
          // 使用唯一的 message_id 作为 runId，在主会话与参与者会话底部实现增量实时追加
          const text = typeof envelope.payload["text"] === "string"
            ? envelope.payload["text"]
            : JSON.stringify(envelope.payload);

          // 触发 "assistant" 流输入事件
          emitAgentEvent({
            runId: envelope.message_id,
            sessionKey: envelope.session,
            stream: "assistant",
            data: {
              text,
              delta: text,
              senderLabel: envelope.source,
            },
          });

          // 触发 "lifecycle" 正常结束事件完成闭环
          emitAgentEvent({
            runId: envelope.message_id,
            sessionKey: envelope.session,
            stream: "lifecycle",
            data: {
              phase: "end",
            },
          });

          // 持久化到 transcript，使用 content array 格式与 emitChatFinal 对齐，
          // 确保 preserveOptimisticTailMessages 签名匹配去重
          emitSessionTranscriptUpdate({
            sessionFile: envelope.session,
            sessionKey: envelope.session,
            messageId: envelope.message_id,
            message: {
              role: "assistant",
              content: [{ type: "text", text }],
              timestamp: Date.now(),
              sourceAgentId: envelope.source,
              senderLabel: envelope.source,
            },
          });
        } else {
          log.warn(`res message has no session field — cannot route to UI`, {
            request_id: envelope.request_id,
            msg_id: envelope.message_id,
          });
        }
        if (matchesPrefix("a2a.cowork.", topic)) {
          emitCollabEvent({ topic, message: envelope });
        }
        return;
      }

      // 2. Filter out self-messages to avoid loopbacks for req messages.
      // When the same agent has multiple parallel sessions, messages from a
      // DIFFERENT session (source === self but session differs) must be processed.
      // Only discard when: source === self AND (no session OR session is one of
      // our own active outbound sessions).
      if (getEffectiveAgentId && envelope.source === getEffectiveAgentId()) {
        if (!envelope.session) {
          // No session field — legacy loopback prevention, discard
          log.info(`[LOOPBACK] discarding self-message (no session field)`, {
            topic,
            source: envelope.source,
            msg_id: envelope.message_id,
            payload: envelope.payload,
          });
          if (matchesPrefix("a2a.cowork.", topic)) {
            emitCollabEvent({ topic, message: envelope });
          }
          return;
        }

        if (activeOutboundSessions && activeOutboundSessions.has(envelope.session)) {
          // 如果这是显式发给自己的单播消息（跨会话自我通信），则放行
          if (matchesPrefix("a2a.agent.unicast.", topic)) {
            log.info(`allowing unicast self-message (cross-session self-communication)`, {
              topic,
              source: envelope.source,
              session: envelope.session,
              msg_id: envelope.message_id,
              payload: envelope.payload,
            });
          } else {
            // 对于群组/协作等其他主题，依然拦截，防止回显死循环
            log.info(`[LOOPBACK] discarding self-message (same outbound session)`, {
              topic,
              source: envelope.source,
              session: envelope.session,
              msg_id: envelope.message_id,
              payload: envelope.payload,
            });
            if (matchesPrefix("a2a.cowork.", topic)) {
              emitCollabEvent({ topic, message: envelope });
            }
            if (envelope.session) {
              const text =
                typeof envelope.payload["text"] === "string"
                  ? envelope.payload["text"]
                  : JSON.stringify(envelope.payload);
              emitSessionTranscriptUpdate({
                sessionFile: envelope.session,
                sessionKey: envelope.session,
                messageId: envelope.message_id,
                message: {
                  role: "assistant",
                  content: [{ type: "text", text }],
                  timestamp: Date.now(),
                  sourceAgentId: envelope.source,
                },
              });
            }
            return;
          }
        }

        // Different session of the same agent — allow processing (cross-session communication)
        log.info(`allowing self-message from different session`, {
          topic,
          source: envelope.source,
          session: envelope.session,
          msg_id: envelope.message_id,
          payload: envelope.payload,
        });
      }

      // Dispatch to the correct handler based on topic pattern
      let handlerPromise: Promise<void>;

      if (matchesPrefix("a2a.agent.unicast.", topic)) {
        handlerPromise = handleUnicast(envelope);
      } else if (matchesPrefix("a2a.agent.group.", topic)) {
        handlerPromise = handleMulticast(envelope);
      } else if (matchesPrefix("a2a.agent.broadcast.", topic)) {
        handlerPromise = handleBroadcast(envelope);
      } else if (matchesPrefix("a2a.cowork.", topic)) {
        const coworkId = segmentAfter("a2a.cowork.", topic);
        // Emit in-process event for real-time UI viewing (no AgentRegistry relay).
        emitCollabEvent({ topic, message: envelope });
        handlerPromise = handleCollaborationTopic(coworkId, envelope);
      } else {
        // Unknown topic pattern — log and discard
        log.warn(`unrecognized topic pattern — discarding`, { topic });
        console.warn(`[agent-registry] router: unrecognized topic pattern "${topic}" — discarding`);
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
