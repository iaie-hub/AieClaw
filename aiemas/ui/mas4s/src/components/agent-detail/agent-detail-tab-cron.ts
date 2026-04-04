import { LitElement, html, nothing } from "lit";
import { customElement, state } from "lit/decorators.js";
import { fetchCronStatus, fetchCronList } from "../../gateway/agents-api.js";
import { getClient } from "../../gateway/client.js";
import type { AgentCronStatusPayload, AgentCronJob } from "../../types/agents-types.js";
import { tabPanelStyles } from "./shared-styles.js";

@customElement("agent-tab-cron")
export class AgentTabCron extends LitElement {
  @state() private _loading = true;
  @state() private _status: AgentCronStatusPayload | null = null;
  @state() private _jobs: AgentCronJob[] = [];
  @state() private _detail: AgentCronJob | null = null;

  static styles = tabPanelStyles;

  connectedCallback() {
    super.connectedCallback();
    void this._load();
  }

  private async _load() {
    this._loading = true;
    try {
      const client = getClient();
      const [sRes, lRes] = await Promise.allSettled([
        fetchCronStatus(client),
        fetchCronList(client),
      ]);
      if (sRes.status === "fulfilled") {
        this._status = sRes.value;
      }
      if (lRes.status === "fulfilled") {
        this._jobs = lRes.value.jobs;
      }
    } catch {
      /* */
    } finally {
      this._loading = false;
    }
  }

  private _fmtTime(ms?: number | null) {
    return ms == null ? "—" : new Date(ms).toLocaleString("zh-CN");
  }

  render() {
    if (this._loading) {
      return html`<div class="loading-state">加载中...</div>`;
    }
    return html`
      ${this._status
        ? html`
            <div class="item-card" style="cursor:default;margin-bottom:16px;">
              <div class="card-head">
                <div class="card-title">⏱️ Cron 引擎状态</div>
                ${this._status.enabled
                  ? html`<span class="status-ok">运行中</span>`
                  : html`<span class="status-disabled">已停止</span>`}
              </div>
              <div class="card-desc">
                当前注册任务数: ${this._status.jobs}<br />
                存储路径: ${this._status.storePath}
              </div>
            </div>
          `
        : nothing}
      ${this._jobs.length > 0
        ? html`
            <div class="grid">
              ${this._jobs.map(
                (j) => html`
                  <div
                    class="item-card"
                    @click=${() => {
                      this._detail = j;
                    }}
                  >
                    <div class="card-head">
                      <div class="card-title">${j.label ?? j.id}</div>
                      ${j.enabled
                        ? html`<span class="status-ok">启用</span>`
                        : html`<span class="status-disabled">禁用</span>`}
                    </div>
                    <div class="card-desc">${j.schedule ?? "—"}</div>
                  </div>
                `,
              )}
            </div>
          `
        : html`<div class="empty-state">暂无定时任务</div>`}
      ${this._detail ? this._renderDetail(this._detail) : nothing}
    `;
  }

  private _renderDetail(j: AgentCronJob) {
    return html`
      <div
        class="sub-overlay"
        @click=${(e: MouseEvent) => {
          if (e.target === e.currentTarget) {
            this._detail = null;
          }
        }}
      >
        <div class="sub-dialog">
          <div class="sub-header">
            <div class="sub-title">⏱️ ${j.label ?? j.id}</div>
            <button
              class="close-btn"
              @click=${() => {
                this._detail = null;
              }}
            >
              ✕
            </button>
          </div>
          <div class="sub-body">
            <div class="detail-row">
              <span class="detail-label">ID</span><span class="detail-value">${j.id}</span>
            </div>
            ${j.label
              ? html`<div class="detail-row">
                  <span class="detail-label">名称</span><span class="detail-value">${j.label}</span>
                </div>`
              : nothing}
            ${j.schedule
              ? html`<div class="detail-row">
                  <span class="detail-label">调度</span
                  ><span class="detail-value">${j.schedule}</span>
                </div>`
              : nothing}
            <div class="detail-row">
              <span class="detail-label">状态</span
              ><span class="detail-value">${j.enabled ? "启用" : "禁用"}</span>
            </div>
            <div class="detail-row">
              <span class="detail-label">下次执行</span
              ><span class="detail-value">${this._fmtTime(j.nextRunAtMs)}</span>
            </div>
          </div>
        </div>
      </div>
    `;
  }
}
