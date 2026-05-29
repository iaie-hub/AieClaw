import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { WorkspaceEntry } from "../../types/agents-types.js";

/**
 * 上传智能体到 AgentHub 对话框。
 * 提供文件列表勾选，修改上传名称和描述。
 * 触发 confirm({ items: string[], name: string, description: string }) 或 cancel 事件。
 */
@customElement("agent-upload-dialog")
export class AgentUploadDialog extends LitElement {
  @property({ attribute: false }) entries: WorkspaceEntry[] = [];
  @property({ type: String }) agentName = "";
  @property({ type: String }) description = "";

  @state() private _selected: Set<string> = new Set();
  @state() private _uploadName = "";
  @state() private _uploadDescription = "";

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
      width: 520px;
      max-width: 90vw;
      max-height: 85vh;
      display: flex;
      flex-direction: column;
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
      margin: 0 0 4px;
      font-size: 18px;
      font-weight: 700;
      color: #1e293b;
    }

    .subtitle {
      font-size: 13px;
      color: #64748b;
      margin: 0 0 16px;
    }

    .form-group {
      margin-bottom: 14px;
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .form-group label {
      font-size: 12px;
      font-weight: 600;
      color: #475569;
    }

    .form-group input,
    .form-group textarea {
      padding: 8px 12px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      font-size: 13px;
      color: #1e293b;
      outline: none;
      transition: border-color 0.2s;
      background: #f8fafc;
    }

    .form-group input:focus,
    .form-group textarea:focus {
      border-color: #3b82f6;
      background: white;
    }

    .toolbar {
      display: flex;
      gap: 8px;
      margin-bottom: 8px;
      align-items: center;
      justify-content: space-between;
    }

    .toolbar-title {
      font-size: 12px;
      font-weight: 600;
      color: #475569;
    }

    .toggle-buttons {
      display: flex;
      gap: 6px;
    }

    .toggle-btn {
      font-size: 11px;
      padding: 3px 8px;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      background: #f8fafc;
      color: #475569;
      cursor: pointer;
    }

    .toggle-btn:hover {
      background: #e2e8f0;
    }

    .entry-list {
      flex: 1;
      min-height: 120px;
      max-height: 200px;
      overflow-y: auto;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 4px 0;
      margin-bottom: 10px;
    }

    .entry-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 6px 12px;
      cursor: pointer;
      transition: background 0.15s;
    }

    .entry-item:hover {
      background: #f8fafc;
    }

    .entry-item input[type="checkbox"] {
      width: 15px;
      height: 15px;
      cursor: pointer;
      flex-shrink: 0;
    }

    .entry-icon {
      font-size: 14px;
      flex-shrink: 0;
    }

    .entry-name {
      font-size: 12px;
      color: #1e293b;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .entry-size {
      margin-left: auto;
      font-size: 11px;
      color: #94a3b8;
      flex-shrink: 0;
    }

    .empty {
      padding: 24px;
      text-align: center;
      color: #94a3b8;
      font-size: 13px;
    }

    .actions {
      display: flex;
      gap: 12px;
      justify-content: flex-end;
      margin-top: 10px;
    }

    button.action-btn {
      padding: 9px 18px;
      border-radius: 8px;
      font-size: 13px;
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

  willUpdate(changed: Map<string, unknown>) {
    // Select all entries by default when entries prop changes
    if (changed.has("entries")) {
      this._selected = new Set(this.entries.map((e) => e.name));
    }
    if (changed.has("agentName") && this.agentName) {
      this._uploadName = this.agentName;
    }
    if (changed.has("description")) {
      this._uploadDescription = this.description;
    }
  }

  private _toggle(name: string) {
    const next = new Set(this._selected);
    if (next.has(name)) {
      next.delete(name);
    } else {
      next.add(name);
    }
    this._selected = next;
  }

  private _selectAll = () => {
    this._selected = new Set(this.entries.map((e) => e.name));
  };

  private _deselectAll = () => {
    this._selected = new Set();
  };

  private _onConfirm = () => {
    const name = this._uploadName.trim();
    if (!name) return;

    this.dispatchEvent(
      new CustomEvent("confirm", {
        detail: {
          items: [...this._selected],
          name,
          description: this._uploadDescription.trim(),
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

  private _formatSize(bytes: number): string {
    if (bytes === 0) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  render() {
    return html`
      <div class="overlay" @click=${this._onOverlayClick}>
        <div class="dialog-card" role="dialog" aria-modal="true" aria-labelledby="upload-title">
          <h3 id="upload-title">上传到 AgentHub</h3>
          <p class="subtitle">打包并上传智能体共享至 AgentRegistry 后端</p>

          <!-- Input: Agent Name -->
          <div class="form-group">
            <label for="agent-name-input">智能体名称</label>
            <input
              id="agent-name-input"
              type="text"
              .value=${this._uploadName}
              @input=${(e: Event) => (this._uploadName = (e.target as HTMLInputElement).value)}
              placeholder="请输入智能体名称"
            />
          </div>

          <!-- Textarea: Description -->
          <div class="form-group">
            <label for="agent-desc-input">描述信息 (AGENTS.md)</label>
            <textarea
              id="agent-desc-input"
              rows="3"
              .value=${this._uploadDescription}
              @input=${(e: Event) => (this._uploadDescription = (e.target as HTMLTextAreaElement).value)}
              placeholder="请输入智能体详细描述"
            ></textarea>
          </div>

          <!-- Files selection list -->
          <div class="toolbar">
            <span class="toolbar-title">打包文件列表</span>
            <div class="toggle-buttons">
              <button class="toggle-btn" @click=${this._selectAll}>全选</button>
              <button class="toggle-btn" @click=${this._deselectAll}>取消全选</button>
            </div>
          </div>

          <div class="entry-list" role="list">
            ${this.entries.length === 0
              ? html`<div class="empty">工作区为空</div>`
              : this.entries.map(
                  (entry) => html`
                    <label class="entry-item" role="listitem">
                      <input
                        type="checkbox"
                        .checked=${this._selected.has(entry.name)}
                        @change=${() => this._toggle(entry.name)}
                      />
                      <span class="entry-icon">${entry.type === "directory" ? "📁" : "📄"}</span>
                      <span class="entry-name">${entry.name}</span>
                      ${entry.size > 0
                        ? html`<span class="entry-size">${this._formatSize(entry.size)}</span>`
                        : ""}
                    </label>
                  `,
                )}
          </div>

          <!-- Action buttons -->
          <div class="actions">
            <button class="action-btn cancel-btn" @click=${this._onCancel}>取消</button>
            <button
              class="action-btn confirm-btn"
              ?disabled=${this._selected.size === 0 || !this._uploadName.trim()}
              @click=${this._onConfirm}
            >
              打包上传 ${this._selected.size > 0 ? `(${this._selected.size})` : ""}
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "agent-upload-dialog": AgentUploadDialog;
  }
}
