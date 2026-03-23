import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { ApprovalRequest } from "../types/approval-types.js";

/**
 * 审批挂起卡片（HITL）。
 * isInitiator=true 时显示操作按钮，false 时隐藏。
 */
@customElement("msg-pending")
export class MsgPending extends LitElement {
  @property({ attribute: false }) approval!: ApprovalRequest;
  @property({ type: Boolean }) isInitiator = false;

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
      font-size: 18px;
      margin: 0 16px 0 0;
      flex-shrink: 0;
      box-shadow: 0 4px 10px rgba(225, 29, 72, 0.3);
      background: linear-gradient(135deg, #e11d48, #be123c);
    }

    .message-content {
      max-width: 80%;
      display: flex;
      flex-direction: column;
    }

    .message-name {
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

    .pending-card {
      border: 1px solid #fecdd3;
      background: #fff;
      border-radius: 12px;
      box-shadow: 0 4px 15px rgba(225, 29, 72, 0.08);
      overflow: hidden;
    }

    .pending-header {
      background: #fff1f2;
      border-bottom: 1px solid #ffe4e6;
      padding: 12px 20px;
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 600;
      font-size: 15px;
      color: #e11d48;
    }

    .blink-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #f43f5e;
      box-shadow: 0 0 8px #f43f5e;
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

    .pending-body {
      padding: 20px;
    }

    .pending-desc {
      font-size: 14px;
      color: #334155;
      line-height: 1.6;
      margin: 0 0 12px;
    }

    .param-block {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      padding: 12px 15px;
      border-radius: 8px;
      font-size: 13px;
      font-family: "Fira Code", monospace;
      line-height: 1.8;
    }

    .param-label {
      color: #64748b;
    }

    .param-command {
      color: #0284c7;
      font-weight: 700;
    }

    .param-risk {
      color: #d97706;
      font-weight: 700;
    }

    .action-row {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 20px;
    }

    button {
      padding: 8px 16px;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
      border: 1px solid transparent;
    }

    .btn-deny {
      background: white;
      border-color: #e2e8f0;
      color: #64748b;
    }

    .btn-deny:hover {
      border-color: #94a3b8;
      color: #334155;
    }

    .btn-modify {
      background: white;
      border-color: #3b82f6;
      color: #3b82f6;
    }

    .btn-modify:hover {
      background: #eff6ff;
    }

    .btn-approve {
      background: #e11d48;
      color: white;
      box-shadow: 0 4px 10px rgba(225, 29, 72, 0.3);
    }

    .btn-approve:hover {
      background: #be123c;
      transform: translateY(-1px);
    }
  `;

  private _resolve(decision: string) {
    this.dispatchEvent(
      new CustomEvent("resolve", {
        detail: { id: this.approval.id, decision },
        bubbles: true,
        composed: true,
      }),
    );
  }

  render() {
    const { request } = this.approval;
    const desc = request.ask ?? request.command;

    return html`
      <div class="message-row">
        <div class="message-avatar">⚠️</div>
        <div class="message-content">
          <div class="message-name">
            系统防线
            <span class="hitl-tag">Awaiting HITL</span>
          </div>
          <div class="pending-card">
            <div class="pending-header">
              <span class="blink-dot"></span>
              系统防线触发：重大变更需审批
            </div>
            <div class="pending-body">
              <p class="pending-desc">${desc}</p>
              <div class="param-block">
                <div>
                  <span class="param-label">&gt; 待执行：</span>
                  <span class="param-command">${request.command}</span>
                </div>
                <div>
                  <span class="param-label">&gt; 风险项：</span>
                  <span class="param-risk">${request.security ?? "未知"}</span>
                </div>
              </div>
              ${
                this.isInitiator
                  ? html`
                    <div class="action-row">
                      <button class="btn-deny" @click=${() => this._resolve("deny")}>驳回</button>
                      <button class="btn-modify">修改参数</button>
                      <button class="btn-approve" @click=${() => this._resolve("allow-once")}>
                        批准执行
                      </button>
                    </div>
                  `
                  : nothing
              }
            </div>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "msg-pending": MsgPending;
  }
}
