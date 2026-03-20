import { LitElement, html, css } from "lit";
import { customElement, property, state, query } from "lit/decorators.js";
import type { ApprovalRequest } from "../types/approval-types.js";
import type { ChatMessage } from "../types/chat-types.js";
import type { MasSession } from "../types/session-types.js";
import "./message-list.js";

/**
 * 聊天视图：消息列表 + 输入区。
 * - Enter 发送，Shift+Enter 换行
 * - 空白消息拦截
 * - 发送后清空输入框
 * - 触发 send-message 事件
 */
@customElement("chat-view")
export class ChatView extends LitElement {
  @property({ attribute: false }) messages: ChatMessage[] = [];
  @property({ attribute: false }) session: MasSession | undefined = undefined;
  @property({ attribute: false }) pendingApprovals: ApprovalRequest[] = [];
  @property({ type: Boolean }) isInitiator = false;

  @state() private _inputText = "";

  @query(".chat-container")
  private _container!: HTMLElement;

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      overflow: hidden;
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
  `;

  updated(changed: Map<string, unknown>) {
    if (changed.has("messages")) {
      // 新消息到来时滚动到底部
      requestAnimationFrame(() => {
        if (this._container) {
          this._container.scrollTop = this._container.scrollHeight;
        }
      });
    }
  }

  private _onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      this._onSend();
    }
  };

  private _onSend = () => {
    const text = this._inputText.trim();
    // 属性 5：空白消息被拒绝
    if (!text || !this.session) {
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

  render() {
    if (!this.session) {
      return html`
        <div class="no-session">请选择或创建一个会话</div>
      `;
    }

    return html`
      <div class="chat-container">
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

      <div class="chat-input-wrapper">
        <div class="chat-input-area">
          <textarea
            rows="2"
            placeholder="输入消息，Shift+Enter 换行，Enter 发送…"
            .value=${this._inputText}
            @input=${(e: Event) => {
              this._inputText = (e.target as HTMLTextAreaElement).value;
            }}
            @keydown=${this._onKeyDown}
          ></textarea>
          <div class="input-toolbar">
            <span class="input-hint">Shift+Enter 换行</span>
            <button
              class="send-btn"
              ?disabled=${!this._inputText.trim()}
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
