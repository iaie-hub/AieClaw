/**
 * unicast-sender.ts — Send direct messages to other agents via NATS unicast.
 *
 * Encapsulates the NATS publish to `a2a.agent.unicast.{targetAgentId}` so that
 * Agent skills can call `runtime.agentRegistry.sendMessage()` to proactively
 * initiate point-to-point communication with another agent.
 *
 * Unlike the OutboundAdapter (which handles *replies* to inbound messages),
 * this module enables *initiating* conversations without a prior inbound envelope.
 */

import { v4 as uuidv4 } from "uuid";
import { createEnvelope, serializeEnvelope } from "./envelope.js";
import type { NATSClient } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SendMessageParams {
  /** The target agent's registered agent_id. */
  targetAgentId: string;
  /** The message text to send. */
  text: string;
  /** Optional action label (defaults to "message"). */
  action?: string;
  /** Optional additional payload fields merged into the envelope payload. */
  metadata?: Record<string, unknown>;
  /** Sender's current session key, written into the envelope's session field. */
  senderSessionKey?: string;
}

export interface SendMessageResult {
  ok: boolean;
  /** The message_id of the published envelope (for tracing). */
  messageId?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// sendMessage
// ---------------------------------------------------------------------------

/**
 * Publish a direct unicast message to another agent.
 *
 * This is an async-reply publish to `a2a.agent.unicast.{targetAgentId}`.
 * The `reply_to` field is set to the sender's own unicast subject
 * (`a2a.agent.unicast.{agentId}`) so the target agent knows where to
 * send its response.
 *
 * The call returns immediately after publishing (fire-and-forget at the
 * transport level). Responses from the target agent arrive asynchronously
 * on the sender's unicast subscription, which is already handled by the
 * MessageRouter — no synchronous wait is performed.
 */
export function sendMessage(
  params: SendMessageParams,
  agentId: string,
  natsClient: NATSClient,
): SendMessageResult {
  const { targetAgentId, text, action = "message", metadata } = params;

  if (!targetAgentId) {
    return { ok: false, error: "targetAgentId is required" };
  }
  if (!text) {
    return { ok: false, error: "text is required" };
  }

  const subject = `a2a.agent.unicast.${targetAgentId}`;

  // reply_to points to the sender's own unicast topic so the target agent
  // can route its response back. The response is received asynchronously
  // via the existing unicast subscription — no blocking wait here.
  const replyTo = `a2a.agent.unicast.${agentId}`;

  const envelope = createEnvelope({
    request_id: uuidv4(),
    message_type: "req",
    source: agentId,
    session: params.senderSessionKey ?? null,
    seq: 0,
    action,
    resource_type: "agent",
    payload: {
      text,
      ...metadata,
    },
    reply_to: replyTo,
  });

  try {
    natsClient.publish(subject, serializeEnvelope(envelope));
    return { ok: true, messageId: envelope.message_id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
