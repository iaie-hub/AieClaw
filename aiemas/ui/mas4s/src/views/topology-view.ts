import { LitElement, html, css, svg, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { fetchAgents, fetchTopology, saveTopology } from "../gateway/agents-api.js";
import { getClient } from "../gateway/client.js";
import type { AgentEntry } from "../types/agents-types.js";

/** Computed node for SVG rendering */
interface LayoutNode {
  id: string;
  name: string;
  x: number;
  y: number;
}

/** Directed edge between agents */
interface TopologyEdge {
  from: string;
  to: string;
}

/** Route metadata attached to an edge */
interface RouteConfig {
  intentKeywords: string[];
  timeout: number;
}

/* Layout constants */
const NODE_W = 140;
const NODE_H = 40;
const H_SPACING = 180;
const V_SPACING = 100;
const NODE_RX = 8;
const PADDING_TOP = 80;
const PADDING_LEFT = 40;
const SNAP_RADIUS = 24;

/**
 * topology-view — SVG DAG visualization of agent topology.
 *
 * Features:
 * - Agent Palette sidebar (drag agents onto canvas)
 * - Drag & Drop with ghost preview
 * - Bezier curve edge linking with magnetic snap
 * - Route configuration panel per edge
 */
@customElement("topology-view")
export class TopologyView extends LitElement {
  @property({ type: Object }) agent!: AgentEntry;

  @state() private _loading = true;
  @state() private _error = "";
  @state() private _editing = false;
  @state() private _agents: AgentEntry[] = [];
  @state() private _edges: TopologyEdge[] = [];
  @state() private _nodes: LayoutNode[] = [];

  /* ── Edit mode state ── */
  @state() private _editEdges: TopologyEdge[] = [];
  @state() private _selectedEdgeIdx = -1;
  @state() private _dragging = false;
  @state() private _dragFrom = "";
  @state() private _dragX = 0;
  @state() private _dragY = 0;
  @state() private _toastMsg = "";
  @state() private _toastError = false;
  @state() private _saving = false;

  /* ── Palette drag state ── */
  @state() private _paletteDragging = false;
  @state() private _paletteDragAgent: AgentEntry | null = null;
  @state() private _paletteDragGhostX = 0;
  @state() private _paletteDragGhostY = 0;
  @state() private _paletteOverCanvas = false;

  /* ── Edge snap state ── */
  @state() private _snapTarget = "";

  /* ── Route config panel state ── */
  @state() private _routeConfigs: Map<string, RouteConfig> = new Map();
  @state() private _routePanelOpen = false;
  @state() private _routePanelEdgeKey = "";

  /* ── Palette search ── */
  @state() private _paletteSearch = "";

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      height: 100%;
      background: #f8fafc;
      overflow: hidden;
    }

    .toolbar {
      flex-shrink: 0;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 24px;
      background: white;
      border-bottom: 1px solid #e8edf5;
    }

    .toolbar-left,
    .toolbar-right {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .toolbar-title {
      font-size: 16px;
      font-weight: 600;
      color: #1e293b;
    }

    .btn-back {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 6px 14px;
      background: #f1f5f9;
      color: #475569;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      font-size: 13px;
      cursor: pointer;
      transition: background 0.2s;
    }
    .btn-back:hover {
      background: #e2e8f0;
    }

    .btn-edit {
      padding: 6px 14px;
      background: linear-gradient(135deg, #3b82f6 0%, #6366f1 100%);
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    .btn-edit:hover {
      opacity: 0.9;
    }

    /* ── Main body: sidebar + canvas ── */
    .body {
      flex: 1;
      display: flex;
      overflow: hidden;
      position: relative;
    }

    /* ── Agent Palette Sidebar ── */
    .palette {
      width: 250px;
      flex-shrink: 0;
      background: white;
      border-right: 1px solid #e8edf5;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .palette-header {
      padding: 14px 16px 10px;
      font-size: 13px;
      font-weight: 600;
      color: #475569;
      border-bottom: 1px solid #f1f5f9;
    }

    .palette-search {
      margin: 8px 12px;
      padding: 6px 10px;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      font-size: 12px;
      outline: none;
      transition: border-color 0.2s;
    }
    .palette-search:focus {
      border-color: #3b82f6;
    }

    .palette-list {
      flex: 1;
      overflow-y: auto;
      padding: 4px 12px 12px;
    }

    .palette-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      margin-bottom: 4px;
      border-radius: 6px;
      font-size: 13px;
      color: #334155;
      cursor: grab;
      border: 1px solid transparent;
      transition:
        background 0.15s,
        border-color 0.15s;
      user-select: none;
    }
    .palette-item:hover {
      background: #f1f5f9;
      border-color: #e2e8f0;
    }
    .palette-item:active {
      cursor: grabbing;
    }
    .palette-item.used {
      opacity: 0.4;
      cursor: default;
      pointer-events: none;
    }

    .palette-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }
    .palette-dot.available {
      background: #22c55e;
    }
    .palette-dot.used {
      background: #cbd5e1;
    }

    .palette-empty {
      padding: 16px;
      text-align: center;
      color: #94a3b8;
      font-size: 12px;
    }

    /* ── Canvas area ── */
    .canvas-area {
      flex: 1;
      overflow: auto;
      padding: 16px;
      position: relative;
    }

    .canvas-area svg {
      display: block;
    }

    .canvas-area.drop-active {
      background: #eff6ff;
      outline: 2px dashed #3b82f6;
      outline-offset: -4px;
    }

    /* ── Drag ghost ── */
    .drag-ghost {
      position: fixed;
      pointer-events: none;
      z-index: 1000;
      padding: 6px 16px;
      background: rgba(59, 130, 246, 0.85);
      color: white;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      white-space: nowrap;
    }

    .center-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: #94a3b8;
      text-align: center;
    }

    .error-msg {
      color: #ef4444;
      font-size: 15px;
      margin-bottom: 16px;
      max-width: 400px;
    }

    .btn-retry {
      padding: 8px 18px;
      background: #3b82f6;
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 13px;
      cursor: pointer;
    }

    .btn-save {
      padding: 6px 14px;
      background: #22c55e;
      color: white;
      border: none;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: opacity 0.2s;
    }
    .btn-save:hover {
      opacity: 0.9;
    }
    .btn-save:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .btn-cancel {
      padding: 6px 14px;
      background: #f1f5f9;
      color: #475569;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      font-size: 13px;
      cursor: pointer;
      transition: background 0.2s;
    }
    .btn-cancel:hover {
      background: #e2e8f0;
    }

    .connector {
      cursor: crosshair;
      transition: fill 0.15s;
    }
    .connector:hover {
      r: 7;
    }

    .edge-hit {
      cursor: pointer;
    }

    .toast {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      padding: 10px 24px;
      border-radius: 8px;
      font-size: 13px;
      color: white;
      z-index: 100;
      animation: toast-in 0.3s ease;
    }
    .toast-success {
      background: #22c55e;
    }
    .toast-error {
      background: #ef4444;
    }

    @keyframes toast-in {
      from {
        opacity: 0;
        transform: translateX(-50%) translateY(12px);
      }
      to {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
    }

    .delete-btn {
      cursor: pointer;
    }
    .delete-btn rect {
      transition: fill 0.15s;
    }
    .delete-btn:hover rect {
      fill: #dc2626;
    }

    /* ── Route config panel ── */
    .route-panel-overlay {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      width: 320px;
      background: white;
      border-left: 1px solid #e8edf5;
      box-shadow: -4px 0 16px rgba(0, 0, 0, 0.06);
      z-index: 50;
      display: flex;
      flex-direction: column;
      animation: slide-in 0.2s ease;
    }

    @keyframes slide-in {
      from {
        transform: translateX(100%);
      }
      to {
        transform: translateX(0);
      }
    }

    .route-panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px;
      border-bottom: 1px solid #f1f5f9;
    }

    .route-panel-title {
      font-size: 14px;
      font-weight: 600;
      color: #1e293b;
    }

    .route-panel-close {
      width: 28px;
      height: 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      border: none;
      background: #f1f5f9;
      border-radius: 6px;
      cursor: pointer;
      color: #64748b;
      font-size: 16px;
      transition: background 0.15s;
    }
    .route-panel-close:hover {
      background: #e2e8f0;
    }

    .route-panel-body {
      flex: 1;
      padding: 16px;
      overflow-y: auto;
    }

    .route-field {
      margin-bottom: 16px;
    }

    .route-label {
      display: block;
      font-size: 12px;
      font-weight: 500;
      color: #64748b;
      margin-bottom: 6px;
    }

    .route-input {
      width: 100%;
      padding: 8px 10px;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      font-size: 13px;
      outline: none;
      box-sizing: border-box;
      transition: border-color 0.2s;
    }
    .route-input:focus {
      border-color: #3b82f6;
    }

    .route-hint {
      font-size: 11px;
      color: #94a3b8;
      margin-top: 4px;
    }

    .route-edge-label {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 8px 10px;
      background: #f8fafc;
      border-radius: 6px;
      margin-bottom: 16px;
      font-size: 12px;
      color: #475569;
    }

    .route-edge-arrow {
      color: #94a3b8;
    }

    .keyword-tags {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 6px;
    }

    .keyword-tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 8px;
      background: #eff6ff;
      color: #3b82f6;
      border-radius: 4px;
      font-size: 11px;
    }

    .keyword-tag-remove {
      cursor: pointer;
      opacity: 0.6;
      transition: opacity 0.15s;
    }
    .keyword-tag-remove:hover {
      opacity: 1;
    }

    /* ── Snap indicator ── */
    .snap-ring {
      animation: snap-pulse 0.6s ease infinite alternate;
    }
    @keyframes snap-pulse {
      from {
        opacity: 0.4;
      }
      to {
        opacity: 1;
      }
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    void this._loadData();
    // Global listeners for palette drag
    this._boundPaletteMove = this._onPaletteGlobalMove.bind(this);
    this._boundPaletteUp = this._onPaletteGlobalUp.bind(this);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("mousemove", this._boundPaletteMove);
    document.removeEventListener("mouseup", this._boundPaletteUp);
  }

  private _boundPaletteMove!: (e: MouseEvent) => void;
  private _boundPaletteUp!: (e: MouseEvent) => void;

  /** Fetch agents list + topology, then compute layout. */
  private async _loadData() {
    this._loading = true;
    this._error = "";
    try {
      const client = getClient();
      await client.waitConnected();

      const [agentsPayload, topoPayload] = await Promise.all([
        fetchAgents(client),
        fetchTopology(client, this.agent.id),
      ]);

      this._agents = agentsPayload.agents;

      // Extract edges from topology response
      const topo = topoPayload as { topology?: { edges?: TopologyEdge[] } };
      this._edges = Array.isArray(topo?.topology?.edges) ? topo.topology.edges : [];

      this._computeLayout();
    } catch (err: unknown) {
      this._error = err instanceof Error ? err.message : "加载拓扑数据失败";
    } finally {
      this._loading = false;
    }
  }

  // ── Layout ──────────────────────────────────────────────────────────────────

  /**
   * Simple layered DAG layout (BFS from root).
   * Root at top center, children below, orphan nodes in a separate bottom row.
   */
  private _computeLayout() {
    const rootId = this.agent.id;
    const agentMap = new Map<string, AgentEntry>();
    for (const a of this._agents) {
      agentMap.set(a.id, a);
    }

    const activeEdges = this._activeEdges();

    // Collect all node IDs referenced in edges + root
    const nodeIds = new Set<string>([rootId]);
    for (const e of activeEdges) {
      nodeIds.add(e.from);
      nodeIds.add(e.to);
    }

    // Build adjacency (children) map
    const children = new Map<string, string[]>();
    for (const e of activeEdges) {
      const list = children.get(e.from) ?? [];
      list.push(e.to);
      children.set(e.from, list);
    }

    // BFS to assign layers
    const layerOf = new Map<string, number>();
    const queue: string[] = [rootId];
    layerOf.set(rootId, 0);

    while (queue.length > 0) {
      const cur = queue.shift()!;
      const curLayer = layerOf.get(cur)!;
      for (const child of children.get(cur) ?? []) {
        if (!layerOf.has(child)) {
          layerOf.set(child, curLayer + 1);
          queue.push(child);
        }
      }
    }

    // Nodes not reached by BFS go into an extra "orphan" layer
    let maxLayer = 0;
    for (const l of layerOf.values()) {
      if (l > maxLayer) {
        maxLayer = l;
      }
    }
    const orphanLayer = maxLayer + 1;
    for (const id of nodeIds) {
      if (!layerOf.has(id)) {
        layerOf.set(id, orphanLayer);
      }
    }

    // Group nodes by layer
    const layers = new Map<number, string[]>();
    for (const [id, layer] of layerOf) {
      const list = layers.get(layer) ?? [];
      list.push(id);
      layers.set(layer, list);
    }

    // Assign x/y positions
    const nodes: LayoutNode[] = [];
    for (const [layer, ids] of layers) {
      const totalWidth = ids.length * H_SPACING;
      const startX = PADDING_LEFT + (totalWidth > 0 ? 0 : 0);
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i];
        const agent = agentMap.get(id);
        nodes.push({
          id,
          name: agent?.name ?? id,
          x: startX + i * H_SPACING + (H_SPACING - NODE_W) / 2,
          y: PADDING_TOP + layer * V_SPACING,
        });
      }
    }

    // Center each layer horizontally relative to the widest layer
    let maxWidth = 0;
    for (const ids of layers.values()) {
      const w = ids.length * H_SPACING;
      if (w > maxWidth) {
        maxWidth = w;
      }
    }
    for (const node of nodes) {
      const layer = layerOf.get(node.id)!;
      const ids = layers.get(layer)!;
      const layerWidth = ids.length * H_SPACING;
      const offset = (maxWidth - layerWidth) / 2;
      node.x += offset;
    }

    this._nodes = nodes;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /** Dispatch topology-back event to return to agents list. */
  private _onBack() {
    this.dispatchEvent(new CustomEvent("topology-back", { bubbles: true, composed: true }));
  }

  /** Toggle editing mode — copy edges to working copy. */
  private _onEdit() {
    this._editing = true;
    this._editEdges = this._edges.map((e) => ({ ...e }));
    this._selectedEdgeIdx = -1;
    this._computeLayout();
  }

  /** Return the active edge set based on current mode. */
  private _activeEdges(): TopologyEdge[] {
    return this._editing ? this._editEdges : this._edges;
  }

  /** Discard edits and return to view mode. */
  private _onCancel() {
    this._editing = false;
    this._editEdges = [];
    this._selectedEdgeIdx = -1;
    this._dragging = false;
    this._routePanelOpen = false;
    this._computeLayout();
  }

  /** Persist edited topology via RPC. */
  private async _onSave() {
    this._saving = true;
    try {
      const client = getClient();
      await saveTopology(client, this.agent.id, { edges: this._editEdges });
      this._edges = this._editEdges.map((e) => ({ ...e }));
      this._editing = false;
      this._editEdges = [];
      this._selectedEdgeIdx = -1;
      this._routePanelOpen = false;
      this._computeLayout();
      this._showToast("保存成功", false);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "保存失败";
      this._showToast(msg, true);
    } finally {
      this._saving = false;
    }
  }

  /** Show a temporary toast notification. */
  private _showToast(msg: string, isError: boolean) {
    this._toastMsg = msg;
    this._toastError = isError;
    setTimeout(() => {
      this._toastMsg = "";
    }, 3000);
  }

  /** IDs of agents already placed on the canvas. */
  private _usedAgentIds(): Set<string> {
    const ids = new Set<string>([this.agent.id]);
    for (const e of this._activeEdges()) {
      ids.add(e.from);
      ids.add(e.to);
    }
    return ids;
  }

  /** Make a route config map key from edge endpoints. */
  private _edgeKey(from: string, to: string): string {
    return `${from}→${to}`;
  }

  // ── Edge interactions ───────────────────────────────────────────────────────

  /** Select an edge for deletion or route config. */
  private _onEdgeClick(idx: number) {
    this._selectedEdgeIdx = idx;
  }

  /** Remove the selected edge. */
  private _onDeleteEdge() {
    if (this._selectedEdgeIdx < 0 || this._selectedEdgeIdx >= this._editEdges.length) {
      return;
    }
    const edge = this._editEdges[this._selectedEdgeIdx];
    // Clean up route config for this edge
    this._routeConfigs.delete(this._edgeKey(edge.from, edge.to));
    this._editEdges = [
      ...this._editEdges.slice(0, this._selectedEdgeIdx),
      ...this._editEdges.slice(this._selectedEdgeIdx + 1),
    ];
    this._selectedEdgeIdx = -1;
    this._routePanelOpen = false;
    this._computeLayout();
  }

  /** Open route config panel for the selected edge. */
  private _onConfigEdge() {
    if (this._selectedEdgeIdx < 0) {
      return;
    }
    const edge = this._editEdges[this._selectedEdgeIdx];
    this._routePanelEdgeKey = this._edgeKey(edge.from, edge.to);
    if (!this._routeConfigs.has(this._routePanelEdgeKey)) {
      this._routeConfigs.set(this._routePanelEdgeKey, { intentKeywords: [], timeout: 30 });
    }
    this._routePanelOpen = true;
  }

  // ── Connector drag (edge linking) ──────────────────────────────────────────

  /** Start dragging from a node's output connector. */
  private _onConnectorMouseDown(nodeId: string, e: MouseEvent) {
    // Only allow edges from root (Orchestrator) to children
    if (nodeId !== this.agent.id) {
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    this._dragging = true;
    this._dragFrom = nodeId;
    this._snapTarget = "";
    const svgEl = this.renderRoot.querySelector("svg");
    if (svgEl) {
      const rect = svgEl.getBoundingClientRect();
      this._dragX = e.clientX - rect.left;
      this._dragY = e.clientY - rect.top;
    }
  }

  /** Track mouse position during drag + compute snap target. */
  private _onSvgMouseMove(e: MouseEvent) {
    if (!this._dragging) {
      return;
    }
    const svgEl = this.renderRoot.querySelector("svg");
    if (!svgEl) {
      return;
    }
    const rect = svgEl.getBoundingClientRect();
    this._dragX = e.clientX - rect.left;
    this._dragY = e.clientY - rect.top;

    // Check snap proximity to input connectors
    let closest = "";
    let closestDist = SNAP_RADIUS;
    for (const n of this._nodes) {
      if (n.id === this._dragFrom) {
        continue;
      }
      // Input connector is at top center
      const cx = n.x + NODE_W / 2;
      const cy = n.y;
      const dx = this._dragX - cx;
      const dy = this._dragY - cy;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < closestDist) {
        closestDist = dist;
        closest = n.id;
      }
    }
    this._snapTarget = closest;
  }

  /** Complete drag on a target node — create edge if valid. */
  private _onNodeMouseUp(nodeId: string) {
    if (!this._dragging) {
      return;
    }
    if (this._dragFrom && this._dragFrom !== nodeId) {
      // Enforce: only root can connect to children (no child-to-child, no reverse)
      if (this._dragFrom === this.agent.id) {
        const exists = this._editEdges.some((e) => e.from === this._dragFrom && e.to === nodeId);
        if (!exists) {
          this._editEdges = [...this._editEdges, { from: this._dragFrom, to: nodeId }];
          this._computeLayout();
        }
      }
    }
    this._dragging = false;
    this._dragFrom = "";
    this._snapTarget = "";
  }

  /** Cancel drag if mouse released on SVG background. */
  private _onSvgMouseUp() {
    if (this._dragging) {
      // If snapped to a target, complete the edge
      if (this._snapTarget && this._dragFrom === this.agent.id) {
        const exists = this._editEdges.some(
          (e) => e.from === this._dragFrom && e.to === this._snapTarget,
        );
        if (!exists) {
          this._editEdges = [...this._editEdges, { from: this._dragFrom, to: this._snapTarget }];
          this._computeLayout();
        }
      }
      this._dragging = false;
      this._dragFrom = "";
      this._snapTarget = "";
    }
  }

  // ── Palette drag & drop ────────────────────────────────────────────────────

  /** Begin dragging an agent from the palette sidebar. */
  private _onPaletteItemMouseDown(agent: AgentEntry, e: MouseEvent) {
    e.preventDefault();
    this._paletteDragging = true;
    this._paletteDragAgent = agent;
    this._paletteDragGhostX = e.clientX;
    this._paletteDragGhostY = e.clientY;
    this._paletteOverCanvas = false;
    document.addEventListener("mousemove", this._boundPaletteMove);
    document.addEventListener("mouseup", this._boundPaletteUp);
  }

  /** Track ghost position globally. */
  private _onPaletteGlobalMove(e: MouseEvent) {
    if (!this._paletteDragging) {
      return;
    }
    this._paletteDragGhostX = e.clientX;
    this._paletteDragGhostY = e.clientY;

    // Check if over canvas area
    const canvasEl = this.renderRoot.querySelector(".canvas-area");
    if (canvasEl) {
      const rect = canvasEl.getBoundingClientRect();
      this._paletteOverCanvas =
        e.clientX >= rect.left &&
        e.clientX <= rect.right &&
        e.clientY >= rect.top &&
        e.clientY <= rect.bottom;
    }
  }

  /** Drop agent onto canvas. */
  private _onPaletteGlobalUp(_e: MouseEvent) {
    document.removeEventListener("mousemove", this._boundPaletteMove);
    document.removeEventListener("mouseup", this._boundPaletteUp);

    if (this._paletteDragging && this._paletteDragAgent && this._paletteOverCanvas) {
      const agent = this._paletteDragAgent;
      // Add an edge from root to this agent
      const exists = this._editEdges.some((ed) => ed.from === this.agent.id && ed.to === agent.id);
      if (!exists) {
        this._editEdges = [...this._editEdges, { from: this.agent.id, to: agent.id }];
        this._computeLayout();
        this._showToast(`已添加 ${agent.name ?? agent.id}`, false);
      }
    }

    this._paletteDragging = false;
    this._paletteDragAgent = null;
    this._paletteOverCanvas = false;
  }

  // ── Route config panel handlers ────────────────────────────────────────────

  private _onRouteKeywordInput(e: KeyboardEvent) {
    if (e.key !== "Enter") {
      return;
    }
    const input = e.target as HTMLInputElement;
    const val = input.value.trim();
    if (!val) {
      return;
    }
    const cfg = this._routeConfigs.get(this._routePanelEdgeKey);
    if (cfg && !cfg.intentKeywords.includes(val)) {
      cfg.intentKeywords = [...cfg.intentKeywords, val];
      this._routeConfigs = new Map(this._routeConfigs);
    }
    input.value = "";
  }

  private _onRemoveKeyword(keyword: string) {
    const cfg = this._routeConfigs.get(this._routePanelEdgeKey);
    if (cfg) {
      cfg.intentKeywords = cfg.intentKeywords.filter((k) => k !== keyword);
      this._routeConfigs = new Map(this._routeConfigs);
    }
  }

  private _onTimeoutChange(e: Event) {
    const input = e.target as HTMLInputElement;
    const cfg = this._routeConfigs.get(this._routePanelEdgeKey);
    if (cfg) {
      cfg.timeout = Math.max(1, parseInt(input.value, 10) || 30);
      this._routeConfigs = new Map(this._routeConfigs);
    }
  }

  // ── SVG rendering helpers ─────────────────────────────────────────────────

  private _renderSvg(): TemplateResult {
    const nodeMap = new Map<string, LayoutNode>();
    for (const n of this._nodes) {
      nodeMap.set(n.id, n);
    }

    // Compute SVG viewBox dimensions
    let svgW = 400;
    let svgH = 300;
    for (const n of this._nodes) {
      const right = n.x + NODE_W + PADDING_LEFT;
      const bottom = n.y + NODE_H + PADDING_TOP;
      if (right > svgW) {
        svgW = right;
      }
      if (bottom > svgH) {
        svgH = bottom;
      }
    }

    const rootId = this.agent.id;
    const activeEdges = this._activeEdges();
    const editing = this._editing;

    return html`
      <svg
        width="${svgW}"
        height="${svgH}"
        viewBox="0 0 ${svgW} ${svgH}"
        xmlns="http://www.w3.org/2000/svg"
        @mousemove=${editing ? (e: MouseEvent) => this._onSvgMouseMove(e) : undefined}
        @mouseup=${editing ? () => this._onSvgMouseUp() : undefined}
      >
        <defs>
          <marker
            id="arrowhead"
            markerWidth="10"
            markerHeight="7"
            refX="10"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill="#94a3b8" />
          </marker>
          <marker
            id="arrowhead-selected"
            markerWidth="10"
            markerHeight="7"
            refX="10"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill="#f97316" />
          </marker>
          <marker
            id="arrowhead-blue"
            markerWidth="10"
            markerHeight="7"
            refX="10"
            refY="3.5"
            orient="auto"
          >
            <polygon points="0 0, 10 3.5, 0 7" fill="#3b82f6" />
          </marker>
          <linearGradient id="rootGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#3b82f6" />
            <stop offset="100%" stop-color="#6366f1" />
          </linearGradient>
          <linearGradient id="childGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#f0fdf4" />
            <stop offset="100%" stop-color="#ecfdf5" />
          </linearGradient>
        </defs>

        <!-- Edges (bezier curves) -->
        ${activeEdges.map((e, idx) => {
          const from = nodeMap.get(e.from);
          const to = nodeMap.get(e.to);
          if (!from || !to) {
            return svg``;
          }
          const x1 = from.x + NODE_W / 2;
          const y1 = from.y + NODE_H;
          const x2 = to.x + NODE_W / 2;
          const y2 = to.y;
          const cy1 = y1 + (y2 - y1) * 0.4;
          const cy2 = y2 - (y2 - y1) * 0.4;
          const pathD = `M ${x1} ${y1} C ${x1} ${cy1}, ${x2} ${cy2}, ${x2} ${y2}`;
          const selected = editing && idx === this._selectedEdgeIdx;
          const hasRoute = this._routeConfigs.has(this._edgeKey(e.from, e.to));
          return svg`
            <g>
              ${
                editing
                  ? svg`<path
                    d="${pathD}"
                    fill="none" stroke="transparent" stroke-width="14"
                    class="edge-hit"
                    @click=${() => this._onEdgeClick(idx)}
                  />`
                  : svg``
              }
              <path
                d="${pathD}"
                fill="none"
                stroke="${selected ? "#f97316" : "#94a3b8"}"
                stroke-width="${selected ? 2.5 : 1.5}"
                marker-end="${selected ? "url(#arrowhead-selected)" : "url(#arrowhead)"}"
                style="pointer-events: none;"
              />
              ${
                hasRoute
                  ? svg`
                  <circle
                    cx="${(x1 + x2) / 2}" cy="${(y1 + y2) / 2}"
                    r="4" fill="#8b5cf6"
                    style="pointer-events: none;"
                  >
                    <title>已配置路由规则</title>
                  </circle>`
                  : svg``
              }
              ${
                selected
                  ? svg`
                  <!-- Delete button -->
                  <g class="delete-btn"
                    @click=${() => this._onDeleteEdge()}
                    transform="translate(${(x1 + x2) / 2 - 10}, ${(y1 + y2) / 2 - 10})">
                    <rect width="20" height="20" rx="4" fill="#ef4444" />
                    <line x1="6" y1="6" x2="14" y2="14" stroke="white" stroke-width="2" />
                    <line x1="14" y1="6" x2="6" y2="14" stroke="white" stroke-width="2" />
                  </g>
                  <!-- Config button -->
                  <g class="delete-btn"
                    @click=${() => this._onConfigEdge()}
                    transform="translate(${(x1 + x2) / 2 + 14}, ${(y1 + y2) / 2 - 10})">
                    <rect width="20" height="20" rx="4" fill="#6366f1" />
                    <circle cx="10" cy="6" r="1.5" fill="white" />
                    <circle cx="10" cy="10" r="1.5" fill="white" />
                    <circle cx="10" cy="14" r="1.5" fill="white" />
                  </g>`
                  : svg``
              }
            </g>
          `;
        })}

        <!-- Drag line (bezier) -->
        ${editing && this._dragging
          ? (() => {
              const fromNode = nodeMap.get(this._dragFrom);
              if (!fromNode) {
                return svg``;
              }
              const x1 = fromNode.x + NODE_W / 2;
              const y1 = fromNode.y + NODE_H;
              let x2 = this._dragX;
              let y2 = this._dragY;
              // Snap to target input connector
              if (this._snapTarget) {
                const snapNode = nodeMap.get(this._snapTarget);
                if (snapNode) {
                  x2 = snapNode.x + NODE_W / 2;
                  y2 = snapNode.y;
                }
              }
              const cy1 = y1 + Math.abs(y2 - y1) * 0.4;
              const cy2 = y2 - Math.abs(y2 - y1) * 0.4;
              return svg`
                <path
                  d="M ${x1} ${y1} C ${x1} ${cy1}, ${x2} ${cy2}, ${x2} ${y2}"
                  fill="none" stroke="#3b82f6" stroke-width="2" stroke-dasharray="6 3"
                  marker-end="url(#arrowhead-blue)"
                  style="pointer-events: none;"
                />
                ${
                  this._snapTarget
                    ? svg`<circle class="snap-ring"
                      cx="${x2}" cy="${y2}" r="10"
                      fill="none" stroke="#22c55e" stroke-width="2"
                    />`
                    : svg``
                }
              `;
            })()
          : svg``}

        <!-- Nodes -->
        ${this._nodes.map((n) => {
          const isRoot = n.id === rootId;
          const isChild = !isRoot && activeEdges.some((e) => e.to === n.id);
          return svg`
            <g @mouseup=${editing ? () => this._onNodeMouseUp(n.id) : undefined}>
              <rect
                x="${n.x}" y="${n.y}"
                width="${NODE_W}" height="${NODE_H}"
                rx="${NODE_RX}" ry="${NODE_RX}"
                fill="${isRoot ? "url(#rootGrad)" : isChild ? "url(#childGrad)" : "#ffffff"}"
                stroke="${isRoot ? "none" : isChild ? "#86efac" : "#e2e8f0"}"
                stroke-width="${isRoot ? 0 : 1.5}"
                style="filter: drop-shadow(0 1px 2px rgba(0,0,0,0.06));"
              />
              <text
                x="${n.x + NODE_W / 2}"
                y="${n.y + NODE_H / 2 + 1}"
                text-anchor="middle"
                dominant-baseline="middle"
                font-size="13"
                font-family="system-ui, -apple-system, sans-serif"
                fill="${isRoot ? "#ffffff" : "#334155"}"
                font-weight="${isRoot ? "600" : "500"}"
                style="pointer-events: none;"
              >${n.name}</text>

              ${
                editing
                  ? svg`
                  <!-- Output connector (bottom center) — only on root -->
                  ${
                    isRoot
                      ? svg`<circle
                        class="connector"
                        cx="${n.x + NODE_W / 2}" cy="${n.y + NODE_H}"
                        r="5" fill="#3b82f6" stroke="white" stroke-width="1.5"
                        @mousedown=${(ev: MouseEvent) => this._onConnectorMouseDown(n.id, ev)}
                      />`
                      : svg``
                  }
                  <!-- Input connector (top center) — only on non-root -->
                  ${
                    !isRoot
                      ? svg`<circle
                        class="connector"
                        cx="${n.x + NODE_W / 2}" cy="${n.y}"
                        r="5" fill="#22c55e" stroke="white" stroke-width="1.5"
                      />`
                      : svg``
                  }
                  <!-- Root also gets input connector for visual consistency -->
                  ${
                    isRoot
                      ? svg`<circle
                        cx="${n.x + NODE_W / 2}" cy="${n.y}"
                        r="5" fill="#22c55e" stroke="white" stroke-width="1.5"
                        style="pointer-events: none; opacity: 0.3;"
                      />`
                      : svg``
                  }`
                  : svg``
              }
            </g>
          `;
        })}
      </svg>
    `;
  }

  // ── Palette sidebar rendering ──────────────────────────────────────────────

  private _renderPalette(): TemplateResult {
    const usedIds = this._usedAgentIds();
    const search = this._paletteSearch.toLowerCase();
    const available = this._agents.filter((a) => {
      if (a.id === this.agent.id) {
        return false;
      } // exclude root itself
      const name = (a.name ?? a.id).toLowerCase();
      if (search && !name.includes(search) && !a.id.toLowerCase().includes(search)) {
        return false;
      }
      return true;
    });

    return html`
      <div class="palette">
        <div class="palette-header">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            style="display:inline;vertical-align:-2px;margin-right:4px;"
          >
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
          </svg>
          待分配智能体
        </div>
        <input
          class="palette-search"
          type="text"
          placeholder="搜索智能体..."
          .value=${this._paletteSearch}
          @input=${(e: Event) => {
            this._paletteSearch = (e.target as HTMLInputElement).value;
          }}
        />
        <div class="palette-list">
          ${available.length === 0
            ? html`<div class="palette-empty">无可用智能体</div>`
            : available.map((a) => {
                const used = usedIds.has(a.id);
                return html`
                  <div
                    class="palette-item ${used ? "used" : ""}"
                    @mousedown=${!used
                      ? (e: MouseEvent) => this._onPaletteItemMouseDown(a, e)
                      : undefined}
                    title="${used ? "已在画布中" : "拖拽到画布添加"}"
                  >
                    <span class="palette-dot ${used ? "used" : "available"}"></span>
                    <span>${a.name ?? a.id}</span>
                  </div>
                `;
              })}
        </div>
      </div>
    `;
  }

  // ── Route config panel rendering ───────────────────────────────────────────

  private _renderRoutePanel(): TemplateResult {
    if (!this._routePanelOpen) {
      return html``;
    }
    const cfg = this._routeConfigs.get(this._routePanelEdgeKey);
    if (!cfg) {
      return html``;
    }

    // Parse edge key to get from/to names
    const parts = this._routePanelEdgeKey.split("→");
    const fromAgent = this._agents.find((a) => a.id === parts[0]);
    const toAgent = this._agents.find((a) => a.id === parts[1]);

    return html`
      <div class="route-panel-overlay">
        <div class="route-panel-header">
          <span class="route-panel-title">路由配置</span>
          <button
            class="route-panel-close"
            @click=${() => {
              this._routePanelOpen = false;
            }}
            aria-label="关闭"
          >
            ×
          </button>
        </div>
        <div class="route-panel-body">
          <div class="route-edge-label">
            <span>${fromAgent?.name ?? parts[0]}</span>
            <span class="route-edge-arrow">→</span>
            <span>${toAgent?.name ?? parts[1]}</span>
          </div>

          <div class="route-field">
            <label class="route-label">意图关键词 (Intent Keywords)</label>
            <input
              class="route-input"
              type="text"
              placeholder="输入关键词后按 Enter 添加"
              @keydown=${(e: KeyboardEvent) => this._onRouteKeywordInput(e)}
            />
            <div class="route-hint">定义触发此路由的用户意图关键词</div>
            ${cfg.intentKeywords.length > 0
              ? html` <div class="keyword-tags">
                  ${cfg.intentKeywords.map(
                    (kw) => html`
                      <span class="keyword-tag">
                        ${kw}
                        <span class="keyword-tag-remove" @click=${() => this._onRemoveKeyword(kw)}
                          >×</span
                        >
                      </span>
                    `,
                  )}
                </div>`
              : html``}
          </div>

          <div class="route-field">
            <label class="route-label">超时时间 (秒)</label>
            <input
              class="route-input"
              type="number"
              min="1"
              .value=${String(cfg.timeout)}
              @change=${(e: Event) => this._onTimeoutChange(e)}
            />
            <div class="route-hint">子 Agent 响应超时时间，默认 30 秒</div>
          </div>
        </div>
      </div>
    `;
  }

  // ── Main render ────────────────────────────────────────────────────────────

  render() {
    // Loading state
    if (this._loading) {
      return html`<div class="center-state">加载拓扑数据...</div>`;
    }

    // Error state
    if (this._error) {
      return html`
        <div class="center-state">
          <div class="error-msg">${this._error}</div>
          <button class="btn-retry" @click=${() => void this._loadData()}>重试</button>
        </div>
      `;
    }

    const agentName = this.agent.name ?? this.agent.id;

    return html`
      <div class="toolbar">
        <div class="toolbar-left">
          ${this._editing
            ? html`<span class="toolbar-title">${agentName} — 编辑拓扑</span>`
            : html`
                <button class="btn-back" @click=${() => this._onBack()} aria-label="返回">
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <polyline points="15 18 9 12 15 6"></polyline>
                  </svg>
                  返回
                </button>
                <span class="toolbar-title">${agentName} — 拓扑关系</span>
              `}
        </div>
        <div class="toolbar-right">
          ${this._editing
            ? html`
                <button class="btn-cancel" @click=${() => this._onCancel()}>取消</button>
                <button
                  class="btn-save"
                  ?disabled=${this._saving}
                  @click=${() => void this._onSave()}
                >
                  ${this._saving ? "保存中..." : "保存"}
                </button>
              `
            : html`<button class="btn-edit" @click=${() => this._onEdit()}>编辑</button>`}
        </div>
      </div>
      <div class="body">
        ${this._editing ? this._renderPalette() : html``}
        <div
          class="canvas-area ${this._editing && this._paletteDragging && this._paletteOverCanvas
            ? "drop-active"
            : ""}"
        >
          ${this._nodes.length === 0
            ? html`<div class="center-state">暂无拓扑数据，点击编辑开始配置</div>`
            : this._renderSvg()}
        </div>
        ${this._editing ? this._renderRoutePanel() : html``}
      </div>
      ${this._paletteDragging && this._paletteDragAgent
        ? html`<div
            class="drag-ghost"
            style="left:${this._paletteDragGhostX + 12}px;top:${this._paletteDragGhostY - 16}px;"
          >
            ${this._paletteDragAgent.name ?? this._paletteDragAgent.id}
          </div>`
        : html``}
      ${this._toastMsg
        ? html`<div class="toast ${this._toastError ? "toast-error" : "toast-success"}">
            ${this._toastMsg}
          </div>`
        : html``}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "topology-view": TopologyView;
  }
}
