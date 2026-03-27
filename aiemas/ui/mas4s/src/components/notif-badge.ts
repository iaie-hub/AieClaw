import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";

/**
 * Bell 角标组件。
 * count > 0 时显示数字，count === 0 时隐藏数字。
 * 点击时派发 notif-open 事件。
 */
@customElement("notif-badge")
export class NotifBadge extends LitElement {
  @property({ type: Number }) count = 0;

  static styles = css`
    :host {
      display: inline-flex;
      position: relative;
    }

    .bell-btn {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      border: 1px solid #e8edf5;
      background: #f8fafc;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
      color: #64748b;
    }

    .bell-btn:hover {
      border-color: #93c5fd;
      background: #eff6ff;
      color: #3b82f6;
      box-shadow: 0 2px 8px rgba(59, 130, 246, 0.12);
    }

    .bell-btn.active {
      border-color: #93c5fd;
      color: #3b82f6;
      background: #eff6ff;
      box-shadow: 0 2px 8px rgba(59, 130, 246, 0.15);
    }

    .badge {
      position: absolute;
      top: -4px;
      right: -4px;
      background: #ef4444;
      color: white;
      border-radius: 10px;
      padding: 1px 5px;
      font-size: 10px;
      font-weight: 700;
      min-width: 16px;
      text-align: center;
      line-height: 14px;
      pointer-events: none;
    }
  `;

  private _onClick = () => {
    this.dispatchEvent(new CustomEvent("notif-open", { bubbles: true, composed: true }));
  };

  render() {
    return html`
      <button
        class="bell-btn"
        aria-label="审批通知 ${this.count} 条"
        aria-haspopup="true"
        @click=${this._onClick}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
      </button>
      ${this.count > 0 ? html`<span class="badge">${this.count}</span>` : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "notif-badge": NotifBadge;
  }
}
