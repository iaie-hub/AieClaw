/**
 * Restore SOP run state after WebSocket reconnect or session switch.
 *
 * Must be called after session.history.range succeeds so the message list
 * is already populated before SOP state is applied.
 */

import type { GatewayBrowserClient } from "../lib/gateway.js";
import type { AppStore } from "../store/app-store.js";

interface RunStateResult {
  sessionKey: string;
  isChatting: boolean;
  runId?: string;
  sopState: Record<string, unknown> | null;
}

/**
 * Fetch and apply the persisted run state for a session from the gateway.
 * Safe to call on every session open — always re-fetches to stay in sync.
 */
export async function restoreSessionRunState(
  client: GatewayBrowserClient,
  store: AppStore,
  sessionKey: string,
  sessionUuid: string,
): Promise<void> {
  try {
    const result = await client.request<RunStateResult>("session.run.state", { sessionKey });

    if (result.isChatting) {
      store.setIsChatting(sessionUuid, true, result.runId);
    } else {
      // Explicitly clear stale isChatting=true from previous session load
      store.setIsChatting(sessionUuid, false);
    }

    const sopState = result.sopState;
    if (
      sopState &&
      Array.isArray(sopState["steps"]) &&
      (sopState["steps"] as unknown[]).length > 0
    ) {
      store.updateSOPState(sessionUuid, { ...sopState, sessionKey });
    }
  } catch {
    // Non-critical: failure here does not affect message list display
  }
}
