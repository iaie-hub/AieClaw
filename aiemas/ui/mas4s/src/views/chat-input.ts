import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state, query } from "lit/decorators.js";
import type { ChatAttachment } from "../lib/chat-types.js";
import type { MasSession } from "../types/session-types.js";

@customElement("chat-input")
export class ChatInput extends LitElement {
  @property({ attribute: false }) session: MasSession | undefined = undefined;
  @property({ type: Boolean }) isChatting = false;

  @state() private _inputText = "";
  @state() private _attachments: ChatAttachment[] = [];

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

    /* 附件预览区域 */
    .attachment-preview-area {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-bottom: 8px;
    }

    .attachment-card {
      position: relative;
      width: 60px;
      height: 60px;
      border-radius: 8px;
      border: 1px solid #e2e8f0;
      overflow: hidden;
      background: #fff;
    }

    .attachment-card img {
      width: 100%;
      height: 100%;
      object-fit: cover;
      cursor: pointer;
      transition: opacity 0.2s;
    }

    .attachment-card img:hover {
      opacity: 0.8;
    }

    .remove-attachment {
      position: absolute;
      top: -4px;
      right: -4px;
      width: 18px;
      height: 18px;
      background: #ef4444;
      color: white;
      border: none;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      font-size: 12px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);
    }

    .attach-btn {
      width: 30px;
      height: 30px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #64748b;
      background: none;
      border: none;
      border-radius: 8px;
      cursor: pointer;
      transition: all 0.2s;
    }

    .attach-btn:hover {
      background: #f1f5f9;
      color: #1e293b;
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
    }
  };

  private _onPaste = (e: ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) {
      return;
    }

    const imageFiles: File[] = [];
    for (const item of items) {
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) {
          imageFiles.push(file);
        }
      }
    }

    if (imageFiles.length > 0) {
      e.preventDefault();
      for (const file of imageFiles) {
        void this._addFile(file);
      }
    }
  };

  private _onDrop = async (e: DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer?.files;
    if (!files) {
      return;
    }

    for (const file of Array.from(files)) {
      if (file.type.startsWith("image/")) {
        await this._addFile(file);
      }
    }
  };

  private _onDragOver = (e: DragEvent) => {
    e.preventDefault();
  };

  private _onFileSelect = async (e: Event) => {
    const input = e.target as HTMLInputElement;
    const files = input.files;
    if (!files) {
      return;
    }

    for (const file of Array.from(files)) {
      if (file.type.startsWith("image/")) {
        await this._addFile(file);
      }
    }
    input.value = ""; // Reset for re-selecting the same file
  };

  private async _addFile(file: File) {
    const id = Math.random().toString(36).substring(2, 9);
    const dataUrl = await new Promise<string>((resolve) => {
      const reader = new FileReader();
      reader.addEventListener("load", (e) => resolve(e.target?.result as string));
      reader.readAsDataURL(file);
    });

    this._attachments = [
      ...this._attachments,
      {
        id,
        type: file.type,
        name: file.name,
        dataUrl,
        file,
      },
    ];
  }

  private _removeAttachment(id: string) {
    this._attachments = this._attachments.filter((a) => a.id !== id);
  }

  private get _isArchived(): boolean {
    return this.session?.archivedAt != null;
  }

  private _onSend = () => {
    const text = this._inputText.trim();
    if ((!text && this._attachments.length === 0) || !this.session || this._isArchived) {
      return;
    }

    // 清空本地状态
    this._inputText = "";
    const attachments = [...this._attachments];
    this._attachments = [];

    // 同步清空底层 DOM 的 value，防止在此次 render 到 updateComplete 期间，
    // 快速二次按键再次把 input/textarea 中未被清理的值读回并触发重复发送 (如 Enter 按住不放)
    if (this._textarea) {
      this._textarea.value = "";
    }

    this.dispatchEvent(
      new CustomEvent("send-message", {
        detail: { sessionKey: this.session.key, text, attachments },
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
      ${this._attachments.length > 0
        ? html`
            <div class="attachment-preview-area">
              ${this._attachments.map(
                (a) => html`
                  <div class="attachment-card">
                    <img
                      src=${a.dataUrl ?? ""}
                      alt=${a.name}
                      @click=${() =>
                        this.dispatchEvent(
                          new CustomEvent("preview-image", {
                            detail: { url: a.dataUrl },
                            bubbles: true,
                            composed: true,
                          }),
                        )}
                    />
                    <button class="remove-attachment" @click=${() => this._removeAttachment(a.id)}>
                      ×
                    </button>
                  </div>
                `,
              )}
            </div>
          `
        : nothing}
      <div
        class="chat-input-area"
        @paste=${this._onPaste}
        @drop=${this._onDrop}
        @dragover=${this._onDragOver}
      >
        <button
          class="attach-btn"
          title="添加图片"
          ?disabled=${this._isArchived}
          @click=${() => this.shadowRoot?.querySelector<HTMLInputElement>("#file-input")?.click()}
        >
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
            <path
              d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"
            ></path>
          </svg>
        </button>
        <input
          id="file-input"
          type="file"
          accept="image/*"
          multiple
          style="display: none;"
          @change=${this._onFileSelect}
        />
        <textarea
          rows="1"
          style="height: ${ChatInput.LINE_HEIGHT}px;"
          placeholder=${this._isArchived ? "会话已归档" : "输入消息，Shift+Enter 换行，Enter 发送…"}
          .value=${this._inputText}
          ?disabled=${this._isArchived}
          @input=${this._onInput}
          @keydown=${this._onKeyDown}
        ></textarea>
        ${this.isChatting && !this._inputText.trim() && this._attachments.length === 0
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
                ?disabled=${this._isArchived ||
                this.isChatting ||
                (!this._inputText.trim() && this._attachments.length === 0)}
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
