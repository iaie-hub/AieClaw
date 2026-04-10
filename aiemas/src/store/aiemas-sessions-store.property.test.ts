/**
 * Property-based tests for aiemas-sessions-store.
 *
 * Feature: a2a-session-cascade
 * Property 5: Session 记录往返一致性
 * Property 9: 查询结果字段完整性
 *
 * Validates: Requirements 5, 9
 */

import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as fc from "fast-check";
import { describe, it, expect, afterEach } from "vitest";
import { createAiemasSessionsStore } from "./aiemas-sessions-store.js";
import { initDatabase } from "./database.js";

// ---------------------------------------------------------------------------
// Temp DB helpers
// ---------------------------------------------------------------------------

const tempPaths: string[] = [];

function tmpDbPath(): string {
  const p = join(tmpdir(), `aiemas-sessions-prop-${randomUUID()}`, "mas4s.db");
  tempPaths.push(p);
  return p;
}

afterEach(() => {
  for (const p of tempPaths.splice(0)) {
    try {
      rmSync(join(p, ".."), { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
});

// ---------------------------------------------------------------------------
// Arbitraries (as specified in the task)
// ---------------------------------------------------------------------------

const arbAgentId = fc.stringMatching(/^[a-z][a-z0-9-]{0,19}$/);
const arbSessionUuid = fc.stringMatching(/^mas-[a-f0-9]{8}$/);
const arbUserId = fc.stringMatching(/^user-[a-z0-9]{4,8}$/);
const arbTenantId = fc.stringMatching(/^tenant-[a-z0-9]{4,8}$/);
const arbLabel = fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined });
const arbDescendantSession = fc.record({
  agentId: arbAgentId,
  sessionKey: fc.string({ minLength: 10, maxLength: 50 }),
  sessionId: fc.string({ minLength: 5, maxLength: 30 }),
});

// ---------------------------------------------------------------------------
// Property 5: Session 记录往返一致性
// Validates: Requirements 1.7, 9.4
// ---------------------------------------------------------------------------

describe("Feature: a2a-session-cascade, Property 5: Session record round-trip consistency", () => {
  it("saveRootSession then loadRootSession returns semantically equivalent record", () => {
    /**
     * **Validates: Requirements 1.7, 9.4**
     *
     * For any valid root Agent session params (agentId, userId, tenantId, label),
     * calling saveRootSession then loadRootSession returns a record semantically
     * equivalent to what was saved.
     * Fields verified: sessionKey, agentId, userId, tenantId, label, descendantSessions.
     */
    fc.assert(
      fc.property(
        arbAgentId,
        arbSessionUuid,
        arbUserId,
        arbTenantId,
        arbLabel,
        fc.array(arbDescendantSession, { minLength: 0, maxLength: 5 }),
        (agentId, sessionUuid, userId, tenantId, label, descendantSessions) => {
          const dbPath = tmpDbPath();
          const db = initDatabase(dbPath);
          const store = createAiemasSessionsStore(db);

          const sessionKey = `agent:${agentId}:group:${sessionUuid}`;
          const sessionId = `sess-${randomUUID().slice(0, 8)}`;

          store.saveRootSession({
            sessionKey,
            sessionId,
            agentId,
            sessionUuid,
            label,
            userId,
            tenantId,
            descendantSessions,
          });

          const loaded = store.loadRootSession(sessionKey);

          expect(loaded).toBeDefined();
          expect(loaded!.sessionKey).toBe(sessionKey);
          expect(loaded!.agentId).toBe(agentId);
          expect(loaded!.userId).toBe(userId);
          expect(loaded!.tenantId).toBe(tenantId);
          expect(loaded!.label).toBe(label);
          expect(loaded!.descendantSessions).toEqual(descendantSessions);

          db.close();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("loadRootSession returns undefined for a key that was never saved", () => {
    fc.assert(
      fc.property(arbAgentId, arbSessionUuid, (agentId, sessionUuid) => {
        const dbPath = tmpDbPath();
        const db = initDatabase(dbPath);
        const store = createAiemasSessionsStore(db);

        const sessionKey = `agent:${agentId}:group:${sessionUuid}`;
        const result = store.loadRootSession(sessionKey);

        expect(result).toBeUndefined();

        db.close();
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 9: 查询结果字段完整性
// Validates: Requirements 8.3, 8.4, 8.5
// ---------------------------------------------------------------------------

describe("Feature: a2a-session-cascade, Property 9: Query result field completeness", () => {
  it("every record returned by listRootSessions contains all required fields with consistent values", () => {
    /**
     * **Validates: Requirements 8.3, 8.4, 8.5**
     *
     * For any query request, every returned session record contains all required
     * fields (sessionKey, agentId, sessionUuid, label, userId, tenantId, createdAt)
     * with values consistent with what was stored.
     */
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            agentId: arbAgentId,
            sessionUuid: arbSessionUuid,
            userId: arbUserId,
            tenantId: arbTenantId,
            label: arbLabel,
          }),
          { minLength: 1, maxLength: 5 },
        ),
        (entries) => {
          const dbPath = tmpDbPath();
          const db = initDatabase(dbPath);
          const store = createAiemasSessionsStore(db);

          // Build unique sessionKeys to avoid primary key conflicts
          const saved: Array<{
            sessionKey: string;
            sessionId: string;
            agentId: string;
            sessionUuid: string;
            label: string | undefined;
            userId: string;
            tenantId: string;
          }> = [];

          const usedKeys = new Set<string>();
          for (const entry of entries) {
            const sessionKey = `agent:${entry.agentId}:group:${entry.sessionUuid}`;
            if (usedKeys.has(sessionKey)) {
              continue;
            }
            usedKeys.add(sessionKey);

            const sessionId = `sess-${randomUUID().slice(0, 8)}`;
            store.saveRootSession({
              sessionKey,
              sessionId,
              agentId: entry.agentId,
              sessionUuid: entry.sessionUuid,
              label: entry.label,
              userId: entry.userId,
              tenantId: entry.tenantId,
              descendantSessions: [],
            });
            saved.push({ sessionKey, sessionId, ...entry });
          }

          const results = store.listRootSessions();

          // Every returned record must have all required fields
          for (const record of results) {
            expect(record.sessionKey).toBeDefined();
            expect(typeof record.sessionKey).toBe("string");
            expect(record.sessionKey.length).toBeGreaterThan(0);

            expect(record.agentId).toBeDefined();
            expect(typeof record.agentId).toBe("string");
            expect(record.agentId.length).toBeGreaterThan(0);

            expect(record.sessionUuid).toBeDefined();
            expect(typeof record.sessionUuid).toBe("string");
            expect(record.sessionUuid.length).toBeGreaterThan(0);

            expect(record.userId).toBeDefined();
            expect(typeof record.userId).toBe("string");
            expect(record.userId.length).toBeGreaterThan(0);

            expect(record.tenantId).toBeDefined();
            expect(typeof record.tenantId).toBe("string");
            expect(record.tenantId.length).toBeGreaterThan(0);

            expect(record.createdAt).toBeDefined();
            expect(typeof record.createdAt).toBe("number");
            expect(record.createdAt).toBeGreaterThan(0);

            // label may be undefined (optional field) — just verify it's not null
            expect(record.label).not.toBeNull();
          }

          // Every saved record must appear in results with consistent field values
          for (const s of saved) {
            const found = results.find((r) => r.sessionKey === s.sessionKey);
            expect(found).toBeDefined();
            expect(found!.agentId).toBe(s.agentId);
            expect(found!.sessionUuid).toBe(s.sessionUuid);
            expect(found!.userId).toBe(s.userId);
            expect(found!.tenantId).toBe(s.tenantId);
            expect(found!.label).toBe(s.label);
          }

          db.close();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("listRootSessions returns empty array when no sessions have been saved", () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const dbPath = tmpDbPath();
        const db = initDatabase(dbPath);
        const store = createAiemasSessionsStore(db);

        const results = store.listRootSessions();
        expect(results).toEqual([]);

        db.close();
      }),
      { numRuns: 100 },
    );
  });
});
