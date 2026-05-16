/**
 * HeartbeatManager — periodic heartbeat publisher for the agent-registry plugin.
 *
 * Publishes a heartbeat to `registry.agent.heartbeat` at `floor(TTL / 3)` ms intervals.
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8
 */

import { createLogger } from "./logger.js";
import type { HeartbeatManagerOptions, HeartbeatPayload } from "./types.js";

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
 * Requirement 5.1: interval = floor(TTL / 3)
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

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createHeartbeatManager(
  options: HeartbeatManagerOptions,
): HeartbeatManager {
  const { agentId, natsClient, getActiveSessionCount } = options;

  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  function publishHeartbeat(): void {
    try {
      const payload = buildHeartbeatPayload(agentId, getActiveSessionCount());
      const bytes = new TextEncoder().encode(JSON.stringify(payload));
      natsClient.publish("registry.agent.heartbeat", bytes);
      log.debug(`heartbeat sent`, {
        agent_id: payload.agent_id,
        status: payload.status,
        active_task_count: payload.load.active_task_count,
      });
    } catch (error) {
      // Requirement 5.7: log failure with agent_id and error reason; continue on next interval
      log.error(`heartbeat publish failed`, { agentId, error: String(error) });
      console.error(
        `[agent-registry] heartbeat publish failed for agent ${agentId}: ${error}`,
      );
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

      const interval = computeHeartbeatInterval(ttlMs);
      log.info(`heartbeat timer started`, { ttlMs, intervalMs: interval, agentId });
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
      running = false;
      log.info(`heartbeat timer stopped`, { agentId });
    },

    get isRunning(): boolean {
      return running;
    },
  };
}
