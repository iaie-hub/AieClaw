/**
 * discussion-initiator.ts — Discussion and Cotask creation via NATS request-reply.
 *
 * Encapsulates the NATS request to AgentRegistry for initiating discussions
 * and collaborative tasks. Designed to be injected into channelRuntime so that
 * Agent skills can call `runtime.agentRegistry.createDiscussion()` directly.
 *
 * Timeout: 10 seconds per registry spec.
 */

import { v4 as uuidv4 } from "uuid";
import { createEnvelope, serializeEnvelope, deserializeEnvelope } from "./envelope.js";
import type { NATSClient } from "./types.js";

// ---------------------------------------------------------------------------
// Discussion types
// ---------------------------------------------------------------------------

export interface CreateDiscussionParams {
  /** Short, human-readable topic name. */
  topicName: string;
  /** Detailed description of the discussion context. */
  description?: string;
  /** Optional tags for topic categorization. */
  tags?: string[];
  /** Recent conversation snippets providing context for other agents. */
  conversation?: string[];
}

export type CreateDiscussionResult =
  | { ok: true; discussionId: string; topic: string }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Cotask types
// ---------------------------------------------------------------------------

export interface CreateCotaskParams {
  /** Short, human-readable task name. */
  taskName: string;
  /** Detailed description of the task and goals. */
  description?: string;
  /** Skill tags required from participating agents. */
  requiredSkills?: string[];
  /** Recent conversation snippets providing context for other agents. */
  conversation?: string[];
}

export type CreateCotaskResult =
  | { ok: true; taskId: string; topic: string }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// createDiscussion
// ---------------------------------------------------------------------------

/**
 * Send a `registry.discussion.create` NATS request to AgentRegistry.
 *
 * On success the registry:
 *  1. Validates the agent is registered, online, and has `allow_create_discussion`
 *  2. Generates a `disc-{uuid8}` ID and `a2a.discussion.{id}` topic
 *  3. Broadcasts `discussion.created` to `a2a.agent.broadcast.all`
 *  4. Returns `{ success: true, discussion_id, topic }` in the reply
 *
 * Requirements: P0 from cowork.md §"第一部分"
 */
export async function createDiscussion(
  params: CreateDiscussionParams,
  agentId: string,
  natsClient: NATSClient,
): Promise<CreateDiscussionResult> {
  const envelope = createEnvelope({
    request_id: uuidv4(),
    message_type: "req",
    source: agentId,
    seq: 0,
    action: "discussion_create",
    resource_type: "collaboration",
    payload: {
      topic_name: params.topicName,
      description: params.description ?? "",
      tags: params.tags ?? [],
      conversation: params.conversation ?? [],
    },
    reply_to: null,
  });

  try {
    const responseBytes = await natsClient.request(
      "registry.discussion.create",
      serializeEnvelope(envelope),
      10_000,
    );
    const response = deserializeEnvelope(responseBytes);
    const p = response.payload as {
      success?: boolean;
      discussion_id?: string;
      topic?: string;
      error?: string;
    };

    if (p.success && p.discussion_id) {
      return { ok: true, discussionId: p.discussion_id, topic: p.topic! };
    }
    return { ok: false, error: p.error ?? "registry returned success=false" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

// ---------------------------------------------------------------------------
// createCotask
// ---------------------------------------------------------------------------

/**
 * Send a `registry.cotask.create` NATS request to AgentRegistry.
 *
 * On success the registry:
 *  1. Validates the agent is registered, online, and has `allow_create_cotask`
 *  2. Generates a `task-{uuid8}` ID and `a2a.cotask.{id}` topic
 *  3. Broadcasts `cotask.created` to `a2a.agent.broadcast.all`
 *  4. Returns `{ success: true, task_id, topic }` in the reply
 *
 * Requirements: P0 from cowork.md §"第一部分"
 */
export async function createCotask(
  params: CreateCotaskParams,
  agentId: string,
  natsClient: NATSClient,
): Promise<CreateCotaskResult> {
  const envelope = createEnvelope({
    request_id: uuidv4(),
    message_type: "req",
    source: agentId,
    seq: 0,
    action: "cotask_create",
    resource_type: "cotask",
    payload: {
      task_name: params.taskName,
      description: params.description ?? "",
      required_skills: params.requiredSkills ?? [],
      conversation: params.conversation ?? [],
    },
    reply_to: null,
  });

  try {
    const responseBytes = await natsClient.request(
      "registry.cotask.create",
      serializeEnvelope(envelope),
      10_000,
    );
    const response = deserializeEnvelope(responseBytes);
    const p = response.payload as {
      success?: boolean;
      task_id?: string;
      topic?: string;
      error?: string;
    };

    if (p.success && p.task_id) {
      return { ok: true, taskId: p.task_id, topic: p.topic! };
    }
    return { ok: false, error: p.error ?? "registry returned success=false" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
