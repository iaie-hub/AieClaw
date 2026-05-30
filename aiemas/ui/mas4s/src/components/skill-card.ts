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
              title="下载配置"
              aria-label="下载技能 ${this.skill.name}"
              @click=${this._onExport}
            >
              <svg width="14" height="14" viewBox="0 0 1024 1024" fill="currentColor">
                <path
                  d="M960.64 499.2c-28.8-91.52-116.48-150.4-223.36-150.4h-16a345.216 345.216 0 0 0-283.52-224c-140.8-16.64-278.4 56.96-343.68 182.4a346.24 346.24 0 0 0 47.36 386.56c15.36 17.28 42.24 19.2 60.16 3.84 17.28-15.36 19.2-42.24 3.84-60.16a260.672 260.672 0 0 1-35.84-290.56c49.28-94.08 152.96-149.76 258.56-136.96a259.84 259.84 0 0 1 220.8 192.64c5.12 18.56 21.76 32 40.96 32h47.36c68.48 0 124.16 35.84 142.08 91.52 19.2 60.8-2.56 126.08-55.04 163.2a42.88 42.88 0 0 0-10.24 59.52 42.112 42.112 0 0 0 58.88 10.24c83.2-59.52 118.4-163.2 87.68-259.84z"
                ></path>
                <path
                  d="M611.84 698.88l-56.96 56.96V490.88c0-23.68-19.2-42.24-42.88-42.24-23.68 0-42.24 19.2-42.24 42.88v264.96l-57.6-57.6a42.496 42.496 0 1 0-60.16 60.16l129.92 129.92c3.2 3.2 6.4 4.48 9.6 6.4 1.28 0.64 2.56 1.92 3.84 2.56 5.12 1.92 10.88 3.2 16.64 3.2 1.92 0 3.2-0.64 5.12-1.28 3.84-0.64 7.68-0.64 10.88-2.56 5.76-1.92 10.24-5.76 14.72-9.6l129.28-129.28c16.64-16.64 16.64-43.52 0-60.16s-43.52-16-60.16 0.64z"
                ></path>
              </svg>
            </button>
            <button
              class="icon-btn"
              title="上传到 SkillHub"
              aria-label="上传技能 ${this.skill.name}"
              @click=${this._onUpload}
            >
              <svg width="14" height="14" viewBox="0 0 1024 1024" fill="currentColor">
                <path
                  d="M768.35456 416a256 256 0 1 0-512 0 192 192 0 1 0 0 384v64a256 256 0 0 1-58.88-505.216 320.128 320.128 0 0 1 629.76 0A256.128 256.128 0 0 1 768.35456 864v-64a192 192 0 0 0 0-384z m-512 384h128v64H256.35456v-64z m384 0h128v64h-128v-64z"
                ></path>
                <path
                  d="M539.04256 589.184v333.056a32.448 32.448 0 0 1-32 32.192 32.448 32.448 0 0 1-32-32.192V589.184l-36.096 36.096a32.192 32.192 0 0 1-45.056-0.192 31.616 31.616 0 0 1-0.192-45.056l90.88-90.88a31.36 31.36 0 0 1 22.528-9.152 30.08 30.08 0 0 1 22.4 9.088l90.88 90.944a32.192 32.192 0 0 1-0.192 45.056 31.616 31.616 0 0 1-45.056 0.192l-36.096-36.096z"
                ></path>
              </svg>
            </button>
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
