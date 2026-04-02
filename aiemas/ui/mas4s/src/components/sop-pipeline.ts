import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";

/**
 * SOP step state (mirrors backend SOPStepState).
 */
export interface SOPStepView {
  skill: string;
  label: string;
  icon?: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  startedAt?: number;
  completedAt?: number;
  elapsed?: number;
}

/**
 * Skill-level progress (from skill.progress events).
 */
export interface SkillProgressView {
  skill: string;
  total: number;
  completed: number;
  currentItem?: { index: number; label: string; pct: number; message?: string };
}

/**
 * Progress log entry.
 */
export interface ProgressLogEntry {
  ts: number;
  skill: string;
  message: string;
  level: string;
}

function formatElapsed(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }
  const s = Math.round(ms / 1000);
  if (s < 60) {
    return `${s}s`;
  }
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return rem > 0 ? `${m}m${rem}s` : `${m}m`;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

/**
 * SOP Pipeline — renders the SOP flow with step statuses, progress bars, and logs.
 */
@customElement("sop-pipeline")
export class SOPPipeline extends LitElement {
  @property({ attribute: false }) steps: SOPStepView[] = [];
  @property({ attribute: false }) sopLabel = "";
  @property({ attribute: false }) activeProgress: SkillProgressView | null = null;
  @property({ attribute: false }) logs: ProgressLogEntry[] = [];
  @property({ type: Number }) currentStepIndex = -1;
  @property({ type: Boolean }) logsExpanded = false;
  @property({ type: Boolean }) compact = false;
  @property({ type: Number }) completedAt: number | undefined = undefined;
  @state() private _expanded = false;

  static styles = css`
    :host {
      display: block;
      margin: 12px 0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    }
    .pipeline-card {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      padding: 16px;
    }
    .pipeline-title {
      font-size: 13px;
      font-weight: 600;
      color: #475569;
      margin-bottom: 12px;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .step {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 6px 0;
      font-size: 13px;
      color: #64748b;
    }
    .step.running {
      color: #2563eb;
      font-weight: 500;
    }
    .step.completed {
      color: #16a34a;
    }
    .step.failed {
      color: #dc2626;
    }
    .step-icon {
      width: 20px;
      text-align: center;
      flex-shrink: 0;
    }
    .step-label {
      flex: 1;
      min-width: 0;
    }
    .step-elapsed {
      font-size: 11px;
      color: #94a3b8;
      flex-shrink: 0;
    }
    .progress-section {
      margin: 4px 0 4px 30px;
      font-size: 12px;
      color: #64748b;
    }
    .progress-bar-track {
      height: 6px;
      background: #e2e8f0;
      border-radius: 3px;
      overflow: hidden;
      margin: 4px 0;
    }
    .progress-bar-fill {
      height: 100%;
      background: linear-gradient(90deg, #3b82f6, #60a5fa);
      border-radius: 3px;
      transition: width 0.3s ease;
    }
    .progress-detail {
      font-size: 11px;
      color: #94a3b8;
    }
    .logs-toggle {
      margin-top: 8px;
      font-size: 11px;
      color: #3b82f6;
      cursor: pointer;
      user-select: none;
    }
    .logs-toggle:hover {
      text-decoration: underline;
    }
    .logs-panel {
      margin-top: 6px;
      max-height: 200px;
      overflow-y: auto;
      font-size: 11px;
      font-family: "SF Mono", Monaco, Consolas, monospace;
      background: #1e293b;
      color: #e2e8f0;
      border-radius: 8px;
      padding: 8px 10px;
    }
    .log-line {
      padding: 2px 0;
      white-space: pre-wrap;
      word-break: break-all;
      line-height: 1.4;
    }
    .log-line .log-time {
      color: #64748b;
      margin-right: 6px;
    }
    .log-line.warn {
      color: #fbbf24;
    }
    .log-line.error {
      color: #f87171;
    }

    /* Compact mode styles */
    .compact-container {
      cursor: pointer;
      padding: 8px 12px;
      border-radius: 12px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      transition: all 0.2s;
      user-select: none;
    }
    .compact-container:hover {
      background: #f1f5f9;
      border-color: #cbd5e1;
    }
    .compact-row {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      line-height: 1.4;
    }
    .compact-skill {
      font-weight: 600;
      color: #1e293b;
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .compact-status {
      color: #64748b;
      font-size: 12px;
    }
    .compact-progress-row {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 4px;
    }
    .compact-bar {
      flex: 1;
      height: 4px;
      background: #e2e8f0;
      border-radius: 2px;
      overflow: hidden;
    }
    .compact-fill {
      height: 100%;
      background: #3b82f6;
      transition: width 0.3s ease;
    }
    .compact-pct {
      font-size: 11px;
      color: #94a3b8;
      min-width: 60px;
      text-align: right;
    }
  `;

  private _statusIcon(status: string): string {
    switch (status) {
      case "completed":
        return "✅";
      case "running":
        return "🔄";
      case "failed":
        return "❌";
      case "skipped":
        return "⏭️";
      default:
        return "⏳";
    }
  }

  private _toggleLogs = () => {
    this.logsExpanded = !this.logsExpanded;
  };

  private _toggleExpanded = () => {
    this._expanded = !this._expanded;
  };

  render() {
    if (this.steps.length === 0) {
      return html``;
    }

    // Use internal _expanded state if compact is enabled, otherwise always show full
    const isExpanded = !this.compact || this._expanded;

    if (!isExpanded) {
      return this._renderCompact();
    }

    return html`
      <div class="pipeline-card" @click=${this.compact ? this._toggleExpanded : null}>
        <div class="pipeline-title">
          📋 ${this.sopLabel || "SOP 执行进度"}
          ${this.compact
            ? html`<span
                style="margin-left: auto; color: #94a3b8; font-weight: normal; font-size: 11px;"
                >点击收起</span
              >`
            : ""}
        </div>
        ${this.steps.map(
          (step, _i) => html`
            <div class="step ${step.status}">
              <span class="step-icon">${step.icon || this._statusIcon(step.status)}</span>
              <span class="step-label">${step.label}</span>
              ${step.elapsed != null
                ? html`<span class="step-elapsed">${formatElapsed(step.elapsed)}</span>`
                : step.status === "running" && step.startedAt
                  ? html`<span class="step-elapsed">⏱️</span>`
                  : html``}
            </div>
            ${step.status === "running" && this.activeProgress?.skill === step.skill
              ? this._renderProgress()
              : html``}
          `,
        )}
        ${this.logs.length > 0
          ? html`
              <div
                class="logs-toggle"
                @click=${(e: Event) => {
                  e.stopPropagation();
                  this._toggleLogs();
                }}
              >
                ${this.logsExpanded ? "▼ 收起日志" : `▶ 查看日志 (${this.logs.length})`}
              </div>
              ${this.logsExpanded ? this._renderLogs() : html``}
            `
          : html``}
      </div>
    `;
  }

  private _renderCompact() {
    let currentStep =
      this.currentStepIndex >= 0 && this.currentStepIndex < this.steps.length
        ? this.steps[this.currentStepIndex]
        : null;

    if (!currentStep) {
      currentStep =
        this.steps.find((s) => s.status === "running") ||
        this.steps.find((s) => s.status === "pending") ||
        this.steps[this.steps.length - 1];
    }

    if (!currentStep) {
      return html``;
    }

    const p = this.activeProgress;
    const totalSteps = this.steps.length;
    const completedSteps = this.steps.filter((s) => s.status === "completed").length;

    let overallPct = 0;
    if (totalSteps > 0) {
      if (this.completedAt) {
        overallPct = 100;
      } else {
        const currentSkillPct = p && p.total > 0 ? p.completed / p.total : 0;
        overallPct = Math.round(((completedSteps + currentSkillPct) / totalSteps) * 100);
      }
    }

    return html`
      <div class="compact-container" @click=${this._toggleExpanded}>
        <div class="compact-row">
          <span class="step-icon">${currentStep.icon || this._statusIcon(currentStep.status)}</span>
          <span class="compact-skill">${currentStep.label}</span>
          <span class="compact-status">
            ${this.completedAt
              ? "已完成"
              : currentStep.status === "running"
                ? "执行中"
                : currentStep.status === "completed"
                  ? "已完成"
                  : "等待中"}
          </span>
        </div>
        <div class="compact-progress-row">
          <div class="compact-bar">
            <div class="compact-fill" style="width: ${overallPct}%"></div>
          </div>
          <span class="compact-pct"> ${completedSteps}/${totalSteps} (${overallPct}%) </span>
        </div>
      </div>
    `;
  }

  private _renderProgress() {
    const p = this.activeProgress;
    if (!p) {
      return html``;
    }
    const overallPct = p.total > 0 ? Math.round((p.completed / p.total) * 100) : 0;
    return html`
      <div class="progress-section">
        <div>${p.completed}/${p.total}</div>
        <div class="progress-bar-track">
          <div class="progress-bar-fill" style="width:${overallPct}%"></div>
        </div>
        ${p.currentItem
          ? html`
              <div class="progress-detail">
                当前: ${p.currentItem.label || `#${p.currentItem.index}`}
                ${p.currentItem.pct != null ? `(${p.currentItem.pct}%)` : ""}
                ${p.currentItem.message ? ` — ${p.currentItem.message}` : ""}
              </div>
            `
          : html``}
      </div>
    `;
  }

  private _renderLogs() {
    // Chronological order (oldest first), auto-scroll to bottom on new entries.
    const recent: ProgressLogEntry[] = this.logs.slice(-100);
    return html`
      <div class="logs-panel">
        ${recent.map(
          (log) =>
            html`<div
              class="log-line ${log.level === "warn"
                ? "warn"
                : log.level === "error"
                  ? "error"
                  : ""}"
            >
              <span class="log-time">${formatTime(log.ts)}</span>${log.message}
            </div>`,
        )}
      </div>
    `;
  }

  override updated(changed: Map<string, unknown>) {
    super.updated(changed);
    if (this.logsExpanded) {
      const panel = this.shadowRoot?.querySelector(".logs-panel");
      if (panel) {
        panel.scrollTop = panel.scrollHeight;
      }
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sop-pipeline": SOPPipeline;
  }
}
