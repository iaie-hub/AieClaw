import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";

export type AgentStatus = "online" | "idle" | "busy" | "offline";

/**
 * ClawHub Agent 卡片组件 — 展示远程 AgentRegistry 中单个 Agent 的摘要信息。
 * 包含名称、ID、状态标识和技能标签列表（最多 5 个，超出折叠）。
 */
@customElement("clawhub-agent-card")
export class ClawHubAgentCard extends LitElement {
  @property() name = "";
  @property() agentId = "";
  @property() status: AgentStatus = "offline";
  @property({ type: Array }) skills: Array<string | { name: string }> = [];

  static styles = css`
    :host {
      display: block;
    }

    .card {
      background: var(--card-bg, white);
      border: 1px solid var(--card-border, #e8edf5);
      border-radius: 12px;
      padding: 20px;
      transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
      height: 100%;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      gap: 14px;
      cursor: pointer;
    }

    .card:hover {
      border-color: var(--card-hover-border, #3b82f6);
      box-shadow:
        0 10px 20px rgba(0, 0, 0, 0.06),
        0 4px 6px rgba(0, 0, 0, 0.04);
      transform: translateY(-4px);
    }

    .header {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .avatar {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
    }

    .avatar svg {
      width: 22px;
      height: 22px;
      fill: white;
    }

    .info {
      flex: 1;
      min-width: 0;
    }

    .name-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .agent-name {
      font-size: 16px;
      font-weight: 600;
      color: var(--text-primary, #1e293b);
      margin: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .status-indicator {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .status-indicator.online {
      background: #22c55e;
      box-shadow: 0 0 0 2px #dcfce7;
    }

    .status-indicator.idle {
      background: #f59e0b;
      box-shadow: 0 0 0 2px #fef3c7;
    }

    .status-indicator.busy {
      background: #f97316;
      box-shadow: 0 0 0 2px #ffedd5;
    }

    .status-indicator.offline {
      background: #94a3b8;
      box-shadow: 0 0 0 2px #f1f5f9;
    }

    .agent-id {
      font-size: 13px;
      color: var(--text-muted, #94a3b8);
      margin: 2px 0 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .skills-section {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding-top: 10px;
      border-top: 1px solid var(--divider, #f1f5f9);
    }

    .skill-tag {
      font-size: 12px;
      padding: 3px 10px;
      background: var(--tag-bg, #f1f5f9);
      border: 1px solid var(--tag-border, #e2e8f0);
      border-radius: 6px;
      color: var(--tag-text, #475569);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 140px;
    }

    .skill-overflow {
      font-size: 12px;
      padding: 3px 10px;
      background: var(--overflow-bg, #eff6ff);
      border: 1px solid var(--overflow-border, #bfdbfe);
      border-radius: 6px;
      color: var(--overflow-text, #3b82f6);
      font-weight: 500;
      white-space: nowrap;
    }

    .status-label {
      font-size: 11px;
      font-weight: 500;
      padding: 2px 8px;
      border-radius: 9999px;
      white-space: nowrap;
      flex-shrink: 0;
    }

    .status-label.online {
      background: #dcfce7;
      color: #15803d;
    }

    .status-label.idle {
      background: #fef3c7;
      color: #92400e;
    }

    .status-label.busy {
      background: #ffedd5;
      color: #9a3412;
    }

    .status-label.offline {
      background: #f1f5f9;
      color: #64748b;
    }
  `;

  private _statusText(status: AgentStatus): string {
    switch (status) {
      case "online":
        return "在线";
      case "idle":
        return "空闲";
      case "busy":
        return "忙碌";
      case "offline":
        return "离线";
    }
  }

  render() {
    const maxSkills = 5;
    const skillNames = (this.skills || []).map((s) => (typeof s === "string" ? s : s?.name || ""));
    const visibleSkills = skillNames.slice(0, maxSkills);
    const overflowCount = skillNames.length - maxSkills;

    return html`
      <div class="card" role="article" aria-label="${this.name || this.agentId}">
        <div class="header">
          <div class="avatar">
            <svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
              <path
                d="M12 2a2 2 0 0 1 2 2c0 .74-.4 1.39-1 1.73V7h1a7 7 0 0 1 7 7h1a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-1.07A7.001 7.001 0 0 1 14 23h-4a7.001 7.001 0 0 1-6.93-6H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1h1a7 7 0 0 1 7-7h1V5.73c-.6-.34-1-.99-1-1.73a2 2 0 0 1 2-2zm-2 9a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm4 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"
              />
            </svg>
          </div>
          <div class="info">
            <div class="name-row">
              <h3 class="agent-name">${this.name || this.agentId}</h3>
              <span
                class="status-indicator ${this.status}"
                title="${this._statusText(this.status)}"
              ></span>
              <span class="status-label ${this.status}">
                ${this._statusText(this.status)}
              </span>
            </div>
            <p class="agent-id">ID: ${this.agentId}</p>
          </div>
        </div>

        ${this.skills.length > 0
          ? html`
              <div class="skills-section">
                ${visibleSkills.map(
                  (skill) => html`<span class="skill-tag" title="${skill}">${skill}</span>`,
                )}
                ${overflowCount > 0
                  ? html`<span class="skill-overflow">+${overflowCount}</span>`
                  : ""}
              </div>
            `
          : ""}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "clawhub-agent-card": ClawHubAgentCard;
  }
}
