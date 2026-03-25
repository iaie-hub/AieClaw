import { LitElement, html, css } from "lit";
import { customElement, property, state, query } from "lit/decorators.js";
import type { ApprovalRequest } from "../types/approval-types.js";
import type { ChatMessage } from "../types/chat-types.js";
import type { MasSession } from "../types/session-types.js";
import "./message-list.js";
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
  @property({ type: Boolean }) isInitiator = false;
  @property({ type: Boolean }) hasSummary = false;
  @property({ type: Boolean }) truncated = false;
  /** 是否还有更早的历史页可加载（page < totalPages） */
  @property({ type: Boolean }) hasMoreHistory = false;

  @state() private _inputText = "";
  @state() private _summaryOpen = false;
  @state() private _loadingMore = false;

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

    .chat-container {
      flex: 1;
      overflow-y: auto;
      padding: 30px;
      scroll-behavior: smooth;
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
    }

    .chat-input-area {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 20px;
      padding: 15px 20px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.05);
      transition: all 0.3s;
    }

    .chat-input-area:focus-within {
      border-color: #93c5fd;
      box-shadow: 0 10px 30px rgba(59, 130, 246, 0.1);
    }

    textarea {
      width: 100%;
      border: none;
      outline: none;
      resize: none;
      font-size: 15px;
      font-family: inherit;
      color: #1e293b;
      background: transparent;
      line-height: 1.5;
      box-sizing: border-box;
    }

    textarea::placeholder {
      color: #94a3b8;
    }

    .input-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 10px;
    }

    .input-hint {
      font-size: 12px;
      color: #94a3b8;
    }

    .send-btn {
      padding: 8px 20px;
      background: linear-gradient(135deg, #3b82f6 0%, #6366f1 100%);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
      box-shadow: 0 4px 10px rgba(59, 130, 246, 0.3);
    }

    .send-btn:hover {
      transform: translateY(-1px);
      box-shadow: 0 6px 15px rgba(59, 130, 246, 0.4);
    }

    .send-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
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
      display: block;
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
    }
    .load-more-btn:hover:not(:disabled) {
      background: #f1f5f9;
    }
    .load-more-btn:disabled {
      opacity: 0.5;
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
      margin-right: 6px;
      vertical-align: middle;
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

  override willUpdate(changed: Map<string, unknown>) {
    // 在 DOM 更新前采样滚动高度，用于前插消息后恢复位置
    if (changed.has("messages") && this._container) {
      const prev = changed.get("messages") as ChatMessage[] | undefined;
      if ((prev?.length ?? 0) < this.messages.length && this._container.scrollTop < 200) {
        // 仅在靠近顶部时才需要锚点恢复（前插场景）
        this._prevScrollHeight = this._container.scrollHeight;
        this._prevScrollTop = this._container.scrollTop;
        this._anchorRestore = true;
      }
    }
  }

  updated(changed: Map<string, unknown>) {
    if (changed.has("messages")) {
      if (this._anchorRestore && this._container) {
        // 前插消息后：补偿新增高度，使用户视口保持不动
        const delta = this._container.scrollHeight - this._prevScrollHeight;
        this._container.scrollTop = this._prevScrollTop + delta;
        this._anchorRestore = false;
        // 前插完成后重置加载状态
        this._loadingMore = false;
      } else {
        // 实时新消息追加到末尾：滚动到底部
        requestAnimationFrame(() => {
          if (this._container) {
            this._container.scrollTop = this._container.scrollHeight;
          }
        });
      }
    }
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener("summary-click", this._onSummaryClick as EventListener);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener("summary-click", this._onSummaryClick as EventListener);
    this._container?.removeEventListener("scroll", this._onScroll);
  }

  override firstUpdated() {
    if (this._container) {
      this._container.addEventListener("scroll", this._onScroll, { passive: true });
    }
  }

  // ── 滚动到顶部触发向上翻页 ────────────────────────────────────────────────

  /**
   * 当容器滚动到距顶部 40px 以内时触发向上翻页。
   * _loadingMore 防止重复触发。
   */
  private _onScroll = () => {
    if (!this.hasMoreHistory || this._loadingMore) {
      return;
    }
    if (this._container.scrollTop <= 40) {
      this._triggerLoadMore();
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

  private _onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      this._onSend();
    }
  };

  private get _isArchived(): boolean {
    return this.session?.archivedAt != null;
  }

  private _onSend = () => {
    const text = this._inputText.trim();
    if (!text || !this.session || this._isArchived) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent("send-message", {
        detail: { sessionKey: this.session.key, text },
        bubbles: true,
        composed: true,
      }),
    );
    this._inputText = "";
  };

  // ── 摘要弹窗 ──────────────────────────────────────────────────────────────

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

  // ── render ────────────────────────────────────────────────────────────────

  render() {
    if (!this.session) {
      return html`
        <div class="no-session">请选择或创建一个会话</div>
      `;
    }

    const isOwner = this.session.masType === "initiated";

    return html`
      <div class="chat-container">
        ${
          this.hasMoreHistory
            ? html`
              <button
                class="load-more-btn"
                ?disabled=${this._loadingMore}
                @click=${() => this._triggerLoadMore()}
              >
                ${
                  this._loadingMore
                    ? html`
                        <span class="load-more-spinner"></span>加载中…
                      `
                    : "↑ 加载更早的消息"
                }
              </button>
            `
            : ""
        }
        ${
          this.hasSummary
            ? html`
              <div class="history-summary-hint" @click=${this._onSummaryClick}>
                <span>更早的消息已生成摘要，点击查看</span>
              </div>
            `
            : ""
        }
        <div class="session-divider">—— 协作链路已加密连接 ——</div>
        ${
          this.messages.length === 0
            ? html`
                <div class="empty-hint">暂无消息，发送第一条消息开始协作</div>
              `
            : html`<message-list
              .messages=${this.messages}
              .pendingApprovals=${this.pendingApprovals}
              .isInitiator=${this.isInitiator}
            ></message-list>`
        }
      </div>

      <summary-dialog
        .session=${this.session}
        .isOwner=${isOwner}
        .open=${this._summaryOpen}
        @summary-close=${this._onSummaryClose}
      ></summary-dialog>

      <div class="chat-input-wrapper">
        <div class="chat-input-area">
          <textarea
            rows="2"
            placeholder=${
              this._isArchived
                ? "会话已归档，无法发送消息"
                : "输入消息，Shift+Enter 换行，Enter 发送…"
            }
            .value=${this._inputText}
            ?disabled=${this._isArchived}
            @input=${(e: Event) => {
              this._inputText = (e.target as HTMLTextAreaElement).value;
            }}
            @keydown=${this._onKeyDown}
          ></textarea>
          <div class="input-toolbar">
            <span class="input-hint">Shift+Enter 换行</span>
            <button
              class="send-btn"
              ?disabled=${this._isArchived || !this._inputText.trim()}
              @click=${this._onSend}
            >
              发送
            </button>
          </div>
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
