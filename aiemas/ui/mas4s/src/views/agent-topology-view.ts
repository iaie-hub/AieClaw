import { LitElement, html, css, svg, type TemplateResult } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { fetchAgents, fetchTopology } from "../gateway/agents-api.js";
import { getClient } from "../gateway/client.js";
import type { AgentEntry } from "../types/agents-types.js";
import {
  type CanvasNode,
  type TopologyEdge,
  NODE_W,
  NODE_H,
  NODE_RX,
  GRID_SIZE,
  CANVAS_W,
  CANVAS_H,
  buildCanvasNodes,
} from "./agent-topology-shared.js";
import "./agent-topology-editor.js";

/**
 * agent-topology-view — Read-only DAG topology viewer.
 *
 * Shows nodes + bezier edges on a dot-grid canvas.
 * Toolbar: back button + edit button.
 * Clicking "编辑" switches to the editor sub-component.
 */
@customElement("agent-topology-view")
export class AgentTopologyView extends LitElement {
  @property({ type: Object }) agent!: AgentEntry;

  @state() private _loading = true;
  @state() private _error = "";
  @state() private _editing = false;
  @state() private _agents: AgentEntry[] = [];
  @state() private _edges: TopologyEdge[] = [];
  @state() private _nodes: CanvasNode[] = [];
  @state() private _canvasWidth = CANVAS_W;
  @state() private _scale = 1;

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
    .btn-back {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 5px 12px;
      background: #f1f5f9;
      color: #475569;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      font-size: 13px;
      cursor: pointer;
      transition: background 0.15s;
    }
    .btn-back:hover {
      background: #e2e8f0;
    }
    .btn-edit {
      padding: 6px 16px;
      background: linear-gradient(135deg, #3b82f6, #6366f1);
      color: #fff;
      border: none;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: opacity 0.15s;
    }
    .btn-edit:hover {
      opacity: 0.9;
    }
    .body {
      flex: 1;
      display: flex;
      overflow: hidden;
    }
    .canvas-wrap {
      flex: 1;
      position: relative;
      overflow: auto;
      background-color: #f8fafc;
      background-image: radial-gradient(circle, #e2e8f0 1px, transparent 1px);
      background-size: ${GRID_SIZE}px ${GRID_SIZE}px;
    }
    .canvas-inner {
      position: relative;
      height: ${CANVAS_H}px;
      margin: 24px auto;
      transform-origin: top center;
      transition: transform 0.12s;
    }
    .btn-zoom {
      width: 36px;
      height: 36px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      border-radius: 6px;
      border: 1px solid #e2e8f0;
      background: #fff;
      cursor: pointer;
      font-size: 15px;
    }
    .btn-zoom:hover {
      background: #f1f5f9;
    }
    .zoom-ind {
      min-width: 54px;
      text-align: center;
      font-size: 13px;
      color: #475569;
    }
    .edge-layer {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
    }
    .c-node {
      position: absolute;
      width: ${NODE_W}px;
      height: ${NODE_H}px;
      border-radius: ${NODE_RX}px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.07);
      user-select: none;
    }
    .c-node.root {
      background: linear-gradient(135deg, #3b82f6, #6366f1);
      color: #fff;
    }
    .c-node.child {
      background: #fff;
      border: 1.5px solid #e2e8f0;
      color: #334155;
    }
    .c-node-name {
      font-size: 13px;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: calc(100% - 16px);
      text-align: center;
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
      color: #fff;
      border: none;
      border-radius: 6px;
      font-size: 13px;
      cursor: pointer;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    void this._loadData();
  }

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
      const topo = topoPayload as { topology?: { edges?: TopologyEdge[] } };
      this._edges = Array.isArray(topo?.topology?.edges) ? topo.topology.edges : [];
      const res = buildCanvasNodes(this.agent.id, this._agents, this._edges);
      this._nodes = res.nodes;
      this._canvasWidth = res.canvasWidth;
    } catch (err: unknown) {
      this._error = err instanceof Error ? err.message : "加载拓扑数据失败";
    } finally {
      this._loading = false;
    }
  }

  private _onBack() {
    this.dispatchEvent(new CustomEvent("topology-back", { bubbles: true, composed: true }));
  }

  private _onEditorBack() {
    // Editor cancelled or saved — reload data and return to view mode
    this._editing = false;
    void this._loadData();
  }

  // ── SVG edges ──

  private _renderEdges(): TemplateResult {
    const nodeMap = new Map<string, CanvasNode>();
    for (const n of this._nodes) {
      nodeMap.set(n.id, n);
    }
    return html`
      <svg
        class="edge-layer"
        width="${this._canvasWidth}"
        height="${CANVAS_H}"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <marker id="ah-view" markerWidth="10" markerHeight="7" refX="9" refY="3.5" orient="auto">
            <polygon points="0 0, 10 3.5, 0 7" fill="#94a3b8" />
          </marker>
        </defs>
        ${this._edges.map((e) => {
          const from = nodeMap.get(e.from);
          const to = nodeMap.get(e.to);
          if (!from || !to) {
            return svg``;
          }
          const x1 = from.x + NODE_W / 2;
          const y1 = from.y + NODE_H;
          const x2 = to.x + NODE_W / 2;
          const y2 = to.y;
          const cp = Math.max(40, Math.abs(y2 - y1) * 0.45);
          return svg`
            <path d="M ${x1} ${y1} C ${x1} ${y1 + cp}, ${x2} ${y2 - cp}, ${x2} ${y2}"
              fill="none" stroke="#94a3b8" stroke-width="1.8" marker-end="url(#ah-view)" />
          `;
        })}
      </svg>
    `;
  }

  // ── Nodes ──

  private _renderNodes(): TemplateResult[] {
    const rootId = this.agent.id;
    return this._nodes.map((n) => {
      const isRoot = n.id === rootId;
      return html`
        <div class="c-node ${isRoot ? "root" : "child"}" style="left:${n.x}px;top:${n.y}px;">
          <span class="c-node-name">${n.name}</span>
        </div>
      `;
    });
  }

  render() {
    // Delegate to editor when editing
    if (this._editing) {
      return html`
        <agent-topology-editor
          .agent=${this.agent}
          .agents=${this._agents}
          .initialEdges=${this._edges}
          @editor-back=${() => this._onEditorBack()}
        ></agent-topology-editor>
      `;
    }

    if (this._loading) {
      return html`<div class="center-state">加载拓扑数据...</div>`;
    }
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
        </div>
        <div class="toolbar-right">
          <div style="display:flex;align-items:center;gap:8px;">
            <button class="btn-zoom" @click=${() => this._zoomOut()} aria-label="缩小">−</button>
            <div class="zoom-ind">${Math.round(this._scale * 100)}%</div>
            <button class="btn-zoom" @click=${() => this._zoomIn()} aria-label="放大">+</button>
            <button
              class="btn-edit"
              @click=${() => {
                this._editing = true;
              }}
            >
              编辑
            </button>
          </div>
        </div>
      </div>
      <div class="body">
        <div class="canvas-wrap">
          <div
            class="canvas-inner"
            style="width:${this._canvasWidth}px; height:${CANVAS_H}px; transform: scale(${this
              ._scale});"
          >
            ${this._renderEdges()} ${this._renderNodes()}
          </div>
        </div>
      </div>
    `;
  }

  private _zoomIn() {
    this._scale = Math.min(2, +(this._scale + 0.1).toFixed(2));
  }

  private _zoomOut() {
    this._scale = Math.max(0.4, +(this._scale - 0.1).toFixed(2));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "agent-topology-view": AgentTopologyView;
  }
}
