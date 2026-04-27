import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { onSessionTranscriptUpdate } from "../../../src/sessions/transcript-events.js";
import type { SessionTranscriptUpdate } from "../../../src/sessions/transcript-events.js";
import { extractUuidFromKey } from "../utils/session-utils.js";
import { upsertSessionMedia } from "./session-media-store.js";
import { upsertSummary } from "./session-summary-store.js";

const debugLog = (...args: unknown[]) => {
  if (process.env.OPENCLAW_MAS4S_DEBUG_EVENTS === "1") {
    console.log(...args);
  }
};

// ── Types ────────────────────────────────────────────────────────────────────

export interface SenderContext {
  userId: string | null;
  tenantId: string | null;
}

export interface StoredMessage {
  id: string;
  sessionUuid: string;
  sessionKey: string;
  sessionId: string;
  userId: string | null;
  tenantId: string | null;
  role: "user" | "assistant" | "tool" | "approval" | "system" | "progress" | "summary" | "agent";
  content: string;
  timestamp: number;
  seq: number;
  archivedDate: string | null;
  toolCallId: string | null;
  toolName: string | null;
  parentSessionUuid: string | null;
  sourceAgentId: string | null;
}

export interface SessionTranscriptStoreOptions {
  /** Flush interval in ms. Default: 3000 */
  flushIntervalMs?: number;
  /** Max buffer size before forced flush. Default: 100 */
  maxBufferSize?: number;
}

/**
 * All per-session in-memory state, centralised in one place.
 *
 * - sender:     who initiated the session (set by recordSenderContext)
 * - lastSeq:    current max seq, used to assign the next seq without a DB read
 * - firstMsgAt: earliest persisted message timestamp (0 = no messages yet)
 * - lastMsgAt:  latest persisted message timestamp (0 = no messages yet)
 * - msgCount:   total persisted message count
 *
 * firstMsgAt / lastMsgAt / msgCount mirror session_msg_statistic and are kept
 * in sync after every persistBatch commit.
 */
interface SessionState {
  sender: SenderContext;
  sessionUuid: string;
  sessionKey: string;
  sessionId: string;
  lastSeq: number;
  firstMsgAt: number;
  lastMsgAt: number;
  msgCount: number;
  parentSessionUuid: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Format a Unix-ms timestamp as 'yyyy-mm-dd' (en-CA locale gives ISO date). */
function toDateStr(ts: number): string {
  return new Date(ts).toLocaleDateString("en-CA");
}

/**
 * Returns true if the content string is a gateway-injected inbound metadata
 * message (the second SessionTranscriptUpdate fired after buildInboundUserContextPrefix
 * prepends Sender/Conversation blocks to the stored user turn).
 * We skip these to avoid duplicate user messages in session_messages.
 */
function isInboundMetaMessage(content: string): boolean {
  return (
    content.includes("Sender (untrusted metadata):") ||
    content.includes("Conversation info (untrusted metadata):")
  );
}

/**
 * 从 message.content 中提取纯文本。
 * - 字符串：直接返回
 * - 数组（assistant/tool 消息）：拼接所有 type=text 块的 text 字段
 * - 其他：返回空字符串
 */
function extractContent(raw: unknown): string {
  if (typeof raw === "string") {
    return raw;
  }
  if (Array.isArray(raw)) {
    return raw
      .map((block) => {
        if (block == null || typeof block !== "object") {
          return "";
        }
        const b = block as Record<string, unknown>;
        // text block: { type: "text", text: "..." }
        // Serialise with a [text] prefix so normalizeMessage can reconstruct
        // the correct item order when thinking and text appear in the same message.
        // Newlines are escaped to keep the serialised form on a single line.
        if (b["type"] === "text" && typeof b["text"] === "string") {
          return `[text] ${b["text"].replace(/\n/g, "\\n")}`;
        }
        // thinking block: { type: "thinking", thinking: "..." }
        // Serialise so it can be restored as a thinking content item in the history view.
        // Newlines within the thinking text are escaped to \n literals to keep the
        // serialised form on a single line, matching the line-prefix parsing in normalizeMessage.
        if (b["type"] === "thinking" && typeof b["thinking"] === "string") {
          return `[thinking] ${b["thinking"].replace(/\n/g, "\\n")}`;
        }
        // toolCall block (pi-coding-agent format): { type: "toolCall", name: "...", arguments: {...} }
        if (b["type"] === "toolCall") {
          const name = typeof b["name"] === "string" ? b["name"] : "tool";
          const args = b["arguments"] != null ? JSON.stringify(b["arguments"]) : "";
          return args ? `[tool_use:${name}] ${args}` : `[tool_use:${name}]`;
        }
        // tool_use block (Anthropic format): { type: "tool_use", name: "...", input: {...} }
        if (b["type"] === "tool_use") {
          const name = typeof b["name"] === "string" ? b["name"] : "tool";
          const input = b["input"] != null ? JSON.stringify(b["input"]) : "";
          return input ? `[tool_use:${name}] ${input}` : `[tool_use:${name}]`;
        }
        // tool_result block: { type: "tool_result", content: [...] }
        if (b["type"] === "tool_result") {
          const inner = b["content"];
          if (typeof inner === "string") {
            return inner;
          }
          if (Array.isArray(inner)) {
            return extractContent(inner);
          }
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/** Normalise raw role strings to the allowed set. */
function normaliseRole(
  raw: unknown,
): "user" | "assistant" | "tool" | "approval" | "system" | "progress" | "agent" {
  if (raw === "human" || raw === "user") {
    return "user";
  }
  if (raw === "ai" || raw === "assistant") {
    return "assistant";
  }
  if (raw === "tool" || raw === "toolResult" || raw === "tool_result") {
    return "tool";
  }
  if (raw === "approval") {
    return "approval";
  }
  if (raw === "system") {
    return "system";
  }
  if (raw === "progress") {
    return "progress";
  }
  if (raw === "agent") {
    return "agent";
  }
  // Unknown roles fall back to "user" to satisfy the DB CHECK constraint.
  return "user";
}

// ── Helpers (A2A agent mark) ─────────────────────────────────────────────────

/** Pending agent mark: tracks that the next user message for a sessionKey is from an agent. */
interface PendingAgentMark {
  sourceAgentId: string;
  sourceSessionKey: string;
  /** First 100 chars of the message for fingerprint matching */
  messageFingerprint: string;
  markedAt: number;
}

/** TTL for pending agent marks in milliseconds (30 seconds). */
const AGENT_MARK_TTL_MS = 30_000;

// ── Helpers (tool event) ─────────────────────────────────────────────────────

/** Pending tool call entry: holds start-phase data until result arrives. */
interface PendingToolCall {
  sessionKey: string;
  name: string;
  /** Serialised "[tool_use:name] {...}" string */
  callContent: string;
  timestamp: number;
}

/**
 * Truncate and stringify a tool result value for storage.
 * Mirrors the TOOL_OUTPUT_CHAR_LIMIT logic in the frontend event-handler.
 */
function formatToolResult(value: unknown): string {
  const LIMIT = 120_000;
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value.length > LIMIT ? value.slice(0, LIMIT) + "\n…(truncated)" : value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  const rec = value as Record<string, unknown>;
  if (typeof rec["text"] === "string") {
    return formatToolResult(rec["text"]);
  }
  if (Array.isArray(rec["content"])) {
    const parts = (rec["content"] as unknown[])
      .map((item) => {
        const x = item as Record<string, unknown>;
        return x["type"] === "text" && typeof x["text"] === "string" ? x["text"] : null;
      })
      .filter((s): s is string => s !== null);
    if (parts.length > 0) {
      return formatToolResult(parts.join("\n"));
    }
  }
  try {
    const json = JSON.stringify(value, null, 2);
    return json.length > LIMIT ? json.slice(0, LIMIT) + "\n…(truncated)" : json;
  } catch {
    return Object.prototype.toString.call(value);
  }
}

/** Return a default (empty) SessionState for a session not yet seen. */
function defaultSessionState(
  sessionUuid: string,
  sessionKey: string,
  sessionId: string,
): SessionState {
  return {
    sender: { userId: null, tenantId: null },
    sessionUuid,
    sessionKey,
    sessionId,
    lastSeq: 0,
    firstMsgAt: 0,
    lastMsgAt: 0,
    msgCount: 0,
    parentSessionUuid: null,
  };
}

// ── Class ────────────────────────────────────────────────────────────────────

export class SessionTranscriptStore {
  private readonly db: DatabaseSync;
  private readonly flushIntervalMs: number;
  private readonly maxBufferSize: number;

  /**
   * Central per-session state store.
   * Keyed by sessionUuid.
   * Loaded from session_msg_statistic on construction.
   */
  private readonly sessionStates = new Map<string, SessionState>();

  /**
   * Mapping of sessionKey -> latest sessionId.
   * Used to resolve the active sessionId for events that only carry sessionKey
   * (e.g. tool calls, approvals). Updated by handleUpdate and recordSenderContext.
   */
  private readonly activeSessionIds = new Map<string, string>();

  /** In-memory write buffer; drained on each flush. */
  private readonly buffer: StoredMessage[] = [];

  /**
   * Pending tool calls keyed by toolCallId.
   * Populated on phase=start, consumed on phase=result to emit a single record.
   */
  private readonly pendingToolCalls = new Map<string, PendingToolCall>();

  /**
   * Dedup set for assistant final messages: tracks runIds already stored via
   * recordAssistantFinal to avoid double-writing when both transcript events
   * and filterBroadcast capture the same message.
   */
  private readonly storedRunIds = new Set<string>();

  /**
   * Pending agent marks keyed by sessionKey.
   * Each entry is a FIFO queue of marks. When aiemas_sessions_send is about to
   * dispatch a message, it pushes a mark here. handleUpdate consumes the mark
   * by matching the message content fingerprint, converting role from "user" to "agent".
   */
  private readonly pendingAgentMarks = new Map<string, PendingAgentMark[]>();

  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;

  // ── Constructor ────────────────────────────────────────────────────────────

  constructor(db: DatabaseSync, opts?: SessionTranscriptStoreOptions) {
    this.db = db;
    this.flushIntervalMs = opts?.flushIntervalMs ?? 3000;
    this.maxBufferSize = opts?.maxBufferSize ?? 100;
    this.loadSessionStates();
  }

  // ── loadSessionStates ──────────────────────────────────────────────────────

  /**
   * Populate sessionStates from session_msg_statistic on startup.
   * This replaces the old loadSeqCounters() query against session_messages:
   * lastSeq is read directly from the statistic row, which is always in sync
   * with session_messages after every committed transaction.
   */
  private loadSessionStates(): void {
    try {
      const rows = this.db
        .prepare(
          "SELECT sessionUuid, sessionKey, sessionId, firstMsgAt, lastMsgAt, msgCount, lastSeq, parentSessionUuid FROM session_msg_statistic",
        )
        .all() as Array<{
        sessionUuid: string;
        sessionKey: string;
        sessionId: string;
        firstMsgAt: number;
        lastMsgAt: number;
        msgCount: number;
        lastSeq: number;
        parentSessionUuid: string | null;
      }>;
      for (const row of rows) {
        this.sessionStates.set(row.sessionUuid, {
          sender: { userId: null, tenantId: null },
          sessionUuid: row.sessionUuid,
          sessionKey: row.sessionKey,
          sessionId: row.sessionId,
          lastSeq: row.lastSeq,
          firstMsgAt: row.firstMsgAt,
          lastMsgAt: row.lastMsgAt,
          msgCount: row.msgCount,
          parentSessionUuid: row.parentSessionUuid,
        });
        // Track the "latest" sessionId per sessionKey by picking the one with the highest sequence/timestamp.
        // This is a heuristic for startup; subsequent updates will keep this map current.
        const uuid = row.sessionUuid;
        const current = this.activeSessionIds.get(row.sessionKey);
        if (!current || row.lastMsgAt > (this.sessionStates.get(uuid)?.lastMsgAt ?? 0)) {
          this.activeSessionIds.set(row.sessionKey, row.sessionId);
        }
      }
    } catch {
      // Table may not exist yet during first init — safe to ignore.
    }
  }

  // ── getOrInitState (private) ───────────────────────────────────────────────

  /** Return the SessionState for a key pair, creating a default entry if absent. */
  private getOrInitState(
    sessionUuid: string,
    sessionKey: string,
    sessionId: string,
    parentSessionUuid?: string | null,
  ): SessionState {
    let state = this.sessionStates.get(sessionUuid);
    if (!state) {
      state = defaultSessionState(sessionUuid, sessionKey, sessionId);
      if (parentSessionUuid !== undefined) {
        state.parentSessionUuid = parentSessionUuid;
      }
      this.sessionStates.set(sessionUuid, state);
    } else if (parentSessionUuid !== undefined && parentSessionUuid !== null) {
      // Update parentSessionUuid if it was previously null but now known
      if (state.parentSessionUuid === null) {
        state.parentSessionUuid = parentSessionUuid;
      }
    }
    // Update active mapping whenever we touch a session
    this.activeSessionIds.set(sessionKey, sessionId);
    return state;
  }

  // ── recordSenderContext ────────────────────────────────────────────────────

  /** Called by the chat.send extraHandler to associate a session with a user. */
  recordSenderContext(
    sessionUuid: string,
    sessionKey: string,
    sessionId: string,
    ctx: SenderContext,
  ): void {
    this.getOrInitState(sessionUuid, sessionKey, sessionId).sender = ctx;
  }

  // ── markNextMessageAsAgent ─────────────────────────────────────────────────

  /**
   * Mark the next user message arriving at `targetSessionKey` as agent-sourced.
   * Called by aiemas_sessions_send before dispatching callSessionsSend.
   *
   * Uses a FIFO queue per sessionKey to support async concurrent sends.
   * Each mark includes a message fingerprint (first 100 chars) for content
   * matching, preventing misattribution when user messages interleave.
   * Marks expire after AGENT_MARK_TTL_MS (30s).
   */
  markNextMessageAsAgent(
    targetSessionKey: string,
    source: { sourceAgentId: string; sourceSessionKey: string; message: string },
  ): void {
    const queue = this.pendingAgentMarks.get(targetSessionKey) ?? [];
    queue.push({
      sourceAgentId: source.sourceAgentId,
      sourceSessionKey: source.sourceSessionKey,
      messageFingerprint: source.message.slice(0, 100),
      markedAt: Date.now(),
    });
    this.pendingAgentMarks.set(targetSessionKey, queue);
    debugLog(
      `[mas4s:transcript-store] markNextMessageAsAgent sessionKey=${targetSessionKey} sourceAgentId=${source.sourceAgentId} queueLen=${queue.length}`,
    );
  }

  // ── start ──────────────────────────────────────────────────────────────────

  /** Subscribe to transcript updates and start the periodic flush timer. */
  start(): void {
    this.unsubscribe = onSessionTranscriptUpdate((update) => this.handleUpdate(update));
    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.flushIntervalMs);
  }

  // ── stop ───────────────────────────────────────────────────────────────────

  /** Unsubscribe, clear the timer, and synchronously flush remaining messages. */
  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }

  // ── getBuffered ────────────────────────────────────────────────────────────

  /**
   * Return a snapshot of buffer entries matching the given conditions.
   * from/to are optional: when omitted the corresponding bound is not applied.
   * Read-only — does not modify the buffer.
   */
  getBuffered(
    sessionKey: string,
    from: number | undefined,
    to: number | undefined,
    sessionId?: string,
  ): StoredMessage[] {
    return this.buffer.filter(
      (m) =>
        (m.sessionKey === sessionKey || m.sessionUuid === sessionKey) &&
        (from === undefined || m.timestamp >= from) &&
        (to === undefined || m.timestamp <= to) &&
        (sessionId === undefined || m.sessionId === sessionId),
    );
  }

  // ── recordToolEvent ────────────────────────────────────────────────────────

  /**
   * Called from filterBroadcast when an agent stream:tool event is intercepted.
   * phase=start: records the tool call start, waiting for the result.
   * phase=result: merges start+result into a single assistant record and buffers it.
   */
  recordToolEvent(params: {
    sessionKey: string;
    toolCallId: string;
    name: string;
    phase: string;
    args?: unknown;
    result?: unknown;
    timestamp: number;
  }): void {
    const { sessionKey, toolCallId, name, phase, args, result, timestamp } = params;

    if (phase === "start") {
      const argsStr = args != null ? JSON.stringify(args) : "";
      const callContent = argsStr ? `[tool_use:${name}] ${argsStr}` : `[tool_use:${name}]`;
      this.pendingToolCalls.set(toolCallId, { sessionKey, name, callContent, timestamp });
      debugLog(
        `[mas4s:transcript-store] recordToolEvent phase=start toolCallId=${toolCallId} name=${name}`,
      );
      return;
    }

    if (phase === "result") {
      const pending = this.pendingToolCalls.get(toolCallId);
      this.pendingToolCalls.delete(toolCallId); // Always cleanup

      const resultStr = formatToolResult(result);
      debugLog(
        `[mas4s:transcript-store] recordToolEvent phase=result toolCallId=${toolCallId} hasPending=${!!pending} resultLength=${resultStr?.length ?? 0}`,
      );

      if (!resultStr) {
        return;
      }

      // Instead of merging into 'assistant', push a dedicated 'tool' role message.
      // This matches frontend MsgToolCard and avoids transcript-triggered duplication.
      this.pushToBuffer({
        sessionKey: pending?.sessionKey ?? sessionKey,
        role: "tool",
        content: `[tool_result] ${resultStr.replace(/\n/g, "\\n")}`,
        timestamp: timestamp || (pending?.timestamp ?? Date.now()),
        toolCallId: toolCallId,
        toolName: pending?.name ?? name,
      });
    }
  }

  // ── recordApprovalEvent ───────────────────────────────────────────────────

  /**
   * Persist an exec.approval event (requested or resolved) to session_messages.
   * Content format: `[approval:requested] {...}` or `[approval:resolved] {...}`
   * or `[approval:user-resolve] {...}` so normalizeMessage can reconstruct the
   * approval card on history replay.
   */
  recordApprovalEvent(params: {
    sessionKey: string;
    type: "requested" | "resolved" | "user-resolve";
    payload: unknown;
    timestamp: number;
  }): void {
    const { sessionKey, type, payload, timestamp } = params;
    const content = `[approval:${type}] ${JSON.stringify(payload)}`;
    this.pushToBuffer({
      sessionKey,
      role: "approval",
      content,
      timestamp,
    });
  }

  // ── recordProgressEvent ───────────────────────────────────────────────────

  /**
   * Persist an SOP/skill progress event to session_messages.
   * Content format: `[sop:state] {...}` or `[skill:progress] {...}`
   * so normalizeMessage can reconstruct the SOP pipeline on history replay.
   */
  recordProgressEvent(params: {
    sessionKey: string;
    type: "sop:state" | "skill:progress";
    payload: unknown;
    timestamp: number;
  }): void {
    const { sessionKey, type, payload, timestamp } = params;
    const content = `[${type}] ${JSON.stringify(payload)}`;
    this.pushToBuffer({
      sessionKey,
      role: "progress",
      content,
      timestamp,
    });
  }

  // ── persistSummary ────────────────────────────────────────────────────────

  /**
   * Persist a generated summary into the dedicated session_summaries table
   * in mas4s.message.db. Uses upsert semantics — one row per sessionKey.
   * Written immediately (not buffered) so it is available for query right away.
   */
  persistSummary(params: {
    sessionUuid: string;
    sessionKey: string;
    sessionId: string;
    textSummary: string | null;
    toolSummary: string | null;
    generatedAt: number;
    generatedBy: string;
  }): void {
    const state = this.sessionStates.get(params.sessionUuid);
    const summaryParams = {
      ...params,
      parentSessionUuid: state?.parentSessionUuid ?? null,
    };
    upsertSummary(this.db, summaryParams);
    debugLog(
      `[mas4s:transcript-store] persisted summary for sessionUuid=${params.sessionUuid} sessionKey=${params.sessionKey} sessionId=${params.sessionId}`,
    );
  }

  /**
   * Called from filterBroadcast when a chat state:final event with an assistant
   * message is intercepted. Stores the final assistant text, deduplicating by runId
   * to avoid double-writing when the transcript event path also fires.
   */
  recordAssistantFinal(params: {
    sessionKey: string;
    runId: string;
    text: string;
    timestamp: number;
  }): void {
    const { sessionKey, runId, text, timestamp } = params;
    if (!text.trim()) {
      return;
    }
    // Dedup: if this runId was already stored via handleUpdate (transcript path), skip.
    if (this.storedRunIds.has(runId)) {
      return;
    }
    this.storedRunIds.add(runId);
    // Evict old entries to prevent unbounded growth (keep last 500 runIds).
    if (this.storedRunIds.size > 500) {
      const first = this.storedRunIds.values().next().value;
      if (first !== undefined) {
        this.storedRunIds.delete(first);
      }
    }
    this.pushToBuffer({ sessionKey, role: "assistant", content: text, timestamp });
  }

  // ── pushToBuffer (private) ────────────────────────────────────────────────

  private pushToBuffer(params: {
    sessionKey: string;
    sessionId?: string;
    role: StoredMessage["role"];
    content: string;
    timestamp: number;
    toolCallId?: string | null;
    toolName?: string | null;
    parentSessionKey?: string;
    sourceAgentId?: string | null;
  }): void {
    const { sessionKey, role, content, timestamp, toolCallId, toolName } = params;
    let { sessionId } = params;

    const { extractUuidFromKey } = require("../utils/session-utils.js");
    const sessionUuid = extractUuidFromKey(sessionKey);
    const parentSessionUuid = params.parentSessionKey
      ? extractUuidFromKey(params.parentSessionKey)
      : null;

    // Resolve sessionId if missing via the active mapping
    if (!sessionId) {
      sessionId = this.activeSessionIds.get(sessionKey) ?? sessionKey;
    }

    const state = this.getOrInitState(sessionUuid, sessionKey, sessionId, parentSessionUuid);
    const seq = state.lastSeq + 1;
    // Eagerly advance lastSeq so subsequent pushes in the same flush cycle get
    // monotonically increasing seq values without waiting for a DB round-trip.
    state.lastSeq = seq;

    this.buffer.push({
      id: crypto.randomUUID(),
      sessionUuid,
      sessionKey,
      sessionId,
      userId: state.sender.userId,
      tenantId: state.sender.tenantId,
      role,
      content,
      timestamp,
      seq,
      archivedDate: null,
      toolCallId: toolCallId ?? null,
      toolName: toolName ?? null,
      parentSessionUuid: state.parentSessionUuid,
      sourceAgentId: params.sourceAgentId ?? null,
    });

    if (this.buffer.length >= this.maxBufferSize) {
      this.flush();
    }
  }

  // ── handleUpdate (private) ────────────────────────────────────────────────

  private handleUpdate(update: SessionTranscriptUpdate): void {
    try {
      // Skip file-path-only updates that carry no message payload.
      if (update.message == null) {
        return;
      }

      const sessionKey = update.sessionKey ?? "";
      if (!sessionKey) {
        return;
      }

      const msg = update.message as Record<string, unknown>;
      const rawRole = msg["role"];

      debugLog(
        `[mas4s:transcript-store] incoming role=${String(rawRole)} sessionKey=${sessionKey} hasCallId=${!!msg["toolCallId"] || !!msg["tool_call_id"]} msg=${JSON.stringify(msg)}`,
      );

      // content 可能是字符串（user 消息）或数组（assistant/tool 消息）
      // 数组格式：[{ type: "text", text: "..." }, ...]
      let content = extractContent(msg["content"]);

      const timestamp = typeof msg["timestamp"] === "number" ? msg["timestamp"] : Date.now();
      // gateway 的 message 对象不含 sessionId 字段，从 sessionKey 推导
      const sessionId =
        typeof msg["sessionId"] === "string" && msg["sessionId"]
          ? msg["sessionId"]
          : (update.sessionKey ?? "");

      const sessionUuid = extractUuidFromKey(sessionKey);
      const parentSessionUuid = update.parentSessionKey
        ? extractUuidFromKey(update.parentSessionKey)
        : null;

      // ── 图片元数据提取 ────────────────────────────────────────────────────
      // gateway transcript 消息将图片路径存储在顶层 MediaPaths/MediaTypes 字段中，
      // extractContent 只处理 content 字段，这里将图片信息序列化为 [image:<mime>] <path>
      // 行前缀追加到 content，使其随消息一起持久化到 session_messages。
      const mediaPaths = msg["MediaPaths"];
      const mediaTypes = msg["MediaTypes"];
      if (Array.isArray(mediaPaths) && mediaPaths.length > 0) {
        const imageLines: string[] = [];
        for (let i = 0; i < mediaPaths.length; i++) {
          const p = mediaPaths[i];
          if (typeof p === "string" && p) {
            const mime =
              Array.isArray(mediaTypes) && typeof mediaTypes[i] === "string"
                ? (mediaTypes[i] as string)
                : "image/png";
            imageLines.push(`[image:${mime}] ${p}`);
            // Persist to session_media table for synchronized deletion
            try {
              upsertSessionMedia(this.db, {
                sessionUuid,
                sessionKey,
                mediaPath: p,
                mimeType: mime,
                createdAt: timestamp,
                parentSessionUuid,
              });
            } catch (mediaErr) {
              console.warn(
                `[mas4s:transcript-store] Failed to upsert session media for ${sessionKey}: ${String(mediaErr)}`,
              );
            }
          }
        }
        if (imageLines.length > 0) {
          content = content ? `${content}\n${imageLines.join("\n")}` : imageLines.join("\n");
        }
      }

      const role = normaliseRole(rawRole);
      // Skip gateway-injected inbound metadata messages (second transcript event
      // fired after buildInboundUserContextPrefix prepends Sender/Conversation blocks).
      // These are duplicates of the original user message and must not be stored.
      if (role === "user" && isInboundMetaMessage(content)) {
        return;
      }

      // ── A2A agent mark detection ──────────────────────────────────────────
      // If this is a "user" message and there is a pending agent mark for this
      // sessionKey, check if the message content matches the fingerprint.
      // If so, convert role to "agent" and extract sourceAgentId.
      let finalRole: StoredMessage["role"] = role;
      let sourceAgentId: string | null = null;

      if (finalRole === "user") {
        const queue = this.pendingAgentMarks.get(sessionKey);
        if (queue && queue.length > 0) {
          // Purge expired marks (older than AGENT_MARK_TTL_MS)
          const now = Date.now();
          while (queue.length > 0 && now - queue[0].markedAt > AGENT_MARK_TTL_MS) {
            queue.shift();
          }
          if (queue.length > 0) {
            // Content fingerprint match: sessions_send wraps the message with a
            // timestamp prefix like "[Tue 2026-04-14 21:14 GMT+8] original message",
            // so we use includes() for fuzzy matching.
            const idx = queue.findIndex((mark) => content.includes(mark.messageFingerprint));
            if (idx >= 0) {
              const mark = queue.splice(idx, 1)[0];
              finalRole = "agent";
              sourceAgentId = mark.sourceAgentId;
              debugLog(
                `[mas4s:transcript-store] A2A mark matched: sessionKey=${sessionKey} sourceAgentId=${sourceAgentId} fingerprint="${mark.messageFingerprint.slice(0, 30)}..."`,
              );
            }
          }
          // Clean up empty queue
          if (queue.length === 0) {
            this.pendingAgentMarks.delete(sessionKey);
          }
        }
      }

      const state = this.getOrInitState(sessionUuid, sessionKey, sessionId, parentSessionUuid);
      const seq = state.lastSeq + 1;
      state.lastSeq = seq;

      const stored: StoredMessage = {
        id: crypto.randomUUID(),
        sessionUuid,
        sessionKey,
        sessionId,
        userId: state.sender.userId,
        tenantId: state.sender.tenantId,
        role: finalRole,
        content,
        timestamp,
        seq,
        archivedDate: null,
        toolCallId:
          (msg["toolCallId"] as string | null) ?? (msg["tool_call_id"] as string | null) ?? null,
        toolName: (msg["toolName"] as string | null) ?? (msg["tool_name"] as string | null) ?? null,
        parentSessionUuid: state.parentSessionUuid,
        sourceAgentId,
      };

      debugLog(
        `[mas4s:transcript-store] pushing to buffer role=${role} toolCallId=${stored.toolCallId} seq=${seq}`,
      );
      this.buffer.push(stored);

      // Back-fill triggeredByMsgId into the most recent [approval:requested] record
      // for this session. exec.approval.requested (path C) fires before the JSONL
      // transcript event (path A), so by the time this assistant message arrives the
      // approval record may already have been flushed to DB by the periodic timer.
      // We therefore update the DB row directly rather than patching the in-memory
      // buffer, which avoids the race with the flush timer.
      //
      // Only link assistant messages whose timestamp is strictly after the approval's
      // createdAtMs, so that the earlier assistant message containing the tool_use
      // that triggered the approval is not incorrectly linked.
      if (role === "assistant") {
        try {
          // Back-fill triggeredByMsgId into the most recent [approval:requested] record
          // for this session. exec.approval.requested (path C) fires before the JSONL
          // transcript event (path A), so by the time this assistant message arrives the
          // approval record may already have been flushed to DB by the periodic timer.
          //
          // Only link assistant messages whose timestamp is strictly after the approval's
          // createdAtMs, so that the earlier assistant message containing the tool_use
          // that triggered the approval is not incorrectly linked.
          //
          // The two steps below are mutually exclusive: an approval record is either
          // in the buffer (not yet flushed) or in the DB (already flushed), never both.
          // Step 1 handles the already-flushed case; step 2 handles the still-buffered case.

          // Step 1: patch a DB row that was already flushed.
          let dbPatched = false;
          const row = this.db
            .prepare(
              `SELECT id, content FROM session_messages
                  WHERE sessionKey = ? AND role = 'approval'
                    AND content LIKE '[approval:requested]%'
                  ORDER BY timestamp DESC
                  LIMIT 1`,
            )
            .get(sessionKey) as { id: string; content: string } | undefined;

          if (row) {
            const jsonStart = row.content.indexOf(" ") + 1;
            const parsed = JSON.parse(row.content.slice(jsonStart)) as Record<string, unknown>;
            const createdAtMs =
              typeof parsed["createdAtMs"] === "number" ? parsed["createdAtMs"] : 0;
            if (!parsed["triggeredByMsgId"] && timestamp > createdAtMs) {
              parsed["triggeredByMsgId"] = stored.id;
              const newContent = `[approval:requested] ${JSON.stringify(parsed)}`;
              this.db
                .prepare(`UPDATE session_messages SET content = ? WHERE id = ?`)
                .run(newContent, row.id);
              dbPatched = true;
            }
          }

          // Step 2: patch a matching entry still in the buffer (not yet flushed).
          // Skipped if step 1 already patched the DB row.
          if (!dbPatched) {
            for (let i = this.buffer.length - 2; i >= 0; i--) {
              const entry = this.buffer[i];
              if (!entry || entry.sessionKey !== sessionKey || entry.role !== "approval") {
                continue;
              }
              if (!entry.content.startsWith("[approval:requested]")) {
                continue;
              }
              const jsonStart = entry.content.indexOf(" ") + 1;
              const entryParsed = JSON.parse(entry.content.slice(jsonStart)) as Record<
                string,
                unknown
              >;
              const entryCreatedAtMs =
                typeof entryParsed["createdAtMs"] === "number" ? entryParsed["createdAtMs"] : 0;
              if (!entryParsed["triggeredByMsgId"] && timestamp > entryCreatedAtMs) {
                entryParsed["triggeredByMsgId"] = stored.id;
                entry.content = `[approval:requested] ${JSON.stringify(entryParsed)}`;
              }
              break;
            }
          }
        } catch (err) {
          console.warn("[mas4s:transcript-store] backfill triggeredByMsgId failed:", err);
        }
      }

      if (this.buffer.length >= this.maxBufferSize) {
        this.flush();
      }
    } catch (err) {
      console.error("[mas4s:transcript-store] handleUpdate error:", err);
    }
  }

  // ── flush (private) ───────────────────────────────────────────────────────

  private flush(): void {
    try {
      if (this.buffer.length === 0) {
        return;
      }
      // Drain the buffer atomically.
      const msgs = this.buffer.splice(0);
      this.persistBatch(msgs);
    } catch (err) {
      console.error("[mas4s:transcript-store] flush error:", err);
    }
  }

  // ── persistBatch (private) ────────────────────────────────────────────────

  private persistBatch(msgs: StoredMessage[]): void {
    debugLog(`[mas4s:transcript-store] persistBatch: persisting ${msgs.length} messages`);
    // Group by sessionUuid for archive checks and statistic updates.
    const byUuid = new Map<string, StoredMessage[]>();
    for (const m of msgs) {
      let group = byUuid.get(m.sessionUuid);
      if (!group) {
        group = [];
        byUuid.set(m.sessionUuid, group);
      }
      group.push(m);
    }

    const insertStmt = this.db.prepare(
      `INSERT INTO session_messages
         (id, sessionUuid, sessionKey, sessionId, userId, tenantId, role, content, timestamp, seq, archivedDate, toolCallId, toolName, parentSessionUuid, sourceAgentId)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    // Upsert statistic row: on first insert create the row; on subsequent inserts
    // update lastMsgAt/msgCount/lastSeq and narrow firstMsgAt if a back-dated
    // message arrives (e.g. from a replay).
    const upsertStatStmt = this.db.prepare(
      `INSERT INTO session_msg_statistic (sessionUuid, sessionKey, sessionId, firstMsgAt, lastMsgAt, msgCount, lastSeq, parentSessionUuid)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(sessionUuid) DO UPDATE SET
         sessionKey = excluded.sessionKey,
         sessionId  = excluded.sessionId,
         firstMsgAt = MIN(firstMsgAt, excluded.firstMsgAt),
         lastMsgAt  = MAX(lastMsgAt,  excluded.lastMsgAt),
         msgCount   = msgCount + excluded.msgCount,
         lastSeq    = MAX(lastSeq,    excluded.lastSeq),
         parentSessionUuid = COALESCE(parentSessionUuid, excluded.parentSessionUuid)`,
    );

    // Single transaction: archive checks + batch INSERT + statistic upsert.
    this.db.exec("BEGIN");
    try {
      for (const [sessionUuid, group] of byUuid) {
        // Find the earliest timestamp in this batch for the archive check.
        const minTs = group.reduce(
          (min, m) => (m.timestamp < min ? m.timestamp : min),
          group[0].timestamp,
        );
        const newMsgDate = toDateStr(minTs);
        const archiveDate = this.checkArchiveDate(sessionUuid, newMsgDate);

        if (archiveDate !== null) {
          const updateStmt = this.db.prepare(
            `UPDATE session_messages
               SET archivedDate = ?
             WHERE sessionUuid = ? AND archivedDate IS NULL`,
          );
          const result = updateStmt.run(archiveDate, sessionUuid) as { changes: number };
          console.info(
            `[mas4s:transcript-store] archived sessionUuid=${sessionUuid} date=${archiveDate} rows=${result.changes}`,
          );
        }
      }

      for (const m of msgs) {
        insertStmt.run(
          m.id,
          m.sessionUuid,
          m.sessionKey,
          m.sessionId,
          m.userId,
          m.tenantId,
          m.role,
          m.content,
          m.timestamp,
          m.seq,
          m.archivedDate,
          m.toolCallId,
          m.toolName,
          m.parentSessionUuid,
          m.sourceAgentId,
        );
      }

      // Upsert session_msg_statistic once per sessionUuid.
      for (const [sessionUuid, group] of byUuid) {
        const m = group[group.length - 1];
        const batchMinTs = group.reduce(
          (min, msg) => (msg.timestamp < min ? msg.timestamp : min),
          group[0].timestamp,
        );
        const batchMaxTs = group.reduce(
          (max, msg) => (msg.timestamp > max ? msg.timestamp : max),
          group[0].timestamp,
        );
        const batchMaxSeq = group.reduce(
          (max, msg) => (msg.seq > max ? msg.seq : max),
          group[0].seq,
        );

        upsertStatStmt.run(
          sessionUuid,
          m.sessionKey,
          m.sessionId,
          batchMinTs,
          batchMaxTs,
          group.length,
          batchMaxSeq,
          m.parentSessionUuid,
        );
      }

      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      // On rollback, restore lastSeq in memory to the pre-batch value so the
      // next flush doesn't produce a gap in seq numbers.
      for (const [sessionUuid, group] of byUuid) {
        const state = this.sessionStates.get(sessionUuid);
        if (state) {
          state.lastSeq -= group.length;
        }
      }
      throw err;
    }

    // Commit succeeded: update in-memory statistic counters to mirror the DB.
    for (const m of msgs) {
      const state = this.getOrInitState(m.sessionUuid, m.sessionKey, m.sessionId);
      state.firstMsgAt =
        state.firstMsgAt === 0 ? m.timestamp : Math.min(state.firstMsgAt, m.timestamp);
      state.lastMsgAt = Math.max(state.lastMsgAt, m.timestamp);
      state.msgCount += 1; // Simplified batch update
      // lastSeq logic remains eagerly advanced.
    }
  }

  // ── checkArchiveDate (private) ────────────────────────────────────────────

  /**
   * Query the latest active (archivedDate IS NULL) message timestamp for
   * sessionKey. Returns the date string of that message if it differs from
   * newMsgDate (meaning a day boundary was crossed), otherwise null.
   *
   * Uses the in-memory lastMsgAt from SessionState when available to avoid a
   * DB read on the hot path; falls back to a DB query for sessions loaded from
   * a previous run whose lastMsgAt may reflect archived messages.
   */
  private checkArchiveDate(sessionUuid: string, newMsgDate: string): string | null {
    const state = this.sessionStates.get(sessionUuid);
    const candidateTs = state?.lastMsgAt ?? 0;

    if (candidateTs > 0) {
      const existingDate = toDateStr(candidateTs);
      if (existingDate === newMsgDate) {
        return null;
      }
      // Day boundary crossed — confirm against DB (lastMsgAt may include
      // already-archived rows; we only want to archive still-active ones).
    }

    const row = this.db
      .prepare(
        `SELECT MAX(timestamp) AS maxTs
           FROM session_messages
          WHERE sessionUuid = ? AND archivedDate IS NULL`,
      )
      .get(sessionUuid) as { maxTs: number | null } | undefined;

    if (!row || row.maxTs == null) {
      return null;
    }

    const existingDate = toDateStr(row.maxTs);
    if (existingDate === newMsgDate) {
      return null;
    }

    return existingDate;
  }
}
