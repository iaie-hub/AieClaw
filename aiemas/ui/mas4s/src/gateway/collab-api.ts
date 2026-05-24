/**
 * Client-side bus for real-time collab.message events pushed by the gateway.
 * The gateway broadcasts all a2a.discussion.* / a2a.cowork.* NATS messages to
 * every connected mas4s UI client. event-handler.ts receives them and calls
 * dispatchCollabMessage() so interested views can react via onCollabMessage().
 */

export type CollabMessage = {
  /** Full NATS topic, e.g. "a2a.discussion.disc-abc" or "a2a.cowork.task-xyz" */
  topic: string;
  /** Parsed RegistryEnvelope from the agent-registry router */
  data: unknown;
};

type CollabListener = (event: CollabMessage) => void;

const listeners: Set<CollabListener> = new Set();

/** Called by event-handler.ts when a collab.message event arrives over WebSocket. */
export function dispatchCollabMessage(event: CollabMessage): void {
  for (const fn of listeners) {
    try {
      fn(event);
    } catch {
      /* ignore listener errors */
    }
  }
}

/**
 * Subscribe to all incoming collab messages.
 * Returns an unsubscribe function — call it in disconnectedCallback.
 */
export function onCollabMessage(listener: CollabListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
