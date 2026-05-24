/**
 * Plugin SDK seam for real-time collaboration event emission.
 *
 * Channel plugins that participate in A2A discussions or coworks
 * import `emitCollabEvent` from this module to forward NATS messages
 * to the in-process collab event bus, which the mas4s gateway integration
 * then delivers to watching UI WebSocket clients.
 *
 * Usage in a channel plugin:
 *   import { emitCollabEvent } from "openclaw/plugin-sdk/collab-runtime";
 *   emitCollabEvent({ topic: "a2a.discussion.disc-xxx", message: envelope });
 */

export { emitCollabEvent, onCollabEvent } from "../infra/collab-events.js";
export type { CollabEventData } from "../infra/collab-events.js";
