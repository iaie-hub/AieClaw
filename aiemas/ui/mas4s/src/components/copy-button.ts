import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";

/**
 * 通用复制按钮组件。
 * 提供统一的复制图标、成功反馈（2s）和剪贴板操作。
 */
@customElement("copy-button")
export class CopyButton extends LitElement {
  /** 要复制的文本内容 */
  @property({ type: String }) value = "";

  @state() private _copying = false;

  static styles = css`
    :host {
      display: inline-flex;
    }

    .copy-btn {
      width: 24px;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      color: #64748b;
      cursor: pointer;
      transition: all 0.2s;
    }

    .copy-btn:hover {
      background: #f1f5f9;
      border-color: #cbd5e1;
      color: #334155;
    }

    .copy-btn.copied {
      color: #10b981;
      border-color: #10b981;
      background: #ecfdf5;
    }
  `;

  private _onCopy = async (e: Event) => {
    e.stopPropagation();
    if (this._copying || !this.value) {
      return;
    }

    try {
      await navigator.clipboard.writeText(this.value);
      this._copying = true;
      setTimeout(() => {
        this._copying = false;
      }, 2000);
    } catch (err) {
      console.error("Failed to copy text: ", err);
    }
  };

  render() {
    return html`
      <button
        class="copy-btn ${this._copying ? "copied" : ""}"
        @click=${this._onCopy}
        title=${this._copying ? "已复制" : "复制"}
        aria-label="复制代码"
      >
        ${this._copying
          ? html`<svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>`
          : html`<svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>`}
      </button>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "copy-button": CopyButton;
  }
}
