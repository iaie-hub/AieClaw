import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { MasSession } from "../types/session-types.js";

/**
 * 会话列表侧边栏（280px 宽）。
 * 仅在工作台视图显示。
 */
@customElement("session-sidebar")
export class SessionSidebar extends LitElement {
  @property({ attribute: false }) sessions: MasSession[] = [];
  @property({ type: String }) activeSessionKey: string | null = null;

  @state() private _nameDialog: {
    mode: "create" | "rename";
    sessionKey?: string;
    value: string;
    reasoningLevel: "stream" | "on" | "off";
  } | null = null;

  @state() private _deleteConfirm: { sessionKey: string; label: string } | null = null;

  @state() private _refreshing = false;
  @state() private _initiatedExpanded = true;
  @state() private _participatedExpanded = true;
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
      width: 48px;
      min-width: 48px;
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
    :host([collapsed]) .add-btn {
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

    .add-btn {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: linear-gradient(135deg, #3b82f6 0%, #6366f1 100%);
      border: none;
      color: white;
      font-size: 18px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      box-shadow: 0 2px 6px rgba(59, 130, 246, 0.3);
      transition: all 0.2s;
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

    .session-item {
      height: 34px;
      display: flex;
      align-items: center;
      padding: 0 8px 0 48px;
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
      flex-direction: row;
      align-items: center;
      overflow: hidden;
      gap: 6px;
      /* 作为 actions 的定位容器 */
      position: relative;
    }

    .session-label {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
      line-height: 1.3;
    }

    .session-time {
      font-size: 11px;
      color: #94a3b8;
      font-variant-numeric: tabular-nums;
      letter-spacing: 0.1px;
      white-space: nowrap;
      flex-shrink: 0;
      /* 为 actions 悬浮留出空间 */
      margin-right: 2px;
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
    .delete-btn {
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

    /* CSS tooltip */
    .rename-btn::after,
    .delete-btn::after {
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
      background: rgba(0, 0, 0, 0.25);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }

    .confirm-dialog {
      background: white;
      border-radius: 12px;
      padding: 20px 24px;
      width: 320px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .confirm-dialog h3 {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
      color: #1e293b;
    }

    .confirm-dialog p {
      margin: 0;
      font-size: 13px;
      color: #64748b;
      line-height: 1.5;
    }

    .confirm-dialog-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }

    .confirm-dialog-actions button {
      padding: 6px 16px;
      border-radius: 8px;
      font-size: 13px;
      cursor: pointer;
      border: 1px solid #e2e8f0;
      background: white;
      color: #64748b;
      transition: all 0.15s;
    }

    .confirm-dialog-actions button.danger {
      background: #ef4444;
      color: white;
      border-color: #ef4444;
    }

    .confirm-dialog-actions button:hover {
      opacity: 0.85;
    }

    /* 创建/重命名弹层 */
    .name-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.25);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }

    .name-dialog {
      background: white;
      border-radius: 12px;
      padding: 20px 24px;
      width: 320px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .name-dialog h3 {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
      color: #1e293b;
    }

    .name-dialog input {
      width: 100%;
      padding: 8px 10px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      font-size: 14px;
      outline: none;
      box-sizing: border-box;
      transition: border-color 0.15s;
    }

    .name-dialog input:focus {
      border-color: #3b82f6;
    }

    .name-dialog-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }

    .name-dialog-actions button {
      padding: 6px 16px;
      border-radius: 8px;
      font-size: 13px;
      cursor: pointer;
      border: 1px solid #e2e8f0;
      background: white;
      color: #64748b;
      transition: all 0.15s;
    }

    .name-dialog-actions button.primary {
      background: #3b82f6;
      color: white;
      border-color: #3b82f6;
    }

    .name-dialog-actions button:hover {
      opacity: 0.85;
    }

    .reasoning-toggle {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 13px;
      color: #475569;
    }

    .reasoning-toggle span {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .reasoning-toggle small {
      font-size: 11px;
      color: #94a3b8;
    }

    .toggle-switch {
      position: relative;
      width: 36px;
      height: 20px;
      flex-shrink: 0;
    }

    .toggle-switch input {
      opacity: 0;
      width: 0;
      height: 0;
      position: absolute;
    }

    .toggle-track {
      position: absolute;
      inset: 0;
      background: #cbd5e1;
      border-radius: 10px;
      cursor: pointer;
      transition: background 0.2s;
    }

    .toggle-track::after {
      content: "";
      position: absolute;
      top: 3px;
      left: 3px;
      width: 14px;
      height: 14px;
      background: white;
      border-radius: 50%;
      transition: transform 0.2s;
    }

    .toggle-switch input:checked + .toggle-track {
      background: #3b82f6;
    }

    .toggle-switch input:checked + .toggle-track::after {
      transform: translateX(16px);
    }
  `;

  private _onCreate() {
    this._nameDialog = { mode: "create", value: "", reasoningLevel: "stream" };
  }

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
      value: session.label ?? session.displayName ?? "",
      reasoningLevel: (session.reasoningLevel as "stream" | "on" | "off") ?? "stream",
    };
  }

  private _onDelete(e: Event, session: MasSession) {
    e.stopPropagation();
    this._deleteConfirm = {
      sessionKey: session.key,
      label: session.label ?? session.displayName ?? session.key,
    };
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

  private _onNameInput(e: Event) {
    const input = e.target as HTMLInputElement;
    if (this._nameDialog) {
      this._nameDialog = { ...this._nameDialog, value: input.value };
    }
  }

  private _onNameConfirm() {
    if (!this._nameDialog) {
      return;
    }
    const { mode, sessionKey, value, reasoningLevel } = this._nameDialog;
    const label = value.trim();
    if (!label) {
      return;
    }

    if (mode === "create") {
      this.dispatchEvent(
        new CustomEvent("session-create", { detail: { label, reasoningLevel }, bubbles: true }),
      );
    } else if (mode === "rename" && sessionKey) {
      this.dispatchEvent(
        new CustomEvent("session-rename", {
          detail: { sessionKey, label, reasoningLevel },
          bubbles: true,
        }),
      );
    }
    this._nameDialog = null;
  }

  private _onNameKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.isComposing) {
      this._onNameConfirm();
    }
    if (e.key === "Escape") {
      this._nameDialog = null;
    }
  }

  private _onSessionClick(key: string) {
    this.dispatchEvent(
      new CustomEvent("session-select", { detail: { sessionKey: key }, bubbles: true }),
    );
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
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  private _renderSession(session: MasSession) {
    const isActive = session.key === this.activeSessionKey;
    const isArchived = session.archivedAt != null;
    const label = session.label ?? session.displayName ?? session.key;
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
    const { mode, value, reasoningLevel } = this._nameDialog;
    const title = mode === "create" ? "新建会话" : "重命名会话";
    const streamEnabled = reasoningLevel === "stream";
    return html`
      <div class="name-overlay" @click=${() => (this._nameDialog = null)}>
        <div class="name-dialog" @click=${(e: Event) => e.stopPropagation()}>
          <h3>${title}</h3>
          <input
            type="text"
            .value=${value}
            placeholder="输入会话名称"
            @input=${(e: Event) => this._onNameInput(e)}
            @keydown=${(e: KeyboardEvent) => this._onNameKeydown(e)}
            autofocus
          />
          <div class="reasoning-toggle">
            <span>
              启用思考过程
              <small>开启后 AI 会实时输出推理内容</small>
            </span>
            <label class="toggle-switch">
              <input
                type="checkbox"
                .checked=${streamEnabled}
                @change=${(e: Event) => {
                  if (this._nameDialog) {
                    this._nameDialog = {
                      ...this._nameDialog,
                      reasoningLevel: (e.target as HTMLInputElement).checked ? "stream" : "off",
                    };
                  }
                }}
              />
              <span class="toggle-track"></span>
            </label>
          </div>
          <div class="name-dialog-actions">
            <button @click=${() => (this._nameDialog = null)}>取消</button>
            <button class="primary" @click=${() => this._onNameConfirm()}>确认</button>
          </div>
        </div>
      </div>
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
          <button
            class="add-btn"
            @click=${() => this._onCreate()}
            aria-label="发起新会话"
            title="发起新会话"
          >
            +
          </button>
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
          📁 发起的会话
        </div>
        ${this._initiatedExpanded
          ? html`<div class="group-items">
              ${this._initiatedSessions.map((s) => this._renderSession(s))}
            </div>`
          : nothing}

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
          🔗 参与的会话
        </div>
        ${this._participatedExpanded
          ? html`<div class="group-items">
              ${this._participatedSessions.map((s) => this._renderSession(s))}
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
