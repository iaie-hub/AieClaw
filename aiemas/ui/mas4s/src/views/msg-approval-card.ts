import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ApprovalRequest, ApprovalResolved } from "../types/approval-types.js";

/**
 * 人工审核卡片（HITL exec-approval）。
 * 内联在消息流中，风格参考 msg-tool-card，替代全屏弹窗。
 * isInitiator=true 时显示操作按钮。
 * resolved 不为空时隐藏按钮，显示审批结果。
 */
@customElement("msg-approval-card")
export class MsgApprovalCard extends LitElement {
  @property({ attribute: false }) approval!: ApprovalRequest;
  @property({ type: Boolean }) isInitiator = false;
  /** 外部传入的已决策结果（从 resolvedApprovals 获取） */
  @property({ attribute: false }) resolved: ApprovalResolved | null = null;

  @state() private _busy = false;
  @state() private _error = "";

  static styles = css`
    :host {
      display: block;
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

    .row {
      display: flex;
    }

    .avatar {
      width: 40px;
      height: 40px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
      margin: 0 16px 0 0;
      flex-shrink: 0;
      box-shadow: 0 4px 10px rgba(225, 29, 72, 0.3);
      background: linear-gradient(135deg, #e11d48, #be123c);
    }

    .content {
      flex: 1;
      min-width: 0;
      max-width: 90%;
    }

    .sender-line {
      font-size: 13px;
      color: #e11d48;
      margin-bottom: 6px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .hitl-tag {
      background: transparent;
      color: #e11d48;
      border: 1px solid #fda4af;
      border-radius: 4px;
      padding: 1px 5px;
      font-size: 10px;
      font-weight: 600;
    }

    /* ── 卡片主体 ── */
    .approval-card {
      border: 1px solid #fecdd3;
      border-radius: 12px;
      overflow: hidden;
      font-size: 13px;
      background: #fff;
      box-shadow: 0 4px 15px rgba(225, 29, 72, 0.08);
    }

    .card-header {
      background: #fff1f2;
      border-bottom: 1px solid #ffe4e6;
      padding: 10px 14px;
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 600;
      font-size: 14px;
      color: #be123c;
    }

    .blink-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #f43f5e;
      box-shadow: 0 0 6px #f43f5e;
      animation: blink 1s infinite;
      flex-shrink: 0;
    }

    @keyframes blink {
      0%,
      100% {
        opacity: 1;
      }
      50% {
        opacity: 0.3;
      }
    }

    .expire-badge {
      margin-left: auto;
      font-size: 11px;
      font-weight: 400;
      color: #9f1239;
      background: #ffe4e6;
      border-radius: 10px;
      padding: 1px 8px;
    }

    .card-body {
      padding: 14px;
    }

    .command-block {
      background: #0f172a;
      color: #e2e8f0;
      border-radius: 8px;
      padding: 10px 14px;
      font-family: "SF Mono", "Fira Code", monospace;
      font-size: 13px;
      line-height: 1.5;
      white-space: pre-wrap;
      word-break: break-all;
      margin-bottom: 12px;
    }

    .meta-table {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 3px 10px;
      font-size: 12px;
      margin-bottom: 12px;
    }

    .meta-label {
      color: #f43f5e;
      font-weight: 500;
      white-space: nowrap;
    }

    .meta-value {
      color: #334155;
      font-family: "SF Mono", "Fira Code", monospace;
      white-space: pre-wrap;
      word-break: break-all;
    }

    .ask-block {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 8px 10px;
      font-size: 12px;
      color: #475569;
      margin-bottom: 12px;
    }

    .error-msg {
      background: #fef2f2;
      border: 1px solid #fca5a5;
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 12px;
      color: #dc2626;
      margin-bottom: 10px;
    }

    .actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }

    button {
      padding: 7px 16px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      border: 1px solid transparent;
      transition: all 0.15s;
    }

    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .btn-deny {
      background: white;
      border-color: #e2e8f0;
      color: #64748b;
    }

    .btn-deny:not(:disabled):hover {
      border-color: #94a3b8;
      color: #334155;
    }

    .btn-allow-always {
      background: white;
      border-color: #3b82f6;
      color: #3b82f6;
    }

    .btn-allow-always:not(:disabled):hover {
      background: #eff6ff;
    }

    .btn-allow-once {
      background: #e11d48;
      color: white;
      box-shadow: 0 4px 10px rgba(225, 29, 72, 0.3);
    }

    .btn-allow-once:not(:disabled):hover {
      background: #be123c;
      transform: translateY(-1px);
    }

    /* 已决策状态 */
    .resolved-badge {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
    }

    .resolved-badge--allow {
      background: #f0fdf4;
      color: #15803d;
      border: 1px solid #bbf7d0;
    }

    .resolved-badge--deny {
      background: #fef2f2;
      color: #dc2626;
      border: 1px solid #fca5a5;
    }

    .resolved-info {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
    }

    .resolved-meta {
      font-size: 11px;
      color: #94a3b8;
    }

    .resolved-meta span {
      margin-right: 10px;
    }
  `;

  private _formatRemaining(expiresAtMs: number): string {
    const ms = Math.max(0, expiresAtMs - Date.now());
    const s = Math.floor(ms / 1000);
    if (s < 60) {
      return `${s}s 后过期`;
    }
    const m = Math.floor(s / 60);
    if (m < 60) {
      return `${m}m 后过期`;
    }
    return `${Math.floor(m / 60)}h 后过期`;
  }

  private _formatTs(ts: number): string {
    const d = new Date(ts);
    const p = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
  }

  private _decisionLabel(decision: string): string {
    switch (decision) {
      case "deny":
        return "✗ 已拒绝";
      case "allow-always":
        return "✓ 已始终允许";
      default:
        return "✓ 已允许一次";
    }
  }

  private async _decide(decision: "allow-once" | "allow-always" | "deny") {
    if (this._busy || this.resolved) {
      return;
    }
    this._busy = true;
    this._error = "";
    try {
      this.dispatchEvent(
        new CustomEvent("resolve-approval", {
          detail: { id: this.approval.id, decision },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    } finally {
      this._busy = false;
    }
  }

  private _renderMetaRow(label: string, value: string | null | undefined) {
    if (!value) {
      return nothing;
    }
    return html`
      <span class="meta-label">${label}</span>
      <span class="meta-value" title=${value}>${value}</span>
    `;
  }

  render() {
    const { request, expiresAtMs } = this.approval;
    const remaining = this._formatRemaining(expiresAtMs);
    const isResolved = !!this.resolved;

    return html`
      <div class="row">
        <div class="avatar">⚠️</div>
        <div class="content">
          <div class="sender-line">
            系统防线
            <span class="hitl-tag">${isResolved ? "HITL Done" : "Awaiting HITL"}</span>
          </div>
          <div class="approval-card">
            <div class="card-header">
              ${isResolved ? nothing : html` <span class="blink-dot"></span> `}
              系统防线：需要人工审核
              ${isResolved ? nothing : html`<span class="expire-badge">${remaining}</span>`}
            </div>
            <div class="card-body">
              <div class="command-block">${request.commandPreview ?? request.command}</div>

              <div class="meta-table">
                ${this._renderMetaRow("主机", request.host)}
                ${this._renderMetaRow("Agent", request.agentId)}
                ${this._renderMetaRow("会话", request.sessionKey)}
                ${this._renderMetaRow("工作目录", request.cwd)}
                ${this._renderMetaRow("解析路径", request.resolvedPath)}
                ${this._renderMetaRow("风险等级", request.security)}
              </div>

              ${request.ask ? html`<div class="ask-block">${request.ask}</div>` : nothing}
              ${this._error ? html`<div class="error-msg">${this._error}</div>` : nothing}
              ${isResolved
                ? html`
                    <div class="resolved-info">
                      <span
                        class="resolved-badge ${this.resolved!.decision === "deny"
                          ? "resolved-badge--deny"
                          : "resolved-badge--allow"}"
                      >
                        ${this._decisionLabel(this.resolved!.decision)}
                      </span>
                      <span class="resolved-meta">
                        ${this.resolved!.resolvedBy
                          ? html`<span>审批人：${this.resolved!.resolvedBy}</span>`
                          : nothing}
                        <span>审批时间：${this._formatTs(this.resolved!.ts)}</span>
                      </span>
                    </div>
                  `
                : this.isInitiator
                  ? html`
                      <div class="actions">
                        <button
                          class="btn-deny"
                          ?disabled=${this._busy}
                          @click=${() => this._decide("deny")}
                        >
                          拒绝
                        </button>
                        <button
                          class="btn-allow-always"
                          ?disabled=${this._busy}
                          @click=${() => this._decide("allow-always")}
                        >
                          始终允许
                        </button>
                        <button
                          class="btn-allow-once"
                          ?disabled=${this._busy}
                          @click=${() => this._decide("allow-once")}
                        >
                          允许一次
                        </button>
                      </div>
                    `
                  : nothing}
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "msg-approval-card": MsgApprovalCard;
  }
}
