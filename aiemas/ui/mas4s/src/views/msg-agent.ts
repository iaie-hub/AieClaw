import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { markdownMath } from "../lib/markdown-directive.js";
import type { ChatMessage, MessageContentItem } from "../types/chat-types.js";
import "./msg-tool-card.js";

/**
 * Agent 消息气泡（左对齐，绿色渐变头像）。
 * 渲染文本内容 + tool_call / tool_result 卡片。
 */
@customElement("msg-agent")
export class MsgAgent extends LitElement {
  @property({ attribute: false }) message!: ChatMessage;
  @state() private _thinkingExpanded = false;

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
      font-size: 18px;
      margin: 0 16px 0 0;
      flex-shrink: 0;
      box-shadow: 0 4px 10px rgba(0, 0, 0, 0.08);
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
    }

    .message-content {
      max-width: 65%;
      display: flex;
      flex-direction: column;
    }

    .message-name {
      font-size: 13px;
      color: #059669;
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .agent-tag {
      background: #d1fae5;
      color: #059669;
      border-radius: 4px;
      padding: 1px 5px;
      font-size: 10px;
      font-weight: 600;
    }

    .message-bubble {
      padding: 14px 18px;
      border-radius: 16px;
      border-top-left-radius: 4px;
      font-size: 14px;
      line-height: 1.6;
      word-break: break-word;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      color: #1e293b;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
    }

    /* Markdown content styles */
    .message-bubble p {
      margin: 0 0 0.6em;
    }
    .message-bubble p:last-child {
      margin-bottom: 0;
    }
    .message-bubble h1,
    .message-bubble h2,
    .message-bubble h3,
    .message-bubble h4 {
      margin: 0.8em 0 0.4em;
      font-weight: 600;
      line-height: 1.3;
    }
    .message-bubble h1 {
      font-size: 1.2em;
    }
    .message-bubble h2 {
      font-size: 1.1em;
    }
    .message-bubble h3 {
      font-size: 1em;
    }
    .message-bubble ul,
    .message-bubble ol {
      margin: 0.4em 0;
      padding-left: 1.4em;
    }
    .message-bubble li {
      margin: 0.2em 0;
    }
    .message-bubble code {
      background: #f0fdf4;
      border: 1px solid #d1fae5;
      border-radius: 4px;
      padding: 1px 5px;
      font-size: 0.88em;
      font-family: ui-monospace, monospace;
    }
    .message-bubble pre {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 10px 14px;
      overflow-x: auto;
      margin: 0.6em 0;
    }
    .message-bubble pre code {
      background: none;
      border: none;
      padding: 0;
      font-size: 0.85em;
    }
    .message-bubble blockquote {
      border-left: 3px solid #10b981;
      margin: 0.6em 0;
      padding: 4px 12px;
      color: #475569;
      background: #f0fdf4;
      border-radius: 0 6px 6px 0;
    }
    .message-bubble a {
      color: #059669;
      text-decoration: underline;
    }
    .message-bubble strong {
      font-weight: 600;
    }
    .message-bubble em {
      font-style: italic;
    }
    .message-bubble hr {
      border: none;
      border-top: 1px solid #e2e8f0;
      margin: 0.8em 0;
    }
    .message-bubble table {
      border-collapse: collapse;
      width: 100%;
      margin: 0.6em 0;
      font-size: 0.9em;
    }
    .message-bubble th,
    .message-bubble td {
      border: 1px solid #e2e8f0;
      padding: 6px 10px;
      text-align: left;
    }
    .message-bubble th {
      background: #f0fdf4;
      font-weight: 600;
    }

    .tool-cards {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-top: 8px;
    }

    .thinking-block {
      margin-bottom: 6px;
      border: 1px solid #d1fae5;
      border-radius: 10px;
      overflow: hidden;
      font-size: 13px;
    }

    .thinking-toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 7px 12px;
      background: #f0fdf4;
      color: #059669;
      cursor: pointer;
      user-select: none;
      font-weight: 500;
    }

    .thinking-toggle:hover {
      background: #dcfce7;
    }

    .thinking-arrow {
      font-size: 10px;
      transition: transform 0.2s;
      display: inline-block;
    }

    .thinking-arrow.expanded {
      transform: rotate(90deg);
    }

    .thinking-body {
      padding: 10px 14px;
      background: #fafffe;
      color: #475569;
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-word;
      border-top: 1px solid #d1fae5;
    }
  `;

  private _renderContent(items: MessageContentItem[]) {
    const thinkingItems = items.filter((c) => c.type === "thinking");
    const textItems = items.filter((c) => c.type === "text");
    const toolItems = items.filter((c) => c.type === "tool_call" || c.type === "tool_result");

    const thinkingText = thinkingItems.map((c) => c.thinking ?? c.text ?? "").join("\n\n");
    const text = textItems.map((c) => c.text ?? "").join("");

    return html`
      ${
        thinkingText
          ? html`
            <div class="thinking-block">
              <div
                class="thinking-toggle"
                @click=${() => {
                  this._thinkingExpanded = !this._thinkingExpanded;
                }}
              >
                <span class="thinking-arrow ${this._thinkingExpanded ? "expanded" : ""}">▶</span>
                <span>思考过程</span>
              </div>
              ${
                this._thinkingExpanded
                  ? html`<div class="thinking-body">${thinkingText}</div>`
                  : nothing
              }
            </div>
          `
          : nothing
      }
      ${text.trim() ? html`<div class="message-bubble">${markdownMath(text)}</div>` : nothing}
      ${
        toolItems.length > 0
          ? html`
            <div class="tool-cards">
              ${toolItems.map((item) => html`<msg-tool-card .item=${item}></msg-tool-card>`)}
            </div>
          `
          : nothing
      }
    `;
  }

  render() {
    const name = this.message.senderLabel ?? "Agent";

    return html`
      <div class="message-row">
        <div class="message-avatar">🤖</div>
        <div class="message-content">
          <div class="message-name">
            ${name}
            <span class="agent-tag">Agent</span>
          </div>
          ${this._renderContent(this.message.content)}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "msg-agent": MsgAgent;
  }
}
