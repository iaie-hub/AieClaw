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
      padding: 12px 20px;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 500;
      color: white;
      z-index: 2000;
      animation: toastIn 0.25s ease-out;
      max-width: 400px;
      text-align: center;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
      word-break: break-all;
    }

    .toast.success {
      background: #22c55e;
    }

    .toast.error {
      background: #ef4444;
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
    return html`
      <div class="toast ${this.isError ? "error" : "success"}" role="alert">${this.message}</div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "toast-message": ToastMessage;
  }
}
