/**
 * CollaborationArbiter — maintains a single long-lived Bound_Agent session and
 * processes `discussion.created` / `cowork.created` broadcasts sequentially.
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

const DECISION_TIMEOUT_MS = 90_000;

/**
 * Clean thinking/reasoning blocks and markdown formatting to extract pure JSON content or text.
 */
function cleanResponseContent(response: string): string {
  // Strip any <thinking>...</thinking> block completely
  let cleanText = response.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "").trim();
  // Strip markdown JSON code block wrappers if present
  cleanText = cleanText.replace(/```json\s*([\s\S]*?)\s*```/gi, "$1").trim();
  cleanText = cleanText.replace(/```\s*([\s\S]*?)\s*```/gi, "$1").trim();
  return cleanText;
}

/**
 * Extract parsed JSON from the clean response text if possible.
 */
function tryParseJson(cleanText: string): { decision?: string; skills?: string[] } | null {
  try {
    // Attempt to locate potential JSON bounds if there's trailing or leading text around it
    const jsonStart = cleanText.indexOf("{");
    const jsonEnd = cleanText.lastIndexOf("}");
    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
      const jsonCandidate = cleanText.substring(jsonStart, jsonEnd + 1);
      const parsed = JSON.parse(jsonCandidate);
      if (parsed && typeof parsed === "object") {
        return {
          decision: typeof parsed.decision === "string" ? parsed.decision : undefined,
          skills: Array.isArray(parsed.skills) ? parsed.skills.map(String) : undefined,
        };
      }
    }
  } catch {
    // Fail silently to trigger fallback text parsing
  }
  return null;
}

/**
 * Return true when the agent's response text is affirmative.
 * Supports structured JSON first, falling back to structured XML/tags or first-word heuristic.
 */
function isAffirmative(response: string): boolean {
  const cleanText = cleanResponseContent(response);
  
  // Try JSON parser first
  const json = tryParseJson(cleanText);
  if (json && json.decision !== undefined) {
    return json.decision.toLowerCase() === "yes";
  }

  // Try parsing structured <decision> tag
  const tagMatch = cleanText.match(/<decision>\s*(yes|no)(?:[\s\S]*?)<\/decision>/i);
  if (tagMatch) {
    return tagMatch[1].toLowerCase() === "yes";
  }

  // Fallback to checking first word
  const first = cleanText.toLowerCase().split(/\s+/)[0] ?? "";
  return first === "yes" || cleanText.toLowerCase().startsWith("yes");
}

/**
 * Extract offered skills from the agent's cowork response.
 * Supports structured JSON first, falling back to scanning clean text for configured skill names.
 */
function extractOfferedSkills(response: string, configuredSkills: string[]): string[] {
  const cleanText = cleanResponseContent(response);

  // Try JSON parser first
  const json = tryParseJson(cleanText);
  if (json && Array.isArray(json.skills)) {
    return json.skills.filter((skill) =>
      configuredSkills.some((s) => s.toLowerCase() === skill.toLowerCase())
    );
  }

  const lower = cleanText.toLowerCase();
  return configuredSkills.filter((skill) => lower.includes(skill.toLowerCase()));
}

/**
 * Race a promise against a timeout.
 * Rejects with an Error("timeout") if the timeout fires first.
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timeout")), ms)),
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
  const {
    boundAgentId,
    getEffectiveAgentId,
    natsClient,
    createArbiterSession,
    configuredSkills,
    getCapabilityContext,
    createCollaborationTopicHandler,
  } = options;

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

  async function processDiscussionCreatedTask(payload: Record<string, unknown>): Promise<void> {
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
      `## Instructions\n` +
      `1. Analyze if the topic, description, or tags align with your core responsibilities and capabilities listed in the 'Agent Capability Context' above.\n` +
      `2. If they align and you can contribute meaningfully, decide to join. Otherwise, decline.\n` +
      `3. You MUST respond with a JSON object in the following format:\n` +
      `{\n` +
      `  "decision": "yes",\n` +
      `  "reason": "Brief explanation of capability alignment"\n` +
      `}\n` +
      `If you decline, set "decision" to "no".\n\n` +
      `Make sure your response is a valid JSON object. Do not include any other conversational text in your final response.`;

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
        log.warn(`discussion.created decision timed out — discarding`, {
          discussion_id: discussionId,
        });
        console.warn(
          `[agent-registry] arbiter: discussion.created decision timed out for discussion_id="${discussionId}" — discarding`,
        );
      } else {
        // Session-level error — invalidate so it is recreated next time.
        log.error(`session error during discussion decision — discarding`, {
          discussion_id: discussionId,
          error: message,
        });
        console.error(
          `[agent-registry] arbiter: session error during discussion decision: ${message} — discarding`,
        );
        invalidateSession();
      }
      return;
    }

    if (!isAffirmative(response)) {
      log.info(`Bound_Agent declined discussion`, {
        discussion_id: discussionId,
        response: response.slice(0, 80),
      });
      console.info(
        `[agent-registry] arbiter: Bound_Agent declined discussion_id="${discussionId}"`,
      );
      return;
    }

    // Affirmative: subscribe to the discussion topic and publish join envelope.
    const topic = `a2a.discussion.${discussionId}`;

    log.info(`joining discussion`, { discussion_id: discussionId, topic });

    // Route incoming messages on this topic through the MessageRouter so that
    // Agent sessions are created and the LLM can process them properly.
    // createCollaborationTopicHandler closes over the MessageRouter which is
    // created after the arbiter in channel.ts — the callback pattern ensures
    // it is resolved at call time, not at arbiter construction time.
    natsClient.subscribe(topic, createCollaborationTopicHandler(topic));

    const joinEnvelope = createEnvelope({
      request_id: uuidv4(),
      message_type: "req",
      source: getEffectiveAgentId(),
      seq: 0,
      action: "join",
      resource_type: "discussion",
      payload: { agent_id: getEffectiveAgentId(), discussion_id: discussionId },
      reply_to: null,
    });

    natsClient.publish(topic, serializeEnvelope(joinEnvelope));

    log.info(`joined discussion — join envelope published`, { discussion_id: discussionId, topic });
    console.info(`[agent-registry] arbiter: joined discussion_id="${discussionId}"`);
  }

  // -------------------------------------------------------------------------
  // Cowork processing (Requirement 6.6)
  // -------------------------------------------------------------------------

  async function processCoworkCreatedTask(payload: Record<string, unknown>): Promise<void> {
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
      `## Instructions\n` +
      `1. Analyze if the task, description, or required skills align with your core responsibilities and capabilities listed in the 'Agent Capability Context' above.\n` +
      `2. If they align and you can provide any of the required skills, decide to join. Otherwise, decline.\n` +
      `3. You MUST respond with a JSON object in the following format:\n` +
      `{\n` +
      `  "decision": "yes",\n` +
      `  "skills": ["skill1", "skill2"],\n` +
      `  "reason": "Brief explanation of skill alignment"\n` +
      `}\n` +
      `If you decline, set "decision" to "no" and "skills" to [].\n\n` +
      `Make sure your response is a valid JSON object. Do not include any other conversational text in your final response.`;

    log.debug(`sending cowork decision prompt to bound agent`, {
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
      log.debug(`received cowork decision response`, {
        task_id: taskId,
        response: response.slice(0, 200),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === "timeout") {
        log.warn(`cowork.created decision timed out — discarding`, { task_id: taskId });
        console.warn(
          `[agent-registry] arbiter: cowork.created decision timed out for task_id="${taskId}" — discarding`,
        );
      } else {
        log.error(`session error during cowork decision — discarding`, {
          task_id: taskId,
          error: message,
        });
        console.error(
          `[agent-registry] arbiter: session error during cowork decision: ${message} — discarding`,
        );
        invalidateSession();
      }
      return;
    }

    if (!isAffirmative(response)) {
      log.info(`Bound_Agent declined cowork`, { task_id: taskId, response: response.slice(0, 80) });
      console.info(`[agent-registry] arbiter: Bound_Agent declined task_id="${taskId}"`);
      return;
    }

    // Extract offered skills from the response text.
    const offeredSkills = extractOfferedSkills(response, configuredSkills);

    // Affirmative: subscribe to the cowork topic and publish join envelope.
    const topic = `a2a.cowork.${taskId}`;

    // Route incoming messages through the MessageRouter (same pattern as discussion).
    natsClient.subscribe(topic, createCollaborationTopicHandler(topic));

    const joinEnvelope = createEnvelope({
      request_id: uuidv4(),
      message_type: "req",
      source: getEffectiveAgentId(),
      seq: 0,
      action: "join",
      resource_type: "cowork",
      payload: { agent_id: getEffectiveAgentId(), task_id: taskId, offered_skills: offeredSkills },
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
     * Enqueue a `cowork.created` broadcast for sequential processing.
     * Requirement 6.6, 6.10
     */
    async processCoworkCreated(payload: Record<string, unknown>): Promise<void> {
      if (disposed) return;
      enqueue(() => processCoworkCreatedTask(payload));
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
