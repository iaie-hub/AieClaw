/**
 * NATS client wrapper for the agent-registry channel plugin.
 *
 * Owns the single NATS connection for the plugin lifetime. Wraps nats.js
 * (the official NATS TypeScript client) and exposes a narrow interface used
 * by the rest of the plugin.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 4.1, 4.2, 4.3
 */

import { connect, Events } from "nats";
import type { NatsConnection, Subscription } from "nats";
import { buildNatsConnectOptions } from "./config.js";
import { createLogger } from "./logger.js";
import type { NATSClient, NATSClientOptions, NATSSubscription } from "./types.js";

const log = createLogger("nats-client");

/**
 * Create a NATSClient instance wrapping nats.js.
 *
 * The returned client is not connected until `connect()` is called.
 */
export function createNATSClient(options: NATSClientOptions): NATSClient {
  let nc: NatsConnection | null = null;
  let closed = false;

  // Track all active subscriptions keyed by subject for unsubscribeAll().
  // Multiple subscriptions to the same subject are stored with a unique key
  // (subject + "#" + index) to avoid collisions.
  const subscriptions = new Map<string, Subscription>();
  let subIndex = 0;

  // ---------------------------------------------------------------------------
  // connect
  // ---------------------------------------------------------------------------

  async function connectClient(): Promise<void> {
    const connectOptions = buildNatsConnectOptions({
      natsUrl: options.url,
      agentId: "",
      agentName: "",
      natsToken: options.token,
      skills: [],
    });

    log.info(`connecting to NATS server`, { url: options.url, hasToken: Boolean(options.token) });

    nc = await connect(connectOptions);

    log.info(`NATS connection established`, { url: options.url });

    // Wire disconnect / reconnect callbacks via the nats.js status iterator.
    // This runs in the background for the lifetime of the connection.
    (async () => {
      if (!nc) return;
      for await (const s of nc.status()) {
        if (s.type === Events.Disconnect) {
          log.warn(`NATS disconnected`, { url: options.url, statusData: String(s.data ?? "") });
          options.onDisconnect();
        } else if (s.type === Events.Reconnect) {
          log.info(`NATS reconnected`, { url: options.url, statusData: String(s.data ?? "") });
          options.onReconnect();
        } else {
          log.debug(`NATS status event`, { type: s.type, data: String(s.data ?? "") });
        }
      }
    })().catch(() => {
      /* ignore — connection closed */
    });
  }

  // ---------------------------------------------------------------------------
  // request
  // ---------------------------------------------------------------------------

  async function request(
    subject: string,
    payload: Uint8Array,
    timeoutMs: number,
  ): Promise<Uint8Array> {
    if (!nc) {
      throw new Error("NATSClient: not connected");
    }
    log.debug(`request → ${subject}`, { bytes: payload.length, timeoutMs });
    const msg = await nc.request(subject, payload, { timeout: timeoutMs });
    log.debug(`request ← ${subject}`, { responseBytes: msg.data.length });
    return msg.data;
  }

  // ---------------------------------------------------------------------------
  // publish
  // ---------------------------------------------------------------------------

  function publish(subject: string, payload: Uint8Array): void {
    if (!nc) {
      throw new Error("NATSClient: not connected");
    }
    log.debug(`publish → ${subject}`, { bytes: payload.length });
    nc.publish(subject, payload);
  }

  // ---------------------------------------------------------------------------
  // subscribe
  // ---------------------------------------------------------------------------

  function subscribe(
    subject: string,
    handler: (msg: Uint8Array) => void,
  ): NATSSubscription {
    if (!nc) {
      throw new Error("NATSClient: not connected");
    }

    const sub = nc.subscribe(subject);
    const key = `${subject}#${subIndex++}`;
    subscriptions.set(key, sub);

    log.info(`subscribed to topic`, { subject, key });

    // Iterate messages in a background async loop.
    (async () => {
      for await (const msg of sub) {
        log.debug(`← received message on ${subject}`, { bytes: msg.data.length });
        try {
          handler(msg.data);
        } catch (err) {
          log.error(`handler threw on subject "${subject}"`, String(err));
          /* handler errors must not kill the subscription loop */
        }
      }
      log.debug(`subscription loop ended for ${subject}`);
    })().catch(() => {
      /* ignore — subscription drained or connection closed */
    });

    return {
      subject,
      unsubscribe(): void {
        log.info(`unsubscribed from topic`, { subject, key });
        sub.unsubscribe();
        subscriptions.delete(key);
      },
    };
  }

  // ---------------------------------------------------------------------------
  // unsubscribeAll
  // ---------------------------------------------------------------------------

  async function unsubscribeAll(): Promise<void> {
    log.info(`unsubscribing all topics`, { count: subscriptions.size });
    for (const sub of subscriptions.values()) {
      sub.unsubscribe();
    }
    subscriptions.clear();
  }

  // ---------------------------------------------------------------------------
  // drain
  // ---------------------------------------------------------------------------

  async function drain(timeoutMs: number): Promise<void> {
    if (!nc) return;
    log.info(`draining NATS connection`, { timeoutMs });
    await Promise.race([
      nc.drain(),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
    log.info(`drain complete`);
  }

  // ---------------------------------------------------------------------------
  // close
  // ---------------------------------------------------------------------------

  async function close(): Promise<void> {
    if (closed) return;
    closed = true;
    log.info(`closing NATS connection`);
    if (nc) {
      await nc.close();
    }
    log.info(`NATS connection closed`);
  }

  // ---------------------------------------------------------------------------
  // isConnected getter
  // ---------------------------------------------------------------------------

  return {
    connect: connectClient,
    request,
    publish,
    subscribe,
    unsubscribeAll,
    drain,
    close,
    get isConnected(): boolean {
      return nc !== null && !nc.isClosed();
    },
  };
}
