import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { ApprovalRequest } from "../types/approval-types.js";
import type { ChatMessage } from "../types/chat-types.js";
import "./msg-user.js";
import "./msg-colleague.js";
import "./msg-agent.js";
import "./msg-pending.js";

/**
 * 消息列表：根据 role 和 subType 分发渲染对应消息组件。
 */
@customElement("message-list")
export class MessageList extends LitElement {
  @property({ attribute: false }) messages: ChatMessage[] = [];
  @property({ attribute: false }) pendingApprovals: ApprovalRequest[] = [];
  @property({ type: Boolean }) isInitiator = false;

  static styles = css`
    :host {
      display: block;
    }
  `;

  private _renderMessage(msg: ChatMessage) {
    if (msg.subType === "colleague") {
      return html`<msg-colleague .message=${msg}></msg-colleague>`;
    }
    if (msg.subType === "pending") {
      // pending 消息需要对应的 ApprovalRequest
      const approval = this.pendingApprovals.find((a) => a.id === msg.id);
      if (approval) {
        return html`<msg-pending .approval=${approval} .isInitiator=${this.isInitiator}></msg-pending>`;
      }
      return html``;
    }
    if (msg.role === "user" || msg.role === "User") {
      return html`<msg-user .message=${msg}></msg-user>`;
    }
    if (msg.role === "assistant" || msg.role === "toolResult" || msg.role === "tool") {
      return html`<msg-agent .message=${msg}></msg-agent>`;
    }
    // 其他 role（tool、system 等）暂不渲染
    return html``;
  }

  render() {
    return html`${this.messages.map((msg) => this._renderMessage(msg))}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "message-list": MessageList;
  }
}
