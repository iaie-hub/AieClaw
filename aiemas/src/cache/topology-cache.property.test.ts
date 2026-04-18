/**
 * Property-based tests for topology-cache.
 *
 * Feature: agent-topology-dag
 * Property 4: 子节点索引正确性
 *
 * Validates: Requirements 5.2, 5.4, 5.5
 */

import * as fc from "fast-check";
import { describe, it, expect } from "vitest";
import { TopologyCache } from "./topology-cache.js";

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

/** 生成合法的 TopologyTree（edges 中无自引用边） */
const arbTopologyTree = fc
  .array(arbEdge, { minLength: 0, maxLength: 10 })
  .map((edges) => ({ edges }));

// ---------------------------------------------------------------------------
// Property 4: 子节点索引正确性
// Validates: Requirements 5.2, 5.4, 5.5
// ---------------------------------------------------------------------------

describe("Feature: agent-topology-dag, Property 4: Children index correctness", () => {
  it("getChildren returns exactly the to-values for each from-agentId in edges", () => {
    fc.assert(
      fc.property(arbAgentId, arbTopologyTree, (rootAgentId, topology) => {
        // Fresh cache per iteration to avoid cross-iteration pollution
        const cache = new TopologyCache();
        cache.update(rootAgentId, topology);

        // Build expected children map from edges
        const expectedChildren = new Map<string, string[]>();
        for (const edge of topology.edges) {
          let children = expectedChildren.get(edge.from);
          if (!children) {
            children = [];
            expectedChildren.set(edge.from, children);
          }
          children.push(edge.to);
        }

        // Verify: for each from-agentId, getChildren returns the correct to-values
        for (const [agentId, expected] of expectedChildren) {
          const actual = cache.getChildren(agentId);
          expect([...actual].toSorted()).toEqual([...expected].toSorted());
        }
      }),
      { numRuns: 100 },
    );
  });

  it("getChildren returns empty array for agentIds not in any from field", () => {
    fc.assert(
      fc.property(
        arbAgentId,
        arbTopologyTree,
        arbAgentId,
        (rootAgentId, topology, extraAgentId) => {
          // Fresh cache per iteration to avoid cross-iteration pollution
          const cache = new TopologyCache();
          cache.update(rootAgentId, topology);

          // Collect all agentIds that appear in from fields
          const fromIds = new Set(topology.edges.map((e) => e.from));

          // If extraAgentId is not in any from field, getChildren should return []
          if (!fromIds.has(extraAgentId)) {
            expect(cache.getChildren(extraAgentId)).toEqual([]);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 5: 缓存与数据库一致性
// Validates: Requirements 3.3, 5.3
// ---------------------------------------------------------------------------

describe("Feature: agent-topology-dag, Property 5: Cache-DB consistency", () => {
  /**
   * **Validates: Requirements 3.3, 5.3**
   *
   * After calling `update(rootAgentId, topology)`, `getTopology(rootAgentId)`
   * must return a value semantically equivalent to the input topology
   * (same edge set, order-independent).
   */
  it("After update, getTopology returns semantically equivalent topology", () => {
    fc.assert(
      fc.property(arbAgentId, arbTopologyTree, (rootAgentId, topology) => {
        const cache = new TopologyCache();
        cache.update(rootAgentId, topology);

        const result = cache.getTopology(rootAgentId);
        expect(result).toBeDefined();

        // Normalize edges to a comparable set representation (sorted pairs)
        const normalize = (edges: Array<{ from: string; to: string }>) =>
          edges.map((e) => `${e.from}->${e.to}`).sort();

        expect(normalize(result!.edges)).toEqual(normalize(topology.edges));
      }),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.3, 5.3**
   *
   * After calling `update(rootAgentId, topology)`, `getChildren` for every
   * agentId appearing in the topology's edges must return values consistent
   * with directly computing children from the edges array.
   */
  it("After update, getChildren is consistent with edges for all involved agentIds", () => {
    fc.assert(
      fc.property(arbAgentId, arbTopologyTree, (rootAgentId, topology) => {
        const cache = new TopologyCache();
        cache.update(rootAgentId, topology);

        // Build expected children map directly from edges
        const expectedChildren = new Map<string, string[]>();
        for (const edge of topology.edges) {
          let children = expectedChildren.get(edge.from);
          if (!children) {
            children = [];
            expectedChildren.set(edge.from, children);
          }
          children.push(edge.to);
        }

        // Collect all unique agentIds mentioned in edges (both from and to)
        const allAgentIds = new Set<string>();
        for (const edge of topology.edges) {
          allAgentIds.add(edge.from);
          allAgentIds.add(edge.to);
        }

        // Verify getChildren for every involved agentId
        for (const agentId of allAgentIds) {
          const actual = cache.getChildren(agentId);
          const expected = expectedChildren.get(agentId) ?? [];
          expect([...actual].toSorted()).toEqual([...expected].toSorted());
        }
      }),
      { numRuns: 100 },
    );
  });
});
