import { parentPort } from "node:worker_threads";
import { createHeartbeatManager } from "./heartbeat.js";
import { createNATSClient } from "./nats-client.js";
import { createRegistrationManager } from "./registration.js";
import type { NATSSubscription, NATSClient } from "./types.js";

let natsClient: NATSClient | null = null;
let registrationManager: ReturnType<typeof createRegistrationManager> | null = null;
let heartbeatManager: ReturnType<typeof createHeartbeatManager> | null = null;

const subscriptions = new Map<string, NATSSubscription>();
let activeSessionCount = 0;

// ---------------------------------------------------------------------------
// Unified registration retry state
// ---------------------------------------------------------------------------

/** Whether a registration attempt is currently in progress. */
let registrationInFlight = false;

/** Number of consecutive failed registration attempts (for backoff). */
let registrationFailCount = 0;

/** Timer for scheduled registration retries. */
let registrationRetryTimer: ReturnType<typeof setTimeout> | null = null;

/** Whether the agent has ever successfully registered in this worker lifecycle. */
let hasRegistered = false;

/** Current config/skills/description for retry use. */
let workerConfig: any = null;
let workerSkills: any = null;
let workerDescription: any = null;

/**
 * Compute retry delay with exponential backoff: 10s, 20s, 40s, 60s (capped).
 */
function computeRetryDelay(failCount: number): number {
  return Math.min(10000 * 2 ** (failCount - 1), 60000);
}

/**
 * Unified registration attempt with throttle and backoff.
 * Used for both initial registration and re-registration after offline detection.
 * Does NOT throw — reports status via parentPort messages.
 */
async function attemptRegistration(): Promise<boolean> {
  if (registrationInFlight) {
    return false;
  }

  registrationInFlight = true;
  try {
    const registerResult = await registrationManager!.register();
    if (!registerResult.ok) {
      throw new Error(registerResult.error ?? "Registration failed");
    }

    const effectiveAgentId = registerResult.agentId ?? workerConfig.agentId;
    const topics = registerResult.topics!;
    const ttlMs = registerResult.ttlMs!;

    // Clean up old base topic subscriptions if re-registering
    if (hasRegistered) {
      const oldBaseSubjects = Array.from(subscriptions.keys()).filter(
        (subject) =>
          subject.startsWith("a2a.agent.unicast.") ||
          subject === "a2a.agent.broadcast.all" ||
          subject.startsWith("a2a.agent.multicast."),
      );
      for (const subject of oldBaseSubjects) {
        const sub = subscriptions.get(subject);
        if (sub) {
          try { sub.unsubscribe(); } catch {}
          subscriptions.delete(subject);
        }
      }
    }

    // Subscribe base topics
    subscribeBaseTopics(topics);

    // Start or restart heartbeat
    if (!heartbeatManager) {
      heartbeatManager = createHeartbeatManager({
        getAgentId: () => effectiveAgentId,
        natsClient: natsClient!,
        getActiveSessionCount: () => activeSessionCount,
        onRegistryOffline: () => {
          parentPort?.postMessage({ type: "STATUS", status: "unavailable" });
          parentPort?.postMessage({ type: "REGISTRY_OFFLINE" });
          scheduleRegistrationRetry();
        },
        onRegistryOnline: () => {
          registrationFailCount = 0;
          cancelRegistrationRetry();
          parentPort?.postMessage({ type: "STATUS", status: "registered" });
          parentPort?.postMessage({ type: "REGISTRY_ONLINE" });
        },
      });
    }
    heartbeatManager.start(ttlMs);

    // Success — reset state
    hasRegistered = true;
    registrationFailCount = 0;
    cancelRegistrationRetry();

    parentPort?.postMessage({ type: "STATUS", status: "registered" });
    parentPort?.postMessage({
      type: "REGISTERED",
      ok: true,
      agentId: effectiveAgentId,
      topics,
      ttlMs,
    });
    return true;
  } catch (err: any) {
    registrationFailCount++;
    parentPort?.postMessage({ type: "STATUS", status: "unavailable" });

    if (!hasRegistered) {
      // Initial registration failed — schedule retry instead of exiting
      parentPort?.postMessage({
        type: "REGISTERED",
        ok: false,
        error: err.message || String(err),
        willRetry: true,
      });
    }
    return false;
  } finally {
    registrationInFlight = false;
  }
}

/**
 * Schedule the next registration retry with exponential backoff.
 */
function scheduleRegistrationRetry(): void {
  if (registrationRetryTimer !== null) {
    return; // Already scheduled
  }

  const delay = computeRetryDelay(registrationFailCount);
  registrationRetryTimer = setTimeout(async () => {
    registrationRetryTimer = null;
    const success = await attemptRegistration();
    if (!success) {
      scheduleRegistrationRetry();
    }
  }, delay);
}

/**
 * Cancel any pending registration retry.
 */
function cancelRegistrationRetry(): void {
  if (registrationRetryTimer !== null) {
    clearTimeout(registrationRetryTimer);
    registrationRetryTimer = null;
  }
}

parentPort?.on("message", async (msg) => {
  try {
    if (msg.type === "START") {
      const { config, skills, description } = msg;
      workerConfig = config;
      workerSkills = skills;
      workerDescription = description;

      // 1. Create and connect NATS client
      parentPort?.postMessage({ type: "STATUS", status: "connecting" });
      natsClient = createNATSClient({
        url: config.natsUrl,
        token: config.natsToken,
        onDisconnect: () => {
          parentPort?.postMessage({ type: "STATUS", status: "reconnecting" });
        },
        onReconnect: () => {
          parentPort?.postMessage({ type: "STATUS", status: "registering" });
          void attemptRegistration();
        },
      });

      await natsClient.connect();

      // 2. Create registration manager
      parentPort?.postMessage({ type: "STATUS", status: "registering" });
      registrationManager = createRegistrationManager({
        config,
        natsClient,
        getInstalledSkills: async () =>
          skills.map((name: string) => ({ name, id: name, description: "", tags: [] })),
        getAgentDescription: async () => description,
      });

      // 3. Attempt registration (unified path)
      const success = await attemptRegistration();
      if (!success) {
        // Schedule retry — worker stays alive
        scheduleRegistrationRetry();
      }
    } else if (msg.type === "PUBLISH") {
      const { subject, payload } = msg;
      natsClient?.publish(subject, payload);
    } else if (msg.type === "SUBSCRIBE") {
      const { subject } = msg;
      if (!subscriptions.has(subject)) {
        const sub = natsClient?.subscribe(subject, (payload) => {
          parentPort?.postMessage({ type: "MESSAGE", subject, payload });
        });
        if (sub) {
          subscriptions.set(subject, sub);
        }
      }
    } else if (msg.type === "UNSUBSCRIBE") {
      const { subject } = msg;
      const sub = subscriptions.get(subject);
      if (sub) {
        sub.unsubscribe();
        subscriptions.delete(subject);
      }
    } else if (msg.type === "REQUEST") {
      const { subject, payload, timeoutMs, requestId } = msg;
      if (natsClient) {
        try {
          const res = await natsClient.request(subject, payload, timeoutMs);
          parentPort?.postMessage({ type: "REQUEST_RESPONSE", requestId, ok: true, payload: res });
        } catch (err: any) {
          parentPort?.postMessage({
            type: "REQUEST_RESPONSE",
            requestId,
            ok: false,
            error: err.message,
          });
        }
      } else {
        parentPort?.postMessage({
          type: "REQUEST_RESPONSE",
          requestId,
          ok: false,
          error: "NATS client not connected",
        });
      }
    } else if (msg.type === "UPDATE_SESSION_COUNT") {
      activeSessionCount = msg.count;
    } else if (msg.type === "STOP") {
      cancelRegistrationRetry();
      heartbeatManager?.stop();
      if (registrationManager) {
        try {
          await registrationManager.deregister();
        } catch {}
      }
      for (const sub of subscriptions.values()) {
        try {
          sub.unsubscribe();
        } catch {}
      }
      subscriptions.clear();
      if (natsClient) {
        try {
          await natsClient.unsubscribeAll();
          await natsClient.drain(5000);
          await natsClient.close();
        } catch {}
      }
      process.exit(0);
    }
  } catch (err: any) {
    parentPort?.postMessage({
      type: "REGISTERED",
      ok: false,
      error: err.message || String(err),
    });
    parentPort?.postMessage({ type: "STATUS", status: "unavailable" });
  }
});

function subscribeBaseTopics(topics: any) {
  // Subscribe to unicast
  const unicastSub = natsClient?.subscribe(topics.unicast, (payload) => {
    parentPort?.postMessage({ type: "MESSAGE", subject: topics.unicast, payload });
  });
  if (unicastSub) subscriptions.set(topics.unicast, unicastSub);

  // Subscribe to multicast
  for (const multicastTopic of topics.multicast) {
    const sub = natsClient?.subscribe(multicastTopic, (payload) => {
      parentPort?.postMessage({ type: "MESSAGE", subject: multicastTopic, payload });
    });
    if (sub) subscriptions.set(multicastTopic, sub);
  }

  // Subscribe to broadcast
  const broadcastSub = natsClient?.subscribe(topics.broadcast, (payload) => {
    parentPort?.postMessage({ type: "MESSAGE", subject: topics.broadcast, payload });
  });
  if (broadcastSub) subscriptions.set(topics.broadcast, broadcastSub);
}
