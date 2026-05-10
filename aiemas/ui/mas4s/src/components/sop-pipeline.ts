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
  return rem > 0 ? `${m}m ${rem}s` : `${m}m`;
}

function formatRunningTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = String(Math.floor(s / 60)).padStart(2, "0");
  const sec = String(s % 60).padStart(2, "0");
  return `${m}:${sec}`;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `[${h}:${m}:${s}.${ms}]`;
}

function formatFullTimestamp(ts: number): string {
  const d = new Date(ts);
  const Y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, "0");
  const D = String(d.getDate()).padStart(2, "0");
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  const s = String(d.getSeconds()).padStart(2, "0");
  const ms = String(d.getMilliseconds()).padStart(3, "0");
  return `${Y}-${M}-${D} ${h}:${m}:${s}.${ms}`;
}

function formatElapsedSeconds(ms: number): string {
  return (ms / 1000).toFixed(1);
}
/**
 * SOP Pipeline — Timeline layout with log tailing, matching the reference design.
 * Status is read dynamically from messages, not hardcoded.
 */
@customElement("sop-pipeline")
export class SOPPipeline extends LitElement {
  @property({ attribute: false }) steps: SOPStepView[] = [];
  @property({ attribute: false }) sopLabel = "";
  @property({ attribute: false }) sopIcon = "";
  @property({ attribute: false }) activeProgress: SkillProgressView | null = null;
  @property({ attribute: false }) logs: ProgressLogEntry[] = [];
  @property({ type: Number }) currentStepIndex = -1;
  @property({ type: Boolean }) logsExpanded = false;
  @property({ type: Boolean }) compact = false;
  @property({ type: Number }) completedAt: number | undefined = undefined;
  @state() private _expanded = false;
  @state() private _logsCollapsed = true;

  static styles = css`
    :host {
      display: block;
      margin: 8px 0;
      font-family:
        -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      --primary-color: #1a73e8;
      --success-color: #34a853;
      --error-color: #d93025;
      --text-main: #202124;
      --text-muted: #5f6368;
      --border-color: #dadce0;
      --bg-card: #ffffff;
      --bg-tailing: #f1f3f4;
      --bg-terminal: #202124;
      --text-terminal: #e8eaed;
    }

    /* ── Main card ── */
    .sop-card {
      background: var(--bg-card);
      border-radius: 10px;
      box-shadow:
        0 1px 6px rgba(0, 0, 0, 0.04),
        0 0 1px rgba(0, 0, 0, 0.15);
      padding: 14px 16px;
    }

    /* ── Header ── */
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 10px;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--border-color);
    }
    .card-title {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      font-weight: 600;
      color: var(--text-main);
    }
    .card-title svg {
      fill: var(--text-muted);
    }
    .card-title .sop-icon {
      font-size: 14px;
      line-height: 1;
    }
    .card-header-right {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .sop-time-info {
      font-size: 11px;
      color: var(--text-muted);
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .sop-time-info .time-label {
      color: var(--text-muted);
    }
    .sop-time-info .time-value {
      color: var(--text-main);
      font-weight: 500;
    }
    .sop-time-info .time-elapsed {
      color: var(--primary-color);
      font-weight: 500;
    }
    .btn-icon {
      background: none;
      border: none;
      cursor: pointer;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      padding: 4px;
      border-radius: 4px;
    }
    .btn-icon:hover {
      background: var(--bg-tailing);
    }

    /* ── Timeline ── */
    .timeline {
      display: flex;
      flex-direction: column;
    }
    .step {
      display: flex;
      position: relative;
      padding-bottom: 16px;
    }
    .step:last-child {
      padding-bottom: 0;
    }

    /* Vertical connector line */
    .step:not(:last-child)::after {
      content: "";
      position: absolute;
      left: 8px;
      top: 20px;
      bottom: 2px;
      width: 1.5px;
      background: var(--border-color);
      z-index: 1;
    }
    .step.completed:not(:last-child)::after {
      background: var(--success-color);
      opacity: 0.3;
    }

    /* ── Step indicator (icon circle) ── */
    .step-indicator {
      position: relative;
      z-index: 2;
      width: 18px;
      height: 18px;
      border-radius: 50%;
      background: var(--bg-card);
      display: flex;
      justify-content: center;
      align-items: center;
      flex-shrink: 0;
      margin-right: 10px;
    }
    .step.completed .step-indicator {
      background: var(--success-color);
      color: #fff;
    }
    .step.running .step-indicator {
      border: 2px solid var(--primary-color);
      border-top-color: transparent;
      animation: spin 1s linear infinite;
    }
    .step.pending .step-indicator {
      border: 1.5px solid var(--border-color);
    }
    .step.failed .step-indicator {
      background: var(--error-color);
      color: #fff;
    }
    .step.skipped .step-indicator {
      background: var(--bg-tailing);
      color: var(--text-muted);
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }

    /* ── Step content ── */
    .step-content {
      flex: 1;
      min-width: 0;
      padding-top: 1px;
    }
    .step-header {
      display: flex;
      align-items: center;
    }
    .step-title {
      font-size: 12px;
      font-weight: 500;
      color: var(--text-main);
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }
    .step-title .step-icon {
      font-size: 12px;
      line-height: 1;
    }
    .step-time-range {
      font-size: 10px;
      color: var(--text-muted);
      font-variant-numeric: tabular-nums;
      font-weight: 400;
      flex: 1;
      text-align: right;
      margin: 0 8px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .step-meta {
      font-size: 11px;
      color: var(--text-muted);
      font-variant-numeric: tabular-nums;
      flex-shrink: 0;
      width: 72px;
      text-align: right;
    }
    .step.pending .step-title {
      color: var(--text-muted);
    }
    .step.running .step-meta {
      color: var(--primary-color);
      font-weight: 500;
    }
    .step.failed .step-meta {
      color: var(--error-color);
      font-weight: 500;
    }

    /* ── Log tailing area (running step) ── */
    .tailing-log {
      background: var(--bg-tailing);
      border-radius: 4px;
      padding: 4px 8px;
      margin-top: 4px;
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier, monospace;
      font-size: 10.5px;
      color: var(--text-muted);
      line-height: 1.4;
      overflow: hidden;
    }
    .tailing-line {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .tailing-line::before {
      content: ">";
      margin-right: 4px;
      opacity: 0.5;
    }

    /* ── Global terminal log ── */
    .global-terminal {
      margin-top: 12px;
      border-radius: 6px;
      overflow: hidden;
      border: 1px solid var(--border-color);
    }
    .terminal-header {
      background: var(--bg-tailing);
      padding: 5px 10px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 11px;
      font-weight: 500;
      color: var(--text-main);
      border-bottom: 1px solid var(--border-color);
      cursor: pointer;
      user-select: none;
    }
    .terminal-header:hover {
      background: #e8eaed;
    }
    .terminal-body {
      background: var(--bg-terminal);
      color: var(--text-terminal);
      padding: 8px 10px;
      font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier, monospace;
      font-size: 10.5px;
      line-height: 1.5;
      max-height: 160px;
      overflow-y: auto;
    }
    .log-line {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .log-timestamp {
      color: #8ab4f8;
      margin-right: 6px;
    }
    .log-line.warn .log-timestamp {
      color: #fdd663;
    }
    .log-line.warn {
      color: #fdd663;
    }
    .log-line.error .log-timestamp {
      color: #f28b82;
    }
    .log-line.error {
      color: #f28b82;
    }

    /* ── Compact mode ── */
    .compact-container {
      cursor: pointer;
      padding: 8px 12px;
      border-radius: 12px;
      background: var(--bg-card);
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
      border: 1px solid var(--border-color);
      transition: all 0.2s;
      user-select: none;
    }
    .compact-container:hover {
      background: var(--bg-tailing);
      border-color: #bdc1c6;
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
      color: var(--text-main);
      flex: 1;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .compact-pct {
      font-size: 12px;
      color: var(--text-muted);
    }
    .compact-indicator {
      width: 18px;
      height: 18px;
      border-radius: 50%;
      display: flex;
      justify-content: center;
      align-items: center;
      flex-shrink: 0;
    }
    .compact-indicator.running {
      border: 2px solid var(--primary-color);
      border-top-color: transparent;
      animation: spin 1s linear infinite;
    }
    .compact-indicator.completed {
      background: var(--success-color);
      color: #fff;
    }
  `;

  /* ── SVG helpers ── */

  private _checkSvg = html`<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
    <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
  </svg>`;
  private _crossSvg = html`<svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor">
    <path
      d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
    />
  </svg>`;
  private _skipSvg = html`<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
    <path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z" />
  </svg>`;
  private _docSvg = html`<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
    <path
      d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"
    />
  </svg>`;
  private _chevronUp = html`<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 8l-6 6 1.41 1.41L12 10.83l4.59 4.58L18 14z" />
  </svg>`;
  private _chevronDown = html`<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
    <path d="M16.59 8.59L12 13.17 7.41 8.59 6 10l6 6 6-6z" />
  </svg>`;

  private _stepIndicator(status: string) {
    switch (status) {
      case "completed":
        return this._checkSvg;
      case "failed":
        return this._crossSvg;
      case "skipped":
        return this._skipSvg;
      default:
        return html``;
    }
  }

  private _stepMeta(step: SOPStepView) {
    switch (step.status) {
      case "completed":
        return step.elapsed != null ? formatElapsed(step.elapsed) : "";
      case "running": {
        const elapsed = step.startedAt ? Date.now() - step.startedAt : 0;
        return `执行中 ${formatRunningTime(step.elapsed ?? elapsed)}`;
      }
      case "failed":
        return "失败";
      case "skipped":
        return "已跳过";
      default:
        return "等待中";
    }
  }

  private _stepTimeRange(step: SOPStepView) {
    if (!step.startedAt) {
      return html``;
    }
    if (step.status === "completed" && step.completedAt) {
      return html`<span class="step-time-range"
        >${formatFullTimestamp(step.startedAt)} ~ ${formatFullTimestamp(step.completedAt)}</span
      >`;
    }
    if (step.status === "running") {
      return html`<span class="step-time-range">${formatFullTimestamp(step.startedAt)} ~</span>`;
    }
    return html``;
  }

  /** Collapse when clicking outside this component (only in compact mode). */
  private _onDocumentClick = (e: MouseEvent) => {
    if (!this.compact || !this._expanded) {
      return;
    }
    const path = e.composedPath();
    if (!path.includes(this)) {
      this._expanded = false;
    }
  };

  override connectedCallback() {
    super.connectedCallback();
    document.addEventListener("click", this._onDocumentClick, true);
  }

  override disconnectedCallback() {
    document.removeEventListener("click", this._onDocumentClick, true);
    super.disconnectedCallback();
  }

  private _toggleExpanded = () => {
    this._expanded = !this._expanded;
  };
  private _toggleTerminal = (e: Event) => {
    e.stopPropagation();
    this._logsCollapsed = !this._logsCollapsed;
  };

  render() {
    if (this.steps.length === 0) {
      return html``;
    }

    const isExpanded = !this.compact || this._expanded;
    if (!isExpanded) {
      return this._renderCompact();
    }

    // Auto-expand terminal when there's an error step
    const hasError = this.steps.some((s) => s.status === "failed");

    return html`
      <div class="sop-card" @click=${this.compact ? this._toggleExpanded : null}>
        <!-- Header -->
        <div class="card-header">
          <div class="card-title">
            ${this.sopIcon ? html`<span class="sop-icon">${this.sopIcon}</span>` : this._docSvg}
            ${this.sopLabel || "SOP 执行进度"}
          </div>
          <div class="card-header-right">
            ${this._renderTimeInfo()}
            ${this.compact
              ? html` <button class="btn-icon" title="收起面板">${this._chevronUp}</button> `
              : ""}
          </div>
        </div>

        <!-- Timeline -->
        <div class="timeline">
          ${this.steps.map(
            (step) => html`
              <div class="step ${step.status}">
                <div class="step-indicator">${this._stepIndicator(step.status)}</div>
                <div class="step-content">
                  <div class="step-header">
                    <span class="step-title">
                      ${step.icon ? html`<span class="step-icon">${step.icon}</span>` : ""}
                      ${step.label}
                    </span>
                    ${this._stepTimeRange(step)}
                    <span class="step-meta">${this._stepMeta(step)}</span>
                  </div>
                  ${step.status === "running" ? this._renderTailingLog(step.skill) : html``}
                </div>
              </div>
            `,
          )}
        </div>

        <!-- Global terminal log -->
        ${this.logs.length > 0
          ? html`
              <div class="global-terminal">
                <div class="terminal-header" @click=${this._toggleTerminal}>
                  <span>${this._logSkillLabel()}</span>
                  <button
                    class="btn-icon"
                    title="${this._logsCollapsed && !hasError ? "展开日志" : "收起日志"}"
                  >
                    ${this._logsCollapsed && !hasError ? this._chevronDown : this._chevronUp}
                  </button>
                </div>
                ${!this._logsCollapsed || hasError ? this._renderTerminalBody() : html``}
              </div>
            `
          : html``}
      </div>
    `;
  }

  /** SOP time info: start/end time and elapsed */
  private _renderTimeInfo() {
    // Determine SOP start time from the first step's startedAt
    const firstStep = this.steps[0];
    const sopStartedAt = firstStep?.startedAt;
    if (!sopStartedAt) {
      return html``;
    }

    if (this.completedAt) {
      // SOP completed
      const elapsedSec = formatElapsedSeconds(this.completedAt - sopStartedAt);
      return html`
        <span class="sop-time-info">
          <span class="time-value">${formatFullTimestamp(sopStartedAt)}</span>
          <span class="time-label"> ~ </span>
          <span class="time-value">${formatFullTimestamp(this.completedAt)}</span>
          <span class="time-label">，耗时 </span>
          <span class="time-elapsed">${elapsedSec} 秒</span>
        </span>
      `;
    }

    // SOP still running
    return html`
      <span class="sop-time-info">
        <span class="time-value">${formatFullTimestamp(sopStartedAt)}</span>
        <span class="time-label"> ~ </span>
      </span>
    `;
  }

  /** Tailing log: last 1 line of stdout for the running step */
  private _renderTailingLog(skill: string) {
    const lines = this.logs.filter((l) => l.skill === skill).slice(-1);
    if (lines.length === 0) {
      return html``;
    }
    return html`
      <div class="tailing-log">
        ${lines.map((l) => html`<div class="tailing-line">${l.message}</div>`)}
      </div>
    `;
  }

  /** Determine the skill label for the log panel title */
  private _logSkillLabel(): string {
    // Find the skill from the most recent log entry
    const lastLog = this.logs[this.logs.length - 1];
    if (lastLog) {
      const step = this.steps.find((s) => s.skill === lastLog.skill);
      if (step) {
        return `${step.icon ?? ""} ${step.label} - 运行日志`.trim();
      }
    }
    return "系统运行日志";
  }

  /** Full terminal log panel */
  private _renderTerminalBody() {
    const recent = this.logs.slice(-100);
    return html`
      <div class="terminal-body">
        ${recent.map(
          (log) => html`
            <div
              class="log-line ${log.level === "warn"
                ? "warn"
                : log.level === "error"
                  ? "error"
                  : ""}"
            >
              <span class="log-timestamp">${formatTime(log.ts)}</span>${log.message}
            </div>
          `,
        )}
      </div>
    `;
  }

  /** Compact collapsed view */
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

    const totalSteps = this.steps.length;
    const displayIndex = this.completedAt
      ? totalSteps
      : Math.min(this.currentStepIndex + 1, totalSteps);

    const indicatorClass =
      currentStep.status === "completed"
        ? "completed"
        : currentStep.status === "running"
          ? "running"
          : "";

    return html`
      <div class="compact-container" @click=${this._toggleExpanded}>
        <div class="compact-row">
          <div class="compact-indicator ${indicatorClass}">
            ${currentStep.status === "completed"
              ? html`<svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                </svg>`
              : ""}
          </div>
          <span class="compact-skill">${currentStep.label}</span>
          <span class="compact-pct">${displayIndex}/${totalSteps}</span>
        </div>
      </div>
    `;
  }

  override updated(changed: Map<string, unknown>) {
    super.updated(changed);
    // Auto-scroll terminal to bottom
    const panel = this.shadowRoot?.querySelector(".terminal-body");
    if (panel) {
      panel.scrollTop = panel.scrollHeight;
    }
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sop-pipeline": SOPPipeline;
  }
}
