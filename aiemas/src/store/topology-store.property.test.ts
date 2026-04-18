/**
 * Property-based tests for topology-store.
 *
 * Feature: agent-topology-dag
 * Property 1: 自引用边校验
 *
 * Validates: Requirements 1.3, 3.4
 */

import * as fc from "fast-check";
import { describe, it, expect } from "vitest";
import { validateEdges } from "./topology-store.js";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** 非空字母数字字符串（模拟 agent ID） */
const arbAgentId = fc.stringMatching(/^[a-zA-Z0-9]+$/).filter((s) => s.length > 0);

/** 生成 from !== to 的合法边 */
const arbEdge = fc
  .tuple(arbAgentId, arbAgentId)
  .filter(([a, b]) => a !== b)
  .map(([from, to]) => ({ from, to }));

/** 生成 from === to 的自引用边 */
const arbSelfRefEdge = arbAgentId.map((id) => ({ from: id, to: id }));

// ---------------------------------------------------------------------------
// Property 1: 自引用边校验
// Validates: Requirements 1.3, 3.4
// ---------------------------------------------------------------------------

describe("Feature: agent-topology-dag, Property 1: Self-reference edge validation", () => {
  it("edges with from === to must fail validation", () => {
    fc.assert(
      fc.property(arbSelfRefEdge, (selfEdge) => {
        const result = validateEdges([selfEdge]);
        expect(result.valid).toBe(false);
        expect(result.message).toBeDefined();
      }),
      { numRuns: 100 },
    );
  });

  it("edges with from !== to must pass validation", () => {
    fc.assert(
      fc.property(fc.array(arbEdge, { minLength: 0, maxLength: 10 }), (edges) => {
        const result = validateEdges(edges);
        expect(result.valid).toBe(true);
        expect(result.message).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  it("mixed edges: any self-reference causes validation failure", () => {
    fc.assert(
      fc.property(
        fc.array(arbEdge, { minLength: 0, maxLength: 5 }),
        arbSelfRefEdge,
        fc.array(arbEdge, { minLength: 0, maxLength: 5 }),
        (before, selfEdge, after) => {
          const edges = [...before, selfEdge, ...after];
          const result = validateEdges(edges);
          expect(result.valid).toBe(false);
          expect(result.message).toBeDefined();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: 拓扑树保存-加载往返一致性
// Validates: Requirements 1.4, 2.2, 3.2
// ---------------------------------------------------------------------------

import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach } from "vitest";
import { createTestDatabase } from "../test-helpers/setup.js";
import { loadTopology, saveTopology, loadAllTopologies } from "./topology-store.js";

describe("Feature: agent-topology-dag, Property 2: Save-load round-trip", () => {
  let db: DatabaseSync;
  let cleanup: () => void;

  beforeEach(() => {
    const testDb = createTestDatabase();
    db = testDb.db;
    cleanup = testDb.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  /** Arbitrary for a valid TopologyTree (edges with no self-reference) */
  const arbTopologyTree = fc
    .array(arbEdge, { minLength: 0, maxLength: 10 })
    .map((edges) => ({ edges }));

  it("save then load returns semantically equivalent edges", () => {
    fc.assert(
      fc.property(arbAgentId, arbTopologyTree, (rootAgentId, topology) => {
        saveTopology(db, rootAgentId, topology);
        const loaded = loadTopology(db, rootAgentId);

        expect(loaded).toBeDefined();

        // Semantic equivalence: same set of edges (order-independent)
        const savedSet = new Set(topology.edges.map((e) => `${e.from}->${e.to}`));
        const loadedSet = new Set(loaded!.edges.map((e) => `${e.from}->${e.to}`));

        expect(loadedSet).toEqual(savedSet);
      }),
      { numRuns: 100 },
    );
  });

  it("save with empty edges then load returns empty edges", () => {
    fc.assert(
      fc.property(arbAgentId, (rootAgentId) => {
        const emptyTopology = { edges: [] };
        saveTopology(db, rootAgentId, emptyTopology);
        const loaded = loadTopology(db, rootAgentId);

        expect(loaded).toBeDefined();
        expect(loaded!.edges).toEqual([]);
      }),
      { numRuns: 100 },
    );
  });

  it("overwriting a topology replaces the previous one", () => {
    fc.assert(
      fc.property(arbAgentId, arbTopologyTree, arbTopologyTree, (rootAgentId, first, second) => {
        saveTopology(db, rootAgentId, first);
        saveTopology(db, rootAgentId, second);
        const loaded = loadTopology(db, rootAgentId);

        expect(loaded).toBeDefined();

        const savedSet = new Set(second.edges.map((e) => `${e.from}->${e.to}`));
        const loadedSet = new Set(loaded!.edges.map((e) => `${e.from}->${e.to}`));

        expect(loadedSet).toEqual(savedSet);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: 全量列表完整性
// Validates: Requirements 2.3
// ---------------------------------------------------------------------------

describe("Feature: agent-topology-dag, Property 3: List all completeness", () => {
  let db: DatabaseSync;
  let cleanup: () => void;

  beforeEach(() => {
    const testDb = createTestDatabase();
    db = testDb.db;
    cleanup = testDb.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  /** Arbitrary for a valid TopologyTree (edges with no self-reference) */
  const arbTopologyTree = fc
    .array(arbEdge, { minLength: 0, maxLength: 10 })
    .map((edges) => ({ edges }));

  it("loadAllTopologies returns exactly the saved rootAgentIds with matching topologies", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(arbAgentId, { minLength: 1, maxLength: 5 }),
        fc.array(arbTopologyTree, { minLength: 5, maxLength: 5 }),
        (rootIds, topologies) => {
          // Clear table before each iteration to avoid cross-iteration pollution
          db.prepare("DELETE FROM agent_topologies").run();

          // Pair each unique rootAgentId with a topology (trim topologies to match rootIds length)
          const pairs = rootIds.map((id, i) => ({
            rootAgentId: id,
            topology: topologies[i % topologies.length],
          }));

          // Save all pairs
          for (const pair of pairs) {
            saveTopology(db, pair.rootAgentId, pair.topology);
          }

          // Load all topologies
          const loaded = loadAllTopologies(db);

          // Verify: returned list contains exactly the saved rootAgentIds
          const savedIds = new Set(pairs.map((p) => p.rootAgentId));
          const loadedIds = new Set(loaded.map((r) => r.rootAgentId));
          expect(loadedIds).toEqual(savedIds);

          // Verify: each rootAgentId's topology matches the last saved value
          for (const pair of pairs) {
            const found = loaded.find((r) => r.rootAgentId === pair.rootAgentId);
            expect(found).toBeDefined();

            const savedEdgeSet = new Set(pair.topology.edges.map((e) => `${e.from}->${e.to}`));
            const loadedEdgeSet = new Set(found!.topology.edges.map((e) => `${e.from}->${e.to}`));
            expect(loadedEdgeSet).toEqual(savedEdgeSet);
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  it("overwriting some rootAgentIds still returns correct final state", () => {
    fc.assert(
      fc.property(
        fc.uniqueArray(arbAgentId, { minLength: 1, maxLength: 5 }),
        fc.array(arbTopologyTree, { minLength: 5, maxLength: 5 }),
        fc.array(arbTopologyTree, { minLength: 5, maxLength: 5 }),
        (rootIds, firstTopologies, secondTopologies) => {
          // Clear table before each iteration to avoid cross-iteration pollution
          db.prepare("DELETE FROM agent_topologies").run();

          // Save initial topologies
          for (let i = 0; i < rootIds.length; i++) {
            saveTopology(db, rootIds[i], firstTopologies[i % firstTopologies.length]);
          }

          // Overwrite all with second set of topologies
          for (let i = 0; i < rootIds.length; i++) {
            saveTopology(db, rootIds[i], secondTopologies[i % secondTopologies.length]);
          }

          const loaded = loadAllTopologies(db);

          // Same set of rootAgentIds
          const expectedIds = new Set(rootIds);
          const loadedIds = new Set(loaded.map((r) => r.rootAgentId));
          expect(loadedIds).toEqual(expectedIds);

          // Each topology matches the LAST saved value
          for (let i = 0; i < rootIds.length; i++) {
            const lastTopology = secondTopologies[i % secondTopologies.length];
            const found = loaded.find((r) => r.rootAgentId === rootIds[i]);
            expect(found).toBeDefined();

            const savedEdgeSet = new Set(lastTopology.edges.map((e) => `${e.from}->${e.to}`));
            const loadedEdgeSet = new Set(found!.topology.edges.map((e) => `${e.from}->${e.to}`));
            expect(loadedEdgeSet).toEqual(savedEdgeSet);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
