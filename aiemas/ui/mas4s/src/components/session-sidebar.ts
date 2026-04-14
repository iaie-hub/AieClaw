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
    :host {
      display: flex;
      flex-direction: column;
      width: 280px;
      min-width: 280px;
      height: 100vh;
      background: #f8fafc;
      border-right: 1px solid #e2e8f0;
      flex-shrink: 0;
      box-sizing: border-box;
      transition:
        width 0.3s cubic-bezier(0.4, 0, 0.2, 1),
        min-width 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      overflow: hidden;
      position: relative;
    }

    :host([collapsed]) {
      width: 40px;
      min-width: 40px;
    }

    .sidebar-header {
      height: 70px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 16px;
      font-weight: 600;
      font-size: 16px;
      border-bottom: 1px solid #e2e8f0;
      color: #1e293b;
      flex-shrink: 0;
      transition: padding 0.3s;
      overflow: hidden;
    }

    :host([collapsed]) .sidebar-header {
      padding: 0;
      justify-content: center;
    }

    .sidebar-header span {
      white-space: nowrap;
      transition:
        opacity 0.2s,
        width 0.2s;
    }

    :host([collapsed]) .sidebar-header span {
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
      /* 仅保留折叠按钮并在容器中居中 */
      gap: 0;
    }

    :host([collapsed]) .refresh-btn,
    :host([collapsed]) session-create-control {
      display: none;
    }

    .refresh-btn {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: linear-gradient(135deg, #10b981 0%, #06b6d4 100%);
      border: none;
      color: white;
      font-size: 14px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 2px 6px rgba(16, 185, 129, 0.35);
      transition: all 0.2s;
    }

    .refresh-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 10px rgba(16, 185, 129, 0.45);
    }

    .refresh-btn:disabled {
      opacity: 0.7;
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

    .add-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 4px 10px rgba(59, 130, 246, 0.4);
    }

    .toggle-sidebar-btn {
      width: 28px;
      height: 28px;
      border-radius: 6px;
      background: transparent;
      border: none;
      color: #64748b;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }

    .toggle-sidebar-btn:hover {
      background: #f1f5f9;
      color: #1e293b;
    }

    :host([collapsed]) .toggle-sidebar-btn {
      width: 40px;
      height: 40px;
      border-radius: 10px;
    }

    .session-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px 0;
      transition: opacity 0.2s;
    }

    :host([collapsed]) .session-list {
      opacity: 0;
      pointer-events: none;
    }

    .group-header {
      padding: 6px 12px 6px 14px;
      margin: 4px 8px 2px;
      font-size: 13px;
      font-weight: 600;
      color: #94a3b8;
      letter-spacing: 0.2px;
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      user-select: none;
      border-radius: 6px;
      transition:
        background 0.15s,
        color 0.15s;
    }

    .group-header:hover {
      background: #f1f5f9;
      color: #64748b;
    }

    .group-header-arrow {
      width: 12px;
      height: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.2s;
      flex-shrink: 0;
    }

    .group-header-arrow.collapsed {
      transform: rotate(-90deg);
    }

    /* 分组内容区：左侧竖线轨道 */
    .group-items {
      position: relative;
      padding-left: 0;
      margin-bottom: 4px;
    }

    .group-items::before {
      content: "";
      position: absolute;
      left: 26px;
      top: 2px;
      bottom: 2px;
      width: 1.5px;
      background: #e2e8f0;
      border-radius: 1px;
    }

    .group-divider {
      height: 1px;
      background: #e2e8f0;
      margin: 8px 16px;
    }

    .session-item {
      min-height: 32px;
      display: flex;
      align-items: center;
      padding: 0px 0px 0px 48px;
      cursor: pointer;
      border-radius: 7px;
      margin: 1px 8px;
      transition: all 0.15s;
      font-size: 13px;
      color: #64748b;
      border: none;
      background: none;
      width: calc(100% - 16px);
      text-align: left;
      box-sizing: border-box;
    }

    .session-item:hover {
      background: white;
      color: #1e293b;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.06);
    }

    .session-item.active {
      background: white;
      color: #3b82f6;
      font-weight: 600;
      box-shadow: 0 2px 8px rgba(59, 130, 246, 0.1);
      border-left: 3px solid #3b82f6;
      padding-left: 45px;
    }

    .session-item.archived {
      color: #94a3b8;
      font-style: italic;
    }

    .session-item-body {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      justify-content: center;
      overflow: hidden;
      gap: 0;
      /* 作为 actions 的定位容器 */
      position: relative;
    }

    .session-label {
      width: 100%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
      line-height: 1.4;
    }

    .session-time {
      font-size: 10px;
      color: #94a3b8;
      font-variant-numeric: tabular-nums;
      letter-spacing: 0.1px;
      white-space: nowrap;
      flex-shrink: 0;
      line-height: 1.2;
    }

    .session-item.active .session-time {
      color: #93c5fd;
    }

    .badge-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #ef4444;
      flex-shrink: 0;
      margin-left: auto;
    }

    .badge-count {
      background: #3b82f6;
      color: white;
      border-radius: 10px;
      padding: 1px 6px;
      font-size: 11px;
      font-weight: 600;
      flex-shrink: 0;
      margin-left: auto;
    }

    .item-actions {
      /* 绝对定位，悬浮在日期位置上 */
      position: absolute;
      right: 0;
      top: 50%;
      transform: translateY(-50%);
      display: flex;
      align-items: center;
      gap: 2px;
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.15s;
      background: white;
      border-radius: 6px;
      padding: 2px 2px;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
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
      padding: 3px 4px;
      border-radius: 4px;
      flex-shrink: 0;
      transition:
        color 0.15s,
        background 0.15s;
      line-height: 1;
      position: relative;
      display: flex;
      align-items: center;
    }

    .rename-btn:hover {
      color: #3b82f6;
      background: #eff6ff;
    }

    .delete-btn:hover {
      color: #ef4444;
      background: #fef2f2;
    }

    .refresh-item-btn:hover {
      color: #10b981;
      background: #ecfdf5;
    }

    /* CSS tooltip */
    .rename-btn::after,
    .delete-btn::after,
    .refresh-item-btn::after {
      content: attr(data-tip);
      position: absolute;
      bottom: calc(100% + 6px);
      left: 50%;
      transform: translateX(-50%);
      background: #1e293b;
      color: #fff;
      font-size: 11px;
      white-space: nowrap;
      padding: 3px 7px;
      border-radius: 5px;
      pointer-events: none;
      opacity: 0;
      transition: opacity 0.15s;
      z-index: 100;
    }

    .rename-btn:hover::after,
    .delete-btn:hover::after {
      opacity: 1;
    }

    /* 删除确认对话框 */
    .confirm-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }

    .confirm-dialog {
      background: white;
      border-radius: 12px;
      padding: 24px;
      width: 320px;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
      animation: dialog-appear 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    @keyframes dialog-appear {
      from {
        opacity: 0;
        transform: scale(0.95);
      }
      to {
        opacity: 1;
        transform: scale(1);
      }
    }

    .confirm-dialog h3 {
      margin: 0 0 12px;
      font-size: 16px;
      font-weight: 600;
      color: #1e293b;
    }

    .confirm-dialog p {
      margin: 0 0 24px;
      font-size: 14px;
      color: #64748b;
      line-height: 1.5;
    }

    .confirm-dialog-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
    }

    .confirm-dialog-actions button {
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      border: 1px solid #e2e8f0;
      background: white;
      color: #64748b;
      transition: all 0.15s;
    }

    .confirm-dialog-actions button:hover {
      background: #f8fafc;
      color: #1e293b;
    }

    .confirm-dialog-actions button.danger {
      background: #ef4444;
      color: white;
      border-color: #ef4444;
    }

    .confirm-dialog-actions button.danger:hover {
      background: #dc2626;
      box-shadow: 0 4px 12px rgba(239, 68, 68, 0.3);
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
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
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
          <span class="session-label">${isArchived ? html`📦 ${label}` : label}</span>
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

  render() {
    return html`
      <div class="sidebar-header">
        <span>会话列表</span>
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
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            <path d="M8 9h8"></path>
            <path d="M8 13h6"></path>
          </svg>
          &nbsp;发起的会话
        </div>
        ${this._initiatedExpanded
          ? html`<div class="group-items">
              ${this._initiatedSessions.map((s) => this._renderSession(s))}
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
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
            <circle cx="9" cy="7" r="4"></circle>
            <path d="M22 21v-2a4 4 0 0 0-3-3.87"></path>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
          </svg>
          &nbsp;参与的会话
        </div>
        ${this._participatedExpanded
          ? html`<div class="group-items">
              ${this._participatedSessions.map((s) => this._renderSession(s))}
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
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="12 6 12 12 16 14"></polyline>
          </svg>
          &nbsp;最近会话
        </div>
        ${this._recentExpanded
          ? html`<div class="group-items">
              ${this._recentSessions.map((s) => this._renderSession(s))}
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
