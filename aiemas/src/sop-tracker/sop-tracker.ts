/**
 * SOP Tracker — monitors tool call events to infer SOP step transitions.
 *
 * Listens to `stream:tool` events (phase=start/result) and matches tool names
 * against the SOP definition loaded from the agent workspace. Maintains a
 * per-session SOPState and emits `sop.state` events via a callback.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { SOPDefinition, SOPState, SOPStepState, SOPStateEventPayload } from "./types.js";

export interface SOPTrackerOptions {
  /** Callback invoked when SOP state changes; caller broadcasts via WebSocket. */
  onStateChange: (payload: SOPStateEventPayload) => void;
}

export class SOPTracker {
  /** sessionKey → SOPState */
  private sessions = new Map<string, SOPState>();
  /** agentId → SOPDefinition (cached) */
  private sopCache = new Map<string, SOPDefinition | null>();
  private opts: SOPTrackerOptions;

  constructor(opts: SOPTrackerOptions) {
    this.opts = opts;
  }

  /**
   * Load SOP.json from the agent workspace directory.
   * Returns null if the file doesn't exist or is invalid.
   */
  loadSOP(workspaceDir: string, agentId: string): SOPDefinition | null {
    const cached = this.sopCache.get(agentId);
    if (cached !== undefined) {
      return cached;
    }
    const sopPath = join(workspaceDir, "SOP.json");
    if (!existsSync(sopPath)) {
      this.sopCache.set(agentId, null);
      return null;
    }
    try {
      const raw = readFileSync(sopPath, "utf-8");
      const def = JSON.parse(raw) as SOPDefinition;
      if (!def.name || !Array.isArray(def.steps)) {
        this.sopCache.set(agentId, null);
        return null;
      }
      this.sopCache.set(agentId, def);
      return def;
    } catch {
      this.sopCache.set(agentId, null);
      return null;
    }
  }

  /** Invalidate cached SOP for an agent (e.g. when SOP.json changes). */
  invalidateCache(agentId: string): void {
    this.sopCache.delete(agentId);
  }

  /**
   * Called when a tool call event is intercepted.
   * Matches the tool name against SOP steps and updates state.
   */
  onToolEvent(params: {
    sessionKey: string;
    agentId: string;
    workspaceDir: string;
    toolName: string;
    phase: "start" | "result";
    status?: string;
    isError?: boolean;
    timestamp: number;
  }): void {
    const { sessionKey, agentId, workspaceDir, toolName, phase, isError, timestamp } = params;

    const sop = this.loadSOP(workspaceDir, agentId);
    if (!sop) {
      return;
    }

    // Match tool name against SOP steps.
    // Tool names from exec calls look like the script name; we match by checking
    // if the tool name contains the skill name (e.g. "search_arxiv" in the exec args).
    const stepIndex = sop.steps.findIndex(
      (s) => toolName === s.skill || toolName.includes(s.skill),
    );
    if (stepIndex === -1) {
      return;
    }

    let state = this.sessions.get(sessionKey);
    if (!state) {
      state = {
        sopName: sop.name,
        sopLabel: sop.label,
        steps: sop.steps.map((s) => ({
          skill: s.skill,
          label: s.label,
          icon: s.icon,
          status: "pending",
        })),
        currentStepIndex: -1,
        startedAt: timestamp,
      };
      this.sessions.set(sessionKey, state);
    }

    const step = state.steps[stepIndex];
    if (!step) {
      return;
    }

    // Auto-complete/skip: when a later step starts, earlier pending → skipped,
    // earlier running → completed (next step starting implies previous finished).
    for (let i = 0; i < stepIndex; i++) {
      if (state.steps[i].status === "pending") {
        state.steps[i].status = "skipped";
      } else if (state.steps[i].status === "running") {
        state.steps[i].status = "completed";
        state.steps[i].completedAt = timestamp;
        if (state.steps[i].startedAt) {
          state.steps[i].elapsed = timestamp - state.steps[i].startedAt!;
        }
      }
    }

    if (phase === "start") {
      // New-round detection: if this step was already terminal (completed/failed/skipped)
      // and we're starting it again, reset all steps from this index onward to pending.
      // This handles the case where the user selects a new batch after step1 and re-runs
      // step2-5, so stale terminal states from the previous round don't bleed through.
      if (step.status === "completed" || step.status === "failed" || step.status === "skipped") {
        for (let i = stepIndex; i < state.steps.length; i++) {
          state.steps[i] = {
            skill: state.steps[i].skill,
            label: state.steps[i].label,
            icon: state.steps[i].icon,
            status: "pending",
          };
        }
        // Clear overall completedAt since we're starting a new round
        state.completedAt = undefined;
      }
      step.status = "running";
      step.startedAt = timestamp;
      state.currentStepIndex = stepIndex;
    } else if (phase === "result") {
      if (isError) {
        step.status = "failed";
        step.completedAt = timestamp;
        if (step.startedAt) {
          step.elapsed = timestamp - step.startedAt;
        }
      }
      // Non-error result: keep as "running". The step is only marked "completed"
      // when skill.progress type=done arrives (via updateStepStatus), or when
      // the next step starts (auto-skip marks previous pending steps, and the
      // new-round detection handles re-runs). This avoids prematurely marking
      // a step as completed while its progress.jsonl is still being written.
    }

    this.emitState(sessionKey, state, timestamp);
  }

  /**
   * Manually update a step's status (e.g. from progress.jsonl "done" line).
   */
  updateStepStatus(
    sessionKey: string,
    skill: string,
    status: SOPStepState["status"],
    timestamp: number,
  ): void {
    const state = this.sessions.get(sessionKey);
    if (!state) {
      return;
    }
    const stepIndex = state.steps.findIndex((s) => s.skill === skill);
    if (stepIndex === -1) {
      return;
    }
    const step = state.steps[stepIndex];

    // Auto-complete/skip: earlier pending → skipped, earlier running → completed.
    for (let i = 0; i < stepIndex; i++) {
      if (state.steps[i].status === "pending") {
        state.steps[i].status = "skipped";
      } else if (state.steps[i].status === "running") {
        state.steps[i].status = "completed";
        state.steps[i].completedAt = timestamp;
        if (state.steps[i].startedAt) {
          state.steps[i].elapsed = timestamp - state.steps[i].startedAt!;
        }
      }
    }

    step.status = status;
    if (status === "completed" || status === "failed") {
      step.completedAt = timestamp;
      if (step.startedAt) {
        step.elapsed = timestamp - step.startedAt;
      }
    }
    this.emitState(sessionKey, state, timestamp);
  }

  /** Get current SOP state for a session (for initial load / history). */
  getState(sessionKey: string): SOPState | undefined {
    return this.sessions.get(sessionKey);
  }

  /**
   * Mark all still-running steps as completed. Called when the agent run
   * finishes (chat final) to ensure no step is left in "running" state.
   */
  finalizeRunningSteps(sessionKey: string, timestamp: number): void {
    const state = this.sessions.get(sessionKey);
    if (!state) {
      return;
    }
    let changed = false;
    for (const step of state.steps) {
      if (step.status === "running") {
        step.status = "completed";
        step.completedAt = timestamp;
        if (step.startedAt) {
          step.elapsed = timestamp - step.startedAt;
        }
        changed = true;
      }
    }
    if (changed) {
      this.emitState(sessionKey, state, timestamp);
    }
  }

  /** Clean up state for a session. */
  clearSession(sessionKey: string): void {
    this.sessions.delete(sessionKey);
  }

  private emitState(sessionKey: string, state: SOPState, ts: number): void {
    // Check if all steps have reached a terminal status
    const allTerminal = state.steps.every(
      (s) => s.status === "completed" || s.status === "failed" || s.status === "skipped",
    );
    if (allTerminal && !state.completedAt) {
      state.completedAt = ts;
    } else if (!allTerminal) {
      state.completedAt = undefined;
    }

    this.opts.onStateChange({
      sessionKey,
      sopName: state.sopName,
      sopLabel: state.sopLabel,
      steps: state.steps.map((s) => ({ ...s })),
      currentStepIndex: state.currentStepIndex,
      completedAt: state.completedAt,
      ts,
    });
  }
}
