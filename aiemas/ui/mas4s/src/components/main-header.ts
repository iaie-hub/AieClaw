import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { extractAgentNameFromKey } from "../../../../src/utils/session-utils.js";
import type { SessionRunStatus } from "../lib/types.js";
import { AppStoreController } from "../store/app-store.js";
import type { ApprovalRequest } from "../types/approval-types.js";
import type { MasSession } from "../types/session-types.js";
import "./notif-badge.js";
import "./confirm-dialog.js";

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
  @state() private _confirmingAction: "none" | "archive" | "unarchive" = "none";
  @property({ type: Boolean }) showToolMessages = true;
  @state() private _agentDialogOpen = false;
  @state() private _selectedAgentId = "default";

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
      z-index: 100;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.02);
      box-sizing: border-box;
    }

    .left {
      display: flex;
      align-items: center;
      gap: 12px;
      color: #1e293b;
    }

    .session-info-col {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .session-title-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 18px;
      font-weight: 600;
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

    .summary-btn {
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
      color: #7c3aed;
      transition: all 0.2s;
    }

    .summary-btn:hover {
      border-color: #7c3aed;
      background: #f5f3ff;
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
      font-size: 11px;
      font-weight: 400;
      white-space: pre-wrap;
      line-height: 1.5;
      text-align: center;
      width: max-content;
      max-width: 260px;
      padding: 6px 12px;
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

    .agent-btn {
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
      color: #0891b2;
      transition: all 0.2s;
    }

    .agent-btn:hover {
      border-color: #0891b2;
      background: #ecfeff;
    }

    /* Agent 对话框 */
    .agent-dialog-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.2);
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .agent-dialog {
      width: 320px;
      background: white;
      border-radius: 16px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: dialogPop 0.2s ease-out;
    }

    @keyframes dialogPop {
      from {
        transform: scale(0.95);
        opacity: 0;
      }
      to {
        transform: scale(1);
        opacity: 1;
      }
    }

    .agent-dialog-header {
      padding: 16px 20px;
      border-bottom: 1px solid #f1f5f9;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .agent-dialog-header h3 {
      margin: 0;
      font-size: 16px;
      font-weight: 600;
      color: #1e293b;
    }

    .agent-list {
      max-height: 300px;
      overflow-y: auto;
      padding: 8px;
    }

    .agent-item {
      padding: 10px 12px;
      border-radius: 10px;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 2px;
      transition: all 0.2s;
      margin-bottom: 4px;
    }

    .agent-item:hover {
      background: #f8fafc;
    }

    .agent-item.active {
      background: #ecfeff;
      border: 1px solid #0891b2;
    }

    .agent-name-row {
      font-size: 14px;
      font-weight: 600;
      color: #1e293b;
    }

    .agent-desc-row {
      font-size: 12px;
      color: #64748b;
    }

    .agent-dialog-footer {
      padding: 12px 20px;
      background: #f8fafc;
      border-top: 1px solid #f1f5f9;
      display: flex;
      justify-content: flex-end;
      gap: 10px;
    }

    .dialog-btn {
      padding: 6px 14px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid transparent;
      transition: all 0.2s;
    }

    .dialog-btn.cancel {
      background: white;
      border-color: #e2e8f0;
      color: #64748b;
    }

    .dialog-btn.cancel:hover {
      background: #f1f5f9;
      color: #1e293b;
    }

    .dialog-btn.confirm {
      background: #0891b2;
      color: white;
    }

    .dialog-btn.confirm:hover {
      background: #0e7490;
    }

    .tool-toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 8px;
      border: 1px solid #e2e8f0;
      background: white;
      cursor: pointer;
      font-size: 12px;
      color: #64748b;
      transition: all 0.2s;
      user-select: none;
      white-space: nowrap;
    }

    .tool-toggle:hover {
      border-color: #94a3b8;
      background: #f8fafc;
    }

    .tool-toggle.active {
      color: #0891b2;
      border-color: #0891b2;
      background: #ecfeff;
    }

    .toggle-track {
      position: relative;
      width: 28px;
      height: 16px;
      border-radius: 8px;
      background: #cbd5e1;
      transition: background 0.2s;
      flex-shrink: 0;
    }

    .tool-toggle.active .toggle-track {
      background: #0891b2;
    }

    .toggle-thumb {
      position: absolute;
      top: 2px;
      left: 2px;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: white;
      transition: transform 0.2s;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
    }

    .tool-toggle.active .toggle-thumb {
      transform: translateX(12px);
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

    .notif-batch-actions {
      display: flex;
      gap: 8px;
      padding: 8px 16px;
      border-bottom: 1px solid #f1f5f9;
      flex-shrink: 0;
    }

    .notif-batch-btn {
      flex: 1;
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid transparent;
      transition: all 0.15s;
    }

    .notif-batch-btn.allow {
      background: #10b981;
      color: white;
      border-color: #10b981;
    }

    .notif-batch-btn.allow:hover {
      background: #059669;
    }

    .notif-batch-btn.deny {
      background: white;
      color: #ef4444;
      border-color: #fca5a5;
    }

    .notif-batch-btn.deny:hover {
      background: #fef2f2;
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

  private _onSummaryClick = () => {
    if (!this.session) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent("summary-click", {
        detail: { sessionKey: this.session.key },
        bubbles: true,
        composed: true,
      }),
    );
  };

  private _onArchive = () => {
    if (!this.session) {
      return;
    }
    this._confirmingAction = "archive";
  };

  private _onUnarchive = () => {
    if (!this.session) {
      return;
    }
    this._confirmingAction = "unarchive";
  };

  private _onConfirmAction = () => {
    if (!this.session || this._confirmingAction === "none") {
      return;
    }

    const action = this._confirmingAction;
    this._confirmingAction = "none";

    this.dispatchEvent(
      new CustomEvent(action === "archive" ? "session-archive" : "session-unarchive", {
        detail: { sessionKey: this.session.key },
        bubbles: true,
        composed: true,
      }),
    );
  };

  private _onCancelConfirm = () => {
    this._confirmingAction = "none";
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

  private _onBatchApprove = () => {
    const approvals = this.pendingApprovals;
    if (approvals.length === 0) {
      return;
    }
    this._notifOpen = false;
    for (const a of approvals) {
      this.dispatchEvent(
        new CustomEvent("resolve-approval", {
          detail: { id: a.id, decision: "allow-once" },
          bubbles: true,
          composed: true,
        }),
      );
    }
  };

  private _onBatchDeny = () => {
    const approvals = this.pendingApprovals;
    if (approvals.length === 0) {
      return;
    }
    this._notifOpen = false;
    for (const a of approvals) {
      this.dispatchEvent(
        new CustomEvent("resolve-approval", {
          detail: { id: a.id, decision: "deny" },
          bubbles: true,
          composed: true,
        }),
      );
    }
  };

  private _onAgentClick = () => {
    this._selectedAgentId = this.session?.currentAgentId || "default";
    this._agentDialogOpen = true;
  };

  private _onToggleToolMessages = () => {
    this.dispatchEvent(
      new CustomEvent("toggle-tool-messages", {
        detail: { show: !this.showToolMessages },
        bubbles: true,
        composed: true,
      }),
    );
  };

  private _onSelectAgentInList = (agentId: string) => {
    this._selectedAgentId = agentId;
  };

  private _onConfirmAgentUpdate = () => {
    this._agentDialogOpen = false;
    if (!this.session || this.session.currentAgentId === this._selectedAgentId) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent("session-agent-update", {
        detail: { sessionKey: this.session.key, agentId: this._selectedAgentId },
        bubbles: true,
        composed: true,
      }),
    );
  };

  private _renderAgentDialog() {
    if (!this._agentDialogOpen) {
      return nothing;
    }
    const agents = this._ctrl.store.agents;
    const currentSelection = this._selectedAgentId;

    return html`
      <div class="agent-dialog-overlay" @click=${() => (this._agentDialogOpen = false)}>
        <div class="agent-dialog" @click=${(e: Event) => e.stopPropagation()}>
          <div class="agent-dialog-header">
            <h3>选择执行 Agent</h3>
            <button class="notif-close-btn" @click=${() => (this._agentDialogOpen = false)}>
              ✕
            </button>
          </div>
          <div class="agent-list">
            ${agents.length === 0
              ? html`<div class="notif-empty">未发现可用 Agent</div>`
              : agents.map(
                  (a) => html`
                    <div
                      class="agent-item ${a.id === currentSelection ? "active" : ""}"
                      @click=${() => this._onSelectAgentInList(a.id)}
                    >
                      <div class="agent-name-row">${a.name || a.id}</div>
                      ${a.description
                        ? html`<div class="agent-desc-row">${a.description}</div>`
                        : ""}
                    </div>
                  `,
                )}
          </div>
          <div class="agent-dialog-footer">
            <button class="dialog-btn cancel" @click=${() => (this._agentDialogOpen = false)}>
              取消
            </button>
            <button class="dialog-btn confirm" @click=${this._onConfirmAgentUpdate}>确定</button>
          </div>
        </div>
      </div>
    `;
  }

  private _renderNotifPanel() {
    if (!this._notifOpen) {
      return nothing;
    }
    const approvals = this.pendingApprovals;
    const hasPending = approvals.length > 0;
    return html`
      <div class="notif-panel" role="dialog" aria-label="通知列表">
        <div class="notif-panel-header">
          <span>待审批通知 ${hasPending ? `(${approvals.length})` : ""}</span>
          <button class="notif-close-btn" @click=${this._onNotifClose} aria-label="关闭通知面板">
            ✕
          </button>
        </div>
        ${hasPending
          ? html`
              <div class="notif-batch-actions">
                <button class="notif-batch-btn deny" @click=${this._onBatchDeny}>全部拒绝</button>
                <button class="notif-batch-btn allow" @click=${this._onBatchApprove}>
                  全部批准 (${approvals.length})
                </button>
              </div>
            `
          : nothing}
        <div class="notif-list">
          ${!hasPending
            ? html` <div class="notif-empty">暂无待审批通知</div> `
            : approvals.map((a) => this._renderNotifItem(a))}
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
          <button class="notif-btn allow" @click=${() => this._onResolve(a.id, "allow-once")}>
            批准
          </button>
        </div>
      </div>
    `;
  }

  private _renderConfirmDialog() {
    if (this._confirmingAction === "none") {
      return nothing;
    }

    const isArchive = this._confirmingAction === "archive";
    return html`
      <confirm-dialog
        .title=${isArchive ? "归档会话" : "取消归档"}
        .message=${isArchive
          ? "归档后会话将冻结，成员无法继续发送消息，同时生成摘要。如需恢复可取消归档"
          : "取消归档后将恢复会话，成员可继续发送消息"}
        .confirmText=${isArchive ? "归档" : "恢复"}
        .confirmVariant=${isArchive ? "primary" : "primary"}
        @confirm=${this._onConfirmAction}
        @cancel=${this._onCancelConfirm}
      ></confirm-dialog>
    `;
  }

  render() {
    const isInitiator = this.session?.masType === "initiated";
    const isArchived = this.session?.archivedAt != null;

    return html`
      <div class="left">
        ${this.title
          ? html`
              <div class="session-info-col">
                <div class="session-title-row">
                  <svg
                    width="20"
                    height="20"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#2563eb"
                    stroke-width="2"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"></path>
                    <path d="M12 12v9"></path>
                    <path d="m16 16-4-4-4 4"></path>
                  </svg>
                  <span
                    >${this.title} ·
                    ${this.session?.currentAgentId ||
                    (this.session ? extractAgentNameFromKey(this.session.key) : "default")}</span
                  >
                </div>
              </div>
              ${isInitiator
                ? html`
                    <button class="agent-btn" @click=${this._onAgentClick} title="切换执行 Agent">
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path
                          d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"
                        ></path>
                        <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                        <line x1="12" y1="22.08" x2="12" y2="12"></line>
                      </svg>
                      切换
                    </button>
                  `
                : nothing}
              ${this.showInvite
                ? html`
                    <button class="invite-btn" @click=${this._onInviteClick} title="邀请协作者">
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      >
                        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
                        <circle cx="9" cy="7" r="4"></circle>
                        <line x1="19" y1="8" x2="19" y2="14"></line>
                        <line x1="22" y1="11" x2="16" y2="11"></line>
                      </svg>
                      邀请
                    </button>
                  `
                : nothing}
              ${isInitiator
                ? isArchived
                  ? html`
                      <button
                        class="archive-btn unarchive"
                        @click=${this._onUnarchive}
                        title="取消归档"
                        data-tip="取消归档后将恢复会话，&#10;成员可继续发送消息"
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        >
                          <path d="M3 10h18"></path>
                          <path d="M8 14h8"></path>
                          <path
                            d="M7 6v1a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1z"
                          ></path>
                          <path
                            d="M21 5h-2a1 1 0 0 0-1 1v1a1 1 0 0 0 1 1h2a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1z"
                          ></path>
                          <path d="M12 2v3"></path>
                        </svg>
                        取消归档
                      </button>
                    `
                  : html`
                      <button
                        class="archive-btn"
                        @click=${this._onArchive}
                        title="归档会话"
                        data-tip="归档后会话将冻结，同时生成摘要，&#10;成员无法继续发送消息。如需恢复可取消归档"
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        >
                          <polyline points="21 8 21 21 3 21 3 8"></polyline>
                          <rect x="1" y="3" width="22" height="5"></rect>
                          <line x1="10" y1="12" x2="14" y2="12"></line>
                        </svg>
                        归档
                      </button>
                    `
                : nothing}
              ${
                // 摘要按钮：未归档时所有成员可见；已归档时仅 owner 可见（需求 4.10）
                !isArchived || isInitiator
                  ? html`
                      <button
                        class="summary-btn"
                        @click=${this._onSummaryClick}
                        title="查看/生成摘要"
                      >
                        <svg
                          width="15"
                          height="15"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          stroke-width="2"
                          stroke-linecap="round"
                          stroke-linejoin="round"
                        >
                          <path
                            d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
                          ></path>
                          <polyline points="14 2 14 8 20 8"></polyline>
                          <line x1="16" y1="13" x2="8" y2="13"></line>
                          <line x1="16" y1="17" x2="8" y2="17"></line>
                          <polyline points="10 9 9 9 8 9"></polyline>
                        </svg>
                        摘要
                      </button>
                    `
                  : nothing
              }
              <span
                class="tool-toggle ${this.showToolMessages ? "active" : ""}"
                @click=${this._onToggleToolMessages}
                title=${this.showToolMessages ? "隐藏工具调用消息" : "显示工具调用消息"}
              >
                <span class="toggle-track"><span class="toggle-thumb"></span></span>
                工具消息
              </span>
            `
          : nothing}
      </div>

      <div class="right">
        <div class="notif-anchor">
          <notif-badge .count=${this.approvalCount} @notif-open=${this._onNotifOpen}></notif-badge>
          ${this._renderNotifPanel()}
        </div>
        <div class="user-info">
          <div class="user-avatar">
            ${this._ctrl.store.currentUser?.displayName?.charAt(0).toUpperCase() || "U"}
          </div>
          <span class="user-name">${this._ctrl.store.currentUser?.displayName || "User"}</span>
        </div>
      </div>

      ${this._renderConfirmDialog()} ${this._renderAgentDialog()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "main-header": MainHeader;
  }
}
