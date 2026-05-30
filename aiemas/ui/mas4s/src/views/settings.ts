import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import "./settings-registry.js";
import "./settings-nats.js";
import type { GatewayBrowserClient } from "../lib/gateway.js";
import type { AgentInfo } from "../store/app-store.js";

/**
 * 系统设置整体框架布局组件（settings.ts）。
 * 管理设置大标题、Skills 样式的页签导航切换，并支持按页签异步渲染独立设置组件。
 */
@customElement("settings-view")
export class SettingsView extends LitElement {
  /** Gateway client instance passed from parent */
  @property({ attribute: false }) client!: GatewayBrowserClient;

  /** Current user role */
  @property({ type: String }) role: string = "viewer";

  /** Local agents list for Bound Agent ID dropdown */
  @property({ attribute: false }) localAgents: AgentInfo[] = [];

  @state() private _activeTab: "register" | "nats" = "register";

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      height: 100%;
      background: white;
      overflow: hidden;
    }

    .header-area {
      flex-shrink: 0;
      padding: 24px 32px 0;
      background: white;
      border-bottom: 1px solid #e8edf5;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .header-text {
      flex: 1;
    }

    .page-title {
      font-size: 24px;
      font-weight: 600;
      color: #1e293b;
      margin: 0;
    }

    .subtitle {
      font-size: 14px;
      color: #64748b;
      margin: 6px 0 0;
    }

    .tabs {
      display: flex;
      gap: 32px;
      margin-top: 8px;
    }

    .tab-item {
      padding: 0 4px 12px;
      font-size: 14px;
      font-weight: 600;
      color: #64748b;
      cursor: pointer;
      position: relative;
    }

    .tab-item:hover {
      color: #1e293b;
    }

    .tab-item.active {
      color: #3b82f6;
    }

    .tab-item.active::after {
      content: "";
      position: absolute;
      bottom: -1px;
      left: 0;
      right: 0;
      height: 2px;
      background: #3b82f6;
      border-radius: 2px 2px 0 0;
      z-index: 1;
    }

    .content-area {
      flex: 1;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
    }
  `;

  render() {
    return html`
      <div class="header-area">
        <div class="header-text">
          <h1 class="page-title">系统设置</h1>
        </div>
        <div class="tabs">
          <div
            class="tab-item ${this._activeTab === "register" ? "active" : ""}"
            @click=${() => (this._activeTab = "register")}
          >
            AgentRegistry
          </div>
          ${this.role === "admin"
            ? html`
                <div
                  class="tab-item ${this._activeTab === "nats" ? "active" : ""}"
                  @click=${() => (this._activeTab = "nats")}
                >
                  NATS 配置
                </div>
              `
            : ""}
        </div>
      </div>

      <div class="content-area">
        ${this._activeTab === "register"
          ? html`
              <settings-registry
                .client=${this.client}
                .role=${this.role}
                .localAgents=${this.localAgents}
              ></settings-registry>
            `
          : ""}
        ${this._activeTab === "nats" && this.role === "admin"
          ? html`
              <settings-nats
                .client=${this.client}
                .role=${this.role}
                .localAgents=${this.localAgents}
              ></settings-nats>
            `
          : ""}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "settings-view": SettingsView;
  }
}
