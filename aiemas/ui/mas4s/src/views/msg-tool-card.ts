import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { markdownMath } from "../lib/markdown-directive.js";
import type { MessageContentItem } from "../types/chat-types.js";

/** 工具调用/结果卡片（tool_call / tool_result）。默认折叠，点击 header 展开/收起。 */
@customElement("msg-tool-card")
export class MsgToolCard extends LitElement {
  @property({ attribute: false }) item!: MessageContentItem;

  /** body 是否展开，默认折叠 */
  @state() private _expanded = false;

  static styles = css`
    :host {
      display: block;
      margin-top: 8px;
    }

    .tool-card {
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      overflow: hidden;
      font-size: 13px;
      background: #f8fafc;
    }

    .tool-card--call {
      border-color: #bfdbfe;
      background: #eff6ff;
    }

    .tool-card--result {
      border-color: #bbf7d0;
      background: #f0fdf4;
    }

    .tool-header {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 7px 12px;
      font-weight: 600;
      color: #1e293b;
      cursor: pointer;
      user-select: none;
    }

    .tool-header:hover {
      filter: brightness(0.97);
    }

    .tool-icon {
      font-size: 14px;
      flex-shrink: 0;
    }

    .tool-name {
      flex: 1;
      font-family: "SF Mono", "Fira Code", monospace;
      font-size: 12px;
      color: #1d4ed8;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .tool-card--result .tool-name {
      color: #15803d;
    }

    .tool-kind-tag {
      font-size: 10px;
      font-weight: 600;
      padding: 1px 5px;
      border-radius: 4px;
      flex-shrink: 0;
    }

    .tool-card--call .tool-kind-tag {
      background: #dbeafe;
      color: #1d4ed8;
    }

    .tool-card--result .tool-kind-tag {
      background: #dcfce7;
      color: #15803d;
    }

    .toggle-icon {
      font-size: 10px;
      color: #94a3b8;
      flex-shrink: 0;
    }

    .tool-body {
      padding: 0 12px 10px;
      border-top: 1px solid #e2e8f0;
    }

    .tool-card--call .tool-body {
      border-color: #bfdbfe;
    }

    .tool-card--result .tool-body {
      border-color: #bbf7d0;
    }

    pre {
      margin: 8px 0 0;
      font-family: "SF Mono", "Fira Code", monospace;
      font-size: 12px;
      line-height: 1.6;
      white-space: pre-wrap;
      word-break: break-all;
      color: #334155;
      background: rgba(255, 255, 255, 0.6);
      border-radius: 6px;
      padding: 8px 10px;
    }

    /* Markdown styles for tool result body */
    .tool-result-body {
      margin: 8px 0 0;
      font-size: 12px;
      line-height: 1.6;
      color: #334155;
      word-break: break-word;
    }
    .tool-result-body p {
      margin: 0 0 0.4em;
    }
    .tool-result-body p:last-child {
      margin-bottom: 0;
    }
    .tool-result-body h1,
    .tool-result-body h2,
    .tool-result-body h3 {
      margin: 0.5em 0 0.25em;
      font-weight: 600;
    }
    .tool-result-body ul,
    .tool-result-body ol {
      margin: 0.3em 0;
      padding-left: 1.3em;
    }
    .tool-result-body li {
      margin: 0.1em 0;
    }
    .tool-result-body code {
      background: rgba(255, 255, 255, 0.8);
      border: 1px solid #bbf7d0;
      border-radius: 3px;
      padding: 1px 4px;
      font-size: 0.87em;
      font-family: "SF Mono", "Fira Code", monospace;
    }
    .tool-result-body pre {
      background: rgba(255, 255, 255, 0.7);
      border: 1px solid #bbf7d0;
      border-radius: 6px;
      padding: 7px 10px;
      overflow-x: auto;
      margin: 0.4em 0;
      font-family: "SF Mono", "Fira Code", monospace;
      font-size: 11px;
      white-space: pre-wrap;
      word-break: break-all;
    }
    .tool-result-body pre code {
      background: none;
      border: none;
      padding: 0;
    }
    .tool-result-body blockquote {
      border-left: 3px solid #4ade80;
      margin: 0.4em 0;
      padding: 2px 8px;
      color: #475569;
      background: rgba(255, 255, 255, 0.5);
      border-radius: 0 4px 4px 0;
    }
    .tool-result-body strong {
      font-weight: 600;
    }
    .tool-result-body em {
      font-style: italic;
    }
    .tool-result-body table {
      border-collapse: collapse;
      width: 100%;
      margin: 0.4em 0;
      font-size: 0.9em;
    }
    .tool-result-body th,
    .tool-result-body td {
      border: 1px solid #bbf7d0;
      padding: 3px 7px;
    }
    .tool-result-body th {
      background: rgba(255, 255, 255, 0.6);
      font-weight: 600;
    }

    .expand-btn {
      margin-top: 6px;
      background: none;
      border: none;
      cursor: pointer;
      font-size: 12px;
      color: #3b82f6;
      padding: 0;
    }

    .expand-btn:hover {
      text-decoration: underline;
    }
  `;

  private _toggleBody = () => {
    this._expanded = !this._expanded;
  };

  private _renderArgs(args: unknown): string {
    if (args == null) {
      return "";
    }
    if (typeof args === "string") {
      return args;
    }
    try {
      return JSON.stringify(args, null, 2);
    } catch {
      return Object.prototype.toString.call(args);
    }
  }

  render() {
    const isCall = this.item.type === "tool_call";
    const isResult = this.item.type === "tool_result";
    if (!isCall && !isResult) {
      return nothing;
    }

    const name = this.item.name ?? (isCall ? "tool_call" : "tool_result");
    const icon = isCall ? "⚙️" : "✅";
    const kindLabel = isCall ? "调用" : "结果";
    const cardClass = isCall ? "tool-card--call" : "tool-card--result";

    const bodyText = isCall ? this._renderArgs(this.item.args) : (this.item.text ?? "");
    const hasBody = bodyText.trim().length > 0;

    return html`
      <div class="tool-card ${cardClass}">
        <div class="tool-header" @click=${this._toggleBody}>
          <span class="tool-icon">${icon}</span>
          <span class="tool-name">${name}</span>
          <span class="tool-kind-tag">${kindLabel}</span>
          <span class="toggle-icon">${this._expanded ? "▲" : "▼"}</span>
        </div>
        ${this._expanded && hasBody
          ? html`
              <div class="tool-body">
                ${isCall
                  ? html`<pre>${bodyText}</pre>`
                  : html`<div class="tool-result-body">${markdownMath(bodyText)}</div>`}
              </div>
            `
          : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "msg-tool-card": MsgToolCard;
  }
}
