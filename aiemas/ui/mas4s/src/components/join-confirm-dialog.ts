import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { MasSession } from "../types/session-types.js";
import { resolveStatusType } from "../types/session-types.js";

/**
 * URL 参数自动触发的加入确认弹窗。
 * 显示会话 label/status，用户确认后触发 @confirm，取消触发 @cancel。
 */
@customElement("join-confirm-dialog")
export class JoinConfirmDialog extends LitElement {
  /** 已解析的会话信息（可选，加载中时为 null） */
  @property({ attribute: false }) session: MasSession | null = null;
  /** 正在加载会话信息 */
  @property({ type: Boolean }) loading = false;
  /** 加载或加入失败的错误信息 */
  @property() error = "";
  /** 原始 sessionKey（加载前展示用） */
  @property() sessionKey = "";

  @state() private _joining = false;

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
      width: 440px;
      max-width: 90vw;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
    }

    h3 {
      margin: 0 0 16px;
      font-size: 18px;
      font-weight: 700;
      color: #1e293b;
    }

    .session-info {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      padding: 16px;
      margin-bottom: 20px;
    }

    .session-label {
      font-size: 15px;
      font-weight: 600;
      color: #1e293b;
      margin: 0 0 8px;
    }

    .session-key {
      font-size: 12px;
      color: #94a3b8;
      font-family: "Fira Code", monospace;
      word-break: break-all;
      margin: 0 0 8px;
    }

    .status-tag {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 500;
    }

    .status-tag.info {
      background: #dbeafe;
      color: #1d4ed8;
    }
    .status-tag.success {
      background: #dcfce7;
      color: #15803d;
    }
    .status-tag.warning {
      background: #fef9c3;
      color: #a16207;
    }
    .status-tag.danger {
      background: #fee2e2;
      color: #b91c1c;
    }

    .loading-hint {
      color: #64748b;
      font-size: 14px;
      text-align: center;
      padding: 12px 0;
    }

    .error-msg {
      color: #ef4444;
      font-size: 13px;
      margin: 0 0 16px;
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

    .confirm-btn {
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

    .confirm-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  `;

  private _onConfirm = () => {
    this._joining = true;
    this.dispatchEvent(
      new CustomEvent<{ sessionKey: string }>("confirm", {
        detail: { sessionKey: this.session?.key ?? this.sessionKey },
        bubbles: true,
        composed: true,
      }),
    );
  };

  private _onCancel = () => {
    this.dispatchEvent(new CustomEvent("cancel", { bubbles: true, composed: true }));
  };

  private _onOverlayClick = (e: Event) => {
    if (e.target === e.currentTarget) {
      this._onCancel();
    }
  };

  private _renderSessionInfo() {
    if (this.loading) {
      return html`
        <p class="loading-hint">正在获取会话信息…</p>
      `;
    }
    if (this.error) {
      return html`<p class="error-msg">${this.error}</p>`;
    }
    if (!this.session) {
      return html`<p class="loading-hint">会话 ID：<code>${this.sessionKey}</code></p>`;
    }
    const statusType = resolveStatusType(this.session.status);
    const statusLabel: Record<string, string> = {
      running: "进行中",
      done: "已完成",
      failed: "已失败",
      killed: "已终止",
      timeout: "已超时",
    };
    return html`
      <div class="session-info">
        <p class="session-label">${this.session.label ?? "未命名会话"}</p>
        <p class="session-key">${this.session.key}</p>
        <span class="status-tag ${statusType}">
          ${statusLabel[this.session.status ?? ""] ?? "进行中"}
        </span>
      </div>
    `;
  }

  render() {
    const canConfirm = !this.loading && !this.error && !this._joining;
    return html`
      <div class="overlay" @click=${this._onOverlayClick}>
        <div class="dialog-card">
          <h3>加入协作会话</h3>
          ${this._renderSessionInfo()}
          <div class="actions">
            <button class="cancel-btn" @click=${this._onCancel}>取消</button>
            <button
              class="confirm-btn"
              ?disabled=${!canConfirm}
              @click=${this._onConfirm}
            >
              ${this._joining ? "加入中…" : "确认加入"}
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "join-confirm-dialog": JoinConfirmDialog;
  }
}
