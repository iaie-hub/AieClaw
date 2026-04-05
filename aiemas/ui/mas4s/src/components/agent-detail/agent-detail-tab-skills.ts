import { LitElement, html, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { fetchAgentSkills } from "../../gateway/agents-api.js";
import { getClient } from "../../gateway/client.js";
import type { AgentSkillEntry } from "../../types/agents-types.js";
import { tabPanelStyles } from "./shared-styles.js";

@customElement("agent-tab-skills")
export class AgentTabSkills extends LitElement {
  @property({ type: String }) agentId = "";
  @state() private _loading = true;
  @state() private _allSkills: AgentSkillEntry[] = [];
  @state() private _skills: AgentSkillEntry[] = [];
  @state() private _detail: AgentSkillEntry | null = null;
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
      const res = await fetchAgentSkills(getClient(), this.agentId);
      this._allSkills = res.skills;
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
    this._skills = q
      ? this._allSkills.filter(
          (s) => s.name.toLowerCase().includes(q) || s.skillKey.toLowerCase().includes(q),
        )
      : [...this._allSkills];
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
          placeholder="搜索技能名称..."
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
      ${this._skills.length === 0
        ? html`<div class="empty-state">${this._search ? "无匹配结果" : "暂无技能信息"}</div>`
        : html`<div class="grid">
            ${this._skills.map(
              (s) => html`
                <div
                  class="item-card"
                  @click=${() => {
                    this._detail = s;
                  }}
                >
                  <div class="card-head">
                    <div class="card-title">${s.emoji ?? "🧩"} ${s.name}</div>
                    ${!s.eligible
                      ? html`<span class="status-missing">未就绪</span>`
                      : s.disabled
                        ? html`<span class="status-disabled">已禁用</span>`
                        : html`<span class="status-ok">可用</span>`}
                  </div>
                  <div class="card-desc">${s.description}</div>
                  ${s.missing.config.length > 0
                    ? html`<div class="card-meta" style="color:#d73a49;">
                        缺失配置: ${s.missing.config.join(", ")}
                      </div>`
                    : nothing}
                </div>
              `,
            )}
          </div>`}
      ${this._detail ? this._renderDetail(this._detail) : nothing}
    `;
  }

  private _renderDetail(s: AgentSkillEntry) {
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
            <div class="sub-title">${s.emoji ?? "🧩"} ${s.name}</div>
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
              <span class="detail-label">名称</span
              ><span class="detail-value">${s.emoji ?? ""} ${s.name}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">描述</span
              ><span class="detail-value">${s.description}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">来源</span><span class="detail-value">${s.source}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">可用</span
              ><span class="detail-value">${s.eligible ? "是" : "否"}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">已禁用</span
              ><span class="detail-value">${s.disabled ? "是" : "否"}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">内置</span
              ><span class="detail-value">${s.bundled ? "是" : "否"}</span>
            </div>
            ${s.homepage
              ? html`<div class="detail-row">
                  <span class="detail-label">主页</span
                  ><span class="detail-value"
                    ><a href="${s.homepage}" target="_blank" rel="noopener">${s.homepage}</a></span
                  >
                </div>`
              : nothing}
            ${s.missing.bins.length > 0
              ? html`<div class="detail-row">
                  <span class="detail-label">缺失命令</span
                  ><span class="detail-value">${s.missing.bins.join(", ")}</span>
                </div>`
              : nothing}
            ${s.missing.config.length > 0
              ? html`<div class="detail-row">
                  <span class="detail-label">缺失配置</span
                  ><span class="detail-value">${s.missing.config.join(", ")}</span>
                </div>`
              : nothing}
            ${s.install.length > 0
              ? html`
                  <div style="margin-top:12px;font-weight:600;color:#1e293b;">安装方式</div>
                  ${s.install.map(
                    (i) =>
                      html`<div class="detail-row">
                        <span class="detail-label">${i.kind}</span
                        ><span class="detail-value">${i.label}</span>
                      </div>`,
                  )}
                `
              : nothing}
          </div>
        </div>
      </div>
    `;
  }
}
