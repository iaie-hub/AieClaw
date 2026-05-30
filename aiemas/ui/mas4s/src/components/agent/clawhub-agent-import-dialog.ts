import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";

/**
 * ClawHub 智能体导入对话框 — 提示用户输入导入至本地时的智能体 ID 和工作区路径。
 * 针对远程 AgentHub 设计，免除了本地文件上传选区，提供更纯粹的配置体验。
 * 触发 confirm({ agentId, workspace }) 或 cancel 事件。
 */
@customElement("clawhub-agent-import-dialog")
export class ClawHubAgentImportDialog extends LitElement {
  @property({ type: String }) hubAgentId = "";
  @property({ type: String }) hubAgentName = "";

  @state() private _agentId = "";
  @state() private _workspace = "";
  /** 用户是否手动修改过工作区目录 */
  private _workspaceEdited = false;

  static styles = css`
    :host {
      display: block;
    }

    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.3);
      backdrop-filter: blur(8px);
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: fadeIn 0.25s cubic-bezier(0.4, 0, 0.2, 1);
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }

    .dialog-card {
      background: white;
      border: 1px solid #f1f5f9;
      border-radius: 20px;
      padding: 32px;
      width: 460px;
      max-width: 90vw;
      box-shadow: 
        0 20px 25px -5px rgba(0, 0, 0, 0.1),
        0 10px 10px -5px rgba(0, 0, 0, 0.04),
        0 0 0 1px rgba(0, 0, 0, 0.02);
      animation: slideUp 0.3s cubic-bezier(0.34, 1.56, 0.64, 1);
      box-sizing: border-box;
    }

    @keyframes slideUp {
      from {
        transform: translateY(24px) scale(0.96);
        opacity: 0;
      }
      to {
        transform: translateY(0) scale(1);
        opacity: 1;
      }
    }

    h3 {
      margin: 0 0 8px;
      font-size: 20px;
      font-weight: 700;
      color: #0f172a;
    }

    .subtitle {
      font-size: 14px;
      color: #64748b;
      margin: 0 0 24px;
      line-height: 1.5;
    }

    /* Source Info Panel */
    .source-panel {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 14px 18px;
      margin-bottom: 24px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .source-label {
      font-size: 12px;
      font-weight: 600;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .source-value {
      font-size: 15px;
      font-weight: 600;
      color: #334155;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .source-id {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 13px;
      color: #64748b;
      background: #cbd5e1;
      background-opacity: 0.3;
      padding: 2px 6px;
      border-radius: 4px;
    }

    .field {
      margin-top: 18px;
    }

    label {
      display: block;
      font-size: 14px;
      font-weight: 600;
      color: #475569;
      margin-bottom: 8px;
    }

    input[type="text"] {
      width: 100%;
      box-sizing: border-box;
      padding: 11px 14px;
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      font-size: 14px;
      color: #0f172a;
      outline: none;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      background: #f8fafc;
    }

    input[type="text"]:focus {
      background: white;
      border-color: #3b82f6;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
    }

    input[type="text"].invalid {
      border-color: #ef4444;
      background: #fef2f2;
    }

    input[type="text"].invalid:focus {
      box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.12);
    }

    .hint {
      font-size: 12.5px;
      color: #94a3b8;
      margin-top: 6px;
      line-height: 1.4;
    }

    .hint.error {
      color: #ef4444;
      font-weight: 500;
    }

    .actions {
      display: flex;
      gap: 12px;
      justify-content: flex-end;
      margin-top: 32px;
    }

    button {
      padding: 10px 22px;
      border-radius: 10px;
      font-size: 14.5px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      border: 1px solid transparent;
    }

    .cancel-btn {
      background: white;
      color: #64748b;
      border-color: #e2e8f0;
    }

    .cancel-btn:hover {
      background: #f1f5f9;
      color: #1e293b;
      border-color: #cbd5e1;
    }

    .confirm-btn {
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      color: white;
      box-shadow: 0 4px 12px rgba(16, 185, 129, 0.15);
    }

    .confirm-btn:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 6px 16px rgba(16, 185, 129, 0.25);
      filter: brightness(1.05);
    }

    .confirm-btn:active:not(:disabled) {
      transform: translateY(0);
      box-shadow: 0 2px 4px rgba(16, 185, 129, 0.1);
    }

    .confirm-btn:disabled {
      opacity: 0.45;
      cursor: not-allowed;
      transform: none;
      box-shadow: none;
    }
  `;

  /** 只允许英文字母、数字、连字符、下划线 */
  private static readonly ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

  private get _agentIdValid() {
    return ClawHubAgentImportDialog.ID_PATTERN.test(this._agentId.trim());
  }

  willUpdate(changedProperties: Map<string, unknown>) {
    if (changedProperties.has("hubAgentId") && this.hubAgentId) {
      if (!this._agentId) {
        this._agentId = this.hubAgentId;
      }
      if (!this._workspace && !this._workspaceEdited) {
        this._workspace = `~/.openclaw/workspace-${this.hubAgentId}`;
      }
    }
  }

  private _onAgentIdInput = (e: Event) => {
    const raw = (e.target as HTMLInputElement).value;
    this._agentId = raw;
    if (!this._workspaceEdited) {
      this._workspace = raw.trim() ? `~/.openclaw/workspace-${raw.trim()}` : "";
    }
  };

  private _onWorkspaceInput = (e: Event) => {
    this._workspace = (e.target as HTMLInputElement).value;
    this._workspaceEdited = true;
  };

  private _onConfirm = () => {
    if (!this._agentIdValid || !this._workspace.trim()) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent("confirm", {
        detail: {
          agentId: this._agentId.trim(),
          workspace: this._workspace.trim(),
        },
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

  render() {
    const idTouched = this._agentId.length > 0;
    const idInvalid = idTouched && !this._agentIdValid;
    const disabled = !this._agentIdValid || !this._workspace.trim();

    return html`
      <div class="overlay" @click=${this._onOverlayClick}>
        <div class="dialog-card" role="dialog" aria-modal="true" aria-labelledby="import-title">
          <h3 id="import-title">导入智能体到本地</h3>
          <p class="subtitle">将远程 AgentHub 共享的智能体解压并配置到本地工作区。</p>

          <div class="source-panel">
            <span class="source-label">来源智能体</span>
            <div class="source-value">
              <span>${this.hubAgentName}</span>
              <span class="source-id">ID: ${this.hubAgentId}</span>
            </div>
          </div>

          <div class="field">
            <label for="import-agent-id">本地智能体 ID <span aria-hidden="true" style="color: #ef4444;">*</span></label>
            <input
              id="import-agent-id"
              type="text"
              class=${idInvalid ? "invalid" : ""}
              placeholder="例如: my-agent-01"
              .value=${this._agentId}
              @input=${this._onAgentIdInput}
            />
            ${idInvalid
              ? html`<p class="hint error">只能包含英文字母、数字、连字符（-）和下划线（_）</p>`
              : html`<p class="hint">为本地创建的智能体命名唯一 ID</p>`}
          </div>

          <div class="field">
            <label for="import-workspace">本地工作区目录 <span aria-hidden="true" style="color: #ef4444;">*</span></label>
            <input
              id="import-workspace"
              type="text"
              placeholder="~/.openclaw/workspace-{agentId}"
              .value=${this._workspace}
              @input=${this._onWorkspaceInput}
            />
            <p class="hint">智能体文件的本地存放路径，将自动创建</p>
          </div>

          <div class="actions">
            <button class="cancel-btn" @click=${this._onCancel}>取消</button>
            <button class="confirm-btn" ?disabled=${disabled} @click=${this._onConfirm}>
              立即导入
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "clawhub-agent-import-dialog": ClawHubAgentImportDialog;
  }
}
