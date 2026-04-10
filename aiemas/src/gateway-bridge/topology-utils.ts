/**
 * Topology utility functions for A2A Session cascade operations.
 * Provides helpers for extracting descendant agent IDs from topology edges
 * and parsing session UUIDs from session keys.
 */

/**
 * 从拓扑树的 edges 中提取所有后代 Agent ID
 * 返回所有唯一的 agentId（from 和 to 字段的并集），排除 rootAgentId
 *
 * @param edges - 拓扑树的边列表
 * @param rootAgentId - 根 Agent ID，需要从结果中排除
 * @returns 所有后代 Agent ID 的数组（唯一值，已排序）
 *
 * @example
 * const edges = [
 *   { from: "root", to: "child1" },
 *   { from: "root", to: "child2" },
 *   { from: "child1", to: "grandchild" }
 * ];
 * extractDescendantAgentIds(edges, "root");
 * // => ["child1", "child2", "grandchild"]
 */
export function extractDescendantAgentIds(
  edges: Array<{ from: string; to: string }>,
  rootAgentId: string,
): string[] {
  if (!edges || edges.length === 0) {
    return [];
  }

  // 使用 Set 收集所有唯一的 agentId（from 和 to 字段的并集）
  const agentIds = new Set<string>();

  for (const edge of edges) {
    if (edge.from && edge.from !== rootAgentId) {
      agentIds.add(edge.from);
    }
    if (edge.to && edge.to !== rootAgentId) {
      agentIds.add(edge.to);
    }
  }

  // 转换为数组并排序以保证确定性
  return Array.from(agentIds).toSorted();
}

/**
 * 从 sessionKey 中提取 sessionUuid
 * sessionKey 格式: agent:{agentId}:group:{sessionUuid}
 * 返回 sessionUuid（第四部分）
 *
 * @param sessionKey - 会话密钥，格式为 agent:{agentId}:group:{sessionUuid}
 * @returns 提取的 sessionUuid，如果格式错误则返回空字符串
 *
 * @example
 * extractSessionUuid("agent:aie-iaas:group:mas-d4548844");
 * // => "mas-d4548844"
 *
 * @example
 * extractSessionUuid("agent:aieiaas-resource:group:mas-d4548844");
 * // => "mas-d4548844"
 */
export function extractSessionUuid(sessionKey: string): string {
  if (!sessionKey || typeof sessionKey !== "string") {
    return "";
  }

  const parts = sessionKey.split(":");
  // sessionKey 格式: agent:{agentId}:group:{sessionUuid}
  // parts = ["agent", "{agentId}", "group", "{sessionUuid}"]
  // 需要返回第四部分（索引 3）
  if (parts.length >= 4) {
    return parts[3] || "";
  }

  return "";
}
