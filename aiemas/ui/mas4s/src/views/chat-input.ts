import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { MasSession } from "../types/session-types.js";

@customElement("chat-input")
export class ChatInput extends LitElement {
  @property({ attribute: false }) session: MasSession | undefined = undefined;
  @property({ type: Boolean }) isChatting = false;

  @state() private _inputText = "";

  static styles = css`
    :host {
      display: block;
    }

    .chat-input-area {
      background: #f9fafc;
      border: 1px solid #e2e8f0;
      border-radius: 24px;
      padding: 12px 16px;
      transition: all 0.2s;
    }

    .chat-input-area:focus-within {
      border-color: #3b82f6;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      background: #ffffff;
    }

    textarea {
      width: 100%;
      border: none;
      outline: none;
      resize: none;
      font-size: 14px;
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
      margin-top: 8px;
    }

    .input-hint {
      font-size: 11px;
      color: #94a3b8;
    }

    .send-btn {
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #2563eb;
      color: white;
      border: none;
      border-radius: 50%;
      cursor: pointer;
      transition: all 0.2s;
      flex-shrink: 0;
    }

    .send-btn:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 6px 15px rgba(59, 130, 246, 0.4);
    }

    .send-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
      filter: grayscale(0.5);
    }

    .abort-btn {
      width: 38px;
      height: 38px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #fef2f2;
      color: #ef4444;
      border: 1px solid #fee2e2;
      border-radius: 12px;
      cursor: pointer;
      transition: all 0.2s;
      flex-shrink: 0;
    }

    .abort-btn:hover {
      background: #fee2e2;
      transform: translateY(-1px);
      box-shadow: 0 4px 10px rgba(239, 68, 68, 0.1);
    }
  `;

  private _onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      e.stopPropagation();
      this._inputText = (e.target as HTMLTextAreaElement).value;
      this._onSend();
    } else if (e.key === "Escape") {
      e.preventDefault();
      this._inputText = "";
      (e.target as HTMLTextAreaElement).value = "";
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

  private _onAbort = () => {
    this.dispatchEvent(
      new CustomEvent("abort-chat", {
        bubbles: true,
        composed: true,
      }),
    );
  };

  render() {
    return html`
      <div class="chat-input-area">
        <textarea
          rows="2"
          placeholder=${this._isArchived
            ? "会话已归档，无法发送消息"
            : "输入消息，Shift+Enter 换行，Enter 发送…"}
          .value=${this._inputText}
          ?disabled=${this._isArchived}
          @input=${(e: Event) => {
            this._inputText = (e.target as HTMLTextAreaElement).value;
          }}
          @keydown=${this._onKeyDown}
        ></textarea>
        <div class="input-toolbar">
          <span class="input-hint">Shift+Enter 换行</span>
          ${this.isChatting && !this._inputText.trim()
            ? html`
                <button class="abort-btn" @click=${this._onAbort} title="中止生成">
                  <svg
                    width="18"
                    height="18"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    stroke="currentColor"
                    stroke-width="2.5"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  >
                    <rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect>
                  </svg>
                </button>
              `
            : html`
                <button
                  class="send-btn"
                  ?disabled=${this._isArchived || !this._inputText.trim()}
                  @click=${this._onSend}
                  title="发送消息"
                >
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
                    <line x1="22" y1="2" x2="11" y2="13"></line>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                  </svg>
                </button>
              `}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "chat-input": ChatInput;
  }
}
