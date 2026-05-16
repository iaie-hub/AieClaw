/**
 * Channel status adapter for the agent-registry plugin.
 *
 * Provides a simple in-memory store for the plugin's operational status.
 * Status transitions are applied synchronously so callers observe the new
 * state immediately — satisfying the ≤1 second reporting requirement from
 * Requirement 11.6.
 */

import type { PluginStatus } from "./types.js";

// ---------------------------------------------------------------------------
// Public interface
// ---------------------------------------------------------------------------

export interface StatusAdapter {
  /** Update the current plugin status. Applied synchronously. */
  setStatus(status: PluginStatus): void;
  /** Return the current plugin status. */
  getStatus(): PluginStatus;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a `StatusAdapter` that stores the plugin's operational status in
 * memory and reports transitions synchronously.
 *
 * The initial status is `"disabled"` as required by the plugin lifecycle
 * contract (Requirement 11.6).
 */
export function createStatusAdapter(): StatusAdapter {
  let current: PluginStatus = "disabled";

  return {
    setStatus(status: PluginStatus): void {
      current = status;
    },

    getStatus(): PluginStatus {
      return current;
    },
  };
}
