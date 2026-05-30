/**
 * HeartbeatManager — periodic heartbeat publisher for the agent-registry plugin.
 *
 * Publishes a heartbeat to `registry.agent.heartbeat` at `floor(TTL / 3)` ms intervals.
 * Uses an async counting scheme to detect Registry offline:
 * - Each heartbeat sets `reply_to` to a fixed subject `a2a.agent.heartbeat-ack.{agentId}`
 * - A subscription on that subject resets `missedCount` on each ack
 * - Before sending, if `missedCount >= MAX_MISSED` (3), triggers `onRegistryOffline`
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8
 */

import { v4 as uuidv4 } from "uuid";
import { createEnvelope, serializeEnvelope } from "./envelope.js";
import { createLogger } from "./logger.js";
import type { HeartbeatManagerOptions, HeartbeatPayload, NATSSubscription } from "./types.js";

const log = createLogger("heartbeat");

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface HeartbeatManager {
  start(ttlMs: number): void;
  stop(): void;
  readonly isRunning: boolean;
}

// ---------------------------------------------------------------------------
// Pure helpers (exported for property-based testing)
// ---------------------------------------------------------------------------

/**
 * Returns the heartbeat interval in milliseconds for a given TTL.
 * Fixed at TTL / 3 (e.g. TTL=180000ms → heartbeat every 60s).
 */
export function computeHeartbeatInterval(ttlMs: number): number {
  return Math.floor(ttlMs / 3);
}

/**
 * Builds the heartbeat payload for a given agent and active session count.
 * Requirements 5.2, 5.3, 5.4, 5.5
 */
export function buildHeartbeatPayload(
  agentId: string,
  activeSessionCount: number,
): HeartbeatPayload {
  return {
    agent_id: agentId,
    status: activeSessionCount > 0 ? "busy" : "idle",
    load: {
      cpu: 0,
      memory: 0,
      active_task_count: activeSessionCount,
    },
  };
}

/**
 * Returns the fixed heartbeat ack subject for a given agent.
 */
export function heartbeatAckSubject(agentId: string): string {
  return `a2a.agent.heartbeat-ack.${agentId}`;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of consecutive missed acks before declaring Registry offline. */
const MAX_MISSED = 3;

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createHeartbeatManager(options: HeartbeatManagerOptions): HeartbeatManager {
  const { getAgentId, natsClient, getActiveSessionCount, onRegistryOffline, onRegistryOnline } =
    options;

  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;
  let ackSubscription: NATSSubscription | null = null;

  let seq = 0;
  let missedCount = 0;
  let registryOnline = true;

  function onAckReceived(): void {
    missedCount = 0;
    if (!registryOnline) {
      registryOnline = true;
      log.info(`Registry back online (ack received)`);
      onRegistryOnline?.();
    }
  }

  function publishHeartbeat(): void {
    try {
      const agentId = getAgentId();

      // Check if Registry is offline before sending
      if (missedCount >= MAX_MISSED) {
        if (registryOnline) {
          registryOnline = false;
          log.error(`Registry appears offline after ${MAX_MISSED} consecutive missed acks`, {
            agentId,
            missedCount,
          });
          onRegistryOffline?.();
        }
        // Still send heartbeat so we can detect recovery
      }

      const payload = buildHeartbeatPayload(agentId, getActiveSessionCount());
      const replyTo = heartbeatAckSubject(agentId);

      const envelope = createEnvelope({
        message_type: "req",
        source: agentId,
        seq: seq++,
        action: "heartbeat",
        resource_type: "agent",
        request_id: uuidv4(),
        payload: payload as unknown as Record<string, unknown>,
        reply_to: replyTo,
      });
      const bytes = serializeEnvelope(envelope);
      natsClient.publish("registry.agent.heartbeat", bytes);
      missedCount++;

      log.debug(`heartbeat sent`, {
        agent_id: payload.agent_id,
        status: payload.status,
        active_task_count: payload.load.active_task_count,
        missedCount,
      });
    } catch (error) {
      // Requirement 5.7: log failure with agent_id and error reason; continue on next interval
      const agentId = getAgentId();
      log.error(`heartbeat publish failed`, { agentId, error: String(error) });
      console.error(`[agent-registry] heartbeat publish failed for agent ${agentId}: ${error}`);
    }
  }

  return {
    /**
     * Start (or restart) the heartbeat timer.
     * Requirements 5.1, 5.8: cancel any existing timer; start new interval at floor(TTL/3).
     */
    start(ttlMs: number): void {
      // Requirement 5.8: cancel existing timer before starting a new one
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
        log.debug(`cancelled previous heartbeat timer`);
      }

      // Unsubscribe previous ack subscription if any
      if (ackSubscription) {
        ackSubscription.unsubscribe();
        ackSubscription = null;
      }

      // Reset state
      missedCount = 0;
      registryOnline = true;

      // Subscribe to the fixed ack subject
      const agentId = getAgentId();
      const ackSubject = heartbeatAckSubject(agentId);
      ackSubscription = natsClient.subscribe(ackSubject, () => {
        onAckReceived();
      });
      log.debug(`subscribed to heartbeat ack subject`, { subject: ackSubject });

      const interval = computeHeartbeatInterval(ttlMs);
      timer = setInterval(publishHeartbeat, interval);
      running = true;
    },

    /**
     * Stop the heartbeat timer.
     * Requirement 5.6: cancel the timer before the NATS connection is closed.
     */
    stop(): void {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
      if (ackSubscription) {
        ackSubscription.unsubscribe();
        ackSubscription = null;
      }
      running = false;
      missedCount = 0;
      registryOnline = true;
      log.info(`heartbeat timer stopped`, { agentId: getAgentId() });
    },

    get isRunning(): boolean {
      return running;
    },
  };
}
