import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { ChatMessage } from "../types/chat-types.js";

/**
 * topology-bar — 单行拓扑状态条。
 *
 * 主 Agent 在左侧，箭头后跟子 Agent 节点卡片水平排列，
 * 每个子 Agent 卡片显示图标 + 名称 + 消息预览，点击打开抽屉。
 * 整条可横向滚动（子 Agent 多时）。
 */
@customElement("topology-bar")
export class TopologyBar extends LitElement {
  @property({ attribute: false }) subAgents: string[] = [];
  @property({ attribute: false }) agents: { id: string; name?: string; description?: string }[] =
    [];
  @property({ attribute: false }) agentMessages: Map<string, ChatMessage[]> = new Map();
  @property({ type: String }) rootAgentId = "";
  @property({ type: String }) rootAgentName = "";
  @property({ attribute: false }) activeAgents: Set<string> = new Set();
  @property({ attribute: false }) unreadAgents: Set<string> = new Set();
  @property({ type: String }) expandedAgent = "";

  static styles = css`
    :host {
      display: block;
      flex-shrink: 0;
      background: #f8fafc;
      border-bottom: 1px solid #e8edf5;
    }

    .bar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      min-height: 40px;
      overflow-x: auto;
      overflow-y: hidden;
      scrollbar-width: none;
    }
    .bar::-webkit-scrollbar {
      display: none;
    }

    /* ── 主 Agent 标签 ── */
    .root-tag {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      white-space: nowrap;
      flex-shrink: 0;
      font-size: 13px;
      font-weight: 600;
      color: #1e293b;
      background: linear-gradient(135deg, #3b82f6, #6366f1);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
    }

    .arrow {
      color: #94a3b8;
      font-size: 13px;
      flex-shrink: 0;
      user-select: none;
    }

    .count-label {
      color: #94a3b8;
      font-size: 12px;
      flex-shrink: 0;
      white-space: nowrap;
      margin-right: 2px;
    }

    /* ── 子 Agent 卡片 ── */
    .child-card {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 5px 12px 5px 8px;
      border-radius: 8px;
      border: 1px solid #e2e8f0;
      background: #fff;
      cursor: pointer;
      transition: all 0.15s;
      flex-shrink: 0;
      white-space: nowrap;
      user-select: none;
      max-width: 220px;
    }

    .child-card:hover {
      background: #f1f5f9;
      border-color: #cbd5e1;
    }

    .child-card.active {
      background: #eff6ff;
      border-color: #3b82f6;
    }

    .card-icon {
      position: relative;
      width: 24px;
      height: 24px;
      border-radius: 6px;
      background: #f1f5f9;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .card-icon svg {
      color: #64748b;
    }

    .status-dot {
      position: absolute;
      top: -2px;
      right: -2px;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      border: 1.5px solid #fff;
    }
    .status-dot.running {
      background: #22c55e;
      animation: pulse 1.2s ease-in-out infinite;
    }
    .status-dot.unread {
      background: #3b82f6;
    }

    @keyframes pulse {
      0%,
      100% {
        opacity: 1;
        transform: scale(1);
      }
      50% {
        opacity: 0.5;
        transform: scale(1.4);
      }
    }

    .card-text {
      display: flex;
      flex-direction: column;
      gap: 1px;
      min-width: 0;
    }

    .card-name {
      font-size: 12px;
      font-weight: 600;
      color: #1e293b;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .card-preview {
      font-size: 11px;
      color: #94a3b8;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 140px;
    }
  `;

  private _getLatestPreview(agentId: string): string {
    const msgs = this.agentMessages.get(agentId);
    if (!msgs || msgs.length === 0) {
      return "";
    }
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      if (m.role === "assistant" || m.role === "Agent") {
        let text = "";
        if (typeof m.content === "string") {
          text = m.content;
        } else if (Array.isArray(m.content)) {
          text = m.content
            .filter((item) => item.type === "text" && item.text)
            .map((item) => item.text!)
            .join(" ");
        }
        if (text.trim()) {
          const clean = text.replace(/[#*`_~[\]]/g, "").trim();
          return clean.length > 20 ? clean.slice(0, 20) + "…" : clean;
        }
      }
    }
    return "";
  }

  private _onCardClick(agentId: string) {
    if (this.expandedAgent === agentId) {
      this.dispatchEvent(new CustomEvent("agent-collapse", { bubbles: true, composed: true }));
    } else {
      this.dispatchEvent(
        new CustomEvent("agent-expand", { detail: { agentId }, bubbles: true, composed: true }),
      );
    }
  }

  render() {
    if (this.subAgents.length === 0) {
      return nothing;
    }

    return html`
      <div class="bar">
        <span class="root-tag">
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="#3b82f6"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="10"></circle>
            <circle cx="12" cy="12" r="3"></circle>
          </svg>
          ${this.rootAgentName || this.rootAgentId}
        </span>
        <span class="arrow">→</span>
        <span class="count-label">${this.subAgents.length}个子Agent</span>

        ${this.subAgents.map((agentId) => {
          const agent = this.agents.find((a) => a.id === agentId);
          const agentName = agent?.name || agentId;
          const isRunning = this.activeAgents.has(agentId);
          const isUnread = this.unreadAgents.has(agentId);
          const isActive = this.expandedAgent === agentId;
          const preview = this._getLatestPreview(agentId);

          return html`
            <div
              class="child-card ${isActive ? "active" : ""}"
              @click=${() => this._onCardClick(agentId)}
              title="${agentName}${preview ? `\n${preview}` : ""}"
            >
              <div class="card-icon">
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
                  <rect x="3" y="11" width="18" height="10" rx="2"></rect>
                  <circle cx="9" cy="16" r="1"></circle>
                  <circle cx="15" cy="16" r="1"></circle>
                  <path d="M8 11V7a4 4 0 0 1 8 0v4"></path>
                </svg>
                ${isRunning
                  ? html`<span class="status-dot running"></span>`
                  : isUnread
                    ? html`<span class="status-dot unread"></span>`
                    : nothing}
              </div>
              <div class="card-text">
                <span class="card-name">${agentName}</span>
                ${preview
                  ? html`<span class="card-preview">${preview}</span>`
                  : html`<span class="card-preview" style="font-style:italic">暂无消息</span>`}
              </div>
            </div>
          `;
        })}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "topology-bar": TopologyBar;
  }
}
