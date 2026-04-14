import { LitElement, html, css } from "lit";
import { customElement, property, query } from "lit/decorators.js";
import type { ChatMessage } from "../types/chat-types.js";
import "./message-list.js";

/**
 * 辅窗口面板：显示 Sub_Agent 的消息流。
 * - Tab 栏切换不同 Sub_Agent
 * - 未读指示器（●）
 * - 独立滚动的 message-list（自动吸附底部）
 * - 复用 message-list 的完整渲染能力：markdown / LaTeX / tool_call / tool_result
 * - 不包含用户输入区
 */
@customElement("secondary-panel")
export class SecondaryPanel extends LitElement {
  /** 所有 Sub_Agent 的消息集合 (agentId → messages) */
  @property({
    attribute: false,
    // Map 引用在流式更新时不变（store 原地更新内部数组），
    // 需要自定义 hasChanged 以检测内部数组引用变化
    hasChanged: () => true,
  })
  agentMessages: Map<string, ChatMessage[]> = new Map();

  /** 拓扑中的 Sub_Agent 列表 */
  @property({ attribute: false })
  subAgents: string[] = [];

  /** 当前活跃 Tab */
  @property({ type: String })
  activeTab = "";

  /** 未读 Agent 集合 */
  @property({ attribute: false })
  unreadAgents: Set<string> = new Set();

  /** 是否显示工具消息 */
  @property({ type: Boolean })
  showToolMessages = true;

  /** 正在执行中的 Sub_Agent 集合 */
  @property({ attribute: false })
  activeAgents: Set<string> = new Set();

  @query(".message-area")
  private _scrollContainer!: HTMLElement | null;

  /** 是否处于底部（用于自动吸附） */
  private _isAtBottom = true;

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      overflow: hidden;
      border-left: 1px solid #e2e8f0;
      background: #ffffff;
    }

    .tab-bar {
      display: flex;
      align-items: center;
      gap: 0;
      padding: 0 12px;
      border-bottom: 1px solid #e2e8f0;
      background: #f8fafc;
      min-height: 40px;
      overflow-x: auto;
      flex-shrink: 0;
    }

    .tab-item {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 8px 14px;
      font-size: 13px;
      color: #64748b;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: all 0.15s;
      white-space: nowrap;
      user-select: none;
    }

    .tab-item:hover {
      color: #334155;
      background: #f1f5f9;
    }

    .tab-item.active {
      color: #3b82f6;
      border-bottom-color: #3b82f6;
      font-weight: 500;
    }

    .unread-dot {
      display: inline-block;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #3b82f6;
      flex-shrink: 0;
    }

    .pulse-dot {
      display: inline-block;
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: #22c55e;
      flex-shrink: 0;
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

    .message-area {
      flex: 1;
      overflow-y: auto;
      min-height: 0;
      padding: 20px;
      /* 辅窗口中 agent 消息气泡的差异化样式 — 通过 CSS 自定义属性传递 */
      --msg-agent-border-left: 3px solid #3b82f6;
      --msg-agent-bg: #f8fafc;
    }

    .empty-hint {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: #94a3b8;
      font-size: 14px;
    }

    .tab-empty-hint {
      text-align: center;
      color: #94a3b8;
      font-size: 13px;
      margin-top: 40px;
    }
  `;

  // ── 自动滚动吸附（与 chat-view 同逻辑） ──────────────────────────────────

  override connectedCallback(): void {
    super.connectedCallback();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._unbindScroll();
  }

  private _scrollBound = false;

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
    const threshold = 150;
    this._isAtBottom =
      this._scrollContainer.scrollTop + this._scrollContainer.clientHeight >=
      this._scrollContainer.scrollHeight - threshold;
  };

  /** 上一次渲染时活跃 tab 的消息数组引用，用于检测流式更新 */
  private _prevActiveMessages: ChatMessage[] | undefined;

  override updated(changed: Map<string, unknown>): void {
    // 确保滚动事件绑定（容器可能在首次渲染后才出现）
    this._bindScroll();

    // 检测当前活跃 tab 的消息数组引用是否变化（流式更新时 Map 引用不变但内部数组引用变化）
    const currentMessages = this.agentMessages.get(this.activeTab);
    const messagesChanged = currentMessages !== this._prevActiveMessages;
    this._prevActiveMessages = currentMessages;

    const tabChanged = changed.has("activeTab");

    if (tabChanged || messagesChanged) {
      if (tabChanged) {
        // 切换 tab 时始终滚动到底部
        this._isAtBottom = true;
      }
      if (this._isAtBottom) {
        // 等待 message-list 渲染完成后再滚动，确保内容高度已更新
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
  }

  // ── Tab 切换 ──────────────────────────────────────────────────────────────

  private _onTabClick(agentId: string): void {
    this.dispatchEvent(
      new CustomEvent("tab-change", {
        detail: { agentId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  render() {
    if (this.subAgents.length === 0) {
      return html`<div class="empty-hint">暂无子 Agent</div>`;
    }

    const activeMessages = this.agentMessages.get(this.activeTab) ?? [];

    return html`
      <div class="tab-bar">
        ${this.subAgents.map(
          (agentId) => html`
            <div
              class="tab-item ${agentId === this.activeTab ? "active" : ""}"
              @click=${() => this._onTabClick(agentId)}
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
                style="margin-right: 4px; opacity: 0.8;"
              >
                <rect x="3" y="11" width="18" height="10" rx="2"></rect>
                <circle cx="9" cy="16" r="1"></circle>
                <circle cx="15" cy="16" r="1"></circle>
                <path d="M8 11V7a4 4 0 0 1 8 0v4"></path>
                <line x1="12" y1="3" x2="12" y2="1"></line>
              </svg>
              <span>${agentId}</span>
              ${this.activeAgents.has(agentId)
                ? html`<span class="pulse-dot"></span>`
                : this.unreadAgents.has(agentId)
                  ? html`<span class="unread-dot"></span>`
                  : ""}
            </div>
          `,
        )}
      </div>
      <div class="message-area">
        ${activeMessages.length === 0
          ? html`<div class="tab-empty-hint">暂无消息</div>`
          : html`<message-list
              .messages=${activeMessages}
              .showToolMessages=${this.showToolMessages}
            ></message-list>`}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "secondary-panel": SecondaryPanel;
  }
}
