import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { WorkspaceEntry } from "../../types/agents-types.js";

/**
 * 导出 Skill 对话框 — 展示工作区文件列表供用户勾选。
 * 触发 confirm({ items: string[] }) 或 cancel 事件。
 */
@customElement("skill-export-dialog")
export class SkillExportDialog extends LitElement {
  @property({ attribute: false }) entries: WorkspaceEntry[] = [];
  @property({ type: String }) skillName = "";

  @state() private _selected: Set<string> = new Set();

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
      width: 480px;
      max-width: 90vw;
      max-height: 80vh;
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

    .toolbar {
      display: flex;
      gap: 8px;
      margin-bottom: 12px;
    }

    .toggle-btn {
      font-size: 12px;
      padding: 4px 10px;
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
      overflow-y: auto;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 4px 0;
    }

    .entry-item {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 8px 12px;
      cursor: pointer;
      transition: background 0.15s;
    }

    .entry-item:hover {
      background: #f8fafc;
    }

    .entry-item input[type="checkbox"] {
      width: 16px;
      height: 16px;
      cursor: pointer;
      flex-shrink: 0;
    }

    .entry-icon {
      font-size: 16px;
      flex-shrink: 0;
    }

    .entry-name {
      font-size: 13px;
      color: #1e293b;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .entry-size {
      margin-left: auto;
      font-size: 12px;
      color: #94a3b8;
      flex-shrink: 0;
    }

    .empty {
      padding: 24px;
      text-align: center;
      color: #94a3b8;
      font-size: 14px;
    }

    .actions {
      display: flex;
      gap: 12px;
      justify-content: flex-end;
      margin-top: 20px;
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

  willUpdate(changed: Map<string, unknown>) {
    // Default-select all entries when entries prop changes
    if (changed.has("entries")) {
      this._selected = new Set(this.entries.map((e) => e.name));
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
    // 生成默认下载文件名，确保带 .zip 后缀
    const baseName = this.skillName.trim() || "skill-export";
    const fileName = baseName.endsWith(".zip") ? baseName : `${baseName}.zip`;
    this.dispatchEvent(
      new CustomEvent("confirm", {
        detail: { items: [...this._selected], fileName },
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
    if (bytes === 0) {
      return "";
    }
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  render() {
    return html`
      <div class="overlay" @click=${this._onOverlayClick}>
        <div class="dialog-card" role="dialog" aria-modal="true" aria-labelledby="export-title">
          <h3 id="export-title">导出 Skill</h3>
          <p class="subtitle">选择要导出的文件和目录（${this.skillName}）</p>
          <div class="toolbar">
            <button class="toggle-btn" @click=${this._selectAll}>全选</button>
            <button class="toggle-btn" @click=${this._deselectAll}>取消全选</button>
          </div>
          <div class="entry-list" role="list">
            ${this.entries.length === 0
              ? html`<div class="empty">目录为空</div>`
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
          <div class="actions">
            <button class="cancel-btn" @click=${this._onCancel}>取消</button>
            <button
              class="confirm-btn"
              ?disabled=${this._selected.size === 0}
              @click=${this._onConfirm}
            >
              导出 ${this._selected.size > 0 ? `(${this._selected.size})` : ""}
            </button>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "skill-export-dialog": SkillExportDialog;
  }
}
