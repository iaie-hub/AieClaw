/**
 * Unit + property tests for OutboundAdapter.
 *
 * Feature: agent-registry-channel
 * Property 4: seq is monotonically increasing per session
 * Property 13: Outbound envelope wraps response correctly
 *
 * Validates: Requirements 7.1–7.6, 10.4
 */

import * as fc from "fast-check";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { deserializeEnvelope } from "../src/envelope.js";
import { createOutboundAdapter } from "../src/outbound.js";
import type { RegistryEnvelope, SessionContext, OutboundSendParams } from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** UUID v4 pattern */
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Build a minimal valid inbound envelope for use in tests. */
function makeInboundEnvelope(overrides: Partial<RegistryEnvelope> = {}): RegistryEnvelope {
  return {
    message_id: "00000000-0000-4000-8000-000000000001",
    request_id: "00000000-0000-4000-8000-000000000002",
    message_type: "req",
    timestamp: 1_700_000_000_000,
    source: "sender-agent",
    seq: 0,
    action: "message",
    resource_type: "agent",
    payload: { text: "hello" },
    reply_to: null,
    ...overrides,
  };
}

/** Build OutboundSendParams with sensible defaults. */
function makeSendParams(overrides: Partial<OutboundSendParams> = {}): OutboundSendParams {
  return {
    responseText: "response text",
    inboundEnvelope: makeInboundEnvelope(),
    sessionContext: { kind: "unicast", sourceAgentId: "sender-agent" },
    sessionSeq: 0,
    isSessionComplete: false,
    ...overrides,
  };
}

/** Create a mock NATS client that records published bytes. */
function makeMockNatsClient() {
  const published: Array<{ subject: string; bytes: Uint8Array }> = [];
  const mockNatsClient = {
    publish: vi.fn((subject: string, bytes: Uint8Array) => {
      published.push({ subject, bytes });
    }),
    connect: vi.fn(),
    request: vi.fn(),
    subscribe: vi.fn(),
    unsubscribeAll: vi.fn(),
    drain: vi.fn(),
    close: vi.fn(),
    isConnected: true,
  };
  return { mockNatsClient, published };
}

/** Deserialize the first published envelope. */
function firstPublishedEnvelope(
  published: Array<{ subject: string; bytes: Uint8Array }>,
): RegistryEnvelope {
  expect(published.length).toBeGreaterThan(0);
  return deserializeEnvelope(published[0]!.bytes);
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const arbNonEmptyString = fc.string({ minLength: 1, maxLength: 64 });

/** Non-empty string with no leading/trailing whitespace — safe for use as agent IDs and subjects. */
const arbNonEmptyTrimmedString = fc
  .string({ minLength: 1, maxLength: 64 })
  .filter((s) => s.trim().length > 0);

const arbAgentId = fc.stringMatching(/^[a-zA-Z0-9_-]{1,32}$/).filter((s) => s.length > 0);

const arbResponseText = fc.string({ minLength: 0, maxLength: 256 });

/** Arbitrary for a unicast session context with a non-empty sourceAgentId. */
const arbUnicastContext: fc.Arbitrary<SessionContext> = arbNonEmptyTrimmedString.map((id) => ({
  kind: "unicast" as const,
  sourceAgentId: id,
}));

/** Arbitrary for any valid session context. */
const arbSessionContext: fc.Arbitrary<SessionContext> = fc.oneof(
  arbNonEmptyTrimmedString.map((id) => ({ kind: "unicast" as const, sourceAgentId: id })),
  arbNonEmptyTrimmedString.map((id) => ({ kind: "multicast" as const, groupId: id })),
  arbNonEmptyTrimmedString.map((id) => ({ kind: "discussion" as const, discussionId: id })),
  fc.record({
    kind: fc.constant("cowork" as const),
    taskId: arbNonEmptyTrimmedString,
    isComplete: fc.boolean(),
  }),
);

/** Arbitrary for a valid inbound envelope (reply_to null). */
const arbInboundEnvelope: fc.Arbitrary<RegistryEnvelope> = fc.record({
  message_id: fc.uuid(),
  request_id: fc.uuid(),
  message_type: fc.constantFrom("req" as const, "res" as const, "event" as const),
  timestamp: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
  source: arbNonEmptyTrimmedString,
  seq: fc.integer({ min: 0, max: 1_000_000 }),
  action: arbNonEmptyTrimmedString,
  resource_type: fc.constantFrom("agent", "collaboration", "cowork", "discussion"),
  payload: fc.dictionary(
    fc.string({ minLength: 1, maxLength: 16 }),
    fc.oneof(fc.string(), fc.integer(), fc.boolean()),
  ),
  reply_to: fc.constant(null),
});

// ---------------------------------------------------------------------------
// Property 4: seq is monotonically increasing per session
// Validates: Requirements 10.4, 7.6
// ---------------------------------------------------------------------------

describe("Feature: agent-registry-channel, Property 4: seq is monotonically increasing per session", () => {
  it("seq values form a strictly increasing sequence starting from 0", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 10 }),
        arbAgentId,
        arbUnicastContext,
        arbInboundEnvelope,
        async (n, agentId, sessionContext, inboundEnvelope) => {
          const { mockNatsClient, published } = makeMockNatsClient();
          const adapter = createOutboundAdapter({ agentId, natsClient: mockNatsClient });

          // Make N send() calls sequentially with the same session context
          for (let i = 0; i < n; i++) {
            await adapter.send({
              responseText: `message ${i}`,
              inboundEnvelope,
              sessionContext,
              sessionSeq: i,
              isSessionComplete: false,
            });
          }

          expect(published.length).toBe(n);

          for (let i = 0; i < n; i++) {
            const envelope = deserializeEnvelope(published[i]!.bytes);
            expect(envelope.seq).toBe(i);
          }
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Property 13: Outbound envelope wraps response correctly
// Validates: Requirements 7.1
// ---------------------------------------------------------------------------

describe("Feature: agent-registry-channel, Property 13: Outbound envelope wraps response correctly", () => {
  it("produced envelope has correct source, message_type, UUID v4 message_id, non-negative timestamp, seq=0, and payload.text", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbResponseText,
        arbAgentId,
        arbUnicastContext,
        arbInboundEnvelope,
        async (responseText, agentId, sessionContext, inboundEnvelope) => {
          const { mockNatsClient, published } = makeMockNatsClient();
          const adapter = createOutboundAdapter({ agentId, natsClient: mockNatsClient });

          await adapter.send({
            responseText,
            inboundEnvelope,
            sessionContext,
            sessionSeq: 0,
            isSessionComplete: false,
          });

          expect(published.length).toBe(1);
          const envelope = firstPublishedEnvelope(published);

          // source === agentId
          expect(envelope.source).toBe(agentId);
          // message_type === "req"
          expect(envelope.message_type).toBe("req");
          // message_id is a valid UUID v4
          expect(envelope.message_id).toMatch(UUID_V4_RE);
          // timestamp is a non-negative integer
          expect(Number.isInteger(envelope.timestamp)).toBe(true);
          expect(envelope.timestamp).toBeGreaterThanOrEqual(0);
          // seq === 0 (first call on a fresh adapter)
          expect(envelope.seq).toBe(0);
          // payload contains response text
          expect(envelope.payload.text).toBe(responseText);
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

describe("OutboundAdapter — unit tests", () => {
  let published: Array<{ subject: string; bytes: Uint8Array }>;
  let mockNatsClient: ReturnType<typeof makeMockNatsClient>["mockNatsClient"];

  beforeEach(() => {
    const mock = makeMockNatsClient();
    published = mock.published;
    mockNatsClient = mock.mockNatsClient;
  });

  // -------------------------------------------------------------------------
  // reply_to present → published to reply_to subject
  // -------------------------------------------------------------------------

  it("publishes to reply_to subject when reply_to is non-empty", async () => {
    const adapter = createOutboundAdapter({ agentId: "my-agent", natsClient: mockNatsClient });

    await adapter.send(
      makeSendParams({
        inboundEnvelope: makeInboundEnvelope({ reply_to: "inbox.12345" }),
        sessionContext: { kind: "unicast", sourceAgentId: "sender-agent" },
      }),
    );

    expect(published.length).toBe(1);
    expect(published[0]!.subject).toBe("inbox.12345");
  });

  it("reply_to takes priority over session context routing", async () => {
    const adapter = createOutboundAdapter({ agentId: "my-agent", natsClient: mockNatsClient });

    // Even with a cowork context, reply_to wins
    await adapter.send(
      makeSendParams({
        inboundEnvelope: makeInboundEnvelope({ reply_to: "inbox.99999" }),
        sessionContext: { kind: "cowork", taskId: "task-xyz", isComplete: false },
      }),
    );

    expect(published.length).toBe(1);
    expect(published[0]!.subject).toBe("inbox.99999");
  });

  // -------------------------------------------------------------------------
  // cowork isSessionComplete: true → action: "complete"
  // -------------------------------------------------------------------------

  it("cowork with isSessionComplete: true produces action 'complete'", async () => {
    const adapter = createOutboundAdapter({ agentId: "my-agent", natsClient: mockNatsClient });

    await adapter.send(
      makeSendParams({
        sessionContext: { kind: "cowork", taskId: "task-abc", isComplete: false },
        isSessionComplete: true,
      }),
    );

    expect(published.length).toBe(1);
    const envelope = firstPublishedEnvelope(published);
    expect(envelope.action).toBe("complete");
  });

  // -------------------------------------------------------------------------
  // cowork isSessionComplete: false → action: "progress"
  // -------------------------------------------------------------------------

  it("cowork with isSessionComplete: false produces action 'progress'", async () => {
    const adapter = createOutboundAdapter({ agentId: "my-agent", natsClient: mockNatsClient });

    await adapter.send(
      makeSendParams({
        sessionContext: { kind: "cowork", taskId: "task-abc", isComplete: false },
        isSessionComplete: false,
      }),
    );

    expect(published.length).toBe(1);
    const envelope = firstPublishedEnvelope(published);
    expect(envelope.action).toBe("progress");
  });

  it("cowork publishes to a2a.cowork.{taskId}", async () => {
    const adapter = createOutboundAdapter({ agentId: "my-agent", natsClient: mockNatsClient });

    await adapter.send(
      makeSendParams({
        sessionContext: { kind: "cowork", taskId: "task-abc", isComplete: false },
        isSessionComplete: false,
      }),
    );

    expect(published[0]!.subject).toBe("a2a.cowork.task-abc");
  });

  // -------------------------------------------------------------------------
  // discussion → action: "message" with discussion_id in payload
  // -------------------------------------------------------------------------

  it("discussion produces action 'message' and includes discussion_id in payload", async () => {
    const adapter = createOutboundAdapter({ agentId: "my-agent", natsClient: mockNatsClient });

    await adapter.send(
      makeSendParams({
        sessionContext: { kind: "discussion", discussionId: "disc-abc" },
      }),
    );

    expect(published.length).toBe(1);
    const envelope = firstPublishedEnvelope(published);
    expect(envelope.action).toBe("message");
    expect(envelope.payload.discussion_id).toBe("disc-abc");
  });

  it("discussion publishes to a2a.discussion.{discussionId}", async () => {
    const adapter = createOutboundAdapter({ agentId: "my-agent", natsClient: mockNatsClient });

    await adapter.send(
      makeSendParams({
        sessionContext: { kind: "discussion", discussionId: "disc-abc" },
      }),
    );

    expect(published[0]!.subject).toBe("a2a.discussion.disc-abc");
  });

  // -------------------------------------------------------------------------
  // missing sourceAgentId on unicast → warning logged, no publish
  // -------------------------------------------------------------------------

  it("logs a warning and does not publish when unicast sourceAgentId is empty", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const adapter = createOutboundAdapter({ agentId: "my-agent", natsClient: mockNatsClient });

    await adapter.send(
      makeSendParams({
        sessionContext: { kind: "unicast", sourceAgentId: "" },
        inboundEnvelope: makeInboundEnvelope({ source: "", reply_to: null }),
      }),
    );

    expect(warnSpy).toHaveBeenCalled();
    expect(mockNatsClient.publish).not.toHaveBeenCalled();
    expect(published.length).toBe(0);

    warnSpy.mockRestore();
  });

  // -------------------------------------------------------------------------
  // unicast routing
  // -------------------------------------------------------------------------

  it("unicast publishes to a2a.agent.unicast.{sourceAgentId}", async () => {
    const adapter = createOutboundAdapter({ agentId: "my-agent", natsClient: mockNatsClient });

    await adapter.send(
      makeSendParams({
        sessionContext: { kind: "unicast", sourceAgentId: "sender-agent" },
        inboundEnvelope: makeInboundEnvelope({ reply_to: null }),
      }),
    );

    expect(published[0]!.subject).toBe("a2a.agent.unicast.sender-agent");
  });

  // -------------------------------------------------------------------------
  // seq counter resets per adapter instance (each session starts at 0)
  // -------------------------------------------------------------------------

  it("seq starts at 0 for the first send on a fresh adapter", async () => {
    const adapter = createOutboundAdapter({ agentId: "my-agent", natsClient: mockNatsClient });

    await adapter.send(makeSendParams());

    const envelope = firstPublishedEnvelope(published);
    expect(envelope.seq).toBe(0);
  });

  it("seq increments by 1 for each successive send within the same session", async () => {
    const adapter = createOutboundAdapter({ agentId: "my-agent", natsClient: mockNatsClient });
    const ctx: SessionContext = { kind: "unicast", sourceAgentId: "sender-agent" };

    for (let i = 0; i < 5; i++) {
      await adapter.send(makeSendParams({ sessionContext: ctx, sessionSeq: i }));
    }

    expect(published.length).toBe(5);
    for (let i = 0; i < 5; i++) {
      const envelope = deserializeEnvelope(published[i]!.bytes);
      expect(envelope.seq).toBe(i);
    }
  });

  it("different session contexts maintain independent seq counters", async () => {
    const adapter = createOutboundAdapter({ agentId: "my-agent", natsClient: mockNatsClient });

    const ctxA: SessionContext = { kind: "unicast", sourceAgentId: "agent-a" };
    const ctxB: SessionContext = { kind: "unicast", sourceAgentId: "agent-b" };

    await adapter.send(makeSendParams({ sessionContext: ctxA, sessionSeq: 0 }));
    await adapter.send(makeSendParams({ sessionContext: ctxB, sessionSeq: 0 }));
    await adapter.send(makeSendParams({ sessionContext: ctxA, sessionSeq: 1 }));

    expect(published.length).toBe(3);
    expect(deserializeEnvelope(published[0]!.bytes).seq).toBe(0); // ctxA first
    expect(deserializeEnvelope(published[1]!.bytes).seq).toBe(0); // ctxB first
    expect(deserializeEnvelope(published[2]!.bytes).seq).toBe(1); // ctxA second
  });
});
