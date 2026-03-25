import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { onSessionTranscriptUpdate } from "../../../src/sessions/transcript-events.js";
import type { SessionTranscriptUpdate } from "../../../src/sessions/transcript-events.js";
import { upsertSummary } from "./session-summary-store.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface SenderContext {
  userId: string | null;
  tenantId: string | null;
}

export interface StoredMessage {
  id: string;
  sessionKey: string;
  sessionId: string;
  userId: string | null;
  tenantId: string | null;
  role: "user" | "assistant" | "tool";
  content: string;
  timestamp: number;
  seq: number;
  archivedDate: string | null;
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
  lastSeq: number;
  firstMsgAt: number;
  lastMsgAt: number;
  msgCount: number;
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
        if (b["type"] === "text" && typeof b["text"] === "string") {
          return b["text"];
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
function normaliseRole(raw: unknown): "user" | "assistant" | "tool" {
  if (raw === "human" || raw === "user") {
    return "user";
  }
  if (raw === "ai" || raw === "assistant") {
    return "assistant";
  }
  if (raw === "tool" || raw === "toolResult" || raw === "tool_result") {
    return "tool";
  }
  // Unknown roles fall back to "user" to satisfy the DB CHECK constraint.
  return "user";
}

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
function defaultSessionState(): SessionState {
  return {
    sender: { userId: null, tenantId: null },
    lastSeq: 0,
    firstMsgAt: 0,
    lastMsgAt: 0,
    msgCount: 0,
  };
}

// ── Class ────────────────────────────────────────────────────────────────────

export class SessionTranscriptStore {
  private readonly db: DatabaseSync;
  private readonly flushIntervalMs: number;
  private readonly maxBufferSize: number;

  /**
   * Central per-session state store.
   * Keyed by sessionKey (== sessionId in this codebase).
   * Loaded from session_msg_statistic on construction; kept in sync after every
   * persistBatch commit so callers never need to query the DB for seq or stats.
   */
  private readonly sessionStates = new Map<string, SessionState>();

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
          "SELECT sessionKey, firstMsgAt, lastMsgAt, msgCount, lastSeq FROM session_msg_statistic",
        )
        .all() as Array<{
        sessionKey: string;
        firstMsgAt: number;
        lastMsgAt: number;
        msgCount: number;
        lastSeq: number;
      }>;
      for (const row of rows) {
        this.sessionStates.set(row.sessionKey, {
          sender: { userId: null, tenantId: null },
          lastSeq: row.lastSeq,
          firstMsgAt: row.firstMsgAt,
          lastMsgAt: row.lastMsgAt,
          msgCount: row.msgCount,
        });
      }
    } catch {
      // Table may not exist yet during first init — safe to ignore.
    }
  }

  // ── getOrInitState (private) ───────────────────────────────────────────────

  /** Return the SessionState for a key, creating a default entry if absent. */
  private getOrInitState(sessionKey: string): SessionState {
    let state = this.sessionStates.get(sessionKey);
    if (!state) {
      state = defaultSessionState();
      this.sessionStates.set(sessionKey, state);
    }
    return state;
  }

  // ── recordSenderContext ────────────────────────────────────────────────────

  /** Called by the chat.send extraHandler to associate a sessionKey with a user. */
  recordSenderContext(sessionKey: string, ctx: SenderContext): void {
    this.getOrInitState(sessionKey).sender = ctx;
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
        m.sessionKey === sessionKey &&
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
      return;
    }

    if (phase === "result") {
      const pending = this.pendingToolCalls.get(toolCallId);
      if (!pending) {
        return;
      }
      this.pendingToolCalls.delete(toolCallId);

      const resultStr = formatToolResult(result);
      const content = resultStr
        ? `${pending.callContent}\n[tool_result] ${resultStr.replace(/\n/g, "\\n")}`
        : pending.callContent;

      this.pushToBuffer({
        sessionKey: pending.sessionKey,
        role: "assistant",
        content,
        timestamp: pending.timestamp,
      });
    }
  }

  // ── persistSummary ────────────────────────────────────────────────────────

  /**
   * Persist a generated summary into the dedicated session_summaries table
   * in mas4s.message.db. Uses upsert semantics — one row per sessionKey.
   * Written immediately (not buffered) so it is available for query right away.
   */
  persistSummary(params: {
    sessionKey: string;
    textSummary: string | null;
    toolSummary: string | null;
    generatedAt: number;
    generatedBy: string;
  }): void {
    upsertSummary(this.db, params);
    console.log(`[mas4s:transcript-store] persisted summary for sessionKey=${params.sessionKey}`);
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
    role: StoredMessage["role"];
    content: string;
    timestamp: number;
  }): void {
    const { sessionKey, role, content, timestamp } = params;
    // sessionId == sessionKey in this codebase.
    const sessionId = sessionKey;
    const state = this.getOrInitState(sessionKey);
    const seq = state.lastSeq + 1;
    // Eagerly advance lastSeq so subsequent pushes in the same flush cycle get
    // monotonically increasing seq values without waiting for a DB round-trip.
    state.lastSeq = seq;

    this.buffer.push({
      id: crypto.randomUUID(),
      sessionKey,
      sessionId,
      userId: state.sender.userId,
      tenantId: state.sender.tenantId,
      role,
      content,
      timestamp,
      seq,
      archivedDate: null,
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

      const msg = update.message as Record<string, unknown>;

      const rawRole = msg["role"];
      // content 可能是字符串（user 消息）或数组（assistant/tool 消息）
      // 数组格式：[{ type: "text", text: "..." }, ...]
      const content = extractContent(msg["content"]);
      const timestamp = typeof msg["timestamp"] === "number" ? msg["timestamp"] : Date.now();
      // gateway 的 message 对象不含 sessionId 字段，从 sessionKey 推导
      const sessionId =
        typeof msg["sessionId"] === "string" && msg["sessionId"]
          ? msg["sessionId"]
          : (update.sessionKey ?? "");
      const sessionKey = update.sessionKey ?? "";

      if (!sessionKey) {
        return;
      }

      const role = normaliseRole(rawRole);
      // Skip gateway-injected inbound metadata messages (second transcript event
      // fired after buildInboundUserContextPrefix prepends Sender/Conversation blocks).
      // These are duplicates of the original user message and must not be stored.
      if (role === "user" && isInboundMetaMessage(content)) {
        return;
      }

      const state = this.getOrInitState(sessionKey);
      const seq = state.lastSeq + 1;
      state.lastSeq = seq;

      const stored: StoredMessage = {
        id: crypto.randomUUID(),
        sessionKey,
        sessionId,
        userId: state.sender.userId,
        tenantId: state.sender.tenantId,
        role,
        content,
        timestamp,
        seq,
        archivedDate: null,
      };

      this.buffer.push(stored);

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
      const msgs = this.buffer.splice(0, this.buffer.length);
      this.persistBatch(msgs);
    } catch (err) {
      console.error("[mas4s:transcript-store] flush error:", err);
    }
  }

  // ── persistBatch (private) ────────────────────────────────────────────────

  private persistBatch(msgs: StoredMessage[]): void {
    // Group by sessionKey for archive checks and statistic updates.
    const byKey = new Map<string, StoredMessage[]>();
    for (const m of msgs) {
      let group = byKey.get(m.sessionKey);
      if (!group) {
        group = [];
        byKey.set(m.sessionKey, group);
      }
      group.push(m);
    }

    const insertStmt = this.db.prepare(
      `INSERT INTO session_messages
         (id, sessionKey, sessionId, userId, tenantId, role, content, timestamp, seq, archivedDate)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    // Upsert statistic row: on first insert create the row; on subsequent inserts
    // update lastMsgAt/msgCount/lastSeq and narrow firstMsgAt if a back-dated
    // message arrives (e.g. from a replay).
    const upsertStatStmt = this.db.prepare(
      `INSERT INTO session_msg_statistic (sessionKey, firstMsgAt, lastMsgAt, msgCount, lastSeq)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(sessionKey) DO UPDATE SET
         firstMsgAt = MIN(firstMsgAt, excluded.firstMsgAt),
         lastMsgAt  = MAX(lastMsgAt,  excluded.lastMsgAt),
         msgCount   = msgCount + excluded.msgCount,
         lastSeq    = MAX(lastSeq,    excluded.lastSeq)`,
    );

    // Single transaction: archive checks + batch INSERT + statistic upsert.
    this.db.exec("BEGIN");
    try {
      for (const [sessionKey, group] of byKey) {
        // Find the earliest timestamp in this batch for the archive check.
        const minTs = group.reduce(
          (min, m) => (m.timestamp < min ? m.timestamp : min),
          group[0].timestamp,
        );
        const newMsgDate = toDateStr(minTs);
        const archiveDate = this.checkArchiveDate(sessionKey, newMsgDate);

        if (archiveDate !== null) {
          const updateStmt = this.db.prepare(
            `UPDATE session_messages
               SET archivedDate = ?
             WHERE sessionKey = ? AND archivedDate IS NULL`,
          );
          const result = updateStmt.run(archiveDate, sessionKey) as { changes: number };
          console.info(
            `[mas4s:transcript-store] archived sessionKey=${sessionKey} date=${archiveDate} rows=${result.changes}`,
          );
        }
      }

      for (const m of msgs) {
        insertStmt.run(
          m.id,
          m.sessionKey,
          m.sessionId,
          m.userId,
          m.tenantId,
          m.role,
          m.content,
          m.timestamp,
          m.seq,
          m.archivedDate,
        );
      }

      // Upsert session_msg_statistic once per sessionKey.
      for (const [sessionKey, group] of byKey) {
        const batchMinTs = group.reduce(
          (min, m) => (m.timestamp < min ? m.timestamp : min),
          group[0].timestamp,
        );
        const batchMaxTs = group.reduce(
          (max, m) => (m.timestamp > max ? m.timestamp : max),
          group[0].timestamp,
        );
        const batchMaxSeq = group.reduce((max, m) => (m.seq > max ? m.seq : max), group[0].seq);
        upsertStatStmt.run(sessionKey, batchMinTs, batchMaxTs, group.length, batchMaxSeq);
      }

      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      // On rollback, restore lastSeq in memory to the pre-batch value so the
      // next flush doesn't produce a gap in seq numbers.
      for (const [sessionKey, group] of byKey) {
        const state = this.sessionStates.get(sessionKey);
        if (state) {
          state.lastSeq -= group.length;
        }
      }
      throw err;
    }

    // Commit succeeded: update in-memory statistic counters to mirror the DB.
    for (const [sessionKey, group] of byKey) {
      const state = this.getOrInitState(sessionKey);
      const batchMinTs = group.reduce(
        (min, m) => (m.timestamp < min ? m.timestamp : min),
        group[0].timestamp,
      );
      const batchMaxTs = group.reduce(
        (max, m) => (m.timestamp > max ? m.timestamp : max),
        group[0].timestamp,
      );
      state.firstMsgAt =
        state.firstMsgAt === 0 ? batchMinTs : Math.min(state.firstMsgAt, batchMinTs);
      state.lastMsgAt = Math.max(state.lastMsgAt, batchMaxTs);
      state.msgCount += group.length;
      // lastSeq was already advanced eagerly in pushToBuffer/handleUpdate;
      // no further update needed here.
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
  private checkArchiveDate(sessionKey: string, newMsgDate: string): string | null {
    const state = this.sessionStates.get(sessionKey);
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
          WHERE sessionKey = ? AND archivedDate IS NULL`,
      )
      .get(sessionKey) as { maxTs: number | null } | undefined;

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
