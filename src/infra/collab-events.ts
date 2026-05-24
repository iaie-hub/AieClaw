/**
 * Process-level pub/sub bus for real-time collaboration events.
 *
 * Any plugin that subscribes to NATS collaboration topics can emit events
 * here via emitCollabEvent(). Gateway integrations listen via onCollabEvent()
 * and forward them to connected UI clients.
 *
 * Versioned singleton key: "openclaw.collabEvents.v1"
 */

import { resolveGlobalSingleton } from "../shared/global-singleton.js";
import { notifyListeners, registerListener } from "../shared/listeners.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type CollabEventData = {
  /** Full NATS topic, e.g. "a2a.discussion.disc-abc" or "a2a.cowork.task-xyz" */
  topic: string;
  /** Parsed envelope payload from NATS */
  message: unknown;
};

// ---------------------------------------------------------------------------
// Singleton state
// ---------------------------------------------------------------------------

type State = {
  listeners: Set<(event: CollabEventData) => void>;
};

const KEY = Symbol.for("openclaw.collabEvents.v1");

function getState(): State {
  return resolveGlobalSingleton<State>(KEY, () => ({
    listeners: new Set(),
  }));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/** Emit a collaboration event to all registered listeners. */
export function emitCollabEvent(event: CollabEventData): void {
  notifyListeners(getState().listeners, event);
}

/**
 * Register a listener for collaboration events.
 * Returns an unsubscribe function.
 */
export function onCollabEvent(listener: (event: CollabEventData) => void): () => void {
  return registerListener(getState().listeners, listener);
}
