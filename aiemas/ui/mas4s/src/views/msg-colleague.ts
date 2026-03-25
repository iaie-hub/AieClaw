import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
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
          ${text.trim() ? html`<div class="message-bubble">${text}</div>` : nothing}
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
