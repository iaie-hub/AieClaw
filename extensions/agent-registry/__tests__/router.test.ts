/**
 * Unit tests for MessageRouter.
 *
 * Feature: agent-registry-channel
 * Validates: Requirements 6.1–6.10
 */

import { vi, describe, it, expect, beforeEach } from "vitest";
import { createMessageRouter } from "../src/router.js";
import { createEnvelope, serializeEnvelope } from "../src/envelope.js";
import type {
  MessageRouterOptions,
  RegistryEnvelope,
  CollaborationArbiter,
  AgentSession,
  NATSClient,
} from "../src/types.js";

// ---------------------------------------------------------------------------
// Mock helpers
// ---------------------------------------------------------------------------

function makeEnvelopeBytes(overrides: Partial<RegistryEnvelope> = {}): Uint8Array {
  const envelope = createEnvelope({
    request_id: "00000000-0000-4000-8000-000000000002",
    message_type: "req",
    source: "sender-agent",
    seq: 0,
    action: "message",
    resource_type: "agent",
    payload: {},
    reply_to: null,
    ...overrides,
  });
  return serializeEnvelope(envelope);
}

function makeMockArbiter(): CollaborationArbiter {
  return {
    initialize: vi.fn(),
    processDiscussionCreated: vi.fn().mockResolvedValue(undefined),
    processCotaskCreated: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn(),
  };
}

function makeMockSession(): AgentSession {
  return {
    dispatch: vi.fn().mockResolvedValue(undefined),
    activeTaskCount: 0,
  };
}

function makeMockNatsClient(): NATSClient {
  return {
    connect: vi.fn(),
    request: vi.fn(),
    publish: vi.fn(),
    subscribe: vi.fn(),
    unsubscribeAll: vi.fn(),
    drain: vi.fn(),
    close: vi.fn(),
    isConnected: true,
  };
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let mockArbiter: CollaborationArbiter;
let mockSession: AgentSession;
let mockNatsClient: NATSClient;
let options: MessageRouterOptions;

beforeEach(() => {
  mockArbiter = makeMockArbiter();
  mockSession = makeMockSession();
  mockNatsClient = makeMockNatsClient();

  options = {
    boundAgentId: "bound-agent",
    natsClient: mockNatsClient,
    arbiter: mockArbiter,
    createSession: vi.fn().mockReturnValue(mockSession),
    getOrCreateSession: vi.fn().mockReturnValue(mockSession),
    getLeastLoadedSession: vi.fn().mockReturnValue(mockSession),
  };
});

// ---------------------------------------------------------------------------
// Helper: flush the microtask queue so fire-and-forget async handlers complete
// ---------------------------------------------------------------------------
function flushAsync(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

// ---------------------------------------------------------------------------
// Test 1: Invalid envelope bytes → parse error logged, discarded
// Validates: Requirements 6.1, 6.2
// ---------------------------------------------------------------------------

describe("createInboundHandler — invalid envelope bytes", () => {
  it("logs a parse error and does not call getOrCreateSession when bytes are invalid", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const router = createMessageRouter(options);
    const handler = router.createInboundHandler("a2a.agent.unicast.agent-1");

    handler(new Uint8Array([0x00, 0x01, 0x02]));
    await flushAsync();

    expect(errorSpy).toHaveBeenCalled();
    expect(options.getOrCreateSession).not.toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it("includes the raw bytes (truncated) in the error log", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const router = createMessageRouter(options);
    const handler = router.createInboundHandler("a2a.agent.unicast.agent-1");

    handler(new Uint8Array([0x00, 0x01, 0x02]));
    await flushAsync();

    // The error message should reference the subject and contain some byte representation
    const errorArg = errorSpy.mock.calls[0]?.[0] as string;
    expect(typeof errorArg).toBe("string");
    expect(errorArg).toContain("a2a.agent.unicast.agent-1");

    errorSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Test 2: Unicast message → getOrCreateSession called with source
// Validates: Requirement 6.3
// ---------------------------------------------------------------------------

describe("createInboundHandler — unicast topic", () => {
  it("calls getOrCreateSession with (source, boundAgentId) and dispatches the message", async () => {
    const router = createMessageRouter(options);
    const handler = router.createInboundHandler("a2a.agent.unicast.agent-1");

    const bytes = makeEnvelopeBytes({ source: "sender-agent" });
    handler(bytes);
    await flushAsync();

    expect(options.getOrCreateSession).toHaveBeenCalledWith("sender-agent", "bound-agent");
    expect(mockSession.dispatch).toHaveBeenCalledOnce();
  });

  it("uses the envelope source field as the session key, not the topic segment", async () => {
    const router = createMessageRouter(options);
    const handler = router.createInboundHandler("a2a.agent.unicast.agent-1");

    const bytes = makeEnvelopeBytes({ source: "originating-agent-xyz" });
    handler(bytes);
    await flushAsync();

    expect(options.getOrCreateSession).toHaveBeenCalledWith("originating-agent-xyz", "bound-agent");
  });
});

// ---------------------------------------------------------------------------
// Test 3: Multicast → getLeastLoadedSession called
// Validates: Requirement 6.4
// ---------------------------------------------------------------------------

describe("createInboundHandler — multicast topic", () => {
  it("calls getLeastLoadedSession with boundAgentId and dispatches the message", async () => {
    const router = createMessageRouter(options);
    const handler = router.createInboundHandler("a2a.agent.group.group-1");

    const bytes = makeEnvelopeBytes();
    handler(bytes);
    await flushAsync();

    expect(options.getLeastLoadedSession).toHaveBeenCalledWith("bound-agent");
    expect(mockSession.dispatch).toHaveBeenCalledOnce();
  });

  it("does not call getOrCreateSession for multicast messages", async () => {
    const router = createMessageRouter(options);
    const handler = router.createInboundHandler("a2a.agent.group.group-1");

    handler(makeEnvelopeBytes());
    await flushAsync();

    expect(options.getOrCreateSession).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 4: Broadcast discussion.created → arbiter.processDiscussionCreated called
// Validates: Requirement 6.5
// ---------------------------------------------------------------------------

describe("createInboundHandler — broadcast discussion.created", () => {
  it("calls arbiter.processDiscussionCreated with the envelope payload", async () => {
    const router = createMessageRouter(options);
    const handler = router.createInboundHandler("a2a.agent.broadcast.all");

    const payload = { discussion_id: "disc-1", text: "Let's discuss" };
    const bytes = makeEnvelopeBytes({ action: "discussion.created", payload });
    handler(bytes);
    await flushAsync();

    expect(mockArbiter.processDiscussionCreated).toHaveBeenCalledOnce();
    expect(mockArbiter.processDiscussionCreated).toHaveBeenCalledWith(
      expect.objectContaining({ discussion_id: "disc-1" }),
    );
  });

  it("does not call processCotaskCreated for discussion.created", async () => {
    const router = createMessageRouter(options);
    const handler = router.createInboundHandler("a2a.agent.broadcast.all");

    handler(makeEnvelopeBytes({ action: "discussion.created", payload: { discussion_id: "disc-1" } }));
    await flushAsync();

    expect(mockArbiter.processCotaskCreated).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 5: Broadcast cotask.created → arbiter.processCotaskCreated called
// Validates: Requirement 6.6
// ---------------------------------------------------------------------------

describe("createInboundHandler — broadcast cotask.created", () => {
  it("calls arbiter.processCotaskCreated with the envelope payload", async () => {
    const router = createMessageRouter(options);
    const handler = router.createInboundHandler("a2a.agent.broadcast.all");

    const payload = { task_id: "task-1", text: "Build something" };
    const bytes = makeEnvelopeBytes({ action: "cotask.created", payload });
    handler(bytes);
    await flushAsync();

    expect(mockArbiter.processCotaskCreated).toHaveBeenCalledOnce();
    expect(mockArbiter.processCotaskCreated).toHaveBeenCalledWith(
      expect.objectContaining({ task_id: "task-1" }),
    );
  });

  it("does not call processDiscussionCreated for cotask.created", async () => {
    const router = createMessageRouter(options);
    const handler = router.createInboundHandler("a2a.agent.broadcast.all");

    handler(makeEnvelopeBytes({ action: "cotask.created", payload: { task_id: "task-1" } }));
    await flushAsync();

    expect(mockArbiter.processDiscussionCreated).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Test 6: Broadcast unknown action → logged and discarded
// Validates: Requirement 6.8
// ---------------------------------------------------------------------------

describe("createInboundHandler — broadcast unknown action", () => {
  it("logs the unknown action and does not call processDiscussionCreated or processCotaskCreated", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const router = createMessageRouter(options);
    const handler = router.createInboundHandler("a2a.agent.broadcast.all");

    handler(makeEnvelopeBytes({ action: "unknown.action" }));
    await flushAsync();

    expect(infoSpy).toHaveBeenCalled();
    expect(mockArbiter.processDiscussionCreated).not.toHaveBeenCalled();
    expect(mockArbiter.processCotaskCreated).not.toHaveBeenCalled();

    infoSpy.mockRestore();
  });

  it("includes the action value in the log message", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const router = createMessageRouter(options);
    const handler = router.createInboundHandler("a2a.agent.broadcast.all");

    handler(makeEnvelopeBytes({ action: "some.weird.action" }));
    await flushAsync();

    const logArg = infoSpy.mock.calls[0]?.[0] as string;
    expect(logArg).toContain("some.weird.action");

    infoSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Test 7: Discussion topic → getOrCreateSession called with discussion id
// Validates: Requirement 6.7
// ---------------------------------------------------------------------------

describe("createInboundHandler — discussion topic", () => {
  it("calls getOrCreateSession with (discussionId, boundAgentId) and dispatches the message", async () => {
    const router = createMessageRouter(options);
    const handler = router.createInboundHandler("a2a.discussion.disc-abc");

    handler(makeEnvelopeBytes());
    await flushAsync();

    expect(options.getOrCreateSession).toHaveBeenCalledWith("disc-abc", "bound-agent");
    expect(mockSession.dispatch).toHaveBeenCalledOnce();
  });

  it("extracts the discussion id from the topic, not from the envelope source", async () => {
    const router = createMessageRouter(options);
    const handler = router.createInboundHandler("a2a.discussion.my-discussion-123");

    handler(makeEnvelopeBytes({ source: "some-other-agent" }));
    await flushAsync();

    expect(options.getOrCreateSession).toHaveBeenCalledWith("my-discussion-123", "bound-agent");
  });
});

// ---------------------------------------------------------------------------
// Test 8: Cotask topic → getOrCreateSession called with task id
// Validates: Requirement 6.7
// ---------------------------------------------------------------------------

describe("createInboundHandler — cotask topic", () => {
  it("calls getOrCreateSession with (taskId, boundAgentId) and dispatches the message", async () => {
    const router = createMessageRouter(options);
    const handler = router.createInboundHandler("a2a.cotask.task-xyz");

    handler(makeEnvelopeBytes());
    await flushAsync();

    expect(options.getOrCreateSession).toHaveBeenCalledWith("task-xyz", "bound-agent");
    expect(mockSession.dispatch).toHaveBeenCalledOnce();
  });

  it("extracts the task id from the topic, not from the envelope source", async () => {
    const router = createMessageRouter(options);
    const handler = router.createInboundHandler("a2a.cotask.my-task-456");

    handler(makeEnvelopeBytes({ source: "some-other-agent" }));
    await flushAsync();

    expect(options.getOrCreateSession).toHaveBeenCalledWith("my-task-456", "bound-agent");
  });
});

// ---------------------------------------------------------------------------
// Additional: handler is synchronous (fire-and-forget)
// Validates: Requirement 6.1
// ---------------------------------------------------------------------------

describe("createInboundHandler — synchronous return", () => {
  it("returns void synchronously (fire-and-forget pattern)", () => {
    const router = createMessageRouter(options);
    const handler = router.createInboundHandler("a2a.agent.unicast.agent-1");

    const result = handler(makeEnvelopeBytes());
    // The handler must return void (undefined), not a Promise
    expect(result).toBeUndefined();
  });
});
