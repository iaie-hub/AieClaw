import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";

/**
 * 通用气泡提示组件。
 * 成功提示 3 秒后自动消失，失败提示 5 秒后自动消失。
 * 消失时触发 "close" 事件。
 */
@customElement("toast-message")
export class ToastMessage extends LitElement {
  @property({ type: String }) message = "";
  @property({ type: Boolean }) isError = false;

  private _timer: ReturnType<typeof setTimeout> | null = null;

  static styles = css`
    :host {
      display: block;
    }

    .toast {
      position: fixed;
      bottom: 24px;
      right: 24px;
      padding: 12px 18px;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 500;
      background: #0f172a;
      color: #f8fafc;
      border: 1px solid #1e293b;
      z-index: 2000;
      animation: toastIn 0.25s ease-out;
      max-width: 400px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
      word-break: break-all;
      backdrop-filter: blur(8px);
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .toast-icon {
      width: 18px;
      height: 18px;
      flex-shrink: 0;
    }

    .toast.success .toast-icon {
      color: #22c55e;
    }

    .toast.error {
      background: #dc2626;
      color: white;
      border-color: #b91c1c;
    }

    .toast.error .toast-icon {
      color: white;
    }

    @keyframes toastIn {
      from {
        opacity: 0;
        transform: translateY(10px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    const duration = this.isError ? 5000 : 3000;
    this._timer = setTimeout(() => {
      this.dispatchEvent(new CustomEvent("close", { bubbles: true, composed: true }));
    }, duration);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._timer) {
      clearTimeout(this._timer);
    }
  }

  render() {
    const icon = this.isError
      ? html`<svg class="toast-icon" viewBox="0 0 20 20" fill="currentColor">
          <path
            fill-rule="evenodd"
            d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM8.707 7.293a1 1 0 0 0-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 1 0 1.414 1.414L10 11.414l1.293 1.293a1 1 0 0 0 1.414-1.414L11.414 10l1.293-1.293a1 1 0 0 0-1.414-1.414L10 8.586 8.707 7.293z"
            clip-rule="evenodd"
          />
        </svg>`
      : html`<svg class="toast-icon" viewBox="0 0 20 20" fill="currentColor">
          <path
            fill-rule="evenodd"
            d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5z"
            clip-rule="evenodd"
          />
        </svg>`;

    return html`
      <div class="toast ${this.isError ? "error" : "success"}" role="alert">
        ${icon}
        <span>${this.message}</span>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "toast-message": ToastMessage;
  }
}
