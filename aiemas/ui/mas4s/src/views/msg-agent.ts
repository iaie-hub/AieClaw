import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { ChatMessage } from "../types/chat-types.js";

/**
 * Agent 消息气泡（左对齐，绿色渐变头像）。
 * 第一期：推理折叠块占位（第二期实现）。
 */
@customElement("msg-agent")
export class MsgAgent extends LitElement {
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
  `;

  render() {
    const text = this.message.content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("");
    const name = this.message.senderLabel ?? "Agent";

    return html`
      <div class="message-row">
        <div class="message-avatar">🤖</div>
        <div class="message-content">
          <div class="message-name">
            ${name}
            <span class="agent-tag">Agent</span>
          </div>
          <!-- 第二期：reasoning-block 占位 -->
          <div class="message-bubble">${text}</div>
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
