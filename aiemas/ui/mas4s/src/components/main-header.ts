import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { SessionRunStatus } from "../lib/types.js";
import { AppStoreController } from "../store/app-store.js";
import type { ApprovalRequest } from "../types/approval-types.js";
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
  @property({ attribute: false }) pendingApprovals: ApprovalRequest[] = [];
  @property({ type: Boolean }) showInvite = false;
  @state() private _notifOpen = false;

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

    /* 通知面板 */
    .notif-anchor {
      position: relative;
    }

    .notif-panel {
      position: absolute;
      top: calc(100% + 8px);
      right: 0;
      width: 360px;
      max-height: 480px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
      z-index: 100;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .notif-panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px 10px;
      border-bottom: 1px solid #f1f5f9;
      font-size: 14px;
      font-weight: 600;
      color: #1e293b;
      flex-shrink: 0;
    }

    .notif-close-btn {
      background: none;
      border: none;
      cursor: pointer;
      color: #94a3b8;
      font-size: 16px;
      padding: 2px 4px;
      border-radius: 4px;
      line-height: 1;
    }

    .notif-close-btn:hover {
      color: #475569;
      background: #f1f5f9;
    }

    .notif-list {
      overflow-y: auto;
      flex: 1;
    }

    .notif-empty {
      padding: 32px 16px;
      text-align: center;
      color: #94a3b8;
      font-size: 14px;
    }

    .notif-item {
      padding: 12px 16px;
      border-bottom: 1px solid #f8fafc;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .notif-item:last-child {
      border-bottom: none;
    }

    .notif-item-top {
      display: flex;
      align-items: flex-start;
      gap: 8px;
    }

    .notif-icon {
      font-size: 16px;
      flex-shrink: 0;
      margin-top: 1px;
    }

    .notif-content {
      flex: 1;
      min-width: 0;
    }

    .notif-command {
      font-size: 13px;
      font-weight: 600;
      color: #1e293b;
      font-family: "SF Mono", "Fira Code", monospace;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .notif-meta {
      font-size: 11px;
      color: #94a3b8;
      margin-top: 2px;
    }

    .notif-ask {
      font-size: 12px;
      color: #475569;
      background: #f8fafc;
      border-radius: 6px;
      padding: 6px 8px;
      line-height: 1.5;
    }

    .notif-actions {
      display: flex;
      gap: 6px;
      justify-content: flex-end;
    }

    .notif-btn {
      padding: 4px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      border: 1px solid transparent;
      transition: all 0.15s;
    }

    .notif-btn.allow {
      background: #10b981;
      color: white;
      border-color: #10b981;
    }

    .notif-btn.allow:hover {
      background: #059669;
    }

    .notif-btn.deny {
      background: white;
      color: #ef4444;
      border-color: #fca5a5;
    }

    .notif-btn.deny:hover {
      background: #fef2f2;
    }
  `;

  private _onInviteClick = () => {
    this.dispatchEvent(new CustomEvent("invite-click", { bubbles: true }));
  };

  private _onNotifOpen = () => {
    this._notifOpen = !this._notifOpen;
  };

  private _onNotifClose = () => {
    this._notifOpen = false;
  };

  private _onResolve(id: string, decision: string) {
    this._notifOpen = false;
    this.dispatchEvent(
      new CustomEvent("resolve-approval", {
        detail: { id, decision },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _renderNotifPanel() {
    if (!this._notifOpen) {
      return nothing;
    }
    const approvals = this.pendingApprovals;
    return html`
      <div class="notif-panel" role="dialog" aria-label="通知列表">
        <div class="notif-panel-header">
          <span>待审批通知 ${approvals.length > 0 ? `(${approvals.length})` : ""}</span>
          <button class="notif-close-btn" @click=${this._onNotifClose} aria-label="关闭通知面板">✕</button>
        </div>
        <div class="notif-list">
          ${
            approvals.length === 0
              ? html`
                  <div class="notif-empty">暂无待审批通知</div>
                `
              : approvals.map((a) => this._renderNotifItem(a))
          }
        </div>
      </div>
    `;
  }

  private _renderNotifItem(a: ApprovalRequest) {
    const cmd = a.request.commandPreview ?? a.request.command;
    const session = a.request.sessionKey ?? "—";
    const elapsed = Math.round((Date.now() - a.createdAtMs) / 1000);
    const timeLabel = elapsed < 60 ? `${elapsed}秒前` : `${Math.round(elapsed / 60)}分钟前`;
    return html`
      <div class="notif-item">
        <div class="notif-item-top">
          <span class="notif-icon">⚡</span>
          <div class="notif-content">
            <div class="notif-command" title=${cmd}>${cmd}</div>
            <div class="notif-meta">会话：${session} · ${timeLabel}</div>
          </div>
        </div>
        ${a.request.ask ? html`<div class="notif-ask">${a.request.ask}</div>` : nothing}
        <div class="notif-actions">
          <button class="notif-btn deny" @click=${() => this._onResolve(a.id, "deny")}>拒绝</button>
          <button class="notif-btn allow" @click=${() => this._onResolve(a.id, "allow-once")}>批准</button>
        </div>
      </div>
    `;
  }

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
        <div class="notif-anchor">
          <notif-badge .count=${this.approvalCount} @notif-open=${this._onNotifOpen}></notif-badge>
          ${this._renderNotifPanel()}
        </div>
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
