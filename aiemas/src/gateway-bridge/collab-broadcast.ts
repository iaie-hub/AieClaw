/**
 * Connects the in-process collaboration event bus to the gateway broadcast layer.
 *
 * Called by mas4s-integration.ts (core gateway) with its broadcastToAll function.
 * All collab subscription logic stays enclosed in aiemas/src per AGENTS.md §1.
 */
import { onCollabEvent } from "../../../src/infra/collab-events.js";

/**
 * Subscribe to real-time collaboration events and forward them to all connected
 * gateway clients as `collab.message` WebSocket events.
 *
 * @param broadcastFn - The gateway's broadcastToAll function, injected by the caller.
 * @returns Unsubscribe callback — call on gateway shutdown to avoid leaks.
 */
export function startCollabBroadcast(
  broadcastFn: (event: string, payload: unknown) => void,
): () => void {
  return onCollabEvent((event) => {
    broadcastFn("collab.message", { topic: event.topic, data: event.message });
  });
}
