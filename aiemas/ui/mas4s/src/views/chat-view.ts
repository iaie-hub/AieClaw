import { LitElement, html, css } from "lit";
import { customElement, property, state, query } from "lit/decorators.js";
import type { ApprovalRequest, ApprovalResolved } from "../types/approval-types.js";
import type { ChatMessage } from "../types/chat-types.js";
import type { MasSession } from "../types/session-types.js";
import { MessageList } from "./message-list.js";
import "./chat-input.js";
import "../components/summary-dialog.js";

/**
 * 聊天视图：消息列表 + 输入区。
 * - Enter 发送，Shift+Enter 换行
 * - 空白消息拦截
 * - 发送后清空输入框
 * - 触发 send-message 事件
 * - 滚动到顶部时触发 load-more-history 事件（向上翻页）
 */
@customElement("chat-view")
export class ChatView extends LitElement {
  @property({ attribute: false }) messages: ChatMessage[] = [];
  @property({ attribute: false }) session: MasSession | undefined = undefined;
  @property({ attribute: false }) pendingApprovals: ApprovalRequest[] = [];
  @property({ attribute: false }) resolvedApprovals: Map<
    string,
    { approval: ApprovalRequest; resolved: ApprovalResolved }
  > = new Map();
  @property({ type: Boolean }) isInitiator = false;
  @property({ type: Boolean }) hasSummary = false;
  @property({ type: Boolean }) truncated = false;
  /** 是否还有更早的历史页可加载（page < totalPages） */
  @property({ type: Boolean }) hasMoreHistory = false;
  /** 是否正在聊天（Agent 运行中） */
  @property({ type: Boolean }) isChatting = false;
  /** 是否显示工具调用/结果消息 */
  @property({ type: Boolean }) showToolMessages = true;

  // ── SOP state (passed through to message-list) ────────────────────────────
  @property({ attribute: false }) sopSteps: unknown[] = [];
  @property({ attribute: false }) sopLabel = "";
  @property({ attribute: false }) activeProgress: unknown = null;
  @property({ attribute: false }) progressLogs: unknown[] = [];
  @property({ type: Number }) currentStepIndex = -1;
  @property({ type: Number }) sopCompletedAt: number | undefined = undefined;

  @state() private _summaryOpen = false;
  @state() private _loadingMore = false;
  private _eventsBound = false;
  private _wheelAccumulator = 0;
  private _isAtBottom = true;

  @query(".chat-container")
  private _container!: HTMLElement;

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      overflow: hidden;
      position: relative;
    }

    .chat-view {
      display: flex;
      flex-direction: column;
      height: 100%;
      flex: 1;
      overflow: hidden;
    }

    .chat-container {
      flex: 1;
      overflow-y: auto;
      padding: 30px;
      padding-bottom: 70vh;
      overscroll-behavior-y: contain;
      min-height: 0;
    }

    .session-divider {
      text-align: center;
      margin-bottom: 40px;
      color: #94a3b8;
      font-size: 12px;
      letter-spacing: 2px;
    }

    .empty-hint {
      text-align: center;
      color: #94a3b8;
      font-size: 14px;
      margin-top: 60px;
    }

    .chat-input-wrapper {
      padding: 0 30px 30px;
      position: relative;
      z-index: 10;
      flex-shrink: 0;
      background: #ffffff;
    }

    .no-session {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #94a3b8;
      font-size: 15px;
    }

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

    .scroll-bottom-btn {
      position: absolute;
      right: 50%;
      transform: translateX(50%);
      top: -44px;
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 50%;
      cursor: pointer;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      transition: all 0.2s;
      z-index: 20;
      color: #64748b;
    }
    .scroll-bottom-btn:hover {
      background: #f8fafc;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      color: #334155;
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
  `;

  // ── 滚动锚点（前插消息时保持视口不跳动） ─────────────────────────────────
  private _prevScrollHeight = 0;
  private _prevScrollTop = 0;
  private _anchorRestore = false;
  private _justSentUserMsg = false;

  override willUpdate(changed: Map<string, unknown>) {
    if (changed.has("messages") && this._container) {
      this._anchorRestore = false;
      const prev = changed.get("messages") as ChatMessage[] | undefined;

      // 在更新前判断用户是否已经处于底部（或非常接近底部）
      // 阈值设为 150px，容忍轻微偏差
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

      // 如果是用户刚发送了消息（消息数量增加且最后一条是 user），强制视为处于底部
      const lastMsg = this.messages[this.messages.length - 1];
      const isUserSent =
        prev &&
        prev.length < this.messages.length &&
        (lastMsg?.role === "user" || lastMsg?.role === "User");

      if (isUserSent) {
        this._justSentUserMsg = true;
      }

      this._isAtBottom = wasAtBottom || !!isUserSent;

      // History prepend logic: 只有在明确触发了 _loadingMore 且 scrollTop 接近顶部时才启动锚点恢复
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

  /** 用户发送消息后立即触发的滚动逻辑（置顶感官） */
  private _handleSendScroll = () => {
    this._isAtBottom = true;
    this._justSentUserMsg = true;

    // 1. 立即尝试对齐当前列表底部（预测新消息诞生位置）
    const msgList = this.shadowRoot?.querySelector("message-list") as HTMLElement | null;
    if (this._container && msgList) {
      const currentBottom = msgList.offsetTop + msgList.offsetHeight;
      this._container.scrollTo({ top: currentBottom - 30, behavior: "smooth" });
    }
  };

  updated(changed: Map<string, unknown>) {
    // Re-bind events if container was destroyed and recreated (e.g. session switch).
    if (!this._container) {
      this._eventsBound = false;
    } else if (!this._eventsBound) {
      this._container.addEventListener("scroll", this._onScroll, { passive: true });
      // passive: false required so we can call preventDefault() to stop scroll chaining
      this._container.addEventListener("wheel", this._onWheel, { passive: false });
      this._eventsBound = true;
    }

    if (changed.has("messages") || changed.has("session")) {
      if (this._anchorRestore && this._container) {
        // 前插消息后：补偿新增高度，使用户视口保持不动
        const delta = this._container.scrollHeight - this._prevScrollHeight;
        this._container.scrollTop = this._prevScrollTop + delta;
        // 延迟 1200ms 释放锁，由于 history 可能分批返回，这里给足缓冲期
        setTimeout(() => {
          this._loadingMore = false;
        }, 1200);
      } else if (this._justSentUserMsg && this._container) {
        console.log("[chat-view] executing justSentUserMsg align-to-top logic");
        // 用户发出消息时，将其置顶对齐
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
              console.log("[chat-view] lastUserNode not found, falling back to _scrollToBottom");
              this._scrollToBottom();
            });
          });
        }
        // Consume flag
        this._justSentUserMsg = false;
      } else if (this._isAtBottom || (changed.has("session") && !this._anchorRestore)) {
        // 实时新消息追加、Streaming 或 切换会话：
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

      // 如果 _loadingMore 被开启但最终没有进入锚点逻辑（例如新消息插到了末尾），也需要重置加载状态
      if (!this._anchorRestore && this._loadingMore) {
        setTimeout(() => {
          this._loadingMore = false;
        }, 500);
      }
    }
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener("summary-click", this._onSummaryClick as EventListener);
    this.addEventListener("quick-reply", this._onQuickReply as EventListener);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener("summary-click", this._onSummaryClick as EventListener);
    this.removeEventListener("quick-reply", this._onQuickReply as EventListener);
    if (this._container) {
      this._container.removeEventListener("scroll", this._onScroll);
      this._container.removeEventListener("wheel", this._onWheel);
    }
    this._eventsBound = false;
  }

  override firstUpdated() {
    // Event binding is handled in updated() to handle the case where _container
    // is null on first render (session undefined → .no-session placeholder shown).
  }

  // ── 滚动到顶部触发向上翻页 ────────────────────────────────────────────────

  /**
   * scroll 事件：同步 _lastScrollTop，并在离开顶部时重置累加器。
   * 加载判断完全交由 _onWheel 的累加器接管，避免瞬间触发。
   */
  private _onScroll = () => {
    // Reset accumulator once user scrolls away from top
    if (this._container.scrollTop > 10) {
      this._wheelAccumulator = 0;
    }
    // Track whether user is near the bottom for scroll-to-bottom button visibility
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

  /**
   * wheel 事件：累加器蓄力机制。
   * 只有在顶部持续向上滚动、累计力度超过阈值后才触发翻页，
   * 避免轻微触碰或惯性残余误触。
   */
  private _onWheel = (e: WheelEvent) => {
    // Always prevent scroll chaining when at top and scrolling up
    if (this._container.scrollTop <= 0 && e.deltaY < 0 && e.cancelable) {
      e.preventDefault();
    }

    if (!this.hasMoreHistory || this._loadingMore) {
      return;
    }

    if (this._container.scrollTop <= 0) {
      if (e.deltaY < 0) {
        // Accumulate upward scroll force
        this._wheelAccumulator += Math.abs(e.deltaY);
        // Threshold: user must scroll with enough intent before triggering page load
        if (this._wheelAccumulator > 1200) {
          this._triggerLoadMore();
          this._wheelAccumulator = 0;
        }
      } else {
        // Scrolling down — discard accumulated force
        this._wheelAccumulator = 0;
      }
    }
  };

  private _triggerLoadMore() {
    if (!this.session || this._loadingMore) {
      return;
    }
    this._loadingMore = true;
    this.dispatchEvent(
      new CustomEvent("load-more-history", {
        detail: { sessionKey: this.session.key },
        bubbles: true,
        composed: true,
      }),
    );
    // 兜底：3s 后若父组件未响应则重置，避免 spinner 永久显示
    setTimeout(() => {
      this._loadingMore = false;
    }, 3000);
  }

  // ── 输入区 ────────────────────────────────────────────────────────────────

  private get _isArchived(): boolean {
    return this.session?.archivedAt != null;
  }

  private _onQuickReply = (e: CustomEvent<{ text: string }>) => {
    if (!this.session || this._isArchived) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent("send-message", {
        detail: { sessionKey: this.session.key, text: e.detail.text },
        bubbles: true,
        composed: true,
      }),
    );
    this._handleSendScroll();
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

  private _scrollToBottom = () => {
    if (this._container) {
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
  };

  // ── render ────────────────────────────────────────────────────────────────

  render() {
    if (!this.session) {
      return html` <div class="no-session">请选择或创建一个会话</div> `;
    }

    const isOwner = this.session.masType === "initiated";

    return html`
      <div class="chat-view">
        <div class="chat-container">
          ${this.hasMoreHistory
            ? html`
                <button
                  class="load-more-btn"
                  ?disabled=${this._loadingMore}
                  @click=${() => this._triggerLoadMore()}
                >
                  ${this._loadingMore
                    ? html` <span class="load-more-spinner"></span>加载中… `
                    : html` ↑ 加载更多消息 `}
                </button>
              `
            : ""}
          ${this.hasSummary
            ? html`
                <div class="history-summary-hint" @click=${this._onSummaryClick}>
                  <span>更早的消息已生成摘要，点击查看</span>
                </div>
              `
            : ""}
          <div class="session-divider">—— 协作链路已加密连接 ——</div>
          ${this.messages.length === 0
            ? html` <div class="empty-hint">暂无消息，发送第一条消息开始协作</div> `
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

        <summary-dialog
          .session=${this.session}
          .isOwner=${isOwner}
          .open=${this._summaryOpen}
          @summary-close=${this._onSummaryClose}
        ></summary-dialog>

        <div class="chat-input-wrapper">
          <button class="scroll-bottom-btn" @click=${this._scrollToBottom} title="滚动到最新消息">
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
          ${this.sopSteps.length > 0 && !this._isArchived && this.isChatting
            ? html`
                <div style="margin-bottom: 8px;">
                  <sop-pipeline
                    .steps=${this.sopSteps}
                    .sopLabel=${this.sopLabel}
                    .activeProgress=${this.activeProgress}
                    .logs=${this.progressLogs}
                    .currentStepIndex=${this.currentStepIndex}
                    .completedAt=${this.sopCompletedAt}
                    compact
                  ></sop-pipeline>
                </div>
              `
            : ""}
          <chat-input
            .session=${this.session}
            .isChatting=${this.isChatting}
            @send-message=${this._handleSendScroll}
          ></chat-input>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "chat-view": ChatView;
  }
}
