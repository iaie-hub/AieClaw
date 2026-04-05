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
  @state() private _allGroups: AgentToolGroup[] = [];
  @state() private _groups: AgentToolGroup[] = [];
  @state() private _detail: AgentToolGroup | null = null;
  @state() private _search = "";

  static styles = tabPanelStyles;

  connectedCallback() {
    super.connectedCallback();
  }

  /** 供父组件在页签切换时调用，重新拉取最新数据 */
  refresh() {
    void this._load();
  }

  private async _load() {
    this._loading = true;
    try {
      const res = await fetchAgentTools(getClient(), this.agentId);
      this._allGroups = res.groups;
      this._applyFilter();
    } catch {
      /* */
    } finally {
      this._loading = false;
    }
  }

  private _onSearch = (e: Event) => {
    this._search = (e.target as HTMLInputElement).value;
    this._applyFilter();
  };

  private _applyFilter() {
    const q = this._search.trim().toLowerCase();
    this._groups = q
      ? this._allGroups.filter(
          (g) =>
            g.id.toLowerCase().includes(q) ||
            g.label.toLowerCase().includes(q) ||
            g.tools.some(
              (t) => t.id.toLowerCase().includes(q) || t.label.toLowerCase().includes(q),
            ),
        )
      : [...this._allGroups];
  }

  render() {
    if (this._loading) {
      return html`<div class="loading-state">加载中...</div>`;
    }
    return html`
      <div class="tab-toolbar">
        <input
          class="search-input"
          type="text"
          placeholder="搜索工具ID或名称..."
          .value=${this._search}
          @input=${this._onSearch}
        />
        <button class="refresh-btn" @click=${() => this.refresh()}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="23 4 23 10 17 10"></polyline>
            <polyline points="1 20 1 14 7 14"></polyline>
            <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
          </svg>
          刷新
        </button>
      </div>
      ${this._groups.length === 0
        ? html`<div class="empty-state">${this._search ? "无匹配结果" : "暂无工具信息"}</div>`
        : html`<div class="grid">
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
          </div>`}
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
