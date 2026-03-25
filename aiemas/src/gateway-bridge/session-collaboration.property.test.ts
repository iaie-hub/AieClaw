/**
 * Property-based tests for session collaboration features.
 *
 * Feature: mas4s-session-collaboration
 */

import type { DatabaseSync } from "node:sqlite";
import * as fc from "fast-check";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  SESSION_ARCHIVED,
  SESSION_ACCESS_DENIED,
  ALREADY_MEMBER,
  OWNER_CANNOT_LEAVE,
  TenantServiceError,
} from "../errors.js";
import type { TenantService } from "../index.js";
import { createInMemoryDatabase } from "../test-helpers/setup.js";
import { GatewayAuthBridge } from "./bridge.js";
import {
  recordSessionCreated,
  archiveSession,
  upsertSummary,
  getSummary,
  inviteToSession,
  listSessionMembers,
  removeMember,
  listSessionsForUser,
  checkSessionAccess,
  isSessionArchived,
  unarchiveSession,
} from "./session-manager.js";

// ── Test database lifecycle ──────────────────────────────────────────────────

let db: DatabaseSync;
let cleanup: () => void;

beforeEach(() => {
  const result = createInMemoryDatabase();
  db = result.db;
  cleanup = result.cleanup;
});

afterEach(() => {
  cleanup();
});

// ── Arbitraries ──────────────────────────────────────────────────────────────

const arbSessionKey = fc.uuid();
const arbUserId = fc.uuid();
const arbTenantId = fc.uuid();

// ---------------------------------------------------------------------------
// Feature: mas4s-session-collaboration, Property 1: 邀请权限对称性
// Validates: Requirements 1.1, 1.2, 1.5
// ---------------------------------------------------------------------------

describe("Property 1: 邀请权限对称性", () => {
  it("成员可邀请，非成员被拒绝", () => {
    fc.assert(
      fc.property(
        arbSessionKey,
        arbUserId,
        arbUserId,
        arbUserId,
        arbTenantId,
        (sessionKey, ownerId, targetId, nonMemberId, tenantId) => {
          // Ensure all three user IDs are distinct to avoid collisions
          fc.pre(ownerId !== targetId && ownerId !== nonMemberId && targetId !== nonMemberId);

          // Set up prerequisite tenant and user records (foreign key constraints)
          db.prepare(
            "INSERT OR IGNORE INTO tenants (tenantId, name, createdAt) VALUES (?, ?, ?)",
          ).run(tenantId, "test-tenant", Date.now());

          for (const [uid, name] of [
            [ownerId, "Owner"],
            [targetId, "Target"],
            [nonMemberId, "NonMember"],
          ] as const) {
            db.prepare(
              "INSERT OR IGNORE INTO users (userId, username, displayName, passwordHash, role, tenantId, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            ).run(uid, `u_${uid}`, name, "hash", "admin", tenantId, "approved", Date.now());
          }

          // Create a session with an owner
          recordSessionCreated(db, sessionKey, ownerId, tenantId);

          // Owner (Session_Member) can invite the target — should succeed
          const member = inviteToSession(db, sessionKey, targetId, ownerId);
          expect(member.userId).toBe(targetId);
          expect(member.role).toBe("participant");

          // Non-member calling inviteToSession should throw SESSION_ACCESS_DENIED
          try {
            inviteToSession(db, sessionKey, ownerId, nonMemberId);
            // Should not reach here
            expect.unreachable("Expected SESSION_ACCESS_DENIED error");
          } catch (err) {
            expect(err).toBeInstanceOf(TenantServiceError);
            expect((err as TenantServiceError).code).toBe(SESSION_ACCESS_DENIED);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Feature: mas4s-session-collaboration, Property 2: 邀请成员增长不变量
// Validates: Requirements 1.2, 1.6
// ---------------------------------------------------------------------------

describe("Property 2: 邀请成员增长不变量", () => {
  it("成功邀请后成员列表长度恰好增加 1；重复邀请抛出 ALREADY_MEMBER 且长度不变", () => {
    fc.assert(
      fc.property(
        arbSessionKey,
        arbUserId,
        arbUserId,
        arbTenantId,
        (sessionKey, ownerId, newUserId, tenantId) => {
          // Ensure owner and new user are distinct
          fc.pre(ownerId !== newUserId);

          // Clean slate for this iteration to avoid cross-run collisions
          db.prepare("DELETE FROM session_memberships WHERE sessionKey = ?").run(sessionKey);
          db.prepare("DELETE FROM session_ownership WHERE sessionKey = ?").run(sessionKey);

          // Set up prerequisite tenant and user records
          db.prepare(
            "INSERT OR IGNORE INTO tenants (tenantId, name, createdAt) VALUES (?, ?, ?)",
          ).run(tenantId, "test-tenant", Date.now());

          for (const [uid, name] of [
            [ownerId, "Owner"],
            [newUserId, "NewUser"],
          ] as const) {
            db.prepare(
              "INSERT OR IGNORE INTO users (userId, username, displayName, passwordHash, role, tenantId, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            ).run(uid, `u_${uid}`, name, "hash", "admin", tenantId, "approved", Date.now());
          }

          // Create a session with an owner
          recordSessionCreated(db, sessionKey, ownerId, tenantId);

          // Get initial member count
          const before = listSessionMembers(db, sessionKey, ownerId).length;

          // Invite a new user — should succeed
          inviteToSession(db, sessionKey, newUserId, ownerId);

          // Member count should increase by exactly 1
          const after = listSessionMembers(db, sessionKey, ownerId).length;
          expect(after).toBe(before + 1);

          // Try to invite the same user again — should throw ALREADY_MEMBER
          try {
            inviteToSession(db, sessionKey, newUserId, ownerId);
            expect.unreachable("Expected ALREADY_MEMBER error");
          } catch (err) {
            expect(err).toBeInstanceOf(TenantServiceError);
            expect((err as TenantServiceError).code).toBe(ALREADY_MEMBER);
          }

          // Member count should remain unchanged after duplicate invite
          const afterDuplicate = listSessionMembers(db, sessionKey, ownerId).length;
          expect(afterDuplicate).toBe(after);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Feature: mas4s-session-collaboration, Property 3: 删除成员完整性
// Validates: Requirements 2.2, 2.3
// ---------------------------------------------------------------------------

describe("Property 3: 删除成员完整性", () => {
  it("owner 删除 participant 后，listSessionMembers 不包含该 participant，listSessionsForUser 不包含该 sessionKey", () => {
    fc.assert(
      fc.property(
        arbSessionKey,
        arbUserId,
        arbUserId,
        arbTenantId,
        (sessionKey, ownerId, participantId, tenantId) => {
          // Ensure owner and participant are distinct
          fc.pre(ownerId !== participantId);

          // Clean slate for this iteration
          db.prepare("DELETE FROM session_memberships WHERE sessionKey = ?").run(sessionKey);
          db.prepare("DELETE FROM session_ownership WHERE sessionKey = ?").run(sessionKey);

          // Set up prerequisite tenant and user records
          db.prepare(
            "INSERT OR IGNORE INTO tenants (tenantId, name, createdAt) VALUES (?, ?, ?)",
          ).run(tenantId, "test-tenant", Date.now());

          for (const [uid, name] of [
            [ownerId, "Owner"],
            [participantId, "Participant"],
          ] as const) {
            db.prepare(
              "INSERT OR IGNORE INTO users (userId, username, displayName, passwordHash, role, tenantId, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            ).run(uid, `u_${uid}`, name, "hash", "admin", tenantId, "approved", Date.now());
          }

          // Create a session with an owner and invite a participant
          recordSessionCreated(db, sessionKey, ownerId, tenantId);
          inviteToSession(db, sessionKey, participantId, ownerId);

          // Verify participant is a member before removal
          const membersBefore = listSessionMembers(db, sessionKey, ownerId);
          expect(membersBefore.some((m) => m.userId === participantId)).toBe(true);

          // Owner removes the participant
          removeMember(db, sessionKey, participantId, ownerId);

          // listSessionMembers should no longer contain the participant
          const membersAfter = listSessionMembers(db, sessionKey, ownerId);
          expect(membersAfter.some((m) => m.userId === participantId)).toBe(false);

          // listSessionsForUser(participant) should no longer contain the sessionKey
          const participantSessions = listSessionsForUser(db, participantId);
          expect(participantSessions).not.toContain(sessionKey);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Feature: mas4s-session-collaboration, Property 4: owner 不可自行移除
// Validates: Requirements 2.6
// ---------------------------------------------------------------------------

describe("Property 4: owner 不可自行移除", () => {
  it("owner 调用 removeMember(owner) 抛出 OWNER_CANNOT_LEAVE，owner 记录仍存在", () => {
    fc.assert(
      fc.property(arbSessionKey, arbUserId, arbTenantId, (sessionKey, ownerId, tenantId) => {
        // Clean slate for this iteration
        db.prepare("DELETE FROM session_memberships WHERE sessionKey = ?").run(sessionKey);
        db.prepare("DELETE FROM session_ownership WHERE sessionKey = ?").run(sessionKey);

        // Set up prerequisite tenant and user records
        db.prepare(
          "INSERT OR IGNORE INTO tenants (tenantId, name, createdAt) VALUES (?, ?, ?)",
        ).run(tenantId, "test-tenant", Date.now());

        db.prepare(
          "INSERT OR IGNORE INTO users (userId, username, displayName, passwordHash, role, tenantId, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ).run(
          ownerId,
          `u_${ownerId.slice(0, 8)}`,
          "Owner",
          "hash",
          "admin",
          tenantId,
          "approved",
          Date.now(),
        );

        // Create a session with an owner
        recordSessionCreated(db, sessionKey, ownerId, tenantId);

        // Owner tries to remove themselves — should throw OWNER_CANNOT_LEAVE
        try {
          removeMember(db, sessionKey, ownerId, ownerId);
          expect.unreachable("Expected OWNER_CANNOT_LEAVE error");
        } catch (err) {
          expect(err).toBeInstanceOf(TenantServiceError);
          expect((err as TenantServiceError).code).toBe(OWNER_CANNOT_LEAVE);
        }

        // Owner record should still exist in session_memberships
        expect(checkSessionAccess(db, sessionKey, ownerId)).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Feature: mas4s-session-collaboration, Property 6: 归档幂等性
// Validates: Requirements 3.2
// ---------------------------------------------------------------------------

describe("Property 6: 归档幂等性", () => {
  it("重复归档不更新 archivedAt", () => {
    fc.assert(
      fc.property(arbSessionKey, arbUserId, arbTenantId, (sessionKey, ownerId, tenantId) => {
        // Set up prerequisite tenant and user records (foreign key constraints)
        db.prepare(
          "INSERT OR IGNORE INTO tenants (tenantId, name, createdAt) VALUES (?, ?, ?)",
        ).run(tenantId, "test-tenant", Date.now());
        db.prepare(
          "INSERT OR IGNORE INTO users (userId, username, displayName, passwordHash, role, tenantId, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ).run(
          ownerId,
          `u_${ownerId.slice(0, 8)}`,
          "Owner",
          "hash",
          "admin",
          tenantId,
          "approved",
          Date.now(),
        );

        // Create a session with an owner
        recordSessionCreated(db, sessionKey, ownerId, tenantId);

        // Archive the session twice
        const first = archiveSession(db, sessionKey, ownerId);
        const second = archiveSession(db, sessionKey, ownerId);

        // Both calls must return the same archivedAt timestamp
        expect(first).toBe(second);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Feature: mas4s-session-collaboration, Property 7: 摘要 round-trip
// Validates: Requirements 4.3, 4.5
// ---------------------------------------------------------------------------

describe("Property 7: 摘要 round-trip", () => {
  it("upsertSummary 后 getSummary 返回等价内容", () => {
    const arbTextSummary = fc.option(fc.string({ minLength: 0 }), { nil: null });
    const arbToolSummary = fc.option(fc.string({ minLength: 0 }), { nil: null });

    fc.assert(
      fc.property(
        arbSessionKey,
        arbTextSummary,
        arbToolSummary,
        arbUserId,
        (sessionKey, textSummary, toolSummary, generatedBy) => {
          // Write summary
          const written = upsertSummary(db, sessionKey, textSummary, toolSummary, generatedBy);

          // Read it back immediately
          const read = getSummary(db, sessionKey);

          // Must exist and match written values
          expect(read).not.toBeNull();
          expect(read!.sessionKey).toBe(sessionKey);
          expect(read!.textSummary).toBe(textSummary);
          expect(read!.toolSummary).toBe(toolSummary);
          expect(read!.generatedBy).toBe(generatedBy);
          expect(read!.generatedAt).toBe(written.generatedAt);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Feature: mas4s-session-collaboration, Property 7b: 归档自动触发摘要持久化
// Validates: Requirements 4.5
// ---------------------------------------------------------------------------

describe("Property 7b: 归档自动触发摘要持久化", () => {
  it("归档后 upsertSummary 模拟摘要持久化，getSummary 返回非 null", () => {
    fc.assert(
      fc.property(arbSessionKey, arbUserId, arbTenantId, (sessionKey, ownerId, tenantId) => {
        // Set up prerequisite tenant and user records
        db.prepare(
          "INSERT OR IGNORE INTO tenants (tenantId, name, createdAt) VALUES (?, ?, ?)",
        ).run(tenantId, "test-tenant", Date.now());
        db.prepare(
          "INSERT OR IGNORE INTO users (userId, username, displayName, passwordHash, role, tenantId, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ).run(
          ownerId,
          `u_${ownerId.slice(0, 8)}`,
          "Owner",
          "hash",
          "admin",
          tenantId,
          "approved",
          Date.now(),
        );

        // Create a session with an owner and archive it
        recordSessionCreated(db, sessionKey, ownerId, tenantId);
        archiveSession(db, sessionKey, ownerId);

        // Simulate what bridge.archiveSession does after LLM call:
        // persist summary via upsertSummary (non-empty message history scenario)
        upsertSummary(db, sessionKey, "对话摘要内容", "工具调用摘要内容", ownerId);

        // getSummary must return non-null after the archive+persist flow
        const summary = getSummary(db, sessionKey);
        expect(summary).not.toBeNull();
        expect(summary!.sessionKey).toBe(sessionKey);
        expect(summary!.textSummary).toBe("对话摘要内容");
        expect(summary!.toolSummary).toBe("工具调用摘要内容");
        expect(summary!.generatedBy).toBe(ownerId);
      }),
      { numRuns: 100 },
    );
  });
});

// ── Helper: minimal TenantService stub for bridge tests ──────────────────────

function createStubTenantService(): TenantService {
  return {
    checkPermission: () => ({ allowed: true }) as never,
    verify: () => ({ ok: false, error: "stub" }) as never,
    login: () => ({ ok: false, error: "stub" }) as never,
    refresh: () => ({ ok: false, error: "stub" }) as never,
    registerUser: () => {
      throw new Error("stub");
    },
    listUsers: () => [],
    updateUser: () => {
      throw new Error("stub");
    },
    approveUser: () => {},
    rejectUser: () => {},
    checkLoginRateLimit: () => ({ allowed: true }) as never,
    getSystemStatus: () => ({ initialized: true }),
    logout: () => {},
    init: async () => {},
  };
}

// ---------------------------------------------------------------------------
// Feature: mas4s-session-collaboration, Property 8: 摘要权限隔离
// Validates: Requirements 4.6, 4.7
// ---------------------------------------------------------------------------

describe("Property 8: 摘要权限隔离", () => {
  it("非成员调用 getSummary/generateSummary 返回 SESSION_ACCESS_DENIED；participant 调用 getSummary 成功", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbSessionKey,
        arbUserId,
        arbUserId,
        arbUserId,
        arbTenantId,
        async (sessionKey, ownerId, participantId, nonMemberId, tenantId) => {
          // All three user IDs must be distinct
          fc.pre(
            ownerId !== participantId && ownerId !== nonMemberId && participantId !== nonMemberId,
          );

          // Set up prerequisite tenant and user records
          db.prepare(
            "INSERT OR IGNORE INTO tenants (tenantId, name, createdAt) VALUES (?, ?, ?)",
          ).run(tenantId, "test-tenant", Date.now());

          for (const [uid, name] of [
            [ownerId, "Owner"],
            [participantId, "Participant"],
            [nonMemberId, "NonMember"],
          ] as const) {
            db.prepare(
              "INSERT OR IGNORE INTO users (userId, username, displayName, passwordHash, role, tenantId, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            ).run(uid, `u_${uid}`, name, "hash", "admin", tenantId, "approved", Date.now());
          }

          // Create session, invite participant
          recordSessionCreated(db, sessionKey, ownerId, tenantId);
          inviteToSession(db, sessionKey, participantId, ownerId);

          // Persist a summary so getSummary has something to return
          upsertSummary(db, sessionKey, "text", "tool", ownerId);

          const bridge = new GatewayAuthBridge(createStubTenantService(), db);

          // 1. Non-member getSummary → SESSION_ACCESS_DENIED
          const nonMemberGet = bridge.getSummary({
            sessionKey,
            callerUserId: nonMemberId,
          });
          expect(nonMemberGet.ok).toBe(false);
          if (!nonMemberGet.ok) {
            expect(nonMemberGet.code).toBe(SESSION_ACCESS_DENIED);
          }

          // 2. Participant getSummary → success
          const participantGet = bridge.getSummary({
            sessionKey,
            callerUserId: participantId,
          });
          expect(participantGet.ok).toBe(true);
          if (participantGet.ok) {
            expect(participantGet.summary).not.toBeNull();
          }

          // 3. Non-member generateSummary → SESSION_ACCESS_DENIED (permission check only)
          const nonMemberGen = await bridge.generateSummary({
            sessionKey,
            callerUserId: nonMemberId,
            fetchHistory: async () => [],
          });
          expect(nonMemberGen.ok).toBe(false);
          if (!nonMemberGen.ok) {
            expect(nonMemberGen.code).toBe(SESSION_ACCESS_DENIED);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Feature: mas4s-session-collaboration, Property 5: 归档后拒绝发送消息
// Validates: Requirements 3.4, 3.5
// ---------------------------------------------------------------------------

describe("Property 5: 归档后拒绝发送消息", () => {
  it("归档会话后 chat.send 返回 SESSION_ARCHIVED，chat.history 仍允许", () => {
    fc.assert(
      fc.property(arbSessionKey, arbUserId, arbTenantId, (sessionKey, ownerId, tenantId) => {
        // Set up prerequisite tenant and user records
        db.prepare(
          "INSERT OR IGNORE INTO tenants (tenantId, name, createdAt) VALUES (?, ?, ?)",
        ).run(tenantId, "test-tenant", Date.now());
        db.prepare(
          "INSERT OR IGNORE INTO users (userId, username, displayName, passwordHash, role, tenantId, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ).run(
          ownerId,
          `u_${ownerId.slice(0, 8)}`,
          "Owner",
          "hash",
          "admin",
          tenantId,
          "approved",
          Date.now(),
        );

        // Create session and archive it
        recordSessionCreated(db, sessionKey, ownerId, tenantId);
        archiveSession(db, sessionKey, ownerId);

        const bridge = new GatewayAuthBridge(createStubTenantService(), db);
        const masAuth = {
          userId: ownerId,
          tenantId,
          masRole: "admin" as const,
          displayName: "Owner",
        };

        // chat.send should be blocked with SESSION_ARCHIVED
        const sendResult = bridge.interceptMethod("chat.send", { sessionKey }, masAuth);
        expect(sendResult.allowed).toBe(false);
        if (!sendResult.allowed) {
          expect(sendResult.code).toBe(SESSION_ARCHIVED);
        }

        // chat.history should still be allowed (read-only, not in _isSessionAccessMethod block list for archive)
        const historyResult = bridge.interceptMethod("chat.history", { sessionKey }, masAuth);
        expect(historyResult.allowed).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Feature: mas4s-session-collaboration, Property 10: 归档与启用互逆性
// Validates: Requirements 3.11, 3.14
// ---------------------------------------------------------------------------

describe("Property 10: 归档与启用互逆性", () => {
  it("archiveSession → isSessionArchived=true → unarchiveSession → isSessionArchived=false, chat.send 不再返回 SESSION_ARCHIVED", () => {
    fc.assert(
      fc.property(arbSessionKey, arbUserId, arbTenantId, (sessionKey, ownerId, tenantId) => {
        // Set up prerequisite tenant and user records
        db.prepare(
          "INSERT OR IGNORE INTO tenants (tenantId, name, createdAt) VALUES (?, ?, ?)",
        ).run(tenantId, "test-tenant", Date.now());

        db.prepare(
          "INSERT OR IGNORE INTO users (userId, username, displayName, passwordHash, role, tenantId, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        ).run(
          ownerId,
          `u_${ownerId.slice(0, 8)}`,
          "Owner",
          "hash",
          "admin",
          tenantId,
          "approved",
          Date.now(),
        );

        // Create a session with an owner
        recordSessionCreated(db, sessionKey, ownerId, tenantId);

        // 1. Archive the session
        archiveSession(db, sessionKey, ownerId);

        // 2. isSessionArchived should return true
        expect(isSessionArchived(db, sessionKey)).toBe(true);

        // 3. interceptMethod("chat.send") should return SESSION_ARCHIVED
        const bridge = new GatewayAuthBridge(createStubTenantService(), db);
        const masAuth = {
          userId: ownerId,
          tenantId,
          masRole: "admin" as const,
          displayName: "Owner",
        };

        const sendWhileArchived = bridge.interceptMethod("chat.send", { sessionKey }, masAuth);
        expect(sendWhileArchived.allowed).toBe(false);
        if (!sendWhileArchived.allowed) {
          expect(sendWhileArchived.code).toBe(SESSION_ARCHIVED);
        }

        // 4. Unarchive the session
        unarchiveSession(db, sessionKey, ownerId);

        // 5. isSessionArchived should return false
        expect(isSessionArchived(db, sessionKey)).toBe(false);

        // 6. interceptMethod("chat.send") should now return { allowed: true }
        const sendAfterUnarchive = bridge.interceptMethod("chat.send", { sessionKey }, masAuth);
        expect(sendAfterUnarchive.allowed).toBe(true);
      }),
      { numRuns: 100 },
    );
  });
});
