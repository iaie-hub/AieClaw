import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { SkillStatusEntry } from "../types/skills-types.js";
import downloadIcon from "../../asset/download.svg";
import uploadIcon from "../../asset/upload.svg";



/**
 * Skill 卡片组件
 * 展示单个 Skill 的摘要信息，包括名称、描述和状态指示器
 */
@customElement("skill-card")
export class SkillCard extends LitElement {
  @property({ attribute: false }) skill!: SkillStatusEntry;
  @property({ type: Boolean }) selected = false;
  @property({ type: Boolean }) showCheckbox = false;
  @property({ type: Boolean }) checked = false;

  static styles = css`
    :host {
      display: block;
    }

    .skill-card {
      background: white;
      border: 1px solid #e8edf5;
      border-radius: 12px;
      padding: 16px;
      cursor: pointer;
      transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
      height: 100%;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .skill-card:hover {
      border-color: #3b82f6;
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
      transform: translateY(-2px);
    }

    .skill-card.selected {
      border-color: #3b82f6;
      background: #eff6ff;
    }

    .skill-header {
      display: flex;
      align-items: flex-start;
      gap: 12px;
    }

    .skill-icon {
      font-size: 24px;
      line-height: 1;
      flex-shrink: 0;
    }

    .skill-info {
      flex: 1;
      min-width: 0;
    }

    .skill-checkbox-wrapper {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 4px;
      /* 点击复选框外框停止冒泡，以免触发卡片选择 */
    }

    .skill-checkbox {
      width: 18px;
      height: 18px;
      cursor: pointer;
      accent-color: #3b82f6;
    }

    .skill-info {
      flex: 1;
      min-width: 0;
    }

    .skill-name {
      font-size: 16px;
      font-weight: 600;
      color: #1e293b;
      margin: 0 0 4px 0;
      line-height: 1.4;
      word-break: break-word;
    }

    .skill-description {
      font-size: 14px;
      color: #64748b;
      line-height: 1.5;
      margin: 0;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
      word-break: break-word;
    }

    .skill-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-top: 8px;
      border-top: 1px solid #f1f5f9;
    }

    .skill-source {
      font-size: 12px;
      color: #94a3b8;
      font-weight: 500;
    }

    .skill-status {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 500;
    }

    .skill-top-right {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }

    .skill-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .skill-status-indicator {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .skill-status-indicator.ready {
      background: #10b981;
    }

    .skill-status-indicator.needs-setup {
      background: #f59e0b;
    }

    .skill-status-indicator.disabled {
      background: #94a3b8;
    }

    .skill-status-text {
      color: #64748b;
    }

    .skill-status-text.ready {
      color: #10b981;
    }

    .skill-status-text.needs-setup {
      color: #f59e0b;
    }

    .skill-status-text.disabled {
      color: #94a3b8;
    }

    .icon-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 26px;
      height: 26px;
      border: 1px solid transparent;
      border-radius: 6px;
      background: transparent;
      color: #64748b;
      cursor: pointer;
      transition: all 0.15s;
      padding: 0;
      font-size: 14px;
      line-height: 1;
      flex-shrink: 0;
    }

    .icon-btn:hover {
      background: #f1f5f9;
      color: #3b82f6;
    }

    .icon-btn.delete-btn:hover {
      background: #fee2e2;
      color: #ef4444;
    }
  `;

  private _getStatusClass(): string {
    if (!this.skill.eligible) {
      return "needs-setup";
    }
    if (this.skill.disabled) {
      return "disabled";
    }
    return "ready";
  }

  private _getStatusText(): string {
    if (!this.skill.eligible) {
      return "不可用";
    }
    if (this.skill.disabled) {
      return "已禁用";
    }
    return "就绪";
  }

  private _handleClick = () => {
    this.dispatchEvent(
      new CustomEvent("skill-select", {
        detail: { skill: this.skill },
        bubbles: true,
        composed: true,
      }),
    );
  };

  private _handleCheck = (e: Event) => {
    e.stopPropagation(); // 阻止触发 _handleClick
    this.dispatchEvent(
      new CustomEvent("skill-check", {
        detail: { skill: this.skill, checked: !this.checked },
        bubbles: true,
        composed: true,
      }),
    );
  };

  private _onExport = (e: Event) => {
    e.stopPropagation(); // 阻止事件冒泡以避免触发卡片选择
    this.dispatchEvent(
      new CustomEvent("skill-export", {
        detail: { skill: this.skill },
        bubbles: true,
        composed: true,
      }),
    );
  };

  private _onUpload = (e: Event) => {
    e.stopPropagation(); // 阻止事件冒泡以避免触发卡片选择
    this.dispatchEvent(
      new CustomEvent("skill-upload", {
        detail: { skill: this.skill },
        bubbles: true,
        composed: true,
      }),
    );
  };

  private _onDelete = (e: Event) => {
    e.stopPropagation(); // 阻止事件冒泡以避免触发卡片选择
    this.dispatchEvent(
      new CustomEvent("skill-delete", {
        detail: { skill: this.skill },
        bubbles: true,
        composed: true,
      }),
    );
  };

  render() {
    const statusClass = this._getStatusClass();
    const statusText = this._getStatusText();
    const isWorkspaceSkill =
      this.skill.source === "openclaw-workspace" ||
      this.skill.source === "agents-skills-project";
    const showDelete = !this.skill.bundled && isWorkspaceSkill;

    return html`
      <div
        class="skill-card ${this.selected ? "selected" : ""}"
        @click=${this._handleClick}
        role="button"
        tabindex="0"
        aria-label="${this.skill.name}"
        @keydown=${(e: KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            this._handleClick();
          }
        }}
      >
        <div class="skill-header">
          <div class="skill-icon">${this.skill.emoji || "📦"}</div>
          <div class="skill-info">
            <h3 class="skill-name">${this.skill.name}</h3>
            <p class="skill-description">${this.skill.description}</p>
          </div>
          <div class="skill-top-right">
            <div class="skill-status">
              <span class="skill-status-indicator ${statusClass}"></span>
              <span class="skill-status-text ${statusClass}">${statusText}</span>
            </div>
            ${this.showCheckbox
              ? html`
                  <div class="skill-checkbox-wrapper" @click=${this._handleCheck}>
                    <input
                      type="checkbox"
                      class="skill-checkbox"
                      .checked=${this.checked}
                      tabindex="-1"
                    />
                  </div>
                `
              : ""}
          </div>
        </div>
        <div class="skill-footer">
          <span class="skill-source">${this.skill.source}</span>
          <div class="skill-actions">
            <button
              class="icon-btn"
              title="导出Skill"
              aria-label="导出Skill ${this.skill.name}"
              @click=${this._onExport}
            >
              <img src="${downloadIcon}" width="14" height="14" alt="download" />
            </button>
            <button
              class="icon-btn"
              title="上传到 SkillHub"
              aria-label="上传技能 ${this.skill.name}"
              @click=${this._onUpload}
            >
              <img src="${uploadIcon}" width="14" height="14" alt="upload" />
            </button>
            ${showDelete
              ? html`
                  <button
                    class="icon-btn delete-btn"
                    title="删除技能"
                    aria-label="删除技能 ${this.skill.name}"
                    @click=${this._onDelete}
                  >
                    <svg width="14" height="14" viewBox="0 0 1024 1024" fill="currentColor">
                      <path d="M160 256h704v64H160zM320 160h384v64H320zM224 384v512c0 35.3 28.7 64 64 64h448c35.3 0 64-28.7 64-64V384H224zm192 416h-64V480h64v320zm160 0h-64V480h64v320zm160 0h-64V480h64v320z"></path>
                    </svg>
                  </button>
                `
              : ""}
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "skill-card": SkillCard;
  }
}
