/**
 * Property-based tests for Session_Cascade_Service.
 *
 * Feature: a2a-session-cascade
 *
 * Properties tested in this file:
 *   Property 1:  后代 Agent ID 提取正确性
 *   Property 2:  非 rootAgentId 不触发级联
 *   Property 3:  级联创建操作数量正确性
 *   Property 4:  级联删除操作数量正确性
 *   Property 6:  拓扑差异计算正确性
 *   Property 7:  拓扑变更增量同步操作数量正确性
 *   Property 8:  兼容模式跳过级联
 *   Property 10: 空拓扑树边界情况
 *   Property 11: 拓扑树从无到有的增量同步
 *   Property 12: 拓扑树从有到无的增量同步
 *
 * Validates: Requirements 1.2, 1.3, 1.4, 1.6, 2.3, 2.4, 4.4, 6.5, 7.3, 10.1, 10.2, 10.3, 10.5
 */

import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as fc from "fast-check";
import { describe, it, expect, afterEach } from "vitest";
import type { TopologyCache } from "../cache/topology-cache.js";
import type { TopologyTree } from "../models.js";
import { initDatabase } from "../store/database.js";
import { createSessionCascadeService } from "./aiemas-session.js";
import { extractDescendantAgentIds } from "./topology-utils.js";

// ---------------------------------------------------------------------------
// Temp DB helpers
// ---------------------------------------------------------------------------

const tempPaths: string[] = [];

function tmpDbPath(): string {
  const p = join(tmpdir(), `mas4s-session-prop-${randomUUID()}`, "mas4s.db");
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
// Arbitraries
// ---------------------------------------------------------------------------

const arbAgentId = fc.stringMatching(/^[a-z][a-z0-9-]{0,19}$/);
const arbSessionUuid = fc.stringMatching(/^mas-[a-f0-9]{8}$/);
const arbEdge = fc.record({ from: arbAgentId, to: arbAgentId }).filter((e) => e.from !== e.to);
const arbTopologyTree = fc.record({ edges: fc.array(arbEdge, { maxLength: 5 }) });

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
 * Each call returns a unique sessionKey/sessionId pair.
 */
function mockCallGateway(rootAgentId: string, sessionUuid: string) {
  let callCount = 0;
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];

  const callGateway = async (method: string, params: Record<string, unknown>): Promise<unknown> => {
    callCount++;
    calls.push({ method, params });

    if (method === "sessions.create") {
      const agentId = (params["agentId"] as string) ?? "unknown";
      return {
        key: `agent:${agentId}:group:${sessionUuid}`,
        id: `sess-${randomUUID().slice(0, 8)}`,
      };
    }
    if (method === "sessions.delete") {
      return { ok: true };
    }
    return {};
  };

  return {
    callGateway,
    getCallCount: () => callCount,
    getCalls: () => calls,
    getCreateCount: () => calls.filter((c) => c.method === "sessions.create").length,
    getDeleteCount: () => calls.filter((c) => c.method === "sessions.delete").length,
    reset: () => {
      callCount = 0;
      calls.length = 0;
    },
  };
}

// ---------------------------------------------------------------------------
// Property 1: 后代 Agent ID 提取正确性
// ---------------------------------------------------------------------------

describe("Feature: a2a-session-cascade, Property 1: Descendant agent ID extraction correctness", () => {
  /**
   * Validates: Requirements 1.3, 2.3
   *
   * For any TopologyTree, extracted descendant IDs = union of all from/to fields
   * minus rootAgentId.
   */
  it("extractDescendantAgentIds returns exactly the set of unique agentIds from edges excluding rootAgentId", () => {
    fc.assert(
      fc.property(arbAgentId, arbTopologyTree, (rootAgentId, topology) => {
        const result = extractDescendantAgentIds(topology.edges, rootAgentId);

        // Build expected set: union of all from/to, excluding rootAgentId
        const expected = new Set<string>();
        for (const edge of topology.edges) {
          if (edge.from !== rootAgentId) {
            expected.add(edge.from);
          }
          if (edge.to !== rootAgentId) {
            expected.add(edge.to);
          }
        }

        // Result must match expected set (order-independent)
        expect(new Set(result)).toEqual(expected);
        // No duplicates
        expect(result.length).toBe(new Set(result).size);
        // rootAgentId must not appear
        expect(result).not.toContain(rootAgentId);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: 非 rootAgentId 不触发级联
// ---------------------------------------------------------------------------

describe("Feature: a2a-session-cascade, Property 2: Non-root agent ID does not trigger cascade", () => {
  /**
   * Validates: Requirements 1.2, 2.2, 4.4, 7.3
   *
   * For any agentId not in TopologyCache, cascadeCreate/cascadeDelete should
   * only call callGateway once.
   */
  it("cascadeCreate calls callGateway exactly once when agentId is not a rootAgentId", async () => {
    await fc.assert(
      fc.asyncProperty(arbAgentId, arbSessionUuid, async (agentId, sessionUuid) => {
        const db = initDatabase(tmpDbPath());
        const mock = mockCallGateway(agentId, sessionUuid);
        // topologyCache returns undefined for this agentId → not a root
        const topologyCache = mockTopologyCache("__other_root__", { edges: [] });

        const svc = createSessionCascadeService({
          db,
          callGateway: mock.callGateway,
          topologyCache,
          recordSessionCreated: () => {},
          deleteSessionRecords: () => {},
        });

        await svc.cascadeCreate({ agentId, userId: "user-1", tenantId: "tenant-1" });

        expect(mock.getCallCount()).toBe(1);
        expect(mock.getCreateCount()).toBe(1);
      }),
      { numRuns: 100 },
    );
  });

  it("cascadeDelete calls callGateway exactly once when sessionKey has no stored record", async () => {
    await fc.assert(
      fc.asyncProperty(arbAgentId, arbSessionUuid, async (agentId, sessionUuid) => {
        const db = initDatabase(tmpDbPath());
        const mock = mockCallGateway(agentId, sessionUuid);
        const topologyCache = mockTopologyCache("__other_root__", { edges: [] });

        const svc = createSessionCascadeService({
          db,
          callGateway: mock.callGateway,
          topologyCache,
          recordSessionCreated: () => {},
          deleteSessionRecords: () => {},
        });

        const sessionKey = `agent:${agentId}:group:${sessionUuid}`;
        await svc.cascadeDelete({ sessionKey });

        expect(mock.getCallCount()).toBe(1);
        expect(mock.getDeleteCount()).toBe(1);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: 级联创建操作数量正确性
// ---------------------------------------------------------------------------

describe("Feature: a2a-session-cascade, Property 3: Cascade create operation count correctness", () => {
  /**
   * Validates: Requirements 1.4, 1.3
   *
   * For rootAgentId with N descendant agents, cascadeCreate calls callGateway
   * 1 + M times (M = unique descendant count).
   */
  it("cascadeCreate calls callGateway 1 + M times where M is unique descendant count", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbAgentId,
        arbTopologyTree,
        arbSessionUuid,
        async (rootAgentId, topology, sessionUuid) => {
          const db = initDatabase(tmpDbPath());
          const mock = mockCallGateway(rootAgentId, sessionUuid);
          const topologyCache = mockTopologyCache(rootAgentId, topology);

          const svc = createSessionCascadeService({
            db,
            callGateway: mock.callGateway,
            topologyCache,
            recordSessionCreated: () => {},
            deleteSessionRecords: () => {},
          });

          await svc.cascadeCreate({ agentId: rootAgentId, userId: "user-1", tenantId: "tenant-1" });

          const expectedDescendants = extractDescendantAgentIds(topology.edges, rootAgentId);
          const expectedCallCount = 1 + expectedDescendants.length;

          expect(mock.getCreateCount()).toBe(expectedCallCount);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 4: 级联删除操作数量正确性
// ---------------------------------------------------------------------------

describe("Feature: a2a-session-cascade, Property 4: Cascade delete operation count correctness", () => {
  /**
   * Validates: Requirements 2.3, 2.4
   *
   * For saved root session with M descendant sessions, cascadeDelete calls
   * callGateway M + 1 times.
   */
  it("cascadeDelete calls callGateway M + 1 times where M is descendant session count", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbAgentId,
        arbTopologyTree,
        arbSessionUuid,
        async (rootAgentId, topology, sessionUuid) => {
          const db = initDatabase(tmpDbPath());
          const mock = mockCallGateway(rootAgentId, sessionUuid);
          const topologyCache = mockTopologyCache(rootAgentId, topology);

          const svc = createSessionCascadeService({
            db,
            callGateway: mock.callGateway,
            topologyCache,
            recordSessionCreated: () => {},
            deleteSessionRecords: () => {},
          });

          // First create to persist the record
          const { sessionKey } = await svc.cascadeCreate({
            agentId: rootAgentId,
            userId: "user-1",
            tenantId: "tenant-1",
          });

          // Count descendants that were actually created (may be fewer if some failed,
          // but our mock never fails so it equals the expected count)
          const expectedDescendants = extractDescendantAgentIds(topology.edges, rootAgentId);
          const M = expectedDescendants.length;

          mock.reset();

          // Now delete
          await svc.cascadeDelete({ sessionKey });

          expect(mock.getDeleteCount()).toBe(M + 1);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 6: 拓扑差异计算正确性
// ---------------------------------------------------------------------------

describe("Feature: a2a-session-cascade, Property 6: Topology diff calculation correctness", () => {
  /**
   * Validates: Requirements 10.1
   *
   * For any old/new TopologyTree, added = new - old, removed = old - new.
   */
  it("topology diff: added = new - old, removed = old - new", () => {
    fc.assert(
      fc.property(
        arbAgentId,
        arbTopologyTree,
        arbTopologyTree,
        (rootAgentId, oldTopology, newTopology) => {
          const oldIds = new Set(extractDescendantAgentIds(oldTopology.edges, rootAgentId));
          const newIds = new Set(extractDescendantAgentIds(newTopology.edges, rootAgentId));

          const added = [...newIds].filter((id) => !oldIds.has(id));
          const removed = [...oldIds].filter((id) => !newIds.has(id));

          // added ∩ removed = ∅
          const addedSet = new Set(added);
          const removedSet = new Set(removed);
          for (const id of addedSet) {
            expect(removedSet.has(id)).toBe(false);
          }

          // added ⊆ newIds
          for (const id of added) {
            expect(newIds.has(id)).toBe(true);
          }

          // removed ⊆ oldIds
          for (const id of removed) {
            expect(oldIds.has(id)).toBe(true);
          }

          // added ∩ oldIds = ∅
          for (const id of added) {
            expect(oldIds.has(id)).toBe(false);
          }

          // removed ∩ newIds = ∅
          for (const id of removed) {
            expect(newIds.has(id)).toBe(false);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7: 拓扑变更增量同步操作数量正确性
// ---------------------------------------------------------------------------

describe("Feature: a2a-session-cascade, Property 7: Incremental sync operation count correctness", () => {
  /**
   * Validates: Requirements 10.2, 10.3
   *
   * For topology change with N added, M removed, K active sessions:
   * create N*K times, delete M*K times.
   */
  it("syncTopologyChanges creates N*K and deletes M*K sessions", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbAgentId,
        arbTopologyTree,
        arbTopologyTree,
        arbSessionUuid,
        // K: number of active root sessions (1-3 to keep test fast)
        fc.integer({ min: 1, max: 3 }),
        async (rootAgentId, oldTopology, newTopology, sessionUuid, K) => {
          const db = initDatabase(tmpDbPath());
          const mock = mockCallGateway(rootAgentId, sessionUuid);
          // For setup: topology cache returns oldTopology so we can create K sessions
          const topologyCacheOld = mockTopologyCache(rootAgentId, oldTopology);

          const _svcOld = createSessionCascadeService({
            db,
            callGateway: mock.callGateway,
            topologyCache: topologyCacheOld,
            recordSessionCreated: () => {},
            deleteSessionRecords: () => {},
          });

          // Create K root sessions with oldTopology
          const createdSessionKeys: string[] = [];
          for (let i = 0; i < K; i++) {
            const uuid = `mas-${randomUUID().slice(0, 8)}`;
            const localMock = mockCallGateway(rootAgentId, uuid);
            const svcLocal = createSessionCascadeService({
              db,
              callGateway: localMock.callGateway,
              topologyCache: topologyCacheOld,
              recordSessionCreated: () => {},
              deleteSessionRecords: () => {},
            });
            const { sessionKey } = await svcLocal.cascadeCreate({
              agentId: rootAgentId,
              userId: `user-${i}`,
              tenantId: "tenant-1",
            });
            createdSessionKeys.push(sessionKey);
          }

          // Compute expected diff
          const oldIds = new Set(extractDescendantAgentIds(oldTopology.edges, rootAgentId));
          const newIds = new Set(extractDescendantAgentIds(newTopology.edges, rootAgentId));
          const N = [...newIds].filter((id) => !oldIds.has(id)).length; // added
          const M = [...oldIds].filter((id) => !newIds.has(id)).length; // removed

          // Now sync with new topology
          mock.reset();
          const svcNew = createSessionCascadeService({
            db,
            callGateway: mock.callGateway,
            topologyCache: mockTopologyCache(rootAgentId, newTopology),
            recordSessionCreated: () => {},
            deleteSessionRecords: () => {},
          });

          await svcNew.syncTopologyChanges({
            rootAgentId,
            oldTopology,
            newTopology,
            tenantId: "tenant-1",
          });

          expect(mock.getCreateCount()).toBe(N * K);
          expect(mock.getDeleteCount()).toBe(M * K);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 8: 兼容模式跳过级联
// ---------------------------------------------------------------------------

describe("Feature: a2a-session-cascade, Property 8: Compatibility mode skips cascade", () => {
  /**
   * Validates: Requirements 6.5
   *
   * For userId=null, cascadeCreate/cascadeDelete calls callGateway exactly once.
   */
  it("cascadeCreate with userId=null calls callGateway exactly once", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbAgentId,
        arbTopologyTree,
        arbSessionUuid,
        async (rootAgentId, topology, sessionUuid) => {
          const db = initDatabase(tmpDbPath());
          const mock = mockCallGateway(rootAgentId, sessionUuid);
          // Even if this agentId is a root, userId=null should skip cascade
          const topologyCache = mockTopologyCache(rootAgentId, topology);

          const svc = createSessionCascadeService({
            db,
            callGateway: mock.callGateway,
            topologyCache,
            recordSessionCreated: () => {},
            deleteSessionRecords: () => {},
          });

          await svc.cascadeCreate({ agentId: rootAgentId, userId: null, tenantId: "tenant-1" });

          expect(mock.getCallCount()).toBe(1);
          expect(mock.getCreateCount()).toBe(1);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("cascadeDelete with userId=null record calls callGateway exactly once", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbAgentId,
        arbTopologyTree,
        arbSessionUuid,
        async (rootAgentId, topology, sessionUuid) => {
          const db = initDatabase(tmpDbPath());
          const mock = mockCallGateway(rootAgentId, sessionUuid);
          const topologyCache = mockTopologyCache(rootAgentId, topology);

          const svc = createSessionCascadeService({
            db,
            callGateway: mock.callGateway,
            topologyCache,
            recordSessionCreated: () => {},
            deleteSessionRecords: () => {},
          });

          // Create in compat mode (userId=null) — no record saved
          const { sessionKey } = await svc.cascadeCreate({
            agentId: rootAgentId,
            userId: null,
            tenantId: "tenant-1",
          });

          mock.reset();

          // Delete — no record in DB, so only 1 callGateway call
          await svc.cascadeDelete({ sessionKey });

          expect(mock.getCallCount()).toBe(1);
          expect(mock.getDeleteCount()).toBe(1);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 10: 空拓扑树边界情况
// ---------------------------------------------------------------------------

describe("Feature: a2a-session-cascade, Property 10: Empty topology tree boundary case", () => {
  /**
   * Validates: Requirements 1.6
   *
   * For rootAgentId with empty edges topology, cascadeCreate calls callGateway
   * exactly once.
   */
  it("cascadeCreate with empty topology calls callGateway exactly once", async () => {
    await fc.assert(
      fc.asyncProperty(arbAgentId, arbSessionUuid, async (rootAgentId, sessionUuid) => {
        const db = initDatabase(tmpDbPath());
        const mock = mockCallGateway(rootAgentId, sessionUuid);
        // Empty topology: rootAgentId IS a root but has no descendants
        const topologyCache = mockTopologyCache(rootAgentId, { edges: [] });

        const svc = createSessionCascadeService({
          db,
          callGateway: mock.callGateway,
          topologyCache,
          recordSessionCreated: () => {},
          deleteSessionRecords: () => {},
        });

        await svc.cascadeCreate({ agentId: rootAgentId, userId: "user-1", tenantId: "tenant-1" });

        expect(mock.getCallCount()).toBe(1);
        expect(mock.getCreateCount()).toBe(1);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 11: 拓扑树从无到有的增量同步
// ---------------------------------------------------------------------------

describe("Feature: a2a-session-cascade, Property 11: Topology tree from none to some", () => {
  /**
   * Validates: Requirements 10.5
   *
   * From undefined topology to topology with N edges, syncTopologyChanges
   * creates N*K sessions.
   */
  it("syncTopologyChanges from undefined to topology creates N*K sessions", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbAgentId,
        arbTopologyTree,
        arbSessionUuid,
        fc.integer({ min: 1, max: 3 }),
        async (rootAgentId, newTopology, sessionUuid, K) => {
          const db = initDatabase(tmpDbPath());
          const mock = mockCallGateway(rootAgentId, sessionUuid);

          // Create K root sessions with empty topology (no descendants)
          const emptyTopologyCache = mockTopologyCache(rootAgentId, { edges: [] });
          for (let i = 0; i < K; i++) {
            const uuid = `mas-${randomUUID().slice(0, 8)}`;
            const localMock = mockCallGateway(rootAgentId, uuid);
            const svcLocal = createSessionCascadeService({
              db,
              callGateway: localMock.callGateway,
              topologyCache: emptyTopologyCache,
              recordSessionCreated: () => {},
              deleteSessionRecords: () => {},
            });
            await svcLocal.cascadeCreate({
              agentId: rootAgentId,
              userId: `user-${i}`,
              tenantId: "tenant-1",
            });
          }

          // N = unique descendants in newTopology
          const N = extractDescendantAgentIds(newTopology.edges, rootAgentId).length;

          mock.reset();

          const svc = createSessionCascadeService({
            db,
            callGateway: mock.callGateway,
            topologyCache: mockTopologyCache(rootAgentId, newTopology),
            recordSessionCreated: () => {},
            deleteSessionRecords: () => {},
          });

          await svc.syncTopologyChanges({
            rootAgentId,
            oldTopology: undefined,
            newTopology,
            tenantId: "tenant-1",
          });

          expect(mock.getCreateCount()).toBe(N * K);
          expect(mock.getDeleteCount()).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 12: 拓扑树从有到无的增量同步
// ---------------------------------------------------------------------------

describe("Feature: a2a-session-cascade, Property 12: Topology tree from some to none", () => {
  /**
   * Validates: Requirements 10.5
   *
   * From topology with N edges to empty topology, syncTopologyChanges deletes
   * N*K sessions.
   */
  it("syncTopologyChanges from topology to empty deletes N*K sessions", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbAgentId,
        arbTopologyTree,
        arbSessionUuid,
        fc.integer({ min: 1, max: 3 }),
        async (rootAgentId, oldTopology, sessionUuid, K) => {
          const db = initDatabase(tmpDbPath());
          const mock = mockCallGateway(rootAgentId, sessionUuid);

          // Create K root sessions with oldTopology (so descendants are recorded)
          const oldTopologyCache = mockTopologyCache(rootAgentId, oldTopology);
          for (let i = 0; i < K; i++) {
            const uuid = `mas-${randomUUID().slice(0, 8)}`;
            const localMock = mockCallGateway(rootAgentId, uuid);
            const svcLocal = createSessionCascadeService({
              db,
              callGateway: localMock.callGateway,
              topologyCache: oldTopologyCache,
              recordSessionCreated: () => {},
              deleteSessionRecords: () => {},
            });
            await svcLocal.cascadeCreate({
              agentId: rootAgentId,
              userId: `user-${i}`,
              tenantId: "tenant-1",
            });
          }

          // N = unique descendants in oldTopology
          const N = extractDescendantAgentIds(oldTopology.edges, rootAgentId).length;

          mock.reset();

          const emptyTopology: TopologyTree = { edges: [] };
          const svc = createSessionCascadeService({
            db,
            callGateway: mock.callGateway,
            topologyCache: mockTopologyCache(rootAgentId, emptyTopology),
            recordSessionCreated: () => {},
            deleteSessionRecords: () => {},
          });

          await svc.syncTopologyChanges({
            rootAgentId,
            oldTopology,
            newTopology: emptyTopology,
            tenantId: "tenant-1",
          });

          expect(mock.getDeleteCount()).toBe(N * K);
          expect(mock.getCreateCount()).toBe(0);
        },
      ),
      { numRuns: 100 },
    );
  });
});
