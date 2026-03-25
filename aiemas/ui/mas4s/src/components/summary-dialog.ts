import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { getClient } from "../gateway/client.js";
import { generateSummary, getSummary } from "../gateway/session-archive.js";
import { markdownMath } from "../lib/markdown-directive.js";
import { AppStore } from "../store/app-store.js";
import { SummaryStore } from "../store/summary-store.js";
import type { MasSession, SessionSummary } from "../types/session-types.js";

/**
 * 会话摘要右侧滑入面板。
 * 需求 4.10、4.11、4.12
 *
 * 点击行为：
 * - 已归档：直接调用 session.summary.get 获取持久化摘要展示
 * - 未归档 + 无缓存：调用 session.summary.generate，写入 SummaryStore，展示
 * - 未归档 + 有缓存：提示已存在，提供"重新生成"和"查看摘要"按钮
 *
 * 布局：遮罩 + 右侧面板，遮罩点击关闭，面板从右侧滑入/滑出。
 * 父容器需设置 position: relative（或 fixed/absolute）以限定遮罩范围。
 */
@customElement("summary-dialog")
export class SummaryDialog extends LitElement {
  @property({ attribute: false }) session!: MasSession;
  @property({ type: Boolean }) isOwner = false;
  /** 是否可见，由父组件控制 */
  @property({ type: Boolean }) open = false;

  @state() private _loading = false;
  @state() private _summary: SessionSummary | null = null;
  @state() private _error: string | null = null;

  static styles = css`
    :host {
      display: contents;
    }

    /* 遮罩：覆盖整个对话区域（父容器需 position: relative） */
    .overlay {
      position: absolute;
      inset: 0;
      background: rgba(15, 23, 42, 0.25);
      z-index: 200;
      /* 遮罩淡入淡出 */
      animation: fadeIn 0.2s ease forwards;
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }

    /* 右侧滑入面板 */
    .panel {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      width: 60%;
      max-width: 100%;
      background: rgba(255, 255, 255, 0.85);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      display: flex;
      flex-direction: column;
      box-shadow: -4px 0 24px rgba(0, 0, 0, 0.1);
      z-index: 201;
      animation: slideIn 0.25s cubic-bezier(0.4, 0, 0.2, 1) forwards;
    }

    @keyframes slideIn {
      from {
        transform: translateX(100%);
      }
      to {
        transform: translateX(0);
      }
    }

    /* 面板 header */
    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 16px 20px;
      border-bottom: 1px solid #f1f5f9;
      flex-shrink: 0;
      background: rgba(250, 251, 252, 0.5);
    }

    .panel-title {
      font-size: 14px;
      font-weight: 600;
      color: #1e293b;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .panel-title-icon {
      width: 28px;
      height: 28px;
      border-radius: 8px;
      background: linear-gradient(135deg, #7c3aed22, #6366f122);
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
    }

    .close-btn {
      background: none;
      border: none;
      cursor: pointer;
      color: #94a3b8;
      font-size: 16px;
      padding: 4px 6px;
      border-radius: 6px;
      line-height: 1;
      transition: all 0.15s;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .close-btn:hover {
      color: #475569;
      background: #f1f5f9;
    }

    /* 面板 body */
    .panel-body {
      flex: 1;
      overflow-y: auto;
      padding: 20px;
    }

    /* 缓存提示 */
    .cache-prompt {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .cache-notice {
      background: #fffbeb;
      border: 1px solid #fde68a;
      border-radius: 8px;
      padding: 12px 14px;
      font-size: 13px;
      color: #92400e;
      line-height: 1.6;
    }

    .cache-actions {
      display: flex;
      gap: 10px;
      justify-content: flex-end;
    }

    .btn {
      padding: 7px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      border: 1px solid #e2e8f0;
      background: white;
      color: #475569;
      transition: all 0.15s;
    }

    .btn:hover {
      background: #f8fafc;
      border-color: #94a3b8;
    }

    .btn.primary {
      background: linear-gradient(135deg, #7c3aed 0%, #6366f1 100%);
      color: white;
      border-color: transparent;
      box-shadow: 0 2px 6px rgba(124, 58, 237, 0.25);
    }

    .btn.primary:hover {
      box-shadow: 0 4px 10px rgba(124, 58, 237, 0.35);
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    /* 摘要内容 */
    .summary-section {
      margin-bottom: 20px;
    }

    .summary-section:last-of-type {
      margin-bottom: 0;
    }

    .section-label {
      font-size: 11px;
      font-weight: 700;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      margin-bottom: 8px;
    }

    .section-content {
      font-size: 14px;
      color: #334155;
      line-height: 1.7;
      word-break: break-word;
      background: #f8fafc;
      border: 1px solid #f1f5f9;
      border-radius: 8px;
      padding: 12px 14px;
    }

    /* Markdown rendered content */
    .section-content.markdown-body {
      white-space: normal;
    }

    .section-content.markdown-body p {
      margin: 0 0 0.6em;
    }

    .section-content.markdown-body p:last-child {
      margin-bottom: 0;
    }

    .section-content.markdown-body h1,
    .section-content.markdown-body h2,
    .section-content.markdown-body h3 {
      margin: 0.8em 0 0.4em;
      font-weight: 600;
      color: #1e293b;
    }

    .section-content.markdown-body ul,
    .section-content.markdown-body ol {
      margin: 0.4em 0;
      padding-left: 1.4em;
    }

    .section-content.markdown-body li {
      margin-bottom: 0.25em;
    }

    .section-content.markdown-body code {
      font-family: ui-monospace, monospace;
      font-size: 12px;
      background: #e2e8f0;
      border-radius: 3px;
      padding: 1px 4px;
    }

    .section-content.markdown-body pre {
      background: #1e293b;
      color: #e2e8f0;
      border-radius: 6px;
      padding: 10px 12px;
      overflow-x: auto;
      font-size: 12px;
      margin: 0.5em 0;
    }

    .section-content.markdown-body pre code {
      background: none;
      padding: 0;
      color: inherit;
    }

    .section-content.markdown-body blockquote {
      border-left: 3px solid #7c3aed;
      margin: 0.5em 0;
      padding: 2px 12px;
      color: #64748b;
    }

    /* KaTeX */
    .section-content.markdown-body .katex-display {
      overflow-x: auto;
      margin: 0.5em 0;
    }

    .empty-hint {
      color: #94a3b8;
      font-style: italic;
    }

    .generated-at {
      font-size: 11px;
      color: #cbd5e1;
      margin-top: 16px;
      text-align: right;
    }

    /* 重新生成按钮（摘要底部） */
    .regen-row {
      display: flex;
      justify-content: flex-end;
      margin-top: 16px;
    }

    /* 加载 / 错误 */
    .loading-wrap {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 48px 0;
      color: #94a3b8;
      font-size: 14px;
    }

    .spinner {
      width: 28px;
      height: 28px;
      border: 3px solid #e2e8f0;
      border-top-color: #7c3aed;
      border-radius: 50%;
      animation: spin 0.7s linear infinite;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    .error-hint {
      color: #ef4444;
      font-size: 13px;
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 8px;
      padding: 10px 14px;
      line-height: 1.5;
    }
  `;

  private get _isArchived(): boolean {
    return this.session?.archivedAt != null;
  }

  /** 打开时根据会话状态决定初始行为 */
  async openDialog(): Promise<void> {
    this._error = null;
    this._summary = null;

    if (this._isArchived) {
      await this._fetchPersistedSummary();
    } else {
      const cached = SummaryStore.instance.get(this.session.key);
      if (cached) {
        this._summary = cached;
      } else {
        await this._generate();
      }
    }
  }

  private async _fetchPersistedSummary(): Promise<void> {
    this._loading = true;
    try {
      const result = await getSummary(getClient(), this.session.key);
      this._summary = result;
    } catch (err) {
      this._error = `获取摘要失败：${err instanceof Error ? err.message : String(err)}`;
    } finally {
      this._loading = false;
    }
  }

  private async _generate(): Promise<void> {
    this._loading = true;
    try {
      const result = await generateSummary(getClient(), this.session.key);
      if (!this._isArchived) {
        SummaryStore.instance.set(this.session.key, result);
      }
      this._summary = result;
      AppStore.instance.notify();
    } catch (err) {
      this._error = `生成摘要失败：${err instanceof Error ? err.message : String(err)}`;
    } finally {
      this._loading = false;
    }
  }

  private _onRegenerate = async () => {
    await this._generate();
  };

  private _onClose = () => {
    this.dispatchEvent(new CustomEvent("summary-close", { bubbles: true, composed: true }));
  };

  render() {
    if (!this.open) {
      return nothing;
    }

    return html`
      <!-- 遮罩：点击关闭 -->
      <div class="overlay" @click=${this._onClose} aria-hidden="true"></div>

      <!-- 右侧滑入面板 -->
      <div class="panel" role="complementary" aria-label="会话摘要">
        <div class="panel-header">
          <div class="panel-title">
            <div class="panel-title-icon">📋</div>
            会话摘要
          </div>
          <button class="close-btn" @click=${this._onClose} aria-label="关闭摘要面板">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="panel-body">
          ${this._renderBody()}
        </div>
      </div>
    `;
  }

  private _renderBody() {
    if (this._loading) {
      return html`
        <div class="loading-wrap">
          <div class="spinner"></div>
          <span>${this._isArchived ? "加载摘要中…" : "生成摘要中，请稍候…"}</span>
        </div>
      `;
    }
    if (this._error) {
      return html`<div class="error-hint">${this._error}</div>`;
    }
    if (this._summary) {
      return this._renderSummary(this._summary);
    }
    return html`
      <div class="loading-wrap">
        <span class="empty-hint">暂无摘要内容</span>
      </div>
    `;
  }

  private _renderSummary(s: SessionSummary) {
    const timeStr = new Date(s.generatedAt).toLocaleString();
    return html`
      <div class="cache-notice" style="margin-bottom: 16px;">
        摘要生成时间：${timeStr}
      </div>

      <div class="summary-section">
        <div class="section-label">对话摘要</div>
        <div class="section-content markdown-body">
          ${
            s.textSummary
              ? markdownMath(s.textSummary)
              : html`
                  <span class="empty-hint">暂无对话内容</span>
                `
          }
        </div>
      </div>
      <div class="summary-section">
        <div class="section-label">工具调用摘要</div>
        <div class="section-content markdown-body">
          ${
            s.toolSummary
              ? markdownMath(s.toolSummary)
              : html`
                  <span class="empty-hint">暂无工具调用</span>
                `
          }
        </div>
      </div>
      
      ${
        !this._isArchived
          ? html`
            <div class="regen-row">
              <button class="btn" @click=${this._onRegenerate} ?disabled=${this._loading}>
                重新生成
              </button>
            </div>
          `
          : nothing
      }
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "summary-dialog": SummaryDialog;
  }
}
