import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { AgentEntry } from "../types/agents-types.js";
import "./agent-detail/agent-detail-tab-files.js";
import "./agent-detail/agent-detail-tab-tools.js";
import "./agent-detail/agent-detail-tab-skills.js";
import "./agent-detail/agent-detail-tab-channels.js";
import "./agent-detail/agent-detail-tab-cron.js";

type TabId = "files" | "tools" | "skills" | "channels" | "cron";

const TABS: Array<{ id: TabId; label: string }> = [
  { id: "files", label: "文件 (Files)" },
  { id: "tools", label: "工具 (Tools)" },
  { id: "skills", label: "技能 (Skills)" },
  { id: "channels", label: "频道 (Channels)" },
  { id: "cron", label: "定时任务 (Cron)" },
];

/**
 * 智能体详情页面 — 二级页面壳，管理页签切换，
 * 每个页签由独立子组件实现（按需加载数据）。
 */
@customElement("agent-detail-dialog")
export class AgentDetailDialog extends LitElement {
  @property({ attribute: false }) agent!: AgentEntry;
  @property({ type: Boolean }) isDefault = false;

  @state() private _activeTab: TabId = "files";
  /** 记录已激活过的页签，保持 DOM 不销毁 */
  private _mountedTabs = new Set<TabId>(["files"]);

  connectedCallback() {
    super.connectedCallback();
    // 首次渲染后，对默认页签触发数据加载
    void this.updateComplete.then(() => {
      const el = this.shadowRoot?.querySelector(`agent-tab-${this._activeTab}`);
      if (el && "refresh" in el && typeof el.refresh === "function") {
        el.refresh();
      }
    });
  }

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      height: 100%;
      background: #f1f5f9;
      overflow: hidden;
    }

    /* ── Page header ── */
    .page-header {
      flex-shrink: 0;
      padding: 20px 32px 16px;
      background: white;
      border-bottom: 1px solid #e8edf5;
    }
    .back-row {
      margin-bottom: 14px;
    }
    .back-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      background: none;
      border: none;
      color: #3b82f6;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      padding: 4px 0;
      transition: color 0.15s;
    }
    .back-btn:hover {
      color: #2563eb;
    }
    .back-btn svg {
      width: 16px;
      height: 16px;
    }
    .header-title {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 20px;
      font-weight: 600;
      color: #1e293b;
      margin-bottom: 10px;
    }
    .agent-badge {
      background: #6366f1;
      color: white;
      padding: 3px 8px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 600;
    }
    .default-badge {
      background: #eff6ff;
      color: #3b82f6;
      padding: 2px 8px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 600;
    }
    .info-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      font-size: 13px;
      color: #64748b;
    }
    .info-bar span {
      font-weight: 600;
      color: #1e293b;
    }

    /* ── Tabs ── */
    .tabs {
      display: flex;
      gap: 4px;
      padding: 0 32px;
      background: white;
      border-bottom: 1px solid #e8edf5;
      flex-shrink: 0;
      overflow-x: auto;
    }
    .tab-btn {
      background: none;
      border: none;
      padding: 12px 16px;
      font-size: 13px;
      font-weight: 500;
      color: #64748b;
      cursor: pointer;
      border-bottom: 2px solid transparent;
      transition: all 0.15s;
      white-space: nowrap;
    }
    .tab-btn:hover {
      color: #1e293b;
    }
    .tab-btn.active {
      color: #e53935;
      border-bottom-color: #e53935;
      background: #ffebee;
      border-radius: 6px 6px 0 0;
    }

    /* ── Body ── */
    .page-body {
      flex: 1;
      overflow-y: auto;
      padding: 24px 32px;
    }
    .tab-panel {
      display: none;
    }
    .tab-panel[active] {
      display: block;
    }
  `;

  private _switchTab(tab: TabId) {
    this._activeTab = tab;
    this._mountedTabs.add(tab);
    // 每次切换页签时，通知子组件重新拉取数据
    void this.updateComplete.then(() => {
      const el = this.shadowRoot?.querySelector(`agent-tab-${tab}`);
      if (el && "refresh" in el && typeof el.refresh === "function") {
        el.refresh();
      }
    });
  }

  private _goBack() {
    this.dispatchEvent(new CustomEvent("back", { bubbles: true }));
  }

  render() {
    const a = this.agent;
    const displayName = a.name || a.id;

    return html`
      <div class="page-header">
        <div class="back-row">
          <button class="back-btn" @click=${() => this._goBack()}>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <polyline points="15 18 9 12 15 6"></polyline>
            </svg>
            返回
          </button>
        </div>
        <div class="header-title">
          <span class="agent-badge">⬢ 智能体</span>
          ${displayName} ${this.isDefault ? html`<span class="default-badge">默认</span>` : nothing}
        </div>
        <div class="info-bar">
          <div>主模型: <span>${a.model.primary}</span></div>
          ${a.model.fallbacks.length > 0
            ? html`<div>回退模型: <span>${a.model.fallbacks.join(", ")}</span></div>`
            : nothing}
          <div>工作区: <span>${a.workspace}</span></div>
        </div>
      </div>

      <div class="tabs">
        ${TABS.map(
          (t) => html`
            <button
              class="tab-btn ${this._activeTab === t.id ? "active" : ""}"
              @click=${() => this._switchTab(t.id)}
            >
              ${t.label}
            </button>
          `,
        )}
      </div>

      <div class="page-body">
        ${this._mountedTabs.has("files")
          ? html` <div class="tab-panel" ?active=${this._activeTab === "files"}>
              <agent-tab-files .agentId=${a.id}></agent-tab-files>
            </div>`
          : nothing}
        ${this._mountedTabs.has("tools")
          ? html` <div class="tab-panel" ?active=${this._activeTab === "tools"}>
              <agent-tab-tools .agentId=${a.id}></agent-tab-tools>
            </div>`
          : nothing}
        ${this._mountedTabs.has("skills")
          ? html` <div class="tab-panel" ?active=${this._activeTab === "skills"}>
              <agent-tab-skills .agentId=${a.id}></agent-tab-skills>
            </div>`
          : nothing}
        ${this._mountedTabs.has("channels")
          ? html` <div class="tab-panel" ?active=${this._activeTab === "channels"}>
              <agent-tab-channels></agent-tab-channels>
            </div>`
          : nothing}
        ${this._mountedTabs.has("cron")
          ? html` <div class="tab-panel" ?active=${this._activeTab === "cron"}>
              <agent-tab-cron></agent-tab-cron>
            </div>`
          : nothing}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "agent-detail-dialog": AgentDetailDialog;
  }
}
