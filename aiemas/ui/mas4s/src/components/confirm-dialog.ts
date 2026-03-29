import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";

/**
 * 通用确认弹窗。
 * 提供标题、消息、确认/取消按钮文本，并触发 confirm/cancel 事件。
 */
@customElement("confirm-dialog")
export class ConfirmDialog extends LitElement {
  @property({ type: String }) title = "确认操作";
  @property({ type: String }) message = "";
  @property({ type: String }) confirmText = "确定";
  @property({ type: String }) cancelText = "取消";
  @property({ type: String }) confirmVariant: "primary" | "danger" = "primary";

  static styles = css`
    :host {
      display: block;
    }

    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(4px);
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: fadeIn 0.2s ease-out;
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }

    .dialog-card {
      background: white;
      border-radius: 16px;
      padding: 28px;
      width: 400px;
      max-width: 90vw;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
      animation: slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }

    @keyframes slideUp {
      from {
        transform: translateY(20px);
        opacity: 0;
      }
      to {
        transform: translateY(0);
        opacity: 1;
      }
    }

    h3 {
      margin: 0 0 16px;
      font-size: 18px;
      font-weight: 700;
      color: #1e293b;
    }

    .message {
      font-size: 14px;
      line-height: 1.6;
      color: #475569;
      margin-bottom: 24px;
      white-space: pre-wrap;
    }

    .actions {
      display: flex;
      gap: 12px;
      justify-content: flex-end;
    }

    button {
      padding: 10px 20px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      border: 1px solid transparent;
    }

    .cancel-btn {
      background: #f1f5f9;
      color: #64748b;
      border-color: #e2e8f0;
    }

    .cancel-btn:hover {
      background: #e2e8f0;
      color: #1e293b;
    }

    .confirm-btn {
      color: white;
    }

    .confirm-btn.primary {
      background: linear-gradient(135deg, #3b82f6 0%, #6366f1 100%);
    }

    .confirm-btn.primary:hover {
      opacity: 0.9;
    }

    .confirm-btn.danger {
      background: #ef4444;
    }

    .confirm-btn.danger:hover {
      background: #dc2626;
    }
  `;

  private _onConfirm = () => {
    this.dispatchEvent(new CustomEvent("confirm", { bubbles: true, composed: true }));
  };

  private _onCancel = () => {
    this.dispatchEvent(new CustomEvent("cancel", { bubbles: true, composed: true }));
  };

  private _onOverlayClick = (e: Event) => {
    if (e.target === e.currentTarget) {
      this._onCancel();
    }
  };

  render() {
    return html`
      <div class="overlay" @click=${this._onOverlayClick}>
        <div
          class="dialog-card"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="title"
          aria-describedby="message"
        >
          <h3 id="title">${this.title}</h3>
          <div class="message" id="message">${this.message}</div>
          <div class="actions">
            <button class="cancel-btn" @click=${this._onCancel}>${this.cancelText}</button>
            <button class="confirm-btn ${this.confirmVariant}" @click=${this._onConfirm}>
              ${this.confirmText}
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "confirm-dialog": ConfirmDialog;
  }
}
