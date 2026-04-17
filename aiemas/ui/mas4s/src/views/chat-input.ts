import { LitElement, html, css } from "lit";
import { customElement, property, state, query } from "lit/decorators.js";
import type { MasSession } from "../types/session-types.js";

@customElement("chat-input")
export class ChatInput extends LitElement {
  @property({ attribute: false }) session: MasSession | undefined = undefined;
  @property({ type: Boolean }) isChatting = false;

  @state() private _inputText = "";

  @query("textarea")
  private _textarea!: HTMLTextAreaElement;

  // 14px * 1.5 line-height = 21px per line
  private static readonly LINE_HEIGHT = 21;
  private static readonly MAX_ROWS = 6;

  static styles = css`
    :host {
      display: block;
    }

    .chat-input-area {
      background: #f9fafc;
      border: 1px solid #e2e8f0;
      border-radius: 16px;
      padding: 8px 8px 8px 14px;
      transition:
        border-color 0.2s,
        box-shadow 0.2s,
        background 0.2s;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .chat-input-area:focus-within {
      border-color: #3b82f6;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
      background: #ffffff;
    }

    textarea {
      flex: 1;
      border: none;
      outline: none;
      resize: none;
      font-size: 14px;
      font-family: inherit;
      color: #1e293b;
      background: transparent;
      line-height: 1.5;
      box-sizing: border-box;
      display: block;
      overflow-y: hidden;
      padding: 0;
    }

    textarea::placeholder {
      color: #94a3b8;
    }

    .input-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 6px;
    }

    .input-hint {
      font-size: 11px;
      color: #94a3b8;
    }

    .send-btn {
      width: 30px;
      height: 30px;
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
      align-self: flex-end;
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
      width: 30px;
      height: 30px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #fef2f2;
      color: #ef4444;
      border: 1px solid #fee2e2;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s;
      flex-shrink: 0;
      align-self: flex-end;
    }

    .abort-btn:hover {
      background: #fee2e2;
      transform: translateY(-1px);
      box-shadow: 0 4px 10px rgba(239, 68, 68, 0.1);
    }
  `;

  private _autoResize() {
    const ta = this._textarea;
    if (!ta) {
      return;
    }
    ta.style.height = `${ChatInput.LINE_HEIGHT}px`;
    const maxH = ChatInput.LINE_HEIGHT * ChatInput.MAX_ROWS;
    const scrollH = ta.scrollHeight;
    const newH = Math.min(scrollH, maxH);
    ta.style.height = `${newH}px`;
    ta.style.overflowY = scrollH > maxH ? "auto" : "hidden";
  }

  private _onInput = (e: Event) => {
    this._inputText = (e.target as HTMLTextAreaElement).value;
    this._autoResize();
  };

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
      this._autoResize();
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

    // 清空本地状态
    this._inputText = "";

    // 同步清空底层 DOM 的 value，防止在此次 render 到 updateComplete 期间，
    // 快速二次按键再次把 input/textarea 中未被清理的值读回并触发重复发送 (如 Enter 按住不放)
    if (this._textarea) {
      this._textarea.value = "";
    }

    this.dispatchEvent(
      new CustomEvent("send-message", {
        detail: { sessionKey: this.session.key, text },
        bubbles: true,
        composed: true,
      }),
    );

    void this.updateComplete.then(() => {
      if (this._textarea) {
        this._autoResize();
      }
    });
  };

  private _onAbort = () => {
    this.dispatchEvent(new CustomEvent("abort-chat", { bubbles: true, composed: true }));
  };

  override updated() {
    if (this._textarea && !this._textarea.style.height) {
      this._autoResize();
    }
  }

  render() {
    return html`
      <div class="chat-input-area">
        <textarea
          rows="1"
          style="height: ${ChatInput.LINE_HEIGHT}px;"
          placeholder=${this._isArchived ? "会话已归档" : "输入消息，Shift+Enter 换行，Enter 发送…"}
          .value=${this._inputText}
          ?disabled=${this._isArchived}
          @input=${this._onInput}
          @keydown=${this._onKeyDown}
        ></textarea>
        ${this.isChatting && !this._inputText.trim()
          ? html`
              <button class="abort-btn" @click=${this._onAbort} title="中止生成">
                <svg
                  width="14"
                  height="14"
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
                  width="14"
                  height="14"
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
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "chat-input": ChatInput;
  }
}
