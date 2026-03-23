import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { getClient } from "../gateway/client.js";
import { generateSummary, getSummary } from "../gateway/session-archive.js";
import { AppStore } from "../store/app-store.js";
import type { MasSession, SessionSummary } from "../types/session-types.js";

/**
 * 会话摘要面板。
 * - 未归档会话：所有 Session_Member 可见"生成摘要"按钮，摘要仅客户端展示
 * - 已归档会话：仅 Session_Owner 可见"生成摘要"按钮，摘要持久化
 * - 收到 session.summary.updated 事件后自动拉取最新摘要
 *
 * 需求：4.9、4.10
 */
@customElement("summary-panel")
export class SummaryPanel extends LitElement {
  @property({ attribute: false }) session!: MasSession;
  @property({ attribute: false }) summary: SessionSummary | undefined = undefined;
  @property({ type: Boolean }) isOwner = false;

  @state() private _loading = false;

  static styles = css`
    :host {
      display: block;
    }

    .panel {
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 20px;
      margin-top: 16px;
    }

    .panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 16px;
    }

    .panel-title {
      font-size: 15px;
      font-weight: 600;
      color: #1e293b;
    }

    .generate-btn {
      padding: 6px 16px;
      background: linear-gradient(135deg, #3b82f6 0%, #6366f1 100%);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
      box-shadow: 0 2px 6px rgba(59, 130, 246, 0.25);
    }

    .generate-btn:hover:not(:disabled) {
      transform: translateY(-1px);
      box-shadow: 0 4px 10px rgba(59, 130, 246, 0.35);
    }

    .generate-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      transform: none;
    }

    .summary-section {
      margin-bottom: 14px;
    }

    .summary-section:last-child {
      margin-bottom: 0;
    }

    .section-label {
      font-size: 13px;
      font-weight: 600;
      color: #475569;
      margin-bottom: 6px;
    }

    .section-content {
      font-size: 14px;
      color: #334155;
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-word;
      background: #f8fafc;
      border-radius: 8px;
      padding: 12px;
    }

    .empty-hint {
      color: #94a3b8;
      font-style: italic;
    }

    .generated-at {
      font-size: 12px;
      color: #94a3b8;
      margin-top: 12px;
      text-align: right;
    }
  `;

  private get _isArchived(): boolean {
    return this.session?.archivedAt != null;
  }

  /** 按钮可见性：未归档时所有成员可见；已归档时仅 owner 可见 */
  private get _showGenerateButton(): boolean {
    if (!this._isArchived) {
      return true;
    }
    return this.isOwner;
  }

  private _onGenerate = async () => {
    if (this._loading || !this.session) {
      return;
    }
    this._loading = true;
    try {
      const client = getClient();
      const result = await generateSummary(client, this.session.key);
      const store = AppStore.instance;
      store.setSummary(this.session.key, result);
    } catch (err) {
      console.error("生成摘要失败:", err);
    } finally {
      this._loading = false;
    }
  };

  /**
   * 供父组件在收到 session.summary.updated 事件后调用，
   * 自动拉取最新持久化摘要。
   */
  async refreshSummary(): Promise<void> {
    if (!this.session) {
      return;
    }
    try {
      const client = getClient();
      const result = await getSummary(client, this.session.key);
      if (result) {
        const store = AppStore.instance;
        store.setSummary(this.session.key, result);
      }
    } catch (err) {
      console.error("刷新摘要失败:", err);
    }
  }

  render() {
    return html`
      <div class="panel">
        <div class="panel-header">
          <span class="panel-title">📋 会话摘要</span>
          ${
            this._showGenerateButton
              ? html`
                <button
                  class="generate-btn"
                  ?disabled=${this._loading}
                  @click=${this._onGenerate}
                >
                  ${this._loading ? "生成中…" : "生成摘要"}
                </button>
              `
              : nothing
          }
        </div>

        ${this.summary ? this._renderSummary() : this._renderEmpty()}
      </div>
    `;
  }

  private _renderSummary() {
    const s = this.summary!;
    return html`
      <div class="summary-section">
        <div class="section-label">对话摘要</div>
        <div class="section-content">
          ${
            s.textSummary ??
            html`
              <span class="empty-hint">暂无对话内容</span>
            `
          }
        </div>
      </div>
      <div class="summary-section">
        <div class="section-label">工具调用摘要</div>
        <div class="section-content">
          ${
            s.toolSummary ??
            html`
              <span class="empty-hint">暂无工具调用</span>
            `
          }
        </div>
      </div>
      <div class="generated-at">
        生成于 ${new Date(s.generatedAt).toLocaleString()}
      </div>
    `;
  }

  private _renderEmpty() {
    return html`
      <div class="summary-section">
        <div class="section-content empty-hint">尚未生成摘要，点击"生成摘要"按钮生成</div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "summary-panel": SummaryPanel;
  }
}
