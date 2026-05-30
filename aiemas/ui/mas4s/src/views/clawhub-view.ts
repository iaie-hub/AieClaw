import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { downloadFile, importAgent } from "../gateway/agents-api.js";
import {
  fetchRegistryAgents,
  fetchHubAgents,
  updateHubAgentVisibility,
  downloadHubAgent,
  fetchHubSkills,
  updateHubSkillVisibility,
  downloadHubSkill,
} from "../gateway/clawhub-api.js";
import type {
  RegistryAgent,
  AgentsListResponse,
  HubAgent,
  HubAgentsListResponse,
  HubSkill,
  HubSkillsListResponse,
} from "../gateway/clawhub-api.js";
import { getClient } from "../gateway/client.js";
import "./clawhub-agent-card.js";
import "./clawhub-agenthub-card.js";
import "./clawhub-agent-detail.js";
import "./clawhub-agenthub-detail.js";
import "./clawhub-skillhub-card.js";
import "./clawhub-skillhub-detail.js";
import "../components/confirm-dialog.js";
import "../components/agent/clawhub-agent-import-dialog.js";
import "../components/toast-message.js";

type TabKind = "agents" | "agenthub" | "skillhub";

type DialogState =
  | { kind: "none" }
  | { kind: "visibility"; agentId: string; visibility: "public" | "private"; agentName: string }
  | {
      kind: "skill-visibility";
      skillId: string;
      visibility: "public" | "private";
      skillName: string;
    }
  | { kind: "import-hub"; hubAgentId: string; hubAgentName: string };

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
  @state() private _selectedHubSkill: HubSkill | null = null;

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

  // ── SkillHub data ──
  @state() private _hubSkills: HubSkill[] = [];
  @state() private _hubSkillPage = 1;
  @state() private _hubSkillTotalPages = 1;
  @state() private _hubSkillTotal = 0;

  // ── Toast state ──
  @state() private _toastMsg = "";
  @state() private _toastError = false;

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
    this.addEventListener(
      "download-hub-agent",
      this._onDownloadHubAgent as unknown as EventListener,
    );
    this.addEventListener(
      "download-hub-skill",
      this._onDownloadHubSkill as unknown as EventListener,
    );
    this.addEventListener("import-hub-agent", this._onImportHubAgent as unknown as EventListener);
    void this._init();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.removeEventListener(
      "download-hub-agent",
      this._onDownloadHubAgent as unknown as EventListener,
    );
    this.removeEventListener(
      "download-hub-skill",
      this._onDownloadHubSkill as unknown as EventListener,
    );
    this.removeEventListener(
      "import-hub-agent",
      this._onImportHubAgent as unknown as EventListener,
    );
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
      const res: AgentsListResponse = await fetchRegistryAgents(client, this._page, this._pageSize);
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

  private async _loadHubSkills() {
    this._viewState = { kind: "loading" };
    try {
      const client = getClient();
      await client.waitConnected();
      const res: HubSkillsListResponse = await fetchHubSkills(
        client,
        this._hubSkillPage,
        this._pageSize,
      );
      this._hubSkills = res.skills;
      this._hubSkillTotal = res.total;
      this._hubSkillTotalPages = Math.max(1, Math.ceil(res.total / this._pageSize));
      this._viewState = { kind: "ready" };
    } catch (err: unknown) {
      this._setErrorState(err, "获取 SkillHub 列表失败");
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
      void this._loadHubSkills();
    }
  }

  private _onRetry() {
    if (this._activeTab === "agents") {
      void this._loadAgents();
    } else if (this._activeTab === "agenthub") {
      void this._loadHubAgents();
    } else if (this._activeTab === "skillhub") {
      void this._loadHubSkills();
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
    } else if (this._activeTab === "skillhub") {
      if (this._hubSkillPage > 1) {
        this._hubSkillPage--;
        void this._loadHubSkills();
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
    } else if (this._activeTab === "skillhub") {
      if (this._hubSkillPage < this._hubSkillTotalPages) {
        this._hubSkillPage++;
        void this._loadHubSkills();
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
    this._selectedHubSkill = null;
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

  private _onImportHubAgent(e: CustomEvent<{ agentId: string; name: string }>) {
    this._dialog = {
      kind: "import-hub",
      hubAgentId: e.detail.agentId,
      hubAgentName: e.detail.name,
    };
  }

  private async _onConfirmImportHubAgent(e: CustomEvent<{ agentId: string; workspace: string }>) {
    if (this._dialog.kind !== "import-hub") return;
    const { hubAgentId, hubAgentName } = this._dialog;
    this._dialog = { kind: "none" };

    this._showToast("正在从 AgentHub 导入智能体...");
    try {
      const client = getClient();
      await client.waitConnected();

      // Step 1: Let the gateway download zip to local temp folder
      const res = await downloadHubAgent(client, hubAgentId, hubAgentName);
      if (!res.ok || !res.downloadPath) {
        throw new Error("下载远程智能体包失败");
      }

      // Step 2 & 3: Direct local import using downloadPath (no WS base64 overhead)
      await importAgent(client, res.downloadPath, e.detail.agentId, e.detail.workspace);

      this._showToast("智能体导入成功！");
    } catch (err: unknown) {
      console.error("Failed to import agent from Hub", err);
      const msg = err instanceof Error ? err.message : "导入失败";
      this._showToast(msg, true);
    }
  }

  private async _onDownloadHubSkill(e: CustomEvent<{ skillId: string; name: string }>) {
    try {
      const client = getClient();
      await client.waitConnected();
      const res = await downloadHubSkill(client, e.detail.skillId, e.detail.name);
      if (!res.downloadPath) {
        throw new Error("未能获取到下载路径");
      }

      const fileData = await downloadFile(client, res.downloadPath);
      const rawName = e.detail.name || fileData.fileName || "skill-download";
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
      console.error("Failed to download skill", err);
      alert(`下载失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private _onToggleVisibility(
    e: CustomEvent<{
      agentId?: string;
      skillId?: string;
      visibility: "public" | "private";
      agentName?: string;
      skillName?: string;
    }>,
  ) {
    if (e.detail.skillId) {
      this._dialog = {
        kind: "skill-visibility",
        skillId: e.detail.skillId,
        visibility: e.detail.visibility,
        skillName: e.detail.skillName || "",
      };
    } else if (e.detail.agentId) {
      this._dialog = {
        kind: "visibility",
        agentId: e.detail.agentId,
        visibility: e.detail.visibility,
        agentName: e.detail.agentName || "",
      };
    }
  }

  private async _onConfirmVisibilityToggle() {
    if (this._dialog.kind === "visibility") {
      const { agentId, visibility } = this._dialog;
      this._dialog = { kind: "none" };
      try {
        const client = getClient();
        await client.waitConnected();
        const res = await updateHubAgentVisibility(client, agentId, visibility);
        if (res.success && res.agent) {
          // update locally
          this._hubAgents = this._hubAgents.map((a) =>
            a.id === agentId ? { ...a, visibility: res.agent!.visibility } : a,
          );
          if (this._selectedHubAgent && this._selectedHubAgent.id === agentId) {
            this._selectedHubAgent = {
              ...this._selectedHubAgent,
              visibility: res.agent!.visibility,
            };
          }
        }
      } catch (err) {
        console.error("Failed to update visibility", err);
        alert(`修改可见性失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else if (this._dialog.kind === "skill-visibility") {
      const { skillId, visibility } = this._dialog;
      this._dialog = { kind: "none" };
      try {
        const client = getClient();
        await client.waitConnected();
        const res = await updateHubSkillVisibility(client, skillId, visibility);
        if (res.success && res.skill) {
          // update locally
          this._hubSkills = this._hubSkills.map((s) =>
            s.id === skillId ? { ...s, visibility: res.skill!.visibility } : s,
          );
          if (this._selectedHubSkill && this._selectedHubSkill.id === skillId) {
            this._selectedHubSkill = {
              ...this._selectedHubSkill,
              visibility: res.skill!.visibility,
            };
          }
        }
      } catch (err) {
        console.error("Failed to update visibility", err);
        alert(`修改可见性失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  private _showToast(msg: string, isError = false) {
    this._toastMsg = msg;
    this._toastError = isError;
  }

  private _renderToast() {
    if (!this._toastMsg) return "";
    return html`
      <toast-message
        .message=${this._toastMsg}
        ?isError=${this._toastError}
        @close=${() => {
          this._toastMsg = "";
        }}
      ></toast-message>
    `;
  }

  render() {
    if (this._selectedAgent) {
      return html`
        <clawhub-agent-detail
          .agent=${this._selectedAgent}
          @back=${this._onBackToList}
        ></clawhub-agent-detail>
        ${this._renderToast()}
      `;
    }

    if (this._selectedHubAgent) {
      return html`
        <clawhub-agenthub-detail
          .agent=${this._selectedHubAgent}
          @back=${this._onBackToList}
          @toggle-visibility=${this._onToggleVisibility}
        ></clawhub-agenthub-detail>
        ${this._renderDialogs()} ${this._renderToast()}
      `;
    }

    if (this._selectedHubSkill) {
      return html`
        <clawhub-skillhub-detail
          .skill=${this._selectedHubSkill}
          @back=${this._onBackToList}
          @toggle-visibility=${this._onToggleVisibility}
        ></clawhub-skillhub-detail>
        ${this._renderDialogs()} ${this._renderToast()}
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
      ${this._renderDialogs()} ${this._renderToast()}
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
    if (this._dialog.kind === "skill-visibility") {
      const { skillName, visibility } = this._dialog;
      const targetStr = visibility === "public" ? "公开 (Public)" : "私有 (Private)";
      return html`
        <confirm-dialog
          title="修改可见性"
          message="确定要将技能「${skillName}」的可见性修改为 ${targetStr} 吗？"
          confirmText="确认修改"
          confirmVariant="primary"
          @confirm=${this._onConfirmVisibilityToggle}
          @cancel=${() => {
            this._dialog = { kind: "none" };
          }}
        ></confirm-dialog>
      `;
    }
    if (this._dialog.kind === "import-hub") {
      const { hubAgentId, hubAgentName } = this._dialog;
      return html`
        <clawhub-agent-import-dialog
          hubAgentId=${hubAgentId}
          hubAgentName=${hubAgentName}
          @confirm=${this._onConfirmImportHubAgent}
          @cancel=${() => {
            this._dialog = { kind: "none" };
          }}
        ></clawhub-agent-import-dialog>
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
      (vs.kind === "error" &&
        (vs.code === "API_KEY_NOT_CONFIGURED" ||
          vs.message.includes("API_KEY_NOT_CONFIGURED") ||
          vs.message.includes("API Key not configured")))
    ) {
      return html`
        <div class="center-state">
          <svg
            class="center-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path
              d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"
            ></path>
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
          <svg
            class="center-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
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
          <svg
            class="center-icon"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="1.5"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
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
              @click=${() => {
                this._selectedAgent = agent;
              }}
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
          <svg
            class="center-icon"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z"
            />
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
              @click=${() => {
                this._selectedHubAgent = agent;
              }}
              @toggle-visibility=${this._onToggleVisibility}
            ></clawhub-agenthub-card>
          `,
        )}
      </div>
      ${this._renderPagination()}
    `;
  }

  private _renderSkillHubTab() {
    if (this._hubSkills.length === 0) {
      return html`
        <div class="center-state">
          <svg
            class="center-icon"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            stroke-width="1.5"
          >
            <path
              stroke-linecap="round"
              stroke-linejoin="round"
              d="M12 16.5V9.75m0 0l3 3m-3-3l-3 3M6.75 19.5a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z"
            />
          </svg>
          <div class="center-msg">SkillHub 中暂无上传的技能</div>
          <div class="center-sub">你可以通过工作台将本地技能包共享到这里</div>
        </div>
      `;
    }

    return html`
      <div class="cards-grid">
        ${this._hubSkills.map(
          (skill) => html`
            <clawhub-skillhub-card
              .name=${skill.name}
              .uploaderName=${skill.uploader_name}
              .description=${skill.description}
              .visibility=${skill.visibility}
              .fileSize=${skill.file_size}
              .createdAt=${skill.created_at}
              .skillId=${skill.id}
              .canManage=${skill.can_manage || false}
              @click=${() => {
                this._selectedHubSkill = skill;
              }}
              @toggle-visibility=${this._onToggleVisibility}
            ></clawhub-skillhub-card>
          `,
        )}
      </div>
      ${this._renderPagination()}
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
    } else if (this._activeTab === "skillhub") {
      currentPage = this._hubSkillPage;
      currentTotalPages = this._hubSkillTotalPages;
      currentTotal = this._hubSkillTotal;
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
