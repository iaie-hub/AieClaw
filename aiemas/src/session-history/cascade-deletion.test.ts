import type { DatabaseSync } from "node:sqlite";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestMessageDatabase } from "../test-helpers/setup.js";
import { deleteSessionMessages, upsertSummary } from "./session-summary-store.js";
import { SessionTranscriptStore } from "./session-transcript-store.js";

describe("Cascading Subagent Deletion Integration Tests", () => {
  let db: DatabaseSync;
  let cleanup: () => void;
  let store: SessionTranscriptStore;

  function makeDb(): { db: DatabaseSync; cleanup: () => void } {
    return createTestMessageDatabase();
  }

  beforeEach(() => {
    const result = makeDb();
    db = result.db;
    cleanup = result.cleanup;
    store = new SessionTranscriptStore(db, { flushIntervalMs: 999_999, maxBufferSize: 100 });
  });

  afterEach(() => {
    store.stop();
    cleanup();
  });

  it("cascading deletion: deleting parent session also deletes all child subagent messages and statistics", () => {
    const parentUuid = "parent-uuid-123";
    const sub1Uuid = "child-subagent-456";
    const sub2Uuid = "child-subagent-789";

    // 1. Manually insert some messages to simulate parent and sub-agents
    const now = Date.now();

    // Insert parent messages
    db.prepare(`
      INSERT INTO session_messages (id, sessionUuid, sessionKey, sessionId, role, content, timestamp, seq)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run("m1", parentUuid, "parent-k", "parent-sid", "user", "Hello subagent", now, 1);

    // Insert sub-agent 1 messages (linked to parent)
    db.prepare(`
      INSERT INTO session_messages (id, sessionUuid, sessionKey, sessionId, role, content, timestamp, seq, parentSessionUuid)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("m2", sub1Uuid, "sub1-k", "sub1-sid", "assistant", "I am sub1", now + 10, 1, parentUuid);

    // Insert sub-agent 2 messages (linked to parent)
    db.prepare(`
      INSERT INTO session_messages (id, sessionUuid, sessionKey, sessionId, role, content, timestamp, seq, parentSessionUuid)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run("m3", sub2Uuid, "sub2-k", "sub2-sid", "assistant", "I am sub2", now + 20, 1, parentUuid);

    // Insert some statistics
    db.prepare(`
      INSERT INTO session_msg_statistic (sessionUuid, sessionKey, sessionId, firstMsgAt, lastMsgAt, msgCount, parentSessionUuid)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(parentUuid, "parent-k", "parent-sid", now, now, 1, null);

    db.prepare(`
      INSERT INTO session_msg_statistic (sessionUuid, sessionKey, sessionId, firstMsgAt, lastMsgAt, msgCount, parentSessionUuid)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(sub1Uuid, "sub1-k", "sub1-sid", now + 10, now + 10, 1, parentUuid);

    // 2. Verify they exist
    const countMsgsBefore = (
      db.prepare("SELECT COUNT(*) as c FROM session_messages").get() as { c: number }
    ).c;
    const countStatsBefore = (
      db.prepare("SELECT COUNT(*) as c FROM session_msg_statistic").get() as { c: number }
    ).c;
    expect(countMsgsBefore).toBe(3);
    expect(countStatsBefore).toBe(2);

    // 3. Perform cascading deletion of parent
    deleteSessionMessages(db, parentUuid);

    // 4. Verify ALL are gone
    const countMsgsAfter = (
      db.prepare("SELECT COUNT(*) as c FROM session_messages").get() as { c: number }
    ).c;
    const countStatsAfter = (
      db.prepare("SELECT COUNT(*) as c FROM session_msg_statistic").get() as { c: number }
    ).c;
    expect(countMsgsAfter).toBe(0);
    expect(countStatsAfter).toBe(0);
  });

  it("summary cascading deletion: upserting parent summary with children and then deleting parent summary removes child messages", () => {
    const parentUuid = "sum-parent-uuid";
    const subUuid = "sum-child-uuid";
    const now = Date.now();

    // Insert child message
    db.prepare(`
      INSERT INTO session_messages (id, sessionUuid, sessionKey, sessionId, role, content, timestamp, seq, parentSessionUuid)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "sum-m1",
      subUuid,
      "sum-child-k",
      "sum-child-sid",
      "assistant",
      "child content",
      now,
      1,
      parentUuid,
    );

    // Upsert parent summary
    upsertSummary(db, {
      sessionUuid: parentUuid,
      sessionKey: "sum-parent-k",
      sessionId: "sum-parent-sid",
      textSummary: "parent summary txt",
      toolSummary: null,
      generatedAt: now,
      generatedBy: "agent",
    });

    // Verify they exist
    expect(
      (db.prepare("SELECT COUNT(*) as c FROM session_summaries").get() as { c: number }).c,
    ).toBe(1);
    expect(
      (
        db
          .prepare("SELECT COUNT(*) as c FROM session_messages WHERE sessionUuid = ?")
          .get(subUuid) as { c: number }
      ).c,
    ).toBe(1);

    // Delete parent session (via summary store logic)
    deleteSessionMessages(db, parentUuid);

    // Verify both are gone
    expect(
      (db.prepare("SELECT COUNT(*) as c FROM session_summaries").get() as { c: number }).c,
    ).toBe(0);
    expect(
      (db.prepare("SELECT COUNT(*) as c FROM session_messages").get() as { c: number }).c,
    ).toBe(0);
  });
});
