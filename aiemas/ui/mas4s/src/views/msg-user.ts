import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { markdownMath } from "../lib/markdown-directive.js";
import type { ChatMessage } from "../types/chat-types.js";

/**
 * 用户消息气泡（右对齐，蓝紫渐变）。
 */
@customElement("msg-user")
export class MsgUser extends LitElement {
  @property({ attribute: false }) message!: ChatMessage;

  static styles = css`
    :host {
      display: block;
    }

    .message-row {
      display: flex;
      justify-content: flex-end;
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

    .message-content {
      max-width: calc(100% - 80px);
      display: flex;
      flex-direction: column;
      align-items: flex-end;
    }

    .message-name {
      font-size: 13px;
      color: #64748b;
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .check-icon {
      color: #3b82f6;
      font-size: 12px;
    }

    .message-time {
      font-size: 11px;
      color: #94a3b8;
      font-variant-numeric: tabular-nums;
      font-weight: 400;
    }

    .message-bubble {
      padding: 14px 18px;
      border-radius: 16px;
      border-top-right-radius: 4px;
      font-size: 14px;
      line-height: 1.6;
      word-break: break-word;
      overflow-wrap: break-word;
      background: linear-gradient(135deg, #3b82f6 0%, #6366f1 100%);
      color: #fff;
      box-shadow: 0 4px 12px rgba(59, 130, 246, 0.2);
    }

    /* Markdown resets for white-on-blue bubble */
    .message-bubble p {
      margin: 0 0 0.5em;
    }
    .message-bubble p:last-child {
      margin-bottom: 0;
    }
    .message-bubble a {
      color: #bfdbfe;
    }
    .message-bubble code {
      background: rgba(255, 255, 255, 0.15);
      border-radius: 4px;
      padding: 1px 5px;
      font-size: 0.88em;
      font-family: ui-monospace, monospace;
    }
    .message-bubble pre {
      background: rgba(0, 0, 0, 0.2);
      border-radius: 8px;
      padding: 10px 14px;
      margin: 0.5em 0;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .message-bubble pre code {
      background: none;
      padding: 0;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .message-bubble ul,
    .message-bubble ol {
      margin: 0.4em 0;
      padding-left: 1.4em;
    }
    .message-bubble li {
      margin: 0.2em 0;
    }
    .message-bubble strong {
      font-weight: 600;
    }
    .message-bubble blockquote {
      border-left: 3px solid rgba(255, 255, 255, 0.5);
      margin: 0.5em 0;
      padding: 2px 10px;
      opacity: 0.85;
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
      margin: 0 0 0 16px;
      flex-shrink: 0;
      box-shadow: 0 4px 10px rgba(0, 0, 0, 0.08);
      background: linear-gradient(135deg, #3b82f6 0%, #6366f1 100%);
    }
  `;

  render() {
    const text = this.message.content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("");
    const name = this.message.senderLabel ?? "You";
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
        <div class="message-content">
          <div class="message-name">
            ${name} ${timeStr ? html`<span class="message-time">${timeStr}</span>` : nothing}
          </div>
          ${text.trim()
            ? html`<div class="message-bubble">${markdownMath(text.trim())}</div>`
            : nothing}
        </div>
        <div class="message-avatar">👤</div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "msg-user": MsgUser;
  }
}
