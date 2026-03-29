import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { SkillStatusEntry, SkillInstallItem } from "../types/skills-types.js";

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
      width: 35%;
      min-width: 450px;
      height: 100vh;
      background: #f8fafc;
      box-shadow: -10px 0 25px rgba(0, 0, 0, 0.05);
      transform: translateX(100%);
      transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1);
      z-index: 1000;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .detail-panel.open {
      transform: translateX(0);
    }

    .panel-header {
      padding: 32px;
      background: white;
      border-bottom: 1px solid #e2e8f0;
      flex-shrink: 0;
      position: relative;
    }

    .panel-title-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 24px;
    }

    .panel-title-content {
      flex: 1;
      min-width: 0;
    }

    .panel-icon-wrapper {
      width: 56px;
      height: 56px;
      background: #f1f5f9;
      border-radius: 16px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 32px;
      margin-bottom: 16px;
      box-shadow: inset 0 2px 4px rgba(0, 0, 0, 0.05);
    }

    .panel-title {
      font-size: 24px;
      font-weight: 700;
      color: #0f172a;
      margin: 0;
      word-break: break-word;
      letter-spacing: -0.02em;
    }

    .close-button {
      background: #f1f5f9;
      border: none;
      cursor: pointer;
      padding: 8px;
      border-radius: 12px;
      color: #64748b;
      transition: all 0.2s ease;
      flex-shrink: 0;
      width: 40px;
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 18px;
    }

    .close-button:hover {
      background: #e2e8f0;
      color: #0f172a;
      transform: rotate(90deg);
    }

    .panel-status-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      background: #f8fafc;
      border-radius: 12px;
      border: 1px solid #e2e8f0;
    }

    .panel-status {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 14px;
      font-weight: 600;
    }

    .status-indicator {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
      box-shadow: 0 0 0 4px rgba(0, 0, 0, 0.03);
    }

    .status-indicator.ready {
      background: #10b981;
      box-shadow: 0 0 0 4px rgba(16, 185, 129, 0.1);
    }

    .status-indicator.needs-setup {
      background: #f59e0b;
      box-shadow: 0 0 0 4px rgba(245, 158, 11, 0.1);
    }

    .status-indicator.disabled {
      background: #94a3b8;
    }

    .status-text {
      color: #64748b;
    }

    .status-text.ready {
      color: #059669;
    }

    .status-text.needs-setup {
      color: #d97706;
    }

    .action-toggle-button {
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 8px 16px;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      background: white;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      font-size: 14px;
      font-weight: 600;
      color: #334155;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
    }

    .action-toggle-button:hover:not(.updating) {
      background: #f8fafc;
      border-color: #3b82f6;
      color: #3b82f6;
    }

    .action-toggle-button.updating {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .toggle-switch-small {
      width: 36px;
      height: 20px;
      border-radius: 12px;
      background: #e2e8f0;
      position: relative;
      transition: background 0.3s ease;
      flex-shrink: 0;
    }

    .toggle-switch-small.enabled {
      background: #3b82f6;
    }

    .toggle-switch-small::after {
      content: "";
      position: absolute;
      width: 14px;
      height: 14px;
      border-radius: 50%;
      background: white;
      top: 3px;
      left: 3px;
      transition: transform 0.3s cubic-bezier(0.16, 1, 0.3, 1);
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
    }

    .toggle-switch-small.enabled::after {
      transform: translateX(16px);
    }

    .panel-content {
      flex: 1;
      overflow-y: auto;
      padding: 32px;
      display: flex;
      flex-direction: column;
      gap: 32px;
    }

    .section-card {
      background: white;
      border-radius: 16px;
      padding: 20px;
      border: 1px solid #e2e8f0;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
    }

    .section-title-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
    }

    .section-title-icon {
      color: #64748b;
      font-size: 18px;
    }

    .section-title {
      font-size: 13px;
      font-weight: 700;
      color: #475569;
      margin: 0;
      text-transform: uppercase;
      letter-spacing: 0.08em;
    }

    .section-content {
      font-size: 15px;
      color: #334155;
      line-height: 1.6;
    }

    .eligibility-banner {
      padding: 16px;
      border-radius: 12px;
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 8px;
      font-weight: 600;
      font-size: 14px;
    }

    .eligibility-banner.available {
      display: none;
    }

    .eligibility-banner.unavailable {
      background: #fff7ed;
      color: #9a3412;
      border: 1px solid #fed7aa;
    }

    .req-group {
      margin-bottom: 20px;
    }

    .req-group:last-child {
      margin-bottom: 0;
    }

    .req-group-label {
      font-size: 12px;
      font-weight: 600;
      color: #94a3b8;
      margin-bottom: 8px;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .req-list {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .req-badge {
      padding: 6px 12px;
      background: #f1f5f9;
      border-radius: 8px;
      font-size: 13px;
      color: #1e293b;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      border: 1px solid #e2e8f0;
      display: flex;
      align-items: center;
      gap: 6px;
    }

    .req-badge.satisfied {
      background: #f0fdf4;
      border-color: #dcfce7;
      color: #166534;
    }

    .req-badge.missing {
      background: #fef2f2;
      border-color: #fee2e2;
      color: #991b1b;
    }

    .logic-indicator {
      font-size: 11px;
      font-weight: 800;
      padding: 2px 6px;
      border-radius: 4px;
      text-transform: uppercase;
    }

    .logic-and {
      background: #e0f2fe;
      color: #0369a1;
    }

    .logic-or {
      background: #faf5ff;
      color: #7e22ce;
    }

    .file-path-container {
      position: relative;
      background: #f1f5f9;
      border-radius: 12px;
      padding: 12px;
      font-size: 13px;
      color: #475569;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      word-break: break-all;
      border: 1px solid #e2e8f0;
    }

    .source-badge {
      display: inline-block;
      padding: 4px 10px;
      background: #ede9fe;
      border-radius: 8px;
      font-size: 12px;
      color: #5b21b6;
      font-weight: 600;
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: #94a3b8;
    }

    .empty-icon {
      font-size: 64px;
      margin-bottom: 16px;
      opacity: 0.5;
    }

    .missing-item {
      padding: 8px 12px;
      background: #fef2f2;
      border-left: 3px solid #ef4444;
      border-radius: 4px;
      margin-bottom: 8px;
      font-size: 13px;
      color: #991b1b;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }

    .install-item {
      padding: 16px;
      background: #f1f5f9;
      border-radius: 12px;
      margin-bottom: 12px;
      border: 1px solid #e2e8f0;
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .install-item:last-child {
      margin-bottom: 0;
    }

    .install-description {
      font-size: 14px;
      font-weight: 600;
      color: #334155;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .install-kind-badge {
      font-size: 10px;
      text-transform: uppercase;
      padding: 2px 6px;
      background: #e2e8f0;
      color: #475569;
      border-radius: 4px;
      letter-spacing: 0.05em;
    }

    .install-command-wrapper {
      position: relative;
    }

    .install-command {
      display: block;
      padding: 12px;
      background: #0f172a;
      color: #e2e8f0;
      border-radius: 8px;
      font-size: 13px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      overflow-x: auto;
      white-space: pre;
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
    if (!this.skill.eligible) {
      return "needs-setup";
    }
    if (this.skill.disabled) {
      return "disabled";
    }
    return "ready";
  }

  private _getStatusText(): string {
    if (!this.skill) {
      return "";
    }
    if (!this.skill.eligible) {
      return "不可用";
    }
    if (this.skill.disabled) {
      return "已禁用";
    }
    return "就绪";
  }

  private _renderRequirements() {
    if (!this.skill?.requirements) {
      return html`<p class="section-content">无特殊要求</p>`;
    }

    const { bins, anyBins, env, config, os } = this.skill.requirements;
    const hasRequirements =
      bins?.length || anyBins?.length || env?.length || config?.length || os?.length;

    if (!hasRequirements) {
      return html`<p class="section-content">无特殊要求</p>`;
    }

    const { missing } = this.skill;
    const isBinMissing = (bin: string) => missing.bins.includes(bin);
    const isEnvMissing = (envName: string) => missing.env.includes(envName);
    const isConfigMissing = (pathStr: string) => missing.config.includes(pathStr);
    const isOsMissing = (osName: string) => missing.os.includes(osName);

    return html`
      <div class="requirements-detail">
        ${bins?.length
          ? html`
              <div class="req-group">
                <div class="req-group-label">
                  <span class="logic-indicator logic-and">Must (AND)</span>
                  <span>必须存在的命令</span>
                </div>
                <div class="req-list">
                  ${bins.map(
                    (bin) => html`
                      <span class="req-badge ${isBinMissing(bin) ? "missing" : "satisfied"}">
                        ${isBinMissing(bin) ? "✕" : "✓"} ${bin}
                      </span>
                    `,
                  )}
                </div>
              </div>
            `
          : null}
        ${anyBins?.length
          ? html`
              <div class="req-group">
                <div class="req-group-label">
                  <span class="logic-indicator logic-or">Any (OR)</span>
                  <span>满足任意一个命令即可</span>
                </div>
                <div class="req-list">
                  ${anyBins.map(
                    (bin) => html`
                      <span
                        class="req-badge ${missing.anyBins.includes(bin) ? "missing" : "satisfied"}"
                      >
                        ${missing.anyBins.includes(bin) ? "✕" : "✓"} ${bin}
                      </span>
                    `,
                  )}
                </div>
              </div>
            `
          : null}
        ${os?.length
          ? html`
              <div class="req-group">
                <div class="req-group-label">操作系统限制</div>
                <div class="req-list">
                  ${os.map(
                    (osName) => html`
                      <span class="req-badge ${isOsMissing(osName) ? "missing" : "satisfied"}">
                        ${isOsMissing(osName) ? "✕" : "✓"} ${osName}
                      </span>
                    `,
                  )}
                </div>
              </div>
            `
          : null}
        ${env?.length
          ? html`
              <div class="req-group">
                <div class="req-group-label">环境变量</div>
                <div class="req-list">
                  ${env.map(
                    (envVar) => html`
                      <span class="req-badge ${isEnvMissing(envVar) ? "missing" : "satisfied"}">
                        ${isEnvMissing(envVar) ? "✕" : "✓"} ${envVar}
                      </span>
                    `,
                  )}
                </div>
              </div>
            `
          : null}
        ${config?.length
          ? html`
              <div class="req-group">
                <div class="req-group-label">配置项</div>
                <div class="req-list">
                  ${config.map(
                    (cfg) => html`
                      <span class="req-badge ${isConfigMissing(cfg) ? "missing" : "satisfied"}">
                        ${isConfigMissing(cfg) ? "✕" : "✓"} ${cfg}
                      </span>
                    `,
                  )}
                </div>
              </div>
            `
          : null}
      </div>
    `;
  }

  private _renderMissingItems() {
    if (!this.skill || this.skill.eligible) {
      return null;
    }

    const { bins, anyBins, env, config, os } = this.skill.missing;
    const hasMissing = bins.length || anyBins.length || env.length || config.length || os.length;

    if (!hasMissing) {
      return null;
    }

    return html`
      <div class="section-card">
        <div class="section-title-row">
          <span class="section-title-icon">⚠️</span>
          <h3 class="section-title">由于以下原因不可用</h3>
        </div>
        <div class="missing-items">
          ${bins.map((bin) => html` <div class="missing-item">必须存在的命令缺失: ${bin}</div> `)}
          ${anyBins.length
            ? html`
                <div class="missing-item">可选命令缺失 (需至少其中之一): ${anyBins.join(", ")}</div>
              `
            : null}
          ${os.map((osName) => html` <div class="missing-item">不支持的操作系统: ${osName}</div> `)}
          ${env.map((envVar) => html` <div class="missing-item">缺少环境变量: ${envVar}</div> `)}
          ${config.map((cfg) => html` <div class="missing-item">缺少配置: ${cfg}</div> `)}
        </div>
      </div>
    `;
  }

  private _getInstallCommand(item: SkillInstallItem): string {
    const bin = item.bins?.[0] || "";
    if (!bin) {
      return "";
    }

    switch (item.kind) {
      case "brew":
        return `brew install ${bin}`;
      case "npm":
        return `npm install -g ${bin}`;
      case "pip":
      case "pip3":
        return `${item.kind} install ${bin}`;
      case "apt":
        return `sudo apt install ${bin}`;
      case "yarn":
        return `yarn global add ${bin}`;
      case "pnpm":
        return `pnpm add -g ${bin}`;
      default:
        // 如果是自定义或未知，尝试直接组合
        return `${item.kind} install ${bin}`;
    }
  }

  private _renderInstallStatus() {
    if (!this.skill?.install?.length) {
      return html`<p class="section-content">无需安装</p>`;
    }

    return html`
      <div class="install-list">
        ${this.skill.install.map((item) => {
          const command = this._getInstallCommand(item);
          return html`
            <div class="install-item">
              <div class="install-description">
                <span class="install-kind-badge">${item.kind}</span>
                <span>${item.label}</span>
              </div>
              ${command
                ? html`
                    <div class="install-command-wrapper">
                      <code class="install-command">${command}</code>
                    </div>
                  `
                : null}
            </div>
          `;
        })}
      </div>
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
              <div class="panel-icon-wrapper">${this.skill.emoji || "📦"}</div>
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
              <span>${isEnabled ? "已启用" : "已禁用"}</span>
              <div class="toggle-switch-small ${isEnabled ? "enabled" : ""}"></div>
            </button>
          </div>
        </div>

        <div class="panel-content">
          <div class="section">
            <div class="section-title-row">
              <h3 class="section-title">描述</h3>
            </div>
            <p class="section-content">${this.skill.description}</p>
          </div>

          <div class="section">
            <div class="section-title-row">
              <h3 class="section-title">来源</h3>
            </div>
            <span class="source-badge">${this.skill.source}</span>
          </div>

          <div class="section-card">
            <div class="section-title-row">
              <h3 class="section-title">运行时依赖与要求</h3>
            </div>
            ${this._renderRequirements()}
          </div>

          ${this._renderMissingItems()}

          <div class="section">
            <div class="section-title-row">
              <h3 class="section-title">安装建议</h3>
            </div>
            ${this._renderInstallStatus()}
          </div>

          ${this.skill.filePath
            ? html`
                <div class="section">
                  <div class="section-title-row">
                    <h3 class="section-title">位置</h3>
                  </div>
                  <div class="file-path-container">${this.skill.filePath}</div>
                </div>
              `
            : null}
          ${this.skill.homepage
            ? html`
                <div class="section">
                  <div class="section-title-row">
                    <h3 class="section-title">主页</h3>
                  </div>
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
