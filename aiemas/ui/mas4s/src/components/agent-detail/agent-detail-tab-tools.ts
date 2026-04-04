import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { fetchAgentTools } from "../../gateway/agents-api.js";
import { getClient } from "../../gateway/client.js";
import type { AgentToolGroup } from "../../types/agents-types.js";
import { tabPanelStyles } from "./shared-styles.js";

const ICONS: Record<string, string> = {
  fs: "📁",
  runtime: "⚙️",
  web: "🌐",
  memory: "🧠",
  sessions: "💬",
  ui: "🖥️",
  messaging: "✉️",
  automation: "🤖",
  nodes: "🔗",
  agents: "👥",
  media: "🎨",
};

@customElement("agent-tab-tools")
export class AgentTabTools extends LitElement {
  @property({ type: String }) agentId = "";
  @state() private _loading = true;
  @state() private _groups: AgentToolGroup[] = [];
  @state() private _detail: AgentToolGroup | null = null;

  static styles = tabPanelStyles;

  connectedCallback() {
    super.connectedCallback();
    void this._load();
  }

  private async _load() {
    this._loading = true;
    try {
      const res = await fetchAgentTools(getClient(), this.agentId);
      this._groups = res.groups;
    } catch {
      /* */
    } finally {
      this._loading = false;
    }
  }

  render() {
    if (this._loading) {
      return html`<div class="loading-state">加载中...</div>`;
    }
    if (this._groups.length === 0) {
      return html`<div class="empty-state">暂无工具信息</div>`;
    }
    return html`
      <div class="grid">
        ${this._groups.map(
          (g) => html`
            <div
              class="item-card"
              @click=${() => {
                this._detail = g;
              }}
            >
              <div class="card-head">
                <div class="card-title">${ICONS[g.id] ?? "🔧"} ${g.label}</div>
              </div>
              <div class="card-desc">${g.id} · ${g.tools.length} 个工具</div>
              <div class="tags">
                ${g.tools.slice(0, 4).map((t) => html`<span class="tag">${t.id}</span>`)}
                ${g.tools.length > 4
                  ? html`<span class="tag">+${g.tools.length - 4}</span>`
                  : nothing}
              </div>
            </div>
          `,
        )}
      </div>
      ${this._detail ? this._renderDetail(this._detail) : nothing}
    `;
  }

  private _renderDetail(g: AgentToolGroup) {
    return html`
      <div
        class="sub-overlay"
        @click=${(e: MouseEvent) => {
          if (e.target === e.currentTarget) {
            this._detail = null;
          }
        }}
      >
        <div class="sub-dialog">
          <div class="sub-header">
            <div class="sub-title">${ICONS[g.id] ?? "🔧"} ${g.label} (${g.id})</div>
            <button
              class="close-btn"
              @click=${() => {
                this._detail = null;
              }}
            >
              ✕
            </button>
          </div>
          <div class="sub-body">
            <div class="detail-row">
              <span class="detail-label">分组 ID</span><span class="detail-value">${g.id}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">来源</span><span class="detail-value">${g.source}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">工具数</span
              ><span class="detail-value">${g.tools.length}</span>
            </div>
            <div style="margin-top:16px;">
              ${g.tools.map(
                (t) => html`
                  <div style="padding:10px 0;border-bottom:1px solid #f1f5f9;">
                    <div style="font-weight:600;color:#1e293b;margin-bottom:4px;">
                      ${t.label} <span class="tag">${t.id}</span>
                    </div>
                    <div style="font-size:12px;color:#64748b;">${t.description}</div>
                    ${t.defaultProfiles.length > 0
                      ? html`<div style="margin-top:4px;" class="tags">
                          ${t.defaultProfiles.map((p) => html`<span class="tag">${p}</span>`)}
                        </div>`
                      : nothing}
                  </div>
                `,
              )}
            </div>
          </div>
        </div>
      </div>
    `;
  }
}
