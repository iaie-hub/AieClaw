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
 * 主工作区顶部 Header — 重构版。
 *
 * 布局：左侧会话信息 + 中间操作按钮组 + 右侧通知/用户。
 * 视觉：磨砂玻璃质感，与 session-sidebar 的渐变体系保持一致。
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
    /* ── Host: frosted glass header ── */
    :host {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 64px;
      background: rgba(255, 255, 255, 0.72);
      backdrop-filter: blur(20px) saturate(1.6);
      -webkit-backdrop-filter: blur(20px) saturate(1.6);
      border-bottom: 1px solid rgba(226, 232, 240, 0.5);
      padding: 0 24px;
      flex-shrink: 0;
      z-index: 100;
      box-sizing: border-box;
      font-family: "DM Sans", "PingFang SC", "Noto Sans SC", system-ui, sans-serif;
      position: relative;
    }

    :host::after {
      content: "";
      position: absolute;
      bottom: -1px;
      left: 24px;
      right: 24px;
      height: 1px;
      background: #e2e8f0;
    }

    /* ── Left: session identity ── */
    .left {
      display: flex;
      align-items: center;
      gap: 14px;
      min-width: 0;
      flex: 1;
    }

    .session-identity {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
      max-width: 320px;
      flex-shrink: 1;
    }

    .session-icon {
      width: 34px;
      height: 34px;
      border-radius: 10px;
      background: #eff6ff;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      color: #2563eb;
    }

    .session-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .session-title {
      font-size: 15px;
      font-weight: 700;
      color: #1e293b;
      letter-spacing: -0.01em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.3;
    }

    .session-agent {
      font-size: 11px;
      font-weight: 500;
      color: #94a3b8;
      letter-spacing: 0.02em;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .agent-dot {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: #22c55e;
      flex-shrink: 0;
    }

    /* ── Divider between identity and actions ── */
    .v-divider {
      width: 1px;
      height: 28px;
      background: linear-gradient(180deg, transparent, #e2e8f0, transparent);
      flex-shrink: 0;
    }

    /* ── Center: action button group ── */
    .actions-group {
      display: flex;
      align-items: center;
      gap: 4px;
      background: rgba(241, 245, 249, 0.6);
      border: 1px solid rgba(226, 232, 240, 0.5);
      border-radius: 12px;
      padding: 3px;
      flex-shrink: 0;
    }

    .act-btn {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 5px 11px;
      border-radius: 9px;
      border: 1px solid transparent;
      background: transparent;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      font-family: inherit;
      color: #64748b;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      white-space: nowrap;
      line-height: 1;
    }

    .act-btn:hover {
      background: #ffffff;
      color: #1e293b;
      border-color: rgba(226, 232, 240, 0.8);
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
    }

    .act-btn.agent {
      color: #64748b;
    }
    .act-btn.agent:hover {
      background: #f8fafc;
      border-color: #e2e8f0;
      color: #1e293b;
    }

    .act-btn.invite {
      color: #64748b;
    }
    .act-btn.invite:hover {
      background: #f8fafc;
      border-color: #e2e8f0;
      color: #1e293b;
    }

    .act-btn.archive {
      color: #64748b;
    }
    .act-btn.archive:hover {
      background: #f8fafc;
      border-color: #e2e8f0;
      color: #1e293b;
    }

    .act-btn.unarchive {
      color: #64748b;
    }
    .act-btn.unarchive:hover {
      background: #f8fafc;
      border-color: #e2e8f0;
      color: #1e293b;
    }

    .act-btn.summary {
      color: #64748b;
    }
    .act-btn.summary:hover {
      background: #f8fafc;
      border-color: #e2e8f0;
      color: #1e293b;
    }

    /* CSS tooltip for action buttons */
    .act-btn {
      position: relative;
    }
    .act-btn::after {
      content: attr(data-tip);
      position: absolute;
      top: calc(100% + 8px);
      left: 50%;
      transform: translateX(-50%) scale(0.92);
      background: #1e293b;
      color: #f1f5f9;
      font-size: 11px;
      font-weight: 500;
      white-space: pre-wrap;
      line-height: 1.5;
      text-align: center;
      width: max-content;
      max-width: 240px;
      padding: 5px 10px;
      border-radius: 8px;
      pointer-events: none;
      opacity: 0;
      transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
      z-index: 200;
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
    }
    .act-btn:hover::after {
      opacity: 1;
      transform: translateX(-50%) scale(1);
    }

    /* ── Tool toggle (pill switch) ── */
    .tool-toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px 11px;
      border-radius: 9px;
      border: 1px solid transparent;
      background: transparent;
      cursor: pointer;
      font-size: 12px;
      font-weight: 600;
      font-family: inherit;
      color: #94a3b8;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      user-select: none;
      white-space: nowrap;
      line-height: 1;
    }

    .tool-toggle:hover {
      background: #ffffff;
      color: #64748b;
      border-color: rgba(226, 232, 240, 0.8);
    }

    .tool-toggle.active {
      color: #3b82f6;
    }

    .toggle-track {
      position: relative;
      width: 26px;
      height: 14px;
      border-radius: 7px;
      background: #d1d5db;
      transition: background 0.2s;
      flex-shrink: 0;
    }

    .tool-toggle.active .toggle-track {
      background: #3b82f6;
    }

    .toggle-thumb {
      position: absolute;
      top: 2px;
      left: 2px;
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: white;
      transition: transform 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
    }

    .tool-toggle.active .toggle-thumb {
      transform: translateX(12px);
    }

    /* ── Right: notifications + user ── */
    .right {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-shrink: 0;
    }

    .notif-anchor {
      position: relative;
    }

    .user-chip {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 12px 4px 4px;
      border-radius: 22px;
      background: rgba(241, 245, 249, 0.6);
      border: 1px solid rgba(226, 232, 240, 0.5);
      cursor: default;
      transition: all 0.2s;
    }

    .user-chip:hover {
      background: rgba(241, 245, 249, 0.9);
      border-color: rgba(226, 232, 240, 0.8);
    }

    .user-avatar {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: #64748b;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: 700;
      font-size: 12px;
      letter-spacing: -0.02em;
      flex-shrink: 0;
    }

    .user-name {
      font-size: 13px;
      color: #475569;
      font-weight: 600;
      letter-spacing: -0.005em;
    }

    /* ── Notification panel ── */
    .notif-panel {
      position: absolute;
      top: calc(100% + 10px);
      right: 0;
      width: 380px;
      max-height: 500px;
      background: rgba(255, 255, 255, 0.92);
      backdrop-filter: blur(24px) saturate(1.4);
      -webkit-backdrop-filter: blur(24px) saturate(1.4);
      border: 1px solid rgba(226, 232, 240, 0.6);
      border-radius: 16px;
      box-shadow:
        0 12px 40px rgba(0, 0, 0, 0.1),
        0 0 0 1px rgba(0, 0, 0, 0.02);
      z-index: 100;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: panelReveal 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }

    @keyframes panelReveal {
      from {
        opacity: 0;
        transform: translateY(-6px) scale(0.97);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    .notif-panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 18px 12px;
      border-bottom: 1px solid rgba(241, 245, 249, 0.8);
      font-size: 14px;
      font-weight: 700;
      color: #1e293b;
      letter-spacing: -0.01em;
      flex-shrink: 0;
    }

    .notif-batch-actions {
      display: flex;
      gap: 8px;
      padding: 10px 18px;
      border-bottom: 1px solid rgba(241, 245, 249, 0.8);
      flex-shrink: 0;
    }

    .notif-batch-btn {
      flex: 1;
      padding: 7px 14px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 700;
      font-family: inherit;
      cursor: pointer;
      border: 1px solid transparent;
      transition: all 0.15s;
    }

    .notif-batch-btn.allow {
      background: linear-gradient(135deg, #10b981, #059669);
      color: white;
      box-shadow: 0 2px 8px rgba(16, 185, 129, 0.25);
    }

    .notif-batch-btn.allow:hover {
      box-shadow: 0 4px 14px rgba(16, 185, 129, 0.35);
      transform: translateY(-1px);
    }

    .notif-batch-btn.deny {
      background: white;
      color: #ef4444;
      border-color: #fecaca;
    }

    .notif-batch-btn.deny:hover {
      background: #fef2f2;
      border-color: #fca5a5;
    }

    .notif-close-btn {
      background: none;
      border: none;
      cursor: pointer;
      color: #94a3b8;
      font-size: 15px;
      padding: 4px 6px;
      border-radius: 6px;
      line-height: 1;
      transition: all 0.15s;
    }

    .notif-close-btn:hover {
      color: #475569;
      background: rgba(241, 245, 249, 0.8);
    }

    .notif-list {
      overflow-y: auto;
      flex: 1;
    }

    .notif-empty {
      padding: 36px 18px;
      text-align: center;
      color: #94a3b8;
      font-size: 13px;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 8px;
    }

    .notif-empty-icon {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background: rgba(148, 163, 184, 0.08);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #cbd5e1;
    }

    .notif-item {
      padding: 14px 18px;
      border-bottom: 1px solid rgba(241, 245, 249, 0.6);
      display: flex;
      flex-direction: column;
      gap: 8px;
      transition: background 0.15s;
    }

    .notif-item:hover {
      background: rgba(248, 250, 252, 0.6);
    }

    .notif-item:last-child {
      border-bottom: none;
    }

    .notif-item-top {
      display: flex;
      align-items: flex-start;
      gap: 10px;
    }

    .notif-icon {
      width: 28px;
      height: 28px;
      border-radius: 8px;
      background: rgba(245, 158, 11, 0.1);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      color: #f59e0b;
    }

    .notif-content {
      flex: 1;
      min-width: 0;
    }

    .notif-command {
      font-size: 13px;
      font-weight: 700;
      color: #1e293b;
      font-family: "JetBrains Mono", "SF Mono", "Fira Code", monospace;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      letter-spacing: -0.01em;
    }

    .notif-meta {
      font-size: 11px;
      color: #94a3b8;
      margin-top: 3px;
      font-weight: 500;
    }

    .notif-ask {
      font-size: 12px;
      color: #475569;
      background: rgba(241, 245, 249, 0.6);
      border: 1px solid rgba(226, 232, 240, 0.4);
      border-radius: 8px;
      padding: 8px 10px;
      line-height: 1.5;
    }

    .notif-actions {
      display: flex;
      gap: 6px;
      justify-content: flex-end;
    }

    .notif-btn {
      padding: 5px 14px;
      border-radius: 7px;
      font-size: 12px;
      font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      border: 1px solid transparent;
      transition: all 0.15s;
    }

    .notif-btn.allow {
      background: #10b981;
      color: white;
    }

    .notif-btn.allow:hover {
      background: #059669;
    }

    .notif-btn.deny {
      background: white;
      color: #ef4444;
      border-color: #fecaca;
    }

    .notif-btn.deny:hover {
      background: #fef2f2;
    }

    /* ── Agent dialog ── */
    .agent-dialog-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(15, 23, 42, 0.3);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .agent-dialog {
      width: 340px;
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(24px);
      -webkit-backdrop-filter: blur(24px);
      border-radius: 20px;
      border: 1px solid rgba(226, 232, 240, 0.5);
      box-shadow:
        0 20px 60px rgba(0, 0, 0, 0.12),
        0 0 0 1px rgba(0, 0, 0, 0.03);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: dialogPop 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }

    @keyframes dialogPop {
      from {
        transform: scale(0.92) translateY(8px);
        opacity: 0;
      }
      to {
        transform: scale(1) translateY(0);
        opacity: 1;
      }
    }

    .agent-dialog-header {
      padding: 18px 22px;
      border-bottom: 1px solid rgba(241, 245, 249, 0.8);
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .agent-dialog-header h3 {
      margin: 0;
      font-size: 16px;
      font-weight: 700;
      color: #1e293b;
      letter-spacing: -0.01em;
    }

    .agent-list {
      max-height: 320px;
      overflow-y: auto;
      padding: 8px;
    }

    .agent-item {
      padding: 12px 14px;
      border-radius: 12px;
      cursor: pointer;
      display: flex;
      flex-direction: column;
      gap: 3px;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      margin-bottom: 4px;
      border: 1px solid transparent;
    }

    .agent-item:hover {
      background: rgba(248, 250, 252, 0.8);
      border-color: rgba(226, 232, 240, 0.5);
    }

    .agent-item.active {
      background: #ecfeff;
      border-color: rgba(8, 145, 178, 0.25);
      box-shadow: 0 0 0 1px rgba(8, 145, 178, 0.08);
    }

    .agent-name-row {
      font-size: 14px;
      font-weight: 700;
      color: #1e293b;
      letter-spacing: -0.005em;
    }

    .agent-desc-row {
      font-size: 12px;
      color: #64748b;
      line-height: 1.4;
    }

    .agent-dialog-footer {
      padding: 14px 22px;
      background: rgba(248, 250, 252, 0.6);
      border-top: 1px solid rgba(241, 245, 249, 0.8);
      display: flex;
      justify-content: flex-end;
      gap: 10px;
    }

    .dialog-btn {
      padding: 8px 18px;
      border-radius: 10px;
      font-size: 13px;
      font-weight: 700;
      font-family: inherit;
      cursor: pointer;
      border: 1px solid transparent;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      letter-spacing: -0.005em;
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
      background: linear-gradient(135deg, #0891b2, #0e7490);
      color: white;
      box-shadow: 0 2px 8px rgba(8, 145, 178, 0.3);
    }

    .dialog-btn.confirm:hover {
      box-shadow: 0 4px 14px rgba(8, 145, 178, 0.4);
      transform: translateY(-1px);
    }

    /* ── Responsive ── */
    @media (max-width: 768px) {
      :host {
        padding: 0 14px;
        height: 56px;
      }

      .session-title {
        font-size: 13px;
      }

      .act-btn span {
        display: none;
      }

      .act-btn {
        padding: 6px 8px;
      }

      .user-name {
        display: none;
      }

      .user-chip {
        padding: 4px;
        border-radius: 50%;
      }

      .tool-toggle span:last-child {
        display: none;
      }
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
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
          <div class="agent-list">
            ${agents.length === 0
              ? html`<div class="notif-empty">
                  <div class="notif-empty-icon">
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
                      <circle cx="12" cy="12" r="10"></circle>
                      <line x1="8" y1="12" x2="16" y2="12"></line>
                    </svg>
                  </div>
                  未发现可用 Agent
                </div>`
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
              <line x1="18" y1="6" x2="6" y2="18"></line>
              <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
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
            ? html`
                <div class="notif-empty">
                  <div class="notif-empty-icon">
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
                      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                    </svg>
                  </div>
                  暂无待审批通知
                </div>
              `
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
          <div class="notif-icon">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
            </svg>
          </div>
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
    const agentName =
      this.session?.currentAgentId ||
      (this.session ? extractAgentNameFromKey(this.session.key) : "default");

    return html`
      <!-- Left: session identity -->
      <div class="left">
        ${this.title
          ? html`
              <div class="session-identity">
                <div class="session-icon">
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <path d="M4 14.899A7 7 0 1 1 15.71 8h1.79a4.5 4.5 0 0 1 2.5 8.242"></path>
                    <path d="M12 12v9"></path>
                    <path d="m16 16-4-4-4 4"></path>
                  </svg>
                </div>
                <div class="session-text">
                  <span class="session-title">${this.title}</span>
                  <span class="session-agent">
                    <span class="agent-dot"></span>
                    ${agentName}
                  </span>
                </div>
              </div>

              <span class="v-divider"></span>

              <!-- Action buttons group -->
              <div class="actions-group">
                ${isInitiator
                  ? html`
                      <button
                        class="act-btn agent"
                        @click=${this._onAgentClick}
                        data-tip="切换执行 Agent"
                      >
                        <svg
                          width="13"
                          height="13"
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
                        <span>切换</span>
                      </button>
                    `
                  : nothing}
                ${this.showInvite
                  ? html`
                      <button
                        class="act-btn invite"
                        @click=${this._onInviteClick}
                        data-tip="邀请协作者"
                      >
                        <svg
                          width="13"
                          height="13"
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
                        <span>邀请</span>
                      </button>
                    `
                  : nothing}
                ${isInitiator
                  ? isArchived
                    ? html`
                        <button
                          class="act-btn unarchive"
                          @click=${this._onUnarchive}
                          data-tip="取消归档后将恢复会话，&#10;成员可继续发送消息"
                        >
                          <svg
                            width="13"
                            height="13"
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
                          <span>取消归档</span>
                        </button>
                      `
                    : html`
                        <button
                          class="act-btn archive"
                          @click=${this._onArchive}
                          data-tip="归档后会话将冻结，同时生成摘要，&#10;成员无法继续发送消息"
                        >
                          <svg
                            width="13"
                            height="13"
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
                          <span>归档</span>
                        </button>
                      `
                  : nothing}
                ${!isArchived || isInitiator
                  ? html`
                      <button
                        class="act-btn summary"
                        @click=${this._onSummaryClick}
                        data-tip="查看/生成摘要"
                      >
                        <svg
                          width="13"
                          height="13"
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
                        <span>摘要</span>
                      </button>
                    `
                  : nothing}

                <span
                  class="tool-toggle ${this.showToolMessages ? "active" : ""}"
                  @click=${this._onToggleToolMessages}
                  title=${this.showToolMessages ? "隐藏工具调用消息" : "显示工具调用消息"}
                >
                  <span class="toggle-track"><span class="toggle-thumb"></span></span>
                  <span>工具</span>
                </span>
              </div>
            `
          : nothing}
      </div>

      <!-- Right: notifications + user -->
      <div class="right">
        <div class="notif-anchor">
          <notif-badge .count=${this.approvalCount} @notif-open=${this._onNotifOpen}></notif-badge>
          ${this._renderNotifPanel()}
        </div>
        <div class="user-chip">
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
