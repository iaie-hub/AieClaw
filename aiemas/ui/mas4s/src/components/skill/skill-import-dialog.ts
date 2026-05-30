import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { AgentEntry } from "../../types/agents-types.js";

/**
 * 导入 Skill 对话框 — 提供压缩包选择与查重校验，并指定导入智能体或全局默认路径。
 * 触发 confirm({ file, slug, workspace }) 或 cancel 事件。
 */
@customElement("skill-import-dialog")
export class SkillImportDialog extends LitElement {
  @property({ attribute: false }) agents: AgentEntry[] = [];
  @property({ type: String }) managedSkillsDir = "";
  @property({ attribute: false }) existingSkills: string[] = [];

  @state() private _file: File | null = null;
  @state() private _slug = "";
  @state() private _selectedWorkspace = ""; // 空代表不指定

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
      width: 460px;
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

    input[type="text"],
    select {
      width: 100%;
      box-sizing: border-box;
      padding: 10px 12px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      font-size: 14px;
      color: #1e293b;
      outline: none;
      transition: border-color 0.2s;
      background: white;
    }

    input[type="text"]:focus,
    select:focus {
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

    /* 动态导入路径提示框样式 */
    .path-preview-card {
      margin-top: 16px;
      padding: 12px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
    }

    .path-preview-label {
      font-size: 12px;
      font-weight: 600;
      color: #64748b;
      margin-bottom: 4px;
    }

    .path-preview-value {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
      color: #334155;
      word-break: break-all;
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

  private static readonly SLUG_PATTERN = /^[a-zA-Z0-9_-]+$/;

  private get _slugValid() {
    return SkillImportDialog.SLUG_PATTERN.test(this._slug.trim());
  }

  private get _isDuplicate() {
    return this.existingSkills.includes(this._slug.trim());
  }

  private _onFileChange = (e: Event) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this._file = file;
    if (file) {
      const derived = file.name.replace(/\.tar\.gz$/i, "").replace(/\.(zip|tgz)$/i, "");
      this._slug = derived;
    }
  };

  private _onDropZoneClick = () => {
    this.shadowRoot?.querySelector<HTMLInputElement>("#file-input")?.click();
  };

  private _onSlugInput = (e: Event) => {
    this._slug = (e.target as HTMLInputElement).value;
  };

  private _onAgentSelect = (e: Event) => {
    this._selectedWorkspace = (e.target as HTMLSelectElement).value;
  };

  private _onConfirm = () => {
    if (!this._file || !this._slugValid || this._isDuplicate) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent("confirm", {
        detail: {
          file: this._file,
          slug: this._slug.trim(),
          workspace: this._selectedWorkspace || undefined,
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
    const slugTouched = this._slug.length > 0;
    const slugFormatInvalid = slugTouched && !this._slugValid;
    const disabled = !this._file || !this._slugValid || this._isDuplicate;

    // 计算动态即将导入至的物理绝对路径
    let targetPathHint = "";
    if (this._file && this._slug.trim()) {
      const slugName = this._slug.trim();
      if (this._selectedWorkspace) {
        targetPathHint = `${this._selectedWorkspace}/skills/${slugName}`;
      } else {
        const cleanBase = this.managedSkillsDir.replace(/\/+$/, "");
        targetPathHint = `${cleanBase}/${slugName}`;
      }
    }

    return html`
      <div class="overlay" @click=${this._onOverlayClick}>
        <div class="dialog-card" role="dialog" aria-modal="true" aria-labelledby="import-title">
          <h3 id="import-title">导入 Skill</h3>
          <p class="subtitle">选择已导出的 Skill 压缩包（.zip、.tar.gz）进行本地导入</p>

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
            <div class="drop-text">${this._file ? "已选择技能包" : "点击选择压缩包文件"}</div>
            ${this._file ? html`<div class="file-name">${this._file.name}</div>` : ""}
          </div>

          <input
            id="file-input"
            type="file"
            accept=".zip,.tar.gz,.tgz"
            @change=${this._onFileChange}
          />

          <div class="field">
            <label for="import-skill-slug">技能标识 / Slug <span aria-hidden="true">*</span></label>
            <input
              id="import-skill-slug"
              type="text"
              class=${slugFormatInvalid || this._isDuplicate ? "invalid" : ""}
              placeholder="仅支持英文字母、数字、- 和 _"
              .value=${this._slug}
              @input=${this._onSlugInput}
            />
            ${slugFormatInvalid
              ? html`<p class="hint error">只能包含英文字母、数字、连字符（-）和下划线（_）</p>`
              : this._isDuplicate
                ? html`<p class="hint error">⚠️ 该技能名称已存在，请使用其他名称以确保唯一性</p>`
                : html`<p class="hint">从文件名自动解析，可手动修改。用于决定存放目录名</p>`}
          </div>

          <div class="field">
            <label for="import-skill-agent">目标智能体（可选项）</label>
            <select id="import-skill-agent" @change=${this._onAgentSelect}>
              <option value="">不指定（导入至默认路径）</option>
              ${this.agents.map(
                (agent) => html`
                  <option value=${agent.workspace}>${agent.name || agent.id} (${agent.id})</option>
                `,
              )}
            </select>
            <p class="hint">如果不指定，则会导入至 openclaw.json 的默认共享技能目录</p>
          </div>

          ${targetPathHint
            ? html`
                <div class="path-preview-card">
                  <div class="path-preview-label">即将导入至目录：</div>
                  <div class="path-preview-value">${targetPathHint}</div>
                </div>
              `
            : ""}

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
    "skill-import-dialog": SkillImportDialog;
  }
}
