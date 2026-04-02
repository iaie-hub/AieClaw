/**
 * SOP (Standard Operating Procedure) tracking types.
 *
 * Used by SOPTracker and ProgressWatcher to maintain per-session
 * SOP execution state and relay skill-level progress to the frontend.
 */

// ── SOP definition (loaded from workspace SOP.json) ─────────────────────────

export interface SOPDefinition {
  name: string;
  label: string;
  steps: SOPStepDef[];
}

export interface SOPStepDef {
  skill: string;
  label: string;
  icon?: string;
}

// ── Runtime SOP state (per session) ─────────────────────────────────────────

export type SOPStepStatus = "pending" | "running" | "completed" | "failed" | "skipped";

export interface SOPStepState {
  skill: string;
  label: string;
  icon?: string;
  status: SOPStepStatus;
  startedAt?: number;
  completedAt?: number;
  elapsed?: number;
}

export interface SOPState {
  sopName: string;
  sopLabel: string;
  steps: SOPStepState[];
  currentStepIndex: number;
  startedAt: number;
  /** Set only when ALL steps have reached a terminal status (completed/failed/skipped). */
  completedAt?: number;
}

// ── Progress line types (written by Python scripts to progress.jsonl) ────────

export type ProgressLineType = "start" | "item" | "log" | "done";

export interface ProgressLineBase {
  type: ProgressLineType;
  skill: string;
  ts: number;
}

export interface ProgressLineStart extends ProgressLineBase {
  type: "start";
  total: number;
  label?: string;
}

export interface ProgressLineItem extends ProgressLineBase {
  type: "item";
  index: number;
  label?: string;
  pct?: number;
  status?: string;
  message?: string;
}

export interface ProgressLineLog extends ProgressLineBase {
  type: "log";
  message: string;
  level?: "info" | "warn" | "error";
}

export interface ProgressLineDone extends ProgressLineBase {
  type: "done";
  succeeded: number;
  failed: number;
  elapsed_ms?: number;
  message?: string;
}

export type ProgressLine =
  | ProgressLineStart
  | ProgressLineItem
  | ProgressLineLog
  | ProgressLineDone;

// ── WebSocket event payloads ────────────────────────────────────────────────

export interface SOPStateEventPayload {
  sessionKey: string;
  sopName: string;
  sopLabel: string;
  steps: SOPStepState[];
  currentStepIndex: number;
  completedAt?: number;
  ts: number;
}

export interface SkillProgressEventPayload {
  sessionKey: string;
  skill: string;
  progress: ProgressLine;
  ts: number;
}
