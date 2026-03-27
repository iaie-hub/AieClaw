import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ApprovalRequest } from "../types/approval-types.js";

/**
 * 人工审核浮层（HITL exec-approval）。
 * 对标 ui/src/ui/views/exec-approval.ts，适配 mas4s 多租户场景。
 *
 * 用法：
 *   <exec-approval-overlay
 *     .queue=${pendingApprovals}
 *     @resolve-approval=${handler}
 *   ></exec-approval-overlay>
 */
@customElement("exec-approval-overlay")
export class ExecApprovalOverlay extends LitElement {
  @property({ attribute: false }) queue: ApprovalRequest[] = [];

  @state() private _busy = false;
  @state() private _error = "";

  static styles = css`
    :host {
      display: contents;
    }

    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(15, 23, 42, 0.55);
      backdrop-filter: blur(2px);
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: fadeIn 0.15s ease-out;
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }

    .card {
      background: #ffffff;
      border-radius: 16px;
      box-shadow: 0 20px 60px rgba(0, 0, 0, 0.2);
      width: 480px;
      max-width: calc(100vw - 32px);
      overflow: hidden;
      animation: slideUp 0.2s ease-out;
    }

    @keyframes slideUp {
      from {
        transform: translateY(16px);
        opacity: 0;
      }
      to {
        transform: translateY(0);
        opacity: 1;
      }
    }

    .card-header {
      background: #fff1f2;
      border-bottom: 1px solid #ffe4e6;
      padding: 16px 20px;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 12px;
    }

    .header-left {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .header-title {
      font-size: 15px;
      font-weight: 700;
      color: #be123c;
      display: flex;
      align-items: center;
      gap: 8px;
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

    .header-sub {
      font-size: 12px;
      color: #9f1239;
    }

    .queue-badge {
      background: #fda4af;
      color: #9f1239;
      border-radius: 20px;
      padding: 2px 8px;
      font-size: 12px;
      font-weight: 600;
      flex-shrink: 0;
    }

    .card-body {
      padding: 20px;
    }

    .command-block {
      background: #0f172a;
      color: #e2e8f0;
      border-radius: 8px;
      padding: 12px 14px;
      font-family: "SF Mono", "Fira Code", monospace;
      font-size: 13px;
      line-height: 1.5;
      word-break: break-all;
      margin-bottom: 14px;
    }

    .meta-table {
      display: grid;
      grid-template-columns: auto 1fr;
      gap: 4px 12px;
      font-size: 12px;
      margin-bottom: 14px;
    }

    .meta-label {
      color: #94a3b8;
      font-weight: 500;
      white-space: nowrap;
    }

    .meta-value {
      color: #334155;
      font-family: "SF Mono", "Fira Code", monospace;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .ask-block {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 10px 12px;
      font-size: 13px;
      color: #475569;
      line-height: 1.6;
      margin-bottom: 14px;
    }

    .error-msg {
      background: #fef2f2;
      border: 1px solid #fca5a5;
      border-radius: 8px;
      padding: 8px 12px;
      font-size: 13px;
      color: #dc2626;
      margin-bottom: 12px;
    }

    .actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
    }

    button {
      padding: 9px 18px;
      border-radius: 8px;
      font-size: 14px;
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

  private async _decide(decision: "allow-once" | "allow-always" | "deny") {
    const active = this.queue[0];
    if (!active || this._busy) {
      return;
    }
    this._busy = true;
    this._error = "";
    try {
      this.dispatchEvent(
        new CustomEvent("resolve-approval", {
          detail: { id: active.id, decision },
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
    const active = this.queue[0];
    if (!active) {
      return nothing;
    }

    const req = active.request;
    const remaining = this._formatRemaining(active.expiresAtMs);
    const queueCount = this.queue.length;

    return html`
      <div class="overlay" role="dialog" aria-modal="true" aria-label="人工审核">
        <div class="card">
          <div class="card-header">
            <div class="header-left">
              <div class="header-title">
                <span class="blink-dot"></span>
                系统防线：需要人工审核
              </div>
              <div class="header-sub">${remaining}</div>
            </div>
            ${queueCount > 1 ? html`<div class="queue-badge">${queueCount} 待审批</div>` : nothing}
          </div>

          <div class="card-body">
            <div class="command-block">${req.commandPreview ?? req.command}</div>

            <div class="meta-table">
              ${this._renderMetaRow("主机", req.host)} ${this._renderMetaRow("Agent", req.agentId)}
              ${this._renderMetaRow("会话", req.sessionKey)}
              ${this._renderMetaRow("工作目录", req.cwd)}
              ${this._renderMetaRow("解析路径", req.resolvedPath)}
              ${this._renderMetaRow("风险等级", req.security)}
            </div>

            ${req.ask ? html`<div class="ask-block">${req.ask}</div>` : nothing}
            ${this._error ? html`<div class="error-msg">${this._error}</div>` : nothing}

            <div class="actions">
              <button class="btn-deny" ?disabled=${this._busy} @click=${() => this._decide("deny")}>
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
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "exec-approval-overlay": ExecApprovalOverlay;
  }
}
