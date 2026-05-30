import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { HubAgent } from "../gateway/clawhub-api.js";
import { markdownMath } from "../lib/markdown-directive.js";

@customElement("clawhub-agenthub-detail")
export class ClawHubAgentHubDetail extends LitElement {
  @property({ type: Object }) agent!: HubAgent;

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

    /* ── Title Card ── */
    .title-card {
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      padding: 24px;
      box-shadow:
        0 4px 6px -1px rgba(0, 0, 0, 0.02),
        0 2px 4px -1px rgba(0, 0, 0, 0.01);
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    @media (min-width: 640px) {
      .title-card {
        flex-direction: row;
        align-items: center;
        justify-content: space-between;
      }
    }

    .header-info {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .title-row {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .agent-name {
      font-size: 24px;
      font-weight: 700;
      color: #0f172a;
      margin: 0;
    }

    .visibility {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 2px 10px;
      border-radius: 9999px;
      font-size: 12px;
      font-weight: 600;
      border: 1px solid;
    }

    .visibility.public {
      background: #ecfdf5;
      color: #047857;
      border-color: #a7f3d0;
    }

    .visibility.private {
      background: #f1f5f9;
      color: #334155;
      border-color: #e2e8f0;
    }

    .visibility.can-manage {
      cursor: pointer;
    }

    .visibility.public.can-manage:hover {
      background: #d1fae5;
      border-color: #6ee7b7;
    }

    .visibility.private.can-manage:hover {
      background: #e2e8f0;
      border-color: #cbd5e1;
    }

    .visibility svg {
      width: 12px;
      height: 12px;
    }

    .uploader {
      font-size: 14px;
      color: #64748b;
      margin: 0;
    }

    .uploader span {
      font-weight: 500;
      color: #1e293b;
    }

    .actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .btn-download {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      background: linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
    }

    .btn-download:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(79, 70, 229, 0.25);
      filter: brightness(1.05);
    }

    .btn-download:active {
      transform: translateY(0) scale(0.98);
      box-shadow: 0 2px 4px rgba(79, 70, 229, 0.1);
    }

    .btn-download svg {
      width: 16px;
      height: 16px;
    }

    .btn-import {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 16px;
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
    }

    .btn-import:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 12px rgba(16, 185, 129, 0.25);
      filter: brightness(1.05);
    }

    .btn-import:active {
      transform: translateY(0) scale(0.98);
      box-shadow: 0 2px 4px rgba(16, 185, 129, 0.1);
    }

    .btn-import svg {
      width: 16px;
      height: 16px;
    }

    /* ── Detail Card ── */
    .detail-card {
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      padding: 24px;
      box-shadow:
        0 4px 6px -1px rgba(0, 0, 0, 0.02),
        0 2px 4px -1px rgba(0, 0, 0, 0.01);
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .card-title {
      font-size: 18px;
      font-weight: 600;
      color: #0f172a;
      margin: 0;
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

    .dl-item.full-width {
      grid-column: 1 / -1;
    }

    .dl-item dt {
      font-size: 14px;
      font-weight: 500;
      color: #64748b;
    }

    .dl-item dd {
      font-size: 14px;
      color: #0f172a;
      margin: 0;
    }

    .dl-item dd.mono {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
      font-weight: 600;
      background: #f8fafc;
      padding: 8px 10px;
      border-radius: 12px;
      border: 1px solid #f1f5f9;
      word-break: break-all;
    }

    /* ── Description ── */
    .description-container {
      position: relative;
      background: #f8fafc;
      border: 1px solid #f1f5f9;
      border-radius: 12px;
      padding: 16px;
    }

    .description-content {
      font-size: 14px;
      line-height: 1.625;
      color: #475569;
      overflow: hidden;
      transition: all 0.3s;
    }

    .description-content.collapsed {
      max-height: 6rem;
    }

    .fade-overlay {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 40px;
      background: linear-gradient(to top, #f8fafc, transparent);
      pointer-events: none;
    }

    .expand-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 4px;
      width: 100%;
      background: none;
      border: none;
      color: #4f46e5;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      margin-top: 12px;
      padding: 4px 0;
      transition: color 0.2s;
    }

    .expand-btn:hover {
      color: #3730a3;
    }

    .expand-btn svg {
      width: 14px;
      height: 14px;
      transition: transform 0.2s;
    }

    .expand-btn svg.rotated {
      transform: rotate(180deg);
    }

    /* Markdown Styles */
    .description-content h1,
    .description-content h2,
    .description-content h3,
    .description-content h4,
    .description-content h5,
    .description-content h6 {
      font-size: 14px;
      font-weight: 600;
      margin: 8px 0 4px;
      color: #1e293b;
    }

    .description-content p {
      margin: 4px 0;
    }

    .description-content ul,
    .description-content ol {
      padding-left: 20px;
      margin: 4px 0;
    }

    .description-content code {
      font-size: 12.8px;
      background: #f1f5f9;
      padding: 2px 6px;
      border-radius: 4px;
    }

    .description-content pre {
      margin: 8px 0;
      border-radius: 6px;
      overflow-x: auto;
    }

    .description-content a {
      color: #4f46e5;
      text-decoration: underline;
    }

    .description-content blockquote {
      border-left: 3px solid #e2e8f0;
      padding-left: 12px;
      color: #64748b;
      margin: 8px 0;
    }
  `;

  private _formatSize(bytes: number): string {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  }

  private _formatDate(isoStr: string): string {
    try {
      return new Date(isoStr).toLocaleString();
    } catch {
      return isoStr;
    }
  }

  private _onBack() {
    this.dispatchEvent(new CustomEvent("back", { bubbles: true, composed: true }));
  }

  private _onDownload() {
    this.dispatchEvent(
      new CustomEvent("download-hub-agent", {
        detail: { agentId: this.agent.id, name: this.agent.name },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onImport() {
    this.dispatchEvent(
      new CustomEvent("import-hub-agent", {
        detail: { agentId: this.agent.id, name: this.agent.name },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _handleVisibilityToggle(e: Event) {
    if (!this.agent.can_manage) return;
    e.stopPropagation();
    const newVisibility = this.agent.visibility === "public" ? "private" : "public";
    this.dispatchEvent(
      new CustomEvent("toggle-visibility", {
        detail: { agentId: this.agent.id, visibility: newVisibility, agentName: this.agent.name },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _toggleDescription() {
    this._descriptionExpanded = !this._descriptionExpanded;
  }

  render() {
    const a = this.agent;
    const showExpandBtn = a.description && a.description.length > 200;

    return html`
      <div class="container">
        <!-- Back to List -->
        <button class="back-btn" @click=${this._onBack}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M19 12H5" />
            <path d="M12 19l-7-7 7-7" />
          </svg>
          返回 AgentHub
        </button>

        <!-- Title Card -->
        <div class="title-card">
          <div class="header-info">
            <div class="title-row">
              <h1 class="agent-name" title=${a.name}>${a.name}</h1>
              <div
                class="visibility ${a.visibility} ${a.can_manage ? "can-manage" : ""}"
                title=${a.can_manage
                  ? "点击切换可见性"
                  : a.visibility === "public"
                    ? "公开 (Public)"
                    : "私有 (Private)"}
                @click=${this._handleVisibilityToggle}
              >
                ${a.visibility === "public"
                  ? html`<svg viewBox="0 0 20 20" fill="currentColor">
                      <path
                        d="M10 2a5 5 0 00-5 5v2a2 2 0 00-2 2v5a2 2 0 002 2h10a2 2 0 002-2v-5a2 2 0 00-2-2H9V7a1 1 0 012 0v2h2V7a5 5 0 00-5-5z"
                      />
                    </svg>`
                  : html`<svg viewBox="0 0 20 20" fill="currentColor">
                      <path
                        fill-rule="evenodd"
                        d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                        clip-rule="evenodd"
                      />
                    </svg>`}
                ${a.visibility === "public" ? "Public" : "Private"}
              </div>
            </div>
            <p class="uploader">Uploaded by <span>${a.uploader_name}</span></p>
          </div>
          <div class="actions">
            <button class="btn-import" @click=${this._onImport}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M4 16v1a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-1" />
                <polyline points="16 10 12 14 8 10" />
                <line x1="12" y1="14" x2="12" y2="3" />
              </svg>
              导入到工作区
            </button>
            <button class="btn-download" @click=${this._onDownload}>
              <svg viewBox="0 0 20 20" fill="currentColor">
                <path
                  fill-rule="evenodd"
                  d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z"
                  clip-rule="evenodd"
                />
              </svg>
              Download ZIP
            </button>
          </div>
        </div>

        <!-- Metadata Grid Block -->
        <section class="detail-card">
          <h2 class="card-title">Package Information</h2>
          <dl class="dl-list">
            <div class="dl-item">
              <dt>Agent ID</dt>
              <dd class="mono">${a.id}</dd>
            </div>
            <div class="dl-item">
              <dt>Package Size</dt>
              <dd
                class="mono"
                style="background: #f8fafc; border-color: #f1f5f9; display: inline-block;"
              >
                ${this._formatSize(a.file_size)}
              </dd>
            </div>
            <div class="dl-item full-width">
              <dt>Storage Path</dt>
              <dd class="mono">${a.file_path}</dd>
            </div>
            <div class="dl-item">
              <dt>Created At</dt>
              <dd>${this._formatDate(a.created_at)}</dd>
            </div>
            <div class="dl-item">
              <dt>Updated At</dt>
              <dd>${this._formatDate(a.updated_at)}</dd>
            </div>
          </dl>
        </section>

        <!-- Description Block -->
        <section class="detail-card">
          <h2 class="card-title">Description</h2>
          <div class="description-container">
            <div
              class="description-content ${this._descriptionExpanded || !showExpandBtn
                ? ""
                : "collapsed"}"
            >
              ${markdownMath(a.description || "No description provided.")}
            </div>
            ${!this._descriptionExpanded && showExpandBtn
              ? html`<div class="fade-overlay"></div>`
              : ""}
            ${showExpandBtn
              ? html`
                  <button class="expand-btn" @click=${this._toggleDescription}>
                    ${this._descriptionExpanded ? "收起" : "展开"}
                    <svg
                      class="${this._descriptionExpanded ? "rotated" : ""}"
                      viewBox="0 0 20 20"
                      fill="currentColor"
                    >
                      <path
                        fill-rule="evenodd"
                        d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                        clip-rule="evenodd"
                      />
                    </svg>
                  </button>
                `
              : ""}
          </div>
        </section>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "clawhub-agenthub-detail": ClawHubAgentHubDetail;
  }
}
