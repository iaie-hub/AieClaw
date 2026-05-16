# Implementation Plan: agent-registry-channel

## Overview

Build the `@openclaw/agent-registry` channel plugin as a TypeScript ESM package under `extensions/agent-registry/`. The plugin connects OpenClaw to an Agent Registry's A2A network via native NATS JetStream, following the patterns established by `extensions/telegram/`. Implementation proceeds in dependency order: scaffold → types → config → envelope → NATS client → registration → heartbeat → routing/arbiter → outbound → channel assembly → plugin entry points.

---

## Tasks

- [x] 1. Scaffold package structure and tooling
  - Create `extensions/agent-registry/` directory tree matching the design module structure
  - Write `extensions/agent-registry/package.json` with `name: "@openclaw/agent-registry"`, `"type": "module"`, runtime deps (`nats ^2.29.0`, `uuid ^11.1.0`, `zod ^3.24.0`) and dev deps (`fast-check ^3.23.0`, `@openclaw/plugin-sdk workspace:*`)
  - Write `extensions/agent-registry/tsconfig.json` extending `../tsconfig.package-boundary.base.json` with `rootDir: "."` and `include: ["./*.ts", "./src/**/*.ts"]`, excluding test files
  - Write `extensions/agent-registry/vitest.config.ts` with `include: ["__tests__/**/*.test.ts"]` and `environment: "node"`; configure `fast-check` global `numRuns: 100`
  - Write `extensions/agent-registry/openclaw.plugin.json` manifest with `id: "agent-registry"`, `activation.onStartup: false`, `channels: ["agent-registry"]`, and `channelEnvVars` listing all six `AGENT_REGISTRY_*` env vars
  - _Requirements: 11.1, 11.2_

- [x] 2. Define shared TypeScript types
  - [x] 2.1 Create `extensions/agent-registry/src/types.ts`
    - Define and export all shared interfaces: `NATSClientOptions`, `NATSClient`, `NATSSubscription`, `AgentRegistryConfig`, `RegistryEnvelope`, `AgentCard`, `AgentCapabilities`, `AgentSkill`, `TopicAssignment`, `HeartbeatPayload`, `SessionContext` (discriminated union), `PluginStatus`, `RegisterResult`, `RegistrationManagerOptions`, `HeartbeatManagerOptions`, `MessageRouterOptions`, `CollaborationArbiterOptions`, `OutboundAdapterOptions`, `OutboundSendParams`
    - Use strict TypeScript; no `any`; prefer `unknown` at external boundaries
    - _Requirements: 10.1, 2.2, 2.3, 2.4, 2.5, 2.7, 5.3, 7.1_

- [x] 3. Implement config validation
  - [x] 3.1 Create `extensions/agent-registry/src/config.ts`
    - Define Zod schema for all six `AGENT_REGISTRY_*` env vars with the exact validation rules from the design: `natsUrl` regex `^nats:\/\/[^:]+:\d{1,5}$` with port 1–65535, `agentId` alphanumeric+hyphen+underscore ≤64 chars, `agentName` ≤128 chars, optional `natsToken` ≤512 chars, optional comma-separated `skills` list (each ≤128 chars), optional `boundAgentId` ≤64 chars
    - Export `parseConfig(env: NodeJS.ProcessEnv): AgentRegistryConfig` that throws a descriptive `ZodError`-based message naming the field, violated constraint, and expected format on failure
    - Export `buildNatsConnectOptions(config: AgentRegistryConfig)` returning the `nats.js` connect options object including `token` when present, `reconnect: true`, `maxReconnectAttempts: -1`, `reconnectTimeWait: 1000`, `maxReconnectTimeWait: 30000`
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7, 1.2, 1.7_

  - [x] 3.2 Write property tests for config validation (`__tests__/config.test.ts`)
    - **Property 8: NATS URL validation rejects invalid inputs** — generate arbitrary strings not matching `nats://{host}:{port}` pattern; assert `parseConfig` returns error; generate valid patterns; assert success
    - **Property 9: Agent ID validation** — generate strings with out-of-charset characters or length >64; assert error; generate valid ids; assert success
    - **Property 10: NATS token included in connect options** — for any non-empty token string, assert `buildNatsConnectOptions` includes it in `token` field
    - **Validates: Requirements 9.1, 9.2, 1.2**

- [x] 4. Implement RegistryEnvelope serialization
  - [x] 4.1 Create `extensions/agent-registry/src/envelope.ts`
    - Implement `serializeEnvelope(envelope: RegistryEnvelope): Uint8Array` — JSON-encode to UTF-8 bytes
    - Implement `deserializeEnvelope(bytes: Uint8Array): RegistryEnvelope` — parse and validate all required fields are present and non-null; throw on invalid input
    - Implement `createEnvelope(fields: Omit<RegistryEnvelope, "message_id" | "timestamp"> & Partial<Pick<RegistryEnvelope, "message_id" | "timestamp">>): RegistryEnvelope` — auto-generates `message_id` as UUID v4 via `uuid` package and `timestamp` as `Date.now()`
    - _Requirements: 10.1, 10.2, 10.3, 10.5, 10.6_

  - [x] 4.2 Write property and unit tests for envelope (`__tests__/envelope.test.ts`)
    - **Property 1: RegistryEnvelope serialization round-trip** — for any valid `RegistryEnvelope`, `deserializeEnvelope(serializeEnvelope(e))` produces an object with all required fields equal to the original
    - **Property 2: message_id uniqueness** — two successive `createEnvelope` calls produce distinct `message_id` values
    - **Property 3: timestamp is a non-negative integer** — `createEnvelope` always produces a non-negative integer `timestamp`; successive calls produce non-decreasing timestamps
    - Unit tests: missing required field → `deserializeEnvelope` throws; malformed JSON → throws; all required fields present in serialized output
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.5, 10.6**

- [x] 5. Implement NATS client
  - [x] 5.1 Create `extensions/agent-registry/src/nats-client.ts`
    - Implement `createNATSClient(options: NATSClientOptions): NATSClient` wrapping `nats.js` `connect()`
    - Implement `connect()` — call `nats.connect()` with options from `buildNatsConnectOptions`; wire `onDisconnect` / `onReconnect` callbacks to the `nats.js` status iterator
    - Implement `request(subject, payload, timeoutMs)` — use `nc.request()` with timeout; return response bytes
    - Implement `publish(subject, payload)` — use `nc.publish()`
    - Implement `subscribe(subject, handler)` — use `nc.subscribe()`; return `NATSSubscription` with `unsubscribe()`
    - Implement `unsubscribeAll()` — drain all tracked subscriptions
    - Implement `drain(timeoutMs)` — call `nc.drain()` with a `Promise.race` timeout; resolve regardless of timeout
    - Implement `close()` — call `nc.close()` exactly once; guard against double-close
    - Expose `isConnected` getter
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 4.1, 4.2, 4.3_

- [x] 6. Implement RegistrationManager
  - [x] 6.1 Create `extensions/agent-registry/src/registration.ts`
    - Implement `createRegistrationManager(options: RegistrationManagerOptions): RegistrationManager`
    - Implement `buildAgentCard()` — call `getInstalledSkills()`, filter to names in `config.skills`, map each to `AgentSkill` (id, name, description, tags; include examples/inputModes/outputModes only when present); log warning for unresolved names; set `mac: "00:00:00:00:00:00"`, `transport: "mq"`, `capabilities.longRunningOperations: true`, `url: "nats://a2a.agent.unicast.{agentId}"`, `status: "online"`
    - Implement `register()` — wrap AgentCard in `RegistryEnvelope` (`action: "register"`, `resource_type: "agent"`), call `natsClient.request("registry.agent.register", ..., 10000)`; parse response; store `assignedTopics` and `ttlMs` on success; log and return `ok: false` on failure or timeout
    - Implement `deregister()` — wrap payload in `RegistryEnvelope` (`action: "deregister"`, `resource_type: "agent"`, `payload: { agent_id }`), call `natsClient.request("registry.agent.deregister", ..., 5000)`; log failure but do not throw
    - Expose `assignedTopics` and `ttlMs` getters
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 8.1, 8.2, 8.3_

  - [x] 6.2 Write property and unit tests for registration (`__tests__/registration.test.ts`)
    - **Property 5: AgentCard invariants** — for any valid `AgentRegistryConfig`, `buildAgentCard(config)` produces a card where `agent_id === config.agentId`, `name === config.agentName`, `mac === "00:00:00:00:00:00"`, `transport === "mq"`, `capabilities.longRunningOperations === true`
    - **Property 6: AgentCard skill filtering** — for any configured skill names and installed skills, result contains exactly the intersection; no extras, no omissions
    - **Property 7: Skill field mapping preservation** — for any matched skill, `AgentSkill` id/name/description/tags equal source skill values
    - Unit tests: unresolved skill name → warning logged, entry skipped; `register()` with mock NATS returning `success: false` → `ok: false`, error logged, status `unavailable`; `register()` timeout → `ok: false`, failure logged; `deregister()` failure → logged, no throw
    - **Validates: Requirements 2.1–2.7, 3.1–3.6, 8.1–8.3**

- [x] 7. Implement HeartbeatManager
  - [x] 7.1 Create `extensions/agent-registry/src/heartbeat.ts`
    - Export `computeHeartbeatInterval(ttlMs: number): number` — returns `Math.floor(ttlMs / 3)`
    - Export `buildHeartbeatPayload(agentId: string, activeSessionCount: number): HeartbeatPayload` — sets `status: "busy"` when `activeSessionCount > 0`, `"idle"` otherwise; sets `load.active_task_count = activeSessionCount`, `load.cpu = 0`, `load.memory = 0`
    - Implement `createHeartbeatManager(options: HeartbeatManagerOptions): HeartbeatManager`
    - Implement `start(ttlMs)` — cancel any existing timer; start `setInterval` at `computeHeartbeatInterval(ttlMs)`; on each tick publish heartbeat to `registry.agent.heartbeat` via `natsClient.publish`; log failure with `agent_id` and error reason on publish error; continue on next interval
    - Implement `stop()` — cancel the interval timer
    - Expose `isRunning` getter
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_

  - [x] 7.2 Write property and unit tests for heartbeat (`__tests__/heartbeat.test.ts` — colocated with implementation or in `__tests__/`)
    - **Property 11: Heartbeat interval is floor(TTL/3)** — for any positive integer TTL, `computeHeartbeatInterval(ttl) === Math.floor(ttl / 3)`
    - **Property 12: Heartbeat status reflects active session count** — for any non-negative `activeSessionCount`, `buildHeartbeatPayload` returns `status === "busy"` iff `activeSessionCount > 0`; `load.active_task_count === activeSessionCount`
    - Unit tests: `start()` then `stop()` → timer cancelled; publish failure → error logged, timer continues; `start()` called twice → old timer cancelled, new timer started with new TTL
    - **Validates: Requirements 5.1, 5.3, 5.4, 5.5**

- [x] 8. Implement channel status adapter
  - [x] 8.1 Create `extensions/agent-registry/src/status.ts`
    - Implement `createStatusAdapter()` returning an object with `setStatus(status: PluginStatus): void` and `getStatus(): PluginStatus`
    - Wire to the OpenClaw plugin SDK channel status reporting contract (mirror pattern from `extensions/telegram/src/status.ts` or equivalent SDK seam)
    - Ensure status transitions are reported within 1 second of state change
    - _Requirements: 11.6_

- [x] 9. Implement outbound adapter
  - [x] 9.1 Create `extensions/agent-registry/src/outbound.ts`
    - Implement `createOutboundAdapter(options: OutboundAdapterOptions): OutboundAdapter`
    - Implement `send(params: OutboundSendParams)`:
      - Build `RegistryEnvelope` via `createEnvelope` with `source: agentId`, `message_type: "req"`, `seq: params.sessionSeq`, `action` and `resource_type` per context kind
      - If `inboundEnvelope.reply_to` is non-empty → publish to `reply_to` (highest priority)
      - Else if `sessionContext.kind === "unicast"` → publish to `a2a.agent.unicast.{sourceAgentId}`; if `sourceAgentId` absent → log warning and discard
      - Else if `sessionContext.kind === "multicast"` → publish to `a2a.agent.unicast.{sourceAgentId}` (unicast reply back to sender)
      - Else if `sessionContext.kind === "discussion"` → publish to `a2a.discussion.{discussionId}`, `action: "message"`, include `discussion_id` in payload
      - Else if `sessionContext.kind === "cotask"` → publish to `a2a.cotask.{taskId}`, `action: params.isSessionComplete ? "complete" : "progress"`
    - Maintain per-session `seq` counter starting at 0, incrementing by 1 per published envelope
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 10.4_

  - [x] 9.2 Write property and unit tests for outbound adapter (`__tests__/outbound.test.ts`)
    - **Property 4: seq is monotonically increasing per session** — for any sequence of `send()` calls within one session, `seq` values form a strictly increasing sequence starting from 0
    - **Property 13: Outbound envelope wraps response correctly** — for any response text and valid session context, produced envelope has `source === agentId`, `message_type === "req"`, valid UUID v4 `message_id`, non-negative integer `timestamp`, correct `seq`, and payload containing response text
    - Unit tests: `reply_to` present → published to `reply_to` subject; cotask `isSessionComplete: true` → `action: "complete"`; cotask `isSessionComplete: false` → `action: "progress"`; discussion → `action: "message"` with `discussion_id`; missing `sourceAgentId` on unicast → warning logged, no publish
    - **Validates: Requirements 7.1–7.6, 10.4**

- [x] 10. Implement CollaborationArbiter
  - [x] 10.1 Create `extensions/agent-registry/src/arbiter.ts`
    - Implement `createCollaborationArbiter(options: CollaborationArbiterOptions): CollaborationArbiter`
    - Implement `initialize()` — create the single long-lived Bound_Agent session via `createArbiterSession(boundAgentId)`; store reference
    - Implement sequential async queue (single-concurrency promise chain) for processing broadcasts one at a time
    - Implement `processDiscussionCreated(payload)` — enqueue; when dequeued, send structured prompt to Arbiter session: `"Discussion: '{text}'\nDescription: {description}\nTags: {tags}\nConversation: {conversation}\nShould I join? (yes/no)"`; await response with 30 s timeout; on affirmative: subscribe to `a2a.discussion.{discussionId}` and publish join envelope (`action: "join"`); on negative or timeout: log and discard
    - Implement `processCotaskCreated(payload)` — enqueue; when dequeued, send structured prompt: `"Cotask: '{text}'\nDescription: {description}\nRequired skills: {required_skills}\nConversation: {conversation}\nShould I join? Which skills can I offer?"`; await response with 30 s timeout; on affirmative: subscribe to `a2a.cotask.{taskId}` and publish join envelope (`action: "join"`, `offered_skills: [...]`); on negative or timeout: log and discard
    - Implement `dispose()` — cancel pending queue items, close Arbiter session
    - If Arbiter session terminates unexpectedly, recreate before processing next broadcast
    - _Requirements: 6.5, 6.6, 6.9, 6.10_

- [x] 11. Implement MessageRouter
  - [x] 11.1 Create `extensions/agent-registry/src/router.ts`
    - Implement `createMessageRouter(options: MessageRouterOptions): MessageRouter`
    - Implement `handleUnicast(envelope)` — route to `getOrCreateSession(envelope.source, boundAgentId)`; dispatch message
    - Implement `handleMulticast(envelope)` — route to `getLeastLoadedSession(boundAgentId)` (create new if none); dispatch message
    - Implement `handleBroadcast(envelope)` — switch on `envelope.action`: `"discussion.created"` → `arbiter.processDiscussionCreated(envelope.payload)`; `"cotask.created"` → `arbiter.processCotaskCreated(envelope.payload)`; other → log action and discard
    - Implement `handleCollaborationTopic(topicId, envelope)` — route to `getOrCreateSession(topicId, boundAgentId)`; dispatch message
    - Implement inbound message handler factory: parse bytes via `deserializeEnvelope`; on parse failure log error with raw bytes (truncated to 512 bytes) and subject, discard; dispatch to correct handler based on topic pattern
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10_

  - [x] 11.2 Write unit tests for message router (`__tests__/router.test.ts`)
    - Unit tests: invalid envelope bytes → parse error logged with truncated bytes, discarded; unicast message → `getOrCreateSession` called with `source`; multicast → `getLeastLoadedSession` called; broadcast `discussion.created` → `arbiter.processDiscussionCreated` called; broadcast `cotask.created` → `arbiter.processCotaskCreated` called; broadcast unknown action → logged and discarded; discussion/cotask topic → `getOrCreateSession` called with topic id
    - **Validates: Requirements 6.1–6.10**

- [x] 12. Checkpoint — wire and verify core components
  - Ensure all tests in `__tests__/` pass with `pnpm test extensions/agent-registry`
  - Verify TypeScript compiles cleanly with `pnpm tsgo` lanes
  - Ask the user if questions arise before proceeding to channel assembly.

- [x] 13. Assemble the channel plugin
  - [x] 13.1 Create `extensions/agent-registry/src/channel.ts`
    - Implement `createChatChannelPlugin` (or equivalent SDK factory) following the `extensions/telegram/src/channel.ts` pattern
    - On `start()`:
      1. Parse config via `parseConfig(process.env)`; on failure set status `unavailable` with field-level error message, return
      2. Set status `connecting`; create `NATSClient`; call `connect()`; on failure set status `unavailable`, log error with `AGENT_REGISTRY_NATS_URL`, return
      3. Set status `registering`; call `registrationManager.register()`; on failure set status `unavailable`, return
      4. Subscribe to unicast, multicast, and broadcast topics; wire each to `messageRouter` handlers; on subscription failure set status `unavailable`, log error
      5. Start `heartbeatManager.start(ttlMs)`
      6. Call `arbiter.initialize()`
      7. Set status `registered`
    - On NATS disconnect: set status `reconnecting`; on reconnect: re-register, replace topics, restart heartbeat, re-subscribe
    - On `stop()`:
      1. Set status `disconnected`
      2. `heartbeatManager.stop()`
      3. `arbiter.dispose()`
      4. `registrationManager.deregister()` (best-effort, 5 s timeout)
      5. `natsClient.unsubscribeAll()`
      6. `natsClient.drain(5000)`
      7. `natsClient.close()`
      8. Force-close if total teardown exceeds 10 s
    - Export `agentRegistryPlugin`
    - _Requirements: 1.1, 1.3, 1.4, 1.5, 1.6, 3.3, 3.6, 4.1, 4.2, 4.3, 4.4, 4.5, 5.8, 8.1, 11.3, 11.4, 11.5, 11.6_

- [x] 14. Create plugin entry points
  - [x] 14.1 Create `extensions/agent-registry/channel-plugin-api.ts`
    - Re-export `agentRegistryPlugin` from `./src/channel.js`
    - Mirror the narrow-import pattern from `extensions/telegram/channel-plugin-api.ts`
    - _Requirements: 11.1_

  - [x] 14.2 Create `extensions/agent-registry/index.ts`
    - Call `defineBundledChannelEntry` from `openclaw/plugin-sdk/channel-entry-contract`
    - Set `id: "agent-registry"`, `name`, `description`, `importMetaUrl: import.meta.url`
    - Wire `plugin.specifier: "./channel-plugin-api.js"`, `plugin.exportName: "agentRegistryPlugin"`
    - _Requirements: 11.1, 11.2_

- [x] 15. Final checkpoint — full integration verification
  - Run `pnpm test extensions/agent-registry` and confirm all tests pass
  - Run `pnpm tsgo` lanes to confirm no type errors in the new package
  - Run `pnpm check:import-cycles` to confirm no circular dependencies introduced
  - Ensure all tests pass, ask the user if questions arise.

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP; all core implementation tasks are required
- Each task references specific requirements for traceability
- Property tests use `fast-check` with `numRuns: 100`; they are tagged with the property number from the design document
- Unit tests cover specific examples, edge cases, and error conditions not covered by property tests
- The `nats.js` reconnect is delegated to the library; `channel.ts` only needs to handle the status callbacks
- `seq` counters are per-session and managed by `OutboundAdapter`; each new session starts at 0
- The Arbiter uses a single-concurrency promise chain (not a worker queue library) to keep the dependency footprint minimal
- `buildNatsConnectOptions` is a pure function, making Property 10 straightforward to test without mocking

---

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["2.1"] },
    { "id": 1, "tasks": ["3.1", "4.1"] },
    { "id": 2, "tasks": ["3.2", "4.2", "5.1"] },
    { "id": 3, "tasks": ["6.1", "7.1", "8.1"] },
    { "id": 4, "tasks": ["6.2", "7.2", "9.1"] },
    { "id": 5, "tasks": ["9.2", "10.1"] },
    { "id": 6, "tasks": ["11.1"] },
    { "id": 7, "tasks": ["11.2", "13.1"] },
    { "id": 8, "tasks": ["14.1", "14.2"] }
  ]
}
```
