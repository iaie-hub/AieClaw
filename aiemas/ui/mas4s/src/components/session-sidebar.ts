import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { MasSession } from "../types/session-types.js";

/**
 * 会话列表侧边栏（280px 宽）。
 * 仅在工作台视图显示。
 */
@customElement("session-sidebar")
export class SessionSidebar extends LitElement {
  @property({ attribute: false }) sessions: MasSession[] = [];
  @property({ type: String }) activeSessionKey: string | null = null;

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

    .dropdown {
      position: absolute;
      top: 32px;
      right: 0;
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.08);
      z-index: 100;
      min-width: 140px;
      overflow: hidden;
    }

    .dropdown-item {
      padding: 10px 16px;
      font-size: 14px;
      color: #334155;
      cursor: pointer;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: background 0.15s;
      border: none;
      background: none;
      width: 100%;
      text-align: left;
    }

    .dropdown-item:hover {
      background: #eff6ff;
      color: #3b82f6;
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
  `;

  private _showDropdown = false;

  private _toggleDropdown = () => {
    this._showDropdown = !this._showDropdown;
    this.requestUpdate();
  };

  private _onAction(action: "create" | "join") {
    this._showDropdown = false;
    this.requestUpdate();
    if (action === "create") {
      const label = `会话 ${new Date().toLocaleString("zh-CN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}`;
      this.dispatchEvent(new CustomEvent("session-create", { detail: { label }, bubbles: true }));
    } else {
      this.dispatchEvent(new CustomEvent("session-join", { bubbles: true }));
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
      </button>
    `;
  }

  render() {
    return html`
      <div class="sidebar-header">
        <span>会话列表</span>
        <div style="position:relative">
          <button class="add-btn" @click=${this._toggleDropdown} aria-label="新建或加入会话">
            +
          </button>
          ${
            this._showDropdown
              ? html`
                <div class="dropdown">
                  <button class="dropdown-item" @click=${() => this._onAction("create")}>
                    ➕ 发起新会话
                  </button>
                  <button class="dropdown-item" @click=${() => this._onAction("join")}>
                    🔗 加入会话
                  </button>
                </div>
              `
              : nothing
          }
        </div>
      </div>

      <div class="session-list">
        <div class="group-header">📁 发起的会话</div>
        ${this._initiatedSessions.map((s) => this._renderSession(s))}

        <div class="group-header" style="margin-top:8px">🔗 参与的会话</div>
        ${this._participatedSessions.map((s) => this._renderSession(s))}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "session-sidebar": SessionSidebar;
  }
}
