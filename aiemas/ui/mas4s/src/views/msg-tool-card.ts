import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { MessageContentItem } from "../types/chat-types.js";

/** 工具调用/结果卡片（tool_call / tool_result）。 */
@customElement("msg-tool-card")
export class MsgToolCard extends LitElement {
  @property({ attribute: false }) item!: MessageContentItem;

  /** 结果文本是否展开 */
  @state() private _expanded = false;

  /** 超过此长度折叠显示 */
  private static readonly PREVIEW_LEN = 200;

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
    const isLong = bodyText.length > MsgToolCard.PREVIEW_LEN;
    const displayText =
      isLong && !this._expanded ? bodyText.slice(0, MsgToolCard.PREVIEW_LEN) + "…" : bodyText;

    return html`
      <div class="tool-card ${cardClass}">
        <div class="tool-header" @click=${hasBody ? this._toggleBody : nothing}>
          <span class="tool-icon">${icon}</span>
          <span class="tool-name">${name}</span>
          <span class="tool-kind-tag">${kindLabel}</span>
          ${hasBody ? html`<span class="toggle-icon">${this._expanded ? "▲" : "▼"}</span>` : nothing}
        </div>
        ${
          hasBody && this._expanded
            ? html`
              <div class="tool-body">
                <pre>${displayText}</pre>
                ${
                  isLong
                    ? html`
                      <button class="expand-btn" @click=${this._toggleBody}>
                        ${this._expanded ? "收起" : "展开全部"}
                      </button>
                    `
                    : nothing
                }
              </div>
            `
            : nothing
        }
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "msg-tool-card": MsgToolCard;
  }
}
