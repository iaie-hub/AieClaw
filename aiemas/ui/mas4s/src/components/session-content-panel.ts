import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { ChatMessage } from "../types/chat-types.js";
import "../views/message-list.js";
import "../views/chat-input.js";

/**
 * 会话内容面板组件（独立 Sessions View 使用）。
 * 展示选中会话的聊天消息 + 底部输入框。
 * 状态：无会话占位、加载中、错误、正常消息列表。
 */
@customElement("session-content-panel")
export class SessionContentPanel extends LitElement {
  @property({ attribute: false }) messages: ChatMessage[] = [];
  @property({ type: Boolean }) loading = false;
  @property({ type: String }) error = "";
  @property({ type: Boolean }) hasSession = false;
  @property({ type: Number }) totalTokens = 0;
  @property({ type: Number }) contextTokens = 0;

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-width: 0;
      height: 100%;
      background: var(--ai-bg-panel, #ffffff);
      border-radius: 20px;
      box-shadow:
        0 4px 14px rgba(0, 0, 0, 0.02),
        0 1px 2px rgba(0, 0, 0, 0.03);
      border: 1px solid #eef2f8;
      overflow: hidden;
      box-sizing: border-box;
      font-family: "DM Sans", "PingFang SC", "Noto Sans SC", system-ui, sans-serif;
    }

    /* ── Message area ── */
    .message-area {
      flex: 1;
      overflow-y: auto;
      min-height: 0;
      padding: 16px;
    }

    /* ── Input area ── */
    .input-area {
      flex-shrink: 0;
      padding: 12px 16px 16px;
      border-top: 1px solid rgba(226, 232, 240, 0.5);
    }

    /* ── Placeholder State ── */
    .placeholder-state {
      flex: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      color: #94a3b8;
    }

    .placeholder-icon {
      width: 48px;
      height: 48px;
      border-radius: 14px;
      background: rgba(203, 213, 225, 0.12);
      display: flex;
      align-items: center;
      justify-content: center;
      color: #cbd5e1;
    }

    .placeholder-text {
      font-size: 14px;
      color: #94a3b8;
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

    /* ── Context Usage Bar ── */
    .context-bar {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 8px 16px;
      flex-shrink: 0;
    }

    .context-progress {
      width: 80px;
      height: 6px;
      background: #e2e8f0;
      border-radius: 3px;
      overflow: hidden;
    }

    .context-progress-fill {
      height: 100%;
      border-radius: 3px;
      background: #334155;
      transition: width 0.3s ease;
    }

    .context-progress-fill.warning {
      background: #f59e0b;
    }

    .context-progress-fill.danger {
      background: #ef4444;
    }

    .context-label {
      font-size: 12px;
      color: #64748b;
      font-family: "JetBrains Mono", "SF Mono", "Fira Code", monospace;
      white-space: nowrap;
    }
  `;

  // ── 渲染 ──────────────────────────────────────────────────────────────────

  private _renderPlaceholder() {
    return html`
      <div class="placeholder-state">
        <div class="placeholder-icon">
          <svg
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
          </svg>
        </div>
        <span class="placeholder-text">请选择一个会话</span>
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
      </div>
    `;
  }

  private _formatTokens(n: number): string {
    if (n >= 1000) return `${Math.round(n / 1000)}k`;
    return String(n);
  }

  private _renderContextBar() {
    if (!this.contextTokens || this.contextTokens <= 0) return html``;
    const pct = Math.min(100, Math.round((this.totalTokens / this.contextTokens) * 100));
    const level = pct >= 90 ? "danger" : pct >= 70 ? "warning" : "";
    return html`
      <div class="context-bar">
        <div class="context-progress">
          <div
            class="context-progress-fill ${level}"
            style="width: ${pct}%"
          ></div>
        </div>
        <span class="context-label"
          >${pct}% context used ${this._formatTokens(this.totalTokens)} / ${this._formatTokens(this.contextTokens)}</span
        >
      </div>
    `;
  }

  private _renderContent() {
    return html`
      <div class="message-area">
        <message-list .messages=${this.messages}></message-list>
      </div>
      ${this._renderContextBar()}
      <div class="input-area">
        <chat-input></chat-input>
      </div>
    `;
  }

  render() {
    if (!this.hasSession) {
      return this._renderPlaceholder();
    }

    if (this.loading) {
      return html`${this._renderLoading()}`;
    }

    if (this.error) {
      return html`
        ${this._renderError()}
        <div class="input-area">
          <chat-input></chat-input>
        </div>
      `;
    }

    return this._renderContent();
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "session-content-panel": SessionContentPanel;
  }
}
