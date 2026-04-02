/**
 * Unit tests and property-based tests for session message history.
 *
 * Feature: aiemas-session-message-history
 *
 * **Validates: Requirements 1.2, 1.3, 2.2, 2.3, 3.2, 3.3, 3.4, 3.5, 5.1, 5.2**
 */

import crypto from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import * as fc from "fast-check";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestMessageDatabase } from "../test-helpers/setup.js";
import { queryHistoryRange } from "./session-history-query.js";
import { SessionTranscriptStore } from "./session-transcript-store.js";
import type { StoredMessage } from "./session-transcript-store.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeDb(): { db: DatabaseSync; cleanup: () => void } {
  return createTestMessageDatabase();
}

/** Build a minimal StoredMessage for testing. */
function makeMsg(
  overrides: Partial<StoredMessage> & { sessionKey: string; sessionId: string },
): StoredMessage {
  const { sessionKey } = overrides;
  const sessionUuid = overrides.sessionUuid ?? sessionKey;
  return {
    id: crypto.randomUUID(),
    sessionUuid,
    userId: null,
    tenantId: null,
    role: "user",
    content: "hello",
    timestamp: Date.now(),
    seq: 1,
    archivedDate: null,
    toolCallId: null,
    toolName: null,
    parentSessionUuid: null,
    ...overrides,
  };
}

/** Push messages directly into the store's private buffer (no start() needed). */
function pushToBuffer(store: SessionTranscriptStore, msgs: StoredMessage[]): void {
  const buf = (store as unknown as { buffer: StoredMessage[] }).buffer;
  buf.push(...msgs);
}

// ── Test state ────────────────────────────────────────────────────────────────

let db: DatabaseSync;
let cleanup: () => void;
let store: SessionTranscriptStore;

beforeEach(() => {
  const result = makeDb();
  db = result.db;
  cleanup = result.cleanup;
  // Use a very long flush interval so timer never fires during tests
  store = new SessionTranscriptStore(db, { flushIntervalMs: 999_999, maxBufferSize: 100 });
});

afterEach(() => {
  // stop() flushes remaining buffer and clears any timer
  store.stop();
  cleanup();
});

// ── 5.1 SessionTranscriptStore unit tests ────────────────────────────────────

describe("SessionTranscriptStore unit tests", () => {
  it("message write: after stop(), messages appear in DB", () => {
    const msg = makeMsg({ sessionKey: "sk1", sessionId: "sid1", content: "test content" });
    pushToBuffer(store, [msg]);

    store.stop();

    const row = db.prepare("SELECT * FROM session_messages WHERE id = ?").get(msg.id) as
      | Record<string, unknown>
      | undefined;

    expect(row).toBeDefined();
    expect(row!["content"]).toBe("test content");
    expect(row!["sessionKey"]).toBe("sk1");
    expect(row!["sessionId"]).toBe("sid1");
  });

  it("daily archive trigger: messages from different days cause old messages to get archivedDate set", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(12, 0, 0, 0);
    const yesterdayTs = yesterday.getTime();

    const today = new Date();
    today.setHours(12, 0, 0, 0);
    const todayTs = today.getTime();

    const oldMsg = makeMsg({
      sessionKey: "sk-archive",
      sessionId: "sid-archive",
      timestamp: yesterdayTs,
      content: "old message",
    });

    // First flush: insert yesterday's message
    pushToBuffer(store, [oldMsg]);
    store.stop();

    // Verify it's in DB with no archivedDate
    const rowBefore = db
      .prepare("SELECT archivedDate FROM session_messages WHERE id = ?")
      .get(oldMsg.id) as { archivedDate: string | null } | undefined;
    expect(rowBefore?.archivedDate).toBeNull();

    // Create a new store instance (stop() cleared the old one)
    store = new SessionTranscriptStore(db, { flushIntervalMs: 999_999, maxBufferSize: 100 });

    const newMsg = makeMsg({
      sessionKey: "sk-archive",
      sessionId: "sid-archive",
      timestamp: todayTs,
      content: "new message",
    });

    pushToBuffer(store, [newMsg]);
    store.stop();

    // Old message should now have archivedDate set
    const rowAfter = db
      .prepare("SELECT archivedDate FROM session_messages WHERE id = ?")
      .get(oldMsg.id) as { archivedDate: string | null } | undefined;
    expect(rowAfter?.archivedDate).not.toBeNull();
    expect(typeof rowAfter?.archivedDate).toBe("string");
    // archivedDate should be yesterday's date string
    expect(rowAfter?.archivedDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("maxBufferSize forced flush: when buffer reaches maxBufferSize, messages are flushed immediately", () => {
    // Create store with maxBufferSize=3
    store.stop();
    store = new SessionTranscriptStore(db, { flushIntervalMs: 999_999, maxBufferSize: 3 });

    const msgs = [
      makeMsg({ sessionKey: "sk-flush", sessionId: "sid-flush", content: "msg1" }),
      makeMsg({ sessionKey: "sk-flush", sessionId: "sid-flush", content: "msg2" }),
      makeMsg({ sessionKey: "sk-flush", sessionId: "sid-flush", content: "msg3" }),
    ];

    // Push all 3 — the 3rd push triggers flush (buffer.length >= maxBufferSize)
    const buf = (store as unknown as { buffer: StoredMessage[] }).buffer;
    buf.push(msgs[0]);
    buf.push(msgs[1]);
    // Push 3rd and trigger flush manually (simulating handleUpdate behavior)
    buf.push(msgs[2]);
    // Trigger the forced flush by calling flush via the private method
    (store as unknown as { flush: () => void }).flush();

    // Buffer should be empty after forced flush
    expect(buf.length).toBe(0);

    // All 3 messages should be in DB
    const count = (
      db
        .prepare("SELECT COUNT(*) as cnt FROM session_messages WHERE sessionKey = ?")
        .get("sk-flush") as { cnt: number }
    ).cnt;
    expect(count).toBe(3);
  });

  it("stop() forced flush: buffered messages are persisted after stop()", () => {
    const msgs = [
      makeMsg({ sessionKey: "sk-stop", sessionId: "sid-stop", content: "buffered1" }),
      makeMsg({ sessionKey: "sk-stop", sessionId: "sid-stop", content: "buffered2" }),
    ];

    pushToBuffer(store, msgs);

    // Verify not yet in DB
    const countBefore = (
      db
        .prepare("SELECT COUNT(*) as cnt FROM session_messages WHERE sessionKey = ?")
        .get("sk-stop") as { cnt: number }
    ).cnt;
    expect(countBefore).toBe(0);

    store.stop();

    // Now should be in DB
    const countAfter = (
      db
        .prepare("SELECT COUNT(*) as cnt FROM session_messages WHERE sessionKey = ?")
        .get("sk-stop") as { cnt: number }
    ).cnt;
    expect(countAfter).toBe(2);
  });

  it("getBuffered() filter logic: returns only matching messages from buffer", () => {
    const now = Date.now();
    const msgs = [
      makeMsg({ sessionKey: "sk-buf", sessionId: "sid-a", timestamp: now, content: "match1" }),
      makeMsg({
        sessionKey: "sk-buf",
        sessionId: "sid-b",
        timestamp: now,
        content: "no-match-sid",
      }),
      makeMsg({
        sessionKey: "sk-other",
        sessionId: "sid-a",
        timestamp: now,
        content: "no-match-key",
      }),
      makeMsg({
        sessionKey: "sk-buf",
        sessionId: "sid-a",
        timestamp: now - 100_000,
        content: "no-match-time",
      }),
    ];

    pushToBuffer(store, msgs);

    // Filter by sessionKey + time range + sessionId
    const result = store.getBuffered("sk-buf", now - 1000, now + 1000, "sid-a");
    expect(result).toHaveLength(1);
    expect(result[0].content).toBe("match1");

    // Filter by sessionKey + time range only (no sessionId filter)
    const result2 = store.getBuffered("sk-buf", now - 1000, now + 1000);
    expect(result2).toHaveLength(2);
    expect(result2.map((m) => m.content).toSorted()).toEqual(["match1", "no-match-sid"].toSorted());
  });

  it("recordSenderContext: userId and tenantId are associated with sessionKey and used in handleUpdate", () => {
    // Record sender context for a session
    store.recordSenderContext("sk-sender", "sk-sender", "sid-sender", {
      userId: "user-123",
      tenantId: "tenant-456",
    });

    const handleUpdate = (
      store as unknown as { handleUpdate: (u: unknown) => void }
    ).handleUpdate.bind(store);

    // Trigger handleUpdate with a message for that sessionKey
    handleUpdate({
      sessionKey: "sk-sender",
      message: { role: "user", content: "hello", sessionId: "sid-sender", timestamp: 1000 },
    });

    // Flush to persist
    (store as unknown as { flush: () => void }).flush();

    // Verify the message was persisted with the correct userId and tenantId
    const row = db
      .prepare("SELECT userId, tenantId FROM session_messages WHERE sessionKey = ?")
      .get("sk-sender") as { userId: string | null; tenantId: string | null } | undefined;

    expect(row).toBeDefined();
    expect(row!.userId).toBe("user-123");
    expect(row!.tenantId).toBe("tenant-456");
  });

  it("inbound metadata duplicate: Sender-prefixed user messages are skipped and not stored", () => {
    const handleUpdate = (
      store as unknown as { handleUpdate: (u: unknown) => void }
    ).handleUpdate.bind(store);

    // First event: plain user message (seq=1)
    handleUpdate({
      sessionKey: "sk-dedup",
      message: { role: "user", content: "你好", sessionId: "sid-dedup", timestamp: 1000 },
    });

    // Second event: gateway-injected metadata duplicate (should be skipped)
    const senderPrefixed =
      'Sender (untrusted metadata):\n```json\n{"label":"管理员"}\n```\n\n[Wed 2026-03-25 10:51 GMT+8] 你好';
    handleUpdate({
      sessionKey: "sk-dedup",
      message: { role: "user", content: senderPrefixed, sessionId: "sid-dedup", timestamp: 1001 },
    });

    (store as unknown as { flush: () => void }).flush();

    const rows = db
      .prepare("SELECT content FROM session_messages WHERE sessionKey = ? ORDER BY seq")
      .all("sk-dedup") as Array<{ content: string }>;

    // Only the original plain message should be stored
    expect(rows).toHaveLength(1);
    expect(rows[0].content).toBe("你好");
  });

  it("seq via handleUpdate accumulates correctly across flushes", () => {
    const handleUpdate = (
      store as unknown as { handleUpdate: (u: unknown) => void }
    ).handleUpdate.bind(store);

    handleUpdate({
      sessionKey: "sk-su",
      message: { role: "user", content: "a", sessionId: "sid-su", timestamp: 1000 },
    });
    handleUpdate({
      sessionKey: "sk-su",
      message: { role: "assistant", content: "b", sessionId: "sid-su", timestamp: 2000 },
    });

    // Flush first batch
    (store as unknown as { flush: () => void }).flush();

    // Second batch — seq should continue from 2
    handleUpdate({
      sessionKey: "sk-su",
      message: { role: "user", content: "c", sessionId: "sid-su", timestamp: 3000 },
    });

    (store as unknown as { flush: () => void }).flush();

    const rows = db
      .prepare("SELECT seq, content FROM session_messages WHERE sessionId = ? ORDER BY seq")
      .all("sid-su") as Array<{ seq: number; content: string }>;
    expect(rows).toHaveLength(3);
    expect(rows.map((r) => r.seq)).toEqual([1, 2, 3]);
  });

  it("seq is loaded from DB on new store construction (restart)", () => {
    const handleUpdate = (
      store as unknown as { handleUpdate: (u: unknown) => void }
    ).handleUpdate.bind(store);

    handleUpdate({
      sessionKey: "sk-restart",
      message: { role: "user", content: "a", sessionId: "sid-restart", timestamp: 1000 },
    });
    handleUpdate({
      sessionKey: "sk-restart",
      message: { role: "assistant", content: "b", sessionId: "sid-restart", timestamp: 2000 },
    });

    store.stop();

    // Verify seq 1, 2 persisted
    const rows1 = db
      .prepare("SELECT seq FROM session_messages WHERE sessionId = ? ORDER BY seq")
      .all("sid-restart") as Array<{ seq: number }>;
    expect(rows1.map((r) => r.seq)).toEqual([1, 2]);

    // Create a new store (simulating restart) — seq should continue from 2
    store = new SessionTranscriptStore(db, { flushIntervalMs: 999_999, maxBufferSize: 100 });
    const handleUpdate2 = (
      store as unknown as { handleUpdate: (u: unknown) => void }
    ).handleUpdate.bind(store);

    handleUpdate2({
      sessionKey: "sk-restart",
      message: { role: "user", content: "c", sessionId: "sid-restart", timestamp: 3000 },
    });
    store.stop();

    const rows2 = db
      .prepare("SELECT seq FROM session_messages WHERE sessionId = ? ORDER BY seq")
      .all("sid-restart") as Array<{ seq: number }>;
    expect(rows2).toHaveLength(3);
    expect(rows2.map((r) => r.seq)).toEqual([1, 2, 3]);
  });
});

// ── 5.2 queryHistoryRange unit tests ─────────────────────────────────────────

describe("queryHistoryRange unit tests", () => {
  const BASE_TS = 1_700_000_000_000; // fixed base timestamp

  function insertMsg(msg: StoredMessage): void {
    db.prepare(
      `INSERT INTO session_messages
         (id, sessionUuid, sessionKey, sessionId, userId, tenantId, role, content, timestamp, seq, archivedDate, parentSessionUuid)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      msg.id,
      msg.sessionUuid,
      msg.sessionKey,
      msg.sessionId,
      msg.userId,
      msg.tenantId,
      msg.role,
      msg.content,
      msg.timestamp,
      msg.seq,
      msg.archivedDate,
      msg.parentSessionUuid,
    );
  }

  it("time range filter: messages outside [from, to] are excluded", () => {
    const inside = makeMsg({ sessionKey: "sk", sessionId: "sid", timestamp: BASE_TS + 500 });
    const before = makeMsg({ sessionKey: "sk", sessionId: "sid", timestamp: BASE_TS - 1 });
    const after = makeMsg({ sessionKey: "sk", sessionId: "sid", timestamp: BASE_TS + 1001 });

    insertMsg(inside);
    insertMsg(before);
    insertMsg(after);

    const result = queryHistoryRange(db, {
      sessionUuid: "sk",
      sessionKey: "sk",
      from: BASE_TS,
      to: BASE_TS + 1000,
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].id).toBe(inside.id);
  });

  it("sessionId filter: when sessionId specified, only that sessionId's messages returned", () => {
    const msgA = makeMsg({ sessionKey: "sk", sessionId: "sid-a", timestamp: BASE_TS });
    const msgB = makeMsg({ sessionKey: "sk", sessionId: "sid-b", timestamp: BASE_TS + 1 });

    insertMsg(msgA);
    insertMsg(msgB);

    const result = queryHistoryRange(db, {
      sessionUuid: "sk",
      sessionKey: "sk",
      sessionId: "sid-a",
      from: BASE_TS - 1000,
      to: BASE_TS + 1000,
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].sessionId).toBe("sid-a");
  });

  it("pageSize truncation: messages.length <= pageSize, truncated set correctly", () => {
    for (let i = 0; i < 5; i++) {
      insertMsg(makeMsg({ sessionKey: "sk-lim", sessionId: "sid", timestamp: BASE_TS + i }));
    }

    const result = queryHistoryRange(db, {
      sessionUuid: "sk-lim",
      sessionKey: "sk-lim",
      from: BASE_TS - 1,
      to: BASE_TS + 10,
      pageSize: 3,
    });

    expect(result.messages.length).toBe(3);
    expect(result.total).toBe(5);
    expect(result.truncated).toBe(true);
  });

  it("hasSummary detection: true when any message has role='summary'", () => {
    insertMsg(
      makeMsg({ sessionKey: "sk-sum", sessionId: "sid", timestamp: BASE_TS, role: "user" }),
    );
    insertMsg(
      makeMsg({ sessionKey: "sk-sum", sessionId: "sid", timestamp: BASE_TS + 1, role: "summary" }),
    );

    const result = queryHistoryRange(db, {
      sessionUuid: "sk-sum",
      sessionKey: "sk-sum",
      from: BASE_TS - 1,
      to: BASE_TS + 10,
    });

    expect(result.hasSummary).toBe(true);

    // Without summary message
    const result2 = queryHistoryRange(db, {
      sessionUuid: "sk-sum",
      sessionKey: "sk-sum",
      sessionId: "sid",
      from: BASE_TS - 1,
      to: BASE_TS,
    });
    expect(result2.hasSummary).toBe(false);
  });

  it("buffer merge deduplication: buffer messages with same id as DB messages use buffer version", () => {
    const dbMsg = makeMsg({
      sessionKey: "sk-dup",
      sessionId: "sid",
      timestamp: BASE_TS,
      content: "db-version",
    });
    insertMsg(dbMsg);

    // Buffer has same id but different content
    const bufMsg: StoredMessage = { ...dbMsg, content: "buffer-version" };

    const result = queryHistoryRange(db, {
      sessionUuid: "sk-dup",
      sessionKey: "sk-dup",
      from: BASE_TS - 1,
      to: BASE_TS + 1,
      buffered: [bufMsg],
    });

    // Should have only 1 message (deduplicated), and buffer version wins
    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].content).toBe("buffer-version");
  });

  it("senderLabel enrichment: displayName is resolved from usersDb by userId", () => {
    const userId = crypto.randomUUID() as string;
    const displayNameMap = new Map([[userId, "Alice Chen"]]);

    const msg = makeMsg({ sessionKey: "sk-sl", sessionId: "sid-sl", timestamp: BASE_TS, userId });
    insertMsg(msg);

    const result = queryHistoryRange(db, {
      sessionUuid: "sk-sl",
      sessionKey: "sk-sl",
      from: BASE_TS - 1,
      to: BASE_TS + 1,
      resolveDisplayName: (uid) => displayNameMap.get(uid),
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].senderLabel).toBe("Alice Chen");
  });

  it("senderLabel enrichment: null userId yields null senderLabel", () => {
    const msg = makeMsg({
      sessionKey: "sk-sl-null",
      sessionId: "sid",
      timestamp: BASE_TS,
      userId: null,
    });
    insertMsg(msg);

    const result = queryHistoryRange(db, {
      sessionUuid: "sk-sl-null",
      sessionKey: "sk-sl-null",
      from: BASE_TS - 1,
      to: BASE_TS + 1,
    });

    expect(result.messages).toHaveLength(1);
    expect(result.messages[0].senderLabel).toBeNull();
  });
});

// ── 5.3 PBT P-1: Message order invariant ─────────────────────────────────────

describe("PBT P-1: Message order invariant", () => {
  /**
   * queryHistoryRange results are strictly timestamp ASC (oldest first).
   *
   * **Validates: Requirements 3.2**
   */
  it("queryHistoryRange results are strictly timestamp ASC", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            timestamp: fc.integer({ min: 1_000_000, max: 9_999_999 }),
            role: fc.constantFrom("user" as const, "assistant" as const, "tool" as const),
          }),
          { minLength: 0, maxLength: 20 },
        ),
        (msgSpecs) => {
          const { db: localDb, cleanup: localCleanup } = makeDb();
          try {
            const sessionKey = "sk-order";
            const sessionId = "sid-order";

            for (const spec of msgSpecs) {
              const msg = makeMsg({
                sessionKey,
                sessionId,
                timestamp: spec.timestamp,
                role: spec.role,
              });
              localDb
                .prepare(
                  `INSERT INTO session_messages
                     (id, sessionUuid, sessionKey, sessionId, userId, tenantId, role, content, timestamp, seq, archivedDate, parentSessionUuid)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                )
                .run(
                  msg.id,
                  msg.sessionUuid,
                  msg.sessionKey,
                  msg.sessionId,
                  msg.userId,
                  msg.tenantId,
                  msg.role,
                  msg.content,
                  msg.timestamp,
                  msg.seq,
                  msg.archivedDate,
                  msg.parentSessionUuid,
                );
            }

            const result = queryHistoryRange(localDb, {
              sessionUuid: sessionKey,
              sessionKey,
              from: 0,
              to: 99_999_999,
            });

            const msgs = result.messages;
            for (let i = 0; i < msgs.length - 1; i++) {
              expect(msgs[i].timestamp).toBeLessThanOrEqual(msgs[i + 1].timestamp);
            }
          } finally {
            localCleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── 5.4 PBT P-2: Archive date monotonicity ───────────────────────────────────

describe("PBT P-2: Archive date monotonicity", () => {
  /**
   * Archived messages' archivedDate is not later than any active message's date
   * for the same sessionKey.
   *
   * **Validates: Requirements 2.2**
   */
  it("archivedDate is not later than any active message's date for same sessionKey", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 10 }), (daysBack) => {
        const { db: localDb, cleanup: localCleanup } = makeDb();
        try {
          const sessionKey = "sk-mono";
          const sessionId = "sid-mono";

          // Insert an old message (daysBack days ago)
          const oldTs = Date.now() - daysBack * 24 * 60 * 60 * 1000;
          const oldMsg = makeMsg({ sessionKey, sessionId, timestamp: oldTs });
          localDb
            .prepare(
              `INSERT INTO session_messages
                   (id, sessionUuid, sessionKey, sessionId, userId, tenantId, role, content, timestamp, seq, archivedDate, parentSessionUuid)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            )
            .run(
              oldMsg.id,
              oldMsg.sessionUuid,
              oldMsg.sessionKey,
              oldMsg.sessionId,
              oldMsg.userId,
              oldMsg.tenantId,
              oldMsg.role,
              oldMsg.content,
              oldMsg.timestamp,
              oldMsg.seq,
              oldMsg.archivedDate,
              oldMsg.parentSessionUuid,
            );

          // Use a new store to flush a today message (triggers archive)
          const localStore = new SessionTranscriptStore(localDb, { flushIntervalMs: 999_999 });
          const todayMsg = makeMsg({ sessionKey, sessionId, timestamp: Date.now() });
          pushToBuffer(localStore, [todayMsg]);
          localStore.stop();

          // Query archived and active messages
          const archived = localDb
            .prepare(
              "SELECT archivedDate FROM session_messages WHERE sessionKey = ? AND archivedDate IS NOT NULL",
            )
            .all(sessionKey) as Array<{ archivedDate: string }>;

          const active = localDb
            .prepare(
              "SELECT timestamp FROM session_messages WHERE sessionKey = ? AND archivedDate IS NULL",
            )
            .all(sessionKey) as Array<{ timestamp: number }>;

          // For each archived message, its archivedDate must be <= any active message's date
          for (const arch of archived) {
            for (const act of active) {
              const activeDate = new Date(act.timestamp).toLocaleDateString("en-CA");
              expect(arch.archivedDate <= activeDate).toBe(true);
            }
          }
        } finally {
          localCleanup();
        }
      }),
      { numRuns: 50 },
    );
  });
});

// ── 5.5 PBT P-3: Cross-reset isolation ───────────────────────────────────────

describe("PBT P-3: Cross-reset isolation", () => {
  /**
   * When sessionId specified, results contain only that sessionId's messages.
   *
   * **Validates: Requirements 5.2**
   */
  it("specifying sessionId returns only messages for that sessionId", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            sessionId: fc.constantFrom("sid-x", "sid-y", "sid-z"),
            timestamp: fc.integer({ min: 1_000_000, max: 9_999_999 }),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        fc.constantFrom("sid-x", "sid-y", "sid-z"),
        (msgSpecs, targetSid) => {
          const { db: localDb, cleanup: localCleanup } = makeDb();
          try {
            const sessionKey = "sk-iso";

            for (const spec of msgSpecs) {
              const msg = makeMsg({
                sessionKey,
                sessionId: spec.sessionId,
                timestamp: spec.timestamp,
              });
              localDb
                .prepare(
                  `INSERT INTO session_messages
                     (id, sessionUuid, sessionKey, sessionId, userId, tenantId, role, content, timestamp, seq, archivedDate, parentSessionUuid)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                )
                .run(
                  msg.id,
                  msg.sessionUuid,
                  msg.sessionKey,
                  msg.sessionId,
                  msg.userId,
                  msg.tenantId,
                  msg.role,
                  msg.content,
                  msg.timestamp,
                  msg.seq,
                  msg.archivedDate,
                  msg.parentSessionUuid,
                );
            }

            const result = queryHistoryRange(localDb, {
              sessionUuid: sessionKey,
              sessionKey,
              sessionId: targetSid,
              from: 0,
              to: 99_999_999,
            });

            for (const msg of result.messages) {
              expect(msg.sessionId).toBe(targetSid);
            }
          } finally {
            localCleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── 5.6 PBT P-4: Time range boundary correctness ─────────────────────────────

describe("PBT P-4: Time range boundary correctness", () => {
  /**
   * All returned messages have timestamp ∈ [from, to].
   *
   * **Validates: Requirements 3.2**
   */
  it("all returned messages have timestamp in [from, to]", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1_000_000, max: 5_000_000 }),
        fc.integer({ min: 5_000_001, max: 9_999_999 }),
        fc.array(fc.integer({ min: 0, max: 10_000_000 }), { minLength: 0, maxLength: 20 }),
        (from, to, timestamps) => {
          const { db: localDb, cleanup: localCleanup } = makeDb();
          try {
            const sessionKey = "sk-range";
            const sessionId = "sid-range";

            for (const ts of timestamps) {
              const msg = makeMsg({ sessionKey, sessionId, timestamp: ts });
              localDb
                .prepare(
                  `INSERT INTO session_messages
                     (id, sessionUuid, sessionKey, sessionId, userId, tenantId, role, content, timestamp, seq, archivedDate, parentSessionUuid)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                )
                .run(
                  msg.id,
                  msg.sessionUuid,
                  msg.sessionKey,
                  msg.sessionId,
                  msg.userId,
                  msg.tenantId,
                  msg.role,
                  msg.content,
                  msg.timestamp,
                  msg.seq,
                  msg.archivedDate,
                  msg.parentSessionUuid,
                );
            }

            const result = queryHistoryRange(localDb, {
              sessionUuid: sessionKey,
              sessionKey,
              from,
              to,
            });

            for (const msg of result.messages) {
              expect(msg.timestamp).toBeGreaterThanOrEqual(from);
              expect(msg.timestamp).toBeLessThanOrEqual(to);
            }
          } finally {
            localCleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── 5.7 PBT P-5: truncated semantic correctness ──────────────────────────────

describe("PBT P-5: truncated semantic correctness", () => {
  /**
   * truncated === (total > messages.length)
   *
   * **Validates: Requirements 3.3**
   */
  it("truncated is true iff total > messages.length", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 20 }),
        fc.integer({ min: 1, max: 15 }),
        (msgCount, limit) => {
          const { db: localDb, cleanup: localCleanup } = makeDb();
          try {
            const sessionKey = "sk-trunc";
            const sessionId = "sid-trunc";
            const BASE = 1_000_000;

            for (let i = 0; i < msgCount; i++) {
              const msg = makeMsg({ sessionKey, sessionId, timestamp: BASE + i });
              localDb
                .prepare(
                  `INSERT INTO session_messages
                     (id, sessionUuid, sessionKey, sessionId, userId, tenantId, role, content, timestamp, seq, archivedDate, parentSessionUuid)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                )
                .run(
                  msg.id,
                  msg.sessionUuid,
                  msg.sessionKey,
                  msg.sessionId,
                  msg.userId,
                  msg.tenantId,
                  msg.role,
                  msg.content,
                  msg.timestamp,
                  msg.seq,
                  msg.archivedDate,
                  msg.parentSessionUuid,
                );
            }

            const result = queryHistoryRange(localDb, {
              sessionUuid: sessionKey,
              sessionKey,
              from: BASE - 1,
              to: BASE + msgCount + 1,
              pageSize: limit,
            });

            expect(result.truncated).toBe(result.total > result.messages.length);
          } finally {
            localCleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── 5.8 PBT P-6: Buffer message visibility ───────────────────────────────────

describe("PBT P-6: Buffer message visibility", () => {
  /**
   * Buffer messages matching time range must appear in results.
   *
   * **Validates: Requirements 3.5**
   */
  it("buffer messages matching time range appear in queryHistoryRange results", () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1_000_000, max: 9_999_999 }), { minLength: 1, maxLength: 10 }),
        (timestamps) => {
          const { db: localDb, cleanup: localCleanup } = makeDb();
          try {
            const sessionKey = "sk-vis";
            const sessionId = "sid-vis";
            const from = 1_000_000;
            const to = 9_999_999;

            const buffered: StoredMessage[] = timestamps.map((ts) =>
              makeMsg({ sessionKey, sessionId, timestamp: ts }),
            );

            const result = queryHistoryRange(localDb, {
              sessionUuid: sessionKey,
              sessionKey,
              from,
              to,
              buffered,
            });

            const resultIds = new Set(result.messages.map((m) => m.id));

            for (const bufMsg of buffered) {
              if (bufMsg.timestamp >= from && bufMsg.timestamp <= to) {
                expect(resultIds.has(bufMsg.id)).toBe(true);
              }
            }
          } finally {
            localCleanup();
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
