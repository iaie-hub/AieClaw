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
      subscribe: vi.fn(),
      unsubscribeAll: vi.fn(),
      drain: vi.fn(),
      close: vi.fn(),
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
      agentId: "agent-1",
      natsClient: mockNatsClient,
      getActiveSessionCount: () => 0,
    });

    expect(manager.isRunning).toBe(false);

    manager.start(9000); // interval = 3000
    expect(manager.isRunning).toBe(true);

    manager.stop();
    expect(manager.isRunning).toBe(false);

    // Advance time — no more publishes should happen after stop
    const publishCallsBefore = (mockNatsClient.publish as ReturnType<typeof vi.fn>).mock.calls.length;
    vi.advanceTimersByTime(6000);
    const publishCallsAfter = (mockNatsClient.publish as ReturnType<typeof vi.fn>).mock.calls.length;
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
      agentId,
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
      agentId: "agent-restart",
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
