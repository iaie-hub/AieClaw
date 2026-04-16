import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ApprovalRequest, ApprovalResolved } from "../types/approval-types.js";
import type { ChatMessage } from "../types/chat-types.js";
import type { MasSession } from "../types/session-types.js";
import { extractAgentNameFromKey } from "../utils/session-utils.js";
import "./main-header.js";
import "./topology-bar.js";
import "./sub-agent-drawer.js";
import "../views/chat-view.js";
import "../views/agents-view.js";

/**
 * 主工作区：组合 main-header + topology-bar + chat-view + sub-agent-drawer。
 *
 * 布局结构（multi-view-ui-v2 方案 §二）：
 * - 100dvh Flex 视口分区
 * - chat-workspace = 主聊天区 + 子Agent抽屉容器
 * - 抽屉使用 width 过渡动画，展开 360px / 关闭 0
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

  /** 视图模式 */
  @property({ type: String })
  viewMode: "single" | "multi" = "single";

  /** Sub_Agent 消息集合 (agentId → messages) */
  @property({ attribute: false })
  subAgentMessages: Map<string, ChatMessage[]> = new Map();

  /** Sub_Agent 列表 */
  @property({ attribute: false })
  subAgents: string[] = [];

  /** Agent 信息列表（用于查找 agent 名字） */
  @property({ attribute: false })
  agents: { id: string; name?: string; description?: string }[] = [];

  /** 当前活跃的 Sub_Agent Tab */
  @property({ type: String })
  activeSubAgentTab = "";

  /** 有未读消息的 Sub_Agent 集合 */
  @property({ attribute: false })
  unreadAgents: Set<string> = new Set();

  /** 正在执行中的 Sub_Agent 集合 */
  @property({ attribute: false })
  activeAgents: Set<string> = new Set();

  // ── SOP state (passed through to chat-view → message-list) ────────────────
  @property({ attribute: false }) sopSteps: unknown[] = [];
  @property({ attribute: false }) sopLabel = "";
  @property({ attribute: false }) activeProgress: unknown = null;
  @property({ attribute: false }) progressLogs: unknown[] = [];
  @property({ type: Number }) currentStepIndex = -1;
  @property({ type: Number }) sopCompletedAt: number | undefined = undefined;

  /** 当前展开抽屉的子 Agent ID */
  @state() private _drawerAgentId = "";
  /** 抽屉是否展开 */
  @state() private _drawerOpen = false;
  /** 用户偏好：自动展示模式 */
  @state() private _autoOpenMode: "immediate" | "badge-only" | "off" = "badge-only";
  /** 主输入框是否聚焦（用于延迟自动展开） */
  @state() private _isUserTyping = false;
  /** 延迟展开定时器 */
  private _idleTimer: ReturnType<typeof setTimeout> | null = null;
  /** 上一次的未读集合快照，用于检测新消息 */
  private _prevUnreadSnapshot = new Set<string>();

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
      padding: 16px;
      gap: 16px;
      position: relative;
    }

    .primary-panel {
      display: flex;
      flex-direction: column;
      flex: 1;
      overflow: hidden;
      min-width: 0;
      background: var(--ai-bg-panel, #ffffff);
      border-radius: 20px;
      box-shadow:
        0 4px 14px rgba(0, 0, 0, 0.02),
        0 1px 2px rgba(0, 0, 0, 0.03);
      border: 1px solid #eef2f8;
      position: relative;
    }

    /* ── chat-workspace: 主聊天区 ── */
    .chat-workspace {
      display: flex;
      flex: 1;
      min-height: 0;
      overflow: hidden;
    }

    .primary-chat {
      flex: 1;
      display: flex;
      flex-direction: column;
      min-width: 0;
      overflow: hidden;
    }

    /* ── 抽屉遮罩（半透明背景，区分层次） ── */
    .drawer-scrim {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 39;
      background: rgba(0, 0, 0, 0.08);
      cursor: pointer;
    }

    /* ── 抽屉覆盖层（从右侧滑出，与 primary-panel 顶部对齐） ── */
    .drawer-overlay {
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      width: 70%;
      z-index: 40;
      pointer-events: none;
      overflow: hidden;
    }

    .drawer-overlay.open {
      pointer-events: auto;
    }

    .drawer-overlay.open > sub-agent-drawer {
      transform: translateX(0);
    }

    .drawer-overlay > sub-agent-drawer {
      transform: translateX(100%);
      transition: transform 0.25s ease;
    }

    @media (max-width: 1023px) and (min-width: 768px) {
      .drawer-overlay {
        width: 60%;
      }
    }

    @media (max-width: 767px) {
      .drawer-overlay {
        width: 100%;
      }
    }

    .placeholder {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #94a3b8;
      font-size: 16px;
    }

    /* Toast 提示（移动端） */
    .toast {
      position: fixed;
      bottom: 80px;
      left: 50%;
      transform: translateX(-50%);
      background: #1e293b;
      color: #fff;
      padding: 10px 20px;
      border-radius: 10px;
      font-size: 13px;
      z-index: 300;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
      cursor: pointer;
      animation: toastIn 0.3s ease-out;
      max-width: 80vw;
      text-align: center;
    }

    @keyframes toastIn {
      from {
        opacity: 0;
        transform: translateX(-50%) translateY(10px);
      }
      to {
        opacity: 1;
        transform: translateX(-50%) translateY(0);
      }
    }
  `;

  // ── 事件驱动：子 Agent 新消息自动展示逻辑 ──────────────────────────────────

  override updated(changed: Map<string, unknown>): void {
    // 检测 unreadAgents 变化（新消息到达）
    if (changed.has("unreadAgents")) {
      this._handleNewMessages();
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
      this._idleTimer = null;
    }
  }

  /**
   * 处理新消息到达的自动展示逻辑（方案 §4.2）
   */
  private _handleNewMessages(): void {
    if (this._autoOpenMode === "off") {
      return;
    }

    // 找出新增的未读 Agent
    const newUnread: string[] = [];
    for (const agentId of this.unreadAgents) {
      if (!this._prevUnreadSnapshot.has(agentId)) {
        newUnread.push(agentId);
      }
    }
    this._prevUnreadSnapshot = new Set(this.unreadAgents);

    if (newUnread.length === 0) {
      return;
    }

    // 如果抽屉已打开且显示的正是该 Agent，不需要额外操作
    if (this._drawerOpen && newUnread.includes(this._drawerAgentId)) {
      return;
    }

    const targetAgent = newUnread[0];

    // 小屏模式：Toast 提示
    if (window.innerWidth < 768) {
      this._showToast(targetAgent);
      return;
    }

    if (this._autoOpenMode === "badge-only") {
      // 仅角标，不自动展开（拓扑栏已有角标显示）
      return;
    }

    // immediate 模式
    if (this._isUserTyping) {
      // 延迟自动展开，待用户停止输入 3 秒后执行
      this._scheduleIdleOpen(targetAgent);
    } else {
      this._openDrawer(targetAgent);
    }
  }

  private _scheduleIdleOpen(agentId: string): void {
    if (this._idleTimer) {
      clearTimeout(this._idleTimer);
    }
    this._idleTimer = setTimeout(() => {
      this._idleTimer = null;
      if (!this._isUserTyping) {
        this._openDrawer(agentId);
      }
    }, 3000);
  }

  @state() private _toastAgent = "";
  @state() private _toastVisible = false;
  private _toastTimer: ReturnType<typeof setTimeout> | null = null;

  private _showToast(agentId: string): void {
    this._toastAgent = agentId;
    this._toastVisible = true;
    if (this._toastTimer) {
      clearTimeout(this._toastTimer);
    }
    this._toastTimer = setTimeout(() => {
      this._toastVisible = false;
      this._toastTimer = null;
    }, 5000);
  }

  private _onToastClick(): void {
    this._toastVisible = false;
    if (this._toastTimer) {
      clearTimeout(this._toastTimer);
    }
    this._openDrawer(this._toastAgent);
  }

  // ── 抽屉操作 ──────────────────────────────────────────────────────────────

  private _openDrawer(agentId: string): void {
    this._drawerAgentId = agentId;
    this._drawerOpen = true;
    // 通知父组件切换 tab（用于标记已读等）
    this.dispatchEvent(
      new CustomEvent("tab-change", {
        detail: { agentId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _closeDrawer(): void {
    this._drawerOpen = false;
    // 保留 _drawerAgentId 以便动画结束后清理
    setTimeout(() => {
      if (!this._drawerOpen) {
        this._drawerAgentId = "";
      }
    }, 300);
  }

  private _onAgentExpand = (e: CustomEvent<{ agentId: string }>) => {
    this._openDrawer(e.detail.agentId);
  };

  private _onAgentCollapse = () => {
    this._closeDrawer();
  };

  private _onDrawerClose = () => {
    this._closeDrawer();
  };

  private _onAutoOpenModeChange = (
    e: CustomEvent<{ mode: "immediate" | "badge-only" | "off" }>,
  ) => {
    this._autoOpenMode = e.detail.mode;
  };

  private _onDrawerSendMessage = (e: CustomEvent<{ agentId: string; text: string }>) => {
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("drawer-send-message", {
        detail: e.detail,
        bubbles: true,
        composed: true,
      }),
    );
  };

  // ── 主输入框聚焦检测 ──────────────────────────────────────────────────────

  private _onPrimaryChatFocusIn = () => {
    this._isUserTyping = true;
  };

  private _onPrimaryChatFocusOut = () => {
    this._isUserTyping = false;
    // 如果有待执行的延迟展开，3 秒后触发
    if (this._idleTimer) {
      // timer 已在运行，不需要额外操作
    }
  };

  // ── 其他事件转发 ──────────────────────────────────────────────────────────

  private _onInviteClick = () => {
    this.dispatchEvent(
      new CustomEvent("invite-open", { detail: { session: this.session }, bubbles: true }),
    );
  };

  private _onSummaryClick = (e: CustomEvent) => {
    const chatView = this.shadowRoot?.querySelector("chat-view") as
      | (HTMLElement & { _onSummaryClick?: (e: CustomEvent) => void })
      | null;
    if (chatView) {
      chatView.dispatchEvent(
        new CustomEvent("summary-click", { detail: e.detail, bubbles: true, composed: false }),
      );
    }
  };

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

  render() {
    const hasSession = !!this.session;
    const isInitiator = this.session?.masType === "initiated";

    if (this.activeNav === "skills") {
      return html`<skills-manager></skills-manager>`;
    }

    if (this.activeNav === "agents") {
      return html`<agents-view></agents-view>`;
    }

    const rootAgentId = this.session ? extractAgentNameFromKey(this.session.key) : "";
    const effectiveSubAgents =
      this.subAgents.length > 0
        ? this.subAgents
        : [...this.subAgentMessages.keys()].filter((id) => id !== rootAgentId);
    const showTopo = effectiveSubAgents.length > 0;
    const rootAgentName = this.agents.find((a) => a.id === rootAgentId)?.name || rootAgentId;

    // 抽屉当前 Agent 的消息
    const drawerMessages = this._drawerAgentId
      ? (this.subAgentMessages.get(this._drawerAgentId) ?? [])
      : [];
    const drawerIsActive = this._drawerAgentId ? this.activeAgents.has(this._drawerAgentId) : false;

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
              <div class="primary-panel">
                ${showTopo
                  ? html`
                      <topology-bar
                        .subAgents=${effectiveSubAgents}
                        .agents=${this.agents}
                        .agentMessages=${this.subAgentMessages}
                        .rootAgentId=${rootAgentId}
                        .rootAgentName=${rootAgentName}
                        .activeAgents=${this.activeAgents}
                        .unreadAgents=${this.unreadAgents}
                        .expandedAgent=${this._drawerAgentId}
                        .rootRunning=${this.isChatting}
                        @agent-expand=${this._onAgentExpand}
                        @agent-collapse=${this._onAgentCollapse}
                      ></topology-bar>
                    `
                  : nothing}

                <!-- chat-workspace: 主聊天区 -->
                <div class="chat-workspace">
                  <section
                    class="primary-chat"
                    @focusin=${this._onPrimaryChatFocusIn}
                    @focusout=${this._onPrimaryChatFocusOut}
                  >
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
                  </section>
                </div>

                <!-- 抽屉遮罩（点击关闭） -->
                ${this._drawerOpen
                  ? html`<div class="drawer-scrim" @click=${this._onDrawerClose}></div>`
                  : nothing}

                <!-- 子 Agent 抽屉覆盖层（与拓扑条顶部对齐） -->
                <div class="drawer-overlay ${this._drawerOpen ? "open" : ""}">
                  <sub-agent-drawer
                    .activeAgentId=${this._drawerAgentId}
                    .isOpen=${this._drawerOpen}
                    .agents=${this.agents}
                    .messages=${drawerMessages}
                    .unreadCount=${0}
                    .showToolMessages=${this.showToolMessages}
                    .pendingApprovals=${this.pendingApprovals}
                    .resolvedApprovals=${this.resolvedApprovals}
                    .isInitiator=${isInitiator}
                    .isActive=${drawerIsActive}
                    .autoOpenMode=${this._autoOpenMode}
                    @drawer-close=${this._onDrawerClose}
                    @drawer-send-message=${this._onDrawerSendMessage}
                    @auto-open-mode-change=${this._onAutoOpenModeChange}
                  ></sub-agent-drawer>
                </div>
              </div>
            </div>

            <!-- 移动端 Toast 提示 -->
            ${this._toastVisible
              ? (() => {
                  const agent = this.agents.find((a) => a.id === this._toastAgent);
                  const name = agent?.name || this._toastAgent;
                  return html`
                    <div class="toast" @click=${() => this._onToastClick()}>
                      ${name} 有新回复，点击查看
                    </div>
                  `;
                })()
              : nothing}
          `
        : html`
            <div class="workspace-content">
              <div class="placeholder">该视图正在开发中…</div>
            </div>
          `}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "main-workspace": MainWorkspace;
  }
}
