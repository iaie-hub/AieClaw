import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state, query } from "lit/decorators.js";
import type { ApprovalRequest, ApprovalResolved } from "../types/approval-types.js";
import type { ChatMessage } from "../types/chat-types.js";
import type { MasSession } from "../types/session-types.js";
import { MessageList } from "../views/message-list.js";
import "../views/message-list.js";
import "../components/summary-dialog.js";
import "../components/sop-pipeline.js";

/**
 * agent-panel — 统一的 Agent 消息面板。
 *
 * 合并了原 chat-view（根 Agent）和 sub-agent-drawer（子 Agent）的功能：
 * - variant="root"：根 Agent 面板，含 summary dialog、SOP pipeline、历史翻页
 * - variant="sub"：子 Agent 面板，含 agent header（名称/状态/设置）
 *
 * 两种 variant 均支持：
 * - 消息列表 + 滚动锚点
 * - SOP pipeline
 * - 历史翻页（wheel 累加器）
 * - 未读角标
 *
 * 输入框已移除，由外部 global-input-bar 统一接管。
 */
@customElement("agent-panel")
export class AgentPanel extends LitElement {
  // ── 通用属性 ──────────────────────────────────────────────────────────────
  @property({ type: String }) variant: "root" | "sub" = "root";
  @property({ attribute: false }) messages: ChatMessage[] = [];
  @property({ attribute: false }) pendingApprovals: ApprovalRequest[] = [];
  @property({ attribute: false }) resolvedApprovals: Map<
    string,
    { approval: ApprovalRequest; resolved: ApprovalResolved }
  > = new Map();
  @property({ type: Boolean }) isInitiator = false;
  @property({ type: Boolean }) showToolMessages = true;
  /** 是否还有更早的历史页可加载 */
  @property({ type: Boolean }) hasMoreHistory = false;
  /** 是否正在聊天（Agent 运行中） */
  @property({ type: Boolean }) isChatting = false;
  /** 未读消息数（sub variant 用） */
  @property({ type: Number }) unreadCount = 0;

  // ── root variant 专属 ─────────────────────────────────────────────────────
  @property({ attribute: false }) session: MasSession | undefined = undefined;
  @property({ type: Boolean }) hasSummary = false;
  @property({ type: Boolean }) truncated = false;
  @property({ attribute: false }) sopSteps: unknown[] = [];
  @property({ attribute: false }) sopLabel = "";
  @property({ attribute: false }) sopIcon = "";
  @property({ attribute: false }) activeProgress: unknown = null;
  @property({ attribute: false }) progressLogs: unknown[] = [];
  @property({ type: Number }) currentStepIndex = -1;
  @property({ type: Number }) sopCompletedAt: number | undefined = undefined;

  // ── sub variant 专属 ──────────────────────────────────────────────────────
  @property({ type: String }) agentId = "";
  @property({ attribute: false })
  agents: { id: string; name?: string; description?: string }[] = [];
  /** 是否正在执行中（sub variant 状态指示） */
  @property({ type: Boolean }) isActive = false;
  /** 自动展示模式（sub variant 设置） */
  @property({ type: String })
  autoOpenMode: "immediate" | "badge-only" | "off" = "badge-only";
  /** 是否隐藏关闭按钮（多窗口模式下为 true） */
  @property({ type: Boolean }) hideClose = false;
  /** 是否为当前活跃输入目标（显示紫色边框） */
  @property({ type: Boolean, reflect: true }) selected = false;

  // ── 内部状态 ──────────────────────────────────────────────────────────────
  @state() private _summaryOpen = false;
  @state() private _settingsOpen = false;
  @state() private _loadingMore = false;
  @state() private _isAtBottom = true;
  @state() private _isFullscreen = false;

  private _wheelAccumulator = 0;
  private _eventsBound = false;
  private _prevMessages: ChatMessage[] | undefined;
  private _prevScrollHeight = 0;
  private _prevScrollTop = 0;
  private _anchorRestore = false;
  private _justSentUserMsg = false;

  @query(".msg-container")
  private _container!: HTMLElement;

  // ── 样式 ──────────────────────────────────────────────────────────────────
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      overflow: hidden;
      position: relative;
      min-height: 0;
      height: 100%;
      background: #ffffff;
      box-sizing: border-box;
      border: 2px solid transparent;
      transition: border-color 0.15s ease;
    }

    :host([selected]) {
      border-color: #7c3aed;
    }

    /* ── 全屏模式 ── */
    :host([fullscreen]) {
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      right: 0 !important;
      bottom: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      z-index: 9999 !important;
      border-radius: 0 !important;
      border: none !important;
      flex: none !important;
    }

    /* ── Sub variant header ── */
    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 10px;
      border-bottom: 1px solid #f1f5f9;
      flex-shrink: 0;
      background: #f8fafc;
      gap: 6px;
      min-height: 28px;
    }

    .header-left {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      flex: 1;
    }

    .agent-name {
      font-size: 11px;
      font-weight: 600;
      color: #1e293b;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .agent-role {
      font-size: 9px;
      font-weight: 500;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      flex-shrink: 0;
    }

    .active-indicator {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 10px;
      color: #22c55e;
      font-weight: 500;
    }

    .active-dot {
      width: 5px;
      height: 5px;
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
      padding: 3px 5px;
      border-radius: 5px;
      line-height: 1;
      font-size: 12px;
      transition: all 0.15s;
    }

    .header-btn:hover {
      color: #475569;
      background: #e2e8f0;
    }

    .fullscreen-btn {
      background: none;
      border: none;
      cursor: pointer;
      color: #94a3b8;
      padding: 3px 5px;
      border-radius: 5px;
      line-height: 1;
      font-size: 12px;
      transition: all 0.15s;
    }

    .fullscreen-btn:hover {
      color: #2563eb;
      background: #eff6ff;
    }

    :host([fullscreen]) .fullscreen-btn {
      color: #ef4444;
    }

    :host([fullscreen]) .fullscreen-btn:hover {
      color: #dc2626;
      background: #fef2f2;
    }

    /* ── 消息容器 ── */
    .msg-container {
      flex: 1;
      overflow-y: auto;
      overscroll-behavior-y: contain;
      min-height: 0;
    }

    :host([variant="root"]) .msg-container {
      padding: 30px;
      padding-bottom: 30px;
    }

    :host([variant="sub"]) .msg-container {
      padding: 16px;
    }

    .session-divider {
      text-align: center;
      margin-bottom: 40px;
      color: #94a3b8;
      font-size: 12px;
      letter-spacing: 2px;
    }

    .empty-hint {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: #94a3b8;
      font-size: 13px;
      margin-top: 0;
    }

    /* ── 历史加载 ── */
    .history-summary-hint {
      text-align: center;
      padding: 8px 16px;
      margin-bottom: 12px;
      background: #f0f9ff;
      border: 1px solid #bae6fd;
      border-radius: 8px;
      color: #0369a1;
      font-size: 13px;
      cursor: pointer;
    }

    .history-summary-hint:hover {
      background: #e0f2fe;
    }

    .load-more-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      width: 100%;
      padding: 8px;
      background: none;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      color: #64748b;
      font-size: 12px;
      cursor: pointer;
      transition: background 0.15s;
      margin-bottom: 8px;
      box-sizing: border-box;
    }

    .load-more-btn:hover:not(:disabled) {
      background: #f1f5f9;
    }

    .load-more-btn:disabled {
      opacity: 0.6;
      cursor: default;
    }

    .load-more-spinner {
      display: inline-block;
      width: 10px;
      height: 10px;
      border: 2px solid #cbd5e1;
      border-top-color: #64748b;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
      flex-shrink: 0;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    /* ── SOP pipeline 区域 ── */
    .sop-area {
      flex-shrink: 0;
      padding: 0 16px 8px;
    }

    /* ── 设置浮层（sub variant） ── */
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

    /* ── no-session ── */
    .no-session {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #94a3b8;
      font-size: 15px;
    }
  `;

  // ── 生命周期 ──────────────────────────────────────────────────────────────

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener("summary-click", this._onSummaryClick as EventListener);
    this.addEventListener("quick-reply", this._onQuickReply as EventListener);
    this.addEventListener("dblclick", this._onDblClick);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener("summary-click", this._onSummaryClick as EventListener);
    this.removeEventListener("quick-reply", this._onQuickReply as EventListener);
    this.removeEventListener("dblclick", this._onDblClick);
    document.removeEventListener("keydown", this._onEscKey);
    if (this._container) {
      this._container.removeEventListener("scroll", this._onScroll);
      this._container.removeEventListener("wheel", this._onWheel);
    }
    this._eventsBound = false;
  }

  override willUpdate(changed: Map<string, unknown>) {
    if (changed.has("messages") && this._container) {
      this._anchorRestore = false;
      const prev = changed.get("messages") as ChatMessage[] | undefined;

      const threshold = 150;
      let wasAtBottom = false;
      const msgList = this.shadowRoot?.querySelector("message-list") as HTMLElement | null;
      if (msgList) {
        const textBottomTarget =
          msgList.offsetTop + msgList.offsetHeight + 30 - this._container.clientHeight;
        wasAtBottom = this._container.scrollTop >= textBottomTarget - threshold;
      } else {
        wasAtBottom =
          this._container.scrollTop + this._container.clientHeight >=
          this._container.scrollHeight - threshold;
      }

      const lastMsg = this.messages[this.messages.length - 1];
      const isUserSent =
        prev &&
        prev.length < this.messages.length &&
        (lastMsg?.role === "user" || lastMsg?.role === "User");

      if (isUserSent) {
        this._justSentUserMsg = true;
      }
      this._isAtBottom = wasAtBottom || !!isUserSent;

      if (
        this._loadingMore &&
        prev &&
        prev.length > 0 &&
        prev.length < this.messages.length &&
        this._container.scrollTop < 200
      ) {
        this._prevScrollHeight = this._container.scrollHeight;
        this._prevScrollTop = this._container.scrollTop;
        this._anchorRestore = true;
      }
    }
  }

  override updated(changed: Map<string, unknown>): void {
    // 绑定滚动事件
    if (!this._container) {
      this._eventsBound = false;
    } else if (!this._eventsBound) {
      this._container.addEventListener("scroll", this._onScroll, { passive: true });
      this._container.addEventListener("wheel", this._onWheel, { passive: false });
      this._eventsBound = true;
    }

    const messagesChanged = this.messages !== this._prevMessages;
    this._prevMessages = this.messages;
    const agentChanged = changed.has("agentId");
    const sessionChanged = changed.has("session");

    if (agentChanged) {
      this._isAtBottom = true;
      this._settingsOpen = false;
    }

    if (changed.has("messages") || sessionChanged) {
      if (this._anchorRestore && this._container) {
        const delta = this._container.scrollHeight - this._prevScrollHeight;
        this._container.scrollTop = this._prevScrollTop + delta;
        setTimeout(() => {
          this._loadingMore = false;
        }, 1200);
      } else if (this._justSentUserMsg && this._container) {
        const _container = this._container;
        const msgList = this.shadowRoot?.querySelector("message-list") as MessageList | null;
        if (msgList) {
          void msgList.updateComplete.then(() => {
            requestAnimationFrame(() => {
              if (msgList.shadowRoot) {
                const userNodes = msgList.shadowRoot.querySelectorAll("msg-user");
                const lastUserNode = userNodes[userNodes.length - 1];
                if (lastUserNode) {
                  const containerRect = _container.getBoundingClientRect();
                  const nodeRect = lastUserNode.getBoundingClientRect();
                  const relativeTop = nodeRect.top - containerRect.top + _container.scrollTop;
                  _container.scrollTo({ top: relativeTop - 30, behavior: "smooth" });
                  return;
                }
              }
              this._scrollToBottom();
            });
          });
        }
        this._justSentUserMsg = false;
      } else if (this._isAtBottom || (sessionChanged && !this._anchorRestore)) {
        const _container = this._container;
        const msgList = this.shadowRoot?.querySelector("message-list") as MessageList | null;
        if (msgList) {
          void msgList.updateComplete.then(() => {
            requestAnimationFrame(() => {
              const textBottomTarget =
                msgList.offsetTop + msgList.offsetHeight + 30 - _container.clientHeight;
              if (_container.scrollTop < textBottomTarget) {
                _container.scrollTo({ top: textBottomTarget, behavior: "smooth" });
              }
            });
          });
        } else if (_container) {
          requestAnimationFrame(() => {
            _container.scrollTo({ top: _container.scrollHeight, behavior: "smooth" });
          });
        }
      }

      if (!this._anchorRestore && this._loadingMore) {
        setTimeout(() => {
          this._loadingMore = false;
        }, 500);
      }
    }

    // sub variant: 新消息到达时自动滚底
    if (this.variant === "sub" && (messagesChanged || agentChanged) && this._isAtBottom) {
      const msgList = this.shadowRoot?.querySelector("message-list") as
        | (HTMLElement & { updateComplete?: Promise<boolean> })
        | null;
      if (msgList?.updateComplete) {
        void msgList.updateComplete.then(() => {
          requestAnimationFrame(() => {
            if (this._container) {
              this._container.scrollTop = this._container.scrollHeight;
            }
          });
        });
      }
    }
  }

  // ── 滚动处理 ──────────────────────────────────────────────────────────────

  private _onScroll = () => {
    if (!this._container) {
      return;
    }
    if (this._container.scrollTop > 10) {
      this._wheelAccumulator = 0;
    }

    const threshold = 150;
    const msgList = this.shadowRoot?.querySelector("message-list") as HTMLElement | null;
    if (msgList) {
      const textBottomTarget =
        msgList.offsetTop + msgList.offsetHeight + 30 - this._container.clientHeight;
      this._isAtBottom = this._container.scrollTop >= textBottomTarget - threshold;
    } else {
      this._isAtBottom =
        this._container.scrollTop + this._container.clientHeight >=
        this._container.scrollHeight - threshold;
    }
  };

  private _onWheel = (e: WheelEvent) => {
    if (this._container.scrollTop <= 0 && e.deltaY < 0 && e.cancelable) {
      e.preventDefault();
    }
    if (!this.hasMoreHistory || this._loadingMore) {
      return;
    }

    if (this._container.scrollTop <= 0) {
      if (e.deltaY < 0) {
        this._wheelAccumulator += Math.abs(e.deltaY);
        if (this._wheelAccumulator > 1200) {
          this._triggerLoadMore();
          this._wheelAccumulator = 0;
        }
      } else {
        this._wheelAccumulator = 0;
      }
    }
  };

  private _triggerLoadMore() {
    if (this._loadingMore) {
      return;
    }
    this._loadingMore = true;

    if (this.variant === "root" && this.session) {
      this.dispatchEvent(
        new CustomEvent("load-more-history", {
          detail: { sessionKey: this.session.key },
          bubbles: true,
          composed: true,
        }),
      );
    } else if (this.variant === "sub" && this.agentId) {
      this.dispatchEvent(
        new CustomEvent("load-more-history", {
          detail: { agentId: this.agentId },
          bubbles: true,
          composed: true,
        }),
      );
    }

    setTimeout(() => {
      this._loadingMore = false;
    }, 3000);
  }

  private _scrollToBottom() {
    if (!this._container) {
      return;
    }
    const msgList = this.shadowRoot?.querySelector("message-list") as MessageList | null;
    if (msgList) {
      void msgList.updateComplete.then(() => {
        if (this._container) {
          const textBottomTarget =
            msgList.offsetTop + msgList.offsetHeight + 30 - this._container.clientHeight;
          this._container.scrollTo({ top: Math.max(0, textBottomTarget), behavior: "smooth" });
        }
      });
    } else {
      this._container.scrollTo({ top: this._container.scrollHeight, behavior: "smooth" });
    }
    this._isAtBottom = true;
  }

  // ── 事件处理 ──────────────────────────────────────────────────────────────

  private _onQuickReply = (e: CustomEvent<{ text: string }>) => {
    const session = this.variant === "root" ? this.session : undefined;
    if (!session) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent("send-message", {
        detail: { sessionKey: session.key, text: e.detail.text },
        bubbles: true,
        composed: true,
      }),
    );
  };

  private _onSummaryClick = (e: CustomEvent) => {
    e.stopPropagation();
    this._summaryOpen = true;
    void this.updateComplete.then(() => {
      const dialog = this.shadowRoot?.querySelector("summary-dialog") as
        | import("../components/summary-dialog.js").SummaryDialog
        | null;
      void dialog?.openDialog();
    });
  };

  private _onSummaryClose = () => {
    this._summaryOpen = false;
  };

  private _onClose() {
    this.dispatchEvent(new CustomEvent("panel-close", { bubbles: true, composed: true }));
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

  // ── 全屏操作 ──────────────────────────────────────────────────────────────

  private _toggleFullscreen() {
    this._isFullscreen = !this._isFullscreen;
    if (this._isFullscreen) {
      this.setAttribute("fullscreen", "");
      document.addEventListener("keydown", this._onEscKey);
    } else {
      this.removeAttribute("fullscreen");
      document.removeEventListener("keydown", this._onEscKey);
    }
  }

  private _onEscKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this._isFullscreen) {
      e.preventDefault();
      e.stopPropagation();
      this._toggleFullscreen();
    }
  };

  private _onDblClick = (e: Event) => {
    // 避免双击按钮、输入框等元素时触发全屏
    const target = e.target as HTMLElement;
    if (target.closest("button, input, textarea, a, .settings-panel, .settings-overlay")) {
      return;
    }
    this._toggleFullscreen();
  };

  /** 供外部调用：通知面板用户刚发送了消息，触发滚动对齐 */
  notifySent() {
    this._isAtBottom = true;
    this._justSentUserMsg = true;
  }

  // ── 渲染 ──────────────────────────────────────────────────────────────────

  render() {
    if (this.variant === "root") {
      return this._renderRoot();
    }
    return this._renderSub();
  }

  private _renderRoot() {
    if (!this.session) {
      return html`<div class="no-session">请选择或创建一个会话</div>`;
    }
    const isOwner = this.session.masType === "initiated";
    const agentName =
      this.agents?.find((a) => a.id === this.agentId)?.name || this.agentId || "主 Agent";

    return html`
      <div class="panel-header" style="position:relative;">
        <div class="header-left">
          <span class="agent-name">${agentName}</span>
          <span class="agent-role">orchestrator</span>
          ${this.isChatting
            ? html`<span class="active-indicator"><span class="active-dot"></span>运行中</span>`
            : nothing}
        </div>
        <div class="header-actions">
          <button
            class="fullscreen-btn"
            @click=${() => this._toggleFullscreen()}
            title=${this._isFullscreen ? "退出全屏 (ESC)" : "全屏查看，ESC 退出"}
            aria-label=${this._isFullscreen ? "退出全屏" : "全屏查看"}
          >
            ${this._isFullscreen
              ? html`<svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polyline points="4 14 10 14 10 20"></polyline>
                  <polyline points="20 10 14 10 14 4"></polyline>
                  <line x1="14" y1="10" x2="21" y2="3"></line>
                  <line x1="3" y1="21" x2="10" y2="14"></line>
                </svg>`
              : html`<svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polyline points="15 3 21 3 21 9"></polyline>
                  <polyline points="9 21 3 21 3 15"></polyline>
                  <line x1="21" y1="3" x2="14" y2="10"></line>
                  <line x1="3" y1="21" x2="10" y2="14"></line>
                </svg>`}
          </button>
          ${this.hasSummary
            ? html`<button
                class="header-btn"
                @click=${this._onSummaryClick}
                title="查看摘要"
                aria-label="查看摘要"
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
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                  <polyline points="14 2 14 8 20 8"></polyline>
                  <line x1="16" y1="13" x2="8" y2="13"></line>
                  <line x1="16" y1="17" x2="8" y2="17"></line>
                  <polyline points="10 9 9 9 8 9"></polyline>
                </svg>
              </button>`
            : nothing}
        </div>
      </div>

      <div class="msg-container">
        ${this.hasMoreHistory
          ? html`
              <button
                class="load-more-btn"
                ?disabled=${this._loadingMore}
                @click=${() => this._triggerLoadMore()}
              >
                ${this._loadingMore
                  ? html`<span class="load-more-spinner"></span>加载中…`
                  : html`↑ 加载更多消息`}
              </button>
            `
          : nothing}
        ${this.hasSummary
          ? html`
              <div class="history-summary-hint" @click=${this._onSummaryClick}>
                <span>更早的消息已生成摘要，点击查看</span>
              </div>
            `
          : nothing}
        ${this.messages.length === 0
          ? html`<div class="empty-hint">暂无消息</div>`
          : html` <message-list
              .messages=${this.messages}
              .pendingApprovals=${this.pendingApprovals}
              .resolvedApprovals=${this.resolvedApprovals}
              .isInitiator=${this.isInitiator}
              .showToolMessages=${this.showToolMessages}
              .sopSteps=${this.sopSteps}
              .sopLabel=${this.sopLabel}
              .activeProgress=${this.activeProgress}
              .progressLogs=${this.progressLogs}
            ></message-list>`}
      </div>

      ${this.sopSteps.length > 0
        ? html`
            <div class="sop-area">
              <sop-pipeline
                .steps=${this.sopSteps}
                .sopLabel=${this.sopLabel}
                .sopIcon=${this.sopIcon}
                .activeProgress=${this.activeProgress}
                .logs=${this.progressLogs}
                .currentStepIndex=${this.currentStepIndex}
                .completedAt=${this.sopCompletedAt}
                compact
              ></sop-pipeline>
            </div>
          `
        : nothing}

      <summary-dialog
        .session=${this.session}
        .isOwner=${isOwner}
        .open=${this._summaryOpen}
        @summary-close=${this._onSummaryClose}
      ></summary-dialog>
    `;
  }

  private _renderSub() {
    const agent = this.agents.find((a) => a.id === this.agentId);
    const agentName = agent?.name || this.agentId;

    return html`
      <div class="panel-header" style="position:relative;">
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
            class="fullscreen-btn"
            @click=${() => this._toggleFullscreen()}
            title=${this._isFullscreen ? "退出全屏 (ESC)" : "全屏查看，ESC 退出"}
            aria-label=${this._isFullscreen ? "退出全屏" : "全屏查看"}
          >
            ${this._isFullscreen
              ? html`<svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polyline points="4 14 10 14 10 20"></polyline>
                  <polyline points="20 10 14 10 14 4"></polyline>
                  <line x1="14" y1="10" x2="21" y2="3"></line>
                  <line x1="3" y1="21" x2="10" y2="14"></line>
                </svg>`
              : html`<svg
                  width="13"
                  height="13"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <polyline points="15 3 21 3 21 9"></polyline>
                  <polyline points="9 21 3 21 3 15"></polyline>
                  <line x1="21" y1="3" x2="14" y2="10"></line>
                  <line x1="3" y1="21" x2="10" y2="14"></line>
                </svg>`}
          </button>
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
          ${this.hideClose
            ? nothing
            : html`<button
                class="header-btn"
                @click=${() => this._onClose()}
                title="关闭"
                aria-label="关闭"
              >
                ✕
              </button>`}
        </div>
        ${this._settingsOpen ? this._renderSettings() : nothing}
      </div>

      <div class="msg-container">
        ${this.hasMoreHistory
          ? html`
              <button
                class="load-more-btn"
                ?disabled=${this._loadingMore}
                @click=${() => this._triggerLoadMore()}
              >
                ${this._loadingMore
                  ? html`<span class="load-more-spinner"></span>加载中…`
                  : html`↑ 加载更多消息`}
              </button>
            `
          : nothing}
        ${this.messages.length === 0
          ? html`<div class="empty-hint">暂无消息</div>`
          : html`<message-list
              .messages=${this.messages}
              .pendingApprovals=${this.pendingApprovals}
              .resolvedApprovals=${this.resolvedApprovals}
              .isInitiator=${this.isInitiator}
              .showToolMessages=${this.showToolMessages}
              .sopSteps=${this.sopSteps}
              .sopLabel=${this.sopLabel}
              .activeProgress=${this.activeProgress}
              .progressLogs=${this.progressLogs}
            ></message-list>`}
      </div>

      ${this.sopSteps.length > 0
        ? html`
            <div class="sop-area">
              <sop-pipeline
                .steps=${this.sopSteps}
                .sopLabel=${this.sopLabel}
                .sopIcon=${this.sopIcon}
                .activeProgress=${this.activeProgress}
                .logs=${this.progressLogs}
                .currentStepIndex=${this.currentStepIndex}
                .completedAt=${this.sopCompletedAt}
                compact
              ></sop-pipeline>
            </div>
          `
        : nothing}
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
    "agent-panel": AgentPanel;
  }
}
