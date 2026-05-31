/**
 * Background agent cache warmup module.
 *
 * Runs AFTER the gateway HTTP server is listening, as a non-blocking background
 * task. Pre-warms model discovery, auth storage, and provider caches so that
 * the first chat request per agent doesn't pay the cold-start penalty.
 *
 * Design:
 * - Non-blocking: runs via `void import(...).then(...)` after startListening()
 * - Serial per agent with event-loop yields between steps
 * - Failures are non-fatal and logged as warnings
 * - Zero invasiveness on upstream files (uses public API only)
 *
 * Warmup per agent:
 * - ensureOpenClawModelsJson → provider discovery + targetPath + normalizeProviders caches
 * - discoverAuthStorage + discoverModels → auth storage mtime cache
 * - resolveModelAsync → normalizeResolvedModel cache + provider runtime hook init
 */

import { listAgentIds, resolveAgentDir } from "../agents/agent-scope.js";
import { resolveDefaultModelForAgent } from "../agents/model-selection.js";
import { ensureOpenClawModelsJson } from "../agents/models-config.js";
import { resolveModelAsync } from "../agents/embedded-agent-runner/model.js";
import { discoverAuthStorage, discoverModels } from "../agents/agent-model-discovery.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";

/**
 * Background-warm all known agent caches.
 * Must be called AFTER the gateway is listening (non-blocking).
 */
export async function warmupAgentCaches(config?: OpenClawConfig): Promise<void> {
  const started = Date.now();
  try {
    const agentIds = config ? listAgentIds(config) : [];

    for (const agentId of agentIds) {
      const agentStarted = Date.now();
      // Yield to the event loop before each agent so WebSocket frames,
      // HTTP requests, and timers can be processed during warmup.
      await new Promise<void>((resolve) => setImmediate(resolve));

      try {
        const agentDir = resolveAgentDir(config!, agentId);

        // 1. Model config normalization (can be CPU-heavy with many providers)
        await ensureOpenClawModelsJson(config, agentDir);
        await new Promise<void>((resolve) => setImmediate(resolve));

        // 2. Auth storage + model discovery caches
        const authStorage = discoverAuthStorage(agentDir);
        const modelRegistry = discoverModels(authStorage, agentDir);
        await new Promise<void>((resolve) => setImmediate(resolve));

        // 3. Model resolution (provider runtime hook init)
        const defaultModel = resolveDefaultModelForAgent({ cfg: config!, agentId });
        await resolveModelAsync(defaultModel.provider, defaultModel.model, agentDir, config, {
          authStorage,
          modelRegistry,
        });

        console.log(`[perf:warmup] agent "${agentId}" warmed in ${Date.now() - agentStarted}ms`);
      } catch (err) {
        console.warn(`[perf:warmup] agent "${agentId}" warmup failed: ${String(err)}`);
      }
    }

    console.log(
      `[perf:warmup] all agent caches warmed in ${Date.now() - started}ms (agents=${agentIds.length})`,
    );
  } catch (err) {
    console.warn(`[perf:warmup] agent cache warmup failed (non-fatal): ${String(err)}`);
  }
}
