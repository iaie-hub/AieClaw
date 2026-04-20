import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { AppStore } from "../store/app-store.js";
import type { ApprovalRequest, ApprovalResolved } from "../types/approval-types.js";
import type { ChatMessage } from "../types/chat-types.js";
import type { LayoutMode } from "../types/layout-types.js";
import type { MasSession } from "../types/session-types.js";
import { computeGridLayout, resolveEffectiveLayout } from "../utils/layout-utils.js";
import { extractAgentNameFromKey } from "../utils/session-utils.js";
import "./main-header.js";
import "./topology-bar.js";
import "./agent-panel.js";
import "./global-input-bar.js";
import "../views/agents-view.js";

/**
 * 主工作区：组合 main-header + topology-bar + agent-panel + global-input-bar。
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

  /** 已完成执行的 Sub_Agent 集合（run 结束，等待查看） */
  @property({ attribute: false })
  completedAgents: Set<string> = new Set();

  // ── SOP state (passed through to agent-panel → message-list) ────────────────
  @property({ attribute: false }) sopSteps: unknown[] = [];
  @property({ attribute: false }) sopLabel = "";
  @property({ attribute: false }) activeProgress: unknown = null;
  @property({ attribute: false }) progressLogs: unknown[] = [];
  @property({ type: Number }) currentStepIndex = -1;
  @property({ type: Number }) sopCompletedAt: number | undefined = undefined;

  /** 当前布局模式（含响应式降级后的实际值） */
  @state() private _layoutMode: LayoutMode = "single";
  /** 布局选择面板是否展开 */
  @state() private _layoutPanelOpen = false;
  /** 用户原始布局选择（响应式恢复用） */
  @state() private _userLayoutChoice: LayoutMode = "single";
  /** 小屏时禁用布局切换按钮 */
  @state() private _layoutDisabled = false;
  /** 整个会话界面是否全屏 */
  @state() private _sessionFullscreen = false;

  /** ResizeObserver 实例 */
  private _resizeObserver: ResizeObserver | null = null;
  /** Resize debounce 定时器 */
  private _resizeDebounceTimer: ReturnType<typeof setTimeout> | null = null;

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
  /** 全局输入框当前目标："root" 或子 Agent ID */
  @state() private _activeInputTarget = "root";

  /** 图片预览 URL */
  @state() private _previewImageUrl: string | null = null;
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

    /* ── 图片预览灯箱 ── */
    .image-lightbox {
      position: fixed;
      inset: 0;
      z-index: 9999;
      background: rgba(0, 0, 0, 0.85);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: zoom-out;
      animation: fadeIn 0.15s ease-out;
      backdrop-filter: blur(4px);
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
      }
      to {
        opacity: 1;
      }
    }

    .lightbox-image {
      max-width: 90vw;
      max-height: 90vh;
      object-fit: contain;
      border-radius: 4px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, 0.5);
      animation: scaleIn 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    @keyframes scaleIn {
      from {
        transform: scale(0.9);
        opacity: 0;
      }
      to {
        transform: scale(1);
        opacity: 1;
      }
    }

    .lightbox-close {
      position: absolute;
      top: 20px;
      right: 20px;
      width: 40px;
      height: 40px;
      background: rgba(255, 255, 255, 0.1);
      border: none;
      border-radius: 50%;
      color: white;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }

    .lightbox-close:hover {
      background: rgba(255, 255, 255, 0.2);
      transform: scale(1.1);
    }

    .primary-panel.session-fullscreen {
      position: fixed !important;
      top: 0 !important;
      left: 0 !important;
      right: 0 !important;
      bottom: 0 !important;
      width: 100vw !important;
      height: 100vh !important;
      z-index: 9998 !important;
      border-radius: 0 !important;
      border: none !important;
      flex: none !important;
    }

    /* ── chat-workspace: 主聊天区 ── */
    .chat-workspace {
      display: flex;
      flex: 1;
      min-height: 0;
      overflow: hidden;
      position: relative;
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

    .drawer-overlay.open > agent-panel {
      transform: translateX(0);
    }

    .drawer-overlay > agent-panel {
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

    /* ── 布局选择面板 ── */
    .layout-panel-backdrop {
      position: absolute;
      inset: 0;
      z-index: 50;
    }

    .layout-panel {
      position: absolute;
      top: 56px;
      right: 16px;
      z-index: 51;
      display: flex;
      gap: 6px;
      padding: 8px;
      border-radius: 12px;
      background: rgba(255, 255, 255, 0.78);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border: 1px solid rgba(226, 232, 240, 0.7);
      box-shadow:
        0 8px 32px rgba(0, 0, 0, 0.08),
        0 2px 8px rgba(0, 0, 0, 0.04);
    }

    .layout-panel-item {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 40px;
      height: 40px;
      border-radius: 8px;
      border: 1px solid transparent;
      background: transparent;
      cursor: pointer;
      color: #64748b;
      transition: all 0.18s ease;
    }

    .layout-panel-item:hover {
      background: rgba(241, 245, 249, 0.9);
      border-color: #e2e8f0;
      color: #475569;
    }

    .layout-panel-item.active {
      background: #eff6ff;
      border-color: #bfdbfe;
      color: #2563eb;
    }

    .placeholder {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #94a3b8;
      font-size: 16px;
    }

    /* ── 多窗口网格布局 ── */
    .multi-grid {
      display: grid;
      flex: 1;
      min-height: 0;
      max-height: 100%;
      overflow: hidden;
      gap: 1px;
      background: #e2e8f0;
    }

    .grid-slot {
      min-width: 0;
      min-height: 0;
      overflow: hidden;
      background: #ffffff;
      position: relative;
      cursor: pointer;
    }
    .grid-placeholder {
      display: flex;
      align-items: center;
      justify-content: center;
      color: #94a3b8;
      font-size: 14px;
      background: #f8fafc;
    }

    /* Task 8.2: 多窗口模式下高亮动画 */
    .grid-slot.highlight {
      animation: slotHighlight 0.6s ease-out;
    }

    @keyframes slotHighlight {
      0% {
        box-shadow: inset 0 0 0 2px #3b82f6;
      }
      100% {
        box-shadow: inset 0 0 0 2px transparent;
      }
    }

    /* Left_Main: 右侧子 Agent 垂直堆叠区域 */
    .left-main-right {
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      min-height: 0;
      height: 100%;
      gap: 1px;
      background: #e2e8f0;
    }

    .left-main-right > .grid-slot {
      flex: 1 1 0;
      min-height: 0;
    }

    /* Top_Bottom: 下方子 Agent 水平排列区域 */
    .top-bottom-lower {
      display: flex;
      flex-direction: row;
      overflow-x: auto;
      overflow-y: hidden;
      min-width: 0;
      min-height: 0;
      height: 100%;
      gap: 1px;
      background: #e2e8f0;
    }

    .top-bottom-lower > .grid-slot {
      flex: 1 0 0;
      min-width: 250px;
      min-height: 0;
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

  // ── 生命周期：ResizeObserver 响应式适配 ─────────────────────────────────

  override connectedCallback(): void {
    super.connectedCallback();
    this.addEventListener("preview-image", this._onPreviewImage as EventListener);
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    this._resizeObserver = new ResizeObserver((entries) => {
      if (this._resizeDebounceTimer) {
        clearTimeout(this._resizeDebounceTimer);
      }
      this._resizeDebounceTimer = setTimeout(() => {
        this._resizeDebounceTimer = null;
        const entry = entries[entries.length - 1];
        const width = entry?.contentRect.width ?? this.offsetWidth;
        if (width < 768) {
          this._layoutDisabled = true;
          this._layoutMode = "single";
          this.viewMode = "single";
        } else {
          this._layoutDisabled = false;
          const effective = resolveEffectiveLayout(this._userLayoutChoice, width);
          this._layoutMode = effective;
          this.viewMode = effective === "single" ? "single" : "multi";
        }
      }, 150);
    });
    this._resizeObserver.observe(this);
  }

  // ── 事件驱动：子 Agent 新消息自动展示逻辑 ──────────────────────────────────

  override updated(changed: Map<string, unknown>): void {
    // 检测 unreadAgents 变化（新消息到达）
    if (changed.has("unreadAgents")) {
      this._handleNewMessages();
    }

    // Task 11.2: 会话切换时从 AppStore 恢复布局模式
    if (changed.has("session")) {
      const sessionUuid = this.session?.sessionUuid;
      if (sessionUuid) {
        const stored = AppStore.instance.getLayoutMode(sessionUuid);
        this._userLayoutChoice = stored;
        // 应用响应式降级
        const width = this.offsetWidth || window.innerWidth;
        if (width < 768) {
          this._layoutMode = "single";
          this._layoutDisabled = true;
        } else {
          const effective = resolveEffectiveLayout(stored, width);
          this._layoutMode = effective;
          this._layoutDisabled = false;
        }
        this.viewMode = this._layoutMode === "single" ? "single" : "multi";
      }
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener("preview-image", this._onPreviewImage as EventListener);
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this._resizeDebounceTimer) {
      clearTimeout(this._resizeDebounceTimer);
      this._resizeDebounceTimer = null;
    }
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

  // ── 布局面板操作 ─────────────────────────────────────────────────────────

  private _onLayoutToggle = () => {
    this._layoutPanelOpen = !this._layoutPanelOpen;
  };

  private _onSessionFullscreenToggle = (e: CustomEvent<{ fullscreen: boolean }>) => {
    this._sessionFullscreen = e.detail.fullscreen;
  };

  private _onLayoutChange(e: CustomEvent<{ mode: LayoutMode }>): void {
    const mode = e.detail.mode;
    this._userLayoutChoice = mode;
    this._layoutMode = mode;
    this._layoutPanelOpen = false;
    this._activeInputTarget = "root";

    // Task 5.3: layoutMode ↔ viewMode sync
    if (mode !== "single") {
      this.viewMode = "multi";
      // Task 8.1: 切换到多窗口模式时关闭抽屉覆盖层
      this._closeDrawer();
    } else {
      this.viewMode = "single";
      // Task 8.3: 切换回 single 时，抽屉行为由 render() 条件渲染自动恢复
    }

    // Task 11.2: 持久化布局模式到 AppStore
    const sessionUuid = this.session?.sessionUuid;
    if (sessionUuid) {
      AppStore.instance.setLayoutMode(sessionUuid, mode);
    }

    // Task 9.2: ResizeObserver 会在下一帧通过 resolveEffectiveLayout 应用响应式降级
    // 此处直接设置用户选择，让 ResizeObserver 异步纠正
    // 此处直接设置用户选择，让 ResizeObserver 异步纠正
  }

  private _onPreviewImage = (e: CustomEvent<{ url: string }>) => {
    e.stopPropagation();
    this._previewImageUrl = e.detail.url;
  };

  private _closePreview = () => {
    this._previewImageUrl = null;
  };

  private _onClickOutsidePanel = (e: Event) => {
    // 使用 composedPath 确保 Shadow DOM 边界内的点击检测正确
    const path = e.composedPath();
    const panel = this.shadowRoot?.querySelector(".layout-panel");
    if (panel && !path.includes(panel)) {
      this._layoutPanelOpen = false;
    }
  };

  // ── 布局面板渲染 ─────────────────────────────────────────────────────────

  private _renderLayoutPanel() {
    if (!this._layoutPanelOpen) {
      return nothing;
    }

    const modes: { mode: LayoutMode; label: string }[] = [
      { mode: "single", label: "单窗口" },
      { mode: "grid-2x2", label: "网格" },
      { mode: "three-column", label: "全列" },
      { mode: "left-main", label: "左主右副" },
      { mode: "top-bottom", label: "上主下副" },
    ];

    return html`
      <div class="layout-panel-backdrop" @click=${this._onClickOutsidePanel}></div>
      <div class="layout-panel">
        ${modes.map(
          ({ mode, label }) => html`
            <div
              class="layout-panel-item ${this._layoutMode === mode ? "active" : ""}"
              title=${label}
              @click=${() =>
                this._onLayoutChange(new CustomEvent("layout-change", { detail: { mode } }))}
            >
              ${this._renderLayoutIcon(mode)}
            </div>
          `,
        )}
      </div>
    `;
  }

  private _renderLayoutIcon(mode: LayoutMode) {
    switch (mode) {
      case "single":
        return html`<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <rect
            x="2"
            y="2"
            width="16"
            height="16"
            rx="2"
            stroke="currentColor"
            stroke-width="1.5"
            fill="none"
          />
        </svg>`;
      case "grid-2x2":
        return html`<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <rect
            x="2"
            y="2"
            width="7"
            height="7"
            rx="1"
            stroke="currentColor"
            stroke-width="1.5"
            fill="none"
          />
          <rect
            x="11"
            y="2"
            width="7"
            height="7"
            rx="1"
            stroke="currentColor"
            stroke-width="1.5"
            fill="none"
          />
          <rect
            x="2"
            y="11"
            width="7"
            height="7"
            rx="1"
            stroke="currentColor"
            stroke-width="1.5"
            fill="none"
          />
          <rect
            x="11"
            y="11"
            width="7"
            height="7"
            rx="1"
            stroke="currentColor"
            stroke-width="1.5"
            fill="none"
          />
        </svg>`;
      case "three-column":
        return html`<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <rect
            x="1"
            y="2"
            width="5"
            height="16"
            rx="1"
            stroke="currentColor"
            stroke-width="1.5"
            fill="none"
          />
          <rect
            x="7.5"
            y="2"
            width="5"
            height="16"
            rx="1"
            stroke="currentColor"
            stroke-width="1.5"
            fill="none"
          />
          <rect
            x="14"
            y="2"
            width="5"
            height="16"
            rx="1"
            stroke="currentColor"
            stroke-width="1.5"
            fill="none"
          />
        </svg>`;
      case "left-main":
        return html`<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <rect
            x="2"
            y="2"
            width="10"
            height="16"
            rx="1"
            stroke="currentColor"
            stroke-width="1.5"
            fill="none"
          />
          <rect
            x="13.5"
            y="2"
            width="4.5"
            height="16"
            rx="1"
            stroke="currentColor"
            stroke-width="1.5"
            fill="none"
          />
        </svg>`;
      case "top-bottom":
        return html`<svg width="20" height="20" viewBox="0 0 20 20" fill="none">
          <rect
            x="2"
            y="2"
            width="16"
            height="7"
            rx="1"
            stroke="currentColor"
            stroke-width="1.5"
            fill="none"
          />
          <rect
            x="2"
            y="11"
            width="16"
            height="7"
            rx="1"
            stroke="currentColor"
            stroke-width="1.5"
            fill="none"
          />
        </svg>`;
    }
    return nothing;
  }

  // ── 多窗口布局渲染 ─────────────────────────────────────────────────────────

  private _renderChatViewSlot(isInitiator: boolean) {
    const isSelected = this._activeInputTarget === "root";
    return html`
      <div
        class="grid-slot"
        style="display:flex;flex-direction:column;"
        @click=${() => {
          this._activeInputTarget = "root";
        }}
      >
        <agent-panel
          variant="root"
          .selected=${isSelected}
          .agentId=${this.session ? (this.session.key.split(":")[1] ?? "") : ""}
          .agents=${this.agents}
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
        ></agent-panel>
      </div>
    `;
  }

  private _renderSubAgentSlot(agentId: string, isInitiator: boolean) {
    const messages = this.subAgentMessages.get(agentId) ?? [];
    const isActive = this.activeAgents.has(agentId);
    const isSelected = this._activeInputTarget === agentId;
    return html`
      <div
        class="grid-slot"
        @click=${() => {
          this._activeInputTarget = agentId;
        }}
      >
        <agent-panel
          variant="sub"
          .selected=${isSelected}
          .agentId=${agentId}
          .hideClose=${true}
          .agents=${this.agents}
          .messages=${messages}
          .unreadCount=${0}
          .showToolMessages=${this.showToolMessages}
          .pendingApprovals=${this.pendingApprovals}
          .resolvedApprovals=${this.resolvedApprovals}
          .isInitiator=${isInitiator}
          .isActive=${isActive}
          @drawer-send-message=${this._onDrawerSendMessage}
        ></agent-panel>
      </div>
    `;
  }

  private _renderPlaceholderSlot() {
    return html`<div class="grid-slot grid-placeholder">暂无 Agent</div>`;
  }

  private _renderMultiWindowLayout(
    rootAgentId: string,
    effectiveSubAgents: string[],
    isInitiator: boolean,
  ) {
    const gridResult = computeGridLayout(this._layoutMode, rootAgentId, effectiveSubAgents);

    // Left_Main: special two-column layout with right side vertical scroll
    if (this._layoutMode === "left-main") {
      const subSlots = gridResult.slots.filter((s) => s.type === "sub");
      const hasPlaceholder = gridResult.slots.some((s) => s.type === "placeholder");
      return html`
        <div
          class="multi-grid"
          style="grid-template-columns:${gridResult.gridTemplateColumns};grid-template-rows:${gridResult.gridTemplateRows};"
        >
          ${this._renderChatViewSlot(isInitiator)}
          <div class="left-main-right">
            ${subSlots.length > 0
              ? subSlots.map((s) => this._renderSubAgentSlot(s.agentId, isInitiator))
              : nothing}
            ${hasPlaceholder || subSlots.length === 0 ? this._renderPlaceholderSlot() : nothing}
          </div>
        </div>
      `;
    }

    // Top_Bottom: special two-row layout with bottom horizontal scroll
    if (this._layoutMode === "top-bottom") {
      const subSlots = gridResult.slots.filter((s) => s.type === "sub");
      const hasPlaceholder = gridResult.slots.some((s) => s.type === "placeholder");
      return html`
        <div
          class="multi-grid"
          style="grid-template-columns:${gridResult.gridTemplateColumns};grid-template-rows:${gridResult.gridTemplateRows};"
        >
          ${this._renderChatViewSlot(isInitiator)}
          <div class="top-bottom-lower">
            ${subSlots.length > 0
              ? subSlots.map((s) => this._renderSubAgentSlot(s.agentId, isInitiator))
              : nothing}
            ${hasPlaceholder || subSlots.length === 0 ? this._renderPlaceholderSlot() : nothing}
          </div>
        </div>
      `;
    }

    // Grid_2x2 and Three_Column: standard CSS Grid
    return html`
      <div
        class="multi-grid"
        style="grid-template-columns:${gridResult.gridTemplateColumns};grid-template-rows:${gridResult.gridTemplateRows};"
      >
        ${gridResult.slots.map((slot) => {
          if (slot.type === "root") {
            return this._renderChatViewSlot(isInitiator);
          }
          if (slot.type === "sub") {
            return this._renderSubAgentSlot(slot.agentId, isInitiator);
          }
          return this._renderPlaceholderSlot();
        })}
      </div>
    `;
  }

  // ── 抽屉操作 ──────────────────────────────────────────────────────────────

  private _openDrawer(agentId: string): void {
    // Task 8.1: 多窗口模式下禁止抽屉覆盖层展开
    if (this._layoutMode !== "single") {
      return;
    }
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

  /**
   * Task 8.2: 多窗口模式下高亮并滚动到对应 Agent 窗口
   */
  private _highlightAgentWindow(agentId: string): void {
    const slots = this.shadowRoot?.querySelectorAll(".grid-slot");
    if (!slots) {
      return;
    }

    for (const slot of slots) {
      const panel = slot.querySelector("agent-panel") as
        | (HTMLElement & { agentId?: string })
        | null;
      if (panel && panel.agentId === agentId) {
        slot.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
        slot.classList.add("highlight");
        setTimeout(() => slot.classList.remove("highlight"), 600);
        break;
      }
    }

    // 通知父组件切换 tab（用于标记已读等）
    this.dispatchEvent(
      new CustomEvent("tab-change", {
        detail: { agentId },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onAgentExpand = (e: CustomEvent<{ agentId: string }>) => {
    // 多窗口模式下高亮/滚动到对应窗口，并切换输入目标
    if (this._layoutMode !== "single") {
      this._activeInputTarget = e.detail.agentId;
      this._highlightAgentWindow(e.detail.agentId);
      return;
    }
    // 单窗口模式：打开抽屉并切换输入目标
    this._openDrawer(e.detail.agentId);
    this._activeInputTarget = e.detail.agentId;
  };

  private _onAgentCollapse = () => {
    this._closeDrawer();
    this._activeInputTarget = "root";
  };

  private _onDrawerClose = () => {
    this._closeDrawer();
    this._activeInputTarget = "root";
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

  // NOTE: _onSendMessage 和 _onResolve 等转发函数已移除。
  // 我们现在依靠事件冒泡 (composed: true) 让子组件 (chat-input, agent-panel) 的事件自然达到 app-shell。

  private _onInviteClick = () => {
    this.dispatchEvent(
      new CustomEvent("invite-open", { detail: { session: this.session }, bubbles: true }),
    );
  };

  private _onSummaryClick = (e: CustomEvent) => {
    const panel = this.shadowRoot?.querySelector("agent-panel") as
      | (HTMLElement & { _onSummaryClick?: (e: CustomEvent) => void })
      | null;
    if (panel) {
      panel.dispatchEvent(
        new CustomEvent("summary-click", { detail: e.detail, bubbles: true, composed: false }),
      );
    }
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
              @session-archive=${this._onSessionArchive}
              @session-unarchive=${this._onSessionUnarchive}
              @toggle-tool-messages=${this._onToggleToolMessages}
            ></main-header>
            <div class="workspace-content">
              <div class="primary-panel ${this._sessionFullscreen ? "session-fullscreen" : ""}">
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
                        .completedAgents=${this.completedAgents}
                        .expandedAgent=${this._drawerAgentId}
                        .rootRunning=${this.isChatting}
                        .layoutMode=${this._layoutMode}
                        .layoutDisabled=${this._layoutDisabled}
                        @agent-expand=${this._onAgentExpand}
                        @agent-collapse=${this._onAgentCollapse}
                        @layout-toggle=${this._onLayoutToggle}
                        @session-fullscreen-toggle=${this._onSessionFullscreenToggle}
                      ></topology-bar>
                    `
                  : nothing}

                <!-- 布局选择面板 -->
                ${this._renderLayoutPanel()}
                ${this._layoutMode === "single"
                  ? html`
                      <!-- chat-workspace: 主聊天区（单窗口模式） -->
                      <div class="chat-workspace" style="position: relative;">
                        <section
                          class="primary-chat"
                          @focusin=${this._onPrimaryChatFocusIn}
                          @focusout=${this._onPrimaryChatFocusOut}
                        >
                          <agent-panel
                            variant="root"
                            .agentId=${rootAgentId}
                            .agents=${this.agents}
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
                            @load-more-history=${this._onLoadMoreHistory}
                            @abort-chat=${this._onAbortChat}
                          ></agent-panel>
                        </section>

                        <!-- 抽屉遮罩（点击关闭） -->
                        ${this._drawerOpen
                          ? html`<div class="drawer-scrim" @click=${this._onDrawerClose}></div>`
                          : nothing}

                        <!-- 子 Agent 抽屉覆盖层（从右侧滑出） -->
                        <div class="drawer-overlay ${this._drawerOpen ? "open" : ""}">
                          ${this._drawerAgentId
                            ? html`<agent-panel
                                variant="sub"
                                .agentId=${this._drawerAgentId}
                                .agents=${this.agents}
                                .messages=${drawerMessages}
                                .unreadCount=${0}
                                .showToolMessages=${this.showToolMessages}
                                .pendingApprovals=${this.pendingApprovals}
                                .resolvedApprovals=${this.resolvedApprovals}
                                .isInitiator=${isInitiator}
                                .isActive=${drawerIsActive}
                                .autoOpenMode=${this._autoOpenMode}
                                @panel-close=${this._onDrawerClose}
                                @drawer-send-message=${this._onDrawerSendMessage}
                                @auto-open-mode-change=${this._onAutoOpenModeChange}
                              ></agent-panel>`
                            : nothing}
                        </div>
                      </div>

                      <!-- 全局输入框（单窗口模式，目标跟随当前选中 Agent） -->
                      <global-input-bar
                        .activeTarget=${this._activeInputTarget}
                        .session=${this.session}
                        .isChatting=${this.isChatting}
                        .agents=${this.agents}
                        .rootAgentName=${rootAgentName}
                        @drawer-send-message=${this._onDrawerSendMessage}
                        @abort-chat=${this._onAbortChat}
                      ></global-input-bar>
                    `
                  : html`
                      <!-- chat-workspace: 多窗口布局模式 -->
                      <div class="chat-workspace">
                        ${this._renderMultiWindowLayout(
                          rootAgentId,
                          effectiveSubAgents,
                          isInitiator ?? false,
                        )}
                      </div>

                      <!-- 全局输入框（多窗口模式，点击窗口切换目标） -->
                      <global-input-bar
                        .activeTarget=${this._activeInputTarget}
                        .session=${this.session}
                        .isChatting=${this.isChatting}
                        .agents=${this.agents}
                        .rootAgentName=${rootAgentName}
                        @drawer-send-message=${this._onDrawerSendMessage}
                        @abort-chat=${this._onAbortChat}
                      ></global-input-bar>
                    `}
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
      ${this._previewImageUrl
        ? html`
            <div class="image-lightbox" @click=${this._closePreview}>
              <img class="lightbox-image" src=${this._previewImageUrl} />
              <button class="lightbox-close" @click=${this._closePreview}>
                <svg
                  width="24"
                  height="24"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2"
                  stroke-linecap="round"
                  stroke-linejoin="round"
                >
                  <line x1="18" y1="6" x2="6" y2="18"></line>
                  <line x1="6" y1="6" x2="18" y2="18"></line>
                </svg>
              </button>
            </div>
          `
        : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "main-workspace": MainWorkspace;
  }
}
