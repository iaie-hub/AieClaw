/**
 * Unit + property tests for HeartbeatManager.
 *
 * Feature: agent-registry-channel
 * Property 11: Heartbeat interval is floor(TTL/3)
 * Property 12: Heartbeat status reflects active session count
 *
 * Validates: Requirements 5.1, 5.3, 5.4, 5.5
 */

import * as fc from "fast-check";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  computeHeartbeatInterval,
  buildHeartbeatPayload,
  createHeartbeatManager,
  heartbeatAckSubject,
} from "../src/heartbeat.js";
import type { NATSClient } from "../src/types.js";

// ---------------------------------------------------------------------------
// Property 11: Heartbeat interval is floor(TTL/3)
// Validates: Requirements 5.1
// ---------------------------------------------------------------------------

describe("Feature: agent-registry-channel, Property 11: Heartbeat interval is floor(TTL/3)", () => {
  it("computeHeartbeatInterval(ttl) === Math.floor(ttl / 3) for any positive integer TTL", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 2_147_483_647 }), (ttl) => {
        expect(computeHeartbeatInterval(ttl)).toBe(Math.floor(ttl / 3));
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Property 12: Heartbeat status reflects active session count
// Validates: Requirements 5.3, 5.4, 5.5
// ---------------------------------------------------------------------------

describe("Feature: agent-registry-channel, Property 12: Heartbeat status reflects active session count", () => {
  it('buildHeartbeatPayload returns status "busy" iff activeSessionCount > 0', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000 }), (activeSessionCount) => {
        const payload = buildHeartbeatPayload("test-agent", activeSessionCount);
        if (activeSessionCount > 0) {
          expect(payload.status).toBe("busy");
        } else {
          expect(payload.status).toBe("idle");
        }
      }),
    );
  });

  it("buildHeartbeatPayload sets load.active_task_count === activeSessionCount", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000 }), (activeSessionCount) => {
        const payload = buildHeartbeatPayload("test-agent", activeSessionCount);
        expect(payload.load.active_task_count).toBe(activeSessionCount);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Unit tests — HeartbeatManager lifecycle
// ---------------------------------------------------------------------------

describe("HeartbeatManager — unit tests", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Helper: create a mock NATS client with a controllable publish spy
  function makeMockNatsClient(publishImpl?: () => void): NATSClient {
    return {
      publish: vi.fn(publishImpl ?? (() => undefined)),
      connect: vi.fn(),
      request: vi.fn(),
      subscribe: vi.fn().mockReturnValue({ subject: "mock", unsubscribe: vi.fn() }),
      unsubscribeAll: vi.fn(),
      drain: vi.fn(),
      close: vi.fn(),
      newInbox: vi.fn().mockReturnValue("_INBOX.mock"),
      get isConnected() {
        return true;
      },
    } as unknown as NATSClient;
  }

  // -------------------------------------------------------------------------
  // start() then stop() → timer cancelled
  // -------------------------------------------------------------------------

  it("start() then stop() cancels the timer (isRunning becomes false)", () => {
    const mockNatsClient = makeMockNatsClient();
    const manager = createHeartbeatManager({
      getAgentId: () => "agent-1",
      natsClient: mockNatsClient,
      getActiveSessionCount: () => 0,
    });

    expect(manager.isRunning).toBe(false);

    manager.start(9000); // interval = 3000
    expect(manager.isRunning).toBe(true);

    manager.stop();
    expect(manager.isRunning).toBe(false);

    // Advance time — no more publishes should happen after stop
    const publishCallsBefore = (mockNatsClient.publish as ReturnType<typeof vi.fn>).mock.calls
      .length;
    vi.advanceTimersByTime(6000);
    const publishCallsAfter = (mockNatsClient.publish as ReturnType<typeof vi.fn>).mock.calls
      .length;
    expect(publishCallsAfter).toBe(publishCallsBefore);
  });

  // -------------------------------------------------------------------------
  // publish failure → error logged, timer continues
  // -------------------------------------------------------------------------

  it("publish failure logs error with agent_id and timer continues running", () => {
    const agentId = "agent-failing";
    const mockNatsClient = makeMockNatsClient(() => {
      throw new Error("NATS connection lost");
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const manager = createHeartbeatManager({
      getAgentId: () => agentId,
      natsClient: mockNatsClient,
      getActiveSessionCount: () => 0,
    });

    manager.start(9000); // interval = 3000

    // Advance by one interval — publish throws, error should be logged
    vi.advanceTimersByTime(3000);

    expect(errorSpy).toHaveBeenCalledOnce();
    const errorMessage: string = errorSpy.mock.calls[0]?.[0] as string;
    expect(errorMessage).toContain(agentId);

    // Timer is still running after the failure
    expect(manager.isRunning).toBe(true);

    // Advance again — timer fires again (error logged a second time)
    vi.advanceTimersByTime(3000);
    expect(errorSpy).toHaveBeenCalledTimes(2);
    expect(manager.isRunning).toBe(true);

    errorSpy.mockRestore();
    manager.stop();
  });

  // -------------------------------------------------------------------------
  // start() called twice → old timer cancelled, new timer started with new TTL
  // -------------------------------------------------------------------------

  it("start() called twice cancels old timer and starts new timer with new TTL", () => {
    const mockNatsClient = makeMockNatsClient();
    const publishMock = mockNatsClient.publish as ReturnType<typeof vi.fn>;

    const manager = createHeartbeatManager({
      getAgentId: () => "agent-restart",
      natsClient: mockNatsClient,
      getActiveSessionCount: () => 0,
    });

    // First start: TTL 9000 → interval 3000
    manager.start(9000);

    // Advance 3000 ms → 1 publish from first timer
    vi.advanceTimersByTime(3000);
    expect(publishMock).toHaveBeenCalledTimes(1);

    // Second start: TTL 6000 → interval 2000 (old timer cancelled)
    manager.start(6000);

    // Advance 2000 ms → 1 publish from second timer (not 2, because old timer is gone)
    vi.advanceTimersByTime(2000);
    expect(publishMock).toHaveBeenCalledTimes(2);

    // Advance another 1000 ms (would have been a tick on the old 3000ms timer, but it's gone)
    vi.advanceTimersByTime(1000);
    // Still only 2 total — old timer is cancelled, new timer hasn't fired again yet
    expect(publishMock).toHaveBeenCalledTimes(2);

    manager.stop();
  });
});

// ---------------------------------------------------------------------------
// heartbeatAckSubject helper
// ---------------------------------------------------------------------------

describe("heartbeatAckSubject", () => {
  it("returns a2a.agent.heartbeat-ack.{agentId}", () => {
    expect(heartbeatAckSubject("my-agent-123")).toBe("a2a.agent.heartbeat-ack.my-agent-123");
  });
});

// ---------------------------------------------------------------------------
// Registry offline detection via async counting
// ---------------------------------------------------------------------------

describe("HeartbeatManager — Registry offline detection", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeMockNatsClient(): NATSClient {
    return {
      publish: vi.fn(),
      connect: vi.fn(),
      request: vi.fn(),
      subscribe: vi.fn().mockReturnValue({ subject: "mock", unsubscribe: vi.fn() }),
      unsubscribeAll: vi.fn(),
      drain: vi.fn(),
      close: vi.fn(),
      newInbox: vi.fn().mockReturnValue("_INBOX.mock"),
      get isConnected() {
        return true;
      },
    } as unknown as NATSClient;
  }

  it("calls onRegistryOffline after 3 consecutive missed acks", () => {
    const mockNatsClient = makeMockNatsClient();
    const onRegistryOffline = vi.fn();
    const onRegistryOnline = vi.fn();

    const manager = createHeartbeatManager({
      getAgentId: () => "agent-offline-test",
      natsClient: mockNatsClient,
      getActiveSessionCount: () => 0,
      onRegistryOffline,
      onRegistryOnline,
    });

    manager.start(9000); // interval = 3000

    // Tick 1: missedCount goes 0→1 (check is 0 < 3, so no offline)
    vi.advanceTimersByTime(3000);
    expect(onRegistryOffline).not.toHaveBeenCalled();

    // Tick 2: missedCount goes 1→2
    vi.advanceTimersByTime(3000);
    expect(onRegistryOffline).not.toHaveBeenCalled();

    // Tick 3: missedCount goes 2→3
    vi.advanceTimersByTime(3000);
    expect(onRegistryOffline).not.toHaveBeenCalled();

    // Tick 4: missedCount is 3 >= 3, triggers offline
    vi.advanceTimersByTime(3000);
    expect(onRegistryOffline).toHaveBeenCalledTimes(1);

    // Tick 5: already offline, should not call again
    vi.advanceTimersByTime(3000);
    expect(onRegistryOffline).toHaveBeenCalledTimes(1);

    manager.stop();
  });

  it("resets missedCount and calls onRegistryOnline when ack is received", () => {
    const mockNatsClient = makeMockNatsClient();
    const onRegistryOffline = vi.fn();
    const onRegistryOnline = vi.fn();

    // Capture the subscribe handler so we can simulate ack
    let ackHandler: ((msg: Uint8Array) => void) | null = null;
    (mockNatsClient.subscribe as ReturnType<typeof vi.fn>).mockImplementation(
      (subject: string, handler: (msg: Uint8Array) => void) => {
        if (subject.startsWith("a2a.agent.heartbeat-ack.")) {
          ackHandler = handler;
        }
        return { subject, unsubscribe: vi.fn() };
      },
    );

    const manager = createHeartbeatManager({
      getAgentId: () => "agent-ack-test",
      natsClient: mockNatsClient,
      getActiveSessionCount: () => 0,
      onRegistryOffline,
      onRegistryOnline,
    });

    manager.start(9000); // interval = 3000

    // Tick 1: missedCount 0→1
    vi.advanceTimersByTime(3000);

    // Tick 2: missedCount 1→2
    vi.advanceTimersByTime(3000);

    // Simulate ack received → missedCount resets to 0
    ackHandler!(new Uint8Array(0));

    // Tick 3: missedCount 0→1 (reset worked)
    vi.advanceTimersByTime(3000);
    expect(onRegistryOffline).not.toHaveBeenCalled();

    // Tick 4: missedCount 1→2
    vi.advanceTimersByTime(3000);
    expect(onRegistryOffline).not.toHaveBeenCalled();

    manager.stop();
  });

  it("calls onRegistryOnline when ack received after being offline", () => {
    const mockNatsClient = makeMockNatsClient();
    const onRegistryOffline = vi.fn();
    const onRegistryOnline = vi.fn();

    let ackHandler: ((msg: Uint8Array) => void) | null = null;
    (mockNatsClient.subscribe as ReturnType<typeof vi.fn>).mockImplementation(
      (subject: string, handler: (msg: Uint8Array) => void) => {
        if (subject.startsWith("a2a.agent.heartbeat-ack.")) {
          ackHandler = handler;
        }
        return { subject, unsubscribe: vi.fn() };
      },
    );

    const manager = createHeartbeatManager({
      getAgentId: () => "agent-recovery-test",
      natsClient: mockNatsClient,
      getActiveSessionCount: () => 0,
      onRegistryOffline,
      onRegistryOnline,
    });

    manager.start(9000); // interval = 3000

    // 4 ticks without ack → offline triggered
    vi.advanceTimersByTime(3000); // missedCount: 0→1
    vi.advanceTimersByTime(3000); // missedCount: 1→2
    vi.advanceTimersByTime(3000); // missedCount: 2→3
    vi.advanceTimersByTime(3000); // missedCount: 3 >= 3 → offline
    expect(onRegistryOffline).toHaveBeenCalledTimes(1);

    // Simulate ack received → recovery
    ackHandler!(new Uint8Array(0));
    expect(onRegistryOnline).toHaveBeenCalledTimes(1);

    manager.stop();
  });

  it("subscribes to the correct ack subject based on agentId", () => {
    const mockNatsClient = makeMockNatsClient();
    const subscribeMock = mockNatsClient.subscribe as ReturnType<typeof vi.fn>;

    const manager = createHeartbeatManager({
      getAgentId: () => "my-special-agent",
      natsClient: mockNatsClient,
      getActiveSessionCount: () => 0,
    });

    manager.start(9000);

    expect(subscribeMock).toHaveBeenCalledWith(
      "a2a.agent.heartbeat-ack.my-special-agent",
      expect.any(Function),
    );

    manager.stop();
  });

  it("sets reply_to in heartbeat envelope to the fixed ack subject", () => {
    const mockNatsClient = makeMockNatsClient();
    const publishMock = mockNatsClient.publish as ReturnType<typeof vi.fn>;

    const manager = createHeartbeatManager({
      getAgentId: () => "agent-reply-to",
      natsClient: mockNatsClient,
      getActiveSessionCount: () => 0,
    });

    manager.start(9000);
    vi.advanceTimersByTime(3000);

    expect(publishMock).toHaveBeenCalledTimes(1);
    const [subject, bytes] = publishMock.mock.calls[0];
    expect(subject).toBe("registry.agent.heartbeat");

    // Decode the envelope and check reply_to
    const json = new TextDecoder().decode(bytes);
    const envelope = JSON.parse(json);
    expect(envelope.reply_to).toBe("a2a.agent.heartbeat-ack.agent-reply-to");

    manager.stop();
  });
});
