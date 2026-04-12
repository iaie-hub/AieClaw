import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiemasToolDeps } from "./aiemas-tools.js";

// ── Mocks ──

vi.mock("../store/aiemas-sessions-store.js", () => ({
  createAiemasSessionsStore: vi.fn(),
}));

vi.mock("../utils/session-utils.js", () => ({
  extractUuidFromKey: vi.fn(),
  constructKeyFromUuid: vi.fn(),
}));

// Import mocked modules so we can control their behavior per test
const { createAiemasSessionsStore } = await import("../store/aiemas-sessions-store.js");
const { extractUuidFromKey, constructKeyFromUuid } = await import("../utils/session-utils.js");
const { createAiemasSessionsSendTool } = await import("./aiemas-tools.js");

const mockedCreateStore = vi.mocked(createAiemasSessionsStore);
const mockedExtractUuid = vi.mocked(extractUuidFromKey);
const mockedConstructKey = vi.mocked(constructKeyFromUuid);

// ── Helpers ──

function parseResult(result: { content: Array<{ type: string; text: string }> }): unknown {
  return JSON.parse(result.content[0].text);
}

function makeDeps(overrides?: Partial<AiemasToolDeps>): AiemasToolDeps {
  return {
    db: {} as DatabaseSync,
    callSessionsSend: overrides?.callSessionsSend ?? vi.fn().mockResolvedValue({ status: "ok" }),
  };
}

describe("aiemas_sessions_send", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // ── Validates: Requirements 2.3 ──
  describe("success path: sessionKey from descendantSessions", () => {
    it("uses sessionKey from descendantSessions when target agentId is found", async () => {
      const callerKey = "agent:orchestrator:group:mas-abc123";
      const targetAgentId = "aieiaas-resource";
      const descendantSessionKey = "agent:aieiaas-resource:group:mas-abc123";

      mockedExtractUuid.mockReturnValue("mas-abc123");
      mockedCreateStore.mockReturnValue({
        loadRootSession: vi.fn().mockReturnValue({
          sessionKey: callerKey,
          descendantSessions: [
            { agentId: targetAgentId, sessionKey: descendantSessionKey, sessionId: "sess-1" },
            {
              agentId: "other-agent",
              sessionKey: "agent:other:group:mas-abc123",
              sessionId: "sess-2",
            },
          ],
        }),
      } as never);

      const callSessionsSend = vi.fn().mockResolvedValue({ status: "ok", reply: "done" });
      const tool = createAiemasSessionsSendTool(makeDeps({ callSessionsSend }), {
        agentSessionKey: callerKey,
      });

      const result = await tool.execute("call-1", { agentId: targetAgentId, message: "hello" });
      const payload = parseResult(result) as Record<string, unknown>;

      expect(payload).toEqual({ status: "ok", reply: "done" });
      expect(callSessionsSend).toHaveBeenCalledWith({
        sessionKey: descendantSessionKey,
        message: "hello",
        timeoutSeconds: 30,
      });
      // constructKeyFromUuid should NOT be called when descendant is found
      expect(mockedConstructKey).not.toHaveBeenCalled();
    });
  });

  // ── Validates: Requirements 2.4, 2.5 ──
  describe("fallback path: derived sessionKey via constructKeyFromUuid", () => {
    it("falls back to derived key when loadRootSession returns undefined", async () => {
      const callerKey = "agent:orchestrator:group:mas-def456";
      const targetAgentId = "aieiaas-model";
      const derivedKey = "agent:aieiaas-model:group:mas-def456";

      mockedExtractUuid.mockReturnValue("mas-def456");
      mockedCreateStore.mockReturnValue({
        loadRootSession: vi.fn().mockReturnValue(undefined),
      } as never);
      mockedConstructKey.mockReturnValue(derivedKey);

      const callSessionsSend = vi.fn().mockResolvedValue({ status: "accepted" });
      const tool = createAiemasSessionsSendTool(makeDeps({ callSessionsSend }), {
        agentSessionKey: callerKey,
      });

      const result = await tool.execute("call-2", { agentId: targetAgentId, message: "deploy" });
      const payload = parseResult(result) as Record<string, unknown>;

      expect(payload).toEqual({ status: "accepted" });
      expect(mockedConstructKey).toHaveBeenCalledWith(targetAgentId, "mas-def456");
      expect(callSessionsSend).toHaveBeenCalledWith({
        sessionKey: derivedKey,
        message: "deploy",
        timeoutSeconds: 30,
      });
    });

    it("falls back to derived key when descendantSessions does not contain target agentId", async () => {
      const callerKey = "agent:orchestrator:group:mas-ghi789";
      const derivedKey = "agent:unknown-agent:group:mas-ghi789";

      mockedExtractUuid.mockReturnValue("mas-ghi789");
      mockedCreateStore.mockReturnValue({
        loadRootSession: vi.fn().mockReturnValue({
          sessionKey: callerKey,
          descendantSessions: [
            { agentId: "other-agent", sessionKey: "agent:other:group:mas-ghi789", sessionId: "s1" },
          ],
        }),
      } as never);
      mockedConstructKey.mockReturnValue(derivedKey);

      const callSessionsSend = vi.fn().mockResolvedValue({ status: "ok" });
      const tool = createAiemasSessionsSendTool(makeDeps({ callSessionsSend }), {
        agentSessionKey: callerKey,
      });

      const _result = await tool.execute("call-3", { agentId: "unknown-agent", message: "hi" });

      expect(mockedConstructKey).toHaveBeenCalledWith("unknown-agent", "mas-ghi789");
      expect(callSessionsSend).toHaveBeenCalledWith({
        sessionKey: derivedKey,
        message: "hi",
        timeoutSeconds: 30,
      });
    });
  });

  // ── Validates: Requirements 7.1 ──
  describe("error: empty agentSessionKey", () => {
    it("returns error when agentSessionKey is undefined", async () => {
      const tool = createAiemasSessionsSendTool(makeDeps(), { agentSessionKey: undefined });

      const result = await tool.execute("call-4", { agentId: "target", message: "msg" });
      const payload = parseResult(result) as Record<string, unknown>;

      expect(payload).toHaveProperty("status", "error");
      expect(payload).toHaveProperty("error");
      expect(mockedExtractUuid).not.toHaveBeenCalled();
    });

    it("returns error when agentSessionKey is empty string", async () => {
      const tool = createAiemasSessionsSendTool(makeDeps(), { agentSessionKey: "" });

      const result = await tool.execute("call-5", { agentId: "target", message: "msg" });
      const payload = parseResult(result) as Record<string, unknown>;

      expect(payload).toHaveProperty("status", "error");
    });

    it("returns error when context is undefined", async () => {
      const tool = createAiemasSessionsSendTool(makeDeps());

      const result = await tool.execute("call-6", { agentId: "target", message: "msg" });
      const payload = parseResult(result) as Record<string, unknown>;

      expect(payload).toHaveProperty("status", "error");
    });
  });

  // ── Validates: Requirements 7.2 ──
  describe("error: invalid agentSessionKey (extractUuidFromKey returns empty)", () => {
    it("returns error when sessionUuid is empty", async () => {
      mockedExtractUuid.mockReturnValue("");

      const tool = createAiemasSessionsSendTool(makeDeps(), { agentSessionKey: "malformed-key" });

      const result = await tool.execute("call-7", { agentId: "target", message: "msg" });
      const payload = parseResult(result) as Record<string, unknown>;

      expect(payload).toHaveProperty("status", "error");
      expect((payload as { error: string }).error).toContain("sessionUuid");
    });
  });

  // ── Validates: Requirements 7.4 ──
  describe("error: DB exception falls back to derived sessionKey", () => {
    it("logs warning and falls back to derived key when loadRootSession throws", async () => {
      const callerKey = "agent:orchestrator:group:mas-err001";
      const derivedKey = "agent:target:group:mas-err001";

      mockedExtractUuid.mockReturnValue("mas-err001");
      mockedCreateStore.mockReturnValue({
        loadRootSession: vi.fn().mockImplementation(() => {
          throw new Error("DB connection lost");
        }),
      } as never);
      mockedConstructKey.mockReturnValue(derivedKey);

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      const callSessionsSend = vi.fn().mockResolvedValue({ status: "ok" });
      const tool = createAiemasSessionsSendTool(makeDeps({ callSessionsSend }), {
        agentSessionKey: callerKey,
      });

      const result = await tool.execute("call-8", { agentId: "target", message: "retry" });
      const payload = parseResult(result) as Record<string, unknown>;

      expect(payload).toEqual({ status: "ok" });
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("DB query failed"));
      expect(mockedConstructKey).toHaveBeenCalledWith("target", "mas-err001");
      expect(callSessionsSend).toHaveBeenCalledWith({
        sessionKey: derivedKey,
        message: "retry",
        timeoutSeconds: 30,
      });

      warnSpy.mockRestore();
    });
  });

  // ── Validates: Requirements 7.3 ──
  describe("error: callSessionsSend failure", () => {
    it("wraps callSessionsSend error into status error response", async () => {
      const callerKey = "agent:orchestrator:group:mas-fail01";
      const derivedKey = "agent:target:group:mas-fail01";

      mockedExtractUuid.mockReturnValue("mas-fail01");
      mockedCreateStore.mockReturnValue({
        loadRootSession: vi.fn().mockReturnValue(undefined),
      } as never);
      mockedConstructKey.mockReturnValue(derivedKey);

      const callSessionsSend = vi.fn().mockRejectedValue(new Error("Gateway timeout"));
      const tool = createAiemasSessionsSendTool(makeDeps({ callSessionsSend }), {
        agentSessionKey: callerKey,
      });

      const result = await tool.execute("call-9", { agentId: "target", message: "boom" });
      const payload = parseResult(result) as Record<string, unknown>;

      expect(payload).toHaveProperty("status", "error");
      expect((payload as { error: string }).error).toContain("callSessionsSend failed");
      expect((payload as { error: string }).error).toContain("Gateway timeout");
    });

    it("handles non-Error thrown values from callSessionsSend", async () => {
      const callerKey = "agent:orchestrator:group:mas-fail02";

      mockedExtractUuid.mockReturnValue("mas-fail02");
      mockedCreateStore.mockReturnValue({
        loadRootSession: vi.fn().mockReturnValue(undefined),
      } as never);
      mockedConstructKey.mockReturnValue("agent:target:group:mas-fail02");

      const callSessionsSend = vi.fn().mockRejectedValue("string error");
      const tool = createAiemasSessionsSendTool(makeDeps({ callSessionsSend }), {
        agentSessionKey: callerKey,
      });

      const result = await tool.execute("call-10", { agentId: "target", message: "test" });
      const payload = parseResult(result) as Record<string, unknown>;

      expect(payload).toHaveProperty("status", "error");
      expect((payload as { error: string }).error).toContain("string error");
    });
  });

  // ── Validates: Requirements 2.1 ──
  describe("timeoutSeconds parameter", () => {
    it("passes custom timeoutSeconds to callSessionsSend", async () => {
      const callerKey = "agent:orchestrator:group:mas-timeout";

      mockedExtractUuid.mockReturnValue("mas-timeout");
      mockedCreateStore.mockReturnValue({
        loadRootSession: vi.fn().mockReturnValue(undefined),
      } as never);
      mockedConstructKey.mockReturnValue("agent:target:group:mas-timeout");

      const callSessionsSend = vi.fn().mockResolvedValue({ status: "ok" });
      const tool = createAiemasSessionsSendTool(makeDeps({ callSessionsSend }), {
        agentSessionKey: callerKey,
      });

      await tool.execute("call-11", { agentId: "target", message: "slow", timeoutSeconds: 120 });

      expect(callSessionsSend).toHaveBeenCalledWith({
        sessionKey: "agent:target:group:mas-timeout",
        message: "slow",
        timeoutSeconds: 120,
      });
    });
  });
});
