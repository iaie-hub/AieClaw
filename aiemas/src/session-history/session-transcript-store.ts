import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { onSessionTranscriptUpdate } from "../../../src/sessions/transcript-events.js";
import type { SessionTranscriptUpdate } from "../../../src/sessions/transcript-events.js";

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
  role: "user" | "assistant" | "tool" | "summary";
  content: string;
  timestamp: number;
  seq: number;
  archivedDate: string | null;
}

export interface SessionTranscriptStoreOptions {
  /** Flush interval in ms. Default: 500 */
  flushIntervalMs?: number;
  /** Max buffer size before forced flush. Default: 100 */
  maxBufferSize?: number;
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
        // tool_use block: { type: "tool_use", name: "...", input: {...} }
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
function normaliseRole(raw: unknown): "user" | "assistant" | "tool" | "summary" {
  if (raw === "human" || raw === "user") {
    return "user";
  }
  if (raw === "ai" || raw === "assistant") {
    return "assistant";
  }
  if (raw === "tool" || raw === "toolResult" || raw === "tool_result") {
    return "tool";
  }
  if (raw === "summary") {
    return "summary";
  }
  // Unknown roles fall back to "user" to satisfy the DB CHECK constraint.
  return "user";
}

// ── Class ────────────────────────────────────────────────────────────────────

export class SessionTranscriptStore {
  private readonly db: DatabaseSync;
  private readonly flushIntervalMs: number;
  private readonly maxBufferSize: number;

  /** sessionKey → { userId, tenantId } — populated by chat.send extraHandler */
  private readonly senderMap = new Map<string, SenderContext>();

  /** sessionId → current max seq — loaded from DB on start, incremented in-memory. */
  private readonly seqMap = new Map<string, number>();

  /** In-memory write buffer; drained on each flush. */
  private readonly buffer: StoredMessage[] = [];

  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribe: (() => void) | null = null;

  // ── 2.1 Constructor ────────────────────────────────────────────────────────

  constructor(db: DatabaseSync, opts?: SessionTranscriptStoreOptions) {
    this.db = db;
    this.flushIntervalMs = opts?.flushIntervalMs ?? 500;
    this.maxBufferSize = opts?.maxBufferSize ?? 100;
    this.loadSeqCounters();
  }

  // ── 2.1b loadSeqCounters ──────────────────────────────────────────────────

  /** Load max seq per sessionId from DB so seq accumulates across restarts. */
  private loadSeqCounters(): void {
    try {
      const rows = this.db
        .prepare("SELECT sessionId, MAX(seq) AS maxSeq FROM session_messages GROUP BY sessionId")
        .all() as Array<{ sessionId: string; maxSeq: number }>;
      for (const row of rows) {
        this.seqMap.set(row.sessionId, row.maxSeq);
      }
    } catch {
      // Table may not exist yet during first init — safe to ignore.
    }
  }

  // ── 2.2 recordSenderContext ────────────────────────────────────────────────

  /** Called by the chat.send extraHandler to associate a sessionKey with a user. */
  recordSenderContext(sessionKey: string, ctx: SenderContext): void {
    this.senderMap.set(sessionKey, ctx);
  }

  // ── 2.3 start ─────────────────────────────────────────────────────────────

  /** Subscribe to transcript updates and start the periodic flush timer. */
  start(): void {
    this.unsubscribe = onSessionTranscriptUpdate((update) => this.handleUpdate(update));
    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.flushIntervalMs);
  }

  // ── 2.4 stop ──────────────────────────────────────────────────────────────

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

  // ── 2.9 getBuffered ───────────────────────────────────────────────────────

  /**
   * Return a snapshot of buffer entries matching the given conditions.
   * Read-only — does not modify the buffer.
   */
  getBuffered(sessionKey: string, from: number, to: number, sessionId?: string): StoredMessage[] {
    return this.buffer.filter(
      (m) =>
        m.sessionKey === sessionKey &&
        m.timestamp >= from &&
        m.timestamp <= to &&
        (sessionId === undefined || m.sessionId === sessionId),
    );
  }

  // ── 2.5 handleUpdate (private) ────────────────────────────────────────────

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
      const sender = this.senderMap.get(sessionKey) ?? { userId: null, tenantId: null };

      // Accumulate seq per sessionId: increment from the tracked max.
      const prevSeq = this.seqMap.get(sessionId) ?? 0;
      const seq = prevSeq + 1;
      this.seqMap.set(sessionId, seq);

      const stored: StoredMessage = {
        id: crypto.randomUUID(),
        sessionKey,
        sessionId,
        userId: sender.userId,
        tenantId: sender.tenantId,
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

  // ── 2.6 flush (private) ───────────────────────────────────────────────────

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

  // ── 2.7 persistBatch (private) ────────────────────────────────────────────

  private persistBatch(msgs: StoredMessage[]): void {
    // Group by sessionKey for archive checks.
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

    // Single transaction: archive checks + batch INSERT.
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

      this.db.exec("COMMIT");
    } catch (err) {
      this.db.exec("ROLLBACK");
      throw err;
    }
  }

  // ── 2.8 checkArchiveDate (private) ────────────────────────────────────────

  /**
   * Query the latest active (archivedDate IS NULL) message timestamp for
   * sessionKey. Returns the date string of that message if it differs from
   * newMsgDate (meaning a day boundary was crossed), otherwise null.
   */
  private checkArchiveDate(sessionKey: string, newMsgDate: string): string | null {
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
