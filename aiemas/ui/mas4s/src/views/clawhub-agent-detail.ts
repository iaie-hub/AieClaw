import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { markdownMath } from "../lib/markdown-directive.js";
import type { RegistryAgent } from "../gateway/clawhub-api.js";

@customElement("clawhub-agent-detail")
export class ClawHubAgentDetail extends LitElement {
  @property({ type: Object }) agent!: RegistryAgent;

  @state() private _descriptionExpanded = false;

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      height: 100%;
      background: #f8fafc;
      overflow-y: auto;
      box-sizing: border-box;
    }

    .container {
      width: 100%;
      margin: 0 auto;
      padding: 24px 32px 48px;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: 24px;
    }

    /* ── Back button ── */
    .back-btn {
      align-self: flex-start;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 8px 16px;
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      color: #475569;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
    }

    .back-btn:hover {
      color: #0f172a;
      border-color: #cbd5e1;
      background: #f8fafc;
      transform: translateX(-4px);
    }

    .back-btn svg {
      width: 16px;
      height: 16px;
      stroke-width: 2.5;
    }

    /* ── Merged Header ── */
    .merged-header {
      display: flex;
      align-items: center;
      gap: 20px;
      padding-bottom: 20px;
      border-bottom: 1px solid #e2e8f0;
      margin-bottom: 4px;
    }

    .avatar-wrapper {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      box-shadow: 0 4px 8px -2px rgba(79, 70, 229, 0.3);
    }

    .avatar-wrapper svg {
      width: 20px;
      height: 20px;
      fill: white;
    }

    .header-info {
      flex: 1;
      min-width: 0;
    }

    .title-row {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
    }

    .agent-name {
      font-size: 18px;
      font-weight: 700;
      color: #0f172a;
      margin: 0;
    }


    .description-container {
      margin-top: 12px;
      position: relative;
    }

    .description-content {
      font-size: 14px;
      line-height: 1.6;
      color: #334155;
      overflow: hidden;
    }

    .description-content h1 {
      font-size: 18px;
      font-weight: 700;
      margin: 16px 0 8px;
      color: #0f172a;
    }

    .description-content h2 {
      font-size: 16px;
      font-weight: 600;
      margin: 14px 0 8px;
      color: #0f172a;
    }

    .description-content h3 {
      font-size: 15px;
      font-weight: 600;
      margin: 12px 0 8px;
      color: #1e293b;
    }

    .description-content > *:first-child {
      margin-top: 0;
    }

    .description-content.line-clamp-3 {
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .full-description-content {
      font-size: 14px;
      line-height: 1.6;
      color: #334155;
    }

    .expand-btn {
      background: none;
      border: none;
      color: #4f46e5;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      padding: 4px 0 0;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      transition: color 0.15s;
    }

    .expand-btn:hover {
      color: #4338ca;
      text-decoration: underline;
    }

    /* ── Detail Card ── */
    .detail-card {
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      padding: 24px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.02), 0 2px 4px -1px rgba(0, 0, 0, 0.01);
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .card-title {
      font-size: 16px;
      font-weight: 700;
      color: #0f172a;
      margin: 0 0 4px;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .card-title svg {
      width: 20px;
      height: 20px;
      color: #64748b;
    }

    /* ── DL Key-Value lists ── */
    .dl-list {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 16px 24px;
      margin: 0;
    }

    @media (max-width: 640px) {
      .dl-list {
        grid-template-columns: 1fr;
      }
    }

    .dl-item {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .dl-item dt {
      font-size: 12px;
      font-weight: 600;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .dl-item dd {
      font-size: 14px;
      color: #334155;
      margin: 0;
      font-weight: 500;
      word-break: break-all;
    }

    .dl-item dd.mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 13px;
      background: #f1f5f9;
      padding: 3px 8px;
      border-radius: 6px;
      border: 1px solid #e2e8f0;
      width: fit-content;
    }

    /* ── Capabilities Checklist ── */
    .caps-divider {
      border-top: 1px solid #e2e8f0;
      margin-top: 8px;
      padding-top: 16px;
    }

    .caps-title {
      font-size: 13px;
      font-weight: 600;
      color: #64748b;
      margin: 0 0 12px;
    }

    .caps-list {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
    }

    .cap-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      border: 1px solid #e2e8f0;
    }

    .cap-badge.enabled {
      background: #f0fdf4;
      color: #166534;
      border-color: #bbf7d0;
    }

    .cap-badge.disabled {
      background: #f8fafc;
      color: #94a3b8;
      border-color: #e2e8f0;
    }

    .cap-badge svg {
      width: 14px;
      height: 14px;
      stroke-width: 2.5;
    }
  `;

  private _onBack() {
    this.dispatchEvent(new CustomEvent("back", { bubbles: true, composed: true }));
  }

  private _toggleDescription() {
    this._descriptionExpanded = !this._descriptionExpanded;
  }

  render() {
    const card = this.agent.card;
    const c = (card.capabilities || {}) as any;
    const capabilities = [
      { key: "streaming", label: "Streaming", enabled: !!c.streaming },
      { key: "pushNotifications", label: "Push Notifications", enabled: !!c.pushNotifications },
      { key: "longRunningOperations", label: "Long Running", enabled: !!c.longRunningOperations },
      { key: "stateTransitionHistory", label: "State History", enabled: !!c.stateTransitionHistory },
    ];

    return html`
      <div class="container">
        <!-- Back button -->
        <button class="back-btn" @click=${this._onBack}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
          </svg>
          返回列表
        </button>

        <!-- Agent Info -->
        <div class="detail-card">
          <!-- Merged Header -->
          <div class="merged-header">
            <div class="avatar-wrapper">
              <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                <path d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1.07A7.001 7.001 0 0 1 14 23h-4a7.001 7.001 0 0 1-6.93-6H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2zm-2 9a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm4 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z" />
              </svg>
            </div>
            <div class="header-info">
              <div class="title-row">
                <h1 class="agent-name">${card.name || card.agent_id}</h1>
              </div>
            </div>
          </div>
          <h2 class="card-title">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" />
              <path d="M9 9h6v6H9z" />
            </svg>
            智能体信息
          </h2>
          <dl class="dl-list">
            <div class="dl-item">
              <dt>Agent ID</dt>
              <dd class="mono">${card.agent_id}</dd>
            </div>
            <div class="dl-item">
              <dt>Version</dt>
              <dd>${card.version || "1.0.0"}</dd>
            </div>
            <div class="dl-item">
              <dt>URL</dt>
              <dd>${card.url || "—"}</dd>
            </div>
            <div class="dl-item">
              <dt>Transport</dt>
              <dd style="text-transform: uppercase;">${card.transport || "—"}</dd>
            </div>
            ${card.endpoint
              ? html`
                  <div class="dl-item">
                    <dt>Endpoint</dt>
                    <dd>${card.endpoint}</dd>
                  </div>
                `
              : ""}
            <div class="dl-item">
              <dt>MAC Address</dt>
              <dd class="mono">${card.mac || "—"}</dd>
            </div>
            <div class="dl-item">
              <dt>IP Address</dt>
              <dd class="mono">${card.ip || "—"}</dd>
            </div>
          </dl>

          <!-- Capabilities -->
          <div class="caps-divider">
            <h3 class="caps-title">支持的能力 (Capabilities)</h3>
            <div class="caps-list">
              ${capabilities.map(
                (cap) => html`
                  <span class="cap-badge ${cap.enabled ? "enabled" : "disabled"}">
                    ${cap.enabled
                      ? html`
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        `
                      : html`
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <line x1="18" y1="6" x2="6" y2="18" />
                            <line x1="6" y1="6" x2="18" y2="18" />
                          </svg>
                        `}
                    ${cap.label}
                  </span>
                `,
              )}
            </div>
          </div>
        </div>

        <!-- Description Card -->
        ${card.description
          ? html`
              <div class="detail-card">
                <h2 class="card-title">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <line x1="16" y1="13" x2="8" y2="13"></line>
                    <line x1="16" y1="17" x2="8" y2="17"></line>
                    <polyline points="10 9 9 9 8 9"></polyline>
                  </svg>
                  详细描述
                </h2>
                <div class="description-container" style="margin-top: 0;">
                  <div class="description-content ${this._descriptionExpanded ? "" : "line-clamp-3"}">
                    ${markdownMath(card.description)}
                  </div>
                  <button class="expand-btn" @click=${this._toggleDescription}>
                    ${this._descriptionExpanded ? "收起" : "展开更多"}
                  </button>
                </div>
              </div>
            `
          : ""}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "clawhub-agent-detail": ClawHubAgentDetail;
  }
}
