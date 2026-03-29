import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { markdownMath } from "../lib/markdown-directive.js";
import type { ChatMessage } from "../types/chat-types.js";

/**
 * 同事消息气泡（左对齐，琥珀渐变头像）。
 */
@customElement("msg-colleague")
export class MsgColleague extends LitElement {
  @property({ attribute: false }) message!: ChatMessage;

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
      font-size: 15px;
      font-weight: 700;
      margin: 0 16px 0 0;
      flex-shrink: 0;
      box-shadow: 0 4px 10px rgba(0, 0, 0, 0.08);
      background: linear-gradient(135deg, #f59e0b 0%, #d97706 100%);
    }

    .message-content {
      max-width: 65%;
      display: flex;
      flex-direction: column;
    }

    .message-name {
      font-size: 13px;
      color: #64748b;
      margin-bottom: 6px;
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

    /* Markdown styles */
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
    .message-bubble ul,
    .message-bubble ol {
      margin: 0.4em 0;
      padding-left: 1.4em;
    }
    .message-bubble li {
      margin: 0.2em 0;
    }
    .message-bubble code {
      background: #fef9c3;
      border: 1px solid #fde68a;
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
      border-left: 3px solid #f59e0b;
      margin: 0.6em 0;
      padding: 4px 12px;
      color: #475569;
      background: #fffbeb;
      border-radius: 0 6px 6px 0;
    }
    .message-bubble strong {
      font-weight: 600;
    }
    .message-bubble em {
      font-style: italic;
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
    }
    .message-bubble th {
      background: #fffbeb;
      font-weight: 600;
    }
  `;

  render() {
    const text = this.message.content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("");
    const name = this.message.senderLabel ?? "同事";
    // 取姓氏首字作为头像
    const avatarChar = name.charAt(0).toUpperCase();

    return html`
      <div class="message-row">
        <div class="message-avatar">${avatarChar}</div>
        <div class="message-content">
          <div class="message-name">${name}</div>
          ${text.trim() ? html`<div class="message-bubble">${markdownMath(text)}</div>` : nothing}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "msg-colleague": MsgColleague;
  }
}
