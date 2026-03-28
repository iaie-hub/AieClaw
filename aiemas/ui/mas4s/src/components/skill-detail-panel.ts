import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { SkillStatusEntry } from "../types/skills-types.js";

/**
 * Skill 详情面板组件
 * 右侧滑出面板，显示选中 Skill 的完整信息
 * 包括完整描述、配置要求、安装状态、文件路径和启用/禁用切换
 */
@customElement("skill-detail-panel")
export class SkillDetailPanel extends LitElement {
  @property({ attribute: false }) skill: SkillStatusEntry | null = null;
  @property({ type: Boolean }) open = false;
  @property({ type: Boolean }) updating = false;

  static styles = css`
    :host {
      display: block;
    }

    .detail-backdrop {
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.3);
      opacity: 0;
      pointer-events: none;
      transition: opacity 0.3s ease;
      z-index: 999;
    }

    .detail-backdrop.visible {
      opacity: 1;
      pointer-events: auto;
    }

    .detail-panel {
      position: fixed;
      top: 0;
      right: 0;
      width: 30%;
      min-width: 400px;
      height: 100vh;
      background: white;
      box-shadow: 0 10px 15px rgba(0, 0, 0, 0.1);
      transform: translateX(100%);
      transition: transform 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      z-index: 1000;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .detail-panel.open {
      transform: translateX(0);
    }

    .panel-header {
      padding: 24px;
      border-bottom: 1px solid #e8edf5;
      flex-shrink: 0;
    }

    .panel-title-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 16px;
    }

    .panel-title-content {
      flex: 1;
      min-width: 0;
    }

    .panel-icon {
      font-size: 32px;
      line-height: 1;
      margin-bottom: 8px;
    }

    .panel-title {
      font-size: 20px;
      font-weight: 600;
      color: #1e293b;
      margin: 0;
      word-break: break-word;
    }

    .close-button {
      background: transparent;
      border: none;
      cursor: pointer;
      padding: 8px;
      border-radius: 8px;
      color: #64748b;
      transition: all 0.2s ease;
      flex-shrink: 0;
      font-size: 20px;
      line-height: 1;
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .close-button:hover {
      background: #f1f5f9;
      color: #1e293b;
    }

    .panel-status-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .panel-status {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 14px;
      font-weight: 500;
    }

    .status-indicator {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .status-indicator.ready {
      background: #10b981;
    }

    .status-indicator.needs-setup {
      background: #f59e0b;
    }

    .status-indicator.disabled {
      background: #94a3b8;
    }

    .status-text {
      color: #64748b;
    }

    .status-text.ready {
      color: #10b981;
    }

    .status-text.needs-setup {
      color: #f59e0b;
    }

    .status-text.disabled {
      color: #94a3b8;
    }

    .panel-content {
      flex: 1;
      overflow-y: auto;
      padding: 24px;
    }

    .section {
      margin-bottom: 24px;
    }

    .section:last-child {
      margin-bottom: 0;
    }

    .section-title {
      font-size: 14px;
      font-weight: 600;
      color: #1e293b;
      margin: 0 0 12px 0;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .section-content {
      font-size: 14px;
      color: #64748b;
      line-height: 1.6;
      word-break: break-word;
    }

    .requirements-list {
      list-style: none;
      padding: 0;
      margin: 0;
    }

    .requirement-item {
      padding: 8px 12px;
      background: #f8fafc;
      border-radius: 8px;
      margin-bottom: 8px;
      font-size: 13px;
      color: #475569;
      font-family:
        "SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas, "Courier New", monospace;
    }

    .requirement-item:last-child {
      margin-bottom: 0;
    }

    .requirement-label {
      font-weight: 600;
      color: #1e293b;
      margin-right: 8px;
    }

    .missing-items {
      margin-top: 8px;
    }

    .missing-item {
      padding: 8px 12px;
      background: #fef2f2;
      border-left: 3px solid #ef4444;
      border-radius: 4px;
      margin-bottom: 8px;
      font-size: 13px;
      color: #991b1b;
      font-family:
        "SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas, "Courier New", monospace;
    }

    .missing-item:last-child {
      margin-bottom: 0;
    }

    .file-path {
      padding: 12px;
      background: #f8fafc;
      border-radius: 8px;
      font-size: 13px;
      color: #475569;
      font-family:
        "SF Mono", Monaco, "Cascadia Code", "Roboto Mono", Consolas, "Courier New", monospace;
      word-break: break-all;
    }

    .source-badge {
      display: inline-block;
      padding: 4px 12px;
      background: #f1f5f9;
      border-radius: 12px;
      font-size: 12px;
      color: #64748b;
      font-weight: 500;
    }

    .action-toggle-button {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      border: 1px solid #e8edf5;
      border-radius: 6px;
      background: white;
      cursor: pointer;
      transition: all 0.2s ease;
      font-size: 13px;
      font-weight: 500;
      color: #1e293b;
    }

    .action-toggle-button:hover:not(.updating) {
      background: #f8fafc;
      border-color: #3b82f6;
    }

    .action-toggle-button.updating {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .toggle-switch-small {
      width: 32px;
      height: 16px;
      border-radius: 8px;
      background: #cbd5e1;
      position: relative;
      transition: background 0.2s ease;
      flex-shrink: 0;
    }

    .toggle-switch-small.enabled {
      background: #10b981;
    }

    .toggle-switch-small::after {
      content: "";
      position: absolute;
      width: 12px;
      height: 12px;
      border-radius: 50%;
      background: white;
      top: 2px;
      left: 2px;
      transition: transform 0.2s ease;
    }

    .toggle-switch-small.enabled::after {
      transform: translateX(16px);
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      padding: 24px;
      color: #94a3b8;
      text-align: center;
    }

    .empty-icon {
      font-size: 48px;
      margin-bottom: 16px;
    }

    .empty-text {
      font-size: 14px;
    }

    @media (max-width: 768px) {
      .detail-panel {
        width: 100%;
      }
    }
  `;

  private _handleClose = () => {
    this.dispatchEvent(
      new CustomEvent("close", {
        bubbles: true,
        composed: true,
      }),
    );
  };

  private _handleBackdropClick = (e: MouseEvent) => {
    if (e.target === e.currentTarget) {
      this._handleClose();
    }
  };

  private _handleToggleEnabled = () => {
    if (this.updating || !this.skill) {
      return;
    }

    this.dispatchEvent(
      new CustomEvent("toggle-enabled", {
        detail: {
          skillKey: this.skill.skillKey,
          enabled: this.skill.disabled, // Toggle: if currently disabled, enable it
        },
        bubbles: true,
        composed: true,
      }),
    );
  };

  private _getStatusClass(): string {
    if (!this.skill) {
      return "";
    }
    if (this.skill.disabled) {
      return "disabled";
    }
    if (this.skill.eligible) {
      return "ready";
    }
    return "needs-setup";
  }

  private _getStatusText(): string {
    if (!this.skill) {
      return "";
    }
    if (this.skill.disabled) {
      return "已禁用";
    }
    if (this.skill.eligible) {
      return "就绪";
    }
    return "需要配置";
  }

  private _renderRequirements() {
    if (!this.skill?.requires) {
      return html`<p class="section-content">无特殊要求</p>`;
    }

    const { bins, anyBins, env, config } = this.skill.requires;
    const hasRequirements = bins?.length || anyBins?.length || env?.length || config?.length;

    if (!hasRequirements) {
      return html`<p class="section-content">无特殊要求</p>`;
    }

    return html`
      <ul class="requirements-list">
        ${bins?.map(
          (bin) => html`
            <li class="requirement-item">
              <span class="requirement-label">命令:</span>
              <span>${bin}</span>
            </li>
          `,
        )}
        ${anyBins?.map(
          (bin) => html`
            <li class="requirement-item">
              <span class="requirement-label">可选命令:</span>
              <span>${bin}</span>
            </li>
          `,
        )}
        ${env?.map(
          (envVar) => html`
            <li class="requirement-item">
              <span class="requirement-label">环境变量:</span>
              <span>${envVar}</span>
            </li>
          `,
        )}
        ${config?.map(
          (cfg) => html`
            <li class="requirement-item">
              <span class="requirement-label">配置:</span>
              <span>${cfg}</span>
            </li>
          `,
        )}
      </ul>
    `;
  }

  private _renderMissingItems() {
    if (!this.skill) {
      return null;
    }

    const { bins, env, config } = this.skill.missing;
    const hasMissing = bins.length || env.length || config.length;

    if (!hasMissing) {
      return null;
    }

    return html`
      <div class="section">
        <h3 class="section-title">缺失项</h3>
        <div class="missing-items">
          ${bins.map((bin) => html` <div class="missing-item">缺少命令: ${bin}</div> `)}
          ${env.map((envVar) => html` <div class="missing-item">缺少环境变量: ${envVar}</div> `)}
          ${config.map((cfg) => html` <div class="missing-item">缺少配置: ${cfg}</div> `)}
        </div>
      </div>
    `;
  }

  private _renderInstallStatus() {
    if (!this.skill?.install?.length) {
      return html`<p class="section-content">无需安装</p>`;
    }

    return html`
      <ul class="requirements-list">
        ${this.skill.install.map(
          (item) => html`
            <li class="requirement-item">
              <span class="requirement-label">${item.kind}:</span>
              <span>${item.label}</span>
            </li>
          `,
        )}
      </ul>
    `;
  }

  render() {
    if (!this.skill) {
      return html`
        <div
          class="detail-backdrop ${this.open ? "visible" : ""}"
          @click=${this._handleBackdropClick}
        ></div>
        <div class="detail-panel ${this.open ? "open" : ""}">
          <div class="empty-state">
            <div class="empty-icon">📦</div>
            <p class="empty-text">未选择 Skill</p>
          </div>
        </div>
      `;
    }

    const statusClass = this._getStatusClass();
    const statusText = this._getStatusText();
    const isEnabled = !this.skill.disabled;

    return html`
      <div
        class="detail-backdrop ${this.open ? "visible" : ""}"
        @click=${this._handleBackdropClick}
      ></div>
      <div class="detail-panel ${this.open ? "open" : ""}">
        <div class="panel-header">
          <div class="panel-title-row">
            <div class="panel-title-content">
              <div class="panel-icon">${this.skill.emoji || "📦"}</div>
              <h2 class="panel-title">${this.skill.name}</h2>
            </div>
            <button
              class="close-button"
              @click=${this._handleClose}
              aria-label="关闭详情面板"
              title="关闭"
            >
              ✕
            </button>
          </div>
          <div class="panel-status-row">
            <div class="panel-status">
              <span class="status-indicator ${statusClass}"></span>
              <span class="status-text ${statusClass}">${statusText}</span>
            </div>

            <button
              class="action-toggle-button ${this.updating ? "updating" : ""}"
              @click=${this._handleToggleEnabled}
              ?disabled=${this.updating}
              aria-label="${isEnabled ? "禁用" : "启用"} Skill"
            >
              <span>${isEnabled ? "禁用" : "启用"}</span>
              <div class="toggle-switch-small ${isEnabled ? "enabled" : ""}"></div>
            </button>
          </div>
        </div>

        <div class="panel-content">
          <div class="section">
            <h3 class="section-title">描述</h3>
            <p class="section-content">${this.skill.description}</p>
          </div>

          <div class="section">
            <h3 class="section-title">来源</h3>
            <span class="source-badge">${this.skill.source}</span>
          </div>

          <div class="section">
            <h3 class="section-title">配置要求</h3>
            ${this._renderRequirements()}
          </div>

          ${this._renderMissingItems()}

          <div class="section">
            <h3 class="section-title">安装状态</h3>
            ${this._renderInstallStatus()}
          </div>

          ${this.skill.filePath
            ? html`
                <div class="section">
                  <h3 class="section-title">文件路径</h3>
                  <div class="file-path">${this.skill.filePath}</div>
                </div>
              `
            : null}
          ${this.skill.homepage
            ? html`
                <div class="section">
                  <h3 class="section-title">主页</h3>
                  <div class="section-content">
                    <a href="${this.skill.homepage}" target="_blank" rel="noopener noreferrer">
                      ${this.skill.homepage}
                    </a>
                  </div>
                </div>
              `
            : null}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "skill-detail-panel": SkillDetailPanel;
  }
}
