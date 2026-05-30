/**
 * CollaborationArbiter — maintains a single long-lived Bound_Agent session and
 * processes `cowork.created` broadcasts sequentially.
 *
 * Design:
 * - One `ArbiterSession` is created on `initialize()` and reused for all decisions.
 * - A single-concurrency promise chain (sequential queue) ensures broadcasts are
 *   processed one at a time in arrival order.
 * - Each decision has a 90-second timeout; on timeout or negative response the
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
function tryParseJson(cleanText: string): { decision?: string } | null {
  try {
    const jsonStart = cleanText.indexOf("{");
    const jsonEnd = cleanText.lastIndexOf("}");
    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
      const jsonCandidate = cleanText.substring(jsonStart, jsonEnd + 1);
      const parsed = JSON.parse(jsonCandidate);
      if (parsed && typeof parsed === "object") {
        return {
          decision: typeof parsed.decision === "string" ? parsed.decision : undefined,
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
  let queue: Promise<void> = Promise.resolve();

  // -------------------------------------------------------------------------
  // Session management
  // -------------------------------------------------------------------------

  function ensureSession(): ArbiterSession {
    if (session === null) {
      log.info(`creating new arbiter session`, { boundAgentId });
      session = createArbiterSession(boundAgentId) as unknown as ArbiterSession;
    }
    return session;
  }

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

  function enqueue(task: () => Promise<void>): void {
    queue = queue
      .then(() => {
        if (disposed) return;
        return task();
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err);
        log.error(`queue task error`, message);
        console.error(`[agent-registry] arbiter: queue task error: ${message}`);
      });
  }

  // -------------------------------------------------------------------------
  // Cowork processing (unified — handles both discussion and task modes)
  // -------------------------------------------------------------------------

  async function processCoworkCreatedTask(payload: Record<string, unknown>): Promise<void> {
    const content = (payload["content"] ?? payload) as Record<string, unknown>;
    const coworkId = String(payload["cowork_id"] ?? payload["id"] ?? "");
    const text = String(content["text"] ?? "");
    const description = String(content["description"] ?? "");
    const conversation = String(content["conversation"] ?? "");

    log.info(`processing cowork.created`, {
      cowork_id: coworkId,
      text: text.slice(0, 100),
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
      `A new collaboration has been created:\n` +
      `- Name: '${text}'\n` +
      `- Description: ${description}\n` +
      `- Current context: ${conversation}\n\n` +
      `## Instructions\n` +
      `1. Analyze if the name and description align with your core responsibilities and capabilities listed in the 'Agent Capability Context' above.\n` +
      `2. If they align and you can contribute meaningfully, decide to join. Otherwise, decline.\n` +
      `3. You MUST respond with a JSON object in the following format:\n` +
      `{\n` +
      `  "decision": "yes",\n` +
      `  "reason": "Brief explanation of capability alignment"\n` +
      `}\n` +
      `If you decline, set "decision" to "no".\n\n` +
      `Make sure your response is a valid JSON object. Do not include any other conversational text in your final response.`;

    log.debug(`sending cowork decision prompt to bound agent`, {
      cowork_id: coworkId,
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
        cowork_id: coworkId,
        response: response.slice(0, 200),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message === "timeout") {
        log.warn(`cowork.created decision timed out — discarding`, { cowork_id: coworkId });
        console.warn(
          `[agent-registry] arbiter: cowork.created decision timed out for cowork_id="${coworkId}" — discarding`,
        );
      } else {
        log.error(`session error during cowork decision — discarding`, {
          cowork_id: coworkId,
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
      log.info(`Bound_Agent declined cowork`, {
        cowork_id: coworkId,
        response: response.slice(0, 80),
      });
      console.info(`[agent-registry] arbiter: Bound_Agent declined cowork_id="${coworkId}"`);
      return;
    }

    // Affirmative: subscribe to the cowork topic and publish join envelope.
    const topic = `a2a.cowork.${coworkId}`;

    log.info(`joining cowork`, { cowork_id: coworkId, topic });

    // Route incoming messages on this topic through the MessageRouter.
    natsClient.subscribe(topic, createCollaborationTopicHandler(topic));

    const joinEnvelope = createEnvelope({
      request_id: uuidv4(),
      message_type: "req",
      source: getEffectiveAgentId(),
      seq: 0,
      action: "join",
      resource_type: "cowork",
      payload: { agent_id: getEffectiveAgentId(), cowork_id: coworkId },
      reply_to: null,
    });

    natsClient.publish(topic, serializeEnvelope(joinEnvelope));

    log.info(`joined cowork — join envelope published`, { cowork_id: coworkId, topic });
    console.info(`[agent-registry] arbiter: joined cowork_id="${coworkId}"`);
  }

  // -------------------------------------------------------------------------
  // Public CollaborationArbiter interface
  // -------------------------------------------------------------------------

  return {
    async initialize(): Promise<void> {
      ensureSession();
    },

    async processCoworkCreated(payload: Record<string, unknown>): Promise<void> {
      if (disposed) return;
      enqueue(() => processCoworkCreatedTask(payload));
    },

    dispose(): void {
      disposed = true;
      invalidateSession();
    },
  };
}
