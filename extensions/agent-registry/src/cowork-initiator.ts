/**
 * discussion-initiator.ts — Cowork creation via NATS request-reply.
 *
 * Encapsulates the NATS request to AgentRegistry for initiating collaboration
 * sessions (both discussion-mode and task-mode). Designed to be injected into
 * channelRuntime so that Agent skills can call
 * `runtime.agentRegistry.createCowork()` directly.
 *
 * Timeout: 10 seconds per registry spec.
 */

import { v4 as uuidv4 } from "uuid";
import { createEnvelope, serializeEnvelope, deserializeEnvelope } from "./envelope.ts";
import type { NATSClient } from "./types.ts";

// ---------------------------------------------------------------------------
// Cowork types (unified — covers both discussion and task modes)
// ---------------------------------------------------------------------------

export interface CreateCoworkParams {
  /** Short, human-readable name for the collaboration. */
  name: string;
  /** Detailed description of the collaboration context/goals. */
  description?: string;
  /** Recent conversation snippets providing context for other agents. */
  conversation?: string[];
  /** Sender's current session key, written into the envelope's session field. */
  senderSessionKey?: string;
}

export type CreateCoworkResult =
  | { ok: true; coworkId: string; topic: string }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// createCowork
// ---------------------------------------------------------------------------

/**
 * Send a `registry.cowork.create` NATS request to AgentRegistry.
 *
 * On success the registry:
 *  1. Validates the agent is registered, online, and has `allow_create_cowork`
 *  2. Generates a `cowork-{uuid8}` ID and `a2a.cowork.{id}` topic
 *  3. Broadcasts `cowork.created` to `a2a.agent.broadcast.all`
 *  4. Returns `{ success: true, cowork_id, topic }` in the reply
 */
export async function createCowork(
  params: CreateCoworkParams,
  agentId: string,
  natsClient: NATSClient,
): Promise<CreateCoworkResult> {
  const replyInbox = natsClient.newInbox();

  const envelope = createEnvelope({
    request_id: uuidv4(),
    message_type: "req",
    source: agentId,
    session: params.senderSessionKey ?? null,
    seq: 0,
    action: "cowork_create",
    resource_type: "cowork",
    payload: {
      name: params.name,
      description: params.description ?? "",
      conversation: params.conversation ?? [],
    },
    reply_to: replyInbox,
  });

  try {
    const responseBytes = await new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        sub.unsubscribe();
        reject(new Error("cowork_create request timed out after 10 s"));
      }, 10_000);

      const sub = natsClient.subscribe(replyInbox, (bytes) => {
        clearTimeout(timer);
        sub.unsubscribe();
        resolve(bytes);
      });

      natsClient.publish("registry.cowork.create", serializeEnvelope(envelope));
    });

    const response = deserializeEnvelope(responseBytes);
    const p = response.payload as {
      success?: boolean;
      cowork_id?: string;
      topic?: string;
      error?: string;
    };

    if (p.success && p.cowork_id) {
      return { ok: true, coworkId: p.cowork_id, topic: p.topic! };
    }
    return { ok: false, error: p.error ?? "registry returned success=false" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
