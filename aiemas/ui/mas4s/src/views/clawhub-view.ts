import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { getClient } from "../gateway/client.js";
import { fetchRegistryAgents } from "../gateway/clawhub-api.js";
import type { RegistryAgent, AgentsListResponse } from "../gateway/clawhub-api.js";
import { aggregateSkills, filterSkills } from "../utils/skill-aggregator.js";
import type { AggregatedSkill } from "../utils/skill-aggregator.js";
import "./clawhub-agent-card.js";
import "./clawhub-skill-card.js";
import "./clawhub-agent-detail.js";

type TabKind = "agents" | "skills";

type ViewState =
  | { kind: "loading" }
  | { kind: "no-api-key" }
  | { kind: "error"; message: string; code?: string }
  | { kind: "ready" };

/**
 * ClawHub 主视图 — 浏览 AgentRegistry 远程注册中心中的 Agent 和 Skill 列表。
 * 包含 Agents / Skills 两个页签，支持分页、搜索过滤、错误重试。
 */
@customElement("clawhub-view")
export class ClawHubView extends LitElement {
  // ── Subview state ──
  @state() private _selectedAgent: RegistryAgent | null = null;

  // ── Tab state ──
  @state() private _activeTab: TabKind = "agents";

  // ── View state ──
  @state() private _viewState: ViewState = { kind: "loading" };

  // ── Agents data ──
  @state() private _agents: RegistryAgent[] = [];
  @state() private _page = 1;
  @state() private _totalPages = 1;
  @state() private _total = 0;
  private readonly _pageSize = 20;

  // ── Skills data ──
  @state() private _skills: AggregatedSkill[] = [];
  @state() private _skillSearch = "";

  // ── Cached full agent list for skills aggregation ──
  private _allAgentsForSkills: RegistryAgent[] | null = null;

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      height: 100%;
      background: #f1f5f9;
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

    /* ── Tabs ── */
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

    /* ── Content area ── */
    .content-area {
      flex: 1;
      padding: 32px;
      overflow-y: auto;
    }

    /* ── Cards grid ── */
    .cards-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 20px;
    }

    @media (max-width: 1200px) {
      .cards-grid {
        grid-template-columns: repeat(2, 1fr);
      }
    }

    @media (max-width: 768px) {
      .cards-grid {
        grid-template-columns: 1fr;
      }
      .header-area {
        padding: 16px;
        flex-direction: column;
      }
      .content-area {
        padding: 16px;
      }
    }

    /* ── Center state ── */
    .center-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: #94a3b8;
      text-align: center;
    }

    .center-icon {
      width: 64px;
      height: 64px;
      margin-bottom: 16px;
      color: #cbd5e1;
    }

    .center-msg {
      font-size: 15px;
      margin-bottom: 8px;
      color: #64748b;
    }

    .center-sub {
      font-size: 13px;
      color: #94a3b8;
      margin-bottom: 24px;
    }

    .error-msg {
      color: #ef4444;
      font-size: 15px;
      margin-bottom: 16px;
      max-width: 400px;
    }

    /* ── Buttons ── */
    .btn-primary {
      padding: 10px 20px;
      background: linear-gradient(135deg, #3b82f6 0%, #6366f1 100%);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: opacity 0.2s;
    }

    .btn-primary:hover {
      opacity: 0.9;
    }

    .btn-link {
      padding: 8px 16px;
      background: transparent;
      color: #3b82f6;
      border: 1px solid #3b82f6;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
    }

    .btn-link:hover {
      background: #eff6ff;
    }

    /* ── Search box ── */
    .search-box {
      position: relative;
      display: flex;
      align-items: center;
    }

    .search-box input {
      padding: 8px 12px 8px 34px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      font-size: 14px;
      outline: none;
      width: 240px;
      transition: all 0.2s;
      background: #f8fafc;
    }

    .search-box input:focus {
      background: white;
      border-color: #3b82f6;
      box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.1);
    }

    .search-icon {
      position: absolute;
      left: 10px;
      color: #94a3b8;
    }

    /* ── Pagination ── */
    .pagination {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 12px;
      padding: 24px 0 8px;
    }

    .pagination-info {
      font-size: 14px;
      color: #64748b;
    }

    .pagination-btn {
      padding: 8px 16px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      background: white;
      color: #475569;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
    }

    .pagination-btn:hover:not(:disabled) {
      background: #f8fafc;
      border-color: #cbd5e1;
    }

    .pagination-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    /* ── Loading spinner ── */
    .spinner {
      width: 32px;
      height: 32px;
      border: 3px solid #e2e8f0;
      border-top-color: #3b82f6;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-bottom: 16px;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    /* ── Skills toolbar ── */
    .skills-toolbar {
      display: flex;
      align-items: center;
      gap: 16px;
      margin-bottom: 24px;
    }

    .skills-count {
      font-size: 13px;
      color: #94a3b8;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    void this._init();
  }

  // ── Initialization ──────────────────────────────────────────────────────────

  private async _init() {
    void this._loadAgents();
  }

  // ── Data loading ────────────────────────────────────────────────────────────

  private async _loadAgents() {
    this._viewState = { kind: "loading" };
    try {
      const client = getClient();
      await client.waitConnected();
      const res: AgentsListResponse = await fetchRegistryAgents(
        client,
        this._page,
        this._pageSize,
      );
      this._agents = res.agents;
      this._total = res.total;
      this._totalPages = Math.max(1, Math.ceil(res.total / this._pageSize));
      this._viewState = { kind: "ready" };
    } catch (err: unknown) {
      this._setErrorState(err, "获取 Agent 列表失败");
    }
  }

  private async _loadSkills() {
    // If we already have cached agents for skills, use them
    if (this._allAgentsForSkills) {
      this._skills = aggregateSkills(this._allAgentsForSkills);
      this._viewState = { kind: "ready" };
      return;
    }

    this._viewState = { kind: "loading" };
    try {
      const client = getClient();
      await client.waitConnected();
      // Fetch all agents (page 1 with large page size to get all for aggregation)
      const res: AgentsListResponse = await fetchRegistryAgents(client, 1, 100);
      this._allAgentsForSkills = res.agents;
      this._skills = aggregateSkills(res.agents);
      this._viewState = { kind: "ready" };
    } catch (err: unknown) {
      this._setErrorState(err, "获取技能列表失败");
    }
  }

  private _setErrorState(err: unknown, defaultMessage: string) {
    const message = err instanceof Error ? err.message : defaultMessage;
    let code = "";
    if (err && typeof err === "object" && "gatewayCode" in err) {
      code = String((err as { gatewayCode?: unknown }).gatewayCode ?? "");
    }
    this._viewState = { kind: "error", message, code };
  }

  // ── Event handlers ──────────────────────────────────────────────────────────

  private _onTabChange(tab: TabKind) {
    if (this._activeTab === tab) return;
    this._activeTab = tab;
    if (tab === "agents") {
      void this._loadAgents();
    } else {
      void this._loadSkills();
    }
  }

  private _onRetry() {
    if (this._activeTab === "agents") {
      void this._loadAgents();
    } else {
      void this._loadSkills();
    }
  }

  private _onPrevPage() {
    if (this._page > 1) {
      this._page--;
      void this._loadAgents();
    }
  }

  private _onNextPage() {
    if (this._page < this._totalPages) {
      this._page++;
      void this._loadAgents();
    }
  }

  private _onSkillSearch(e: Event) {
    this._skillSearch = (e.target as HTMLInputElement).value;
  }

  private _onGoToSettings() {
    this.dispatchEvent(
      new CustomEvent("nav-change", {
        detail: { nav: "settings" },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _onBackToList() {
    this._selectedAgent = null;
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  render() {
    if (this._selectedAgent) {
      return html`
        <clawhub-agent-detail
          .agent=${this._selectedAgent}
          @back=${this._onBackToList}
        ></clawhub-agent-detail>
      `;
    }

    return html`
      <div class="header-area">
        <div class="header-text">
          <h1 class="page-title">ClawHub</h1>
          <p class="subtitle">浏览 AgentRegistry 远程注册中心</p>
        </div>
        <div class="tabs">
          <div
            class="tab-item ${this._activeTab === "agents" ? "active" : ""}"
            @click=${() => this._onTabChange("agents")}
          >
            Agents
          </div>
          <div
            class="tab-item ${this._activeTab === "skills" ? "active" : ""}"
            @click=${() => this._onTabChange("skills")}
          >
            Skills
          </div>
        </div>
      </div>
      <div class="content-area">${this._renderContent()}</div>
    `;
  }

  private _renderContent() {
    const vs = this._viewState;

    // Loading state
    if (vs.kind === "loading") {
      return html`
        <div class="center-state">
          <div class="spinner"></div>
          <div class="center-msg">加载中...</div>
        </div>
      `;
    }

    // API Key not configured
    if (
      vs.kind === "no-api-key" ||
      (vs.kind === "error" && (
        vs.code === "API_KEY_NOT_CONFIGURED" ||
        vs.message.includes("API_KEY_NOT_CONFIGURED") ||
        vs.message.includes("API Key not configured")
      ))
    ) {
      return html`
        <div class="center-state">
          <svg class="center-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"></path>
          </svg>
          <div class="center-msg">API Key 未配置</div>
          <div class="center-sub">请先在设置页面配置 AgentRegistry API Key</div>
          <button class="btn-link" @click=${this._onGoToSettings}>设置API Key</button>
        </div>
      `;
    }

    // Error state
    if (vs.kind === "error") {
      return html`
        <div class="center-state">
          <svg class="center-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="8" x2="12" y2="12"></line>
            <line x1="12" y1="16" x2="12.01" y2="16"></line>
          </svg>
          <div class="error-msg">${vs.message}</div>
          <button class="btn-primary" @click=${() => this._onRetry()}>重试</button>
        </div>
      `;
    }

    // Ready state — render tab content
    if (this._activeTab === "agents") {
      return this._renderAgentsTab();
    }
    return this._renderSkillsTab();
  }

  private _renderAgentsTab() {
    if (this._agents.length === 0) {
      return html`
        <div class="center-state">
          <svg class="center-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
            <circle cx="9" cy="7" r="4"></circle>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
          </svg>
          <div class="center-msg">暂无已注册的 Agent</div>
          <div class="center-sub">请检查 AgentRegistry 配置或等待 Agent 注册</div>
        </div>
      `;
    }

    return html`
      <div class="cards-grid">
        ${this._agents.map(
          (agent) => html`
            <clawhub-agent-card
              .name=${agent.card.name}
              .agentId=${agent.card.agent_id}
              .status=${agent.status}
              .skills=${agent.card.skills}
              @click=${() => { this._selectedAgent = agent; }}
            ></clawhub-agent-card>
          `,
        )}
      </div>
      ${this._renderPagination()}
    `;
  }

  private _renderSkillsTab() {
    const filtered = this._skillSearch
      ? filterSkills(this._skills, this._skillSearch)
      : this._skills;

    return html`
      <div class="skills-toolbar">
        <div class="search-box">
          <svg
            class="search-icon"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input
            type="text"
            placeholder="搜索技能名称..."
            .value=${this._skillSearch}
            @input=${this._onSkillSearch}
          />
        </div>
        <span class="skills-count">${filtered.length} 个技能</span>
      </div>
      ${this._renderSkillsContent(filtered)}
    `;
  }

  private _renderSkillsContent(filtered: AggregatedSkill[]) {
    // Empty state (no skills at all)
    if (this._skills.length === 0) {
      return html`
        <div class="center-state">
          <svg class="center-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <polygon points="12 2 2 7 12 12 22 7 12 2"></polygon>
            <polyline points="2 17 12 22 22 17"></polyline>
            <polyline points="2 12 12 17 22 12"></polyline>
          </svg>
          <div class="center-msg">暂无已注册的技能</div>
          <div class="center-sub">当前 AgentRegistry 远程注册中心无已注册的技能</div>
        </div>
      `;
    }

    // No search results
    if (filtered.length === 0 && this._skillSearch) {
      return html`
        <div class="center-state">
          <svg class="center-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            <line x1="8" y1="11" x2="14" y2="11"></line>
          </svg>
          <div class="center-msg">未找到匹配的技能</div>
          <div class="center-sub">尝试使用其他关键词搜索</div>
        </div>
      `;
    }

    return html`
      <div class="cards-grid">
        ${filtered.map(
          (skill) => html`
            <clawhub-skill-card
              .name=${skill.name}
              .agents=${skill.agents}
            ></clawhub-skill-card>
          `,
        )}
      </div>
    `;
  }

  private _renderPagination() {
    if (this._totalPages <= 1) return html``;

    return html`
      <div class="pagination">
        <button
          class="pagination-btn"
          ?disabled=${this._page <= 1}
          @click=${() => this._onPrevPage()}
        >
          上一页
        </button>
        <span class="pagination-info">
          第 ${this._page} / ${this._totalPages} 页（共 ${this._total} 条）
        </span>
        <button
          class="pagination-btn"
          ?disabled=${this._page >= this._totalPages}
          @click=${() => this._onNextPage()}
        >
          下一页
        </button>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "clawhub-view": ClawHubView;
  }
}
