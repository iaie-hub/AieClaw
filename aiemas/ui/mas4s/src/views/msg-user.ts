import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
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
      max-width: 65%;
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

    .message-bubble {
      padding: 14px 18px;
      border-radius: 16px;
      border-top-right-radius: 4px;
      font-size: 14px;
      line-height: 1.6;
      word-break: break-word;
      background: linear-gradient(135deg, #3b82f6 0%, #6366f1 100%);
      color: #fff;
      box-shadow: 0 4px 12px rgba(59, 130, 246, 0.2);
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

    return html`
      <div class="message-row">
        <div class="message-content">
          <div class="message-name">
            ${name} <span class="check-icon">✓</span>
          </div>
          <div class="message-bubble">${text}</div>
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
