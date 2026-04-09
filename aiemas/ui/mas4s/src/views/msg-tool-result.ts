import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { markdownMath } from "../lib/markdown-directive.js";
import type { ChatMessage, MessageContentItem } from "../types/chat-types.js";
import "./msg-tool-card.js";

/**
 * 工具输出气泡（黑色/灰色渐变头像，齿轮图标）。
 * 专门用于渲染 role: "tool" 的消息。
 */
@customElement("msg-tool-result")
export class MsgToolResult extends LitElement {
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
      margin: 0 16px 0 0;
      flex-shrink: 0;
      box-shadow: 0 4px 14px rgba(71, 85, 105, 0.3);
      background: linear-gradient(135deg, #64748b 0%, #334155 100%);
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
    }

    .message-name {
      font-size: 13px;
      color: #475569;
      margin-bottom: 6px;
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

    .tool-label-tag {
      background: #f1f5f9;
      color: #475569;
      border: 1px solid #e2e8f0;
      border-radius: 4px;
      padding: 1px 5px;
      font-size: 10px;
      font-weight: 600;
    }

    .message-bubble {
      padding: 12px 16px;
      border-radius: 16px;
      border-top-left-radius: 4px;
      font-size: 13px;
      line-height: 1.5;
      color: #334155;
      position: relative;
    }

    .copy-btn {
      position: absolute;
      right: 8px;
      top: 8px;
      opacity: 0;
      transition: all 0.2s;
      z-index: 5;
    }

    .copy-full-btn {
      position: absolute;
      right: -32px;
      bottom: 0;
      opacity: 0;
      transition: all 0.2s;
      z-index: 5;
    }

    .message-row:hover .copy-btn,
    .message-row:hover .copy-full-btn {
      opacity: 1;
    }

    .tool-cards {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
  `;

  private _renderContent(items: MessageContentItem[]) {
    // 渲染工具执行的相关条目
    return html`${items.map((item) => {
      if (item.type === "tool_call" || item.type === "tool_result") {
        return html`
          <div class="tool-cards">
            <msg-tool-card .item=${item}></msg-tool-card>
          </div>
        `;
      }
      if (item.type === "text") {
        const text = (item.text ?? "").trim();
        const toolTitle = `ToolResult: ${this.message.toolName || "Tool"}`;
        return html`
          <div class="message-bubble">
            ${markdownMath(text)}
            <copy-button class="copy-btn" .value=${text} title="仅复制内容"></copy-button>
            <copy-button
              class="copy-full-btn"
              .value=${`${toolTitle}\n${text}`}
              title="复制标题和内容"
            ></copy-button>
          </div>
        `;
      }
      return nothing;
    })}`;
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
          <!-- 齿轮/设置图标 -->
          <svg
            class="avatar-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
            />
            <circle cx="12" cy="12" r="3" />
          </svg>
        </div>
        <div class="message-content">
          <div class="message-name">
            ToolResult: ${this.message.toolName || "Tool"}
            ${timeStr ? html`<span class="message-time">${timeStr}</span>` : nothing}
          </div>
          ${this._renderContent(this.message.content)}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "msg-tool-result": MsgToolResult;
  }
}
