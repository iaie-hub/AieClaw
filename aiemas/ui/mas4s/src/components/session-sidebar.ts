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
  } | null = null;

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
    }

    .sidebar-header {
      height: 70px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 20px;
      font-weight: 600;
      font-size: 16px;
      border-bottom: 1px solid #e2e8f0;
      color: #1e293b;
      flex-shrink: 0;
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

    .session-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px 0;
    }

    .group-header {
      padding: 8px 16px 4px;
      font-size: 12px;
      font-weight: 600;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .session-item {
      height: 44px;
      display: flex;
      align-items: center;
      padding: 0 16px;
      cursor: pointer;
      border-radius: 8px;
      margin: 2px 10px;
      transition: all 0.2s;
      font-size: 14px;
      color: #64748b;
      border: none;
      background: none;
      width: calc(100% - 20px);
      text-align: left;
    }

    .session-item:hover {
      background: white;
      color: #1e293b;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.02);
    }

    .session-item.active {
      background: white;
      color: #3b82f6;
      font-weight: 600;
      box-shadow: 0 2px 8px rgba(59, 130, 246, 0.1);
      border-left: 3px solid #3b82f6;
    }

    .session-label {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
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

    .rename-btn {
      opacity: 0;
      background: none;
      border: none;
      cursor: pointer;
      color: #94a3b8;
      font-size: 13px;
      padding: 2px 4px;
      border-radius: 4px;
      flex-shrink: 0;
      transition:
        opacity 0.15s,
        color 0.15s;
      line-height: 1;
    }

    .session-item:hover .rename-btn {
      opacity: 1;
    }

    .rename-btn:hover {
      color: #3b82f6;
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
  `;

  private _onCreate() {
    this._nameDialog = { mode: "create", value: "" };
  }

  private _onRename(e: Event, session: MasSession) {
    // Stop propagation so the session-item click doesn't fire
    e.stopPropagation();
    this._nameDialog = { mode: "rename", sessionKey: session.key, value: session.label ?? "" };
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
    const { mode, sessionKey, value } = this._nameDialog;
    const label = value.trim();
    if (!label) {
      return;
    }

    if (mode === "create") {
      this.dispatchEvent(new CustomEvent("session-create", { detail: { label }, bubbles: true }));
    } else if (mode === "rename" && sessionKey) {
      this.dispatchEvent(
        new CustomEvent("session-rename", { detail: { sessionKey, label }, bubbles: true }),
      );
    }
    this._nameDialog = null;
  }

  private _onNameKeydown(e: KeyboardEvent) {
    if (e.key === "Enter") {
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

  private _renderSession(session: MasSession) {
    const isActive = session.key === this.activeSessionKey;
    const label = session.label ?? session.key;
    return html`
      <button
        class="session-item ${isActive ? "active" : ""}"
        @click=${() => this._onSessionClick(session.key)}
        title=${label}
      >
        <span class="session-label">${label}</span>
        ${
          session.hasNotification
            ? html`
                <span class="badge-dot"></span>
              `
            : nothing
        }
        ${
          !session.hasNotification && session.notificationCount > 0
            ? html`<span class="badge-count">${session.notificationCount}</span>`
            : nothing
        }
        <button
          class="rename-btn"
          @click=${(e: Event) => this._onRename(e, session)}
          title="重命名"
          aria-label="重命名会话"
        >✎</button>
      </button>
    `;
  }

  private _renderNameDialog() {
    if (!this._nameDialog) {
      return nothing;
    }
    const { mode, value } = this._nameDialog;
    const title = mode === "create" ? "新建会话" : "重命名会话";
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
          <div class="name-dialog-actions">
            <button @click=${() => (this._nameDialog = null)}>取消</button>
            <button class="primary" @click=${() => this._onNameConfirm()}>确认</button>
          </div>
        </div>
      </div>
    `;
  }

  render() {
    return html`
      <div class="sidebar-header">
        <span>会话列表</span>
        <button class="add-btn" @click=${() => this._onCreate()} aria-label="发起新会话" title="发起新会话">
          +
        </button>
      </div>

      <div class="session-list">
        <div class="group-header">📁 发起的会话</div>
        ${this._initiatedSessions.map((s) => this._renderSession(s))}

        <div class="group-header" style="margin-top:8px">🔗 参与的会话</div>
        ${this._participatedSessions.map((s) => this._renderSession(s))}
      </div>

      ${this._renderNameDialog()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "session-sidebar": SessionSidebar;
  }
}
