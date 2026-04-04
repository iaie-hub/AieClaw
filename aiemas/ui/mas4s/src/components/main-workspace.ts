import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { ApprovalRequest, ApprovalResolved } from "../types/approval-types.js";
import type { ChatMessage } from "../types/chat-types.js";
import type { MasSession } from "../types/session-types.js";
import "./main-header.js";
import "../views/chat-view.js";
import "../views/agents-view.js";

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
  @property({ attribute: false }) resolvedApprovals: Map<
    string,
    { approval: ApprovalRequest; resolved: ApprovalResolved }
  > = new Map();
  @property({ type: Boolean }) hasSummary = false;
  @property({ type: Boolean }) truncated = false;
  @property({ type: Boolean }) hasMoreHistory = false;
  @property({ type: Boolean }) isChatting = false;
  @property({ type: Boolean }) showToolMessages = true;

  // ── SOP state (passed through to chat-view → message-list) ────────────────
  @property({ attribute: false }) sopSteps: unknown[] = [];
  @property({ attribute: false }) sopLabel = "";
  @property({ attribute: false }) activeProgress: unknown = null;
  @property({ attribute: false }) progressLogs: unknown[] = [];
  @property({ type: Number }) currentStepIndex = -1;
  @property({ type: Number }) sopCompletedAt: number | undefined = undefined;

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

  private _onSummaryClick = (e: CustomEvent) => {
    // 将 header 的 summary-click 转发给 chat-view（让其打开 summary-dialog）
    const chatView = this.shadowRoot?.querySelector("chat-view") as
      | (HTMLElement & { _onSummaryClick?: (e: CustomEvent) => void })
      | null;
    if (chatView) {
      chatView.dispatchEvent(
        new CustomEvent("summary-click", { detail: e.detail, bubbles: true, composed: false }),
      );
    }
  };

  render() {
    const hasSession = !!this.session;
    const isInitiator = this.session?.masType === "initiated";

    if (this.activeNav === "skills") {
      return html`<skills-manager></skills-manager>`;
    }

    if (this.activeNav === "agents") {
      return html`<agents-view></agents-view>`;
    }

    return html`
      ${this.activeNav === "workspace"
        ? html`
            <main-header
              .title=${hasSession ? `会话：${this.session!.label ?? this.session!.key}` : ""}
              .status=${this.session?.status}
              .approvalCount=${this.pendingApprovals.length}
              .pendingApprovals=${this.pendingApprovals}
              .showInvite=${hasSession}
              .session=${this.session}
              .showToolMessages=${this.showToolMessages}
              @invite-click=${this._onInviteClick}
              @summary-click=${this._onSummaryClick}
              @resolve-approval=${this._onResolve}
              @session-archive=${this._onSessionArchive}
              @session-unarchive=${this._onSessionUnarchive}
              @toggle-tool-messages=${this._onToggleToolMessages}
            ></main-header>
            <div class="workspace-content">
              <chat-view
                .messages=${this.messages}
                .session=${this.session}
                .isInitiator=${isInitiator}
                .pendingApprovals=${this.pendingApprovals}
                .resolvedApprovals=${this.resolvedApprovals}
                .hasSummary=${this.hasSummary}
                .truncated=${this.truncated}
                .hasMoreHistory=${this.hasMoreHistory}
                .isChatting=${this.isChatting}
                .showToolMessages=${this.showToolMessages}
                .sopSteps=${this.sopSteps}
                .sopLabel=${this.sopLabel}
                .activeProgress=${this.activeProgress}
                .progressLogs=${this.progressLogs}
                .currentStepIndex=${this.currentStepIndex}
                .sopCompletedAt=${this.sopCompletedAt}
                @resolve=${this._onResolve}
                @load-more-history=${this._onLoadMoreHistory}
                @abort-chat=${this._onAbortChat}
              ></chat-view>
            </div>
          `
        : html`
            <div class="workspace-content">
              <div class="placeholder">该视图正在开发中…</div>
            </div>
          `}
    `;
  }

  private _onResolve = (e: CustomEvent) => {
    this.dispatchEvent(
      new CustomEvent("resolve-approval", { detail: e.detail, bubbles: true, composed: true }),
    );
  };

  private _onSessionArchive = (e: CustomEvent) => {
    e.stopPropagation();
    this.dispatchEvent(new CustomEvent("session-archive", { detail: e.detail, bubbles: true }));
  };

  private _onSessionUnarchive = (e: CustomEvent) => {
    e.stopPropagation();
    this.dispatchEvent(new CustomEvent("session-unarchive", { detail: e.detail, bubbles: true }));
  };

  private _onLoadMoreHistory = (e: CustomEvent<{ sessionKey: string }>) => {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("load-more-history", { detail: e.detail, bubbles: true, composed: true }),
    );
  };

  private _onAbortChat = (e: Event) => {
    e.stopPropagation();
    this.dispatchEvent(new CustomEvent("abort-chat", { bubbles: true, composed: true }));
  };

  private _onToggleToolMessages = (e: CustomEvent<{ show: boolean }>) => {
    this.showToolMessages = e.detail.show;
  };
}

declare global {
  interface HTMLElementTagNameMap {
    "main-workspace": MainWorkspace;
  }
}
