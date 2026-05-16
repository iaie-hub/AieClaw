/**
 * Debug logger for the agent-registry plugin.
 *
 * Outputs structured, timestamped log lines to stderr so they appear in
 * OpenClaw's log stream without interfering with stdout.
 *
 * All output is gated behind the AGENT_REGISTRY_DEBUG environment variable:
 *   AGENT_REGISTRY_DEBUG=1   — enable all debug output
 *   AGENT_REGISTRY_DEBUG=0   — disable (default)
 *
 * Log levels:
 *   DEBUG  — verbose trace (connection events, every inbound/outbound message)
 *   INFO   — lifecycle milestones (registered, joined, heartbeat sent)
 *   WARN   — recoverable anomalies (skill not found, session recreated)
 *   ERROR  — failures that affect availability
 */

const DEBUG_ENABLED =
  process.env["AGENT_REGISTRY_DEBUG"] === "1" ||
  process.env["AGENT_REGISTRY_DEBUG"] === "true";

// ANSI colour codes — only when stderr is a TTY
const isTTY = process.stderr.isTTY === true;
const C = {
  reset:  isTTY ? "\x1b[0m"  : "",
  dim:    isTTY ? "\x1b[2m"  : "",
  cyan:   isTTY ? "\x1b[36m" : "",
  green:  isTTY ? "\x1b[32m" : "",
  yellow: isTTY ? "\x1b[33m" : "",
  red:    isTTY ? "\x1b[31m" : "",
  blue:   isTTY ? "\x1b[34m" : "",
  magenta:isTTY ? "\x1b[35m" : "",
};

type Level = "DEBUG" | "INFO" | "WARN" | "ERROR";

function ts(): string {
  return new Date().toISOString();
}

function levelTag(level: Level): string {
  switch (level) {
    case "DEBUG": return `${C.dim}[DEBUG]${C.reset}`;
    case "INFO":  return `${C.green}[INFO ]${C.reset}`;
    case "WARN":  return `${C.yellow}[WARN ]${C.reset}`;
    case "ERROR": return `${C.red}[ERROR]${C.reset}`;
  }
}

function write(level: Level, module: string, msg: string, extra?: unknown): void {
  if (level === "DEBUG" && !DEBUG_ENABLED) return;

  const prefix = `${C.dim}${ts()}${C.reset} ${levelTag(level)} ${C.cyan}[agent-registry/${module}]${C.reset}`;
  const line = `${prefix} ${msg}`;

  if (extra !== undefined) {
    const detail =
      typeof extra === "string"
        ? extra
        : JSON.stringify(extra, null, 2);
    process.stderr.write(`${line}\n${C.dim}${detail}${C.reset}\n`);
  } else {
    process.stderr.write(`${line}\n`);
  }
}

// ---------------------------------------------------------------------------
// Per-module logger factory
// ---------------------------------------------------------------------------

export interface Logger {
  debug(msg: string, extra?: unknown): void;
  info(msg: string, extra?: unknown): void;
  warn(msg: string, extra?: unknown): void;
  error(msg: string, extra?: unknown): void;
}

export function createLogger(module: string): Logger {
  return {
    debug: (msg, extra) => write("DEBUG", module, msg, extra),
    info:  (msg, extra) => write("INFO",  module, msg, extra),
    warn:  (msg, extra) => write("WARN",  module, msg, extra),
    error: (msg, extra) => write("ERROR", module, msg, extra),
  };
}

// ---------------------------------------------------------------------------
// Helpers for pretty-printing envelopes and payloads
// ---------------------------------------------------------------------------

/**
 * Format a RegistryEnvelope for log output.
 * Truncates payload text fields to 200 chars to keep logs readable.
 */
export function fmtEnvelope(env: {
  message_id: string;
  action: string;
  resource_type: string;
  source: string;
  seq: number;
  payload: Record<string, unknown>;
  reply_to: string | null;
}): string {
  const payloadPreview = truncatePayload(env.payload);
  return (
    `action=${env.action} resource_type=${env.resource_type} ` +
    `source=${env.source} seq=${env.seq} msg_id=${env.message_id} ` +
    `reply_to=${env.reply_to ?? "null"} payload=${payloadPreview}`
  );
}

/**
 * Truncate string values in a payload object to keep log lines short.
 */
export function truncatePayload(payload: Record<string, unknown>, maxLen = 200): string {
  const copy: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (typeof v === "string" && v.length > maxLen) {
      copy[k] = v.slice(0, maxLen) + `…(+${v.length - maxLen})`;
    } else {
      copy[k] = v;
    }
  }
  return JSON.stringify(copy);
}
