import { unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createAiemasSessionsStore } from "./aiemas-sessions-store.js";
import { initDatabase } from "./database.js";

describe("aiemas-sessions-store", () => {
  let db: DatabaseSync;
  let dbPath: string;
  let store: ReturnType<typeof createAiemasSessionsStore>;

  beforeEach(() => {
    dbPath = join(tmpdir(), `test-aiemas-${Date.now()}.db`);
    db = initDatabase(dbPath);
    store = createAiemasSessionsStore(db);
  });

  afterEach(() => {
    db.close();
    try {
      unlinkSync(dbPath);
      unlinkSync(`${dbPath}-wal`);
      unlinkSync(`${dbPath}-shm`);
    } catch {
      // Ignore cleanup errors
    }
  });

  describe("saveRootSession", () => {
    it("should save a root session record", () => {
      const params = {
        sessionKey: "agent:aie-iaas:group:mas-d4548844",
        sessionId: "sess-uuid-1",
        agentId: "aie-iaas",
        sessionUuid: "mas-d4548844",
        label: "Test Session",
        userId: "user-1",
        tenantId: "tenant-1",
        descendantSessions: [
          {
            agentId: "aieiaas-resource",
            sessionKey: "agent:aieiaas-resource:group:mas-d4548844",
            sessionId: "sess-uuid-2",
          },
        ],
      };

      store.saveRootSession(params);

      const loaded = store.loadRootSession(params.sessionKey);
      expect(loaded).toBeDefined();
      expect(loaded?.sessionKey).toBe(params.sessionKey);
      expect(loaded?.sessionId).toBe(params.sessionId);
      expect(loaded?.agentId).toBe(params.agentId);
      expect(loaded?.label).toBe(params.label);
      expect(loaded?.descendantSessions).toHaveLength(1);
    });

    it("should handle optional label field", () => {
      const params = {
        sessionKey: "agent:aie-iaas:group:mas-d4548844",
        sessionId: "sess-uuid-1",
        agentId: "aie-iaas",
        sessionUuid: "mas-d4548844",
        userId: "user-1",
        tenantId: "tenant-1",
        descendantSessions: [],
      };

      store.saveRootSession(params);

      const loaded = store.loadRootSession(params.sessionKey);
      expect(loaded?.label).toBeUndefined();
    });

    it("should store createdAt timestamp", () => {
      const params = {
        sessionKey: "agent:aie-iaas:group:mas-d4548844",
        sessionId: "sess-uuid-1",
        agentId: "aie-iaas",
        sessionUuid: "mas-d4548844",
        userId: "user-1",
        tenantId: "tenant-1",
        descendantSessions: [],
      };

      const beforeTime = Date.now();
      store.saveRootSession(params);
      const afterTime = Date.now();

      const loaded = store.loadRootSession(params.sessionKey);
      expect(loaded?.createdAt).toBeGreaterThanOrEqual(beforeTime);
      expect(loaded?.createdAt).toBeLessThanOrEqual(afterTime);
    });
  });

  describe("loadRootSession", () => {
    it("should return undefined for non-existent session", () => {
      const loaded = store.loadRootSession("non-existent-key");
      expect(loaded).toBeUndefined();
    });

    it("should correctly deserialize descendantSessions JSON", () => {
      const descendantSessions = [
        {
          agentId: "aieiaas-resource",
          sessionKey: "agent:aieiaas-resource:group:mas-d4548844",
          sessionId: "sess-uuid-2",
        },
        {
          agentId: "aieiaas-model",
          sessionKey: "agent:aieiaas-model:group:mas-d4548844",
          sessionId: "sess-uuid-3",
        },
      ];

      store.saveRootSession({
        sessionKey: "agent:aie-iaas:group:mas-d4548844",
        sessionId: "sess-uuid-1",
        agentId: "aie-iaas",
        sessionUuid: "mas-d4548844",
        userId: "user-1",
        tenantId: "tenant-1",
        descendantSessions,
      });

      const loaded = store.loadRootSession("agent:aie-iaas:group:mas-d4548844");
      expect(loaded?.descendantSessions).toEqual(descendantSessions);
    });
  });

  describe("listRootSessions", () => {
    it("should return empty list when no sessions exist", () => {
      const sessions = store.listRootSessions();
      expect(sessions).toEqual([]);
    });

    it("should return all saved sessions", () => {
      store.saveRootSession({
        sessionKey: "agent:aie-iaas:group:mas-d4548844",
        sessionId: "sess-uuid-1",
        agentId: "aie-iaas",
        sessionUuid: "mas-d4548844",
        userId: "user-1",
        tenantId: "tenant-1",
        descendantSessions: [],
      });

      store.saveRootSession({
        sessionKey: "agent:aie-iaas:group:mas-d4548845",
        sessionId: "sess-uuid-2",
        agentId: "aie-iaas",
        sessionUuid: "mas-d4548845",
        userId: "user-2",
        tenantId: "tenant-1",
        descendantSessions: [],
      });

      const sessions = store.listRootSessions();
      expect(sessions).toHaveLength(2);
    });

    it("should return sessions ordered by createdAt DESC", async () => {
      store.saveRootSession({
        sessionKey: "agent:aie-iaas:group:mas-d4548844",
        sessionId: "sess-uuid-1",
        agentId: "aie-iaas",
        sessionUuid: "mas-d4548844",
        userId: "user-1",
        tenantId: "tenant-1",
        descendantSessions: [],
      });

      // Small delay to ensure different timestamps
      await new Promise((resolve) => setTimeout(resolve, 10));

      store.saveRootSession({
        sessionKey: "agent:aie-iaas:group:mas-d4548845",
        sessionId: "sess-uuid-2",
        agentId: "aie-iaas",
        sessionUuid: "mas-d4548845",
        userId: "user-2",
        tenantId: "tenant-1",
        descendantSessions: [],
      });

      const sessions = store.listRootSessions();
      expect(sessions[0].sessionKey).toBe("agent:aie-iaas:group:mas-d4548845");
      expect(sessions[1].sessionKey).toBe("agent:aie-iaas:group:mas-d4548844");
    });
  });

  describe("deleteRootSession", () => {
    it("should delete a session record", () => {
      const sessionKey = "agent:aie-iaas:group:mas-d4548844";
      store.saveRootSession({
        sessionKey,
        sessionId: "sess-uuid-1",
        agentId: "aie-iaas",
        sessionUuid: "mas-d4548844",
        userId: "user-1",
        tenantId: "tenant-1",
        descendantSessions: [],
      });

      expect(store.loadRootSession(sessionKey)).toBeDefined();

      store.deleteRootSession(sessionKey);

      expect(store.loadRootSession(sessionKey)).toBeUndefined();
    });

    it("should not throw when deleting non-existent session", () => {
      expect(() => {
        store.deleteRootSession("non-existent-key");
      }).not.toThrow();
    });
  });

  describe("updateDescendantSessions", () => {
    it("should update descendantSessions field", () => {
      const sessionKey = "agent:aie-iaas:group:mas-d4548844";
      store.saveRootSession({
        sessionKey,
        sessionId: "sess-uuid-1",
        agentId: "aie-iaas",
        sessionUuid: "mas-d4548844",
        userId: "user-1",
        tenantId: "tenant-1",
        descendantSessions: [
          {
            agentId: "aieiaas-resource",
            sessionKey: "agent:aieiaas-resource:group:mas-d4548844",
            sessionId: "sess-uuid-2",
          },
        ],
      });

      const newDescendantSessions = [
        {
          agentId: "aieiaas-resource",
          sessionKey: "agent:aieiaas-resource:group:mas-d4548844",
          sessionId: "sess-uuid-2",
        },
        {
          agentId: "aieiaas-model",
          sessionKey: "agent:aieiaas-model:group:mas-d4548844",
          sessionId: "sess-uuid-3",
        },
      ];

      store.updateDescendantSessions({
        sessionKey,
        descendantSessions: newDescendantSessions,
      });

      const loaded = store.loadRootSession(sessionKey);
      expect(loaded?.descendantSessions).toEqual(newDescendantSessions);
    });

    it("should handle empty descendantSessions", () => {
      const sessionKey = "agent:aie-iaas:group:mas-d4548844";
      store.saveRootSession({
        sessionKey,
        sessionId: "sess-uuid-1",
        agentId: "aie-iaas",
        sessionUuid: "mas-d4548844",
        userId: "user-1",
        tenantId: "tenant-1",
        descendantSessions: [
          {
            agentId: "aieiaas-resource",
            sessionKey: "agent:aieiaas-resource:group:mas-d4548844",
            sessionId: "sess-uuid-2",
          },
        ],
      });

      store.updateDescendantSessions({
        sessionKey,
        descendantSessions: [],
      });

      const loaded = store.loadRootSession(sessionKey);
      expect(loaded?.descendantSessions).toEqual([]);
    });
  });

  describe("upsertSessionLabel", () => {
    it("should update label on existing session", () => {
      store.saveRootSession({
        sessionKey: "agent:aie-iaas:group:mas-d4548844",
        sessionId: "sess-uuid-1",
        agentId: "aie-iaas",
        sessionUuid: "mas-d4548844",
        userId: "user-1",
        tenantId: "tenant-1",
        descendantSessions: [],
      });

      store.upsertSessionLabel("agent:aie-iaas:group:mas-d4548844", { label: "New Label" });

      const entry = store.getSessionLabel("mas-d4548844");
      expect(entry?.label).toBe("New Label");
    });

    it("should update currentAgentId on existing session", () => {
      store.saveRootSession({
        sessionKey: "agent:aie-iaas:group:mas-d4548844",
        sessionId: "sess-uuid-1",
        agentId: "aie-iaas",
        sessionUuid: "mas-d4548844",
        userId: "user-1",
        tenantId: "tenant-1",
        descendantSessions: [],
      });

      store.upsertSessionLabel("agent:aie-iaas:group:mas-d4548844", {
        currentAgentId: "new-agent",
      });

      const entry = store.getSessionLabel("mas-d4548844");
      expect(entry?.currentAgentId).toBe("new-agent");
    });

    it("should skip when session does not exist", () => {
      store.upsertSessionLabel("agent:unknown:group:no-such-uuid", { label: "Ghost" });
      const entry = store.getSessionLabel("no-such-uuid");
      expect(entry).toBeNull();
    });
  });

  describe("getSessionLabel", () => {
    it("should return null for non-existent session", () => {
      expect(store.getSessionLabel("non-existent")).toBeNull();
    });

    it("should accept sessionKey as identifier", () => {
      store.saveRootSession({
        sessionKey: "agent:aie-iaas:group:mas-d4548844",
        sessionId: "sess-uuid-1",
        agentId: "aie-iaas",
        sessionUuid: "mas-d4548844",
        label: "Test",
        userId: "user-1",
        tenantId: "tenant-1",
        descendantSessions: [],
      });

      const entry = store.getSessionLabel("agent:aie-iaas:group:mas-d4548844");
      expect(entry?.label).toBe("Test");
    });
  });

  describe("countByCurrentAgentId", () => {
    it("should count sessions by currentAgentId", () => {
      store.saveRootSession({
        sessionKey: "agent:aie-iaas:group:mas-d4548844",
        sessionId: "sess-uuid-1",
        agentId: "aie-iaas",
        sessionUuid: "mas-d4548844",
        userId: "user-1",
        tenantId: "tenant-1",
        descendantSessions: [],
      });

      expect(store.countByCurrentAgentId("aie-iaas")).toBe(1);
      expect(store.countByCurrentAgentId("unknown")).toBe(0);
    });
  });

  describe("deleteSessionByUuid", () => {
    it("should delete by sessionUuid", () => {
      store.saveRootSession({
        sessionKey: "agent:aie-iaas:group:mas-d4548844",
        sessionId: "sess-uuid-1",
        agentId: "aie-iaas",
        sessionUuid: "mas-d4548844",
        userId: "user-1",
        tenantId: "tenant-1",
        descendantSessions: [],
      });

      store.deleteSessionByUuid("mas-d4548844");
      expect(store.loadRootSession("agent:aie-iaas:group:mas-d4548844")).toBeUndefined();
    });

    it("should accept sessionKey as identifier", () => {
      store.saveRootSession({
        sessionKey: "agent:aie-iaas:group:mas-d4548844",
        sessionId: "sess-uuid-1",
        agentId: "aie-iaas",
        sessionUuid: "mas-d4548844",
        userId: "user-1",
        tenantId: "tenant-1",
        descendantSessions: [],
      });

      store.deleteSessionByUuid("agent:aie-iaas:group:mas-d4548844");
      expect(store.loadRootSession("agent:aie-iaas:group:mas-d4548844")).toBeUndefined();
    });
  });
});
