/**
 * OutboundAdapter — wraps OpenClaw agent responses in RegistryEnvelope and
 * publishes them to the correct NATS subject.
 *
 * Routing priority (per design):
 *  1. inboundEnvelope.reply_to is non-empty → publish to reply_to
 *  2. sessionContext.kind === "unicast"    → a2a.agent.unicast.{sourceAgentId}
 *  3. sessionContext.kind === "multicast"  → a2a.agent.unicast.{sourceAgentId} (unicast reply back to sender)
 *  4. sessionContext.kind === "cowork"     → a2a.cowork.{coworkId}
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 10.4
 */

import { v4 as uuidv4 } from "uuid";
import { createEnvelope, serializeEnvelope } from "./envelope.js";
import { createLogger } from "./logger.js";
import type { OutboundAdapterOptions, OutboundSendParams, SessionContext } from "./types.js";

const log = createLogger("outbound");

// ---------------------------------------------------------------------------
// OutboundAdapter interface
// ---------------------------------------------------------------------------

export interface OutboundAdapter {
  send(params: OutboundSendParams): Promise<void>;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Derive a stable session key from the SessionContext.
 * Used to key the per-session seq counter.
 */
function sessionKey(ctx: SessionContext): string {
  switch (ctx.kind) {
    case "unicast":
      return `unicast:${ctx.sourceAgentId}`;
    case "multicast":
      return `multicast:${ctx.groupId}`;
    case "cowork":
      return `cowork:${ctx.coworkId}`;
  }
}

/**
 * Determine the NATS subject to publish to, or null if the message should be
 * discarded (missing sourceAgentId on unicast/multicast).
 *
 * For unicast and multicast, the reply goes back to the inbound sender via
 * `a2a.agent.unicast.{inboundSource}` (Requirement 7.3).
 * For unicast context, `ctx.sourceAgentId` is the canonical source; for
 * multicast, the inbound envelope's `source` field is used.
 */
function resolveSubject(
  inboundReplyTo: string | null,
  inboundSource: string,
  ctx: SessionContext,
): string | null {
  // Priority 1: reply_to present and non-empty
  if (inboundReplyTo !== null && inboundReplyTo !== "") {
    return inboundReplyTo;
  }

  switch (ctx.kind) {
    case "unicast": {
      // sourceAgentId on the context is the canonical sender for unicast sessions
      const sourceId = ctx.sourceAgentId || inboundSource;
      if (!sourceId) return null;
      return `a2a.agent.unicast.${sourceId}`;
    }

    case "multicast":
      // Unicast reply back to the original sender (from inbound envelope source)
      if (!inboundSource) return null;
      return `a2a.agent.unicast.${inboundSource}`;

    case "cowork":
      return `a2a.cowork.${ctx.coworkId}`;
  }
}

/**
 * Determine the envelope action for the given context.
 */
function resolveAction(ctx: SessionContext, isSessionComplete: boolean): string {
  switch (ctx.kind) {
    case "unicast":
    case "multicast":
      return "message";
    case "cowork":
      return isSessionComplete ? "complete" : "message";
  }
}

/**
 * Determine the envelope resource_type for the given context.
 */
function resolveResourceType(ctx: SessionContext): string {
  switch (ctx.kind) {
    case "unicast":
    case "multicast":
      return "agent";
    case "cowork":
      return "cowork";
  }
}

/**
 * Build the payload for the outbound envelope.
 */
function buildPayload(responseText: string, ctx: SessionContext): Record<string, unknown> {
  const base: Record<string, unknown> = { text: responseText };

  switch (ctx.kind) {
    case "cowork":
      return { ...base, cowork_id: ctx.coworkId };
    default:
      return base;
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create an OutboundAdapter that wraps agent responses in RegistryEnvelope
 * and publishes them to the correct NATS subject.
 *
 * The adapter maintains a per-session seq counter (keyed by session context)
 * starting at 0 and incrementing by 1 for each published envelope.
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 10.4
 */
export function createOutboundAdapter(options: OutboundAdapterOptions): OutboundAdapter {
  const { getAgentId, natsClient } = options;

  // Per-session seq counters: Map<sessionKey, nextSeq>
  const seqCounters = new Map<string, number>();

  return {
    async send(params: OutboundSendParams): Promise<void> {
      const { responseText, inboundEnvelope, sessionContext, isSessionComplete } = params;

      // Resolve publish subject — may be null if we must discard
      const subject = resolveSubject(
        inboundEnvelope.reply_to,
        inboundEnvelope.source,
        sessionContext,
      );

      if (subject === null) {
        // Missing sourceAgentId on unicast/multicast — log warning and discard
        log.warn(`unicast/multicast reply has no sourceAgentId — discarding`, {
          sessionContext,
          inboundSource: inboundEnvelope.source,
        });
        console.warn(
          "[agent-registry] outbound: unicast/multicast reply has no sourceAgentId — discarding",
        );
        return;
      }

      // Retrieve and increment the per-session seq counter
      const key = sessionKey(sessionContext);
      const seq = seqCounters.get(key) ?? 0;
      seqCounters.set(key, seq + 1);

      const action = resolveAction(sessionContext, isSessionComplete);
      const resourceType = resolveResourceType(sessionContext);
      const payload = buildPayload(responseText, sessionContext);

      const envelope = createEnvelope({
        request_id: inboundEnvelope.request_id,
        message_type: "res",
        source: getAgentId(),
        session: params.senderSessionKey ?? null,
        seq,
        action,
        resource_type: resourceType,
        payload,
        reply_to: null,
      });

      log.info(`→ outbound message`, {
        subject,
        action,
        resource_type: resourceType,
        seq,
        msg_id: envelope.message_id,
        request_id: envelope.request_id,
        reply_to: envelope.reply_to,
        sessionKind: sessionContext.kind,
        textPreview: responseText.slice(0, 120) + (responseText.length > 120 ? "…" : ""),
      });
      log.debug(`outbound envelope detail`, {
        subject,
        action,
        resource_type: resourceType,
        seq,
        msg_id: envelope.message_id,
        payload,
      });

      const bytes = serializeEnvelope(envelope);
      natsClient.publish(subject, bytes);
    },
  };
}
