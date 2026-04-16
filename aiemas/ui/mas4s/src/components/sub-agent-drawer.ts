import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state, query } from "lit/decorators.js";
import type { ApprovalRequest, ApprovalResolved } from "../types/approval-types.js";
import type { ChatMessage } from "../types/chat-types.js";
import "../views/message-list.js";
import "../views/chat-input.js";

/**
 * sub-agent-drawer — 子 Agent 右侧抽屉面板。
 *
 * 设计要点（来自 multi-view-ui-v2 方案）：
 * - 桌面端以侧边抽屉形式展开（360px），平板 300px，移动端全屏模态
 * - 包含独立的消息列表 + 输入框，实现物理隔离的会话上下文
 * - 打开时自动标记已读，支持未读角标
 * - 宽度过渡动画 0.25s ease
 */
@customElement("sub-agent-drawer")
export class SubAgentDrawer extends LitElement {
  /** 当前展示的子 Agent ID */
  @property({ type: String }) activeAgentId = "";
  /** 抽屉是否展开 */
  @property({ type: Boolean }) isOpen = false;
  /** Agent 信息列表 */
  @property({ attribute: false })
  agents: { id: string; name?: string; description?: string }[] = [];
  /** 当前 Agent 的消息列表 */
  @property({ attribute: false, hasChanged: () => true })
  messages: ChatMessage[] = [];
  /** 未读计数 */
  @property({ type: Number }) unreadCount = 0;
  /** 是否显示工具消息 */
  @property({ type: Boolean }) showToolMessages = true;
  /** 待审批队列（用于在子 Agent 抽屉中渲染审核卡片） */
  @property({ attribute: false }) pendingApprovals: ApprovalRequest[] = [];
  /** 已决策审批（用于在子 Agent 抽屉中渲染已审批状态） */
  @property({ attribute: false }) resolvedApprovals: Map<
    string,
    { approval: ApprovalRequest; resolved: ApprovalResolved }
  > = new Map();
  /** 是否为会话发起者（控制审批按钮是否显示） */
  @property({ type: Boolean }) isInitiator = false;
  /** 正在执行中 */
  @property({ type: Boolean }) isActive = false;
  /** 自动展示模式 */
  @property({ type: String })
  autoOpenMode: "immediate" | "badge-only" | "off" = "badge-only";

  @state() private _settingsOpen = false;
  @state() private _isAtBottom = true;

  @query(".drawer-message-list")
  private _scrollContainer!: HTMLElement | null;

  private _scrollBound = false;

  static styles = css`
    :host {
      display: block;
      height: 100%;
      width: 100%;
      overflow: hidden;
      flex-shrink: 0;
      border-left: 1px solid #e2e8f0;
      background: #ffffff;
      box-shadow: -4px 0 20px rgba(0, 0, 0, 0.08);
    }

    .drawer-inner {
      width: 100%;
      height: 100%;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    /* 移动端全屏模态 */
    @media (max-width: 767px) {
      :host {
        border-left: none;
        box-shadow: none;
      }
    }

    .drawer-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 16px;
      border-bottom: 1px solid #f1f5f9;
      flex-shrink: 0;
      background: #f8fafc;
      gap: 8px;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      flex: 1;
    }

    .agent-name {
      font-size: 14px;
      font-weight: 600;
      color: #1e293b;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .active-indicator {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      color: #22c55e;
      font-weight: 500;
    }

    .active-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #22c55e;
      animation: pulse 1.2s ease-in-out infinite;
    }

    @keyframes pulse {
      0%,
      100% {
        opacity: 1;
        transform: scale(1);
      }
      50% {
        opacity: 0.5;
        transform: scale(1.4);
      }
    }

    .unread-badge {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      min-width: 18px;
      height: 18px;
      padding: 0 5px;
      border-radius: 9px;
      background: #ef4444;
      color: #fff;
      font-size: 11px;
      font-weight: 600;
      flex-shrink: 0;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }

    .header-btn {
      background: none;
      border: none;
      cursor: pointer;
      color: #94a3b8;
      padding: 4px 6px;
      border-radius: 6px;
      line-height: 1;
      font-size: 14px;
      transition: all 0.15s;
    }

    .header-btn:hover {
      color: #475569;
      background: #e2e8f0;
    }

    .drawer-message-list {
      flex: 1;
      overflow-y: auto;
      min-height: 0;
      padding: 16px;
      --msg-agent-border-left: 3px solid #3b82f6;
      --msg-agent-bg: #f8fafc;
    }

    .drawer-input-area {
      flex-shrink: 0;
      padding: 8px 12px 12px;
      border-top: 1px solid #f1f5f9;
      background: #ffffff;
    }

    .empty-hint {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: #94a3b8;
      font-size: 13px;
    }

    /* 设置浮层 */
    .settings-overlay {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(0, 0, 0, 0.1);
      z-index: 10;
    }

    .settings-panel {
      position: absolute;
      top: 48px;
      right: 12px;
      width: 200px;
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.1);
      z-index: 11;
      padding: 8px 0;
    }

    .settings-title {
      padding: 6px 14px;
      font-size: 12px;
      font-weight: 600;
      color: #64748b;
      border-bottom: 1px solid #f1f5f9;
      margin-bottom: 4px;
    }

    .settings-option {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 14px;
      font-size: 13px;
      color: #334155;
      cursor: pointer;
      transition: background 0.1s;
    }

    .settings-option:hover {
      background: #f1f5f9;
    }

    .settings-option.active {
      color: #3b82f6;
      font-weight: 500;
    }

    .settings-check {
      width: 14px;
      text-align: center;
      flex-shrink: 0;
    }
  `;

  override connectedCallback(): void {
    super.connectedCallback();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._unbindScroll();
  }

  private _bindScroll(): void {
    if (this._scrollBound || !this._scrollContainer) {
      return;
    }
    this._scrollContainer.addEventListener("scroll", this._onScroll, { passive: true });
    this._scrollBound = true;
  }

  private _unbindScroll(): void {
    if (!this._scrollBound || !this._scrollContainer) {
      return;
    }
    this._scrollContainer.removeEventListener("scroll", this._onScroll);
    this._scrollBound = false;
  }

  private _onScroll = () => {
    if (!this._scrollContainer) {
      return;
    }
    const threshold = 100;
    this._isAtBottom =
      this._scrollContainer.scrollTop + this._scrollContainer.clientHeight >=
      this._scrollContainer.scrollHeight - threshold;
  };

  private _prevMessages: ChatMessage[] | undefined;

  override updated(changed: Map<string, unknown>): void {
    this._bindScroll();

    const messagesChanged = this.messages !== this._prevMessages;
    this._prevMessages = this.messages;
    const agentChanged = changed.has("activeAgentId");
    const openChanged = changed.has("isOpen");

    if (agentChanged || openChanged) {
      this._isAtBottom = true;
      this._settingsOpen = false;
    }

    if ((agentChanged || messagesChanged || openChanged) && this._isAtBottom) {
      const msgList = this.shadowRoot?.querySelector("message-list") as
        | (HTMLElement & { updateComplete?: Promise<boolean> })
        | null;
      if (msgList?.updateComplete) {
        void msgList.updateComplete.then(() => {
          requestAnimationFrame(() => {
            if (this._scrollContainer) {
              this._scrollContainer.scrollTop = this._scrollContainer.scrollHeight;
            }
          });
        });
      } else {
        requestAnimationFrame(() => {
          if (this._scrollContainer) {
            this._scrollContainer.scrollTop = this._scrollContainer.scrollHeight;
          }
        });
      }
    }
  }

  private _onClose() {
    this.dispatchEvent(new CustomEvent("drawer-close", { bubbles: true, composed: true }));
  }

  private _onSettingsToggle = () => {
    this._settingsOpen = !this._settingsOpen;
  };

  private _onSetAutoMode(mode: "immediate" | "badge-only" | "off") {
    this._settingsOpen = false;
    this.dispatchEvent(
      new CustomEvent("auto-open-mode-change", {
        detail: { mode },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onSendMessage = (e: CustomEvent<{ sessionKey: string; text: string }>) => {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("drawer-send-message", {
        detail: { agentId: this.activeAgentId, text: e.detail.text },
        bubbles: true,
        composed: true,
      }),
    );
  };

  render() {
    if (!this.isOpen || !this.activeAgentId) {
      return nothing;
    }

    const agent = this.agents.find((a) => a.id === this.activeAgentId);
    const agentName = agent?.name || this.activeAgentId;

    return html`
      <div class="drawer-inner" style="position: relative;">
        <div class="drawer-header">
          <div class="header-left">
            <span class="agent-name">${agentName}</span>
            ${this.isActive
              ? html`<span class="active-indicator"><span class="active-dot"></span>运行中</span>`
              : nothing}
            ${this.unreadCount > 0
              ? html`<span class="unread-badge">${this.unreadCount}</span>`
              : nothing}
          </div>
          <div class="header-actions">
            <button
              class="header-btn"
              @click=${this._onSettingsToggle}
              title="通知设置"
              aria-label="通知设置"
            >
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
                <circle cx="12" cy="12" r="3"></circle>
                <path
                  d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
                ></path>
              </svg>
            </button>
            <button
              class="header-btn"
              @click=${() => this._onClose()}
              title="关闭抽屉"
              aria-label="关闭抽屉"
            >
              ✕
            </button>
          </div>
        </div>

        <div class="drawer-message-list">
          ${this.messages.length === 0
            ? html`<div class="empty-hint">暂无消息</div>`
            : html`<message-list
                .messages=${this.messages}
                .pendingApprovals=${this.pendingApprovals}
                .resolvedApprovals=${this.resolvedApprovals}
                .isInitiator=${this.isInitiator}
                .showToolMessages=${this.showToolMessages}
              ></message-list>`}
        </div>

        <div class="drawer-input-area">
          <chat-input
            .session=${{ key: `sub-agent:${this.activeAgentId}` } as unknown}
            @send-message=${this._onSendMessage}
          ></chat-input>
        </div>

        ${this._settingsOpen ? this._renderSettings() : nothing}
      </div>
    `;
  }

  private _renderSettings() {
    const modes: Array<{ value: "immediate" | "badge-only" | "off"; label: string }> = [
      { value: "immediate", label: "即时展开" },
      { value: "badge-only", label: "仅角标提示" },
      { value: "off", label: "关闭通知" },
    ];
    return html`
      <div class="settings-overlay" @click=${() => (this._settingsOpen = false)}></div>
      <div class="settings-panel">
        <div class="settings-title">新消息通知</div>
        ${modes.map(
          (m) => html`
            <div
              class="settings-option ${this.autoOpenMode === m.value ? "active" : ""}"
              @click=${() => this._onSetAutoMode(m.value)}
            >
              <span class="settings-check">${this.autoOpenMode === m.value ? "✓" : ""}</span>
              <span>${m.label}</span>
            </div>
          `,
        )}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sub-agent-drawer": SubAgentDrawer;
  }
}
