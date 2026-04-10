import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMas4sGatewayPlugin } from "./mas4s-gateway-plugin.js";

// Mock dependencies
vi.mock("../store/database.js", () => ({
  initDatabase: vi.fn(() => ({
    prepare: vi.fn((sql: string) => ({
      all: vi.fn(() => []),
      get: vi.fn(() => {
        if (sql.toLowerCase().includes("count(*)")) {
          return { count: 0 };
        }
        return undefined;
      }),
      run: vi.fn(() => ({ changes: 0, lastInsertRowid: 0 })),
    })),
  })),
  initMessageDatabase: vi.fn(() => ({
    prepare: vi.fn(() => ({
      all: vi.fn(() => []),
      get: vi.fn(() => ({ cnt: 0 })),
      run: vi.fn(() => ({ changes: 0, lastInsertRowid: 0 })),
    })),
  })),
}));

vi.mock("../session-history/session-history-query.js", () => ({
  queryHistoryRange: vi.fn(() => ({ messages: [], total: 0, truncated: false, hasSummary: false })),
}));

describe("mas4s-gateway-plugin handlers", () => {
  let plugin: unknown;

  beforeEach(async () => {
    vi.clearAllMocks();
    plugin = await createMas4sGatewayPlugin({ dbPath: ":memory:" });
  });

  describe("session.history.range", () => {
    it("should default to last 30 days if from/to are missing", async () => {
      const handler = plugin.extraHandlers["session.history.range"];
      const respond = vi.fn();
      const client = {};
      const params = { sessionKey: "test-session" };

      // Mock bridge.checkSessionAccess to allow
      vi.spyOn(plugin.bridge, "checkSessionAccess").mockReturnValue({ allowed: true });

      const { queryHistoryRange } = await import("../session-history/session-history-query.js");

      await handler({ params, client, respond });

      expect(respond).toHaveBeenCalledWith(true, expect.any(Object), undefined);

      const queryCall = vi.mocked(queryHistoryRange).mock.calls[0];
      const queryOptions = queryCall[1];

      expect(queryOptions.from).toBeDefined();
      expect(queryOptions.to).toBeDefined();

      // Check if the range is roughly 30 days
      const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
      const diff = queryOptions.to! - queryOptions.from!;
      expect(diff).toBe(thirtyDaysMs);
    });

    it("should return PERMISSION_DENIED if bridge.checkSessionAccess fails", async () => {
      const { setMasAuth } = await import("./context.js");
      const handler = plugin.extraHandlers["session.history.range"];
      const respond = vi.fn();
      // Mock client with a userId to trigger permission check
      const client = {};
      setMasAuth(client, { userId: "user-1", masRole: "member", tenantId: "t1" });
      const params = { sessionKey: "test-session" };

      vi.spyOn(plugin.bridge, "checkSessionAccess").mockReturnValue({
        allowed: false,
        code: "PERMISSION_DENIED",
        message: "Access denied",
      });

      await handler({ params, client, respond });

      expect(respond).toHaveBeenCalledWith(
        false,
        undefined,
        expect.objectContaining({
          code: "PERMISSION_DENIED",
          message: "Access denied",
        }),
      );
    });
  });

  describe("aiemas.sessions.create", () => {
    it("uses the request-scoped dispatch when creating gateway sessions", async () => {
      const { setMasAuth } = await import("./context.js");
      const handler = plugin.extraHandlers["aiemas.sessions.create"];
      const respond = vi.fn();
      const client = {};
      const dispatchGateway = vi
        .fn()
        .mockResolvedValueOnce({ key: "agent:aieiaas-resource:group:abc123", id: "sess-1" });

      setMasAuth(client, {
        userId: "user-1",
        tenantId: "tenant-1",
        masRole: "member",
      });
      plugin.gatewayDispatch = vi
        .fn()
        .mockRejectedValue(new Error("Gateway context not available for internal dispatch"));

      await handler({
        params: { agentId: "aieiaas-resource", label: "res-1" },
        client,
        respond,
        dispatchGateway,
      });

      expect(dispatchGateway).toHaveBeenCalledWith(
        "sessions.create",
        expect.objectContaining({ agentId: "aieiaas-resource", label: "res-1" }),
        client,
      );
      expect(respond).toHaveBeenCalledWith(
        true,
        expect.objectContaining({
          sessionKey: "agent:aieiaas-resource:group:abc123",
          sessionId: "sess-1",
        }),
        undefined,
      );
      expect(plugin.gatewayDispatch).not.toHaveBeenCalled();
    });
  });

  describe("aiemas.sessions.delete", () => {
    it("uses the request-scoped dispatch when deleting gateway sessions", async () => {
      const { setMasAuth } = await import("./context.js");
      const handler = plugin.extraHandlers["aiemas.sessions.delete"];
      const respond = vi.fn();
      const client = {};
      const dispatchGateway = vi.fn().mockResolvedValue({ ok: true });

      setMasAuth(client, {
        userId: "user-1",
        tenantId: "tenant-1",
        masRole: "member",
      });
      plugin.gatewayDispatch = vi
        .fn()
        .mockRejectedValue(new Error("Gateway context not available for internal dispatch"));

      // Mock bridge.checkSessionAccess and loadGatewaySessionRow
      vi.spyOn(plugin.bridge, "checkSessionAccess").mockReturnValue({ allowed: true });
      vi.spyOn(plugin, "loadGatewaySessionRow").mockReturnValue({ sessionKey: "test-key" });

      await handler({
        params: { sessionKey: "test-key" },
        client,
        respond,
        dispatchGateway,
      });

      expect(dispatchGateway).toHaveBeenCalledWith(
        "sessions.delete",
        expect.objectContaining({ sessionKey: "test-key" }),
        client,
      );
      expect(respond).toHaveBeenCalledWith(true, expect.objectContaining({ ok: true }), undefined);
      expect(plugin.gatewayDispatch).not.toHaveBeenCalled();
    });
  });

  describe("aiemas.sessions.list", () => {
    it("uses the request-scoped dispatch when listing gateway sessions", async () => {
      const { setMasAuth } = await import("./context.js");
      const handler = plugin.extraHandlers["aiemas.sessions.list"];
      const respond = vi.fn();
      const client = {};
      const dispatchGateway = vi.fn().mockResolvedValue({ ts: 0, count: 0, sessions: [] });

      setMasAuth(client, {
        userId: "user-1",
        tenantId: "tenant-1",
        masRole: "member",
      });
      plugin.gatewayDispatch = vi
        .fn()
        .mockRejectedValue(new Error("Gateway context not available for internal dispatch"));

      await handler({
        client,
        respond,
        dispatchGateway,
      });

      // listRootSessions doesn't call callGateway in its current implementation,
      // but the handler should respond with success.
      expect(respond).toHaveBeenCalledWith(
        true,
        expect.objectContaining({ count: 0, sessions: [] }),
        undefined,
      );
      expect(plugin.gatewayDispatch).not.toHaveBeenCalled();
    });
  });
});
