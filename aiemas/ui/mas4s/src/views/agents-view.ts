import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { runAgentImport } from "../components/agent/agent-import-controller.js";
import type { ImportConfirmDetail } from "../components/agent/agent-import-controller.js";
import {
  fetchAgents,
  createAgent,
  deleteAgent,
  preDeleteAgent,
  listWorkspaceFiles,
  exportAgent,
  downloadFile,
  fetchAgentFileContentSafe,
} from "../gateway/agents-api.js";
import { uploadAgentToHub } from "../gateway/clawhub-api.js";
import "../components/agent-card.js";
import "../components/agent-detail-dialog.js";
import "../components/confirm-dialog.js";
import "../components/agent/agent-create-dialog.js";
import "../components/agent/agent-export-dialog.js";
import "../components/agent/agent-import-dialog.js";
import "../components/agent/agent-upload-dialog.js";
import "./agent-topology-view.js";
import "../components/toast-message.js";
import { getClient } from "../gateway/client.js";
import type { AgentEntry, WorkspaceEntry } from "../types/agents-types.js";

type DialogState =
  | { kind: "none" }
  | { kind: "create" }
  | { kind: "delete"; agent: AgentEntry }
  | { kind: "export"; agent: AgentEntry; entries: WorkspaceEntry[] }
  | { kind: "import" }
  | { kind: "upload"; agent: AgentEntry; entries: WorkspaceEntry[]; description: string };

/**
 * 智能体列表视图 — 以卡片网格展示所有智能体，支持创建、删除、导出、导入。
 */
@customElement("agents-view")
export class AgentsView extends LitElement {
  @state() private _agents: AgentEntry[] = [];
  @state() private _defaultId = "";
  @state() private _loading = true;
  @state() private _error = "";
  @state() private _selectedAgent: AgentEntry | null = null;
  @state() private _selectedIsDefault = false;
  @state() private _dialog: DialogState = { kind: "none" };
  @state() private _toastMsg = "";
  @state() private _toastError = false;
  @state() private _topologyAgent: AgentEntry | null = null;
  @state() private _searchQuery = "";

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
      padding: 24px 32px;
      background: white;
      border-bottom: 1px solid #e8edf5;
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
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

    .header-actions {
      display: flex;
      gap: 12px;
      align-items: center;
      flex-shrink: 0;
    }

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
      width: 220px;
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

    .list-area {
      flex: 1;
      padding: 32px;
      overflow-y: auto;
    }

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
      .list-area {
        padding: 16px;
      }
    }

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
      font-size: 48px;
      margin-bottom: 16px;
    }
    .center-msg {
      font-size: 15px;
      margin-bottom: 24px;
    }

    .error-msg {
      color: #ef4444;
      font-size: 15px;
      margin-bottom: 16px;
      max-width: 400px;
    }

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

    .btn-secondary {
      padding: 10px 20px;
      background: #f1f5f9;
      color: #475569;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s;
    }
    .btn-secondary:hover {
      background: #e2e8f0;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    void this._fetch();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
  }

  private async _fetch() {
    this._loading = true;
    this._error = "";
    try {
      const client = getClient();
      await client.waitConnected();
      const payload = await fetchAgents(client);
      this._agents = payload.agents;
      this._defaultId = payload.defaultId;
    } catch (err: unknown) {
      this._error = err instanceof Error ? err.message : "获取智能体列表失败";
    } finally {
      this._loading = false;
    }
  }

  private _showToast(msg: string, isError = false) {
    this._toastMsg = msg;
    this._toastError = isError;
  }

  // ── Create ────────────────────────────────────────────────────────────────

  private _onCreateConfirm = async (
    e: CustomEvent<{ name: string; agentId: string; workspace: string }>,
  ) => {
    this._dialog = { kind: "none" };
    try {
      const client = getClient();
      await createAgent(client, e.detail);
      this._showToast("智能体创建成功");
      await this._fetch();
    } catch (err: unknown) {
      this._showToast(err instanceof Error ? err.message : "创建失败", true);
    }
  };

  // ── Delete ────────────────────────────────────────────────────────────────

  private async _onDeleteEvent(e: CustomEvent<{ agent: AgentEntry }>) {
    this._dialog = { kind: "delete", agent: e.detail.agent };
  }

  private _onDeleteConfirm = async () => {
    if (this._dialog.kind !== "delete") {
      return;
    }
    const { agent } = this._dialog;
    this._dialog = { kind: "none" };
    try {
      const client = getClient();
      await preDeleteAgent(client, agent.id);
      await deleteAgent(client, agent.id);
      this._showToast("智能体已删除");
      await this._fetch();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "删除失败";
      this._showToast(msg, true);
    }
  };

  // ── Export ────────────────────────────────────────────────────────────────

  private async _onExportEvent(e: CustomEvent<{ agent: AgentEntry }>) {
    const { agent } = e.detail;
    try {
      const client = getClient();
      const result = await listWorkspaceFiles(client, agent.workspace);
      this._dialog = { kind: "export", agent, entries: result.entries };
    } catch (err: unknown) {
      this._showToast(err instanceof Error ? err.message : "获取工作区文件失败", true);
    }
  }

  private _onExportConfirm = async (e: CustomEvent<{ items: string[]; fileName: string }>) => {
    if (this._dialog.kind !== "export") {
      return;
    }
    const { agent } = this._dialog;
    this._dialog = { kind: "none" };
    try {
      const client = getClient();
      const { archivePath } = await exportAgent(client, agent.id, agent.workspace, e.detail.items);
      const fileData = await downloadFile(client, archivePath);
      // Determine download filename: prefer dialog-supplied name (agentName.zip),
      // fall back to server basename; ensure .zip suffix is present.
      const rawName = e.detail.fileName || fileData.fileName || "agent-export";
      const downloadName = rawName.endsWith(".zip") ? rawName : `${rawName}.zip`;
      // Trigger browser download
      const bytes = Uint8Array.from(atob(fileData.data), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: fileData.mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = downloadName;
      a.click();
      URL.revokeObjectURL(url);
      this._showToast("导出成功");
    } catch (err: unknown) {
      this._showToast(err instanceof Error ? err.message : "导出失败", true);
    }
  };

  // ── Import ────────────────────────────────────────────────────────────────

  private _onImportConfirm = async (e: CustomEvent<ImportConfirmDetail>) => {
    this._dialog = { kind: "none" };
    const result = await runAgentImport(e.detail);
    if (result.ok) {
      this._showToast("导入成功");
      await this._fetch();
    } else {
      this._showToast(result.message, true);
    }
  };

  // ── Upload ────────────────────────────────────────────────────────────────

  private async _onUploadEvent(e: CustomEvent<{ agent: AgentEntry }>) {
    const { agent } = e.detail;
    try {
      const client = getClient();
      const result = await listWorkspaceFiles(client, agent.workspace);
      const desc = await fetchAgentFileContentSafe(client, agent.workspace, "AGENTS.md");
      this._dialog = { kind: "upload", agent, entries: result.entries, description: desc };
    } catch (err: unknown) {
      this._showToast(err instanceof Error ? err.message : "获取工作区文件失败", true);
    }
  }

  private _onUploadConfirm = async (
    e: CustomEvent<{ items: string[]; name: string; description: string }>,
  ) => {
    if (this._dialog.kind !== "upload") {
      return;
    }
    const { agent } = this._dialog;
    this._dialog = { kind: "none" };
    try {
      const client = getClient();
      const uploadRes = await uploadAgentToHub(client, {
        agentId: agent.id,
        workspace: agent.workspace,
        items: e.detail.items,
        name: e.detail.name,
        description: e.detail.description,
      });
      if (uploadRes && uploadRes.success) {
        this._showToast("上传成功！可在 AgentHub 中查看");
      } else {
        this._showToast("上传失败，请检查 AgentRegistry 状态", true);
      }
    } catch (err: unknown) {
      this._showToast(err instanceof Error ? err.message : "上传失败", true);
    }
  };

  // ── Topology ────────────────────────────────────────────────────────────────

  private _onTopologyEvent(e: CustomEvent<{ agent: AgentEntry }>) {
    this._topologyAgent = e.detail.agent;
  }

  // ── Agent select ──────────────────────────────────────────────────────────

  private _onAgentSelect(e: CustomEvent<{ agent: AgentEntry; isDefault: boolean }>) {
    this._selectedAgent = e.detail.agent;
    this._selectedIsDefault = e.detail.isDefault;
  }

  private _onBack() {
    this._selectedAgent = null;
  }

  // ── Render ────────────────────────────────────────────────────────────────

  private _renderDialogs() {
    const d = this._dialog;
    if (d.kind === "create") {
      return html`
        <agent-create-dialog
          @confirm=${this._onCreateConfirm}
          @cancel=${() => {
            this._dialog = { kind: "none" };
          }}
        ></agent-create-dialog>
      `;
    }
    if (d.kind === "delete") {
      return html`
        <confirm-dialog
          title="删除智能体"
          message="确定要删除智能体「${d.agent.name ?? d.agent.id}」吗？此操作不可撤销。"
          confirmText="删除"
          confirmVariant="danger"
          @confirm=${this._onDeleteConfirm}
          @cancel=${() => {
            this._dialog = { kind: "none" };
          }}
        ></confirm-dialog>
      `;
    }
    if (d.kind === "export") {
      return html`
        <agent-export-dialog
          .entries=${d.entries}
          agentName=${d.agent.name ?? d.agent.id}
          @confirm=${this._onExportConfirm}
          @cancel=${() => {
            this._dialog = { kind: "none" };
          }}
        ></agent-export-dialog>
      `;
    }
    if (d.kind === "import") {
      return html`
        <agent-import-dialog
          @confirm=${this._onImportConfirm}
          @cancel=${() => {
            this._dialog = { kind: "none" };
          }}
        ></agent-import-dialog>
      `;
    }
    if (d.kind === "upload") {
      return html`
        <agent-upload-dialog
          .entries=${d.entries}
          agentName=${d.agent.name ?? d.agent.id}
          description=${d.description}
          @confirm=${this._onUploadConfirm}
          @cancel=${() => {
            this._dialog = { kind: "none" };
          }}
        ></agent-upload-dialog>
      `;
    }
    return "";
  }

  render() {
    // ── Topology view ──
    if (this._topologyAgent) {
      return html`
        <agent-topology-view
          .agent=${this._topologyAgent}
          @topology-back=${() => {
            this._topologyAgent = null;
          }}
        ></agent-topology-view>
      `;
    }

    // ── Detail page ──
    if (this._selectedAgent) {
      return html`
        <agent-detail-dialog
          .agent=${this._selectedAgent}
          .isDefault=${this._selectedIsDefault}
          @back=${() => this._onBack()}
        ></agent-detail-dialog>
      `;
    }

    // ── Loading ──
    if (this._loading) {
      return html`<div class="center-state">加载中...</div>`;
    }

    // ── Error ──
    if (this._error) {
      return html`
        <div class="center-state">
          <div class="error-msg">${this._error}</div>
          <button class="btn-primary" @click=${() => void this._fetch()}>重试</button>
        </div>
      `;
    }

    return html`
      <div class="header-area">
        <div class="header-text">
          <h1 class="page-title">智能体</h1>
          <p class="subtitle">共 ${this._agents.length} 个智能体</p>
        </div>
        <div class="header-actions">
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
              placeholder="搜索名称或模型..."
              .value=${this._searchQuery}
              @input=${(e: Event) => {
                this._searchQuery = (e.target as HTMLInputElement).value;
              }}
            />
          </div>
          <button
            class="btn-secondary"
            @click=${() => {
              this._dialog = { kind: "import" };
            }}
          >
            导入
          </button>
          <button
            class="btn-primary"
            @click=${() => {
              this._dialog = { kind: "create" };
            }}
          >
            + 创建
          </button>
        </div>
      </div>
      <div class="list-area">
        ${this._agents.length === 0
          ? html`
              <div class="center-state">
                <div class="center-icon">🤖</div>
                <div class="center-msg">暂无可用的智能体</div>
              </div>
            `
          : html`
              <div class="cards-grid">
                ${this._agents
                  .filter((a) => {
                    if (!this._searchQuery) {
                      return true;
                    }
                    const q = this._searchQuery.toLowerCase();
                    const nameMatch = (a.name || a.id).toLowerCase().includes(q);
                    const modelMatch =
                      a.model.primary.toLowerCase().includes(q) ||
                      a.model.fallbacks.some((f) => f.toLowerCase().includes(q));
                    return nameMatch || modelMatch;
                  })
                  .map(
                    (agent) => html`
                      <agent-card
                        .agent=${agent}
                        .isDefault=${agent.id === this._defaultId}
                        @agent-select=${(e: CustomEvent) => this._onAgentSelect(e)}
                        @agent-delete=${(e: CustomEvent) => this._onDeleteEvent(e)}
                        @agent-export=${(e: CustomEvent) => this._onExportEvent(e)}
                        @agent-upload=${(e: CustomEvent) => this._onUploadEvent(e)}
                        @agent-topology=${(e: CustomEvent) => this._onTopologyEvent(e)}
                        @agent-toast=${(e: CustomEvent) => this._showToast(e.detail.message)}
                      ></agent-card>
                    `,
                  )}
              </div>
            `}
      </div>
      ${this._renderDialogs()}
      ${this._toastMsg
        ? html`<toast-message
            .message=${this._toastMsg}
            ?isError=${this._toastError}
            @close=${() => {
              this._toastMsg = "";
            }}
          ></toast-message>`
        : ""}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "agents-view": AgentsView;
  }
}
