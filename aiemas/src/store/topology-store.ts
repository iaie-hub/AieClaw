import type { DatabaseSync } from "node:sqlite";
import type { TopologyTree } from "../models.js";

/** 校验 edges 合法性：无自引用边 */
export function validateEdges(edges: Array<{ from: string; to: string }>): {
  valid: boolean;
  message?: string;
} {
  for (const edge of edges) {
    if (edge.from === edge.to) {
      return { valid: false, message: "自引用边不允许" };
    }
  }
  return { valid: true };
}

/** 加载指定根节点的拓扑树 */
export function loadTopology(db: DatabaseSync, rootAgentId: string): TopologyTree | undefined {
  const row = db
    .prepare("SELECT topology FROM agent_topologies WHERE rootAgentId = ?")
    .get(rootAgentId) as { topology: string } | undefined;
  if (!row) {
    return undefined;
  }
  return JSON.parse(row.topology) as TopologyTree;
}

/** 加载所有拓扑树 */
export function loadAllTopologies(
  db: DatabaseSync,
): Array<{ rootAgentId: string; topology: TopologyTree }> {
  const rows = db.prepare("SELECT rootAgentId, topology FROM agent_topologies").all() as Array<{
    rootAgentId: string;
    topology: string;
  }>;
  return rows.map((row) => ({
    rootAgentId: row.rootAgentId,
    topology: JSON.parse(row.topology) as TopologyTree,
  }));
}

/** 保存拓扑树（INSERT OR REPLACE） */
export function saveTopology(db: DatabaseSync, rootAgentId: string, topology: TopologyTree): void {
  db.prepare(
    "INSERT OR REPLACE INTO agent_topologies (rootAgentId, topology, updatedAt) VALUES (?, ?, ?)",
  ).run(rootAgentId, JSON.stringify(topology), Date.now());
}
