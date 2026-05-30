import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { AgentEntry } from "../../types/agents-types.js";

/**
 * ClawHub 技能导入对话框 — 提示用户输入导入至本地时的唯一 Slug 和选择目标智能体工作区（或默认路径）。
 * 触发 confirm({ slug, workspace }) 或 cancel 事件。
 */
@customElement("clawhub-skill-import-dialog")
export class ClawHubSkillImportDialog extends LitElement {
  @property({ type: String }) hubSkillId = "";
  @property({ type: String }) hubSkillName = "";
  @property({ type: Array }) agents: AgentEntry[] = [];

  @state() private _slug = "";
  @state() private _workspace = "";

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
      width: 480px;
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
      background: #e2e8f0;
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

    input[type="text"],
    select {
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

    input[type="text"]:focus,
    select:focus {
      background: white;
      border-color: #3b82f6;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.12);
    }

    input[type="text"].invalid {
      border-color: #ef4444;
      background: #fef2f2;
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

    .path-preview-card {
      background: #eff6ff;
      border: 1px solid #bfdbfe;
      border-radius: 10px;
      padding: 12px 14px;
      margin-top: 18px;
      box-sizing: border-box;
    }

    .path-preview-title {
      font-size: 12px;
      font-weight: 600;
      color: #1d4ed8;
      margin-bottom: 4px;
      display: block;
    }

    .path-preview-value {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 12px;
      color: #1e40af;
      word-break: break-all;
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

    .confirm-btn:disabled {
      opacity: 0.45;
      cursor: not-allowed;
    }
  `;

  private static readonly SLUG_PATTERN = /^[a-zA-Z0-9_-]+$/;

  private get _slugValid() {
    return ClawHubSkillImportDialog.SLUG_PATTERN.test(this._slug.trim());
  }

  willUpdate(changedProperties: Map<string, unknown>) {
    if (changedProperties.has("hubSkillId") && this.hubSkillId && !this._slug) {
      this._slug = this.hubSkillId;
    }
  }

  private _onSlugInput = (e: Event) => {
    this._slug = (e.target as HTMLInputElement).value;
  };

  private _onAgentChange = (e: Event) => {
    this._workspace = (e.target as HTMLSelectElement).value;
  };

  private _onConfirm = () => {
    if (!this._slugValid || !this._slug.trim()) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent("confirm", {
        detail: {
          slug: this._slug.trim(),
          workspace: this._workspace || undefined,
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
    const slugInvalid = slugTouched && !this._slugValid;
    const disabled = !this._slugValid || !this._slug.trim();

    // Compute preview destination path
    const slugPart = this._slug.trim() || "{slug}";
    let finalPath = "";
    if (this._workspace) {
      finalPath = `${this._workspace}/skills/${slugPart}`;
    } else {
      finalPath = `~/.openclaw/skills/${slugPart}`;
    }

    return html`
      <div class="overlay" @click=${this._onOverlayClick}>
        <div class="dialog-card" role="dialog" aria-modal="true" aria-labelledby="import-title">
          <h3 id="import-title">导入技能到工作区</h3>
          <p class="subtitle">将远程 SkillHub 共享的技能包解压并配置到本地智能体工作区或全局共享目录。</p>

          <div class="source-panel">
            <span class="source-label">来源技能</span>
            <div class="source-value">
              <span>${this.hubSkillName}</span>
              <span class="source-id">ID: ${this.hubSkillId}</span>
            </div>
          </div>

          <div class="field">
            <label for="import-slug"
              >本地唯一 Slug <span aria-hidden="true" style="color: #ef4444;">*</span></label
            >
            <input
              id="import-slug"
              type="text"
              class=${slugInvalid ? "invalid" : ""}
              placeholder="例如: translation-skill"
              .value=${this._slug}
              @input=${this._onSlugInput}
            />
            ${slugInvalid
              ? html`<p class="hint error">只能包含英文字母、数字、连字符（-）和下划线（_）</p>`
              : html`<p class="hint">为本地创建的技能命名唯一标识 Slug</p>`}
          </div>

          <div class="field">
            <label for="import-agent">选择目标智能体 (工作区)</label>
            <select id="import-agent" .value=${this._workspace} @change=${this._onAgentChange}>
              <option value="">不指定（导入至默认全局共享路径）</option>
              ${this.agents.map(
                (agent) => html`
                  <option value=${agent.workspace}>
                    ${agent.name || agent.id} (${agent.workspace})
                  </option>
                `,
              )}
            </select>
            <p class="hint">可以选择将其安装进某个特定智能体的独立工作区，或者不指定以全局共享</p>
          </div>

          <div class="path-preview-card">
            <span class="path-preview-title">即将导入至目录：</span>
            <div class="path-preview-value">${finalPath}</div>
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
    "clawhub-skill-import-dialog": ClawHubSkillImportDialog;
  }
}
