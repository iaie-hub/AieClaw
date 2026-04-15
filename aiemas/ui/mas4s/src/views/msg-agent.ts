import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { extractAgentNameFromKey } from "../../../../src/utils/session-utils.js";
import { markdownMath } from "../lib/markdown-directive.js";
import "./msg-tool-card.js";
import "../components/copy-button.js";
import type { ChatMessage, MessageContentItem } from "../types/chat-types.js";

/** 检测文本末尾是否为疑问句（中英文问号），用于推断是否需要快捷回复按钮 */
function endsWithQuestion(text: string): boolean {
  const trimmed = text.trimEnd();
  return trimmed.endsWith("?") || trimmed.endsWith("？");
}

/** 根据问句内容推断合适的快捷回复选项 */
function inferQuickReplies(text: string): string[] {
  const t = text.toLowerCase();
  // 跳过/停止类
  if (t.includes("跳过") || t.includes("skip")) {
    return ["继续", "跳过", "停止"];
  }
  // 分析类
  if (t.includes("分析") || t.includes("analyz") || t.includes("deep")) {
    return ["继续分析", "跳过分析", "停止"];
  }
  // 默认：继续 / 停止
  return ["继续", "停止"];
}

/**
 * Agent 消息气泡（左对齐，绿色渐变头像）。
 * 渲染文本内容 + tool_call / tool_result 卡片。
 * isLatest=true 时，若末尾为疑问句则在气泡下方渲染快捷回复按钮。
 */
@customElement("msg-agent")
export class MsgAgent extends LitElement {
  @property({ attribute: false }) message!: ChatMessage;
  /** 是否为当前会话最新的 agent 消息（由 message-list 传入） */
  @property({ type: Boolean }) isLatest = false;
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
      color: #64748b;
      margin: 0 16px 0 0;
      flex-shrink: 0;
      background: #f1f5f9;
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

    .agent-tag {
      background: #f1f5f9;
      color: #64748b;
      border-radius: 4px;
      padding: 1px 5px;
      font-size: 10px;
      font-weight: 600;
    }

    .tool-tag {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: #f1f5f9;
      color: #64748b;
      border: 1px solid #e2e8f0;
      border-radius: 4px;
      padding: 1px 6px;
      font-size: 10px;
      font-weight: 600;
      letter-spacing: 0.02em;
    }

    .tool-tag-icon {
      font-size: 11px;
      color: #94a3b8;
    }

    .message-bubble {
      padding: 12px 16px;
      border-radius: 20px 20px 20px 4px;
      font-size: 14px;
      line-height: 1.5;
      word-break: break-word;
      background: #f1f5f9;
      border: none;
      color: #0f172a;
      box-shadow: 0 1px 1px rgba(0, 0, 0, 0.02);
      position: relative;
    }

    .copy-btn {
      position: absolute;
      right: -32px;
      bottom: 0;
      opacity: 0;
      transition: all 0.2s;
      z-index: 5;
    }

    .message-row:hover .copy-btn {
      opacity: 1;
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
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
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
      margin: 0.6em 0;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .message-bubble pre code {
      background: none;
      border: none;
      padding: 0;
      font-size: 0.85em;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .message-bubble blockquote {
      border-left: 3px solid #cbd5e1;
      margin: 0.6em 0;
      padding: 4px 12px;
      color: #475569;
      background: #f8fafc;
      border-radius: 0 6px 6px 0;
    }
    .message-bubble a {
      color: #1e293b;
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
      margin: 0.8em 0;
      font-size: 0.9em;
      font-family: "SF Mono", "Fira Code", monospace;
    }
    .message-bubble th,
    .message-bubble td {
      border: 1px solid var(--ai-border, #eef2f8);
      padding: 8px 12px;
      text-align: left;
    }
    .message-bubble table tbody tr:nth-child(even) {
      background: rgba(0, 0, 0, 0.02);
    }
    .message-bubble th {
      background: var(--ai-bg-body, #f8fafc);
      font-weight: 600;
    }

    .tool-cards {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-top: 8px;
    }

    .quick-replies {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 10px;
    }

    .quick-reply-btn {
      padding: 6px 16px;
      border-radius: 20px;
      border: 1.5px solid #cbd5e1;
      background: #ffffff;
      color: #475569;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s;
      font-family: inherit;
      line-height: 1.4;
    }

    .quick-reply-btn:hover {
      background: #f8fafc;
      border-color: #94a3b8;
      color: #1e293b;
      transform: translateY(-1px);
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.06);
    }

    .quick-reply-btn:active {
      transform: translateY(0);
    }

    .thinking-block {
      margin-bottom: 6px;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      overflow: hidden;
      font-size: 13px;
    }

    .thinking-toggle {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 7px 12px;
      background: #f8fafc;
      color: #64748b;
      cursor: pointer;
      user-select: none;
      font-weight: 500;
    }

    .thinking-toggle:hover {
      background: #f1f5f9;
    }

    .thinking-wrapper {
      position: relative;
    }

    .thinking-copy-btn {
      margin-left: auto;
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
      background: #fafafa;
      color: #475569;
      line-height: 1.6;
      word-break: break-word;
      border-top: 1px solid #e2e8f0;
    }

    .thinking-body-copy-btn {
      position: absolute;
      right: -30px;
      bottom: 8px;
      opacity: 0;
      transition: all 0.2s;
      z-index: 5;
    }

    .thinking-wrapper:hover .thinking-body-copy-btn {
      opacity: 1;
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
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      border-radius: 3px;
      padding: 1px 4px;
      font-size: 0.87em;
      font-family: ui-monospace, monospace;
    }
    .thinking-body pre {
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
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
      border-left: 3px solid #cbd5e1;
      margin: 0.5em 0;
      padding: 3px 10px;
      color: #64748b;
      background: #f8fafc;
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
      border: 1px solid #e2e8f0;
      padding: 4px 8px;
    }
    .thinking-body th {
      background: #f1f5f9;
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
          <div class="thinking-wrapper">
            <div class="thinking-block">
              <div
                class="thinking-toggle"
                @click=${() => {
                  this._thinkingExpanded = !this._thinkingExpanded;
                }}
              >
                <span class="thinking-arrow ${this._thinkingExpanded ? "expanded" : ""}">▶</span>
                <span>思考过程</span>
                <copy-button
                  class="thinking-copy-btn"
                  .value=${rawThinking}
                  title="仅复制内容"
                ></copy-button>
              </div>
              ${this._thinkingExpanded
                ? html`<div class="thinking-body">${markdownMath(thinkingText)}</div>`
                : nothing}
            </div>
            ${this._thinkingExpanded
              ? html`<copy-button
                  class="thinking-body-copy-btn"
                  .value=${`思考过程\n${rawThinking}`}
                  title="复制标题和内容"
                ></copy-button>`
              : nothing}
          </div>
        `;
      }

      if (item.type === "text") {
        const text = item.text ?? "";
        if (!text.trim()) {
          return nothing;
        }
        return html`
          <div class="message-bubble">
            ${markdownMath(text.trim())}
            <copy-button class="copy-btn" .value=${text.trim()} title="复制消息内容"></copy-button>
          </div>
        `;
      }

      if (item.type === "tool_call") {
        // 对于 aiemas_sessions_send，仅最新 agent 消息中的 tool_call 可能处于等待状态
        // 非最新消息的 tool_call 一定已完成
        const isSessionsSend = (item.name ?? "").includes("sessions_send");
        const hasResult = isSessionsSend ? !this.isLatest : true;
        return html`
          <div class="tool-cards">
            <msg-tool-card .item=${item} .hasResult=${hasResult}></msg-tool-card>
          </div>
        `;
      }

      return nothing;
    })}`;
  }

  private _onQuickReply(text: string) {
    this.dispatchEvent(
      new CustomEvent("quick-reply", {
        detail: { text },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _renderQuickReplies() {
    if (!this.isLatest) {
      return nothing;
    }

    // 找最后一条 text 类型 content item
    const textItems = this.message.content.filter((c) => c.type === "text" && c.text?.trim());
    const lastText = textItems[textItems.length - 1]?.text ?? "";
    if (!endsWithQuestion(lastText)) {
      return nothing;
    }

    const replies = inferQuickReplies(lastText);
    return html`
      <div class="quick-replies">
        ${replies.map(
          (r) => html`
            <button class="quick-reply-btn" @click=${() => this._onQuickReply(r)}>${r}</button>
          `,
        )}
      </div>
    `;
  }

  render() {
    const agentName = this.message.sessionKey
      ? extractAgentNameFromKey(this.message.sessionKey)
      : (this.message.senderLabel ?? "Agent");
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
              fill="none"
              stroke="currentColor"
              stroke-width="1.5"
            />
            <circle cx="9" cy="14" r="2" fill="currentColor" />
            <circle cx="15" cy="14" r="2" fill="currentColor" />
            <path d="M9 8V6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
            <path d="M15 8V6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
            <circle cx="9" cy="5" r="1" fill="currentColor" />
            <circle cx="15" cy="5" r="1" fill="currentColor" />
            <path d="M12 6V4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" />
            <circle cx="12" cy="3" r="1.2" fill="currentColor" />
            <path
              d="M7 20v1M17 20v1"
              stroke="currentColor"
              stroke-width="1.5"
              stroke-linecap="round"
            />
          </svg>
        </div>
        <div class="message-content">
          <div class="message-name">
            Agent: ${agentName}
            ${timeStr ? html`<span class="message-time">${timeStr}</span>` : nothing}
          </div>
          ${this._renderContent(this.message.content)} ${this._renderQuickReplies()}
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
