import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface AuditEntry {
  userId: string | null;
  action: string;
  resource: string;
  timestamp: number;
  result: "denied" | "error";
  reason?: string;
  /** Override log path (used in tests only). */
  _logPath?: string;
}

const DEFAULT_AUDIT_LOG_PATH = join(homedir(), ".openclaw", "aiemas", "audit.log");

/**
 * Append a permission-failure audit entry to the audit log.
 * Creates the directory if it doesn't exist.
 * Each entry is written as a single JSON line.
 */
export function logPermissionFailure(entry: AuditEntry): void {
  const logPath = entry._logPath ?? DEFAULT_AUDIT_LOG_PATH;
  const dir = dirname(logPath);
  mkdirSync(dir, { recursive: true });
  // Strip internal _logPath field before writing
  const { _logPath: _, ...publicEntry } = entry;
  appendFileSync(logPath, JSON.stringify(publicEntry) + "\n", "utf8");
}
