import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";

export interface SkillAgentEntry {
  agentId: string;
  agentName: string;
  status: "online" | "idle" | "busy" | "offline";
}

/**
 * ClawHub Skill 卡片组件 — 展示单个技能及其所属 Agent 列表（含状态标识）。
 * 支持多 Agent 聚合展示。
 */
@customElement("clawhub-skill-card")
export class ClawHubSkillCard extends LitElement {
  /** 技能名称 */
  @property() name = "";

  /** 提供该技能的 Agent 列表 */
  @property({ attribute: false }) agents: SkillAgentEntry[] = [];

  static styles = css`
    :host {
      display: block;
    }

    .card {
      background: white;
      border: 1px solid #e8edf5;
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
      border-color: #8b5cf6;
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

    .icon {
      width: 40px;
      height: 40px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      background: linear-gradient(135deg, #8b5cf6 0%, #a78bfa 100%);
    }

    .icon svg {
      width: 20px;
      height: 20px;
      fill: none;
      stroke: white;
      stroke-width: 2;
      stroke-linecap: round;
      stroke-linejoin: round;
    }

    .skill-name {
      font-size: 16px;
      font-weight: 600;
      color: #1e293b;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
      min-width: 0;
    }

    .agent-count {
      font-size: 12px;
      font-weight: 500;
      padding: 2px 8px;
      border-radius: 9999px;
      background: #f3e8ff;
      color: #7c3aed;
      white-space: nowrap;
      flex-shrink: 0;
    }

    .agents-section {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .agents-label {
      font-size: 12px;
      font-weight: 500;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .agents-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .agent-row {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      background: #f8fafc;
      border-radius: 8px;
      border: 1px solid #f1f5f9;
    }

    .status-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .status-dot--online {
      background: #22c55e;
      box-shadow: 0 0 0 2px #dcfce7;
    }

    .status-dot--idle {
      background: #f59e0b;
      box-shadow: 0 0 0 2px #fef3c7;
    }

    .status-dot--busy {
      background: #f97316;
      box-shadow: 0 0 0 2px #ffedd5;
    }

    .status-dot--offline {
      background: #94a3b8;
      box-shadow: 0 0 0 2px #f1f5f9;
    }

    .agent-name {
      font-size: 13px;
      font-weight: 500;
      color: #334155;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
      min-width: 0;
    }

    .agent-status-label {
      font-size: 11px;
      color: #64748b;
      flex-shrink: 0;
    }
  `;

  render() {
    return html`
      <div class="card">
        <div class="header">
          <div class="icon">
            <svg viewBox="0 0 24 24">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <span class="skill-name">${this.name}</span>
          ${this.agents.length > 1
            ? html`<span class="agent-count">${this.agents.length} Agents</span>`
            : ""}
        </div>
        <div class="agents-section">
          <span class="agents-label">提供者</span>
          <div class="agents-list">
            ${this.agents.map(
              (agent) => html`
                <div class="agent-row">
                  <span class="status-dot status-dot--${agent.status}"></span>
                  <span class="agent-name">${agent.agentName}</span>
                  <span class="agent-status-label">${agent.status}</span>
                </div>
              `,
            )}
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "clawhub-skill-card": ClawHubSkillCard;
  }
}
