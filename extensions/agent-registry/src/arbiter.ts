/**
 * CollaborationArbiter — maintains a single long-lived Bound_Agent session and
 * processes `discussion.created` / `cotask.created` broadcasts sequentially.
 *
 * Design:
 * - One `ArbiterSession` is created on `initialize()` and reused for all decisions.
 * - A single-concurrency promise chain (sequential queue) ensures broadcasts are
 *   processed one at a time in arrival order.
 * - Each decision has a 30-second timeout; on timeout or negative response the
 *   broadcast is discarded.
 * - On affirmative response the arbiter subscribes to the collaboration topic and
 *   publishes a join envelope.
 * - If the session terminates unexpectedly it is recreated before the next broadcast.
 *
 * Requirements: 6.5, 6.6, 6.9, 6.10
 */

import { v4 as uuidv4 } from "uuid";
import { createEnvelope, serializeEnvelope } from "./envelope.js";
import { createLogger } from "./logger.js";
import type { CollaborationArbiter, CollaborationArbiterOptions } from "./types.js";

const log = createLogger("arbiter");

// ---------------------------------------------------------------------------
// ArbiterSession — extended session abstraction for the arbiter use-case
// ---------------------------------------------------------------------------

/**
 * A session handle that can send a prompt to the Bound_Agent and await a
 * text response. Provided by `channel.ts` via `CollaborationArbiterOptions`.
 */
export interface ArbiterSession {
  /**
   * Send a plain-text prompt to the agent and wait for a response.
   * Rejects with an error if the session has terminated or the timeout elapses.
   */
  sendAndAwaitResponse(prompt: string, timeoutMs: number): Promise<string>;
  /** Terminate the session and release resources. */
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DECISION_TIMEOUT_MS = 30_000;

/**
 * Return true when the agent's response text is affirmative.
 * Affirmative = the first word (lowercased, trimmed) is "yes".
 */
function isAffirmative(response: string): boolean {
  const first = response.trim().toLowerCase().split(/\s+/)[0] ?? "";
  return first === "yes";
}

/**
 * Extract offered skills from the agent's cotask response.
 * Scans the response text for any configured skill name (case-insensitive).
 */
function extractOfferedSkills(response: string, configuredSkills: string[]): string[] {
  const lower = response.toLowerCase();
  return configuredSkills.filter((skill) => lower.includes(skill.toLowerCase()));
}

/**
 * Race a promise against a timeout.
 * Rejects with an Error("timeout") if the timeout fires first.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error("timeout")), ms),
    ),
  ]);
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a CollaborationArbiter.
 *
 * Requirements: 6.5, 6.6, 6.9, 6.10
 */
export function createCollaborationArbiter(
  options: CollaborationArbiterOptions,
): CollaborationArbiter {
  const { boundAgentId, natsClient, createArbiterSession, configuredSkills, getCapabilityContext } = options;

  // The single long-lived arbiter session (Requirement 6.9).
  let session: ArbiterSession | null = null;

  // Disposed flag — set by dispose(); prevents new items from being enqueued.
  let disposed = false;

  // Sequential async queue: a promise chain with single concurrency.
  // Each enqueued task is appended to the tail of the chain.
  // Errors are swallowed at the chain level so the queue stays alive.
  let queue: Promise<void> = Promise.resolve();

  // -------------------------------------------------------------------------
  // Session management
  // -------------------------------------------------------------------------

  /**
   * Ensure a live session exists. If the current session is null (never
   * created or terminated unexpectedly), create a new one.
   * Requirement 6.9: recreate before processing next broadcast.
   */
  function ensureSession(): ArbiterSession {
    if (session === null) {
      log.info(`creating new arbiter session`, { boundAgentId });
      // createArbiterSession returns an AgentSession; we cast to ArbiterSession
      // because channel.ts provides an implementation that satisfies the extended
      // interface (sendAndAwaitResponse + dispose).
      session = createArbiterSession(boundAgentId) as unknown as ArbiterSession;
    }
    return session;
  }

  /**
   * Mark the current session as terminated so it will be recreated on the
   * next broadcast. Called when sendAndAwaitResponse throws a session-level
   * error (not a timeout).
   */
  function invalidateSession(): void {
    if (session !== null) {
      log.warn(`invalidating arbiter session — will recreate on next broadcast`);
      try {
        session.dispose();
      } catch {
        // best-effort
      }
      session = null;
    }
  }

  // -------------------------------------------------------------------------
  // Queue helpers
  // -------------------------------------------------------------------------

  /**
   * Enqueue a task for sequential processing.
   * The task will run after all previously enqueued tasks complete.
   * Errors thrown by the task are caught so the queue chain stays alive.
   */
  function enqueue(task: () => Promise<void>): void {
    queue = queue
      .then(() => {
        if (disposed) return; // skip if disposed while waiting in queue
        return task();
      })
      .catch((err: unknown) => {
        // Swallow errors to keep the queue alive (Requirement 6.10).
        const message = err instanceof Error ? err.message : String(err);
        log.error(`queue task error`, message);
        console.error(`[agent-registry] arbiter: queue task error: ${message}`);
      });
  }

  // -------------------------------------------------------------------------
  // Discussion processing (Requirement 6.5)
  // -------------------------------------------------------------------------

  async function processDiscussionCreatedTask(
    payload: Record<string, unknown>,
  ): Promise<void> {
    const content = (payload["content"] ?? payload) as Record<string, unknown>;
    const discussionId = String(payload["discussion_id"] ?? payload["id"] ?? "");
    const text = String(content["text"] ?? "");
    const description = String(content["description"] ?? "");
    const tags = Array.isArray(content["tags"])
      ? (content["tags"] as unknown[]).join(", ")
      : String(content["tags"] ?? "");
    const conversation = String(content["conversation"] ?? "");

    log.info(`processing discussion.created`, {
      discussion_id: discussionId,
      text: text.slice(0, 100),
      tags,
    });

    // Load the agent's capability context (AGENTS.md + TOOLS.md) so the LLM
    // can make an informed join decision based on its actual role and skills.
    const capabilityContext = await getCapabilityContext();
    const capabilitySection = capabilityContext
      ? `## Agent Capability Context\n\n${capabilityContext}\n\n---\n\n`
      : "";

    const prompt =
      capabilitySection +
      `## Collaboration Request\n\n` +
      `A new discussion has been created:\n` +
      `- Topic: '${text}'\n` +
      `- Description: ${description}\n` +
      `- Tags: ${tags}\n` +
      `- Current conversation: ${conversation}\n\n` +
      `Based on your capabilities above, should you join this discussion?\n` +
      `Reply "yes" if you can contribute meaningfully, or "no" if this is outside your scope.`;

    log.debug(`sending discussion decision prompt to bound agent`, {
      discussion_id: discussionId,
      promptLength: prompt.length,
      prompt,
    });

    let response: string;
    try {
      const s = ensureSession();
      response = await withTimeout(
        s.sendAndAwaitResponse(prompt, DECISION_TIMEOUT_MS),
        DECISION_TIMEOUT_MS,
      );
      log.debug(`received discussion decision response`, {
        discussion_id: discussionId,
        response: response.slice(0, 200),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === "timeout") {
        log.warn(`discussion.created decision timed out — discarding`, { discussion_id: discussionId });
        console.warn(
          `[agent-registry] arbiter: discussion.created decision timed out for discussion_id="${discussionId}" — discarding`,
        );
      } else {
        // Session-level error — invalidate so it is recreated next time.
        log.error(`session error during discussion decision — discarding`, { discussion_id: discussionId, error: message });
        console.error(
          `[agent-registry] arbiter: session error during discussion decision: ${message} — discarding`,
        );
        invalidateSession();
      }
      return;
    }

    if (!isAffirmative(response)) {
      log.info(`Bound_Agent declined discussion`, { discussion_id: discussionId, response: response.slice(0, 80) });
      console.info(
        `[agent-registry] arbiter: Bound_Agent declined discussion_id="${discussionId}"`,
      );
      return;
    }

    // Affirmative: subscribe to the discussion topic and publish join envelope.
    const topic = `a2a.discussion.${discussionId}`;

    log.info(`joining discussion`, { discussion_id: discussionId, topic });

    natsClient.subscribe(topic, () => {
      // Message handling for this topic is delegated to the MessageRouter;
      // the subscription here is the side-effect required by Requirement 6.5.
    });

    const joinEnvelope = createEnvelope({
      request_id: uuidv4(),
      message_type: "event",
      source: boundAgentId,
      seq: 0,
      action: "join",
      resource_type: "collaboration",
      payload: { discussion_id: discussionId },
      reply_to: null,
    });

    natsClient.publish(topic, serializeEnvelope(joinEnvelope));

    log.info(`joined discussion — join envelope published`, { discussion_id: discussionId, topic });
    console.info(
      `[agent-registry] arbiter: joined discussion_id="${discussionId}"`,
    );
  }

  // -------------------------------------------------------------------------
  // Cotask processing (Requirement 6.6)
  // -------------------------------------------------------------------------

  async function processCotaskCreatedTask(
    payload: Record<string, unknown>,
  ): Promise<void> {
    const content = (payload["content"] ?? payload) as Record<string, unknown>;
    const taskId = String(payload["task_id"] ?? payload["id"] ?? "");
    const text = String(content["text"] ?? "");
    const description = String(content["description"] ?? "");
    const requiredSkills = Array.isArray(content["required_skills"])
      ? (content["required_skills"] as unknown[]).join(", ")
      : String(content["required_skills"] ?? "");
    const conversation = String(content["conversation"] ?? "");

    // Load the agent's capability context (AGENTS.md + TOOLS.md) so the LLM
    // can make an informed join decision based on its actual role and skills.
    const capabilityContext = await getCapabilityContext();
    const capabilitySection = capabilityContext
      ? `## Agent Capability Context\n\n${capabilityContext}\n\n---\n\n`
      : "";

    const prompt =
      capabilitySection +
      `## Collaboration Request\n\n` +
      `A new cooperative task has been created:\n` +
      `- Task: '${text}'\n` +
      `- Description: ${description}\n` +
      `- Required skills: ${requiredSkills}\n` +
      `- Current context: ${conversation}\n\n` +
      `Based on your capabilities above, should you join this cotask?\n` +
      `If yes, list which required skills you can provide.\n` +
      `Reply "yes [skill1, skill2, ...]" or "no".`;

    log.debug(`sending cotask decision prompt to bound agent`, {
      task_id: taskId,
      promptLength: prompt.length,
      prompt,
    });

    let response: string;
    try {
      const s = ensureSession();
      response = await withTimeout(
        s.sendAndAwaitResponse(prompt, DECISION_TIMEOUT_MS),
        DECISION_TIMEOUT_MS,
      );
      log.debug(`received cotask decision response`, {
        task_id: taskId,
        response: response.slice(0, 200),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === "timeout") {
        log.warn(`cotask.created decision timed out — discarding`, { task_id: taskId });
        console.warn(
          `[agent-registry] arbiter: cotask.created decision timed out for task_id="${taskId}" — discarding`,
        );
      } else {
        log.error(`session error during cotask decision — discarding`, { task_id: taskId, error: message });
        console.error(
          `[agent-registry] arbiter: session error during cotask decision: ${message} — discarding`,
        );
        invalidateSession();
      }
      return;
    }

    if (!isAffirmative(response)) {
      log.info(`Bound_Agent declined cotask`, { task_id: taskId, response: response.slice(0, 80) });
      console.info(
        `[agent-registry] arbiter: Bound_Agent declined task_id="${taskId}"`,
      );
      return;
    }

    // Extract offered skills from the response text.
    const offeredSkills = extractOfferedSkills(response, configuredSkills);

    // Affirmative: subscribe to the cotask topic and publish join envelope.
    const topic = `a2a.cotask.${taskId}`;

    natsClient.subscribe(topic, () => {
      // Message handling delegated to MessageRouter.
    });

    const joinEnvelope = createEnvelope({
      request_id: uuidv4(),
      message_type: "event",
      source: boundAgentId,
      seq: 0,
      action: "join",
      resource_type: "cotask",
      payload: { task_id: taskId, offered_skills: offeredSkills },
      reply_to: null,
    });

    natsClient.publish(topic, serializeEnvelope(joinEnvelope));

    console.info(
      `[agent-registry] arbiter: joined task_id="${taskId}" with offered_skills=${JSON.stringify(offeredSkills)}`,
    );
  }

  // -------------------------------------------------------------------------
  // Public CollaborationArbiter interface
  // -------------------------------------------------------------------------

  return {
    /**
     * Create the single long-lived Arbiter session.
     * Must be called once before any broadcasts arrive.
     * Requirement 6.9
     */
    async initialize(): Promise<void> {
      ensureSession();
    },

    /**
     * Enqueue a `discussion.created` broadcast for sequential processing.
     * Requirement 6.5, 6.10
     */
    async processDiscussionCreated(payload: Record<string, unknown>): Promise<void> {
      if (disposed) return;
      enqueue(() => processDiscussionCreatedTask(payload));
    },

    /**
     * Enqueue a `cotask.created` broadcast for sequential processing.
     * Requirement 6.6, 6.10
     */
    async processCotaskCreated(payload: Record<string, unknown>): Promise<void> {
      if (disposed) return;
      enqueue(() => processCotaskCreatedTask(payload));
    },

    /**
     * Cancel pending queue items and close the Arbiter session.
     * After dispose(), no new items will be processed.
     */
    dispose(): void {
      disposed = true;
      invalidateSession();
    },
  };
}
