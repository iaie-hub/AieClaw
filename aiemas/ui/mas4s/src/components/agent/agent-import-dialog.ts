import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";

/**
 * 导入智能体对话框 — 提供压缩包文件选择器，并允许确认/修改智能体ID和工作区目录。
 * 选择压缩包后自动从文件名解析智能体ID并生成默认工作区目录。
 * 触发 confirm({ file, agentId, workspace }) 或 cancel 事件。
 */
@customElement("agent-import-dialog")
export class AgentImportDialog extends LitElement {
  @state() private _file: File | null = null;
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
      margin: 0 0 8px;
      font-size: 18px;
      font-weight: 700;
      color: #1e293b;
    }

    .subtitle {
      font-size: 13px;
      color: #64748b;
      margin: 0 0 20px;
    }

    .drop-zone {
      border: 2px dashed #e2e8f0;
      border-radius: 10px;
      padding: 32px 20px;
      text-align: center;
      cursor: pointer;
      transition:
        border-color 0.2s,
        background 0.2s;
    }

    .drop-zone:hover {
      border-color: #3b82f6;
      background: #eff6ff;
    }

    .drop-zone.has-file {
      border-color: #22c55e;
      background: #f0fdf4;
    }

    .drop-icon {
      font-size: 32px;
      margin-bottom: 8px;
    }

    .drop-text {
      font-size: 14px;
      color: #475569;
    }

    .file-name {
      font-size: 13px;
      font-weight: 600;
      color: #16a34a;
      margin-top: 6px;
      word-break: break-all;
    }

    input[type="file"] {
      display: none;
    }

    .field {
      margin-top: 16px;
    }

    label {
      display: block;
      font-size: 13px;
      font-weight: 600;
      color: #475569;
      margin-bottom: 6px;
    }

    input[type="text"] {
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

    input[type="text"]:focus {
      border-color: #3b82f6;
    }

    input[type="text"].invalid {
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
    return AgentImportDialog.ID_PATTERN.test(this._agentId.trim());
  }

  private _onFileChange = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this._file = file;
    if (file) {
      // 从文件名中解析 agentId（去掉 .zip / .tar.gz / .tgz 后缀）
      const derived = file.name.replace(/\.tar\.gz$/i, "").replace(/\.(zip|tgz)$/i, "");
      this._agentId = derived;
      // 若用户未手动编辑工作区目录，则自动同步默认值
      if (!this._workspaceEdited) {
        this._workspace = `~/.openclaw/workspace-${derived}`;
      }
    }
  };

  private _onDropZoneClick = () => {
    this.shadowRoot?.querySelector<HTMLInputElement>("#file-input")?.click();
  };

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
    if (!this._file || !this._agentIdValid || !this._workspace.trim()) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent("confirm", {
        detail: {
          file: this._file,
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
    const disabled = !this._file || !this._agentIdValid || !this._workspace.trim();

    return html`
      <div class="overlay" @click=${this._onOverlayClick}>
        <div class="dialog-card" role="dialog" aria-modal="true" aria-labelledby="import-title">
          <h3 id="import-title">导入智能体</h3>
          <p class="subtitle">选择已导出的智能体压缩包（.zip、.tar.gz）</p>
          <div
            class="drop-zone ${this._file ? "has-file" : ""}"
            role="button"
            tabindex="0"
            aria-label="选择压缩包文件"
            @click=${this._onDropZoneClick}
            @keydown=${(e: KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                this._onDropZoneClick();
              }
            }}
          >
            <div class="drop-icon">${this._file ? "✅" : "📦"}</div>
            <div class="drop-text">${this._file ? "已选择文件" : "点击选择压缩包文件"}</div>
            ${this._file ? html`<div class="file-name">${this._file.name}</div>` : ""}
          </div>
          <input
            id="file-input"
            type="file"
            accept=".zip,.tar.gz,.tgz"
            @change=${this._onFileChange}
          />

          <div class="field">
            <label for="import-agent-id">智能体ID <span aria-hidden="true">*</span></label>
            <input
              id="import-agent-id"
              type="text"
              class=${idInvalid ? "invalid" : ""}
              placeholder="仅支持英文字母、数字、- 和 _"
              .value=${this._agentId}
              @input=${this._onAgentIdInput}
            />
            ${idInvalid
              ? html`<p class="hint error">只能包含英文字母、数字、连字符（-）和下划线（_）</p>`
              : html`<p class="hint">从文件名自动解析，可手动修改</p>`}
          </div>

          <div class="field">
            <label for="import-workspace">工作区目录 <span aria-hidden="true">*</span></label>
            <input
              id="import-workspace"
              type="text"
              placeholder="~/.openclaw/workspace-{agentId}"
              .value=${this._workspace}
              @input=${this._onWorkspaceInput}
            />
          </div>

          <div class="actions">
            <button class="cancel-btn" @click=${this._onCancel}>取消</button>
            <button class="confirm-btn" ?disabled=${disabled} @click=${this._onConfirm}>
              导入
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "agent-import-dialog": AgentImportDialog;
  }
}
