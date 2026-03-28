import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { SkillStatusEntry } from "../types/skills-types.js";

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
  `;

  private _getStatusClass(): string {
    if (this.skill.disabled) {
      return "disabled";
    }
    if (this.skill.eligible) {
      return "ready";
    }
    return "needs-setup";
  }

  private _getStatusText(): string {
    if (this.skill.disabled) {
      return "已禁用";
    }
    if (this.skill.eligible) {
      return "就绪";
    }
    return "需要配置";
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

  render() {
    const statusClass = this._getStatusClass();
    const statusText = this._getStatusText();

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
        <div class="skill-footer">
          <span class="skill-source">${this.skill.source}</span>
          <div class="skill-status">
            <span class="skill-status-indicator ${statusClass}"></span>
            <span class="skill-status-text ${statusClass}">${statusText}</span>
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
