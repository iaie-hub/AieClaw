/**
 * Property-based tests for aiemas_sessions_send tool.
 *
 * Feature: a2a-communication
 *
 * Properties tested in this file:
 *   Property 2: SessionKey 解析正确性
 *   Property 3: 无效 agentSessionKey 返回错误
 *   Property 4: callSessionsSend 失败时错误包装
 *   Property 8: 超时参数透传
 *
 * Validates: Requirements 2.3, 2.4, 2.5, 2.8, 7.1, 7.2, 7.3, 11.1, 11.4
 */

import type { DatabaseSync } from "node:sqlite";
import * as fc from "fast-check";
import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Only mock the DB store; use REAL session-utils ──

vi.mock("../store/aiemas-sessions-store.js", () => ({
  createAiemasSessionsStore: vi.fn(),
}));

const { createAiemasSessionsStore } = await import("../store/aiemas-sessions-store.js");
const { createAiemasSessionsSendTool } = await import("./aiemas-tools.js");
const { extractUuidFromKey, constructKeyFromUuid } = await import("../utils/session-utils.js");

const mockedCreateStore = vi.mocked(createAiemasSessionsStore);

// ── Arbitraries ──

/** Non-empty alphanumeric + hyphen strings (e.g., `aieiaas-resource`) */
const arbAgentId = fc.stringMatching(/^[a-z][a-z0-9-]{0,19}$/);

/** UUID-like or short identifier strings (e.g., `mas-d4548844`) */
const arbSessionUuid = fc.stringMatching(/^mas-[a-f0-9]{8}$/);

/** `agent:{agentId}:group:{sessionUuid}` format */
const arbSessionKey = fc
  .tuple(arbAgentId, arbSessionUuid)
  .map(([agentId, uuid]) => `agent:${agentId}:group:${uuid}`);

/** `{ agentId, sessionKey, sessionId }` objects */
const arbDescendantSession = fc.tuple(arbAgentId, arbSessionUuid).map(([agentId, uuid]) => ({
  agentId,
  sessionKey: `agent:${agentId}:group:${uuid}`,
  sessionId: `sess-${uuid}`,
}));

// ── Helpers ──

function parseResult(result: { content: Array<{ type: string; text: string }> }): unknown {
  return JSON.parse(result.content[0].text);
}

// ---------------------------------------------------------------------------
// Property 2: SessionKey 解析正确性
// ---------------------------------------------------------------------------

describe("Feature: a2a-communication, Property 2: SessionKey resolution correctness", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Validates: Requirements 2.3
   *
   * When descendantSessions contains the target agentId, the resolved
   * sessionKey must be the one from descendantSessions, and its sessionUuid
   * part must match the caller's sessionUuid.
   */
  it("uses sessionKey from descendantSessions when target agentId is found", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbAgentId,
        arbSessionUuid,
        arbAgentId,
        fc.array(arbDescendantSession, { minLength: 0, maxLength: 4 }),
        async (callerAgentId, sessionUuid, targetAgentId, otherDescendants) => {
          // Ensure target is different from caller
          fc.pre(targetAgentId !== callerAgentId);

          const callerSessionKey = `agent:${callerAgentId}:group:${sessionUuid}`;
          // The descendant sessionKey for the target uses the SAME sessionUuid
          const targetDescendantKey = `agent:${targetAgentId}:group:${sessionUuid}`;

          const descendantSessions = [
            ...otherDescendants.filter((d) => d.agentId !== targetAgentId),
            {
              agentId: targetAgentId,
              sessionKey: targetDescendantKey,
              sessionId: `sess-${sessionUuid}`,
            },
          ];

          mockedCreateStore.mockReturnValue({
            loadRootSession: vi.fn().mockReturnValue({
              sessionKey: callerSessionKey,
              descendantSessions,
            }),
          } as never);

          let capturedSessionKey: string | undefined;
          const callSessionsSend = vi
            .fn()
            .mockImplementation(async (params: { sessionKey: string }) => {
              capturedSessionKey = params.sessionKey;
              return { status: "ok" };
            });

          const tool = createAiemasSessionsSendTool(
            { db: {} as DatabaseSync, callSessionsSend },
            { agentSessionKey: callerSessionKey },
          );

          await tool.execute("pbt-call", { agentId: targetAgentId, message: "test" });

          // Must use the descendant sessionKey
          expect(capturedSessionKey).toBe(targetDescendantKey);

          // The sessionUuid part of the resolved key must match the caller's sessionUuid
          const resolvedUuid = extractUuidFromKey(capturedSessionKey!);
          const callerUuid = extractUuidFromKey(callerSessionKey);
          expect(resolvedUuid).toBe(callerUuid);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Validates: Requirements 2.4
   *
   * When descendantSessions does NOT contain the target agentId,
   * the resolved sessionKey must be derived via constructKeyFromUuid,
   * and its sessionUuid part must match the caller's sessionUuid.
   */
  it("falls back to derived sessionKey when target agentId is not in descendantSessions", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbAgentId,
        arbSessionUuid,
        arbAgentId,
        fc.array(arbDescendantSession, { minLength: 0, maxLength: 4 }),
        async (callerAgentId, sessionUuid, targetAgentId, descendants) => {
          fc.pre(targetAgentId !== callerAgentId);

          const callerSessionKey = `agent:${callerAgentId}:group:${sessionUuid}`;

          // Ensure target is NOT in descendantSessions
          const filteredDescendants = descendants.filter((d) => d.agentId !== targetAgentId);

          mockedCreateStore.mockReturnValue({
            loadRootSession: vi.fn().mockReturnValue({
              sessionKey: callerSessionKey,
              descendantSessions: filteredDescendants,
            }),
          } as never);

          let capturedSessionKey: string | undefined;
          const callSessionsSend = vi
            .fn()
            .mockImplementation(async (params: { sessionKey: string }) => {
              capturedSessionKey = params.sessionKey;
              return { status: "ok" };
            });

          const tool = createAiemasSessionsSendTool(
            { db: {} as DatabaseSync, callSessionsSend },
            { agentSessionKey: callerSessionKey },
          );

          await tool.execute("pbt-call", { agentId: targetAgentId, message: "test" });

          // Must use the derived sessionKey
          const expectedKey = constructKeyFromUuid(targetAgentId, sessionUuid);
          expect(capturedSessionKey).toBe(expectedKey);

          // The sessionUuid part must match the caller's sessionUuid
          const resolvedUuid = extractUuidFromKey(capturedSessionKey!);
          const callerUuid = extractUuidFromKey(callerSessionKey);
          expect(resolvedUuid).toBe(callerUuid);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Validates: Requirements 2.5
   *
   * When loadRootSession returns undefined (no record in aiemas_sessions),
   * the resolved sessionKey must be derived via constructKeyFromUuid,
   * and its sessionUuid part must match the caller's sessionUuid.
   */
  it("falls back to derived sessionKey when no record exists in aiemas_sessions", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbAgentId,
        arbSessionUuid,
        arbAgentId,
        async (callerAgentId, sessionUuid, targetAgentId) => {
          fc.pre(targetAgentId !== callerAgentId);

          const callerSessionKey = `agent:${callerAgentId}:group:${sessionUuid}`;

          mockedCreateStore.mockReturnValue({
            loadRootSession: vi.fn().mockReturnValue(undefined),
          } as never);

          let capturedSessionKey: string | undefined;
          const callSessionsSend = vi
            .fn()
            .mockImplementation(async (params: { sessionKey: string }) => {
              capturedSessionKey = params.sessionKey;
              return { status: "ok" };
            });

          const tool = createAiemasSessionsSendTool(
            { db: {} as DatabaseSync, callSessionsSend },
            { agentSessionKey: callerSessionKey },
          );

          await tool.execute("pbt-call", { agentId: targetAgentId, message: "test" });

          // Must use the derived sessionKey
          const expectedKey = constructKeyFromUuid(targetAgentId, sessionUuid);
          expect(capturedSessionKey).toBe(expectedKey);

          // The sessionUuid part must match the caller's sessionUuid
          const resolvedUuid = extractUuidFromKey(capturedSessionKey!);
          const callerUuid = extractUuidFromKey(callerSessionKey);
          expect(resolvedUuid).toBe(callerUuid);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Validates: Requirements 2.4, 2.5 (DB failure fallback)
   *
   * When loadRootSession throws (DB error), the resolved sessionKey must
   * fall back to constructKeyFromUuid, and its sessionUuid part must match
   * the caller's sessionUuid.
   */
  it("falls back to derived sessionKey when DB query throws", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbAgentId,
        arbSessionUuid,
        arbAgentId,
        async (callerAgentId, sessionUuid, targetAgentId) => {
          fc.pre(targetAgentId !== callerAgentId);

          const callerSessionKey = `agent:${callerAgentId}:group:${sessionUuid}`;

          mockedCreateStore.mockReturnValue({
            loadRootSession: vi.fn().mockImplementation(() => {
              throw new Error("DB connection lost");
            }),
          } as never);

          const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

          let capturedSessionKey: string | undefined;
          const callSessionsSend = vi
            .fn()
            .mockImplementation(async (params: { sessionKey: string }) => {
              capturedSessionKey = params.sessionKey;
              return { status: "ok" };
            });

          const tool = createAiemasSessionsSendTool(
            { db: {} as DatabaseSync, callSessionsSend },
            { agentSessionKey: callerSessionKey },
          );

          await tool.execute("pbt-call", { agentId: targetAgentId, message: "test" });

          // Must use the derived sessionKey
          const expectedKey = constructKeyFromUuid(targetAgentId, sessionUuid);
          expect(capturedSessionKey).toBe(expectedKey);

          // The sessionUuid part must match the caller's sessionUuid
          const resolvedUuid = extractUuidFromKey(capturedSessionKey!);
          const callerUuid = extractUuidFromKey(callerSessionKey);
          expect(resolvedUuid).toBe(callerUuid);

          warnSpy.mockRestore();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── Arbitraries for Property 3 ──

/**
 * Generate invalid agentSessionKey values that should cause the tool to
 * return an error without calling callSessionsSend.
 *
 * Categories:
 *   1. Empty string / undefined
 *   2. Strings ending with ":" (extractUuidFromKey returns "")
 *   3. Strings that are just colons (extractUuidFromKey returns "")
 */
const arbInvalidSessionKey: fc.Arbitrary<string | undefined> = fc.oneof(
  // Category 1: empty string
  fc.constant(""),
  // Category 1: undefined
  fc.constant(undefined as string | undefined),
  // Category 2: strings ending with one or more colons (e.g. "agent:foo:group:")
  fc.stringMatching(/^[a-z0-9:]{0,20}:$/).filter((s) => s.length > 0),
  // Category 3: only colons
  fc.nat({ max: 4 }).map((n) => ":".repeat(n + 1)),
);

// ---------------------------------------------------------------------------
// Property 3: 无效 agentSessionKey 返回错误
// ---------------------------------------------------------------------------

describe("Feature: a2a-communication, Property 3: Invalid agentSessionKey returns error", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Validates: Requirements 2.8, 7.1, 7.2
   *
   * For any empty string, undefined, or agentSessionKey that cannot produce
   * a valid sessionUuid, the tool should return status: "error" and should
   * NOT call callSessionsSend.
   */
  it("returns error and does not call callSessionsSend for invalid agentSessionKey", async () => {
    await fc.assert(
      fc.asyncProperty(arbInvalidSessionKey, arbAgentId, async (invalidKey, targetAgentId) => {
        const callSessionsSend = vi.fn().mockResolvedValue({ status: "ok" });

        const tool = createAiemasSessionsSendTool(
          { db: {} as DatabaseSync, callSessionsSend },
          { agentSessionKey: invalidKey },
        );

        const result = await tool.execute("pbt-call", {
          agentId: targetAgentId,
          message: "test",
        });

        const parsed = parseResult(result) as { status: string; error?: string };

        // Must return status: "error"
        expect(parsed.status).toBe("error");

        // Must include an error message
        expect(parsed.error).toBeDefined();
        expect(typeof parsed.error).toBe("string");
        expect(parsed.error!.length).toBeGreaterThan(0);

        // Must NOT call callSessionsSend
        expect(callSessionsSend).not.toHaveBeenCalled();
      }),
      { numRuns: 100 },
    );
  });
});

// ── Arbitraries for Property 4 ──

/**
 * Generate various error types that callSessionsSend might throw:
 *   - Error objects with random messages
 *   - Plain string errors
 *   - Number errors
 *   - null / undefined
 */
const arbErrorValue: fc.Arbitrary<unknown> = fc.oneof(
  // Error objects with random messages (Gateway timeout, network errors, etc.)
  fc.string({ minLength: 1, maxLength: 60 }).map((msg) => new Error(msg)),
  // Plain string errors
  fc.string({ minLength: 1, maxLength: 60 }),
  // Number errors
  fc.integer(),
  // null
  fc.constant(null),
  // undefined
  fc.constant(undefined),
);

// ---------------------------------------------------------------------------
// Property 4: callSessionsSend 失败时错误包装
// ---------------------------------------------------------------------------

describe("Feature: a2a-communication, Property 4: callSessionsSend failure wraps error", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Validates: Requirements 7.3
   *
   * For any exception thrown by callSessionsSend (including Gateway timeout,
   * network errors, etc.), the aiemas_sessions_send tool should wrap the
   * exception into a result containing status: "error" and should NOT throw
   * an uncaught exception.
   */
  it("wraps callSessionsSend rejection into status error without throwing", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbSessionKey,
        arbAgentId,
        arbErrorValue,
        async (callerSessionKey, targetAgentId, errorValue) => {
          // Mock loadRootSession to return undefined so we reach callSessionsSend via fallback
          mockedCreateStore.mockReturnValue({
            loadRootSession: vi.fn().mockReturnValue(undefined),
          } as never);

          // callSessionsSend rejects with the generated error
          const callSessionsSend = vi.fn().mockRejectedValue(errorValue);

          const tool = createAiemasSessionsSendTool(
            { db: {} as DatabaseSync, callSessionsSend },
            { agentSessionKey: callerSessionKey },
          );

          // Must resolve (not reject) — no uncaught exception
          const result = await tool.execute("pbt-call", {
            agentId: targetAgentId,
            message: "test",
          });

          const parsed = parseResult(result) as { status: string; error?: string };

          // Must return status: "error"
          expect(parsed.status).toBe("error");

          // Must include a non-empty error message
          expect(parsed.error).toBeDefined();
          expect(typeof parsed.error).toBe("string");
          expect(parsed.error!.length).toBeGreaterThan(0);

          // callSessionsSend must have been called (error happens during its execution)
          expect(callSessionsSend).toHaveBeenCalledOnce();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 8: 超时参数透传
// ---------------------------------------------------------------------------

describe("Feature: multi-agent-chat-view, Property 8: 超时参数透传", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  /**
   * Validates: Requirements 11.1, 11.4
   *
   * For any timeoutSeconds value (including undefined), the value passed to
   * callSessionsSend must be the original value when provided, or 120 when
   * undefined.
   */
  it("enforces minimum 600s for timeoutSeconds, defaults to 600", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbSessionKey,
        arbAgentId,
        fc.option(fc.integer({ min: 0, max: 1200 }), { nil: undefined }),
        async (callerSessionKey, targetAgentId, timeoutSeconds) => {
          mockedCreateStore.mockReturnValue({
            loadRootSession: vi.fn().mockReturnValue(undefined),
          } as never);

          let capturedTimeout: number | undefined;
          const callSessionsSend = vi
            .fn()
            .mockImplementation(async (params: { timeoutSeconds?: number }) => {
              capturedTimeout = params.timeoutSeconds;
              return { status: "ok" };
            });

          const tool = createAiemasSessionsSendTool(
            { db: {} as DatabaseSync, callSessionsSend },
            { agentSessionKey: callerSessionKey },
          );

          const params: Record<string, unknown> = {
            agentId: targetAgentId,
            message: "test",
          };
          if (timeoutSeconds !== undefined) {
            params.timeoutSeconds = timeoutSeconds;
          }

          await tool.execute("pbt-call", params);

          // callSessionsSend must have been called
          expect(callSessionsSend).toHaveBeenCalledOnce();

          // Effective timeout = Math.max(provided ?? 600, 600)
          const expected = Math.max(timeoutSeconds ?? 600, 600);
          expect(capturedTimeout).toBe(expected);
        },
      ),
      { numRuns: 100 },
    );
  });
});
