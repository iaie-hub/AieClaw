import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { getClient } from "../gateway/client.js";
import { fetchRegistryAgents, fetchHubAgents, updateHubAgentVisibility, downloadHubAgent } from "../gateway/clawhub-api.js";
import { downloadFile } from "../gateway/agents-api.js";
import type { RegistryAgent, AgentsListResponse, HubAgent, HubAgentsListResponse } from "../gateway/clawhub-api.js";
import "./clawhub-agent-card.js";
import "./clawhub-agenthub-card.js";
import "./clawhub-agent-detail.js";
import "./clawhub-agenthub-detail.js";

import "../components/confirm-dialog.js";

type TabKind = "agents" | "agenthub" | "skillhub";

type DialogState =
  | { kind: "none" }
  | { kind: "visibility"; agentId: string; visibility: "public" | "private"; agentName: string };

type ViewState =
  | { kind: "loading" }
  | { kind: "no-api-key" }
  | { kind: "error"; message: string; code?: string }
  | { kind: "ready" };

/**
 * ClawHub 主视图 — 浏览 AgentRegistry 远程注册中心中的 Agent 列表。
 * 包含 在线Agent / AgentHub / SkillHub 页签，支持分页、错误重试。
 */
@customElement("clawhub-view")
export class ClawHubView extends LitElement {
  // ── Subview state ──
  @state() private _selectedAgent: RegistryAgent | null = null;
  @state() private _selectedHubAgent: HubAgent | null = null;

  // ── Tab state ──
  @state() private _activeTab: TabKind = "agents";

  // ── View state ──
  @state() private _viewState: ViewState = { kind: "loading" };
  @state() private _dialog: DialogState = { kind: "none" };

  // ── Agents (Online) data ──
  @state() private _agents: RegistryAgent[] = [];
  @state() private _page = 1;
  @state() private _totalPages = 1;
  @state() private _total = 0;
  private readonly _pageSize = 20;

  // ── AgentHub data ──
  @state() private _hubAgents: HubAgent[] = [];
  @state() private _hubPage = 1;
  @state() private _hubTotalPages = 1;
  @state() private _hubTotal = 0;

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
  `;

  connectedCallback() {
    super.connectedCallback();
    this.addEventListener("download-hub-agent", this._onDownloadHubAgent as unknown as EventListener);
    void this._init();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener("download-hub-agent", this._onDownloadHubAgent as unknown as EventListener);
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

  private async _loadHubAgents() {
    this._viewState = { kind: "loading" };
    try {
      const client = getClient();
      await client.waitConnected();
      const res: HubAgentsListResponse = await fetchHubAgents(
        client,
        this._hubPage,
        this._pageSize,
      );
      this._hubAgents = res.agents;
      this._hubTotal = res.total;
      this._hubTotalPages = Math.max(1, Math.ceil(res.total / this._pageSize));
      this._viewState = { kind: "ready" };
    } catch (err: unknown) {
      this._setErrorState(err, "获取 AgentHub 列表失败");
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
    } else if (tab === "agenthub") {
      void this._loadHubAgents();
    } else {
      // skillhub is static, just set ready state
      this._viewState = { kind: "ready" };
    }
  }

  private _onRetry() {
    if (this._activeTab === "agents") {
      void this._loadAgents();
    } else if (this._activeTab === "agenthub") {
      void this._loadHubAgents();
    }
  }

  private _onPrevPage() {
    if (this._activeTab === "agents") {
      if (this._page > 1) {
        this._page--;
        void this._loadAgents();
      }
    } else if (this._activeTab === "agenthub") {
      if (this._hubPage > 1) {
        this._hubPage--;
        void this._loadHubAgents();
      }
    }
  }

  private _onNextPage() {
    if (this._activeTab === "agents") {
      if (this._page < this._totalPages) {
        this._page++;
        void this._loadAgents();
      }
    } else if (this._activeTab === "agenthub") {
      if (this._hubPage < this._hubTotalPages) {
        this._hubPage++;
        void this._loadHubAgents();
      }
    }
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
    this._selectedHubAgent = null;
  }
  
  private async _onDownloadHubAgent(e: CustomEvent<{ agentId: string; name: string }>) {
    try {
      const client = getClient();
      await client.waitConnected();
      const res = await downloadHubAgent(client, e.detail.agentId, e.detail.name);
      if (!res.downloadPath) {
        throw new Error("未能获取到下载路径");
      }
      
      const fileData = await downloadFile(client, res.downloadPath);
      const rawName = e.detail.name || fileData.fileName || "agent-download";
      const downloadName = rawName.endsWith(".zip") ? rawName : `${rawName}.zip`;

      const bytes = Uint8Array.from(atob(fileData.data), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: fileData.mimeType || "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = downloadName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Failed to download agent", err);
      alert(`下载失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private _onToggleVisibility(e: CustomEvent<{ agentId: string; visibility: "public" | "private"; agentName: string }>) {
    this._dialog = {
      kind: "visibility",
      agentId: e.detail.agentId,
      visibility: e.detail.visibility,
      agentName: e.detail.agentName,
    };
  }

  private async _onConfirmVisibilityToggle() {
    if (this._dialog.kind !== "visibility") return;
    const { agentId, visibility } = this._dialog;
    this._dialog = { kind: "none" };
    try {
      const client = getClient();
      await client.waitConnected();
      const res = await updateHubAgentVisibility(client, agentId, visibility);
      if (res.success && res.agent) {
        // update locally
        this._hubAgents = this._hubAgents.map((a) =>
          a.id === agentId ? { ...a, visibility: res.agent!.visibility } : a
        );
        if (this._selectedHubAgent && this._selectedHubAgent.id === agentId) {
          this._selectedHubAgent = { ...this._selectedHubAgent, visibility: res.agent!.visibility };
        }
      }
    } catch (err) {
      console.error("Failed to update visibility", err);
      alert(`修改可见性失败: ${err instanceof Error ? err.message : String(err)}`);
    }
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

    if (this._selectedHubAgent) {
      return html`
        <clawhub-agenthub-detail
          .agent=${this._selectedHubAgent}
          @back=${this._onBackToList}
          @toggle-visibility=${this._onToggleVisibility}
        ></clawhub-agenthub-detail>
        ${this._renderDialogs()}
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
            在线Agent
          </div>
          <div
            class="tab-item ${this._activeTab === "agenthub" ? "active" : ""}"
            @click=${() => this._onTabChange("agenthub")}
          >
            AgentHub
          </div>
          <div
            class="tab-item ${this._activeTab === "skillhub" ? "active" : ""}"
            @click=${() => this._onTabChange("skillhub")}
          >
            SkillHub
          </div>
        </div>
      </div>
      <div class="content-area">${this._renderContent()}</div>
      ${this._renderDialogs()}
    `;
  }

  private _renderDialogs() {
    if (this._dialog.kind === "visibility") {
      const { agentName, visibility } = this._dialog;
      const targetStr = visibility === "public" ? "公开 (Public)" : "私有 (Private)";
      return html`
        <confirm-dialog
          title="修改可见性"
          message="确定要将 Agent「${agentName}」的可见性修改为 ${targetStr} 吗？"
          confirmText="确认修改"
          confirmVariant="primary"
          @confirm=${this._onConfirmVisibilityToggle}
          @cancel=${() => {
            this._dialog = { kind: "none" };
          }}
        ></confirm-dialog>
      `;
    }
    return "";
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
    } else if (this._activeTab === "agenthub") {
      return this._renderAgentHubTab();
    } else {
      return this._renderSkillHubTab();
    }
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
          <div class="center-msg">暂无在线的 Agent</div>
          <div class="center-sub">请检查 AgentRegistry 配置或等待 Agent 上线</div>
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

  private _renderAgentHubTab() {
    if (this._hubAgents.length === 0) {
      return html`
        <div class="center-state">
          <svg class="center-icon" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
            <path stroke-linecap="round" stroke-linejoin="round" d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z" />
          </svg>
          <div class="center-msg">AgentHub 中暂无上传的 Agent</div>
          <div class="center-sub">你可以通过工作台将本地 Agent 共享到这里</div>
        </div>
      `;
    }

    return html`
      <div class="cards-grid">
        ${this._hubAgents.map(
          (agent) => html`
            <clawhub-agenthub-card
              .name=${agent.name}
              .uploaderName=${agent.uploader_name}
              .description=${agent.description}
              .visibility=${agent.visibility}
              .fileSize=${agent.file_size}
              .createdAt=${agent.created_at}
              .agentId=${agent.id}
              .canManage=${agent.can_manage || false}
              @click=${() => { this._selectedHubAgent = agent; }}
              @toggle-visibility=${this._onToggleVisibility}
            ></clawhub-agenthub-card>
          `,
        )}
      </div>
      ${this._renderPagination()}
    `;
  }

  private _renderSkillHubTab() {
    return html`
      <div class="center-state">
        <svg class="center-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path stroke-linecap="round" stroke-linejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456zM16.894 20.567L16.5 21.75l-.394-1.183a2.25 2.25 0 00-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 001.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 001.423 1.423l1.183.394-1.183.394a2.25 2.25 0 00-1.423 1.423z" />
        </svg>
        <div class="center-msg" style="font-size: 20px; font-weight: 600; color: #334155;">SkillHub</div>
        <div class="center-sub">Coming Soon<br><br>技能注册和发现功能将在未来的版本中提供。</div>
      </div>
    `;
  }

  private _renderPagination() {
    let currentPage = this._page;
    let currentTotalPages = this._totalPages;
    let currentTotal = this._total;

    if (this._activeTab === "agenthub") {
      currentPage = this._hubPage;
      currentTotalPages = this._hubTotalPages;
      currentTotal = this._hubTotal;
    }

    if (currentTotalPages <= 1) return html``;

    return html`
      <div class="pagination">
        <button
          class="pagination-btn"
          ?disabled=${currentPage <= 1}
          @click=${() => this._onPrevPage()}
        >
          上一页
        </button>
        <span class="pagination-info">
          第 ${currentPage} / ${currentTotalPages} 页（共 ${currentTotal} 条）
        </span>
        <button
          class="pagination-btn"
          ?disabled=${currentPage >= currentTotalPages}
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
