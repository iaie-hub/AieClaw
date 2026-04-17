import { LitElement, html, css, nothing } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { ChatMessage } from "../types/chat-types.js";
import type { LayoutMode } from "../types/layout-types.js";

/**
 * topology-bar — 拓扑状态条（控制台风格）。
 *
 * 主 Agent 在左侧，流动连接线后跟子 Agent 节点卡片水平排列，
 * 每个子 Agent 卡片显示图标 + 名称 + 消息预览，点击打开抽屉。
 * 整条可横向滚动（子 Agent 多时）。
 *
 * 设计语言：mission-control 控制台 + 磨砂玻璃质感，
 * 与 main-header / session-sidebar 的渐变体系保持一致。
 */
@customElement("topology-bar")
export class TopologyBar extends LitElement {
  @property({ attribute: false }) subAgents: string[] = [];
  @property({ attribute: false }) agents: { id: string; name?: string; description?: string }[] =
    [];
  @property({ attribute: false }) agentMessages: Map<string, ChatMessage[]> = new Map();
  @property({ type: String }) rootAgentId = "";
  @property({ type: String }) rootAgentName = "";
  @property({ attribute: false }) activeAgents: Set<string> = new Set();
  @property({ attribute: false }) unreadAgents: Set<string> = new Set();
  @property({ attribute: false }) completedAgents: Set<string> = new Set();
  @property({ type: String }) expandedAgent = "";
  /** 根 Agent 是否正在对话中（streaming） */
  @property({ type: Boolean }) rootRunning = false;
  @property({ type: String }) layoutMode: LayoutMode = "single";
  @property({ type: Boolean }) layoutDisabled = false;

  static styles = css`
    :host {
      display: block;
      flex-shrink: 0;
      position: relative;
      overflow: hidden;
      font-family: "DM Sans", "PingFang SC", "Noto Sans SC", system-ui, sans-serif;
    }

    /* ── 底层：微妙的网格纹理背景 ── */
    .bar-bg {
      position: absolute;
      inset: 0;
      background: linear-gradient(
        180deg,
        rgba(248, 250, 252, 0.95) 0%,
        rgba(241, 245, 249, 0.88) 100%
      );
      z-index: 0;
    }

    .bar-bg::before {
      content: "";
      position: absolute;
      inset: 0;
      background-image: radial-gradient(
        circle at 1px 1px,
        rgba(148, 163, 184, 0.07) 1px,
        transparent 0
      );
      background-size: 20px 20px;
    }

    .bar-bg::after {
      content: "";
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 1px;
      background: #e2e8f0;
    }

    /* ── 主容器 ── */
    .bar {
      position: relative;
      z-index: 1;
      display: flex;
      align-items: center;
      gap: 0;
      padding: 6px 16px;
      min-height: 44px;
      overflow-x: auto;
      overflow-y: hidden;
      scrollbar-width: none;
    }
    .bar::-webkit-scrollbar {
      display: none;
    }

    /* ── 主 Agent 节点 ── */
    .root-node {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
      padding: 4px 10px 4px 6px;
      border-radius: 10px;
      background: rgba(255, 255, 255, 0.7);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      border: 1px solid #e2e8f0;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .root-node:hover {
      border-color: #cbd5e1;
      background: rgba(255, 255, 255, 0.9);
    }

    .root-icon {
      position: relative;
      width: 22px;
      height: 22px;
      border-radius: 6px;
      background: #eff6ff;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      color: #2563eb;
    }

    .root-icon-wrap {
      position: relative;
      width: 22px;
      height: 22px;
      flex-shrink: 0;
    }

    /* 主节点呼吸光环 — 移除 */
    .root-icon::after {
      display: none;
    }

    @keyframes rootBreath {
      0%,
      100% {
        opacity: 0.4;
        transform: scale(1);
      }
      50% {
        opacity: 0.8;
        transform: scale(1.08);
      }
    }

    .root-label {
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .root-name {
      font-size: 12px;
      font-weight: 700;
      color: #1e293b;
      letter-spacing: -0.01em;
      white-space: nowrap;
      line-height: 1.2;
    }

    .root-role {
      font-size: 9px;
      font-weight: 600;
      color: #94a3b8;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      line-height: 1;
    }

    /* ── 连接线区域 ── */
    .connector {
      display: flex;
      align-items: center;
      flex-shrink: 0;
      padding: 0 6px;
      position: relative;
      height: 32px;
    }

    .connector-line {
      width: 32px;
      height: 2px;
      background: #e2e8f0;
      border-radius: 1px;
      position: relative;
      overflow: hidden;
    }

    /* 流动光点动画 — 移除 */
    .connector-line::after {
      display: none;
    }

    @keyframes flowPulse {
      0% {
        left: -20px;
        opacity: 0;
      }
      20% {
        opacity: 1;
      }
      80% {
        opacity: 1;
      }
      100% {
        left: calc(100% + 4px);
        opacity: 0;
      }
    }

    .connector-arrow {
      width: 0;
      height: 0;
      border-top: 4px solid transparent;
      border-bottom: 4px solid transparent;
      border-left: 6px solid #cbd5e1;
      flex-shrink: 0;
    }

    /* ── 子 Agent 计数标签 ── */
    .count-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 10px;
      border-radius: 20px;
      background: #f1f5f9;
      border: 1px solid #e2e8f0;
      font-size: 11px;
      font-weight: 600;
      color: #64748b;
      flex-shrink: 0;
      margin-right: 10px;
      letter-spacing: 0.01em;
      white-space: nowrap;
    }

    .count-chip svg {
      opacity: 0.7;
    }

    /* ── 子 Agent 卡片容器 ── */
    .children {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    /* ── 子 Agent 卡片 ── */
    .child-card {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 4px 10px 4px 6px;
      border-radius: 10px;
      border: 1px solid rgba(226, 232, 240, 0.6);
      background: rgba(255, 255, 255, 0.75);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      cursor: pointer;
      transition: all 0.22s cubic-bezier(0.4, 0, 0.2, 1);
      flex-shrink: 0;
      white-space: nowrap;
      user-select: none;
      max-width: 240px;
      position: relative;
      box-shadow:
        0 1px 2px rgba(0, 0, 0, 0.03),
        inset 0 1px 0 rgba(255, 255, 255, 0.7);

      /* 入场动画 */
      animation: cardEnter 0.35s cubic-bezier(0.16, 1, 0.3, 1) backwards;
    }

    .child-card:nth-child(1) {
      animation-delay: 0.05s;
    }
    .child-card:nth-child(2) {
      animation-delay: 0.1s;
    }
    .child-card:nth-child(3) {
      animation-delay: 0.15s;
    }
    .child-card:nth-child(4) {
      animation-delay: 0.2s;
    }
    .child-card:nth-child(5) {
      animation-delay: 0.25s;
    }
    .child-card:nth-child(6) {
      animation-delay: 0.3s;
    }
    .child-card:nth-child(7) {
      animation-delay: 0.35s;
    }
    .child-card:nth-child(8) {
      animation-delay: 0.4s;
    }

    @keyframes cardEnter {
      from {
        opacity: 0;
        transform: translateY(6px) scale(0.95);
      }
      to {
        opacity: 1;
        transform: translateY(0) scale(1);
      }
    }

    .child-card:hover {
      background: rgba(255, 255, 255, 0.92);
      border-color: rgba(148, 163, 184, 0.4);
      box-shadow:
        0 4px 16px rgba(0, 0, 0, 0.06),
        0 1px 3px rgba(0, 0, 0, 0.04),
        inset 0 1px 0 rgba(255, 255, 255, 0.9);
      transform: translateY(-1px);
    }

    .child-card.active {
      background: #f8fafc;
      border-color: #cbd5e1;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
    }

    .child-card.active:hover {
      border-color: #94a3b8;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.07);
    }

    /* ── 卡片图标区 ── */
    .card-icon-wrap {
      position: relative;
      width: 22px;
      height: 22px;
      flex-shrink: 0;
    }

    .card-icon {
      width: 22px;
      height: 22px;
      border-radius: 7px;
      background: linear-gradient(135deg, #f1f5f9 0%, #e8edf5 100%);
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }

    .card-icon svg {
      color: #64748b;
      transition: color 0.2s;
    }

    .child-card.active .card-icon {
      background: #e2e8f0;
    }

    .child-card.active .card-icon svg {
      color: #1e293b;
    }

    .child-card:hover .card-icon svg {
      color: #475569;
    }

    /* ── 状态指示器 ── */
    .status-indicator {
      position: absolute;
      top: -2px;
      right: -2px;
      width: 9px;
      height: 9px;
      border-radius: 50%;
      border: 2px solid rgba(255, 255, 255, 0.95);
      z-index: 2;
    }

    .status-indicator.running {
      background: #22c55e;
      box-shadow: 0 0 6px rgba(34, 197, 94, 0.4);
      animation: statusBreath 1.8s ease-in-out infinite;
    }

    .status-indicator.unread {
      background: #6366f1;
      box-shadow: 0 0 6px rgba(99, 102, 241, 0.4);
      animation: unreadPing 3s ease-in-out infinite;
    }

    .status-indicator.completed {
      background: #f59e0b;
      box-shadow: 0 0 6px rgba(245, 158, 11, 0.35);
    }

    @keyframes statusBreath {
      0%,
      100% {
        box-shadow: 0 0 4px rgba(34, 197, 94, 0.3);
        transform: scale(1);
      }
      50% {
        box-shadow: 0 0 10px rgba(34, 197, 94, 0.5);
        transform: scale(1.15);
      }
    }

    @keyframes unreadPing {
      0%,
      100% {
        box-shadow: 0 0 4px rgba(99, 102, 241, 0.3);
        transform: scale(1);
      }
      50% {
        box-shadow:
          0 0 8px rgba(99, 102, 241, 0.5),
          0 0 12px rgba(99, 102, 241, 0.15);
        transform: scale(1.05);
      }
    }

    /* ── 卡片文字区 ── */
    .card-text {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .card-name {
      font-size: 12px;
      font-weight: 650;
      color: #1e293b;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      letter-spacing: -0.005em;
      line-height: 1.2;
    }

    .child-card.active .card-name {
      color: #1e293b;
    }

    .card-preview {
      font-size: 11px;
      color: #94a3b8;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 150px;
      line-height: 1.2;
      font-family: "JetBrains Mono", "SF Mono", "Fira Code", monospace;
      font-weight: 400;
      letter-spacing: -0.01em;
    }

    /* ── 实时输出滚动容器 ── */
    .card-preview-scroll {
      overflow: hidden;
      max-width: 150px;
      line-height: 1.2;
      position: relative;
      /* 右侧渐隐遮罩，暗示文本可滚动 */
      -webkit-mask-image: linear-gradient(to right, #000 75%, transparent 100%);
      mask-image: linear-gradient(to right, #000 75%, transparent 100%);
    }

    .card-preview.running {
      color: #16a34a;
      font-weight: 500;
      white-space: nowrap;
      text-overflow: clip;
      display: inline-block;
      max-width: none;
      animation: previewScroll var(--scroll-duration, 6s) linear infinite;
      animation-play-state: running;
    }

    @keyframes previewScroll {
      0% {
        transform: translateX(0);
      }
      15% {
        transform: translateX(0);
      }
      85% {
        transform: translateX(var(--scroll-distance, -60px));
      }
      100% {
        transform: translateX(var(--scroll-distance, -60px));
      }
    }

    .card-preview.empty {
      font-family: "DM Sans", "PingFang SC", "Noto Sans SC", system-ui, sans-serif;
      font-style: italic;
      color: #cbd5e1;
      font-size: 10.5px;
    }

    .child-card.active .card-preview {
      color: #64748b;
    }

    .child-card.active .card-preview.empty {
      color: #94a3b8;
    }

    .child-card.active .card-preview.running {
      color: #15803d;
    }

    /* ── 活跃指示条（卡片底部） ── */
    .child-card.active::after {
      content: "";
      position: absolute;
      bottom: -1px;
      left: 8px;
      right: 8px;
      height: 2px;
      border-radius: 2px 2px 0 0;
      background: #2563eb;
      opacity: 0.7;
    }

    /* ── 布局切换按钮 ── */
    .layout-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: 8px;
      border: 1px solid #e2e8f0;
      background: rgba(255, 255, 255, 0.7);
      backdrop-filter: blur(6px);
      -webkit-backdrop-filter: blur(6px);
      cursor: pointer;
      flex-shrink: 0;
      margin-left: auto;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      color: #64748b;
      outline: none;
    }

    .layout-btn:hover {
      background: rgba(255, 255, 255, 0.95);
      border-color: #cbd5e1;
      color: #475569;
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
    }

    .layout-btn:focus-visible {
      border-color: #2563eb;
      box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.2);
    }

    .layout-btn.active {
      background: #eff6ff;
      border-color: #bfdbfe;
      color: #2563eb;
    }

    .layout-btn.disabled {
      opacity: 0.4;
      pointer-events: none;
      cursor: default;
    }

    /* ── 响应式 ── */
    @media (max-width: 768px) {
      .bar {
        padding: 8px 12px;
        min-height: 46px;
      }

      .root-node {
        padding: 5px 10px 5px 6px;
      }

      .root-name {
        font-size: 12px;
      }

      .root-role {
        display: none;
      }

      .child-card {
        padding: 5px 10px 5px 7px;
        gap: 8px;
        max-width: 180px;
      }

      .card-icon-wrap {
        width: 26px;
        height: 26px;
      }

      .card-icon {
        width: 26px;
        height: 26px;
        border-radius: 7px;
      }

      .card-name {
        font-size: 11.5px;
      }

      .card-preview {
        max-width: 100px;
        font-size: 10px;
      }

      .connector-line {
        width: 20px;
      }

      .count-chip {
        padding: 2px 8px;
        font-size: 10px;
        margin-right: 6px;
      }
    }

    /* ── prefers-reduced-motion ── */
    @media (prefers-reduced-motion: reduce) {
      .child-card {
        animation: none;
      }
      .root-icon::after {
        animation: none;
        opacity: 0.5;
      }
      .connector-line::after {
        animation: none;
        display: none;
      }
      .status-indicator.running {
        animation: none;
      }
      .status-indicator.unread {
        animation: none;
      }
      .card-preview.running {
        animation: none;
      }
    }
  `;

  /**
   * 每次渲染后，动态计算 running 状态预览文本的滚动距离和动画时长。
   * 根据文本实际宽度与容器宽度的差值设置 CSS 变量。
   */
  protected override updated(): void {
    const scrollContainers = this.shadowRoot?.querySelectorAll(".card-preview-scroll");
    if (!scrollContainers) {
      return;
    }
    for (const container of scrollContainers) {
      const textEl = container.querySelector(".card-preview.running") as HTMLElement | null;
      if (!textEl) {
        continue;
      }
      const containerWidth = (container as HTMLElement).offsetWidth;
      const textWidth = textEl.scrollWidth;
      const overflow = textWidth - containerWidth;
      if (overflow > 0) {
        // 滚动距离 = 溢出量，速率约 30px/s，最短 3s 最长 10s
        const duration = Math.min(Math.max(overflow / 30, 3), 10);
        textEl.style.setProperty("--scroll-distance", `-${overflow + 8}px`);
        textEl.style.setProperty("--scroll-duration", `${duration.toFixed(1)}s`);
      } else {
        // 文本未溢出，不需要滚动
        textEl.style.removeProperty("--scroll-distance");
        textEl.style.setProperty("--scroll-duration", "0s");
        textEl.style.animationPlayState = "paused";
      }
    }
  }

  private _getLatestPreview(agentId: string): string {
    const msgs = this.agentMessages.get(agentId);
    if (!msgs || msgs.length === 0) {
      return "";
    }
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      const role = m.role?.toLowerCase();

      // A2A 消息（role="agent"）
      if (role === "agent") {
        const label = m.senderLabel ? `[${m.senderLabel}] ` : "";
        let text = "";
        if (typeof m.content === "string") {
          text = m.content;
        } else if (Array.isArray(m.content)) {
          text = m.content
            .filter((item) => item.type === "text" && item.text)
            .map((item) => item.text!)
            .join(" ");
        }
        if (text.trim()) {
          const preview = label + text.replace(/[#*`_~[\]]/g, "").trim();
          return preview.length > 24 ? preview.slice(0, 24) + "…" : preview;
        }
        if (label) {
          return `${label}A2A 消息`;
        }
        continue;
      }

      // 工具调用结果（role="toolResult"）
      if (role === "toolresult") {
        const toolName = m.toolName ?? "tool";
        return `🔧 ${toolName}`;
      }

      // assistant / Agent 消息
      if (role === "assistant") {
        // 优先提取 text 内容
        let text = "";
        if (typeof m.content === "string") {
          text = m.content;
        } else if (Array.isArray(m.content)) {
          text = m.content
            .filter((item) => item.type === "text" && item.text)
            .map((item) => item.text!)
            .join(" ");
        }
        if (text.trim()) {
          const clean = text.replace(/[#*`_~[\]]/g, "").trim();
          return clean.length > 24 ? clean.slice(0, 24) + "…" : clean;
        }

        // 没有 text 内容时，检查是否有 thinking 内容
        if (Array.isArray(m.content)) {
          const thinkingItem = m.content.find((item) => item.type === "thinking" && item.thinking);
          if (thinkingItem) {
            return "💭 思考中…";
          }

          // 检查是否有 tool_call 内容
          const toolCallItem = m.content.find((item) => item.type === "tool_call");
          if (toolCallItem) {
            const toolName = toolCallItem.name ?? "tool";
            return `🔧 调用 ${toolName}`;
          }
        }
        continue;
      }
    }
    return "";
  }

  private _onCardClick(agentId: string) {
    if (this.expandedAgent === agentId) {
      this.dispatchEvent(new CustomEvent("agent-collapse", { bubbles: true, composed: true }));
    } else {
      this.dispatchEvent(
        new CustomEvent("agent-expand", { detail: { agentId }, bubbles: true, composed: true }),
      );
    }
  }

  private _onLayoutToggle() {
    this.dispatchEvent(new CustomEvent("layout-toggle", { bubbles: true, composed: true }));
  }

  render() {
    if (this.subAgents.length === 0) {
      return nothing;
    }

    const runningCount = this.subAgents.filter((id) => this.activeAgents.has(id)).length;
    const completedCount = this.subAgents.filter((id) => this.completedAgents.has(id)).length;

    return html`
      <div class="bar-bg"></div>
      <div class="bar" role="toolbar" aria-label="Agent 拓扑状态">
        <!-- 主 Agent 节点 -->
        <div class="root-node">
          <div class="root-icon-wrap">
            <div class="root-icon">
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2.5"
                stroke-linecap="round"
                stroke-linejoin="round"
              >
                <circle cx="12" cy="12" r="3"></circle>
                <path d="M12 1v4"></path>
                <path d="M12 19v4"></path>
                <path d="M1 12h4"></path>
                <path d="M19 12h4"></path>
                <path d="M4.22 4.22l2.83 2.83"></path>
                <path d="M16.95 16.95l2.83 2.83"></path>
                <path d="M4.22 19.78l2.83-2.83"></path>
                <path d="M16.95 7.05l2.83-2.83"></path>
              </svg>
            </div>
            ${this.rootRunning ? html`<span class="status-indicator running"></span>` : nothing}
          </div>
          <div class="root-label">
            <span class="root-name">${this.rootAgentName || this.rootAgentId}</span>
            <span class="root-role">orchestrator</span>
          </div>
        </div>

        <!-- 连接线 -->
        <div class="connector">
          <div class="connector-line"></div>
          <div class="connector-arrow"></div>
        </div>

        <!-- 子 Agent 计数 -->
        <span class="count-chip">
          <svg
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
            <circle cx="9" cy="7" r="4"></circle>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
          </svg>
          ${this.subAgents.length}${runningCount > 0
            ? html` · <span style="color:#22c55e">${runningCount} 运行中</span>`
            : ""}${completedCount > 0
            ? html` · <span style="color:#f59e0b">${completedCount} 已完成</span>`
            : ""}
        </span>

        <!-- 子 Agent 卡片 -->
        <div class="children">
          ${this.subAgents.map((agentId) => {
            const agent = this.agents.find((a) => a.id === agentId);
            const agentName = agent?.name || agentId;
            const isRunning = this.activeAgents.has(agentId);
            const isCompleted = this.completedAgents.has(agentId);
            const isUnread = this.unreadAgents.has(agentId);
            const isActive = this.expandedAgent === agentId;
            const preview = this._getLatestPreview(agentId);

            return html`
              <div
                class="child-card ${isActive ? "active" : ""}"
                @click=${() => this._onCardClick(agentId)}
                title="${agentName}${preview ? `\n${preview}` : ""}"
                role="button"
                tabindex="0"
                aria-pressed=${isActive ? "true" : "false"}
                aria-label="${agentName}${isRunning ? "，运行中" : ""}${isCompleted
                  ? "，已完成"
                  : ""}${isUnread ? "，有未读消息" : ""}"
                @keydown=${(e: KeyboardEvent) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    this._onCardClick(agentId);
                  }
                }}
              >
                <div class="card-icon-wrap">
                  <div class="card-icon">
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                      stroke-linecap="round"
                      stroke-linejoin="round"
                    >
                      <rect x="3" y="11" width="18" height="10" rx="2"></rect>
                      <circle cx="9" cy="16" r="1"></circle>
                      <circle cx="15" cy="16" r="1"></circle>
                      <path d="M8 11V7a4 4 0 0 1 8 0v4"></path>
                    </svg>
                  </div>
                  ${isRunning
                    ? html`<span class="status-indicator running"></span>`
                    : isCompleted
                      ? html`<span class="status-indicator completed"></span>`
                      : isUnread
                        ? html`<span class="status-indicator unread"></span>`
                        : nothing}
                </div>
                <div class="card-text">
                  <span class="card-name">${agentName}</span>
                  ${preview
                    ? isRunning
                      ? html`<span class="card-preview-scroll"
                          ><span class="card-preview running">${preview}</span></span
                        >`
                      : html`<span class="card-preview">${preview}</span>`
                    : html`<span class="card-preview empty">等待响应</span>`}
                </div>
              </div>
            `;
          })}
        </div>

        <!-- 布局切换按钮 -->
        <div
          class="layout-btn ${this.layoutMode !== "single" ? "active" : ""} ${this.layoutDisabled
            ? "disabled"
            : ""}"
          role="button"
          tabindex=${this.layoutDisabled ? "-1" : "0"}
          aria-label="布局切换"
          aria-disabled=${this.layoutDisabled ? "true" : "false"}
          @click=${() => {
            if (!this.layoutDisabled) {
              this._onLayoutToggle();
            }
          }}
          @keydown=${(e: KeyboardEvent) => {
            if (!this.layoutDisabled && (e.key === "Enter" || e.key === " ")) {
              e.preventDefault();
              this._onLayoutToggle();
            }
          }}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="3" y="3" width="7" height="7" rx="1"></rect>
            <rect x="14" y="3" width="7" height="7" rx="1"></rect>
            <rect x="3" y="14" width="7" height="7" rx="1"></rect>
            <rect x="14" y="14" width="7" height="7" rx="1"></rect>
          </svg>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "topology-bar": TopologyBar;
  }
}
