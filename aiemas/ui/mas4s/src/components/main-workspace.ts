import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { ApprovalRequest } from "../types/approval-types.js";
import type { ChatMessage } from "../types/chat-types.js";
import type { MasSession } from "../types/session-types.js";
import "./main-header.js";
import "../views/chat-view.js";

/**
 * 主工作区：组合 main-header + chat-view + approval-drawer（第二期）。
 * 向上冒泡 send-message 和 resolve-approval 事件。
 */
@customElement("main-workspace")
export class MainWorkspace extends LitElement {
  @property({ type: String }) activeNav = "workspace";
  @property({ attribute: false }) session: MasSession | undefined = undefined;
  @property({ attribute: false }) messages: ChatMessage[] = [];
  @property({ attribute: false }) pendingApprovals: ApprovalRequest[] = [];

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      overflow: hidden;
      background: #f1f5f9;
      min-width: 0;
    }

    .workspace-content {
      display: flex;
      flex-direction: column;
      flex: 1;
      overflow: hidden;
    }

    .placeholder {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #94a3b8;
      font-size: 16px;
    }
  `;

  private _onInviteClick = () => {
    this.dispatchEvent(
      new CustomEvent("invite-open", { detail: { session: this.session }, bubbles: true }),
    );
  };

  render() {
    const hasSession = !!this.session;
    const isInitiator = this.session?.masType === "initiated";

    return html`
      <main-header
        .title=${hasSession ? `会话：${this.session!.label ?? this.session!.key}` : ""}
        .status=${this.session?.status}
        .approvalCount=${this.pendingApprovals.length}
        .showInvite=${hasSession}
        @invite-click=${this._onInviteClick}
      ></main-header>

      <div class="workspace-content">
        ${
          this.activeNav === "workspace"
            ? html`
              <chat-view
                .messages=${this.messages}
                .session=${this.session}
                .isInitiator=${isInitiator}
                .pendingApprovals=${this.pendingApprovals}
                @resolve=${this._onResolve}
              ></chat-view>
            `
            : html`
                <div class="placeholder">该视图正在开发中…</div>
              `
        }
      </div>
    `;
  }

  private _onResolve = (e: CustomEvent) => {
    this.dispatchEvent(
      new CustomEvent("resolve-approval", { detail: e.detail, bubbles: true, composed: true }),
    );
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "main-workspace": MainWorkspace;
  }
}
