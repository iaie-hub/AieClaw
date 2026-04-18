import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { markdownMath } from "../lib/markdown-directive.js";
import type { ChatMessage } from "../types/chat-types.js";
import "./msg-tool-card.js";

/**
 * 系统级执行报告气泡。
 * 专门用于渲染 subType: "execution-followup" 的 system 消息。
 */
@customElement("msg-system-card")
export class MsgSystemCard extends LitElement {
  @property({ attribute: false }) message!: ChatMessage;

  /** 提示词（Prompt）是否展开 */
  @state() private _promptExpanded = false;
  /** 执行结果（Result）是否展开 */
  @state() private _resultExpanded = false;

  static styles = css`
    :host {
      display: block;
    }

    .message-row {
      display: flex;
      margin-bottom: 30px;
      animation: slideUp 0.4s ease-out forwards;
      opacity: 0;
      transform: translateY(10px);
    }

    @keyframes slideUp {
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .message-avatar {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #fff;
      margin: 0 16px 0 0;
      flex-shrink: 0;
      box-shadow: 0 4px 14px rgba(15, 23, 42, 0.2);
      background: linear-gradient(135deg, #475569 0%, #1e293b 100%);
    }

    .avatar-icon {
      width: 22px;
      height: 22px;
      opacity: 0.95;
    }

    .message-content {
      width: 100%;
      max-width: calc(100% - 80px);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .message-header {
      font-size: 13px;
      color: #475569;
      margin-bottom: -4px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .message-time {
      font-size: 11px;
      color: #94a3b8;
      font-variant-numeric: tabular-nums;
      font-weight: 400;
    }

    .system-card {
      width: 100%;
      border: 1px solid #cbd5e1;
      border-radius: 10px;
      overflow: hidden;
      font-size: 13px;
      background: #f8fafc;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05);
    }

    .card-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 7px 12px;
      font-weight: 600;
      color: #334155;
      background: #f1f5f9;
      cursor: pointer;
      user-select: none;
    }

    .system-card:not(.is-expanded) .card-header {
      border-bottom: none;
    }

    .system-card.is-expanded .card-header {
      border-bottom: 1px solid #e2e8f0;
    }

    .tool-name-tag {
      font-family: "SF Mono", "Fira Code", monospace;
      font-size: 12px;
      color: #475569;
      background: #e2e8f0;
      padding: 1px 4px;
      border-radius: 4px;
    }

    .status-badge {
      font-size: 10px;
      font-weight: 600;
      padding: 1px 5px;
      border-radius: 4px;
      background: #dcfce7;
      color: #15803d;
      margin-left: 4px;
    }

    .toggle-icon {
      font-size: 10px;
      color: #94a3b8;
      margin-left: auto;
      transition: transform 0.2s ease;
    }

    .toggle-icon.is-expanded {
      transform: rotate(180deg);
    }

    .card-body {
      padding: 12px;
      animation: fadeInDown 0.2s ease-out;
      background: #fff;
    }

    @keyframes fadeInDown {
      from {
        opacity: 0;
        transform: translateY(-4px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .section-label {
      font-size: 11px;
      font-weight: 700;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 4px;
    }

    .prompt-section {
      margin-bottom: 16px;
    }

    .prompt-content {
      font-size: 12px;
      color: #64748b;
      font-style: italic;
      line-height: 1.5;
      background: #f8fafc;
      padding: 8px 12px;
      border-radius: 6px;
      border-left: 3px solid #cbd5e1;
    }

    .result-content {
      font-size: 13px;
      line-height: 1.5;
      color: #334155;
    }

    .result-content :first-child {
      margin-top: 0;
    }
    .result-content :last-child {
      margin-bottom: 0;
    }

    .collapsible-section {
      width: 100%;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      margin-bottom: 8px;
      overflow: hidden;
    }

    .section-header {
      padding: 6px 12px;
      background: #f8fafc;
      display: flex;
      align-items: center;
      cursor: pointer;
      user-select: none;
      font-size: 12px;
      font-weight: 500;
      color: #475569;
    }

    .section-header:hover {
      background: #f1f5f9;
    }

    .section-body {
      padding: 12px;
      border-top: 1px solid #e2e8f0;
    }
  `;

  private _togglePrompt = (e: Event) => {
    e.stopPropagation();
    this._promptExpanded = !this._promptExpanded;
  };

  private _toggleResult = (e: Event) => {
    e.stopPropagation();
    this._resultExpanded = !this._resultExpanded;
  };

  private _renderMessageContent() {
    const promptItems = this.message.content.filter((c) => c.type === "text") as Array<{
      type: "text";
      text: string;
    }>;
    const resultItem = this.message.content.find((c) => c.type === "tool_result") as
      | { type: "tool_result"; text: string; isError?: boolean }
      | undefined;

    return html`
      <!-- 指令部分 (Prompt) -->
      ${promptItems.length > 0
        ? html`
            <div class="collapsible-section">
              <div class="section-header" @click=${this._togglePrompt}>
                <span style="margin-right: 6px;">💡</span>
                <span>System Instructions</span>
                <span class="toggle-icon ${this._promptExpanded ? "is-expanded" : ""}">▼</span>
              </div>
              ${this._promptExpanded
                ? html`
                    <div class="section-body">
                      <div class="prompt-content">
                        ${promptItems.map(
                          (item) =>
                            html`<div style="margin-bottom: 8px;">${markdownMath(item.text)}</div>`,
                        )}
                      </div>
                    </div>
                  `
                : nothing}
            </div>
          `
        : nothing}

      <!-- 结果部分 (Execution Result) -->
      <div class="system-card ${this._resultExpanded ? "is-expanded" : ""}">
        <div class="card-header" @click=${this._toggleResult}>
          <span class="tool-icon">📋</span>
          <span>Execution Result:</span>
          <span class="tool-name-tag">${this.message.toolName || "exec"}</span>
          <span class="status-badge">已完成</span>
          <span class="toggle-icon ${this._resultExpanded ? "is-expanded" : ""}">▼</span>
        </div>
        ${this._resultExpanded
          ? html`
              <div class="card-body">
                <div class="result-content">
                  ${resultItem
                    ? markdownMath(resultItem.text || "")
                    : html`<p>调用已成功结束。</p>`}
                </div>
              </div>
            `
          : nothing}
      </div>
    `;
  }

  render() {
    const ts = this.message.timestamp;
    const timeStr = ts
      ? (() => {
          const d = new Date(ts);
          const p = (n: number) => String(n).padStart(2, "0");
          return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
        })()
      : "";

    return html`
      <div class="message-row">
        <div class="message-avatar">
          <!-- 系统标识图标 (Terminal/Command) -->
          <svg
            class="avatar-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <polyline points="4 17 10 11 4 5"></polyline>
            <line x1="12" y1="19" x2="20" y2="19"></line>
          </svg>
        </div>
        <div class="message-content">
          <div class="message-header">
            System Followup
            ${timeStr ? html`<span class="message-time">${timeStr}</span>` : nothing}
          </div>
          ${this._renderMessageContent()}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "msg-system-card": MsgSystemCard;
  }
}
