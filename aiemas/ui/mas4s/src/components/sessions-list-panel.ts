import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { SessionListItem } from "../types/session-types.js";

/**
 * 会话列表面板组件（独立 Sessions View 使用）。
 * 展示会话列表、加载状态、错误状态、空状态。
 * 派发 session-select 和 retry-fetch 自定义事件。
 */
@customElement("sessions-list-panel")
export class SessionsListPanel extends LitElement {
  @property({ attribute: false }) sessions: SessionListItem[] = [];
  @property({ type: String }) selectedSessionKey = "";
  @property({ type: Boolean }) loading = false;
  @property({ type: String }) error = "";
  @property({ type: Number }) filterActiveMinutes = 120;
  @property({ type: Number }) filterLimit = 200;
  @property({ type: Boolean }) filterShowArchived = false;

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      width: 280px;
      min-width: 280px;
      height: 100%;
      background: linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%);
      border-right: 1px solid rgba(226, 232, 240, 0.7);
      flex-shrink: 0;
      box-sizing: border-box;
      overflow: hidden;
      font-family: "DM Sans", "PingFang SC", "Noto Sans SC", system-ui, sans-serif;
    }

    /* ── Header ── */
    .panel-header {
      height: 56px;
      display: flex;
      align-items: center;
      padding: 0 18px;
      border-bottom: 1px solid rgba(226, 232, 240, 0.6);
      flex-shrink: 0;
      position: relative;
    }

    .panel-header::after {
      content: "";
      position: absolute;
      bottom: -1px;
      left: 18px;
      right: 18px;
      height: 1px;
      background: linear-gradient(90deg, transparent, rgba(59, 130, 246, 0.15), transparent);
    }

    .panel-title {
      font-weight: 700;
      font-size: 15px;
      color: #1e293b;
      letter-spacing: -0.01em;
    }

    .session-count {
      margin-left: auto;
      min-width: 20px;
      height: 20px;
      padding: 0 6px;
      border-radius: 10px;
      background: #e2e8f0;
      color: #64748b;
      font-size: 11px;
      font-weight: 600;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      line-height: 1;
    }

    /* ── Filter Bar ── */
    .filter-bar {
      padding: 6px 10px;
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 5px;
      border-bottom: 1px solid rgba(226, 232, 240, 0.5);
      flex-shrink: 0;
      background: rgba(248, 250, 252, 0.6);
    }

    .filter-chip {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      height: 24px;
      padding: 0 8px;
      border-radius: 12px;
      font-size: 11px;
      font-weight: 500;
      border: 1px solid #e2e8f0;
      background: white;
      color: #64748b;
      transition: all 0.15s ease;
      cursor: default;
    }

    .filter-chip input {
      width: 40px;
      border: none;
      background: transparent;
      font-size: 11px;
      font-weight: 600;
      color: #334155;
      text-align: center;
      outline: none;
      padding: 0;
      font-family: inherit;
    }

    .filter-chip input:disabled {
      opacity: 0.4;
    }

    .filter-chip--toggle {
      cursor: pointer;
      user-select: none;
    }

    .filter-chip--toggle:hover {
      border-color: #cbd5e1;
      background: #f8fafc;
    }

    .filter-chip--toggle.active {
      background: #eff6ff;
      border-color: #bfdbfe;
      color: #2563eb;
    }

    .filter-chip--toggle.active:hover {
      background: #dbeafe;
    }

    .chip-dot {
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: currentColor;
      opacity: 0.6;
    }

    .filter-chip--toggle.active .chip-dot {
      opacity: 1;
    }

    /* ── Session List ── */
    .session-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px 0;
    }

    /* ── Session Item ── */
    .session-item {
      display: flex;
      flex-direction: column;
      padding: 10px 16px;
      cursor: pointer;
      border-radius: 10px;
      margin: 2px 8px;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      border: 1px solid transparent;
      background: transparent;
      width: calc(100% - 16px);
      box-sizing: border-box;
      position: relative;
    }

    .session-item:hover {
      background: rgba(255, 255, 255, 0.85);
      border-color: rgba(226, 232, 240, 0.6);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
    }

    .session-item.active {
      background: #ffffff;
      border-color: #e2e8f0;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
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

    /* ── Item Layout ── */
    .item-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }

    .item-model {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-size: 13px;
      font-weight: 600;
      color: #334155;
      line-height: 1.4;
    }

    .session-item.active .item-model {
      color: #1e293b;
    }

    .item-time {
      font-size: 11px;
      color: #3b82f6;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      flex-shrink: 0;
    }

    /* ── Hover Actions ── */
    .item-actions {
      display: none;
      align-items: center;
      gap: 2px;
      flex-shrink: 0;
    }

    .session-item:hover .item-actions {
      display: flex;
    }

    .session-item:hover .item-time {
      display: none;
    }

    .action-btn {
      width: 22px;
      height: 22px;
      border: none;
      background: transparent;
      border-radius: 5px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #94a3b8;
      transition: all 0.15s ease;
      padding: 0;
    }

    .action-btn:hover {
      background: rgba(226, 232, 240, 0.6);
      color: #475569;
    }

    .action-btn.delete:hover {
      background: rgba(239, 68, 68, 0.08);
      color: #ef4444;
    }

    .item-bottom {
      display: flex;
      align-items: center;
      margin-top: 4px;
      gap: 6px;
    }

    /* ── Subtitle ── */
    .item-subtitle {
      font-size: 11px;
      color: #94a3b8;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 100%;
    }

    /* ── Loading State ── */
    .loading-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      color: #94a3b8;
      font-size: 13px;
    }

    .spinner {
      width: 24px;
      height: 24px;
      border: 2.5px solid #e2e8f0;
      border-top-color: #3b82f6;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    /* ── Error State ── */
    .error-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px 16px;
      gap: 12px;
      text-align: center;
    }

    .error-icon {
      width: 36px;
      height: 36px;
      border-radius: 10px;
      background: rgba(239, 68, 68, 0.08);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #ef4444;
    }

    .error-message {
      font-size: 13px;
      color: #64748b;
      line-height: 1.5;
    }

    .retry-btn {
      padding: 7px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      border: 1px solid #e2e8f0;
      background: white;
      color: #475569;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .retry-btn:hover {
      background: #f8fafc;
      border-color: #cbd5e1;
      color: #1e293b;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.06);
    }

    /* ── Empty State ── */
    .empty-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 24px 16px;
      gap: 10px;
      color: #94a3b8;
    }

    .empty-icon {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      background: rgba(203, 213, 225, 0.15);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #cbd5e1;
    }

    .empty-text {
      font-size: 13px;
      color: #94a3b8;
    }
  `;

  // ── 事件 ──────────────────────────────────────────────────────────────────

  private _onSessionClick(key: string) {
    this.dispatchEvent(
      new CustomEvent("session-select", {
        detail: { key },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onSessionDelete(key: string, e: Event) {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("session-delete", {
        detail: { key },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onSessionRefresh(key: string, e: Event) {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("session-refresh", {
        detail: { key },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onRetry() {
    this.dispatchEvent(
      new CustomEvent("retry-fetch", {
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _dispatchFilterChange() {
    this.dispatchEvent(
      new CustomEvent("filter-change", {
        detail: {
          activeMinutes: this.filterActiveMinutes,
          limit: this.filterLimit,
          showArchived: this.filterShowArchived,
        },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onActiveMinutesInput(e: Event) {
    const val = parseInt((e.target as HTMLInputElement).value, 10);
    this.filterActiveMinutes = Number.isFinite(val) && val >= 0 ? val : 0;
    this._dispatchFilterChange();
  }

  private _onLimitInput(e: Event) {
    const val = parseInt((e.target as HTMLInputElement).value, 10);
    this.filterLimit = Number.isFinite(val) && val > 0 ? val : 200;
    this._dispatchFilterChange();
  }

  private _toggleArchived() {
    this.filterShowArchived = !this.filterShowArchived;
    this._dispatchFilterChange();
  }

  // ── 工具函数 ──────────────────────────────────────────────────────────────

  private _formatShortDate(ts: number): string {
    if (!ts) return "";
    const d = new Date(ts);
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${month}-${day}`;
  }

  // ── 渲染 ──────────────────────────────────────────────────────────────────

  private _renderSessionItem(session: SessionListItem) {
    const isActive = session.key === this.selectedSessionKey;
    const title = session.label || session.key;
    const subtitle = session.displayName || "";
    const timeStr = this._formatShortDate(session.updatedAt);

    return html`
      <div
        class="session-item ${isActive ? "active" : ""}"
        role="button"
        tabindex="0"
        @click=${() => this._onSessionClick(session.key)}
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            this._onSessionClick(session.key);
          }
        }}
        title=${title}
      >
        <div class="item-top">
          <span class="item-model">${title}</span>
          <span class="item-time">${timeStr}</span>
          <div class="item-actions">
            <button
              class="action-btn"
              title="刷新"
              @click=${(e: Event) => this._onSessionRefresh(session.key, e)}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="23 4 23 10 17 10"></polyline>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
              </svg>
            </button>
            <button
              class="action-btn delete"
              title="删除"
              @click=${(e: Event) => this._onSessionDelete(session.key, e)}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="3 6 5 6 21 6"></polyline>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              </svg>
            </button>
          </div>
        </div>
        ${subtitle
          ? html`<div class="item-bottom">
              <span class="item-subtitle">${subtitle}</span>
            </div>`
          : html``}
      </div>
    `;
  }

  private _renderLoading() {
    return html`
      <div class="loading-state">
        <div class="spinner"></div>
        <span>加载中…</span>
      </div>
    `;
  }

  private _renderError() {
    return html`
      <div class="error-state">
        <div class="error-icon">
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
        </div>
        <span class="error-message">${this.error}</span>
        <button class="retry-btn" @click=${() => this._onRetry()}>重试</button>
      </div>
    `;
  }

  private _renderEmpty() {
    return html`
      <div class="empty-state">
        <div class="empty-icon">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
        </div>
        <span class="empty-text">暂无会话</span>
      </div>
    `;
  }

  render() {
    return html`
      <div class="panel-header">
        <span class="panel-title">会话列表</span>
        <span class="session-count">${this.sessions.length}</span>
      </div>

      <div class="filter-bar">
        <span class="filter-chip">
          活跃
          <input
            type="number"
            .value=${String(this.filterActiveMinutes)}
            ?disabled=${this.filterShowArchived}
            @change=${(e: Event) => this._onActiveMinutesInput(e)}
          />
        </span>
        <span class="filter-chip">
          限制
          <input
            type="number"
            .value=${String(this.filterLimit)}
            @change=${(e: Event) => this._onLimitInput(e)}
          />
        </span>
        <button
          class="filter-chip filter-chip--toggle ${this.filterShowArchived ? "active" : ""}"
          @click=${() => this._toggleArchived()}
        >
          <span class="chip-dot"></span>
          显示已归档
        </button>
      </div>

      ${this.loading
        ? this._renderLoading()
        : this.error
          ? this._renderError()
          : this.sessions.length === 0
            ? this._renderEmpty()
            : html`
                <div class="session-list">
                  ${this.sessions.map((s) => this._renderSessionItem(s))}
                </div>
              `}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sessions-list-panel": SessionsListPanel;
  }
}
