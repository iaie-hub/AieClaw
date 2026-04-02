/**
 * Progress Watcher — tails progress.jsonl files written by skill scripts.
 *
 * When a skill enters "running" state, the watcher starts polling the
 * corresponding progress.jsonl file for new lines. Parsed progress lines
 * are emitted via callback for WebSocket broadcast.
 *
 * Uses polling (not fs.watch) for reliability across macOS FSEvents quirks.
 */

import { existsSync, statSync, openSync, readSync, closeSync } from "node:fs";
import type { ProgressLine, SkillProgressEventPayload } from "./types.js";

export interface ProgressWatcherOptions {
  /** Polling interval in ms (default 2000). */
  pollIntervalMs?: number;
  /** Callback invoked for each new progress line. */
  onProgress: (payload: SkillProgressEventPayload) => void;
}

interface WatchEntry {
  sessionKey: string;
  skill: string;
  filePath: string;
  /** Byte offset of last read position. */
  offset: number;
  timer: ReturnType<typeof setInterval>;
  /** Buffer for partial lines from last read. */
  remainder: string;
}

export class ProgressWatcher {
  private watches = new Map<string, WatchEntry>();
  private pollIntervalMs: number;
  private onProgress: ProgressWatcherOptions["onProgress"];

  constructor(opts: ProgressWatcherOptions) {
    this.pollIntervalMs = opts.pollIntervalMs ?? 2000;
    this.onProgress = opts.onProgress;
  }

  /**
   * Start watching a progress.jsonl file for a running skill.
   * @param key Unique key for this watch (e.g. `${sessionKey}:${skill}`)
   */
  startWatch(params: { key: string; sessionKey: string; skill: string; filePath: string }): void {
    const { key, sessionKey, skill, filePath } = params;

    // Don't double-watch
    if (this.watches.has(key)) {
      return;
    }

    // Always read from the beginning so no lines are missed when the
    // file is created before the watcher starts.
    const offset = 0;

    const timer = setInterval(() => {
      this.poll(key);
    }, this.pollIntervalMs);

    this.watches.set(key, { sessionKey, skill, filePath, offset, timer, remainder: "" });
  }

  /** Stop watching a specific skill's progress file immediately. */
  stopWatch(key: string): void {
    const entry = this.watches.get(key);
    if (entry) {
      clearInterval(entry.timer);
      this.watches.delete(key);
    }
  }

  /** Check whether a watch exists for the given key. */
  hasWatch(key: string): boolean {
    return this.watches.has(key);
  }

  /** Stop all watches. */
  stopAll(): void {
    for (const entry of this.watches.values()) {
      clearInterval(entry.timer);
    }
    this.watches.clear();
  }

  private poll(key: string): void {
    const entry = this.watches.get(key);
    if (!entry) {
      return;
    }

    if (!existsSync(entry.filePath)) {
      return;
    }

    let fileSize: number;
    try {
      fileSize = statSync(entry.filePath).size;
    } catch {
      return;
    }

    // If file was truncated or smaller than expected, reset offset
    if (fileSize < entry.offset) {
      entry.offset = 0;
    }

    if (fileSize <= entry.offset) {
      return;
    }

    // Read only the new bytes
    let newContent: string;
    try {
      const buf = Buffer.alloc(fileSize - entry.offset);
      const fd = openSync(entry.filePath, "r");
      try {
        readSync(fd, buf, 0, buf.length, entry.offset);
      } finally {
        closeSync(fd);
      }
      newContent = buf.toString("utf-8");
    } catch {
      return;
    }

    entry.offset = fileSize;
    const content = entry.remainder + newContent;
    const lastNewline = content.lastIndexOf("\n");
    if (lastNewline === -1) {
      entry.remainder = content;
      return;
    }

    const complete = content.substring(0, lastNewline);
    entry.remainder = content.substring(lastNewline + 1);

    // Parse each line as JSON
    const lines = complete.split("\n").filter((l) => l.trim());
    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as ProgressLine;
        if (!parsed.type || !parsed.skill) {
          continue;
        }
        this.onProgress({
          sessionKey: entry.sessionKey,
          skill: entry.skill,
          progress: parsed,
          ts: parsed.ts ?? Date.now(),
        });
        // Auto-stop when the skill signals completion
        if (parsed.type === "done") {
          this.stopWatch(key);
          return;
        }
      } catch (err) {
        // Skip malformed lines, but log them for debugging
        console.error(
          `[mas4s:sop] progress line parse failed: ${err instanceof Error ? err.message : String(err)}, content: ${line}`,
        );
      }
    }
  }
}
