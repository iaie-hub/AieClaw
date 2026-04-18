import type { AgentEntry } from "../types/agents-types.js";

/** A node placed on the canvas with absolute position. */
export interface CanvasNode {
  id: string;
  name: string;
  x: number;
  y: number;
}

/** Directed edge between agents. */
export interface TopologyEdge {
  from: string;
  to: string;
}

// ── Layout constants ─────────────────────────────────────────────────────────

export const NODE_W = 180;
export const NODE_H = 56;
export const NODE_RX = 10;
export const PORT_R = 7;
export const SNAP_R = 28;
export const GRID_SIZE = 20;
export const CANVAS_W = 3000;
export const CANVAS_H = 2000;

/**
 * Build canvas nodes from edges using BFS layered layout.
 * Root node is horizontally centered within the canvas viewport.
 */
export function buildCanvasNodes(
  rootId: string,
  agents: AgentEntry[],
  edges: TopologyEdge[],
  minWidth = 800,
): { nodes: CanvasNode[]; canvasWidth: number } {
  const agentMap = new Map<string, AgentEntry>();
  for (const a of agents) {
    agentMap.set(a.id, a);
  }

  const nodeIds = new Set<string>([rootId]);
  for (const e of edges) {
    nodeIds.add(e.from);
    nodeIds.add(e.to);
  }

  // BFS layered layout
  const children = new Map<string, string[]>();
  for (const e of edges) {
    const list = children.get(e.from) ?? [];
    list.push(e.to);
    children.set(e.from, list);
  }
  const layerOf = new Map<string, number>();
  const queue: string[] = [rootId];
  layerOf.set(rootId, 0);
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const ch of children.get(cur) ?? []) {
      if (!layerOf.has(ch)) {
        layerOf.set(ch, (layerOf.get(cur) ?? 0) + 1);
        queue.push(ch);
      }
    }
  }
  let maxL = 0;
  for (const l of layerOf.values()) {
    if (l > maxL) {
      maxL = l;
    }
  }
  for (const id of nodeIds) {
    if (!layerOf.has(id)) {
      layerOf.set(id, maxL + 1);
    }
  }

  const layers = new Map<number, string[]>();
  for (const [id, l] of layerOf) {
    const arr = layers.get(l) ?? [];
    arr.push(id);
    layers.set(l, arr);
  }

  const hSpacing = NODE_W + 60;
  const vSpacing = NODE_H + 80;

  // Find widest layer to center all layers relative to it
  let maxLayerCount = 0;
  for (const ids of layers.values()) {
    if (ids.length > maxLayerCount) {
      maxLayerCount = ids.length;
    }
  }
  const maxLayerW = maxLayerCount * hSpacing;
  // Compute an adaptive canvas width based on the widest layer, with a sane minimum.
  const canvasWidth = Math.max(minWidth, maxLayerW + 120);
  // Anchor point: center the widest layer within the computed canvas width.
  const anchorX = Math.max(60, Math.floor((canvasWidth - maxLayerW) / 2));

  const nodes: CanvasNode[] = [];
  for (const [layer, ids] of layers) {
    const layerW = ids.length * hSpacing;
    const offsetX = anchorX + (maxLayerW - layerW) / 2;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      const a = agentMap.get(id);
      nodes.push({
        id,
        name: a?.name ?? id,
        x: offsetX + i * hSpacing,
        y: 60 + layer * vSpacing,
      });
    }
  }
  return { nodes, canvasWidth };
}
