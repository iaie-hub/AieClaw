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
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      height: 100%;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: 14px;
      position: relative;
    }

    .card {
      cursor: pointer;
    }

    .card:hover {
      border-color: #3b82f6;
      box-shadow:
        0 10px 20px rgba(0, 0, 0, 0.06),
        0 4px 6px rgba(0, 0, 0, 0.04);
      transform: translateY(-4px);
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

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #22c55e;
      box-shadow: 0 0 0 2px #dcfce7;
      margin-left: 4px;
      flex-shrink: 0;
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
      font-weight: 400;
      white-space: nowrap;
      min-width: 48px;
    }

    .detail-value {
      color: #1e293b;
      font-weight: 500;
      word-break: break-all;
      line-height: 1.4;
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      flex: 1;
    }

    .workspace-path {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .copy-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: none;
      border: none;
      color: #94a3b8;
      cursor: pointer;
      padding: 2px;
      border-radius: 4px;
      flex-shrink: 0;
      transition: all 0.15s;
    }

    .copy-btn:hover {
      color: #3b82f6;
      background: #eff6ff;
    }

    .model-tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 13px;
      color: #334155;
    }

    .model-tag::before {
      content: "";
      display: block;
      width: 14px;
      height: 14px;
      background: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="%2364748b"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16zM12 22l-9-5.19V8.69L12 13.88l9-5.19v8.12L12 22zM12 11.57l-9-5.19 9-5.19 9 5.19-9 5.19z"/></svg>')
        no-repeat center;
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

    .card-footer {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 6px;
      padding-top: 10px;
      border-top: 1px solid #f1f5f9;
      margin-top: auto;
    }

    .icon-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 30px;
      height: 30px;
      border: 1px solid transparent;
      border-radius: 6px;
      background: transparent;
      color: #64748b;
      cursor: pointer;
      transition: all 0.15s;
      padding: 0;
      font-size: 14px;
      line-height: 1;
    }

    .icon-btn:hover {
      background: #f1f5f9;
      color: #3b82f6;
    }

    .icon-btn.danger:hover {
      background: #fee2e2;
      color: #ef4444;
    }
  `;

  private _onCopyWorkspace = async (e: Event) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(this.agent.workspace);
      this.dispatchEvent(
        new CustomEvent("agent-toast", {
          detail: { message: "目录已复制" },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (err) {
      console.error(err);
    }
  };

  private _onClick() {
    this.dispatchEvent(
      new CustomEvent("agent-select", {
        detail: { agent: this.agent, isDefault: this.isDefault },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onDelete = (e: Event) => {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("agent-delete", {
        detail: { agent: this.agent },
        bubbles: true,
        composed: true,
      }),
    );
  };

  private _onExport = (e: Event) => {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("agent-export", {
        detail: { agent: this.agent },
        bubbles: true,
        composed: true,
      }),
    );
  };

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
              <span class="status-dot" title="准备就绪"></span>
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
            <span class="detail-value">
              <span class="workspace-path" title=${a.workspace}>${a.workspace}</span>
              <button class="copy-btn" title="一键复制" @click=${this._onCopyWorkspace}>
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                >
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </button>
            </span>
          </div>
        </div>
        <div class="card-footer">
          <button
            class="icon-btn"
            title="导出配置"
            aria-label="导出智能体 ${displayName}"
            @click=${this._onExport}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="17 8 12 3 7 8"></polyline>
              <line x1="12" y1="3" x2="12" y2="15"></line>
            </svg>
          </button>
          <button
            class="icon-btn danger"
            title="删除智能体"
            aria-label="删除智能体 ${displayName}"
            @click=${this._onDelete}
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="3 6 5 6 21 6"></polyline>
              <path
                d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"
              ></path>
            </svg>
          </button>
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
