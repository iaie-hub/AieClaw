import { describe, it, expect, beforeEach, vi } from "vitest";
import { createMas4sGatewayPlugin } from "./mas4s-gateway-plugin.js";

// Mock dependencies
vi.mock("../store/database.js", () => ({
  initDatabase: vi.fn(() => ({
    prepare: vi.fn(() => ({
      all: vi.fn(() => []),
      get: vi.fn(() => ({ count: 0 })),
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
});
