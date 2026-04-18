/**
 * In-memory topology cache for the aiemas TenantService.
 *
 * Maintains two indexes:
 * 1. `byRoot`: rootAgentId → full TopologyTree document
 * 2. `childrenIndex`: any agentId → direct child agent IDs (across ALL topologies)
 *
 * Loaded from the database on init(); kept in sync via `update()` after every
 * topology save. The childrenIndex enables O(1) child lookup for any agent
 * during `sessions_send` routing.
 *
 * Thread-safety: Node.js is single-threaded, so Map operations are atomic.
 */

import type { DatabaseSync } from "node:sqlite";
import type { TopologyTree } from "../models.js";
import { loadAllTopologies } from "../store/topology-store.js";

export class TopologyCache {
  /** Complete topology tree index: rootAgentId → TopologyTree */
  private readonly byRoot = new Map<string, TopologyTree>();
  /** Children index: agentId → direct child Agent ID list (across all topologies) */
  private readonly childrenIndex = new Map<string, string[]>();

  // ── Load ──────────────────────────────────────────────────────────────────

  /**
   * Populate the cache from the database.
   * Called once during CacheService.init().
   */
  load(db: DatabaseSync): void {
    this.byRoot.clear();
    this.childrenIndex.clear();

    const rows = loadAllTopologies(db);
    for (const { rootAgentId, topology } of rows) {
      this.byRoot.set(rootAgentId, topology);
    }
    this.rebuildChildrenIndex();
    console.log(`[mas4s:topology-cache] loaded ${this.byRoot.size} topology tree(s)`);
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  /** Get the full topology tree for a given root agent. */
  getTopology(rootAgentId: string): TopologyTree | undefined {
    return this.byRoot.get(rootAgentId);
  }

  /** Get direct children of any agent. Returns empty array if not found. */
  getChildren(agentId: string): string[] {
    return this.childrenIndex.get(agentId) ?? [];
  }

  // ── Writes ────────────────────────────────────────────────────────────────

  /** Update a single topology tree and rebuild the entire children index. */
  update(rootAgentId: string, topology: TopologyTree): void {
    this.byRoot.set(rootAgentId, topology);
    this.rebuildChildrenIndex();
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /**
   * Rebuild the entire childrenIndex from scratch by iterating all
   * topologies in byRoot. This ensures consistency when any single
   * topology is added, updated, or removed.
   */
  private rebuildChildrenIndex(): void {
    this.childrenIndex.clear();
    for (const topology of this.byRoot.values()) {
      for (const edge of topology.edges) {
        let children = this.childrenIndex.get(edge.from);
        if (!children) {
          children = [];
          this.childrenIndex.set(edge.from, children);
        }
        children.push(edge.to);
      }
    }
  }
}
