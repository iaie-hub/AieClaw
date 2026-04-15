import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { MasSession } from "../types/session-types.js";
import "./session-name-dialog.js";
import "./session-create-control.js";

/**
 * 会话列表侧边栏（280px 宽）。
 * 仅在工作台视图显示。
 */
@customElement("session-sidebar")
export class SessionSidebar extends LitElement {
  @property({ attribute: false }) sessions: MasSession[] = [];
  @property({ attribute: false }) agents: import("../store/app-store.js").AgentInfo[] = [];
  @property({ type: String }) activeSessionKey: string | null = null;

  @state() private _nameDialog: {
    mode: "create" | "rename";
    sessionKey?: string;
    value: string;
    agentId?: string;
    reasoningLevel: "stream" | "on" | "off";
  } | null = null;

  @state() private _deleteConfirm: { sessionKey: string; label: string } | null = null;

  @state() private _refreshing = false;
  @state() private _recentExpanded = true;
  @state() private _initiatedExpanded = true;
  @state() private _participatedExpanded = false;
  @state() private _sidebarCollapsed = false;

  static styles = css`
    /* ── Host ── */
    :host {
      display: flex;
      flex-direction: column;
      width: 280px;
      min-width: 280px;
      height: 100vh;
      background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
      border-right: 1px solid rgba(226, 232, 240, 0.7);
      flex-shrink: 0;
      box-sizing: border-box;
      transition:
        width 0.3s cubic-bezier(0.4, 0, 0.2, 1),
        min-width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      overflow: hidden;
      position: relative;
      font-family: "DM Sans", "PingFang SC", "Noto Sans SC", system-ui, sans-serif;
    }

    :host([collapsed]) {
      width: 40px;
      min-width: 40px;
    }

    /* ── Sidebar Header ── */
    .sidebar-header {
      height: 70px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 18px;
      border-bottom: 1px solid rgba(226, 232, 240, 0.6);
      flex-shrink: 0;
      transition: padding 0.3s;
      overflow: hidden;
      position: relative;
    }

    .sidebar-header::after {
      content: "";
      position: absolute;
      bottom: -1px;
      left: 18px;
      right: 18px;
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(59, 130, 246, 0.15), transparent);
    }

    :host([collapsed]) .sidebar-header {
      padding: 0;
      justify-content: center;
    }

    .sidebar-title {
      display: flex;
      align-items: center;
      gap: 10px;
      white-space: nowrap;
      transition:
        opacity 0.2s,
        width 0.2s;
    }

    .sidebar-title-icon {
      width: 32px;
      height: 32px;
      border-radius: 10px;
      background: #eff6ff;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      color: #2563eb;
    }

    .sidebar-title-text {
      font-weight: 700;
      font-size: 15px;
      color: #1e293b;
      letter-spacing: -0.01em;
    }

    :host([collapsed]) .sidebar-title {
      opacity: 0;
      width: 0;
      pointer-events: none;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 6px;
      transition: opacity 0.2s;
    }

    :host([collapsed]) .header-actions {
      gap: 0;
    }

    :host([collapsed]) .refresh-btn,
    :host([collapsed]) session-create-control {
      display: none;
    }

    /* ── Refresh Button ── */
    .refresh-btn {
      width: 30px;
      height: 30px;
      border-radius: 9px;
      background: transparent;
      border: 1px solid #e2e8f0;
      color: #94a3b8;
      font-size: 14px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .refresh-btn:hover {
      background: #f8fafc;
      border-color: #cbd5e1;
      color: #64748b;
    }

    .refresh-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }

    .refresh-btn.spinning svg {
      animation: spin 0.6s linear infinite;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    /* ── Toggle Sidebar Button ── */
    .toggle-sidebar-btn {
      width: 30px;
      height: 30px;
      border-radius: 9px;
      background: transparent;
      border: 1px solid transparent;
      color: #94a3b8;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }

    .toggle-sidebar-btn:hover {
      background: rgba(100, 116, 139, 0.08);
      border-color: rgba(100, 116, 139, 0.12);
      color: #475569;
    }

    :host([collapsed]) .toggle-sidebar-btn {
      width: 40px;
      height: 40px;
      border-radius: 10px;
    }

    /* ── Session List Container ── */
    .session-list {
      flex: 1;
      overflow-y: auto;
      padding: 6px 0 12px;
      transition: opacity 0.2s;
    }

    :host([collapsed]) .session-list {
      opacity: 0;
      pointer-events: none;
    }

    /* ── Group Header ── */
    .group-header {
      padding: 8px 6px 8px 16px;
      margin: 6px 10px 4px;
      font-size: 13px;
      font-weight: 700;
      color: #475569;
      letter-spacing: 0.02em;
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      user-select: none;
      border-radius: 8px;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .group-header:hover {
      background: rgba(100, 116, 139, 0.06);
      color: #334155;
    }

    .group-header-arrow {
      width: 14px;
      height: 14px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      flex-shrink: 0;
      opacity: 0.6;
    }

    .group-header-arrow.collapsed {
      transform: rotate(-90deg);
    }

    .group-header-icon {
      width: 24px;
      height: 24px;
      border-radius: 6px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .group-header-icon.initiated {
      background: #f1f5f9;
      color: #64748b;
    }

    .group-header-icon.participated {
      background: #f1f5f9;
      color: #64748b;
    }

    .group-header-icon.recent {
      background: #f1f5f9;
      color: #64748b;
    }

    .group-count {
      margin-left: auto;
      font-size: 10px;
      font-weight: 600;
      color: #cbd5e1;
      background: rgba(203, 213, 225, 0.2);
      padding: 1px 6px;
      border-radius: 10px;
      min-width: 18px;
      text-align: center;
    }

    /* ── Group Items Container ── */
    .group-items {
      position: relative;
      padding-left: 0;
      margin-bottom: 2px;
      animation: groupReveal 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    }

    @keyframes groupReveal {
      from {
        opacity: 0;
        transform: translateY(-4px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .group-items::before {
      content: "";
      position: absolute;
      left: 28px;
      top: 4px;
      bottom: 4px;
      width: 1.5px;
      background: linear-gradient(180deg, #e2e8f0 0%, transparent 100%);
      border-radius: 1px;
    }

    .group-divider {
      height: 1px;
      background: linear-gradient(90deg, transparent 10%, #e2e8f0 50%, transparent 90%);
      margin: 8px 20px;
    }

    /* ── Session Item ── */
    .session-item {
      min-height: 34px;
      display: flex;
      align-items: center;
      padding: 4px 10px 4px 48px;
      cursor: pointer;
      border-radius: 10px;
      margin: 1px 8px;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      font-size: 13px;
      color: #64748b;
      border: 1px solid transparent;
      background: transparent;
      width: calc(100% - 16px);
      text-align: left;
      box-sizing: border-box;
      position: relative;
    }

    .session-item:hover {
      background: rgba(255, 255, 255, 0.85);
      color: #334155;
      border-color: rgba(226, 232, 240, 0.6);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
      transform: translateX(2px);
    }

    .session-item.active {
      background: #f8fafc;
      color: #1e293b;
      font-weight: 600;
      border-color: #e2e8f0;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
      transform: translateX(2px);
    }

    .session-item.active::before {
      content: "";
      position: absolute;
      left: -1px;
      top: 8px;
      bottom: 8px;
      width: 3px;
      border-radius: 0 3px 3px 0;
      background: #2563eb;
    }

    .session-item.archived {
      opacity: 0.55;
    }

    .session-item.archived:hover {
      opacity: 0.75;
    }

    /* ── Session Item Body ── */
    .session-item-body {
      flex: 1;
      display: flex;
      flex-direction: row;
      align-items: center;
      justify-content: flex-start;
      overflow: hidden;
      gap: 6px;
      position: relative;
    }

    .session-label {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
      line-height: 1.4;
      letter-spacing: -0.005em;
    }

    .session-item.active .session-label {
      background: linear-gradient(135deg, #1e293b, #334155);
      -webkit-background-clip: text;
      background-clip: text;
    }

    .archived-icon {
      display: inline-flex;
      align-items: center;
      margin-right: 4px;
      opacity: 0.6;
    }

    .session-time {
      font-size: 10px;
      color: #b0bec5;
      font-variant-numeric: tabular-nums;
      letter-spacing: 0.02em;
      white-space: nowrap;
      flex-shrink: 0;
      line-height: 1.2;
      font-family: "JetBrains Mono", "SF Mono", "Fira Code", monospace;
    }

    .session-item.active .session-time {
      color: #93c5fd;
    }

    /* ── Notification Badges ── */
    .badge-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #ef4444;
      flex-shrink: 0;
      margin-left: auto;
      box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.2);
      animation: badgePulse 2s ease-in-out infinite;
    }

    @keyframes badgePulse {
      0%,
      100% {
        box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.2);
      }
      50% {
        box-shadow: 0 0 0 5px rgba(239, 68, 68, 0.08);
      }
    }

    .badge-count {
      background: #1e293b;
      color: white;
      border-radius: 10px;
      padding: 1px 7px;
      font-size: 10px;
      font-weight: 700;
      flex-shrink: 0;
      margin-left: auto;
      letter-spacing: 0.02em;
    }

    /* ── Item Actions (hover overlay) ── */
    .item-actions {
      position: absolute;
      right: 0;
      top: 50%;
      transform: translateY(-50%);
      display: flex;
      align-items: center;
      gap: 1px;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border-radius: 8px;
      padding: 3px 4px;
      border: 1px solid rgba(226, 232, 240, 0.5);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
    }

    .session-item:hover .item-actions {
      opacity: 1;
      pointer-events: auto;
    }

    .rename-btn,
    .delete-btn,
    .refresh-item-btn {
      background: none;
      border: none;
      cursor: pointer;
      color: #94a3b8;
      padding: 4px 5px;
      border-radius: 6px;
      flex-shrink: 0;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      line-height: 1;
      position: relative;
      display: flex;
      align-items: center;
    }

    .rename-btn:hover {
      color: #3b82f6;
      background: rgba(59, 130, 246, 0.1);
    }

    .delete-btn:hover {
      color: #ef4444;
      background: rgba(239, 68, 68, 0.08);
    }

    .refresh-item-btn:hover {
      color: #10b981;
      background: rgba(16, 185, 129, 0.1);
    }

    /* CSS tooltip */
    .rename-btn::after,
    .delete-btn::after,
    .refresh-item-btn::after {
      content: attr(data-tip);
      position: absolute;
      bottom: calc(100% + 8px);
      left: 50%;
      transform: translateX(-50%) scale(0.95);
      background: #1e293b;
      color: #f1f5f9;
      font-size: 11px;
      font-weight: 500;
      white-space: nowrap;
      padding: 4px 10px;
      border-radius: 7px;
      pointer-events: none;
      opacity: 0;
      transition: all 0.15s cubic-bezier(0.4, 0, 0.2, 1);
      z-index: 100;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
    }

    .rename-btn:hover::after,
    .delete-btn:hover::after,
    .refresh-item-btn:hover::after {
      opacity: 1;
      transform: translateX(-50%) scale(1);
    }

    /* ── Empty State ── */
    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 16px 16px;
      color: #cbd5e1;
      font-size: 12px;
      gap: 6px;
    }

    .empty-state-icon {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background: rgba(203, 213, 225, 0.15);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #cbd5e1;
    }

    /* ── Delete Confirm Dialog ── */
    .confirm-overlay {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.4);
      backdrop-filter: blur(4px);
      -webkit-backdrop-filter: blur(4px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }

    .confirm-dialog {
      background: #ffffff;
      border-radius: 16px;
      padding: 28px;
      width: 340px;
      box-shadow:
        0 20px 60px rgba(0, 0, 0, 0.15),
        0 0 0 1px rgba(0, 0, 0, 0.05);
      animation: dialogAppear 0.25s cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    @keyframes dialogAppear {
      from {
        opacity: 0;
        transform: scale(0.92) translateY(8px);
      }
      to {
        opacity: 1;
        transform: scale(1) translateY(0);
      }
    }

    .confirm-dialog-icon {
      width: 44px;
      height: 44px;
      border-radius: 12px;
      background: rgba(239, 68, 68, 0.08);
      display: flex;
      align-items: center;
      justify-content: center;
      margin-bottom: 16px;
      color: #ef4444;
    }

    .confirm-dialog h3 {
      margin: 0 0 10px;
      font-size: 17px;
      font-weight: 700;
      color: #1e293b;
      letter-spacing: -0.01em;
    }

    .confirm-dialog p {
      margin: 0 0 24px;
      font-size: 14px;
      color: #64748b;
      line-height: 1.6;
    }

    .confirm-dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
    }

    .confirm-dialog-actions button {
      padding: 9px 18px;
      border-radius: 10px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid #e2e8f0;
      background: white;
      color: #64748b;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      letter-spacing: -0.005em;
    }

    .confirm-dialog-actions button:hover {
      background: #f8fafc;
      color: #1e293b;
      border-color: #cbd5e1;
    }

    .confirm-dialog-actions button.danger {
      background: linear-gradient(135deg, #ef4444, #dc2626);
      color: white;
      border-color: transparent;
      box-shadow: 0 2px 8px rgba(239, 68, 68, 0.3);
    }

    .confirm-dialog-actions button.danger:hover {
      box-shadow: 0 4px 16px rgba(239, 68, 68, 0.4);
      transform: translateY(-1px);
    }
  `;

  private _onRefresh() {
    if (this._refreshing) {
      return;
    }
    this._refreshing = true;
    this.dispatchEvent(new CustomEvent("session-refresh", { bubbles: true }));
    // 最多 3s 后自动复位，防止事件未响应时按钮卡住
    setTimeout(() => {
      this._refreshing = false;
    }, 3000);
  }

  /** 由外部在刷新完成后调用，复位旋转状态 */
  refreshDone() {
    this._refreshing = false;
  }

  private _onRename(e: Event, session: MasSession) {
    // Stop propagation so the session-item click doesn't fire
    e.stopPropagation();
    this._nameDialog = {
      mode: "rename",
      sessionKey: session.key,
      value: session.label ?? "",
      reasoningLevel: (session.reasoningLevel as "stream" | "on" | "off") ?? "stream",
    };
  }

  private _onDelete(e: Event, session: MasSession) {
    e.stopPropagation();
    this._deleteConfirm = {
      sessionKey: session.key,
      label: session.label ?? session.key,
    };
  }

  private _onHistoryRefresh(e: Event, session: MasSession) {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("session-history-refresh", {
        detail: { sessionKey: session.key },
        bubbles: true,
      }),
    );
  }

  private _onDeleteConfirm() {
    if (!this._deleteConfirm) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent("session-delete", {
        detail: { sessionKey: this._deleteConfirm.sessionKey },
        bubbles: true,
      }),
    );
    this._deleteConfirm = null;
  }

  private _onNameConfirm(detail: {
    label: string;
    agentId?: string;
    reasoningLevel: "stream" | "on" | "off";
  }) {
    if (!this._nameDialog) {
      return;
    }
    const { mode, sessionKey } = this._nameDialog;
    const { label, reasoningLevel } = detail;

    if (mode === "rename" && sessionKey) {
      this.dispatchEvent(
        new CustomEvent("session-rename", {
          detail: { sessionKey, label, reasoningLevel },
          bubbles: true,
        }),
      );
    }
    this._nameDialog = null;
  }

  private _onSessionClick(key: string) {
    this.dispatchEvent(
      new CustomEvent("session-select", { detail: { sessionKey: key }, bubbles: true }),
    );
  }

  private get _recentSessions() {
    return [...this.sessions]
      .toSorted((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
      .slice(0, 10);
  }

  private get _initiatedSessions() {
    return this.sessions.filter((s) => s.masType === "initiated");
  }

  private get _participatedSessions() {
    return this.sessions.filter((s) => s.masType === "participated");
  }

  private _formatTime(ts: number | null | undefined): string {
    if (!ts) {
      return "";
    }
    const now = new Date();
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, "0");

    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();

    if (sameDay) {
      return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    if (d.getFullYear() === now.getFullYear()) {
      return `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    }

    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  private _renderSession(session: MasSession) {
    const isActive = session.key === this.activeSessionKey;
    const isArchived = session.archivedAt != null;
    const label = session.label ?? session.key;
    const timeStr = this._formatTime(session.updatedAt);
    return html`
      <div
        class="session-item ${isActive ? "active" : ""} ${isArchived ? "archived" : ""}"
        role="button"
        tabindex="0"
        @click=${() => this._onSessionClick(session.key)}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            this._onSessionClick(session.key);
          }
        }}
        title=${label}
      >
        <div class="session-item-body">
          <span class="session-label"
            >${isArchived
              ? html`<span class="archived-icon">
                    <svg
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <polyline points="21 8 21 21 3 21 3 8"></polyline>
                      <rect x="1" y="3" width="22" height="5"></rect>
                    </svg> </span
                  >${label}`
              : label}</span
          >
          ${timeStr ? html`<span class="session-time">${timeStr}</span>` : nothing}
          ${session.masType === "initiated"
            ? html` <div class="item-actions">
                <button
                  class="refresh-item-btn"
                  data-tip="同步历史"
                  @click=${(e: Event) => this._onHistoryRefresh(e, session)}
                  aria-label="同步历史"
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
                    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
                    <path d="M21 3v5h-5" />
                    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
                    <path d="M8 16H3v5" />
                  </svg>
                </button>
                <button
                  class="rename-btn"
                  data-tip="重命名"
                  @click=${(e: Event) => this._onRename(e, session)}
                  aria-label="重命名会话"
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
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                  </svg>
                </button>
                <button
                  class="delete-btn"
                  data-tip="删除会话"
                  @click=${(e: Event) => this._onDelete(e, session)}
                  aria-label="删除会话"
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
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6" />
                    <path d="M14 11v6" />
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" />
                  </svg>
                </button>
              </div>`
            : nothing}
        </div>
        ${session.hasNotification ? html` <span class="badge-dot"></span> ` : nothing}
        ${!session.hasNotification && session.notificationCount > 0
          ? html`<span class="badge-count">${session.notificationCount}</span>`
          : nothing}
      </div>
    `;
  }

  private _renderDeleteConfirm() {
    if (!this._deleteConfirm) {
      return nothing;
    }
    const { label } = this._deleteConfirm;
    return html`
      <div class="confirm-overlay" @click=${() => (this._deleteConfirm = null)}>
        <div class="confirm-dialog" @click=${(e: Event) => e.stopPropagation()}>
          <div class="confirm-dialog-icon">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path>
              <path d="M10 11v6"></path>
              <path d="M14 11v6"></path>
              <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"></path>
            </svg>
          </div>
          <h3>删除会话</h3>
          <p>确定要删除会话「${label}」吗？此操作不可撤销，消息记录也将一并删除。</p>
          <div class="confirm-dialog-actions">
            <button @click=${() => (this._deleteConfirm = null)}>取消</button>
            <button class="danger" @click=${() => this._onDeleteConfirm()}>删除</button>
          </div>
        </div>
      </div>
    `;
  }

  private _renderNameDialog() {
    if (!this._nameDialog) {
      return nothing;
    }
    const { mode, value, agentId, reasoningLevel } = this._nameDialog;
    return html`
      <session-name-dialog
        .mode=${mode}
        .initialValue=${value}
        .initialAgentId=${agentId}
        .initialReasoningLevel=${reasoningLevel}
        .agents=${this.agents}
        @confirm=${(e: CustomEvent) => this._onNameConfirm(e.detail)}
        @cancel=${() => (this._nameDialog = null)}
      ></session-name-dialog>
    `;
  }

  private _toggleSidebar() {
    this._sidebarCollapsed = !this._sidebarCollapsed;
    if (this._sidebarCollapsed) {
      this.setAttribute("collapsed", "");
    } else {
      this.removeAttribute("collapsed");
    }
  }

  private _toggleRecent() {
    this._recentExpanded = !this._recentExpanded;
  }

  private _toggleInitiated() {
    this._initiatedExpanded = !this._initiatedExpanded;
  }

  private _toggleParticipated() {
    this._participatedExpanded = !this._participatedExpanded;
  }

  private _renderEmptyGroup(message: string) {
    return html`
      <div class="empty-state">
        <div class="empty-state-icon">
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
        <span>${message}</span>
      </div>
    `;
  }

  render() {
    const initiatedCount = this._initiatedSessions.length;
    const participatedCount = this._participatedSessions.length;
    const recentCount = this._recentSessions.length;

    return html`
      <div class="sidebar-header">
        <div class="sidebar-title">
          <div class="sidebar-title-icon">
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
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
          </div>
          <span class="sidebar-title-text">会话</span>
        </div>
        <div class="header-actions">
          <button
            class="refresh-btn ${this._refreshing ? "spinning" : ""}"
            @click=${() => this._onRefresh()}
            aria-label="刷新会话列表"
            title="刷新会话列表"
            ?disabled=${this._refreshing}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
              <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16" />
              <path d="M8 16H3v5" />
            </svg>
          </button>
          <session-create-control .agents=${this.agents}></session-create-control>
          <button
            class="toggle-sidebar-btn"
            @click=${() => this._toggleSidebar()}
            aria-label=${this._sidebarCollapsed ? "展开侧边栏" : "折叠侧边栏"}
            title=${this._sidebarCollapsed ? "展开侧边栏" : "折叠侧边栏"}
          >
            ${this._sidebarCollapsed
              ? html`
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
                    <polyline points="13 17 18 12 13 7" />
                    <polyline points="6 17 11 12 6 7" />
                  </svg>
                `
              : html`
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
                    <polyline points="11 17 6 12 11 7" />
                    <polyline points="18 17 13 12 18 7" />
                  </svg>
                `}
          </button>
        </div>
      </div>

      <div class="session-list">
        <!-- 发起的会话 -->
        <div class="group-header" @click=${() => this._toggleInitiated()}>
          <span class="group-header-arrow ${this._initiatedExpanded ? "" : "collapsed"}">
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </span>
          <span class="group-header-icon initiated">
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
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
              <path d="M8 9h8"></path>
              <path d="M8 13h6"></path>
            </svg>
          </span>
          发起的会话
          <span class="group-count">${initiatedCount}</span>
        </div>
        ${this._initiatedExpanded
          ? html`<div class="group-items">
              ${initiatedCount > 0
                ? this._initiatedSessions.map((s) => this._renderSession(s))
                : this._renderEmptyGroup("暂无发起的会话")}
            </div>`
          : nothing}

        <!-- 参与的会话 -->
        <div class="group-header" @click=${() => this._toggleParticipated()}>
          <span class="group-header-arrow ${this._participatedExpanded ? "" : "collapsed"}">
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </span>
          <span class="group-header-icon participated">
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
              <path d="M22 21v-2a4 4 0 0 0-3-3.87"></path>
              <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
            </svg>
          </span>
          参与的会话
          <span class="group-count">${participatedCount}</span>
        </div>
        ${this._participatedExpanded
          ? html`<div class="group-items">
              ${participatedCount > 0
                ? this._participatedSessions.map((s) => this._renderSession(s))
                : this._renderEmptyGroup("暂无参与的会话")}
            </div>`
          : nothing}

        <!-- 分隔线 -->
        <div class="group-divider"></div>

        <!-- 最近会话 -->
        <div class="group-header" @click=${() => this._toggleRecent()}>
          <span class="group-header-arrow ${this._recentExpanded ? "" : "collapsed"}">
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="3"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </span>
          <span class="group-header-icon recent">
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
              <circle cx="12" cy="12" r="10"></circle>
              <polyline points="12 6 12 12 16 14"></polyline>
            </svg>
          </span>
          最近会话
          <span class="group-count">${recentCount}</span>
        </div>
        ${this._recentExpanded
          ? html`<div class="group-items">
              ${recentCount > 0
                ? this._recentSessions.map((s) => this._renderSession(s))
                : this._renderEmptyGroup("暂无最近会话")}
            </div>`
          : nothing}
      </div>

      ${this._renderNameDialog()} ${this._renderDeleteConfirm()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "session-sidebar": SessionSidebar;
  }
}
