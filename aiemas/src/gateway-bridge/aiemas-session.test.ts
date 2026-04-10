/**
 * Unit and integration tests for createSessionCascadeService.
 *
 * Feature: a2a-session-cascade
 *
 * Test cases:
 *   1. cascadeCreate - success path with root agent (has topology with descendants)
 *   2. cascadeCreate - non-root agent (no topology) - only 1 callGateway call
 *   3. cascadeCreate - compatibility mode (userId=null) - only 1 callGateway call, no DB record
 *   4. cascadeCreate - descendant session creation failure - other descendants still created
 *   5. cascadeDelete - success path with stored record - all descendants + root deleted
 *   6. cascadeDelete - no stored record - only 1 callGateway call
 *   7. cascadeDelete - descendant deletion failure - other descendants still deleted
 *   8. listRootSessions - returns sessions from DB
 *   9. syncTopologyChanges - adds sessions for new descendants
 *  10. syncTopologyChanges - removes sessions for removed descendants
 *  11. syncTopologyChanges - no active sessions (skips sync, no callGateway calls)
 */

import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterEach } from "vitest";
import type { TopologyCache } from "../cache/topology-cache.js";
import type { TopologyTree } from "../models.js";
import { createAiemasSessionsStore } from "../store/aiemas-sessions-store.js";
import { initDatabase } from "../store/database.js";
import { extractUuidFromKey } from "../utils/session-utils.js";
import { createSessionCascadeService } from "./aiemas-session.js";

// ---------------------------------------------------------------------------
// Temp DB helpers
// ---------------------------------------------------------------------------

const tempPaths: string[] = [];

function tmpDbPath(): string {
  const p = join(tmpdir(), `mas4s-session-unit-${randomUUID()}`, "mas4s.db");
  tempPaths.push(p);
  return p;
}

afterEach(() => {
  for (const p of tempPaths.splice(0)) {
    try {
      rmSync(join(p, ".."), { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
});

// ---------------------------------------------------------------------------
// Mock factory helpers
// ---------------------------------------------------------------------------

/**
 * Build a mock TopologyCache that returns `topology` for `rootAgentId`
 * and `undefined` for everything else.
 */
function mockTopologyCache(rootAgentId: string, topology: TopologyTree | undefined): TopologyCache {
  return {
    getTopology(id: string): TopologyTree | undefined {
      return id === rootAgentId ? topology : undefined;
    },
    getChildren(): string[] {
      return [];
    },
    load(): void {},
    update(): void {},
  } as unknown as TopologyCache;
}

/**
 * Build a mock callGateway that counts calls and returns fake session data.
 * Optionally, a set of agentIds can be configured to fail on sessions.create.
 */
function mockCallGateway(opts: { failCreateFor?: Set<string> } = {}) {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];

  const callGateway = async (method: string, params: Record<string, unknown>): Promise<unknown> => {
    if (method === "sessions.create") {
      const agentId = (params["agentId"] as string) ?? "unknown";
      if (opts.failCreateFor?.has(agentId)) {
        throw new Error(`Simulated failure for agentId=${agentId}`);
      }
      calls.push({ method, params });
      const uuid = `mas-${randomUUID().slice(0, 8)}`;
      const explicitKey = typeof params["key"] === "string" ? params["key"] : undefined;
      return {
        key: explicitKey ?? `agent:${agentId}:group:${uuid}`,
        id: `sess-${randomUUID().slice(0, 8)}`,
      };
    }
    if (method === "sessions.delete") {
      const sessionKey = params["sessionKey"] as string | undefined;
      if (opts.failCreateFor?.has(sessionKey ?? "")) {
        throw new Error(`Simulated delete failure for sessionKey=${sessionKey}`);
      }
      calls.push({ method, params });
      return { ok: true };
    }
    calls.push({ method, params });
    return {};
  };

  return {
    callGateway,
    getCallCount: () => calls.length,
    getCalls: () => calls,
    getCreateCount: () => calls.filter((c) => c.method === "sessions.create").length,
    getDeleteCount: () => calls.filter((c) => c.method === "sessions.delete").length,
    getCreateCalls: () => calls.filter((c) => c.method === "sessions.create"),
    getCreatedAgentIds: () =>
      calls.filter((c) => c.method === "sessions.create").map((c) => c.params["agentId"] as string),
    getDeletedSessionKeys: () =>
      calls
        .filter((c) => c.method === "sessions.delete")
        .map((c) => c.params["sessionKey"] as string),
    reset: () => {
      calls.length = 0;
    },
  };
}

function loadGatewayRowFromStore(db: import("node:sqlite").DatabaseSync) {
  return (sessionKey: string) => {
    const record = createAiemasSessionsStore(db).loadRootSession(sessionKey);
    if (!record) {
      return null;
    }
    return {
      ...record,
      key: record.sessionKey,
      sessionKey: record.sessionKey,
    };
  };
}

// ---------------------------------------------------------------------------
// Test 1: cascadeCreate - success path with root agent (has topology with descendants)
// ---------------------------------------------------------------------------

describe("cascadeCreate - success path with root agent", () => {
  it("creates sessions for root agent and all descendants, persists DB record", async () => {
    const db = initDatabase(tmpDbPath());
    const mock = mockCallGateway();
    const rootAgentId = "root-agent";
    const topology: TopologyTree = {
      edges: [
        { from: "root-agent", to: "child-a" },
        { from: "root-agent", to: "child-b" },
        { from: "child-a", to: "grandchild-c" },
      ],
    };
    const topologyCache = mockTopologyCache(rootAgentId, topology);
    const recordedSessions: string[] = [];

    const svc = createSessionCascadeService({
      db,
      callGateway: mock.callGateway,
      topologyCache,
      recordSessionCreated: (sessionKey) => {
        recordedSessions.push(sessionKey);
      },
      deleteSessionRecords: () => {},
      loadGatewaySessionRow: loadGatewayRowFromStore(db),
    });

    const result = await svc.cascadeCreate({
      agentId: rootAgentId,
      userId: "user-1",
      tenantId: "tenant-1",
      label: "Test Session",
    });

    // Returns root session key and id
    expect(result.sessionKey).toMatch(/^agent:root-agent:group:/);
    expect(result.sessionId).toBeTruthy();

    // 1 root + 3 descendants (child-a, child-b, grandchild-c)
    expect(mock.getCreateCount()).toBe(4);

    // Root agent was created first
    const createdAgentIds = mock.getCreatedAgentIds();
    expect(createdAgentIds[0]).toBe("root-agent");
    // All descendants created
    expect(createdAgentIds).toContain("child-a");
    expect(createdAgentIds).toContain("child-b");
    expect(createdAgentIds).toContain("grandchild-c");

    const createCalls = mock.getCreateCalls();
    const rootSessionKey = createCalls[0]?.params["key"] as string | undefined;
    expect(rootSessionKey).toBeUndefined();
    const rootUuid = extractUuidFromKey(result.sessionKey);
    expect(rootUuid).toBeTruthy();
    expect(createCalls.slice(1)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          params: expect.objectContaining({
            agentId: "child-a",
            key: `agent:child-a:group:${rootUuid}`,
          }),
        }),
        expect.objectContaining({
          params: expect.objectContaining({
            agentId: "child-b",
            key: `agent:child-b:group:${rootUuid}`,
          }),
        }),
        expect.objectContaining({
          params: expect.objectContaining({
            agentId: "grandchild-c",
            key: `agent:grandchild-c:group:${rootUuid}`,
          }),
        }),
      ]),
    );

    // DB record persisted: listRootSessions returns the record
    const listed = await svc.listRootSessions();
    expect(listed.sessions).toHaveLength(1);
    expect(listed.sessions[0].agentId).toBe("root-agent");
    expect(listed.sessions[0].userId).toBe("user-1");
    expect(listed.sessions[0].tenantId).toBe("tenant-1");
    expect(listed.sessions[0].label).toBe("Test Session");
    expect(listed.sessions[0].sessionKey).toBe(result.sessionKey);

    // recordSessionCreated called for root + descendants
    expect(recordedSessions).toContain(result.sessionKey);
    expect(recordedSessions.length).toBeGreaterThanOrEqual(1);
  });

  it("passes a canonical child session key to sessions.create", async () => {
    const db = initDatabase(tmpDbPath());
    const mock = mockCallGateway();
    const topologyCache = mockTopologyCache("root-agent", {
      edges: [{ from: "root-agent", to: "AieIaas Resource" }],
    });

    const svc = createSessionCascadeService({
      db,
      callGateway: mock.callGateway,
      topologyCache,
      recordSessionCreated: () => {},
      deleteSessionRecords: () => {},
      loadGatewaySessionRow: loadGatewayRowFromStore(db),
    });

    const result = await svc.cascadeCreate({
      agentId: "root-agent",
      userId: "user-1",
      tenantId: "tenant-1",
    });

    const rootUuid = extractUuidFromKey(result.sessionKey);
    expect(mock.getCreateCalls()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          params: expect.objectContaining({
            agentId: "AieIaas Resource",
            key: `agent:aieiaas-resource:group:${rootUuid}`,
          }),
        }),
      ]),
    );
  });
});

// ---------------------------------------------------------------------------
// Test 2: cascadeCreate - non-root agent (no topology) - only 1 callGateway call
// ---------------------------------------------------------------------------

describe("cascadeCreate - non-root agent (no topology)", () => {
  it("calls callGateway exactly once and does not persist a DB record", async () => {
    const db = initDatabase(tmpDbPath());
    const mock = mockCallGateway();
    // topologyCache returns undefined for this agentId → not a root
    const topologyCache = mockTopologyCache("__some_other_root__", { edges: [] });

    const svc = createSessionCascadeService({
      db,
      callGateway: mock.callGateway,
      topologyCache,
      recordSessionCreated: () => {},
      deleteSessionRecords: () => {},
      loadGatewaySessionRow: loadGatewayRowFromStore(db),
    });

    const result = await svc.cascadeCreate({
      agentId: "non-root-agent",
      userId: "user-1",
      tenantId: "tenant-1",
    });

    expect(result.sessionKey).toMatch(/^agent:non-root-agent:group:/);
    expect(mock.getCallCount()).toBe(1);
    expect(mock.getCreateCount()).toBe(1);

    // No DB record saved
    const listed = await svc.listRootSessions();
    expect(listed.sessions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test 3: cascadeCreate - compatibility mode (userId=null)
// ---------------------------------------------------------------------------

describe("cascadeCreate - compatibility mode (userId=null)", () => {
  it("calls callGateway exactly once and does not persist a DB record", async () => {
    const db = initDatabase(tmpDbPath());
    const mock = mockCallGateway();
    const rootAgentId = "root-agent";
    const topology: TopologyTree = {
      edges: [
        { from: "root-agent", to: "child-a" },
        { from: "root-agent", to: "child-b" },
      ],
    };
    // Even though this is a root agent, userId=null should skip cascade
    const topologyCache = mockTopologyCache(rootAgentId, topology);

    const svc = createSessionCascadeService({
      db,
      callGateway: mock.callGateway,
      topologyCache,
      recordSessionCreated: () => {},
      deleteSessionRecords: () => {},
      loadGatewaySessionRow: loadGatewayRowFromStore(db),
    });

    const result = await svc.cascadeCreate({
      agentId: rootAgentId,
      userId: null,
      tenantId: "tenant-1",
    });

    expect(result.sessionKey).toMatch(/^agent:root-agent:group:/);
    expect(mock.getCallCount()).toBe(1);
    expect(mock.getCreateCount()).toBe(1);

    // No DB record saved (compat mode)
    const listed = await svc.listRootSessions();
    expect(listed.sessions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test 4: cascadeCreate - descendant session creation failure
// ---------------------------------------------------------------------------

describe("cascadeCreate - descendant session creation failure", () => {
  it("continues creating other descendants when one fails", async () => {
    const db = initDatabase(tmpDbPath());
    // child-b will fail to create
    const mock = mockCallGateway({ failCreateFor: new Set(["child-b"]) });
    const rootAgentId = "root-agent";
    const topology: TopologyTree = {
      edges: [
        { from: "root-agent", to: "child-a" },
        { from: "root-agent", to: "child-b" },
        { from: "root-agent", to: "child-c" },
      ],
    };
    const topologyCache = mockTopologyCache(rootAgentId, topology);

    const svc = createSessionCascadeService({
      db,
      callGateway: mock.callGateway,
      topologyCache,
      recordSessionCreated: () => {},
      deleteSessionRecords: () => {},
      loadGatewaySessionRow: loadGatewayRowFromStore(db),
    });

    // Should not throw even though child-b fails
    const result = await svc.cascadeCreate({
      agentId: rootAgentId,
      userId: "user-1",
      tenantId: "tenant-1",
    });

    expect(result.sessionKey).toMatch(/^agent:root-agent:group:/);

    // root + child-a + child-c created (child-b failed)
    const createdAgentIds = mock.getCreatedAgentIds();
    expect(createdAgentIds).toContain("root-agent");
    expect(createdAgentIds).toContain("child-a");
    expect(createdAgentIds).toContain("child-c");
    expect(createdAgentIds).not.toContain("child-b");

    const rootUuid = extractUuidFromKey(result.sessionKey);
    const createCalls = mock.getCreateCalls();
    expect(createCalls.slice(1)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          params: expect.objectContaining({
            agentId: "child-a",
            key: `agent:child-a:group:${rootUuid}`,
          }),
        }),
        expect.objectContaining({
          params: expect.objectContaining({
            agentId: "child-c",
            key: `agent:child-c:group:${rootUuid}`,
          }),
        }),
      ]),
    );

    // DB record still saved with successful descendants
    const store = createAiemasSessionsStore(db);
    const sessions = store.listRootSessions();
    expect(sessions).toHaveLength(1);
    const descendantAgentIds = sessions[0].descendantSessions.map((d) => d.agentId);
    expect(descendantAgentIds).toContain("child-a");
    expect(descendantAgentIds).toContain("child-c");
    expect(descendantAgentIds).not.toContain("child-b");
  });
});

// ---------------------------------------------------------------------------
// Test 5: cascadeDelete - success path with stored record
// ---------------------------------------------------------------------------

describe("cascadeDelete - success path with stored record", () => {
  it("deletes all descendants and root session, cleans up DB record", async () => {
    const db = initDatabase(tmpDbPath());
    const mock = mockCallGateway();
    const rootAgentId = "root-agent";
    const topology: TopologyTree = {
      edges: [
        { from: "root-agent", to: "child-a" },
        { from: "root-agent", to: "child-b" },
      ],
    };
    const topologyCache = mockTopologyCache(rootAgentId, topology);
    const deletedSessions: string[] = [];

    const svc = createSessionCascadeService({
      db,
      callGateway: mock.callGateway,
      topologyCache,
      recordSessionCreated: () => {},
      deleteSessionRecords: (sessionKey) => {
        deletedSessions.push(sessionKey);
      },
      loadGatewaySessionRow: loadGatewayRowFromStore(db),
    });

    // First create to persist the record
    const { sessionKey } = await svc.cascadeCreate({
      agentId: rootAgentId,
      userId: "user-1",
      tenantId: "tenant-1",
    });

    mock.reset();
    deletedSessions.length = 0;

    await svc.cascadeDelete({ sessionKey });

    // 2 descendants + 1 root = 3 delete calls
    expect(mock.getDeleteCount()).toBe(3);

    // Root session key was deleted
    const deletedKeys = mock.getDeletedSessionKeys();
    expect(deletedKeys).toContain(sessionKey);

    // deleteSessionRecords called for root + descendants
    expect(deletedSessions).toContain(sessionKey);
    expect(deletedSessions.length).toBe(3);

    // DB record removed
    const listed = await svc.listRootSessions();
    expect(listed.sessions).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Test 6: cascadeDelete - no stored record
// ---------------------------------------------------------------------------

describe("cascadeDelete - no stored record", () => {
  it("calls callGateway exactly once when no DB record exists", async () => {
    const db = initDatabase(tmpDbPath());
    const mock = mockCallGateway();
    const topologyCache = mockTopologyCache("__root__", { edges: [] });

    const svc = createSessionCascadeService({
      db,
      callGateway: mock.callGateway,
      topologyCache,
      recordSessionCreated: () => {},
      deleteSessionRecords: () => {},
      loadGatewaySessionRow: loadGatewayRowFromStore(db),
    });

    const sessionKey = "agent:some-agent:group:mas-12345678";
    await svc.cascadeDelete({ sessionKey });

    expect(mock.getCallCount()).toBe(1);
    expect(mock.getDeleteCount()).toBe(1);
    expect(mock.getDeletedSessionKeys()).toContain(sessionKey);
  });
});

// ---------------------------------------------------------------------------
// Test 7: cascadeDelete - descendant deletion failure
// ---------------------------------------------------------------------------

describe("cascadeDelete - descendant deletion failure", () => {
  it("continues deleting other descendants when one fails", async () => {
    const db = initDatabase(tmpDbPath());
    const rootAgentId = "root-agent";
    const topology: TopologyTree = {
      edges: [
        { from: "root-agent", to: "child-a" },
        { from: "root-agent", to: "child-b" },
        { from: "root-agent", to: "child-c" },
      ],
    };
    const topologyCache = mockTopologyCache(rootAgentId, topology);

    // First create with a normal mock to get session keys
    const setupMock = mockCallGateway();
    const setupSvc = createSessionCascadeService({
      db,
      callGateway: setupMock.callGateway,
      topologyCache,
      recordSessionCreated: () => {},
      deleteSessionRecords: () => {},
      loadGatewaySessionRow: loadGatewayRowFromStore(db),
    });

    const { sessionKey } = await setupSvc.cascadeCreate({
      agentId: rootAgentId,
      userId: "user-1",
      tenantId: "tenant-1",
    });

    // Find child-b's session key from the DB record
    const store = createAiemasSessionsStore(db);
    const sessions = store.listRootSessions();
    const childBSession = sessions[0].descendantSessions.find((d) => d.agentId === "child-b");
    expect(childBSession).toBeDefined();
    const childBSessionKey = childBSession!.sessionKey;

    // Now delete with child-b's sessionKey configured to fail
    const deleteMock = mockCallGateway({ failCreateFor: new Set([childBSessionKey]) });
    const deleteSvc = createSessionCascadeService({
      db,
      callGateway: deleteMock.callGateway,
      topologyCache,
      recordSessionCreated: () => {},
      deleteSessionRecords: () => {},
      loadGatewaySessionRow: loadGatewayRowFromStore(db),
    });

    // Should not throw even though child-b deletion fails
    await deleteSvc.cascadeDelete({ sessionKey });

    // child-a, child-c, and root should be deleted (child-b failed)
    const deletedKeys = deleteMock.getDeletedSessionKeys();
    expect(deletedKeys).toContain(sessionKey);
    expect(deletedKeys).not.toContain(childBSessionKey);
    // At least 3 delete attempts (child-a, child-c, root) — child-b threw
    expect(deleteMock.getDeleteCount()).toBeGreaterThanOrEqual(3);
  });
});

// ---------------------------------------------------------------------------
// Test 8: listRootSessions - returns sessions from DB
// ---------------------------------------------------------------------------

describe("listRootSessions - returns sessions from DB", () => {
  it("returns all persisted root sessions with correct fields", async () => {
    const db = initDatabase(tmpDbPath());
    const mock = mockCallGateway();
    const topologyCache = mockTopologyCache("root-a", {
      edges: [{ from: "root-a", to: "child-x" }],
    });

    const svc = createSessionCascadeService({
      db,
      callGateway: mock.callGateway,
      topologyCache,
      recordSessionCreated: () => {},
      deleteSessionRecords: () => {},
      loadGatewaySessionRow: loadGatewayRowFromStore(db),
    });

    // Initially empty
    expect((await svc.listRootSessions()).sessions).toHaveLength(0);

    // Create two sessions
    const r1 = await svc.cascadeCreate({
      agentId: "root-a",
      userId: "user-1",
      tenantId: "tenant-1",
      label: "Session Alpha",
    });

    // Create a second session for a different root (no topology)
    const topologyCache2 = mockTopologyCache("__other__", undefined);
    const svc2 = createSessionCascadeService({
      db,
      callGateway: mock.callGateway,
      topologyCache: topologyCache2,
      recordSessionCreated: () => {},
      deleteSessionRecords: () => {},
      loadGatewaySessionRow: loadGatewayRowFromStore(db),
    });
    // This one won't be persisted (non-root)
    await svc2.cascadeCreate({ agentId: "non-root", userId: "user-2", tenantId: "tenant-1" });

    const listed = await svc.listRootSessions();
    expect(listed.sessions).toHaveLength(1);

    const s = listed.sessions[0];
    expect(s.sessionKey).toBe(r1.sessionKey);
    expect(s.sessionId).toBe(r1.sessionId);
    expect(s.agentId).toBe("root-a");
    expect(s.userId).toBe("user-1");
    expect(s.tenantId).toBe("tenant-1");
    expect(s.label).toBe("Session Alpha");
    expect(s.sessionUuid).toBeTruthy();
    expect(typeof s.createdAt).toBe("number");
    expect(s.createdAt).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Test 9: syncTopologyChanges - adds sessions for new descendants
// ---------------------------------------------------------------------------

describe("syncTopologyChanges - adds sessions for new descendants", () => {
  it("creates sessions for newly added descendants across all active sessions", async () => {
    const db = initDatabase(tmpDbPath());
    const rootAgentId = "root-agent";

    const oldTopology: TopologyTree = {
      edges: [{ from: "root-agent", to: "child-a" }],
    };
    const newTopology: TopologyTree = {
      edges: [
        { from: "root-agent", to: "child-a" },
        { from: "root-agent", to: "child-b" }, // newly added
      ],
    };

    // Create 2 active sessions with old topology
    const setupMock = mockCallGateway();
    const oldTopologyCache = mockTopologyCache(rootAgentId, oldTopology);

    for (let i = 0; i < 2; i++) {
      const svcSetup = createSessionCascadeService({
        db,
        callGateway: setupMock.callGateway,
        topologyCache: oldTopologyCache,
        recordSessionCreated: () => {},
        deleteSessionRecords: () => {},
        loadGatewaySessionRow: loadGatewayRowFromStore(db),
      });
      await svcSetup.cascadeCreate({
        agentId: rootAgentId,
        userId: `user-${i}`,
        tenantId: "tenant-1",
      });
    }

    // Now sync with new topology
    const syncMock = mockCallGateway();
    const svc = createSessionCascadeService({
      db,
      callGateway: syncMock.callGateway,
      topologyCache: mockTopologyCache(rootAgentId, newTopology),
      recordSessionCreated: () => {},
      deleteSessionRecords: () => {},
      loadGatewaySessionRow: loadGatewayRowFromStore(db),
    });

    await svc.syncTopologyChanges({
      rootAgentId,
      oldTopology,
      newTopology,
      tenantId: "tenant-1",
    });

    // 1 new descendant × 2 active sessions = 2 create calls
    expect(syncMock.getCreateCount()).toBe(2);
    expect(syncMock.getDeleteCount()).toBe(0);

    // All created for child-b
    const createdAgentIds = syncMock.getCreatedAgentIds();
    expect(createdAgentIds.every((id) => id === "child-b")).toBe(true);

    const store = createAiemasSessionsStore(db);
    const sessions = store.listRootSessions();
    const expectedKeys = sessions
      .map((session) => `agent:child-b:group:${session.sessionUuid}`)
      .toSorted();
    const createdKeys = syncMock
      .getCreateCalls()
      .map((call) => call.params["key"] as string)
      .toSorted();
    expect(createdKeys).toEqual(expectedKeys);

    // DB records updated: each session now has child-a and child-b
    for (const session of sessions) {
      const descendantAgentIds = session.descendantSessions.map((d) => d.agentId);
      expect(descendantAgentIds).toContain("child-a");
      expect(descendantAgentIds).toContain("child-b");
    }
  });
});

// ---------------------------------------------------------------------------
// Test 10: syncTopologyChanges - removes sessions for removed descendants
// ---------------------------------------------------------------------------

describe("syncTopologyChanges - removes sessions for removed descendants", () => {
  it("deletes sessions for removed descendants across all active sessions", async () => {
    const db = initDatabase(tmpDbPath());
    const rootAgentId = "root-agent";

    const oldTopology: TopologyTree = {
      edges: [
        { from: "root-agent", to: "child-a" },
        { from: "root-agent", to: "child-b" }, // will be removed
      ],
    };
    const newTopology: TopologyTree = {
      edges: [{ from: "root-agent", to: "child-a" }],
    };

    // Create 2 active sessions with old topology
    const setupMock = mockCallGateway();
    const oldTopologyCache = mockTopologyCache(rootAgentId, oldTopology);

    for (let i = 0; i < 2; i++) {
      const svcSetup = createSessionCascadeService({
        db,
        callGateway: setupMock.callGateway,
        topologyCache: oldTopologyCache,
        recordSessionCreated: () => {},
        deleteSessionRecords: () => {},
        loadGatewaySessionRow: loadGatewayRowFromStore(db),
      });
      await svcSetup.cascadeCreate({
        agentId: rootAgentId,
        userId: `user-${i}`,
        tenantId: "tenant-1",
      });
    }

    // Now sync with new topology (child-b removed)
    const syncMock = mockCallGateway();
    const deletedRecords: string[] = [];
    const svc = createSessionCascadeService({
      db,
      callGateway: syncMock.callGateway,
      topologyCache: mockTopologyCache(rootAgentId, newTopology),
      recordSessionCreated: () => {},
      deleteSessionRecords: (sessionKey) => {
        deletedRecords.push(sessionKey);
      },
      loadGatewaySessionRow: loadGatewayRowFromStore(db),
    });

    await svc.syncTopologyChanges({
      rootAgentId,
      oldTopology,
      newTopology,
      tenantId: "tenant-1",
    });

    // 1 removed descendant × 2 active sessions = 2 delete calls
    expect(syncMock.getDeleteCount()).toBe(2);
    expect(syncMock.getCreateCount()).toBe(0);

    // deleteSessionRecords called for each removed session
    expect(deletedRecords).toHaveLength(2);

    // DB records updated: each session no longer has child-b
    const store = createAiemasSessionsStore(db);
    const sessions = store.listRootSessions();
    for (const session of sessions) {
      const descendantAgentIds = session.descendantSessions.map((d) => d.agentId);
      expect(descendantAgentIds).toContain("child-a");
      expect(descendantAgentIds).not.toContain("child-b");
    }
  });
});

// ---------------------------------------------------------------------------
// Test 11: syncTopologyChanges - no active sessions (skips sync)
// ---------------------------------------------------------------------------

describe("syncTopologyChanges - no active sessions", () => {
  it("makes no callGateway calls when there are no active sessions", async () => {
    const db = initDatabase(tmpDbPath());
    const mock = mockCallGateway();
    const rootAgentId = "root-agent";

    const oldTopology: TopologyTree = { edges: [{ from: "root-agent", to: "child-a" }] };
    const newTopology: TopologyTree = {
      edges: [
        { from: "root-agent", to: "child-a" },
        { from: "root-agent", to: "child-b" },
      ],
    };

    const svc = createSessionCascadeService({
      db,
      callGateway: mock.callGateway,
      topologyCache: mockTopologyCache(rootAgentId, newTopology),
      recordSessionCreated: () => {},
      deleteSessionRecords: () => {},
      loadGatewaySessionRow: loadGatewayRowFromStore(db),
    });

    // No sessions in DB for this rootAgentId
    await svc.syncTopologyChanges({
      rootAgentId,
      oldTopology,
      newTopology,
      tenantId: "tenant-1",
    });

    expect(mock.getCallCount()).toBe(0);
  });
});
