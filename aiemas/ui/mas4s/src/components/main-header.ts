import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { SessionRunStatus } from "../lib/types.js";
import { AppStoreController } from "../store/app-store.js";
import { resolveStatusType } from "../types/session-types.js";
import "./notif-badge.js";

const STATUS_LABELS: Record<string, string> = {
  running: "运行中",
  done: "已完成",
  failed: "失败",
  killed: "已终止",
  timeout: "超时",
};

const STATUS_COLORS: Record<string, string> = {
  danger: "#ef4444",
  warning: "#f59e0b",
  success: "#10b981",
  info: "#3b82f6",
};

/**
 * 主工作区顶部 Header（70px 高）。
 */
@customElement("main-header")
export class MainHeader extends LitElement {
  private _ctrl = new AppStoreController(this);

  @property({ type: String }) title = "";
  @property({ type: String }) status: SessionRunStatus | undefined = undefined;
  @property({ type: Number }) approvalCount = 0;
  @property({ type: Boolean }) showInvite = false;

  static styles = css`
    :host {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 70px;
      background: #ffffff;
      border-bottom: 1px solid #e2e8f0;
      padding: 0 30px;
      flex-shrink: 0;
      z-index: 5;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.02);
      box-sizing: border-box;
    }

    .left {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 18px;
      font-weight: 600;
      color: #1e293b;
    }

    .status-tag {
      display: inline-flex;
      align-items: center;
      padding: 2px 8px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
    }

    .invite-btn {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      border: 1px solid #e2e8f0;
      background: white;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      transition: all 0.2s;
      color: #64748b;
    }

    .invite-btn:hover {
      border-color: #93c5fd;
      color: #3b82f6;
    }

    .right {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .user-info {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
    }

    .user-avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: linear-gradient(135deg, #f43f5e, #8b5cf6);
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: 700;
      font-size: 13px;
    }

    .user-name {
      font-size: 14px;
      color: #475569;
      font-weight: 500;
    }
  `;

  private _onInviteClick = () => {
    this.dispatchEvent(new CustomEvent("invite-click", { bubbles: true }));
  };

  render() {
    const statusType = resolveStatusType(this.status);
    const statusColor = STATUS_COLORS[statusType] ?? STATUS_COLORS["info"];
    const statusLabel = this.status ? (STATUS_LABELS[this.status] ?? this.status) : "";

    return html`
      <div class="left">
        ${
          this.title
            ? html`
              <span>${this.title}</span>
              ${
                this.status
                  ? html`
                    <span
                      class="status-tag"
                      style="background:${statusColor}20;color:${statusColor}"
                    >
                      ${statusLabel}
                    </span>
                  `
                  : nothing
              }
              ${
                this.showInvite
                  ? html`
                    <button class="invite-btn" @click=${this._onInviteClick} title="邀请协作者">
                      🔗
                    </button>
                  `
                  : nothing
              }
            `
            : nothing
        }
      </div>

      <div class="right">
        <notif-badge .count=${this.approvalCount}></notif-badge>
        <div class="user-info">
          <div class="user-avatar">${this._ctrl.store.currentUser?.displayName?.charAt(0).toUpperCase() || "U"}</div>
          <span class="user-name">${this._ctrl.store.currentUser?.displayName || "User"}</span>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "main-header": MainHeader;
  }
}
