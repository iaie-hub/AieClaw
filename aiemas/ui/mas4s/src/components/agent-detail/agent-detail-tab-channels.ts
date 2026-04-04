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

  static styles = tabPanelStyles;

  connectedCallback() {
    super.connectedCallback();
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

  render() {
    if (this._loading) {
      return html`<div class="loading-state">加载中...</div>`;
    }
    const ch = this._channels;
    if (!ch || Object.keys(ch.channels).length === 0) {
      return html`<div class="empty-state">当前智能体暂未绑定任何外部消息渠道。</div>`;
    }
    return html`
      <div class="grid">
        ${Object.entries(ch.channels).map(
          ([id, val]) => html`
            <div class="item-card">
              <div class="card-title">${ch.channelLabels[id] ?? id}</div>
              <div class="card-desc">${JSON.stringify(val)}</div>
            </div>
          `,
        )}
      </div>
    `;
  }
}
