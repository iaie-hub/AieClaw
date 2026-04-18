import { LitElement, html, css, type TemplateResult } from "lit";
import { customElement, property } from "lit/decorators.js";

export type NavItem = "workspace" | "usage" | "agents" | "skills" | "cron" | "users" | "settings";

const ICON_WORKSPACE = html`
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
  </svg>
`;
const ICON_USAGE = html`
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <line x1="18" y1="20" x2="18" y2="10"></line>
    <line x1="12" y1="20" x2="12" y2="4"></line>
    <line x1="6" y1="20" x2="6" y2="14"></line>
  </svg>
`;
const ICON_AGENTS = html`
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <rect x="3" y="3" width="7" height="7"></rect>
    <rect x="14" y="3" width="7" height="7"></rect>
    <rect x="14" y="14" width="7" height="7"></rect>
    <rect x="3" y="14" width="7" height="7"></rect>
  </svg>
`;
const ICON_SKILLS = html`
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
    <polyline points="2 17 12 22 22 17"></polyline>
    <polyline points="2 12 12 17 22 12"></polyline>
  </svg>
`;
const ICON_CRON = html`
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <circle cx="12" cy="12" r="10"></circle>
    <polyline points="12 6 12 12 16 14"></polyline>
  </svg>
`;
const ICON_USERS = html`
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
    <circle cx="9" cy="7" r="4"></circle>
    <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
    <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
  </svg>
`;
const ICON_SETTINGS = html`
  <svg
    width="20"
    height="20"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <circle cx="12" cy="12" r="3"></circle>
    <path
      d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V12a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"
    ></path>
  </svg>
`;

const NAV_ITEMS: Array<{ id: NavItem; label: string; icon: TemplateResult }> = [
  { id: "workspace", label: "工作台", icon: ICON_WORKSPACE },
  { id: "usage", label: "使用情况", icon: ICON_USAGE },
  { id: "agents", label: "智能体", icon: ICON_AGENTS },
  { id: "skills", label: "Skills", icon: ICON_SKILLS },
  { id: "cron", label: "定时任务", icon: ICON_CRON },
  { id: "users", label: "用户列表", icon: ICON_USERS },
];

const BOTTOM_ITEMS: Array<{ id: NavItem; label: string; icon: TemplateResult }> = [
  { id: "settings", label: "设置", icon: ICON_SETTINGS },
];

const LOGOUT_ICON = html`
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="18"
    height="18"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <polyline points="16 17 21 12 16 7" />
    <line x1="21" y1="12" x2="9" y2="12" />
  </svg>
`;

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
      padding-top: 20px;
      flex-shrink: 0;
      z-index: 10;
      box-sizing: border-box;
      -webkit-text-size-adjust: 100%;
      text-size-adjust: 100%;
    }

    .logo {
      width: 46px;
      height: 46px;
      background: #eff6ff;
      border-radius: 14px;
      margin-bottom: 24px;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #2563eb;
      font-weight: 900;
      font-size: 16px;
      letter-spacing: 1px;
      flex-shrink: 0;
    }

    .nav-list {
      display: flex;
      flex-direction: column;
      align-items: center;
      flex: 1;
      width: 100%;
      gap: 4px;
    }

    .nav-item {
      width: 68px;
      /* 增加高度给文字留出空间 */
      height: 72px;
      border-radius: 14px;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: #94a3b8;
      /* 明确 12px，绕过浏览器最小字体限制 */
      font-size: 12px;
      line-height: 1.2;
      font-weight: 600;
      letter-spacing: 0.2px;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      user-select: none;
      border: none;
      background: none;
      padding: 0;
      position: relative;
    }

    .nav-label {
      /* 独立 span 控制字体，避免继承被覆盖 */
      font-size: 12px;
      font-weight: 600;
      line-height: 1;
      letter-spacing: 0.2px;
      margin-top: 5px;
      white-space: nowrap;
    }

    .nav-icon-wrapper {
      width: 40px;
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      border-radius: 12px;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
    }

    /* 激活态 */
    .nav-item.active {
      color: #2563eb;
    }

    .nav-item.active .nav-label {
      color: #2563eb;
      font-weight: 700;
    }

    .nav-item.active .nav-icon-wrapper {
      background: #eff6ff;
      color: #2563eb;
    }

    /* 悬停态 */
    .nav-item:hover:not(.active) {
      color: #475569;
    }

    .nav-item:hover:not(.active) .nav-label {
      color: #475569;
    }

    .nav-item:hover:not(.active) .nav-icon-wrapper {
      background: #f8fafc;
      color: #475569;
    }

    /* 左侧激活指示条 */
    .nav-item.active::before {
      content: "";
      position: absolute;
      left: -2px;
      top: 50%;
      transform: translateY(-50%);
      width: 3px;
      height: 28px;
      background: #2563eb;
      border-radius: 0 4px 4px 0;
    }

    .spacer {
      flex: 1;
    }

    .bottom-nav {
      display: flex;
      flex-direction: column;
      align-items: center;
      padding-bottom: 20px;
      padding-top: 8px;
      width: 100%;
      gap: 4px;
      border-top: 1px solid #f1f5f9;
    }
  `;

  private _onNavClick(id: NavItem) {
    this.dispatchEvent(new CustomEvent("nav-change", { detail: { nav: id }, bubbles: true }));
  }

  private _onLogoutClick() {
    this.dispatchEvent(new CustomEvent("logout", { bubbles: true }));
  }

  private _renderItem(item: { id: NavItem; label: string; icon: TemplateResult }) {
    const isActive = this.activeNav === item.id;
    return html`
      <button
        class="nav-item ${isActive ? "active" : ""}"
        @click=${() => this._onNavClick(item.id)}
        aria-label=${item.label}
        aria-current=${isActive ? "page" : "false"}
      >
        <div class="nav-icon-wrapper">${item.icon}</div>
        <span class="nav-label">${item.label}</span>
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
        <button class="nav-item" @click=${() => this._onLogoutClick()} aria-label="退出登录">
          <div class="nav-icon-wrapper">${LOGOUT_ICON}</div>
          <span class="nav-label">登出</span>
        </button>
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
