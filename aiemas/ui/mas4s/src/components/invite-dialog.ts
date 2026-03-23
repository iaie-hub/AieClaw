import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { buildInviteUrl } from "../gateway/session-invite.js";
import type { MasSession } from "../types/session-types.js";

/**
 * 分享链接弹窗。
 * 发起者点击 Header 邀请按钮后弹出，显示分享链接和会话 ID。
 */
@customElement("invite-dialog")
export class InviteDialog extends LitElement {
  @property({ attribute: false }) session!: MasSession;

  @state() private _copied = false;

  static styles = css`
    :host {
      display: block;
    }

    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.3);
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .dialog-card {
      background: white;
      border-radius: 16px;
      padding: 28px;
      width: 480px;
      max-width: 90vw;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
    }

    h3 {
      margin: 0 0 20px;
      font-size: 18px;
      font-weight: 700;
      color: #1e293b;
    }

    .url-row {
      display: flex;
      gap: 8px;
      margin-bottom: 16px;
    }

    .url-input {
      flex: 1;
      padding: 10px 14px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      font-size: 13px;
      color: #334155;
      background: #f8fafc;
      outline: none;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .copy-btn {
      padding: 10px 16px;
      background: linear-gradient(135deg, #3b82f6 0%, #6366f1 100%);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.2s;
    }

    .copy-btn.copied {
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
    }

    .session-id-hint {
      font-size: 13px;
      color: #64748b;
      margin: 0 0 20px;
    }

    code {
      background: #f1f5f9;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: "Fira Code", monospace;
      font-size: 12px;
      color: #334155;
      word-break: break-all;
    }

    .close-btn {
      display: block;
      width: 100%;
      padding: 10px;
      background: #f1f5f9;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      color: #64748b;
      cursor: pointer;
      transition: background 0.2s;
    }

    .close-btn:hover {
      background: #e2e8f0;
    }
  `;

  private get _inviteUrl(): string {
    return buildInviteUrl(this.session.key);
  }

  private _onCopy = async () => {
    try {
      await navigator.clipboard.writeText(this._inviteUrl);
      this._copied = true;
      setTimeout(() => {
        this._copied = false;
      }, 2000);
    } catch {
      // 降级：选中输入框内容
    }
  };

  private _onClose = () => {
    this.dispatchEvent(new CustomEvent("close", { bubbles: true }));
  };

  private _onOverlayClick = (e: Event) => {
    if (e.target === e.currentTarget) {
      this._onClose();
    }
  };

  render() {
    return html`
      <div class="overlay" @click=${this._onOverlayClick}>
        <div class="dialog-card">
          <h3>邀请协作者</h3>
          <div class="url-row">
            <input class="url-input" readonly .value=${this._inviteUrl} />
            <button class="copy-btn ${this._copied ? "copied" : ""}" @click=${this._onCopy}>
              ${this._copied ? "已复制 ✓" : "复制链接"}
            </button>
          </div>
          <p class="session-id-hint">
            或直接分享会话 ID：<code>${this.session.key}</code>
          </p>
          <button class="close-btn" @click=${this._onClose}>关闭</button>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "invite-dialog": InviteDialog;
  }
}
