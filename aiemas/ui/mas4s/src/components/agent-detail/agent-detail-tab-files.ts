import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { fetchAgentFiles, fetchAgentFileContent, saveAgentFile } from "../../gateway/agents-api.js";
import { getClient } from "../../gateway/client.js";
import { markdownMath } from "../../lib/markdown-directive.js";
import type { AgentFileEntry } from "../../types/agents-types.js";
import { tabPanelStyles } from "./shared-styles.js";

const FILE_DESCRIPTIONS: Record<string, string> = {
  "AGENTS.md": "子智能体调用和管理策略配置。",
  "SOUL.md": "定义智能体的核心灵魂和人设设定。",
  "TOOLS.md": "当前智能体被允许调用的工具权限配置。",
  "IDENTITY.md": "智能体身份标识与自我认知定义。",
  "USER.md": "用户偏好与交互风格配置。",
  "HEARTBEAT.md": "心跳检测与健康状态配置。",
  "BOOTSTRAP.md": "智能体启动引导与初始化配置。",
  "MEMORY.md": "长期记忆存储文件。",
};
const viewerStyles = css`
  .viewer-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    z-index: 1100;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: fadeIn 0.15s ease;
  }
  .viewer-dialog {
    background: #fff;
    border-radius: 14px;
    width: min(720px, 90vw);
    height: min(80vh, 600px);
    display: flex;
    flex-direction: column;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.15);
    animation: slideUp 0.2s ease;
    overflow: hidden;
    transition:
      width 0.25s ease,
      height 0.25s ease,
      border-radius 0.25s ease;
  }
  .viewer-dialog.expanded {
    width: 100vw;
    height: 100vh;
    border-radius: 0;
  }
  .viewer-header {
    padding: 14px 20px;
    border-bottom: 1px solid #e8edf5;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
    background: #fafbfc;
  }
  .viewer-title {
    font-size: 15px;
    font-weight: 600;
    color: #1e293b;
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .viewer-title-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .viewer-actions {
    display: flex;
    gap: 6px;
    flex-shrink: 0;
  }
  .viewer-action-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 6px 12px;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    background: #fff;
    color: #475569;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }
  .viewer-action-btn:hover {
    background: #f1f5f9;
    border-color: #cbd5e1;
    color: #1e293b;
  }
  .viewer-action-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .viewer-action-btn svg {
    width: 15px;
    height: 15px;
    flex-shrink: 0;
  }
  .viewer-action-btn.primary {
    background: #3b82f6;
    color: #fff;
    border-color: #3b82f6;
  }
  .viewer-action-btn.primary:hover:not(:disabled) {
    background: #2563eb;
    border-color: #2563eb;
  }
  .viewer-body {
    flex: 1;
    overflow-y: auto;
    padding: 24px 28px;
    font-size: 14px;
    color: #1e293b;
    line-height: 1.7;
  }
  .viewer-loading,
  .viewer-error {
    text-align: center;
    padding: 48px 0;
    color: #94a3b8;
    font-size: 14px;
  }
  .viewer-error {
    color: #ef4444;
  }
  .save-error {
    padding: 8px 12px;
    margin-bottom: 12px;
    background: #fef2f2;
    border: 1px solid #fee2e2;
    border-radius: 8px;
    color: #dc2626;
    font-size: 13px;
  }

  /* ── Editor textarea ── */
  .editor-area {
    width: 100%;
    height: 100%;
    min-height: 300px;
    border: none;
    outline: none;
    resize: none;
    font-size: 14px;
    line-height: 1.7;
    color: #1e293b;
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    background: transparent;
    box-sizing: border-box;
  }
  .viewer-body.editing {
    display: flex;
    flex-direction: column;
    padding: 0;
  }
  .viewer-body.editing .editor-area {
    flex: 1;
    padding: 24px 28px;
  }
  .viewer-body.editing .save-error {
    margin: 12px 28px 0;
    flex-shrink: 0;
  }

  /* ── Markdown content styles ── */
  .md-content p {
    margin: 0 0 0.6em;
  }
  .md-content p:last-child {
    margin-bottom: 0;
  }
  .md-content h1,
  .md-content h2,
  .md-content h3,
  .md-content h4 {
    margin: 1em 0 0.4em;
    font-weight: 600;
    line-height: 1.3;
  }
  .md-content h1 {
    font-size: 1.4em;
  }
  .md-content h2 {
    font-size: 1.2em;
  }
  .md-content h3 {
    font-size: 1.05em;
  }
  .md-content ul,
  .md-content ol {
    margin: 0.4em 0;
    padding-left: 1.5em;
  }
  .md-content li {
    margin: 0.2em 0;
  }
  .md-content code {
    background: #f0f4f8;
    border: 1px solid #e2e8f0;
    border-radius: 4px;
    padding: 1px 5px;
    font-size: 0.88em;
    font-family: ui-monospace, monospace;
  }
  .md-content pre {
    background: #f8fafc;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 12px 16px;
    margin: 0.6em 0;
    overflow-x: auto;
  }
  .md-content pre code {
    background: none;
    border: none;
    padding: 0;
    font-size: 0.85em;
    white-space: pre-wrap;
    word-break: break-all;
  }
  .md-content blockquote {
    border-left: 3px solid #3b82f6;
    margin: 0.6em 0;
    padding: 4px 12px;
    color: #475569;
    background: #f0f9ff;
    border-radius: 0 6px 6px 0;
  }
  .md-content a {
    color: #3b82f6;
    text-decoration: underline;
  }
  .md-content strong {
    font-weight: 600;
  }
  .md-content em {
    font-style: italic;
  }
  .md-content hr {
    border: none;
    border-top: 1px solid #e2e8f0;
    margin: 0.8em 0;
  }
  .md-content table {
    border-collapse: collapse;
    width: 100%;
    margin: 0.6em 0;
    font-size: 0.9em;
  }
  .md-content th,
  .md-content td {
    border: 1px solid #e2e8f0;
    padding: 6px 10px;
    text-align: left;
  }
  .md-content th {
    background: #f8fafc;
    font-weight: 600;
  }
  .md-content img {
    max-width: 100%;
    border-radius: 6px;
  }
`;
/** 合并保存后返回的文件条目到列表（参考 ui/src/ui/controllers/agent-files.ts mergeFileEntry） */
function mergeFileEntry(files: AgentFileEntry[], entry: AgentFileEntry): AgentFileEntry[] {
  const exists = files.some((f) => f.name === entry.name);
  return exists ? files.map((f) => (f.name === entry.name ? entry : f)) : [...files, entry];
}

@customElement("agent-tab-files")
export class AgentTabFiles extends LitElement {
  @property({ type: String }) agentId = "";
  @state() private _loading = true;
  @state() private _files: AgentFileEntry[] = [];

  // ── viewer state ──
  @state() private _viewerOpen = false;
  @state() private _viewerExpanded = false;
  @state() private _viewerFile: AgentFileEntry | null = null;
  @state() private _viewerContent: string | null = null;
  @state() private _viewerLoading = false;
  @state() private _viewerError: string | null = null;

  // ── editor state ──
  @state() private _editing = false;
  @state() private _draft = "";
  @state() private _saving = false;
  @state() private _saveError: string | null = null;

  static styles = [tabPanelStyles, viewerStyles];

  connectedCallback() {
    super.connectedCallback();
    void this._load();
  }

  private async _load() {
    this._loading = true;
    try {
      const res = await fetchAgentFiles(getClient(), this.agentId);
      this._files = res.files;
    } catch {
      /* retry on next mount */
    } finally {
      this._loading = false;
    }
  }

  private _fmtSize(b?: number) {
    return b == null ? "—" : b < 1024 ? `${b} B` : `${(b / 1024).toFixed(1)} KB`;
  }
  private _fmtTime(ms?: number) {
    return ms == null ? "—" : new Date(ms).toLocaleString("zh-CN");
  }

  // ── viewer actions ──

  private async _openViewer(f: AgentFileEntry) {
    this._viewerFile = f;
    this._viewerOpen = true;
    this._viewerExpanded = false;
    this._viewerContent = null;
    this._viewerError = null;
    this._viewerLoading = true;
    this._editing = false;
    this._saveError = null;
    try {
      const res = await fetchAgentFileContent(getClient(), this.agentId, f.name);
      this._viewerContent = res.file.content ?? "";
    } catch (err: unknown) {
      this._viewerError = err instanceof Error ? err.message : "加载文件内容失败";
    } finally {
      this._viewerLoading = false;
    }
  }

  private _closeViewer() {
    if (this._saving) {
      return;
    }
    this._viewerOpen = false;
    this._viewerFile = null;
    this._viewerContent = null;
    this._viewerError = null;
    this._editing = false;
    this._saveError = null;
  }

  private _toggleExpand() {
    this._viewerExpanded = !this._viewerExpanded;
  }

  private _enterEdit() {
    if (this._viewerContent == null) {
      return;
    }
    this._draft = this._viewerContent;
    this._editing = true;
    this._saveError = null;
  }

  private _cancelEdit() {
    if (this._saving) {
      return;
    }
    this._editing = false;
    this._saveError = null;
  }

  private async _save() {
    if (!this._viewerFile || this._saving) {
      return;
    }
    this._saving = true;
    this._saveError = null;
    try {
      const res = await saveAgentFile(
        getClient(),
        this.agentId,
        this._viewerFile.name,
        this._draft,
      );
      if (res?.file) {
        // 更新文件列表条目（参考 agent-files controller）
        this._files = mergeFileEntry(this._files, res.file);
        this._viewerContent = this._draft;
        this._viewerFile = res.file;
      }
      this._editing = false;
    } catch (err: unknown) {
      this._saveError = err instanceof Error ? err.message : "保存失败";
    } finally {
      this._saving = false;
    }
  }

  // ── render ──

  render() {
    if (this._loading) {
      return html`<div class="loading-state">加载中...</div>`;
    }
    if (this._files.length === 0) {
      return html`<div class="empty-state">暂无文件信息</div>`;
    }
    return html`
      <div class="grid">
        ${this._files.map(
          (f) => html`
            <div
              class="item-card"
              @click=${() => {
                void this._openViewer(f);
              }}
            >
              <div class="card-head">
                <div class="card-title">📄 ${f.name}</div>
                ${f.missing
                  ? html`<span class="status-missing">缺失</span>`
                  : html`<span class="status-ok">就绪</span>`}
              </div>
              <div class="card-desc">${FILE_DESCRIPTIONS[f.name] ?? "智能体配置文件。"}</div>
              <div class="card-meta">
                大小: ${this._fmtSize(f.size)} | 更新: ${this._fmtTime(f.updatedAtMs)}
              </div>
            </div>
          `,
        )}
      </div>
      ${this._viewerOpen ? this._renderViewer() : nothing}
    `;
  }
  private _renderViewer() {
    const f = this._viewerFile!;
    return html`
      <div
        class="viewer-overlay"
        @click=${(e: MouseEvent) => {
          if (e.target === e.currentTarget) {
            this._closeViewer();
          }
        }}
      >
        <div class="viewer-dialog ${this._viewerExpanded ? "expanded" : ""}">
          <div class="viewer-header">
            <div class="viewer-title">
              <span>📄</span>
              <span class="viewer-title-text">${f.name}</span>
            </div>
            <div class="viewer-actions">
              ${this._editing ? this._renderEditActions() : this._renderViewActions()}
            </div>
          </div>
          <div
            class="viewer-body ${this._editing && !this._viewerLoading && !this._viewerError
              ? "editing"
              : ""}"
          >
            ${this._viewerLoading
              ? html`<div class="viewer-loading">加载中...</div>`
              : this._viewerError
                ? html`<div class="viewer-error">${this._viewerError}</div>`
                : this._editing
                  ? this._renderEditorBody()
                  : html`<div class="md-content">${markdownMath(this._viewerContent ?? "")}</div>`}
          </div>
        </div>
      </div>
    `;
  }

  /** 只读模式操作按钮：扩展、编辑、关闭 */
  private _renderViewActions() {
    return html`
      <button
        class="viewer-action-btn"
        @click=${() => this._toggleExpand()}
        title=${this._viewerExpanded ? "收起" : "扩展"}
      >
        ${this._viewerExpanded
          ? html`<svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="9 4 4 4 4 9"></polyline>
              <line x1="4" y1="4" x2="11" y2="11"></line>
              <polyline points="15 20 20 20 20 15"></polyline>
              <line x1="20" y1="20" x2="13" y2="13"></line>
            </svg>`
          : html`<svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="14 3 21 3 21 10"></polyline>
              <line x1="21" y1="3" x2="10" y2="14"></line>
              <polyline points="3 10 3 21 14 21"></polyline>
            </svg>`}
        ${this._viewerExpanded ? "收起" : "扩展"}
      </button>
      <button class="viewer-action-btn" @click=${() => this._enterEdit()} title="编辑">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
        </svg>
        编辑
      </button>
      <button class="viewer-action-btn" @click=${() => this._closeViewer()} title="关闭">
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
        关闭
      </button>
    `;
  }

  /** 编辑模式操作按钮：扩展、保存、取消 */
  private _renderEditActions() {
    const dirty = this._draft !== this._viewerContent;
    return html`
      <button
        class="viewer-action-btn"
        @click=${() => this._toggleExpand()}
        title=${this._viewerExpanded ? "收起" : "扩展"}
      >
        ${this._viewerExpanded
          ? html`<svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="9 4 4 4 4 9"></polyline>
              <line x1="4" y1="4" x2="11" y2="11"></line>
              <polyline points="15 20 20 20 20 15"></polyline>
              <line x1="20" y1="20" x2="13" y2="13"></line>
            </svg>`
          : html`<svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="14 3 21 3 21 10"></polyline>
              <line x1="21" y1="3" x2="10" y2="14"></line>
              <polyline points="3 10 3 21 14 21"></polyline>
            </svg>`}
        ${this._viewerExpanded ? "收起" : "扩展"}
      </button>
      <button
        class="viewer-action-btn primary"
        @click=${() => {
          void this._save();
        }}
        ?disabled=${!dirty || this._saving}
        title="保存"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
          <polyline points="17 21 17 13 7 13 7 21"></polyline>
          <polyline points="7 3 7 8 15 8"></polyline>
        </svg>
        ${this._saving ? "保存中…" : "保存"}
      </button>
      <button
        class="viewer-action-btn"
        @click=${() => this._cancelEdit()}
        ?disabled=${this._saving}
        title="取消"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
        取消
      </button>
    `;
  }

  /** 编辑模式正文：错误提示 + textarea */
  private _renderEditorBody() {
    return html`
      ${this._saveError ? html`<div class="save-error">${this._saveError}</div>` : nothing}
      <textarea
        class="editor-area"
        .value=${this._draft}
        @input=${(e: Event) => {
          this._draft = (e.target as HTMLTextAreaElement).value;
        }}
        ?disabled=${this._saving}
      ></textarea>
    `;
  }
}
