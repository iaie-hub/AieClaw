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
      margin: 0 16px 0 0;
      flex-shrink: 0;
      box-shadow: 0 4px 14px rgba(16, 185, 129, 0.35);
      background: linear-gradient(135deg, #10b981 0%, #059669 100%);
      /* SVG icon instead of emoji */
    }

    .avatar-icon {
      width: 22px;
      height: 22px;
      opacity: 0.95;
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

    .message-time {
      font-size: 11px;
      color: #94a3b8;
      font-variant-numeric: tabular-nums;
      font-weight: 400;
    }

    .agent-tag {
      background: #d1fae5;
      color: #059669;
      border-radius: 4px;
      padding: 1px 5px;
      font-size: 10px;
      font-weight: 600;
    }

    .tool-tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: #fef3c7;
      color: #92400e;
      border: 1px solid #fde68a;
      border-radius: 4px;
      padding: 1px 6px;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.02em;
    }

    .tool-tag-icon {
      font-size: 11px;
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
      word-break: break-word;
      border-top: 1px solid #d1fae5;
    }

    /* Markdown styles inside thinking block */
    .thinking-body p {
      margin: 0 0 0.5em;
    }
    .thinking-body p:last-child {
      margin-bottom: 0;
    }
    .thinking-body h1,
    .thinking-body h2,
    .thinking-body h3,
    .thinking-body h4 {
      margin: 0.6em 0 0.3em;
      font-weight: 600;
    }
    .thinking-body ul,
    .thinking-body ol {
      margin: 0.3em 0;
      padding-left: 1.4em;
    }
    .thinking-body li {
      margin: 0.15em 0;
    }
    .thinking-body code {
      background: #ecfdf5;
      border: 1px solid #d1fae5;
      border-radius: 3px;
      padding: 1px 4px;
      font-size: 0.87em;
      font-family: ui-monospace, monospace;
    }
    .thinking-body pre {
      background: #f0fdf4;
      border: 1px solid #d1fae5;
      border-radius: 6px;
      padding: 8px 12px;
      overflow-x: auto;
      margin: 0.5em 0;
    }
    .thinking-body pre code {
      background: none;
      border: none;
      padding: 0;
    }
    .thinking-body blockquote {
      border-left: 3px solid #10b981;
      margin: 0.5em 0;
      padding: 3px 10px;
      color: #64748b;
      background: #f0fdf4;
      border-radius: 0 4px 4px 0;
    }
    .thinking-body strong {
      font-weight: 600;
    }
    .thinking-body em {
      font-style: italic;
    }
    .thinking-body table {
      border-collapse: collapse;
      width: 100%;
      margin: 0.5em 0;
      font-size: 0.9em;
    }
    .thinking-body th,
    .thinking-body td {
      border: 1px solid #d1fae5;
      padding: 4px 8px;
    }
    .thinking-body th {
      background: #ecfdf5;
      font-weight: 600;
    }
  `;

  private _renderContent(items: MessageContentItem[]) {
    return html`${items.map((item) => {
      if (item.type === "thinking") {
        const rawThinking = item.thinking ?? item.text ?? "";
        if (!rawThinking.trim()) {
          return nothing;
        }

        // 格式化思考内容：对齐流式输出格式 "Reasoning:\n_line1_\n_line2_"
        const thinkingText = (() => {
          const trimmed = rawThinking.trim();
          if (trimmed.startsWith("Reasoning:")) {
            return trimmed;
          }
          const italicLines = trimmed
            .split("\n")
            .map((line) => (line ? `_${line}_` : line))
            .join("\n");
          return `Reasoning:\n${italicLines}`;
        })();

        return html`
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
            ${this._thinkingExpanded
              ? html`<div class="thinking-body">${markdownMath(thinkingText)}</div>`
              : nothing}
          </div>
        `;
      }

      if (item.type === "text") {
        const text = item.text ?? "";
        if (!text.trim()) {
          return nothing;
        }
        return html`<div class="message-bubble">${markdownMath(text)}</div>`;
      }

      if (item.type === "tool_call" || item.type === "tool_result") {
        return html`
          <div class="tool-cards">
            <msg-tool-card .item=${item}></msg-tool-card>
          </div>
        `;
      }

      return nothing;
    })}`;
  }

  render() {
    const name = this.message.senderLabel ?? "Agent";
    const ts = this.message.timestamp;
    const timeStr = ts
      ? (() => {
          const d = new Date(ts);
          const p = (n: number) => String(n).padStart(2, "0");
          return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
        })()
      : "";

    // 判断消息是否包含工具调用/结果，用于显示 Tool 标签
    const hasTool = this.message.content.some(
      (c) => c.type === "tool_call" || c.type === "tool_result",
    );

    return html`
      <div class="message-row">
        <div class="message-avatar">
          <!-- 机器人/AI SVG 图标 -->
          <svg
            class="avatar-icon"
            viewBox="0 0 24 24"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect
              x="3"
              y="8"
              width="18"
              height="12"
              rx="3"
              fill="rgba(255,255,255,0.25)"
              stroke="white"
              stroke-width="1.5"
            />
            <circle cx="9" cy="14" r="2" fill="white" />
            <circle cx="15" cy="14" r="2" fill="white" />
            <path d="M9 8V6" stroke="white" stroke-width="1.5" stroke-linecap="round" />
            <path d="M15 8V6" stroke="white" stroke-width="1.5" stroke-linecap="round" />
            <circle cx="9" cy="5" r="1" fill="white" />
            <circle cx="15" cy="5" r="1" fill="white" />
            <path d="M12 6V4" stroke="white" stroke-width="1.5" stroke-linecap="round" />
            <circle cx="12" cy="3" r="1.2" fill="white" />
            <path d="M7 20v1M17 20v1" stroke="white" stroke-width="1.5" stroke-linecap="round" />
          </svg>
        </div>
        <div class="message-content">
          <div class="message-name">
            ${name}
            ${hasTool
              ? html` <span class="tool-tag"> <span class="tool-tag-icon">⚡</span>Tool </span> `
              : nothing}
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
    "msg-agent": MsgAgent;
  }
}
