import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import { markdownMath } from "../lib/markdown-directive.js";
import "../components/copy-button.js";
import type { ChatMessage } from "../types/chat-types.js";

/**
 * Agent-to-Agent 输入消息气泡（右对齐，琥珀/橙色系）。
 * 用于渲染来自其他 Agent 通过 aiemas_sessions_send 发送的消息（role="agent"）。
 *
 * 色系选择：琥珀/橙色 — 与蓝色(用户)、绿色(Agent回复/工具)、灰色(assistant)均有明显区分。
 */
@customElement("msg-agent-input")
export class MsgAgentInput extends LitElement {
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

    .agent-badge {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      font-size: 11px;
      color: #fff;
      background: #16a34a;
      border-radius: 4px;
      padding: 2px 8px;
      font-weight: 600;
      letter-spacing: 0.5px;
    }

    .badge-icon {
      display: inline-flex;
    }

    .message-time {
      font-size: 11px;
      color: #94a3b8;
      font-variant-numeric: tabular-nums;
      font-weight: 400;
    }

    .message-bubble {
      padding: 12px 16px;
      border-radius: 20px 20px 4px 20px;
      font-size: 14px;
      line-height: 1.5;
      word-break: break-word;
      overflow-wrap: break-word;
      background: #dbeafe;
      color: #1e293b;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
      position: relative;
    }

    .copy-btn {
      position: absolute;
      left: -32px;
      bottom: 0;
      opacity: 0;
      transition: all 0.2s;
      z-index: 5;
    }

    .message-row:hover .copy-btn {
      opacity: 1;
    }

    /* Markdown resets for A2A bubble */
    .message-bubble p {
      margin: 0 0 0.5em;
    }
    .message-bubble p:last-child {
      margin-bottom: 0;
    }
    .message-bubble a {
      color: #2563eb;
      text-decoration: underline;
    }
    .message-bubble code {
      background: rgba(37, 99, 235, 0.1);
      border-radius: 4px;
      padding: 1px 5px;
      font-size: 0.88em;
      font-family: ui-monospace, monospace;
    }
    .message-bubble pre {
      background: rgba(0, 0, 0, 0.05);
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
      border-left: 3px solid rgba(37, 99, 235, 0.4);
      margin: 0.5em 0;
      padding: 2px 10px;
      opacity: 0.85;
    }
    .message-bubble table {
      border-collapse: collapse;
      width: 100%;
      margin: 0.6em 0;
      font-size: 0.9em;
    }
    .message-bubble th,
    .message-bubble td {
      border: 1px solid rgba(37, 99, 235, 0.15);
      padding: 6px 10px;
    }
    .message-bubble th {
      background: rgba(37, 99, 235, 0.06);
      font-weight: 600;
    }

    .message-avatar {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #64748b;
      font-size: 18px;
      margin: 0 0 0 16px;
      flex-shrink: 0;
      background: #f1f5f9;
    }
  `;

  render() {
    const text = this.message.content
      .filter((c) => c.type === "text")
      .map((c) => c.text ?? "")
      .join("");
    const name = this.message.senderLabel ?? "Agent";
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
            ${name}
            <span class="agent-badge">
              <span class="badge-icon">
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.5"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <path d="M5 12h14"></path>
                  <path d="m12 5 7 7-7 7"></path>
                </svg>
              </span>
              A2A
            </span>
            ${timeStr ? html`<span class="message-time">${timeStr}</span>` : nothing}
          </div>
          ${text.trim()
            ? html`
                <div class="message-bubble">
                  ${markdownMath(text.trim())}
                  <copy-button
                    class="copy-btn"
                    .value=${text.trim()}
                    title="复制消息内容"
                  ></copy-button>
                </div>
              `
            : nothing}
        </div>
        <div class="message-avatar">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M12 8V4H8"></path>
            <rect width="16" height="12" x="4" y="8" rx="2"></rect>
            <path d="M2 14h2"></path>
            <path d="M20 14h2"></path>
            <path d="M15 13v2"></path>
            <path d="M9 13v2"></path>
          </svg>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "msg-agent-input": MsgAgentInput;
  }
}
