import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";

/**
 * 创建智能体对话框 — 提供智能体ID和工作区目录输入。
 * 触发 confirm({ agentId, workspace }) 或 cancel 事件。
 */
@customElement("agent-create-dialog")
export class AgentCreateDialog extends LitElement {
  @state() private _name = "";
  @state() private _agentId = "";
  @state() private _workspace = "";
  /** 用户是否手动修改过智能体ID */
  private _agentIdEdited = false;
  /** 用户是否手动修改过工作区目录 */
  private _workspaceEdited = false;

  static styles = css`
    :host {
      display: block;
    }

    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(4px);
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: fadeIn 0.2s ease-out;
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
      border-radius: 16px;
      padding: 28px;
      width: 440px;
      max-width: 90vw;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.15);
      animation: slideUp 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }

    @keyframes slideUp {
      from {
        transform: translateY(20px);
        opacity: 0;
      }
      to {
        transform: translateY(0);
        opacity: 1;
      }
    }

    h3 {
      margin: 0 0 20px;
      font-size: 18px;
      font-weight: 700;
      color: #1e293b;
    }

    .field {
      margin-bottom: 16px;
    }

    label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      color: #475569;
      margin-bottom: 6px;
    }

    input {
      width: 100%;
      box-sizing: border-box;
      padding: 10px 12px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      font-size: 14px;
      color: #1e293b;
      outline: none;
      transition: border-color 0.2s;
    }

    input:focus {
      border-color: #3b82f6;
    }

    input.invalid {
      border-color: #ef4444;
    }

    .hint {
      font-size: 12px;
      color: #94a3b8;
      margin-top: 4px;
    }

    .hint.error {
      color: #ef4444;
    }

    .actions {
      display: flex;
      gap: 12px;
      justify-content: flex-end;
      margin-top: 24px;
    }

    button {
      padding: 10px 20px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      border: 1px solid transparent;
    }

    .cancel-btn {
      background: #f1f5f9;
      color: #64748b;
      border-color: #e2e8f0;
    }

    .cancel-btn:hover {
      background: #e2e8f0;
      color: #1e293b;
    }

    .confirm-btn {
      background: linear-gradient(135deg, #3b82f6 0%, #6366f1 100%);
      color: white;
    }

    .confirm-btn:hover:not(:disabled) {
      opacity: 0.9;
    }

    .confirm-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }
  `;

  /** 只允许英文字母、数字、连字符、下划线 */
  private static readonly ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

  private get _agentIdValid() {
    return AgentCreateDialog.ID_PATTERN.test(this._agentId.trim());
  }

  private _onNameInput = (e: Event) => {
    const val = (e.target as HTMLInputElement).value;
    this._name = val;
    // 若用户未手动编辑智能体ID，则自动同步
    if (!this._agentIdEdited) {
      const suggestedId = val
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "");
      this._agentId = suggestedId;
      // 同步更新工作区目录
      if (!this._workspaceEdited) {
        this._workspace = suggestedId ? `~/.openclaw/workspace-${suggestedId}` : "";
      }
    }
  };

  private _onAgentIdInput = (e: Event) => {
    const raw = (e.target as HTMLInputElement).value;
    this._agentId = raw;
    this._agentIdEdited = true;
    // 若用户未手动编辑工作区目录，则自动同步默认值
    if (!this._workspaceEdited) {
      this._workspace = raw.trim() ? `~/.openclaw/workspace-${raw.trim()}` : "";
    }
  };

  private _onWorkspaceInput = (e: Event) => {
    this._workspace = (e.target as HTMLInputElement).value;
    this._workspaceEdited = true;
  };

  private _onConfirm = () => {
    if (!this._name.trim() || !this._agentIdValid || !this._workspace.trim()) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent("confirm", {
        detail: {
          name: this._name.trim(),
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
        <div class="dialog-card" role="dialog" aria-modal="true" aria-labelledby="create-title">
          <h3 id="create-title">创建智能体</h3>
          <div class="field">
            <label for="agent-name">智能体名称 <span aria-hidden="true">*</span></label>
            <input
              id="agent-name"
              type="text"
              placeholder="例如：我的助手、Research Assistant"
              .value=${this._name}
              @input=${this._onNameInput}
            />
          </div>
          <div class="field">
            <label for="agent-id">智能体ID <span aria-hidden="true">*</span></label>
            <input
              id="agent-id"
              type="text"
              class=${idInvalid ? "invalid" : ""}
              placeholder="仅支持英文字母、数字、- 和 _"
              .value=${this._agentId}
              @input=${this._onAgentIdInput}
            />
            ${idInvalid
              ? html`<p class="hint error">只能包含英文字母、数字、连字符（-）和下划线（_）</p>`
              : html`<p class="hint">用于配置文件名，建议与名称对应</p>`}
          </div>
          <div class="field">
            <label for="agent-workspace">工作区目录 <span aria-hidden="true">*</span></label>
            <input
              id="agent-workspace"
              type="text"
              placeholder="~/.openclaw/workspace-{agentId}"
              .value=${this._workspace}
              @input=${this._onWorkspaceInput}
            />
          </div>
          <div class="actions">
            <button class="cancel-btn" @click=${this._onCancel}>取消</button>
            <button class="confirm-btn" ?disabled=${disabled} @click=${this._onConfirm}>
              创建
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "agent-create-dialog": AgentCreateDialog;
  }
}
