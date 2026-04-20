import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { ChatAttachment } from "../lib/chat-types.js";
import type { MasSession } from "../types/session-types.js";
import "../views/chat-input.js";

/**
 * global-input-bar — 全局悬浮输入框。
 *
 * 固定在 primary-panel 底部，支持折叠/展开，允许遮盖消息区域。
 * 通过 activeTarget 指定当前消息发送目标：
 *   - "root" → 发送到根 Agent（触发 send-message 事件）
 *   - agentId → 发送到指定子 Agent（触发 drawer-send-message 事件）
 *
 * 点击 topology-bar 卡片或 grid-slot 切换 activeTarget。
 */
@customElement("global-input-bar")
export class GlobalInputBar extends LitElement {
  /** 当前输入目标："root" 或子 Agent ID */
  @property({ type: String }) activeTarget = "root";
  /** 根 Agent 会话 */
  @property({ attribute: false }) session: MasSession | undefined = undefined;
  /** 是否正在对话中（根 Agent） */
  @property({ type: Boolean }) isChatting = false;
  /** Agent 信息列表（用于显示目标名称） */
  @property({ attribute: false })
  agents: { id: string; name?: string }[] = [];
  /** 根 Agent 名称 */
  @property({ type: String }) rootAgentName = "";

  @state() private _collapsed = false;

  static styles = css`
    :host {
      display: block;
      position: relative;
      z-index: 50;
      flex-shrink: 0;
      background: #ffffff;
      border-radius: 0 0 20px 20px;
    }

    .bar-wrapper {
      margin: 0;
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(12px);
      -webkit-backdrop-filter: blur(12px);
      border-top: 1px solid #e2e8f0;
      overflow: hidden;
    }

    /* 目标选择条 */
    .target-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 14px 6px;
      border-bottom: 1px solid #f1f5f9;
      gap: 8px;
      cursor: pointer;
      user-select: none;
      transition: background 0.15s;
    }

    .target-bar:hover {
      background: #f8fafc;
    }

    .target-bar:hover .collapse-btn {
      color: #475569;
      background: #e2e8f0;
    }

    .target-left {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      flex: 1;
    }

    .target-label {
      font-size: 11px;
      color: #94a3b8;
      font-weight: 500;
      flex-shrink: 0;
    }

    .target-name {
      font-size: 12px;
      font-weight: 650;
      color: #1e293b;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .target-badge {
      display: inline-flex;
      align-items: center;
      padding: 2px 7px;
      border-radius: 10px;
      font-size: 10px;
      font-weight: 600;
      flex-shrink: 0;
    }

    .target-badge.root {
      background: #eff6ff;
      color: #2563eb;
    }

    .target-badge.sub {
      background: #f0fdf4;
      color: #16a34a;
    }

    .collapse-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      border-radius: 6px;
      border: none;
      background: none;
      pointer-events: none;
      color: #94a3b8;
      flex-shrink: 0;
      transition: all 0.15s;
      padding: 0;
    }

    .collapse-icon {
      transition: transform 0.22s ease;
    }

    .collapse-icon.up {
      transform: rotate(180deg);
    }

    /* 输入区 */
    .input-area {
      padding: 8px 12px 12px;
      overflow: hidden;
      max-height: 200px;
      transition:
        max-height 0.22s cubic-bezier(0.4, 0, 0.2, 1),
        padding 0.22s cubic-bezier(0.4, 0, 0.2, 1);
    }

    .input-area.collapsed {
      max-height: 0;
      padding-top: 0;
      padding-bottom: 0;
    }
  `;
  private _onSendMessage = (
    e: CustomEvent<{ sessionKey: string; text: string; attachments?: ChatAttachment[] }>,
  ) => {
    if (this.activeTarget === "root") {
      // 目标是根 Agent 时，允许 chat-input 的原始 send-message 事件自然冒泡到上层 (main-workspace / app-shell)
      // 不再进行 e.stopPropagation() + dispatchEvent 冗余转发，避免多层转发产生重复事件
      return;
    }

    // 目标是子 Agent 时，拦截原始事件并转换为 drawer-send-message 发送
    e.stopPropagation();
    this.dispatchEvent(
      new CustomEvent("drawer-send-message", {
        detail: {
          agentId: this.activeTarget,
          text: e.detail.text,
          attachments: e.detail.attachments,
        },
        bubbles: true,
        composed: true,
      }),
    );
  };

  private _onAbortChat = (e: Event) => {
    e.stopPropagation();
    this.dispatchEvent(new CustomEvent("abort-chat", { bubbles: true, composed: true }));
  };

  private _toggleCollapse = (e: Event) => {
    e.stopPropagation();
    this._collapsed = !this._collapsed;
  };

  private _getTargetName(): string {
    if (this.activeTarget === "root") {
      return this.rootAgentName || "根 Agent";
    }
    const agent = this.agents.find((a) => a.id === this.activeTarget);
    return agent?.name || this.activeTarget;
  }

  private _getSessionForInput(): MasSession | undefined {
    if (this.activeTarget === "root") {
      return this.session;
    }
    return { key: `sub-agent:${this.activeTarget}` } as unknown as MasSession;
  }

  render() {
    const targetName = this._getTargetName();
    const isRoot = this.activeTarget === "root";
    const inputSession = this._getSessionForInput();

    return html`
      <div class="bar-wrapper">
        <div class="target-bar" @click=${this._toggleCollapse}>
          <div class="target-left">
            <span class="target-label">发送至</span>
            <span class="target-name">${targetName}</span>
            <span class="target-badge ${isRoot ? "root" : "sub"}">
              ${isRoot ? "主 Agent" : "子 Agent"}
            </span>
          </div>
          <button
            class="collapse-btn"
            title=${this._collapsed ? "展开输入框" : "折叠输入框"}
            aria-label=${this._collapsed ? "展开输入框" : "折叠输入框"}
          >
            <svg
              class="collapse-icon ${this._collapsed ? "up" : ""}"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2.5"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="6 9 12 15 18 9"></polyline>
            </svg>
          </button>
        </div>
        <div class="input-area ${this._collapsed ? "collapsed" : ""}">
          ${inputSession
            ? html`<chat-input
                .session=${inputSession}
                .isChatting=${isRoot ? this.isChatting : false}
                @send-message=${this._onSendMessage}
                @abort-chat=${this._onAbortChat}
              ></chat-input>`
            : nothing}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "global-input-bar": GlobalInputBar;
  }
}
