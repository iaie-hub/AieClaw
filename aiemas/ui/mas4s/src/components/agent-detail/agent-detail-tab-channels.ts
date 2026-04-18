import { LitElement, html } from "lit";
import { customElement, state } from "lit/decorators.js";
import { fetchChannelsStatus } from "../../gateway/agents-api.js";
import { getClient } from "../../gateway/client.js";
import type { AgentChannelsPayload } from "../../types/agents-types.js";
import { tabPanelStyles } from "./shared-styles.js";

@customElement("agent-tab-channels")
export class AgentTabChannels extends LitElement {
  @state() private _loading = true;
  @state() private _channels: AgentChannelsPayload | null = null;
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
      this._channels = await fetchChannelsStatus(getClient());
    } catch {
      /* */
    } finally {
      this._loading = false;
    }
  }

  private _onSearch = (e: Event) => {
    this._search = (e.target as HTMLInputElement).value;
  };

  render() {
    if (this._loading) {
      return html`<div class="loading-state">加载中...</div>`;
    }
    const ch = this._channels;
    if (!ch || Object.keys(ch.channels).length === 0) {
      return html`<div class="empty-state">当前智能体暂未绑定任何外部消息渠道。</div>`;
    }
    const q = this._search.trim().toLowerCase();
    const entries = Object.entries(ch.channels).filter(([id]) => {
      if (!q) {
        return true;
      }
      const label = ch.channelLabels[id] ?? id;
      return id.toLowerCase().includes(q) || label.toLowerCase().includes(q);
    });
    return html`
      <div class="tab-toolbar">
        <input
          class="search-input"
          type="text"
          placeholder="搜索频道ID或名称..."
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
      ${entries.length === 0
        ? html`<div class="empty-state">无匹配结果</div>`
        : html`
            <div class="grid">
              ${entries.map(
                ([id, val]) => html`
                  <div class="item-card">
                    <div class="card-title">${ch.channelLabels[id] ?? id}</div>
                    <div class="card-desc">${JSON.stringify(val)}</div>
                  </div>
                `,
              )}
            </div>
          `}
    `;
  }
}
