import { LitElement, html, css, svg, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { saveTopology } from "../gateway/agents-api.js";
import { getClient } from "../gateway/client.js";
import type { AgentEntry } from "../types/agents-types.js";
import {
  type CanvasNode,
  type TopologyEdge,
  NODE_W,
  NODE_H,
  NODE_RX,
  PORT_R,
  SNAP_R,
  GRID_SIZE,
  CANVAS_W,
  CANVAS_H,
  buildCanvasNodes,
} from "./agent-topology-shared.js";

/**
 * agent-topology-editor — Full DAG topology editor.
 *
 * Sidebar (agent pool) + canvas (dot-grid, absolute nodes).
 * Interactions: drag-to-canvas, node move, port-based edge linking,
 * edge selection/deletion, node removal, save/cancel.
 */
@customElement("agent-topology-editor")
export class AgentTopologyEditor extends LitElement {
  @property({ type: Object }) agent!: AgentEntry;
  @property({ type: Array }) agents: AgentEntry[] = [];
  @property({ type: Array }) initialEdges: TopologyEdge[] = [];

  @state() private _edges: TopologyEdge[] = [];
  @state() private _canvasNodes: CanvasNode[] = [];
  @state() private _canvasWidth = CANVAS_W;
  @state() private _saving = false;
  @state() private _toastMsg = "";
  @state() private _toastError = false;

  // ── Palette DnD ──
  @state() private _palDragging = false;
  @state() private _palAgent: AgentEntry | null = null;
  @state() private _palGhostX = 0;
  @state() private _palGhostY = 0;
  @state() private _palOverCanvas = false;

  // ── Node drag ──
  @state() private _nodeDragging = false;
  @state() private _nodeDragId = "";
  private _nodeDragOffX = 0;
  private _nodeDragOffY = 0;

  // ── Edge linking ──
  @state() private _edgeDragging = false;
  @state() private _edgeFrom = "";
  @state() private _edgeMouseX = 0;
  @state() private _edgeMouseY = 0;
  @state() private _edgeSnap = "";

  // ── Edge selection ──
  @state() private _selectedEdgeIdx = -1;

  // ── Palette search ──
  @state() private _search = "";

  private _bPalMove!: (e: MouseEvent) => void;
  private _bPalUp!: (e: MouseEvent) => void;
  private _bNodeMove!: (e: MouseEvent) => void;
  private _bNodeUp!: (e: MouseEvent) => void;

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
      padding: 10px 20px;
      background: #fff;
      border-bottom: 1px solid #e8edf5;
    }
    .toolbar-left,
    .toolbar-right {
      display: flex;
      align-items: center;
      gap: 10px;
    }
    .toolbar-title {
      font-size: 15px;
      font-weight: 600;
      color: #1e293b;
    }
    .btn-cancel {
      padding: 6px 14px;
      background: #f1f5f9;
      color: #475569;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      font-size: 13px;
      cursor: pointer;
      transition: background 0.15s;
    }
    .btn-cancel:hover {
      background: #e2e8f0;
    }
    .btn-save {
      padding: 6px 16px;
      background: #22c55e;
      color: #fff;
      border: none;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: opacity 0.15s;
    }
    .btn-save:hover {
      opacity: 0.9;
    }
    .btn-save:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .body {
      flex: 1;
      display: flex;
      overflow: hidden;
    }

    /* ── Sidebar ── */
    .sidebar {
      width: 250px;
      flex-shrink: 0;
      background: #fff;
      border-right: 1px solid #e8edf5;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .sidebar-hdr {
      padding: 14px 14px 8px;
      font-size: 13px;
      font-weight: 600;
      color: #475569;
      border-bottom: 1px solid #f1f5f9;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .sidebar-search {
      margin: 6px 10px;
      padding: 6px 10px;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      font-size: 12px;
      outline: none;
      transition: border-color 0.15s;
    }
    .sidebar-search:focus {
      border-color: #3b82f6;
    }
    .sidebar-list {
      flex: 1;
      overflow-y: auto;
      padding: 4px 10px 10px;
    }
    .pool-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 10px;
      margin-bottom: 3px;
      border-radius: 6px;
      font-size: 13px;
      color: #334155;
      cursor: grab;
      border: 1px solid transparent;
      transition:
        background 0.12s,
        border-color 0.12s;
      user-select: none;
    }
    .pool-item:hover {
      background: #f1f5f9;
      border-color: #e2e8f0;
    }
    .pool-item:active {
      cursor: grabbing;
    }
    .pool-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #22c55e;
      flex-shrink: 0;
    }
    .pool-empty {
      padding: 20px 10px;
      text-align: center;
      color: #94a3b8;
      font-size: 12px;
    }

    /* ── Canvas ── */
    .canvas-wrap {
      flex: 1;
      position: relative;
      overflow: auto;
      background-color: #f8fafc;
      background-image: radial-gradient(circle, #d4d4d8 1px, transparent 1px);
      background-size: ${GRID_SIZE}px ${GRID_SIZE}px;
    }
    .canvas-wrap.drop-over {
      background-color: #eff6ff;
    }
    .canvas-inner {
      position: relative;
      height: ${CANVAS_H}px;
    }

    .edge-layer {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
    }
    .edge-layer path,
    .edge-layer g {
      pointer-events: auto;
    }

    /* ── Node ── */
    .c-node {
      position: absolute;
      width: ${NODE_W}px;
      height: ${NODE_H}px;
      border-radius: ${NODE_RX}px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.07);
      transition: box-shadow 0.15s;
      user-select: none;
    }
    .c-node:hover {
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.1);
    }
    .c-node.root {
      background: linear-gradient(135deg, #3b82f6, #6366f1);
      color: #fff;
      cursor: default;
    }
    .c-node.child {
      background: #fff;
      border: 1.5px solid #e2e8f0;
      color: #334155;
    }
    .c-node-hdr {
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0 8px;
      box-sizing: border-box;
      position: relative;
      cursor: grab;
    }
    .c-node-hdr:active {
      cursor: grabbing;
    }
    .c-node-name {
      font-size: 13px;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: calc(100% - 28px);
      text-align: center;
    }
    .c-node-remove {
      position: absolute;
      right: 6px;
      top: 50%;
      transform: translateY(-50%);
      width: 20px;
      height: 20px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      border: none;
      cursor: pointer;
      color: inherit;
      opacity: 0;
      transition:
        opacity 0.15s,
        background 0.15s;
    }
    .c-node:hover .c-node-remove {
      opacity: 0.6;
    }
    .c-node-remove:hover {
      opacity: 1 !important;
      background: rgba(239, 68, 68, 0.15);
      color: #ef4444;
    }
    .c-node.root .c-node-remove {
      display: none;
    }

    /* ── Ports ── */
    .port {
      position: absolute;
      left: 50%;
      transform: translateX(-50%);
      width: ${PORT_R * 2}px;
      height: ${PORT_R * 2}px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: crosshair;
      z-index: 2;
      transition: transform 0.12s;
    }
    .port:hover {
      transform: translateX(-50%) scale(1.25);
    }
    .port-in {
      top: -${PORT_R}px;
      background: #22c55e;
      border: 2px solid #fff;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
    }
    .port-out {
      bottom: -${PORT_R}px;
      background: #3b82f6;
      border: 2px solid #fff;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
      font-size: 10px;
      color: #fff;
      font-weight: 700;
      line-height: 1;
    }

    .drag-ghost {
      position: fixed;
      pointer-events: none;
      z-index: 1000;
      padding: 6px 16px;
      background: rgba(59, 130, 246, 0.85);
      color: #fff;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      white-space: nowrap;
    }
    .toast {
      position: fixed;
      bottom: 24px;
      left: 50%;
      transform: translateX(-50%);
      padding: 10px 24px;
      border-radius: 8px;
      font-size: 13px;
      color: #fff;
      z-index: 100;
      animation: toast-in 0.3s ease;
    }
    .toast-ok {
      background: #22c55e;
    }
    .toast-err {
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
    .edge-hit {
      cursor: pointer;
      pointer-events: stroke;
    }
    .edge-del-btn {
      cursor: pointer;
    }
    .edge-del-btn rect {
      transition: fill 0.12s;
    }
    .edge-del-btn:hover rect {
      fill: #dc2626;
    }
    .snap-ring {
      animation: snap-pulse 0.5s ease infinite alternate;
    }
    @keyframes snap-pulse {
      from {
        opacity: 0.35;
      }
      to {
        opacity: 1;
      }
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this._bPalMove = this._onPalMove.bind(this);
    this._bPalUp = this._onPalUp.bind(this);
    this._bNodeMove = this._onNodeGlobalMove.bind(this);
    this._bNodeUp = this._onNodeGlobalUp.bind(this);
    this._edges = this.initialEdges.map((e) => ({ ...e }));
    const res = buildCanvasNodes(this.agent.id, this.agents, this._edges);
    this._canvasNodes = res.nodes;
    this._canvasWidth = res.canvasWidth;
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    document.removeEventListener("mousemove", this._bPalMove);
    document.removeEventListener("mouseup", this._bPalUp);
    document.removeEventListener("mousemove", this._bNodeMove);
    document.removeEventListener("mouseup", this._bNodeUp);
  }

  private _showToast(msg: string, isError: boolean) {
    this._toastMsg = msg;
    this._toastError = isError;
    setTimeout(() => {
      this._toastMsg = "";
    }, 3000);
  }

  private _onCanvasIds(): Set<string> {
    return new Set(this._canvasNodes.map((n) => n.id));
  }

  private _poolAgents(): AgentEntry[] {
    const onCanvas = this._onCanvasIds();
    const q = this._search.toLowerCase();
    return this.agents.filter((a) => {
      if (onCanvas.has(a.id)) {
        return false;
      }
      if (!q) {
        return true;
      }
      return (a.name ?? a.id).toLowerCase().includes(q) || a.id.toLowerCase().includes(q);
    });
  }

  // ── Cancel / Save ──

  private _onCancel() {
    this.dispatchEvent(new CustomEvent("editor-back", { bubbles: true, composed: true }));
  }

  private async _onSave() {
    this._saving = true;
    try {
      const client = getClient();
      await saveTopology(client, this.agent.id, { edges: this._edges });
      this._showToast("保存成功", false);
      setTimeout(() => {
        this.dispatchEvent(new CustomEvent("editor-back", { bubbles: true, composed: true }));
      }, 600);
    } catch (err: unknown) {
      this._showToast(err instanceof Error ? err.message : "保存失败", true);
    } finally {
      this._saving = false;
    }
  }

  // ── Palette DnD ──

  private _onPoolMouseDown(agent: AgentEntry, e: MouseEvent) {
    e.preventDefault();
    this._palDragging = true;
    this._palAgent = agent;
    this._palGhostX = e.clientX;
    this._palGhostY = e.clientY;
    this._palOverCanvas = false;
    document.addEventListener("mousemove", this._bPalMove);
    document.addEventListener("mouseup", this._bPalUp);
  }

  private _onPalMove(e: MouseEvent) {
    if (!this._palDragging) {
      return;
    }
    this._palGhostX = e.clientX;
    this._palGhostY = e.clientY;
    const wrap = this.renderRoot.querySelector(".canvas-wrap");
    if (wrap) {
      const r = wrap.getBoundingClientRect();
      this._palOverCanvas =
        e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    }
  }

  private _onPalUp(e: MouseEvent) {
    document.removeEventListener("mousemove", this._bPalMove);
    document.removeEventListener("mouseup", this._bPalUp);
    if (this._palDragging && this._palAgent && this._palOverCanvas) {
      const wrap = this.renderRoot.querySelector(".canvas-wrap");
      if (wrap) {
        const r = wrap.getBoundingClientRect();
        const x = e.clientX - r.left + wrap.scrollLeft - NODE_W / 2;
        const y = e.clientY - r.top + wrap.scrollTop - NODE_H / 2;
        const agent = this._palAgent;
        this._canvasNodes = [
          ...this._canvasNodes,
          {
            id: agent.id,
            name: agent.name ?? agent.id,
            x: Math.max(0, x),
            y: Math.max(0, y),
          },
        ];
      }
    }
    this._palDragging = false;
    this._palAgent = null;
    this._palOverCanvas = false;
  }

  // ── Node drag ──

  private _onNodeHeaderDown(nodeId: string, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const node = this._canvasNodes.find((n) => n.id === nodeId);
    if (!node) {
      return;
    }
    this._nodeDragging = true;
    this._nodeDragId = nodeId;
    const wrap = this.renderRoot.querySelector(".canvas-wrap");
    if (wrap) {
      const r = wrap.getBoundingClientRect();
      this._nodeDragOffX = e.clientX - r.left + wrap.scrollLeft - node.x;
      this._nodeDragOffY = e.clientY - r.top + wrap.scrollTop - node.y;
    }
    document.addEventListener("mousemove", this._bNodeMove);
    document.addEventListener("mouseup", this._bNodeUp);
  }

  private _onNodeGlobalMove(e: MouseEvent) {
    if (!this._nodeDragging) {
      return;
    }
    const wrap = this.renderRoot.querySelector(".canvas-wrap");
    if (!wrap) {
      return;
    }
    const r = wrap.getBoundingClientRect();
    const nx = e.clientX - r.left + wrap.scrollLeft - this._nodeDragOffX;
    const ny = e.clientY - r.top + wrap.scrollTop - this._nodeDragOffY;
    this._canvasNodes = this._canvasNodes.map((n) =>
      n.id === this._nodeDragId ? { ...n, x: Math.max(0, nx), y: Math.max(0, ny) } : n,
    );
  }

  private _onNodeGlobalUp() {
    document.removeEventListener("mousemove", this._bNodeMove);
    document.removeEventListener("mouseup", this._bNodeUp);
    this._nodeDragging = false;
    this._nodeDragId = "";
  }

  // ── Node removal ──

  private _onRemoveNode(nodeId: string) {
    if (nodeId === this.agent.id) {
      return;
    }
    this._canvasNodes = this._canvasNodes.filter((n) => n.id !== nodeId);
    this._edges = this._edges.filter((e) => e.from !== nodeId && e.to !== nodeId);
    this._selectedEdgeIdx = -1;
  }

  // ── Edge linking ──

  private _onPortOutDown(nodeId: string, e: MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    this._edgeDragging = true;
    this._edgeFrom = nodeId;
    this._edgeSnap = "";
    this._updateEdgeMouse(e);
  }

  private _updateEdgeMouse(e: MouseEvent) {
    const wrap = this.renderRoot.querySelector(".canvas-wrap");
    if (!wrap) {
      return;
    }
    const r = wrap.getBoundingClientRect();
    this._edgeMouseX = e.clientX - r.left + wrap.scrollLeft;
    this._edgeMouseY = e.clientY - r.top + wrap.scrollTop;
  }

  private _onCanvasMouseMove(e: MouseEvent) {
    if (!this._edgeDragging) {
      return;
    }
    this._updateEdgeMouse(e);
    let snap = "";
    let best = SNAP_R;
    for (const n of this._canvasNodes) {
      if (n.id === this._edgeFrom) {
        continue;
      }
      const d = Math.hypot(this._edgeMouseX - (n.x + NODE_W / 2), this._edgeMouseY - n.y);
      if (d < best) {
        best = d;
        snap = n.id;
      }
    }
    this._edgeSnap = snap;
  }

  private _onCanvasMouseUp() {
    if (!this._edgeDragging) {
      return;
    }
    if (this._edgeSnap && this._edgeFrom !== this._edgeSnap) {
      if (!this._edges.some((e) => e.from === this._edgeFrom && e.to === this._edgeSnap)) {
        this._edges = [...this._edges, { from: this._edgeFrom, to: this._edgeSnap }];
      }
    }
    this._edgeDragging = false;
    this._edgeFrom = "";
    this._edgeSnap = "";
  }

  private _onPortInUp(nodeId: string) {
    if (!this._edgeDragging) {
      return;
    }
    if (this._edgeFrom && this._edgeFrom !== nodeId) {
      if (!this._edges.some((e) => e.from === this._edgeFrom && e.to === nodeId)) {
        this._edges = [...this._edges, { from: this._edgeFrom, to: nodeId }];
      }
    }
    this._edgeDragging = false;
    this._edgeFrom = "";
    this._edgeSnap = "";
  }

  // ── Edge selection / deletion ──

  private _onEdgeClick(idx: number, e: Event) {
    e.stopPropagation();
    this._selectedEdgeIdx = this._selectedEdgeIdx === idx ? -1 : idx;
  }

  private _onDeleteEdge(idx: number, e: Event) {
    e.stopPropagation();
    if (idx < 0 || idx >= this._edges.length) {
      return;
    }
    this._edges = [...this._edges.slice(0, idx), ...this._edges.slice(idx + 1)];
    this._selectedEdgeIdx = -1;
  }

  private _onCanvasClick() {
    if (this._selectedEdgeIdx >= 0) {
      this._selectedEdgeIdx = -1;
    }
  }

  // ── Render: edges ──

  private _renderEdges(): TemplateResult {
    const nodeMap = new Map<string, CanvasNode>();
    for (const n of this._canvasNodes) {
      nodeMap.set(n.id, n);
    }
    return html` <svg
      class="edge-layer"
      width="${this._canvasWidth}"
      height="${CANVAS_H}"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <marker id="ah-e" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill="#94a3b8" />
        </marker>
        <marker id="ah-sel-e" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill="#f97316" />
        </marker>
        <marker id="ah-blue-e" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
          <polygon points="0 0, 10 3.5, 0 7" fill="#3b82f6" />
        </marker>
      </defs>
      ${this._edges.map((e, idx) => {
        const from = nodeMap.get(e.from);
        const to = nodeMap.get(e.to);
        if (!from || !to) {
          return svg``;
        }
        const x1 = from.x + NODE_W / 2,
          y1 = from.y + NODE_H;
        const x2 = to.x + NODE_W / 2,
          y2 = to.y;
        const cp = Math.max(40, Math.abs(y2 - y1) * 0.45);
        const d = `M ${x1} ${y1} C ${x1} ${y1 + cp}, ${x2} ${y2 - cp}, ${x2} ${y2}`;
        const sel = idx === this._selectedEdgeIdx;
        const mx = (x1 + x2) / 2,
          my = (y1 + y2) / 2;
        return svg`
            <g>
              <path d="${d}" fill="none" stroke="transparent" stroke-width="14"
                class="edge-hit" @click=${(ev: Event) => this._onEdgeClick(idx, ev)} />
              <path d="${d}" fill="none"
                stroke="${sel ? "#f97316" : "#94a3b8"}"
                stroke-width="${sel ? 2.5 : 1.8}"
                marker-end="${sel ? "url(#ah-sel-e)" : "url(#ah-e)"}"
                style="pointer-events:none;" />
              ${
                sel
                  ? svg`
                <g class="edge-del-btn" @click=${(ev: Event) => this._onDeleteEdge(idx, ev)}
                  transform="translate(${mx - 10}, ${my - 10})">
                  <rect width="20" height="20" rx="4" fill="#ef4444" />
                  <line x1="6" y1="6" x2="14" y2="14" stroke="white" stroke-width="2" />
                  <line x1="14" y1="6" x2="6" y2="14" stroke="white" stroke-width="2" />
                </g>`
                  : svg``
              }
            </g>`;
      })}
      ${this._edgeDragging
        ? (() => {
            const from = nodeMap.get(this._edgeFrom);
            if (!from) {
              return svg``;
            }
            const x1 = from.x + NODE_W / 2,
              y1 = from.y + NODE_H;
            let x2 = this._edgeMouseX,
              y2 = this._edgeMouseY;
            if (this._edgeSnap) {
              const sn = nodeMap.get(this._edgeSnap);
              if (sn) {
                x2 = sn.x + NODE_W / 2;
                y2 = sn.y;
              }
            }
            const cp = Math.max(40, Math.abs(y2 - y1) * 0.45);
            return svg`
            <path d="M ${x1} ${y1} C ${x1} ${y1 + cp}, ${x2} ${y2 - cp}, ${x2} ${y2}"
              fill="none" stroke="#3b82f6" stroke-width="2" stroke-dasharray="6 4"
              marker-end="url(#ah-blue-e)" />
            ${
              this._edgeSnap
                ? svg`
              <circle class="snap-ring" cx="${x2}" cy="${y2}" r="12"
                fill="none" stroke="#22c55e" stroke-width="2.5" />`
                : svg``
            }`;
          })()
        : svg``}
    </svg>`;
  }

  // ── Render: nodes ──

  private _renderCanvasNodes(): TemplateResult[] {
    const rootId = this.agent.id;
    return this._canvasNodes.map((n) => {
      const isRoot = n.id === rootId;
      return html` <div
        class="c-node ${isRoot ? "root" : "child"}"
        style="left:${n.x}px;top:${n.y}px;"
      >
        <div class="port port-in" @mouseup=${() => this._onPortInUp(n.id)}></div>
        <div class="c-node-hdr" @mousedown=${(e: MouseEvent) => this._onNodeHeaderDown(n.id, e)}>
          <span class="c-node-name">${n.name}</span>
          <button
            class="c-node-remove"
            title="移除"
            @click=${(e: Event) => {
              e.stopPropagation();
              this._onRemoveNode(n.id);
            }}
            @mousedown=${(e: Event) => e.stopPropagation()}
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div class="port port-out" @mousedown=${(e: MouseEvent) => this._onPortOutDown(n.id, e)}>
          +
        </div>
      </div>`;
    });
  }

  // ── Render: sidebar ──

  private _renderSidebar(): TemplateResult {
    const pool = this._poolAgents();
    return html` <div class="sidebar">
      <div class="sidebar-hdr">
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
          <rect x="3" y="3" width="7" height="7" />
          <rect x="14" y="3" width="7" height="7" />
          <rect x="3" y="14" width="7" height="7" />
          <rect x="14" y="14" width="7" height="7" />
        </svg>
        待分配智能体
      </div>
      <input
        class="sidebar-search"
        type="text"
        placeholder="搜索..."
        .value=${this._search}
        @input=${(e: Event) => {
          this._search = (e.target as HTMLInputElement).value;
        }}
      />
      <div class="sidebar-list">
        ${pool.length === 0
          ? html`<div class="pool-empty">所有智能体已在画布中</div>`
          : pool.map(
              (a) => html` <div
                class="pool-item"
                title="拖拽到画布"
                @mousedown=${(e: MouseEvent) => this._onPoolMouseDown(a, e)}
              >
                <span class="pool-dot"></span>
                <span>${a.name ?? a.id}</span>
              </div>`,
            )}
      </div>
    </div>`;
  }

  // ── Main render ──

  render() {
    const agentName = this.agent.name ?? this.agent.id;
    return html`
      <div class="toolbar">
        <div class="toolbar-left">
          <span class="toolbar-title">${agentName} — 编辑拓扑</span>
        </div>
        <div class="toolbar-right">
          <button class="btn-cancel" @click=${() => this._onCancel()}>取消</button>
          <button class="btn-save" ?disabled=${this._saving} @click=${() => void this._onSave()}>
            ${this._saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
      <div class="body">
        ${this._renderSidebar()}
        <div
          class="canvas-wrap ${this._palDragging && this._palOverCanvas ? "drop-over" : ""}"
          @mousemove=${(e: MouseEvent) => this._onCanvasMouseMove(e)}
          @mouseup=${() => this._onCanvasMouseUp()}
          @click=${() => this._onCanvasClick()}
        >
          <div class="canvas-inner" style="width:${this._canvasWidth}px; height:${CANVAS_H}px;">
            ${this._renderEdges()} ${this._renderCanvasNodes()}
          </div>
        </div>
      </div>
      ${this._palDragging && this._palAgent
        ? html`<div
            class="drag-ghost"
            style="left:${this._palGhostX + 14}px;top:${this._palGhostY - 14}px;"
          >
            ${this._palAgent.name ?? this._palAgent.id}
          </div>`
        : html``}
      ${this._toastMsg
        ? html`<div class="toast ${this._toastError ? "toast-err" : "toast-ok"}">
            ${this._toastMsg}
          </div>`
        : html``}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "agent-topology-editor": AgentTopologyEditor;
  }
}
