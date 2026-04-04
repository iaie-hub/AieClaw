import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { fetchAgents } from "../gateway/agents-api.js";
import { getClient } from "../gateway/client.js";
import type { AgentEntry } from "../types/agents-types.js";
import "../components/agent-card.js";
import "../components/agent-detail-dialog.js";

/**
 * 智能体列表视图 — 以卡片网格展示所有智能体。
 */
@customElement("agents-view")
export class AgentsView extends LitElement {
  @state() private _agents: AgentEntry[] = [];
  @state() private _defaultId = "";
  @state() private _loading = true;
  @state() private _error = "";
  @state() private _selectedAgent: AgentEntry | null = null;
  @state() private _selectedIsDefault = false;

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
  `;

  connectedCallback() {
    super.connectedCallback();
    void this._fetch();
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

  private _onAgentSelect(e: CustomEvent<{ agent: AgentEntry; isDefault: boolean }>) {
    this._selectedAgent = e.detail.agent;
    this._selectedIsDefault = e.detail.isDefault;
  }

  private _onBack() {
    this._selectedAgent = null;
  }

  render() {
    // ── Detail page (second-level) ──
    if (this._selectedAgent) {
      return html`
        <agent-detail-dialog
          .agent=${this._selectedAgent}
          .isDefault=${this._selectedIsDefault}
          @back=${() => this._onBack()}
        ></agent-detail-dialog>
      `;
    }

    // ── List page ──
    if (this._loading) {
      return html`<div class="center-state">加载中...</div>`;
    }

    if (this._error) {
      return html`
        <div class="center-state">
          <div class="error-msg">${this._error}</div>
          <button class="btn-primary" @click=${() => void this._fetch()}>重试</button>
        </div>
      `;
    }

    if (this._agents.length === 0) {
      return html`
        <div class="center-state">
          <div class="center-icon">🤖</div>
          <div class="center-msg">暂无可用的智能体</div>
        </div>
      `;
    }

    return html`
      <div class="header-area">
        <h1 class="page-title">智能体</h1>
        <p class="subtitle">共 ${this._agents.length} 个智能体</p>
      </div>
      <div class="list-area">
        <div class="cards-grid">
          ${this._agents.map(
            (agent) => html`
              <agent-card
                .agent=${agent}
                .isDefault=${agent.id === this._defaultId}
                @agent-select=${(e: CustomEvent) => this._onAgentSelect(e)}
              ></agent-card>
            `,
          )}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "agents-view": AgentsView;
  }
}
