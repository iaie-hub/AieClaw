import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { SkillsController } from "../controllers/skills-controller.js";
import { listWorkspaceFiles, exportAgent, downloadFile } from "../gateway/agents-api.js";
import { getClient } from "../gateway/client.js";
import { AppStore, AppStoreController } from "../store/app-store.js";
import "../components/skill-card.js";
import "../components/skill-detail-panel.js";
import "../components/skill/skill-export-dialog.js";
import type { WorkspaceEntry } from "../types/agents-types.js";
import type { SkillStatusEntry } from "../types/skills-types.js";

type TabKind = "all" | "workspace" | "builtin";

type DialogState =
  | { kind: "none" }
  | { kind: "export"; skill: SkillStatusEntry; entries: WorkspaceEntry[] };

@customElement("skills-manager")
export class SkillsManager extends LitElement {
  private _store = new AppStoreController(this);
  private _controller = new SkillsController(getClient(), AppStore.instance);

  @state() private _activeTab: TabKind = "all";
  @state() private _searchText = "";
  @state() private _selectedSkill: SkillStatusEntry | null = null;
  @state() private _detailOpen = false;

  // Batch Mode
  @state() private _batchMode = false;
  @state() private _checkedSkills = new Set<string>();
  @state() private _batchUpdating = false;

  @state() private _dialog: DialogState = { kind: "none" };

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      height: 100%;
      background: #f1f5f9;
      position: relative;
      overflow: hidden;
    }

    .header-area {
      flex-shrink: 0;
      padding: 24px 32px;
      background: white;
      border-bottom: 1px solid #e8edf5;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .page-title {
      font-size: 24px;
      font-weight: 600;
      color: #1e293b;
      margin: 0;
    }

    .toolbar {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .search-input {
      width: 280px;
      padding: 10px 16px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      font-size: 14px;
      outline: none;
      transition: all 0.2s ease;
    }
    .search-input:focus {
      border-color: #3b82f6;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
    }

    .batch-toggle-btn {
      padding: 10px 16px;
      font-size: 14px;
      font-weight: 500;
      border-radius: 8px;
      cursor: pointer;
      border: 1px solid #e2e8f0;
      background: white;
      color: #475569;
      transition: all 0.2s ease;
    }
    .batch-toggle-btn:hover {
      background: #f8fafc;
      color: #1e293b;
    }
    .batch-toggle-btn.active {
      background: #eff6ff;
      border-color: #3b82f6;
      color: #3b82f6;
    }

    .tabs {
      display: flex;
      gap: 32px;
      border-bottom: 2px solid transparent;
    }

    .tab-item {
      padding: 0 4px 12px;
      font-size: 14px;
      font-weight: 500;
      color: #64748b;
      cursor: pointer;
      position: relative;
    }
    .tab-item.active {
      color: #3b82f6;
    }
    .tab-item.active::after {
      content: "";
      position: absolute;
      bottom: -2px; /* overlaps the header bottom border conceptually */
      left: 0;
      right: 0;
      height: 2px;
      background: #3b82f6;
      border-radius: 2px 2px 0 0;
      z-index: 1;
    }

    .list-area {
      flex: 1;
      padding: 32px;
      overflow-y: auto;
      position: relative;
    }
    /* Detail panel is a fixed overlay, we no longer shrink the list area to avoid layout shift. */

    .group-section {
      margin-bottom: 40px;
    }
    .group-title {
      font-size: 12px;
      font-weight: 600;
      color: #94a3b8;
      letter-spacing: 0.05em;
      margin-bottom: 16px;
      text-transform: uppercase;
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
      }
      .list-area {
        padding: 16px;
      }
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: #94a3b8;
      text-align: center;
    }
    .empty-icon {
      font-size: 48px;
      margin-bottom: 16px;
    }
    .empty-msg {
      font-size: 15px;
      margin-bottom: 24px;
    }
    .btn-primary {
      padding: 10px 20px;
      background: #3b82f6;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.2s;
    }
    .btn-primary:hover {
      background: #2563eb;
    }

    .btn-danger {
      padding: 10px 20px;
      background: #ef4444;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: background 0.2s;
    }
    .btn-danger:hover {
      background: #dc2828;
    }

    .btn-secondary {
      padding: 10px 20px;
      background: white;
      color: #475569;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.2s;
    }
    .btn-secondary:hover {
      background: #f8fafc;
    }

    /* Error Overlay */
    .error-overlay {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: rgba(255, 255, 255, 0.9);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      z-index: 50;
    }
    .error-msg {
      color: #ef4444;
      font-size: 16px;
      margin-bottom: 16px;
      max-width: 400px;
      text-align: center;
      word-break: break-word;
    }

    /* Batch Toolbar */
    .batch-toolbar {
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      background: white;
      border-top: 1px solid #e8edf5;
      padding: 16px 32px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.05);
      z-index: 40;
      transform: translateY(100%);
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    }
    .batch-toolbar.visible {
      transform: translateY(0);
    }
    .batch-info {
      font-size: 14px;
      font-weight: 500;
      color: #1e293b;
    }
    .batch-actions {
      display: flex;
      gap: 12px;
      align-items: center;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this._fetchData();
  }

  private _fetchData = () => {
    void this._controller.fetchSkills();
  };

  private _handleSearch = (e: Event) => {
    const target = e.target as HTMLInputElement;
    this._searchText = target.value;
  };

  private _clearSearch = () => {
    this._searchText = "";
  };

  private _handleSkillSelect = (e: CustomEvent<{ skill: SkillStatusEntry }>) => {
    if (this._batchMode) {
      // 在批量模式下，点击卡片也可以相当于 check 操作
      const skillKey = e.detail.skill.skillKey;
      if (this._checkedSkills.has(skillKey)) {
        this._checkedSkills.delete(skillKey);
      } else {
        this._checkedSkills.add(skillKey);
      }
      this.requestUpdate();
      return;
    }

    this._selectedSkill = e.detail.skill;
    this._detailOpen = true;
  };

  private _handleSkillCheck = (e: CustomEvent<{ skill: SkillStatusEntry; checked: boolean }>) => {
    const skillKey = e.detail.skill.skillKey;
    if (e.detail.checked) {
      this._checkedSkills.add(skillKey);
    } else {
      this._checkedSkills.delete(skillKey);
    }
    this.requestUpdate();
  };

  private _handleDetailClose = () => {
    this._detailOpen = false;
    // 不置空 _selectedSkill，以便退出动画有内容展示
  };

  private _handleToggleSingle = async (e: CustomEvent<{ skillKey: string; enabled: boolean }>) => {
    const { skillKey, enabled } = e.detail;
    try {
      await this._controller.toggleSkillEnabled(skillKey, enabled);
      // update panel active skill ref
      if (this._selectedSkill && this._selectedSkill.skillKey === skillKey) {
        this._selectedSkill = { ...this._selectedSkill, disabled: !enabled };
      }
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "操作失败");
    }
  };

  private _handleBatchEnable = async () => {
    if (this._checkedSkills.size === 0) {
      return;
    }
    this._batchUpdating = true;
    try {
      await this._controller.toggleSkillsBatch(Array.from(this._checkedSkills), true);
      alert("批量启用成功");
      this._checkedSkills.clear();
      this._batchMode = false;
    } catch (error: unknown) {
      alert(error instanceof Error ? error.message : "批量操作失败");
    } finally {
      this._batchUpdating = false;
    }
  };

  private _handleBatchDisable = async () => {
    if (this._checkedSkills.size === 0) {
      return;
    }
    this._batchUpdating = true;
    try {
      await this._controller.toggleSkillsBatch(Array.from(this._checkedSkills), false);
      alert("批量禁用成功");
      this._checkedSkills.clear();
      this._batchMode = false;
    } catch (error: unknown) {
      alert(error instanceof Error ? error.message : "批量操作失败");
    } finally {
      this._batchUpdating = false;
    }
  };

  private _onExportEvent = async (e: CustomEvent<{ skill: SkillStatusEntry }>) => {
    const { skill } = e.detail;
    try {
      const client = getClient();
      const result = await listWorkspaceFiles(client, skill.baseDir);
      this._dialog = { kind: "export", skill, entries: result.entries };
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "获取工作空间文件失败");
    }
  };

  private _onExportConfirm = async (e: CustomEvent<{ items: string[]; fileName: string }>) => {
    if (this._dialog.kind !== "export") {
      return;
    }
    const { skill } = this._dialog;
    this._dialog = { kind: "none" };
    try {
      const client = getClient();
      const { archivePath } = await exportAgent(
        client,
        "skill-" + skill.skillKey,
        skill.baseDir,
        e.detail.items,
      );
      const fileData = await downloadFile(client, archivePath);

      const rawName = e.detail.fileName || fileData.fileName || "skill-export";
      const downloadName = rawName.endsWith(".zip") ? rawName : `${rawName}.zip`;

      const bytes = Uint8Array.from(atob(fileData.data), (c) => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: fileData.mimeType });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = downloadName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "导出失败");
    }
  };

  private renderGrid(skills: SkillStatusEntry[]) {
    return html`
      <div class="cards-grid">
        ${skills.map(
          (s) => html`
            <skill-card
              .skill=${s}
              .selected=${this._selectedSkill?.skillKey === s.skillKey}
              .showCheckbox=${this._batchMode}
              .checked=${this._checkedSkills.has(s.skillKey)}
              @skill-select=${this._handleSkillSelect}
              @skill-check=${this._handleSkillCheck}
              @skill-export=${this._onExportEvent}
            ></skill-card>
          `,
        )}
      </div>
    `;
  }

  render() {
    const store = this._store.store;
    const allSkills = store.skillsReport?.skills || [];

    // 如果整体数据为空
    if (!store.skillsLoading && !store.skillsError && allSkills.length === 0) {
      return html`
        <div class="empty-state">
          <div class="empty-icon">📦</div>
          <div class="empty-msg">暂无可用的Skills</div>
        </div>
      `;
    }

    const filtered = this._controller.filterSkills(allSkills, this._activeTab, this._searchText);

    // 按类型分发
    const workspaceSkills = filtered.filter(
      (s) => this._controller.classifySkill(s) === "workspace",
    );
    const builtinSkills = filtered.filter((s) => this._controller.classifySkill(s) === "builtin");

    return html`
      <div class="header-area">
        <div class="title-row">
          <h1 class="page-title">Skills</h1>
          <div class="toolbar">
            <input
              type="text"
              class="search-input"
              placeholder="搜索 Skills..."
              .value=${this._searchText}
              @input=${this._handleSearch}
            />
            <button
              class="batch-toggle-btn ${this._batchMode ? "active" : ""}"
              @click=${() => {
                this._batchMode = !this._batchMode;
                if (!this._batchMode) {
                  this._checkedSkills.clear();
                }
              }}
            >
              ${this._batchMode ? "退出批量选择" : "批量操作"}
            </button>
          </div>
        </div>

        <div class="tabs">
          <div
            class="tab-item ${this._activeTab === "all" ? "active" : ""}"
            @click=${() => (this._activeTab = "all")}
          >
            所有
          </div>
          <div
            class="tab-item ${this._activeTab === "workspace" ? "active" : ""}"
            @click=${() => (this._activeTab = "workspace")}
          >
            工作空间
          </div>
          <div
            class="tab-item ${this._activeTab === "builtin" ? "active" : ""}"
            @click=${() => (this._activeTab = "builtin")}
          >
            内置
          </div>
        </div>
      </div>

      <div class="list-area">
        ${store.skillsLoading && !store.skillsReport
          ? html`<div class="empty-state">加载中...</div>`
          : filtered.length === 0
            ? html`
                <div class="empty-state">
                  <div class="empty-icon">🔍</div>
                  <div class="empty-msg">未找到匹配的Skills</div>
                  <button class="btn-primary" @click=${this._clearSearch}>清除搜索</button>
                </div>
              `
            : html`
                ${this._activeTab === "all" || this._activeTab === "workspace"
                  ? workspaceSkills.length > 0
                    ? html`
                        <div class="group-section">
                          ${this._activeTab === "all"
                            ? html`<div class="group-title">工作空间 Skills</div>`
                            : ""}
                          ${this.renderGrid(workspaceSkills)}
                        </div>
                      `
                    : ""
                  : ""}
                ${this._activeTab === "all" || this._activeTab === "builtin"
                  ? builtinSkills.length > 0
                    ? html`
                        <div class="group-section">
                          ${this._activeTab === "all"
                            ? html`<div class="group-title">内置 Skills</div>`
                            : ""}
                          ${this.renderGrid(builtinSkills)}
                        </div>
                      `
                    : ""
                  : ""}
              `}
      </div>

      ${store.skillsError
        ? html`
            <div class="error-overlay">
              <div class="error-msg">${store.skillsError}</div>
              <button class="btn-primary" @click=${this._fetchData}>重试</button>
            </div>
          `
        : ""}

      <skill-detail-panel
        .skill=${this._selectedSkill}
        .open=${this._detailOpen}
        @close=${this._handleDetailClose}
        @toggle-enabled=${this._handleToggleSingle}
      ></skill-detail-panel>

      ${this._dialog.kind === "export"
        ? html`
            <skill-export-dialog
              .entries=${this._dialog.entries}
              skillName=${this._dialog.skill.name}
              @confirm=${this._onExportConfirm}
              @cancel=${() => {
                this._dialog = { kind: "none" };
              }}
            ></skill-export-dialog>
          `
        : ""}

      <div class="batch-toolbar ${this._batchMode ? "visible" : ""}">
        <div class="batch-info">已选择 ${this._checkedSkills.size} 个 Skills</div>
        <div class="batch-actions">
          <button
            class="btn-secondary"
            @click=${() => {
              this._batchMode = false;
              this._checkedSkills.clear();
            }}
            ?disabled=${this._batchUpdating}
          >
            取消选择
          </button>
          <button
            class="btn-primary"
            @click=${this._handleBatchEnable}
            ?disabled=${this._checkedSkills.size === 0 || this._batchUpdating}
          >
            ${this._batchUpdating ? "操作中..." : "启用"}
          </button>
          <button
            class="btn-danger"
            @click=${this._handleBatchDisable}
            ?disabled=${this._checkedSkills.size === 0 || this._batchUpdating}
          >
            ${this._batchUpdating ? "操作中..." : "禁用"}
          </button>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "skills-manager": SkillsManager;
  }
}
