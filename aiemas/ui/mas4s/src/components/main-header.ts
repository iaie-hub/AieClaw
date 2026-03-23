import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { SessionRunStatus } from "../lib/types.js";
import { AppStoreController } from "../store/app-store.js";
import type { ApprovalRequest } from "../types/approval-types.js";
import type { MasSession } from "../types/session-types.js";
import "./notif-badge.js";

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
  @property({ attribute: false }) session: MasSession | undefined = undefined;
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
      padding: 5px 12px;
      border-radius: 8px;
      border: 1px solid #e2e8f0;
      background: white;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      font-weight: 500;
      transition: all 0.2s;
      color: #3b82f6;
    }

    .invite-btn:hover {
      border-color: #3b82f6;
      background: #eff6ff;
    }

    .archive-btn {
      padding: 5px 12px;
      border-radius: 8px;
      border: 1px solid #e2e8f0;
      background: white;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      font-weight: 500;
      color: #64748b;
      transition: all 0.2s;
      position: relative;
    }

    .archive-btn:hover {
      background: #f1f5f9;
      color: #1e293b;
      border-color: #94a3b8;
    }

    .archive-btn.unarchive {
      background: #fdf2f2;
      color: #ef4444;
      border-color: #fecaca;
      position: relative;
    }

    .archive-btn.unarchive:hover {
      background: #fef2f2;
      border-color: #fca5a5;
    }

    /* CSS tooltip */
    .archive-btn::after {
      content: attr(data-tip);
      position: absolute;
      top: calc(100% + 8px);
      left: 50%;
      transform: translateX(-50%);
      background: #1e293b;
      color: #fff;
      font-size: 12px;
      font-weight: 400;
      white-space: nowrap;
      padding: 5px 10px;
      border-radius: 6px;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.15s;
      z-index: 200;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .archive-btn:hover::after {
      opacity: 1;
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

  private _onArchive = () => {
    if (!this.session) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent("session-archive", {
        detail: { sessionKey: this.session.key },
        bubbles: true,
        composed: true,
      }),
    );
  };

  private _onUnarchive = () => {
    if (!this.session) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent("session-unarchive", {
        detail: { sessionKey: this.session.key },
        bubbles: true,
        composed: true,
      }),
    );
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
    const isInitiator = this.session?.masType === "initiated";
    const isArchived = this.session?.archivedAt != null;

    return html`
      <div class="left">
        ${
          this.title
            ? html`
              <span>${this.title}</span>
              ${
                this.showInvite
                  ? html`
                    <button class="invite-btn" @click=${this._onInviteClick} title="邀请协作者">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path><circle cx="9" cy="7" r="4"></circle><line x1="19" y1="8" x2="19" y2="14"></line><line x1="22" y1="11" x2="16" y2="11"></line></svg>
                      邀请
                    </button>
                  `
                  : nothing
              }
              ${
                isInitiator
                  ? isArchived
                    ? html`
                      <button class="archive-btn unarchive" @click=${this._onUnarchive} title="取消归档"
                        data-tip="启用后会话恢复活跃，成员可继续发送消息">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10h18"></path><path d="M8 14h8"></path><path d="M7 6v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1z"></path><path d="M21 5h-2a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z"></path><path d="M12 2v3"></path></svg>
                        启用
                      </button>
                    `
                    : html`
                      <button class="archive-btn" @click=${this._onArchive} title="归档会话"
                        data-tip="归档后会话将冻结，同时生成并持久化会话摘要，成员无法继续发送消息。如需重新发送消息，可取消归档">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="21 8 21 21 3 21 3 8"></polyline><rect x="1" y="3" width="22" height="5"></rect><line x1="10" y1="12" x2="14" y2="12"></line></svg>
                        归档
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
