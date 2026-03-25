import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { parseInviteInput } from "../gateway/session-invite.js";

/**
 * 手动输入 sessionKey 或分享链接加入会话的弹窗。
 * 解析成功后触发 @join 事件，携带 sessionKey。
 */
@customElement("join-session-dialog")
export class JoinSessionDialog extends LitElement {
  @state() private _input = "";
  @state() private _error = "";
  @state() private _loading = false;

  static styles = css`
    :host {
      display: block;
    }

    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.3);
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .dialog-card {
      background: white;
      border-radius: 16px;
      padding: 28px;
      width: 480px;
      max-width: 90vw;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
    }

    h3 {
      margin: 0 0 8px;
      font-size: 18px;
      font-weight: 700;
      color: #1e293b;
    }

    .subtitle {
      margin: 0 0 20px;
      font-size: 13px;
      color: #64748b;
    }

    .input-field {
      width: 100%;
      box-sizing: border-box;
      padding: 10px 14px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      font-size: 14px;
      color: #334155;
      outline: none;
      transition: border-color 0.2s;
      margin-bottom: 8px;
    }

    .input-field:focus {
      border-color: #3b82f6;
    }

    .input-field.error {
      border-color: #ef4444;
    }

    .error-msg {
      font-size: 12px;
      color: #ef4444;
      margin: 0 0 16px;
      min-height: 18px;
    }

    .actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }

    .cancel-btn {
      padding: 10px 20px;
      background: #f1f5f9;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      color: #64748b;
      cursor: pointer;
      transition: background 0.2s;
    }

    .cancel-btn:hover {
      background: #e2e8f0;
    }

    .join-btn {
      padding: 10px 20px;
      background: linear-gradient(135deg, #3b82f6 0%, #6366f1 100%);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: opacity 0.2s;
    }

    .join-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  `;

  private _onInput = (e: Event) => {
    this._input = (e.target as HTMLInputElement).value.trim();
    this._error = "";
  };

  private _onJoin = () => {
    const key = parseInviteInput(this._input);
    if (!key) {
      this._error = "请输入有效的会话 ID 或分享链接";
      return;
    }
    this._loading = true;
    this.dispatchEvent(
      new CustomEvent<{ sessionKey: string }>("join", {
        detail: { sessionKey: key },
        bubbles: true,
        composed: true,
      }),
    );
  };

  private _onClose = () => {
    this.dispatchEvent(new CustomEvent("close", { bubbles: true, composed: true }));
  };

  private _onOverlayClick = (e: Event) => {
    if (e.target === e.currentTarget) {
      this._onClose();
    }
  };

  private _onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.isComposing) {
      this._onJoin();
    }
    if (e.key === "Escape") {
      this._onClose();
    }
  };

  render() {
    return html`
      <div class="overlay" @click=${this._onOverlayClick}>
        <div class="dialog-card">
          <h3>加入会话</h3>
          <p class="subtitle">输入会话 ID 或粘贴分享链接</p>
          <input
            class="input-field ${this._error ? "error" : ""}"
            placeholder="会话 ID 或 https://... 链接"
            .value=${this._input}
            @input=${this._onInput}
            @keydown=${this._onKeyDown}
            autofocus
          />
          <p class="error-msg">${this._error}</p>
          <div class="actions">
            <button class="cancel-btn" @click=${this._onClose}>取消</button>
            <button
              class="join-btn"
              ?disabled=${this._loading || !this._input}
              @click=${this._onJoin}
            >
              ${this._loading ? "加入中…" : "加入会话"}
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "join-session-dialog": JoinSessionDialog;
  }
}
