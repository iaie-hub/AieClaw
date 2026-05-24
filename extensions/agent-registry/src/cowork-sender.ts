/**
 * cowork-sender.ts — Publish messages to a cowork topic via NATS.
 *
 * Enables an Agent to *proactively* send a message into an active
 * collaboration session (`a2a.cowork.{coworkId}`), without requiring
 * a prior inbound message to reply to.
 *
 * This is the "initiating" counterpart to OutboundAdapter's "replying"
 * behavior for cowork sessions — analogous to how unicast-sender.ts
 * complements OutboundAdapter for unicast messages.
 *
 * Communication mode: fire-and-forget publish (no synchronous wait).
 */

import { v4 as uuidv4 } from "uuid";
import { createEnvelope, serializeEnvelope } from "./envelope.js";
import type { NATSClient } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SendCoworkMessageParams {
  /** The cowork_id of the active collaboration session. */
  coworkId: string;
  /** The message text to publish. */
  message: string;
  /** Optional action label (defaults to "message"). */
  action?: string;
  /** Sender's current session key, written into the envelope's session field. */
  senderSessionKey?: string;
}

export interface SendCoworkMessageResult {
  ok: boolean;
  /** The message_id of the published envelope (for tracing). */
  messageId?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// sendCoworkMessage
// ---------------------------------------------------------------------------

/**
 * Publish a message to a cowork topic (`a2a.cowork.{coworkId}`).
 *
 * This is a fire-and-forget publish. All agents subscribed to the cowork
 * topic will receive the message. No reply_to is set because cowork
 * communication is multicast — responses arrive on the same topic.
 */
export function sendCoworkMessage(
  params: SendCoworkMessageParams,
  agentId: string,
  natsClient: NATSClient,
): SendCoworkMessageResult {
  const { coworkId, message, action = "message" } = params;

  if (!coworkId) {
    return { ok: false, error: "coworkId is required" };
  }
  if (!message) {
    return { ok: false, error: "message is required" };
  }

  const subject = `a2a.cowork.${coworkId}`;

  const envelope = createEnvelope({
    request_id: uuidv4(),
    message_type: "req",
    source: agentId,
    session: params.senderSessionKey ?? null,
    seq: 0,
    action,
    resource_type: "cowork",
    payload: {
      action: "message",
      agent_id: agentId,
      message,
    },
    reply_to: null,
  });

  try {
    natsClient.publish(subject, serializeEnvelope(envelope));
    return { ok: true, messageId: envelope.message_id };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}
