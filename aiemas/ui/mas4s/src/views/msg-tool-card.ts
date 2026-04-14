import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { markdownMath } from "../lib/markdown-directive.js";
import "../components/copy-button.js";
import type { MessageContentItem } from "../types/chat-types.js";

/** 工具调用/结果卡片（tool_call / tool_result）。默认折叠，点击 header 展开/收起。 */
@customElement("msg-tool-card")
export class MsgToolCard extends LitElement {
  @property({ attribute: false }) item!: MessageContentItem;

  /** 该 ToolCall 是否已有对应的 ToolResult（由父组件传入） */
  @property({ type: Boolean }) hasResult = false;

  /** body 是否展开，默认折叠 */
  @state() private _expanded = false;

  /** 等待计时器（秒） */
  @state() private _elapsedSeconds = 0;
  private _timerHandle: ReturnType<typeof setInterval> | null = null;
  private _startTime = 0;

  static styles = css`
    :host {
      display: block;
      margin-top: 8px;
    }

    .tool-card {
      width: 100%;
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

    .tool-card--error {
      border-color: #fecaca;
      background: #fef2f2;
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
      white-space: normal;
      word-break: break-all;
    }

    .tool-card--result .tool-name {
      color: #15803d;
    }

    .tool-card--error .tool-name {
      color: #dc2626;
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

    .tool-card--error .tool-kind-tag {
      background: #fee2e2;
      color: #dc2626;
    }

    .toggle-icon {
      font-size: 10px;
      color: #94a3b8;
      flex-shrink: 0;
      transition: transform 0.2s ease;
      display: inline-block;
    }

    .toggle-icon.is-expanded {
      transform: rotate(180deg);
    }

    .tool-copy-btn {
      margin-left: auto;
    }

    .tool-card-wrapper {
      position: relative;
    }

    .tool-body {
      padding: 0 12px 12px;
      border-top: 1px solid #e2e8f0;
      animation: fadeInDown 0.2s ease-out;
    }

    .tool-body-copy-btn {
      position: absolute;
      right: -30px;
      bottom: 8px;
      opacity: 0;
      transition: all 0.2s;
      z-index: 5;
    }

    .tool-card-wrapper:hover .tool-body-copy-btn {
      opacity: 1;
    }

    @keyframes fadeInDown {
      from {
        opacity: 0;
        transform: translateY(-4px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .tool-card--call .tool-body {
      border-color: #bfdbfe;
    }

    .tool-card--result .tool-body {
      border-color: #bbf7d0;
    }

    .tool-card--error .tool-body {
      border-color: #fecaca;
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
    .tool-card--error .tool-result-body code {
      border-color: #fecaca;
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
    .tool-card--error .tool-result-body pre {
      border-color: #fecaca;
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
    .tool-card--error .tool-result-body th,
    .tool-card--error .tool-result-body td {
      border-color: #fecaca;
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

    /* ── aiemas_sessions_send 等待状态样式 ── */
    .tool-card--waiting {
      border-color: #c4b5fd;
      background: #f5f3ff;
    }

    .tool-card--waiting .tool-name {
      color: #7c3aed;
    }

    .tool-card--waiting .tool-kind-tag {
      background: #ede9fe;
      color: #7c3aed;
    }

    .waiting-info {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      font-size: 12px;
      color: #6d28d9;
      border-top: 1px solid #c4b5fd;
    }

    .waiting-spinner {
      width: 14px;
      height: 14px;
      border: 2px solid #c4b5fd;
      border-top-color: #7c3aed;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      flex-shrink: 0;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    .waiting-timer {
      font-variant-numeric: tabular-nums;
      color: #8b5cf6;
    }
  `;

  private _toggleBody = () => {
    this._expanded = !this._expanded;
  };

  /** 是否为 aiemas_sessions_send 的 ToolCall */
  private get _isSessionsSend(): boolean {
    return this.item.type === "tool_call" && (this.item.name ?? "").includes("sessions_send");
  }

  /** 是否正在等待（ToolCall 且无 Result） */
  private get _isWaiting(): boolean {
    return this._isSessionsSend && !this.hasResult;
  }

  /** 从 args 中提取子 Agent 名称 */
  private get _targetAgent(): string {
    if (!this.item.args || typeof this.item.args !== "object") {
      return "";
    }
    const args = this.item.args as Record<string, unknown>;
    return (args["agentId"] as string) ?? (args["agent_id"] as string) ?? "";
  }

  /** 从 args 中提取超时秒数，与后端 aiemas-tools.ts 保持一致：最小 600s */
  private get _timeoutSeconds(): number {
    if (!this.item.args || typeof this.item.args !== "object") {
      return 600;
    }
    const args = this.item.args as Record<string, unknown>;
    const t = args["timeoutSeconds"] ?? args["timeout_seconds"];
    const raw = typeof t === "number" && t > 0 ? t : 600;
    return Math.max(raw, 600);
  }

  override connectedCallback(): void {
    super.connectedCallback();
    this._maybeStartTimer();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this._stopTimer();
  }

  override updated(changed: Map<string, unknown>): void {
    if (changed.has("hasResult")) {
      if (this.hasResult) {
        this._stopTimer();
      } else {
        this._maybeStartTimer();
      }
    }
  }

  private _maybeStartTimer(): void {
    if (this._isWaiting && !this._timerHandle) {
      this._startTime = Date.now();
      this._elapsedSeconds = 0;
      this._timerHandle = setInterval(() => {
        this._elapsedSeconds = Math.floor((Date.now() - this._startTime) / 1000);
      }, 1000);
    }
  }

  private _stopTimer(): void {
    if (this._timerHandle) {
      clearInterval(this._timerHandle);
      this._timerHandle = null;
    }
  }

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
    const isError = this.item.isError === true;

    if (!isCall && !isResult) {
      return nothing;
    }

    const rawName = this.item.name ?? (isCall ? "tool_call" : "tool_result");

    // ── aiemas_sessions_send 专用渲染 ──
    if (this._isSessionsSend && isCall) {
      const agent = this._targetAgent;
      const timeout = this._timeoutSeconds;
      const waiting = this._isWaiting;
      const cardClass = waiting ? "tool-card--waiting" : "tool-card--call";
      const icon = waiting ? "🔄" : "✅";
      const label = agent ? `调用子 Agent: ${agent}` : "调用子 Agent";
      const kindLabel = waiting ? "执行中" : "已完成";
      const bodyText = this._renderArgs(this.item.args);
      const hasBody = bodyText.trim().length > 0;

      return html`
        <div class="tool-card-wrapper">
          <div class="tool-card ${cardClass}">
            <div class="tool-header" @click=${this._toggleBody}>
              <span class="tool-icon">${icon}</span>
              <span class="tool-name">${label}</span>
              <span class="tool-kind-tag">${kindLabel}</span>
              <copy-button
                class="tool-copy-btn"
                .value=${bodyText}
                title="仅复制内容"
              ></copy-button>
              <span class="toggle-icon ${this._expanded ? "is-expanded" : ""}">▼</span>
            </div>
            ${waiting
              ? html`
                  <div class="waiting-info">
                    <span class="waiting-spinner"></span>
                    <span>正在等待子 Agent 完成${agent ? ` (${agent})` : ""}…</span>
                    <span class="waiting-timer">${this._elapsedSeconds}s / ${timeout}s</span>
                  </div>
                `
              : nothing}
            ${this._expanded && hasBody
              ? html`<div class="tool-body"><pre>${bodyText}</pre></div>`
              : nothing}
          </div>
          ${this._expanded && hasBody
            ? html`<copy-button
                class="tool-body-copy-btn"
                .value=${`${label}\n${bodyText}`}
                title="复制标题和内容"
              ></copy-button>`
            : nothing}
        </div>
      `;
    }

    // ── 通用 ToolCall / ToolResult 渲染 ──
    const prefix = isCall ? "ToolCall: " : "ToolResult: ";
    const name = `${prefix}${rawName}`;
    const icon = isCall ? "⚙️" : isError ? "❌" : "✅";
    const kindLabel = isCall ? "调用" : isError ? "失败" : "成功";
    const cardClass = isCall
      ? "tool-card--call"
      : isError
        ? "tool-card--error"
        : "tool-card--result";

    const bodyText = isCall ? this._renderArgs(this.item.args) : (this.item.text ?? "");
    const hasBody = bodyText.trim().length > 0;

    return html`
      <div class="tool-card-wrapper">
        <div class="tool-card ${cardClass}">
          <div class="tool-header" @click=${this._toggleBody}>
            <span class="tool-icon">${icon}</span>
            <span class="tool-name">${name}</span>
            <span class="tool-kind-tag">${kindLabel}</span>
            <copy-button class="tool-copy-btn" .value=${bodyText} title="仅复制内容"></copy-button>
            <span class="toggle-icon ${this._expanded ? "is-expanded" : ""}">▼</span>
          </div>
          ${this._expanded && hasBody
            ? html`
                <div class="tool-body">
                  ${isCall
                    ? html`<pre>${bodyText}</pre>`
                    : html`<div class="tool-result-body">${markdownMath(bodyText.trim())}</div>`}
                </div>
              `
            : nothing}
        </div>
        ${this._expanded && hasBody
          ? html`<copy-button
              class="tool-body-copy-btn"
              .value=${`${name}\n${bodyText}`}
              title="复制标题和内容"
            ></copy-button>`
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
