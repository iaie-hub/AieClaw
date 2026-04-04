import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { AgentEntry } from "../types/agents-types.js";

/**
 * 智能体卡片组件 — 展示单个智能体的摘要信息。
 */
@customElement("agent-card")
export class AgentCard extends LitElement {
  @property({ attribute: false }) agent!: AgentEntry;
  /** 是否为默认智能体 */
  @property({ type: Boolean }) isDefault = false;

  static styles = css`
    :host {
      display: block;
    }

    .card {
      background: white;
      border: 1px solid #e8edf5;
      border-radius: 12px;
      padding: 20px;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      height: 100%;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }

    .card {
      cursor: pointer;
    }

    .card:hover {
      border-color: #3b82f6;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      transform: translateY(-2px);
    }

    .header {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .avatar {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
    }

    .avatar.default {
      background: linear-gradient(135deg, #3b82f6 0%, #6366f1 100%);
    }

    .avatar svg {
      width: 22px;
      height: 22px;
      fill: white;
    }

    .info {
      flex: 1;
      min-width: 0;
    }

    .name-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .name {
      font-size: 16px;
      font-weight: 600;
      color: #1e293b;
      margin: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .badge {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      border-radius: 9999px;
      background: #eff6ff;
      color: #3b82f6;
      white-space: nowrap;
      flex-shrink: 0;
    }

    .id {
      font-size: 13px;
      color: #94a3b8;
      margin: 2px 0 0;
    }

    .details {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding-top: 10px;
      border-top: 1px solid #f1f5f9;
    }

    .detail-row {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      font-size: 13px;
    }

    .detail-label {
      color: #94a3b8;
      font-weight: 500;
      white-space: nowrap;
      min-width: 48px;
    }

    .detail-value {
      color: #475569;
      word-break: break-all;
      line-height: 1.4;
    }

    .model-tag {
      display: inline-block;
      font-size: 12px;
      padding: 2px 8px;
      background: #f1f5f9;
      border-radius: 6px;
      color: #475569;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }

    .fallback-list {
      display: flex;
      flex-wrap: wrap;
      gap: 4px;
      margin-top: 2px;
    }

    .fallback-tag {
      font-size: 11px;
      padding: 1px 6px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 4px;
      color: #64748b;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }
  `;

  private _onClick() {
    this.dispatchEvent(
      new CustomEvent("agent-select", {
        detail: { agent: this.agent, isDefault: this.isDefault },
        bubbles: true,
        composed: true,
      }),
    );
  }

  render() {
    const a = this.agent;
    const displayName = a.name || a.id;
    const showId = a.name && a.name !== a.id;

    return html`
      <div class="card" role="article" aria-label="${displayName}" @click=${() => this._onClick()}>
        <div class="header">
          <div class="avatar ${this.isDefault ? "default" : ""}">
            <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M497.0496 55.7056a38.4 38.4 0 0 1 38.912 0l362.7008 213.2992c11.776 6.912 18.944 19.456 18.944 33.1264v426.6496a38.4 38.4 0 0 1-18.944 33.0752l-362.6496 213.3504a38.4 38.4 0 0 1-38.912 0L134.3488 761.856a38.4 38.4 0 0 1-18.944-33.0752V302.1312a38.4 38.4 0 0 1 18.944-33.1264z m19.456 77.6192L192.3072 324.096v382.72l324.3008 190.7712 324.2496-190.7712V324.096l-324.2496-190.7712zM345.9584 370.3296c7.68 0 14.848 2.2528 20.8384 6.144l149.6576 93.696 149.8624-93.696a38.4512 38.4512 0 0 1 49.1008 58.2656l-1.792 1.792a38.6048 38.6048 0 0 1-6.656 5.12l-152.0128 94.976v170.4448a38.4 38.4 0 0 1-0.1536 3.7376l-0.512 3.7376a38.0928 38.0928 0 0 1-23.04 27.9552 38.0928 38.0928 0 0 1-35.9936-3.5328 38.1952 38.1952 0 0 1-17.0496-31.8976v-170.2912l-152.064-95.1296a38.4 38.4 0 0 1 19.7632-71.3216z"
              />
            </svg>
          </div>
          <div class="info">
            <div class="name-row">
              <h3 class="name">${displayName}</h3>
              ${this.isDefault ? html`<span class="badge">默认</span>` : ""}
            </div>
            ${showId ? html`<p class="id">ID: ${a.id}</p>` : ""}
          </div>
        </div>

        <div class="details">
          <div class="detail-row">
            <span class="detail-label">模型</span>
            <span class="detail-value">
              <span class="model-tag">${a.model.primary}</span>
            </span>
          </div>
          ${a.model.fallbacks.length > 0
            ? html`
                <div class="detail-row">
                  <span class="detail-label">回退</span>
                  <span class="detail-value">
                    <div class="fallback-list">
                      ${a.model.fallbacks.map((f) => html`<span class="fallback-tag">${f}</span>`)}
                    </div>
                  </span>
                </div>
              `
            : ""}
          <div class="detail-row">
            <span class="detail-label">目录</span>
            <span class="detail-value">${a.workspace}</span>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "agent-card": AgentCard;
  }
}
