import type { SimpleHandlers } from "./aiemas-utils.js";
import type { ClawHubHandlersDeps } from "./clawhub-helpers.js";
import { registerClawHubAgentsHandlers } from "./handlers-clawhub-agents.js";
import { registerClawHubConfigHandlers } from "./handlers-clawhub-config.js";
import { registerClawHubSkillsHandlers } from "./handlers-clawhub-skills.js";

export type { ClawHubHandlersDeps } from "./clawhub-helpers.js";

/**
 * Register all ClawHub RPC handlers on the given handlers map.
 */
export function registerClawHubHandlers(handlers: SimpleHandlers, deps: ClawHubHandlersDeps): void {
  registerClawHubConfigHandlers(handlers, deps);
  registerClawHubAgentsHandlers(handlers, deps);
  registerClawHubSkillsHandlers(handlers, deps);
}
