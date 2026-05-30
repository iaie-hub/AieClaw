import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import { getClient } from "../gateway/client.js";
import { markdownMath } from "../lib/markdown-directive.js";

/**
 * ClawHub AgentHub Card — Displays an uploaded Agent package from AgentRegistry.
 */
@customElement("clawhub-agenthub-card")
export class ClawHubAgentHubCard extends LitElement {
  @property({ type: String }) name = "";
  @property({ type: String }) uploaderName = "";
  @property({ type: String }) description = "";
  @property({ type: String }) visibility: "public" | "private" = "private";
  @property({ type: Boolean }) canManage = false;
  @property({ type: Number }) fileSize = 0;
  @property({ type: String }) createdAt = "";
  @property({ type: String }) agentId = "";

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      background: white;
      border: 1px solid #e8edf5;
      border-radius: 12px;
      padding: 20px;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      cursor: pointer;
    }

    :host(:hover) {
      transform: translateY(-4px);
      box-shadow:
        0 10px 20px rgba(99, 102, 241, 0.05),
        0 4px 6px rgba(0, 0, 0, 0.03);
      border-color: #a5b4fc;
    }

    .header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 8px;
    }

    .info {
      min-width: 0;
    }

    .name {
      font-size: 16px;
      font-weight: 600;
      color: #1e293b;
      margin: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .uploader {
      margin: 4px 0 0 0;
      font-size: 12px;
      color: #94a3b8;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .visibility {
      flex-shrink: 0;
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

    .description {
      margin-top: 12px;
      flex: 1;
      font-size: 14px;
      line-height: 1.5;
      color: #475569;
      display: -webkit-box;
      -webkit-line-clamp: 3;
      -webkit-box-orient: vertical;
      overflow: hidden;
      text-overflow: ellipsis;
      height: 63px;
    }

    /* Markdown Styles */
    .description h1,
    .description h2,
    .description h3,
    .description h4,
    .description h5,
    .description h6 {
      font-size: 14px;
      font-weight: 600;
      margin: 0 4px 0 0;
      color: #1e293b;
      display: inline;
    }

    .description p {
      margin: 0;
      display: inline;
    }

    .description ul,
    .description ol {
      padding-left: 16px;
      margin: 0;
      display: inline;
    }

    .description code {
      font-size: 12.8px;
      background: #f1f5f9;
      padding: 2px 6px;
      border-radius: 4px;
    }

    .description pre,
    .description hr,
    .description br {
      display: none;
    }

    .description a {
      color: #4f46e5;
      text-decoration: underline;
    }

    .description blockquote {
      border-left: 3px solid #e2e8f0;
      padding-left: 12px;
      color: #64748b;
      margin: 0;
      display: inline;
    }

    .card-footer {
      margin-top: 16px;
      padding-top: 12px;
      border-top: 1px solid #f1f5f9;
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 12px;
      color: #64748b;
    }

    .meta-info {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .meta-divider {
      color: #cbd5e1;
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
    }

    .icon-btn:hover {
      background: #f1f5f9;
      color: #3b82f6;
    }

    .icon-btn svg {
      width: 15px;
      height: 15px;
    }

    .icon {
      width: 14px;
      height: 14px;
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

  private async _handleDownload(e: Event) {
    e.stopPropagation(); // prevent clicking card
    try {
      const client = getClient();
      await client.waitConnected();

      // For download, we need the user token/apiKey. Instead of doing HTTP fetch here,
      // the best approach in gateway app is usually either opening a URL or proxying.
      // Since this is AieClaw, how to trigger download?
      // Wait, there's no download endpoint in the gateway. The user uses the Control UI to trigger download.
      // Can I just dispatch an event and let the parent handle it?
      this.dispatchEvent(
        new CustomEvent("download-hub-agent", {
          detail: { agentId: this.agentId, name: this.name },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (err) {
      console.error("Failed to trigger download", err);
    }
  }

  private _handleImport(e: Event) {
    e.stopPropagation(); // prevent clicking card
    this.dispatchEvent(
      new CustomEvent("import-hub-agent", {
        detail: { agentId: this.agentId, name: this.name },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _handleVisibilityToggle(e: Event) {
    if (!this.canManage) return;
    e.stopPropagation();
    const newVisibility = this.visibility === "public" ? "private" : "public";
    this.dispatchEvent(
      new CustomEvent("toggle-visibility", {
        detail: { agentId: this.agentId, visibility: newVisibility, agentName: this.name },
        bubbles: true,
        composed: true,
      }),
    );
  }

  render() {
    return html`
      <div class="header">
        <div class="info">
          <h3 class="name" title=${this.name}>${this.name}</h3>
          <p class="uploader" title=${this.uploaderName}>Uploaded by: ${this.uploaderName}</p>
        </div>
        <div
          class="visibility ${this.visibility} ${this.canManage ? "can-manage" : ""}"
          title="${this.canManage ? "点击切换可见性" : ""}"
          @click="${this._handleVisibilityToggle}"
        >
          ${this.visibility === "public"
            ? html`<svg class="icon" viewBox="0 0 20 20" fill="currentColor">
                <path
                  d="M10 2a5 5 0 00-5 5v2a2 2 0 00-2 2v5a2 2 0 002 2h10a2 2 0 002-2v-5a2 2 0 00-2-2H9V7a1 1 0 012 0v2h2V7a5 5 0 00-5-5z"
                />
              </svg>`
            : html`<svg class="icon" viewBox="0 0 20 20" fill="currentColor">
                <path
                  fill-rule="evenodd"
                  d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z"
                  clip-rule="evenodd"
                />
              </svg>`}
          ${this.visibility === "public" ? "Public" : "Private"}
        </div>
      </div>

      <div class="description" title=${this.description || "No description provided."}>
        ${markdownMath(this.description || "No description provided.")}
      </div>

      <div class="card-footer">
        <div class="meta-info">
          <span>${this._formatSize(this.fileSize)}</span>
          <span class="meta-divider">•</span>
          <span>${this._formatDate(this.createdAt)}</span>
        </div>
        <div style="display: flex; gap: 8px; align-items: center;">
          <button
            class="icon-btn"
            title="导入到本地工作区"
            aria-label="导入智能体 ${this.name}"
            @click=${this._handleImport}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 16v1a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3v-1" />
              <polyline points="16 10 12 14 8 10" />
              <line x1="12" y1="14" x2="12" y2="3" />
            </svg>
          </button>
          <button
            class="icon-btn"
            title="下载配置"
            aria-label="下载智能体 ${this.name}"
            @click=${this._handleDownload}
          >
            <svg viewBox="0 0 1024 1024" fill="currentColor">
              <path
                d="M960.64 499.2c-28.8-91.52-116.48-150.4-223.36-150.4h-16a345.216 345.216 0 0 0-283.52-224c-140.8-16.64-278.4 56.96-343.68 182.4a346.24 346.24 0 0 0 47.36 386.56c15.36 17.28 42.24 19.2 60.16 3.84 17.28-15.36 19.2-42.24 3.84-60.16a260.672 260.672 0 0 1-35.84-290.56c49.28-94.08 152.96-149.76 258.56-136.96a259.84 259.84 0 0 1 220.8 192.64c5.12 18.56 21.76 32 40.96 32h47.36c68.48 0 124.16 35.84 142.08 91.52 19.2 60.8-2.56 126.08-55.04 163.2a42.88 42.88 0 0 0-10.24 59.52 42.112 42.112 0 0 0 58.88 10.24c83.2-59.52 118.4-163.2 87.68-259.84z"
              ></path>
              <path
                d="M611.84 698.88l-56.96 56.96V490.88c0-23.68-19.2-42.24-42.88-42.24-23.68 0-42.24 19.2-42.24 42.88v264.96l-57.6-57.6a42.496 42.496 0 1 0-60.16 60.16l129.92 129.92c3.2 3.2 6.4 4.48 9.6 6.4 1.28 0.64 2.56 1.92 3.84 2.56 5.12 1.92 10.88 3.2 16.64 3.2 1.92 0 3.2-0.64 5.12-1.28 3.84-0.64 7.68-0.64 10.88-2.56 5.76-1.92 10.24-5.76 14.72-9.6l129.28-129.28c16.64-16.64 16.64-43.52 0-60.16s-43.52-16-60.16 0.64z"
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
    "clawhub-agenthub-card": ClawHubAgentHubCard;
  }
}
