import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { runSkillImport } from "../components/skill/skill-import-controller.js";
import { SkillsController } from "../controllers/skills-controller.js";
import {
  listWorkspaceFiles,
  exportAgent,
  downloadFile,
  fetchAgentFileContentSafe,
  fetchAgents,
} from "../gateway/agents-api.js";
import { uploadSkillToHub } from "../gateway/clawhub-api.js";
import { deleteSkill } from "../gateway/skills-api.js";
import { getClient } from "../gateway/client.js";
import "../components/skill-card.js";
import "../components/skill-detail-panel.js";
import "../components/confirm-dialog.js";
import "../components/skill/skill-export-dialog.js";
import "../components/skill/skill-upload-dialog.js";
import "../components/skill/skill-import-dialog.js";
import "../components/toast-message.js";
import { AppStore, AppStoreController } from "../store/app-store.js";
import type { WorkspaceEntry, AgentEntry } from "../types/agents-types.js";
import type { SkillStatusEntry } from "../types/skills-types.js";

type TabKind = "all" | "workspace" | "builtin";

type DialogState =
  | { kind: "none" }
  | { kind: "export"; skill: SkillStatusEntry; entries: WorkspaceEntry[] }
  | { kind: "upload"; skill: SkillStatusEntry; entries: WorkspaceEntry[]; description: string }
  | { kind: "import" }
  | { kind: "delete"; skill: SkillStatusEntry }
  | { kind: "delete-batch"; skills: SkillStatusEntry[] };


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

  @state() private _agents: AgentEntry[] = [];

  @state() private _dialog: DialogState = { kind: "none" };
  @state() private _toastMsg = "";
  @state() private _toastError = false;

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
    void this._fetchAgentsList();
  };

  private async _fetchAgentsList() {
    try {
      const result = await fetchAgents(getClient());
      this._agents = result.agents;
    } catch (err: unknown) {
      console.error("获取智能体列表失败", err);
    }
  }

  private _handleSearch = (e: Event) => {
    const target = e.target as HTMLInputElement;
    this._searchText = target.value;
  };

  private _clearSearch = () => {
    this._searchText = "";
  };

  private _showToast(msg: string, isError = false) {
    this._toastMsg = msg;
    this._toastError = isError;
  }

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
      this._showToast(err instanceof Error ? err.message : "操作失败", true);
    }
  };

  private _handleBatchEnable = async () => {
    if (this._checkedSkills.size === 0) {
      return;
    }
    this._batchUpdating = true;
    try {
      await this._controller.toggleSkillsBatch(Array.from(this._checkedSkills), true);
      this._showToast("批量启用成功");
      this._checkedSkills.clear();
      this._batchMode = false;
    } catch (error: unknown) {
      this._showToast(error instanceof Error ? error.message : "批量操作失败", true);
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
      this._showToast("批量禁用成功");
      this._checkedSkills.clear();
      this._batchMode = false;
    } catch (error: unknown) {
      this._showToast(error instanceof Error ? error.message : "批量操作失败", true);
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
      this._showToast(err instanceof Error ? err.message : "获取工作空间文件失败", true);
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
      this._showToast(err instanceof Error ? err.message : "导出失败", true);
    }
  };

  private _onUploadEvent = async (e: CustomEvent<{ skill: SkillStatusEntry }>) => {
    const { skill } = e.detail;
    try {
      const client = getClient();
      const result = await listWorkspaceFiles(client, skill.baseDir);
      let desc = "";
      try {
        desc = await fetchAgentFileContentSafe(client, skill.baseDir, "SKILL.md");
      } catch {
        try {
          desc = await fetchAgentFileContentSafe(client, skill.baseDir, "README.md");
        } catch {
          desc = skill.description || "";
        }
      }
      this._dialog = { kind: "upload", skill, entries: result.entries, description: desc };
    } catch (err: unknown) {
      this._showToast(err instanceof Error ? err.message : "获取工作空间文件失败", true);
    }
  };

  private _onUploadConfirm = async (
    e: CustomEvent<{ items: string[]; name: string; description: string }>,
  ) => {
    if (this._dialog.kind !== "upload") {
      return;
    }
    const { skill } = this._dialog;
    this._dialog = { kind: "none" };
    try {
      const client = getClient();
      const uploadRes = await uploadSkillToHub(client, {
        skillKey: skill.skillKey,
        workspace: skill.baseDir,
        items: e.detail.items,
        name: e.detail.name,
        description: e.detail.description,
      });
      if (uploadRes && uploadRes.success) {
        this._showToast("上传成功！可在 SkillHub 中查看");
      } else {
        this._showToast("上传失败，请检查 AgentRegistry 状态", true);
      }
    } catch (err: unknown) {
      this._showToast(err instanceof Error ? err.message : "上传失败", true);
    }
  };

  private _onImportClick = () => {
    this._dialog = { kind: "import" };
  };

  private _onImportConfirm = async (
    e: CustomEvent<{ file: File; slug: string; workspace?: string }>,
  ) => {
    this._dialog = { kind: "none" };
    try {
      const result = await runSkillImport(e.detail);
      if (result.ok) {
        this._showToast("导入成功");
        void this._controller.fetchSkills();
      } else {
        this._showToast(result.message, true);
      }
    } catch (err: unknown) {
      this._showToast(err instanceof Error ? err.message : "导入失败", true);
    }
  };

  private _onDeleteEvent = (e: CustomEvent<{ skill: SkillStatusEntry }>) => {
    this._dialog = { kind: "delete", skill: e.detail.skill };
  };

  private _onDeleteConfirm = async () => {
    if (this._dialog.kind !== "delete") {
      return;
    }
    const { skill } = this._dialog;
    this._dialog = { kind: "none" };
    try {
      const client = getClient();
      await deleteSkill(client, skill.skillKey, skill.baseDir);
      this._showToast("技能已成功删除");
      if (this._selectedSkill?.skillKey === skill.skillKey) {
        this._selectedSkill = null;
        this._detailOpen = false;
      }
      void this._controller.fetchSkills();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "删除失败";
      this._showToast(msg, true);
    }
  };

  private _handleBatchDeleteClick = () => {
    const store = this._store.store;
    const allSkills = store.skillsReport?.skills || [];
    const deletableSkills = Array.from(this._checkedSkills)
      .map((key) => allSkills.find((s) => s.skillKey === key))
      .filter(
        (s): s is SkillStatusEntry =>
          !!s &&
          !s.bundled &&
          (s.source === "openclaw-workspace" || s.source === "agents-skills-project"),
      );

    if (deletableSkills.length === 0) {
      this._showToast("选中的技能均为内置只读技能，无法删除", true);
      return;
    }

    this._dialog = { kind: "delete-batch", skills: deletableSkills };
  };

  private _onBatchDeleteConfirm = async () => {
    if (this._dialog.kind !== "delete-batch") {
      return;
    }
    const { skills } = this._dialog;
    this._dialog = { kind: "none" };
    this._batchUpdating = true;
    try {
      const client = getClient();
      let successCount = 0;
      let failCount = 0;
      for (const skill of skills) {
        try {
          await deleteSkill(client, skill.skillKey, skill.baseDir);
          successCount++;
          if (this._selectedSkill?.skillKey === skill.skillKey) {
            this._selectedSkill = null;
            this._detailOpen = false;
          }
        } catch (err) {
          console.error(`Failed to delete skill ${skill.name}:`, err);
          failCount++;
        }
      }
      if (failCount === 0) {
        this._showToast(`批量删除成功，已成功删除 ${successCount} 个技能`);
      } else {
        this._showToast(`部分删除成功: 成功 ${successCount} 个, 失败 ${failCount} 个`, true);
      }
      this._checkedSkills.clear();
      this._batchMode = false;
      void this._controller.fetchSkills();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "批量删除失败";
      this._showToast(msg, true);
    } finally {
      this._batchUpdating = false;
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
              @skill-upload=${this._onUploadEvent}
              @skill-delete=${this._onDeleteEvent}
            ></skill-card>
          `,
        )}
      </div>
    `;
  }

  render() {
    const store = this._store.store;
    const allSkills = store.skillsReport?.skills || [];
    const existingSkills = allSkills.map((s) => s.skillKey);

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
            <button class="batch-toggle-btn" @click=${this._onImportClick}>📥 导入技能</button>
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
      ${this._dialog.kind === "upload"
        ? html`
            <skill-upload-dialog
              .entries=${this._dialog.entries}
              skillName=${this._dialog.skill.name}
              description=${this._dialog.description}
              @confirm=${this._onUploadConfirm}
              @cancel=${() => {
                this._dialog = { kind: "none" };
              }}
            ></skill-upload-dialog>
          `
        : ""}
      ${this._dialog.kind === "import"
        ? html`
            <skill-import-dialog
              .agents=${this._agents}
              .managedSkillsDir=${store.skillsReport?.managedSkillsDir || "~/.openclaw/skills"}
              .existingSkills=${existingSkills}
              @confirm=${this._onImportConfirm}
              @cancel=${() => {
                this._dialog = { kind: "none" };
              }}
            ></skill-import-dialog>
          `
        : ""}
      ${this._dialog.kind === "delete"
        ? html`
            <confirm-dialog
              title="删除技能"
              message="确定要永久删除技能「${this._dialog.skill.name}」及其物理目录吗？此操作不可撤销。"
              confirmText="删除"
              confirmVariant="danger"
              @confirm=${this._onDeleteConfirm}
              @cancel=${() => {
                this._dialog = { kind: "none" };
              }}
            ></confirm-dialog>
          `
        : ""}
      ${this._dialog.kind === "delete-batch"
        ? html`
            <confirm-dialog
              title="批量删除技能"
              message="确定要永久删除选中的 ${this._dialog.skills.length} 个技能及其物理目录吗？（选中的内置技能将自动过滤不予处理）此操作不可撤销。"
              confirmText="删除"
              confirmVariant="danger"
              @confirm=${this._onBatchDeleteConfirm}
              @cancel=${() => {
                this._dialog = { kind: "none" };
              }}
            ></confirm-dialog>
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
          <button
            class="btn-danger"
            @click=${this._handleBatchDeleteClick}
            ?disabled=${this._checkedSkills.size === 0 || this._batchUpdating}
          >
            ${this._batchUpdating ? "操作中..." : "批量删除"}
          </button>
        </div>
      </div>

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
    "skills-manager": SkillsManager;
  }
}
