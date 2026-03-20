import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";

export type NavItem = "workspace" | "usage" | "agents" | "skills" | "cron" | "settings";

const NAV_ITEMS: Array<{ id: NavItem; label: string; icon: string }> = [
  { id: "workspace", label: "工作台", icon: "💬" },
  { id: "usage", label: "使用情况", icon: "📊" },
  { id: "agents", label: "智能体", icon: "🤖" },
  { id: "skills", label: "Skills", icon: "⚙️" },
  { id: "cron", label: "定时任务", icon: "⏱️" },
];

const BOTTOM_ITEMS: Array<{ id: NavItem; label: string; icon: string }> = [
  { id: "settings", label: "设置", icon: "🔧" },
];

/**
 * 一级导航侧边栏（80px 宽）。
 * 触发 nav-change 事件通知父组件切换视图。
 */
@customElement("primary-sidebar")
export class PrimarySidebar extends LitElement {
  @property({ type: String }) activeNav: NavItem = "workspace";

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      align-items: center;
      width: 80px;
      min-width: 80px;
      height: 100vh;
      background: #ffffff;
      border-right: 1px solid #e2e8f0;
      padding-top: 24px;
      flex-shrink: 0;
      z-index: 10;
      box-shadow: 2px 0 10px rgba(0, 0, 0, 0.02);
      box-sizing: border-box;
    }

    .logo {
      width: 48px;
      height: 48px;
      background: linear-gradient(135deg, #3b82f6 0%, #6366f1 100%);
      border-radius: 14px;
      margin-bottom: 32px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: white;
      font-weight: 900;
      font-size: 14px;
      box-shadow: 0 4px 12px rgba(59, 130, 246, 0.3);
      letter-spacing: 1px;
      flex-shrink: 0;
    }

    .nav-list {
      display: flex;
      flex-direction: column;
      align-items: center;
      flex: 1;
      width: 100%;
    }

    .nav-item {
      width: 64px;
      height: 64px;
      border-radius: 16px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: #64748b;
      font-size: 11px;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      margin-bottom: 4px;
      user-select: none;
      border: none;
      background: none;
      padding: 0;
    }

    .nav-icon-wrapper {
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 10px;
      transition: all 0.3s;
      margin-bottom: 4px;
      font-size: 18px;
    }

    .nav-item.active {
      color: #3b82f6;
      font-weight: 600;
    }

    .nav-item.active .nav-icon-wrapper {
      background: #eff6ff;
      box-shadow: inset 0 0 0 1px rgba(59, 130, 246, 0.2);
    }

    .nav-item:hover:not(.active) {
      color: #3b82f6;
    }

    .nav-item:hover:not(.active) .nav-icon-wrapper {
      background: #f8fafc;
      transform: translateY(-2px);
    }

    .spacer {
      flex: 1;
    }

    .bottom-nav {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding-bottom: 16px;
    }
  `;

  private _onNavClick(id: NavItem) {
    this.dispatchEvent(new CustomEvent("nav-change", { detail: { nav: id }, bubbles: true }));
  }

  private _renderItem(item: { id: NavItem; label: string; icon: string }) {
    const isActive = this.activeNav === item.id;
    return html`
      <button
        class="nav-item ${isActive ? "active" : ""}"
        @click=${() => this._onNavClick(item.id)}
        aria-label=${item.label}
        aria-current=${isActive ? "page" : "false"}
      >
        <div class="nav-icon-wrapper">${item.icon}</div>
        <span>${item.label}</span>
      </button>
    `;
  }

  render() {
    return html`
      <div class="logo">AIE</div>
      <nav class="nav-list" aria-label="主导航">
        ${NAV_ITEMS.map((item) => this._renderItem(item))}
        <div class="spacer"></div>
      </nav>
      <div class="bottom-nav">
        ${BOTTOM_ITEMS.map((item) => this._renderItem(item))}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "primary-sidebar": PrimarySidebar;
  }
}
