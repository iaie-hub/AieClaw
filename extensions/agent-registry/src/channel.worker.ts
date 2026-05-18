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

parentPort?.on("message", async (msg) => {
  try {
    if (msg.type === "START") {
      const { config, skills, description } = msg;

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
          void handleReconnect(config, skills, description);
        },
      });

      await natsClient.connect();

      // 2. Register
      parentPort?.postMessage({ type: "STATUS", status: "registering" });
      registrationManager = createRegistrationManager({
        config,
        natsClient,
        getInstalledSkills: async () =>
          skills.map((name: string) => ({ name, id: name, description: "", tags: [] })),
        getAgentDescription: async () => description,
      });

      const registerResult = await registrationManager.register();
      if (!registerResult.ok) {
        throw new Error(registerResult.error ?? "Registration failed");
      }

      const effectiveAgentId = registerResult.agentId ?? config.agentId;
      const topics = registerResult.topics!;
      const ttlMs = registerResult.ttlMs!;

      // 3. Subscribe base topics
      subscribeBaseTopics(topics);

      // 4. Start heartbeat
      heartbeatManager = createHeartbeatManager({
        getAgentId: () => effectiveAgentId,
        natsClient: natsClient!,
        getActiveSessionCount: () => activeSessionCount,
      });
      heartbeatManager.start(ttlMs);

      parentPort?.postMessage({ type: "STATUS", status: "registered" });
      parentPort?.postMessage({
        type: "REGISTERED",
        ok: true,
        agentId: effectiveAgentId,
        topics,
        ttlMs,
      });
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

async function handleReconnect(config: any, skills: any, description: any) {
  try {
    const registerResult = await registrationManager!.register();
    if (!registerResult.ok) {
      throw new Error(registerResult.error ?? "Re-registration failed");
    }

    const effectiveAgentId = registerResult.agentId ?? config.agentId;
    const newTopics = registerResult.topics!;
    const newTtlMs = registerResult.ttlMs!;

    // Clean up old base topic subscriptions from the map and NATS
    const oldBaseSubjects = [
      ...Array.from(subscriptions.keys()).filter(
        (subject) =>
          subject.startsWith("a2a.agent.unicast.") ||
          subject === "a2a.agent.broadcast.all" ||
          subject.startsWith("a2a.agent.multicast."),
      ),
    ];

    for (const subject of oldBaseSubjects) {
      const sub = subscriptions.get(subject);
      if (sub) {
        try {
          sub.unsubscribe();
        } catch {}
        subscriptions.delete(subject);
      }
    }

    // Subscribe to new base topics
    subscribeBaseTopics(newTopics);

    // Restart heartbeat with new TTL
    heartbeatManager?.start(newTtlMs);

    parentPort?.postMessage({ type: "STATUS", status: "registered" });
    parentPort?.postMessage({
      type: "REGISTERED",
      ok: true,
      agentId: effectiveAgentId,
      topics: newTopics,
      ttlMs: newTtlMs,
    });
  } catch (err: any) {
    parentPort?.postMessage({ type: "STATUS", status: "unavailable" });
  }
}
