/**
 * Property-based tests for GatewayAuthBridge and session-manager.
 * Feature: mas4s-multi-tenant-rbac
 *
 * **Validates: Requirements 4.1, 4.2, 4.3, 4.4, 4.6, 5.1, 5.2, 5.3, 5.4, 5.7, 5.8, 5.9, 5.10, 5.11, 5.12, 5.13, 7.1, 7.2, 7.3, 7.4**
 */

import type { DatabaseSync } from "node:sqlite";
import * as fc from "fast-check";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  OWNER_CANNOT_LEAVE,
  ALREADY_MEMBER,
  NOT_A_MEMBER,
  SESSION_ACCESS_DENIED,
} from "../errors.js";
import { GatewayAuthBridge } from "../gateway-bridge/bridge.js";
import type { MasAuthContext } from "../gateway-bridge/context.js";
import * as sessionManager from "../gateway-bridge/session-manager.js";
import type { TenantService } from "../index.js";
import { createTestDatabase } from "../test-helpers/setup.js";

// ── Minimal mock TenantService for bridge tests ──

function createMockTenantService(): TenantService {
  return {
    login: () => ({ ok: false, error: "not implemented" }),
    verify: () => ({ ok: false, error: "not implemented" }),
    refresh: () => ({ ok: false, error: "not implemented" }),
    registerUser: () => {
      throw new Error("not implemented");
    },
    listUsers: () => [],
    updateUser: () => {
      throw new Error("not implemented");
    },
    approveUser: () => {},
    rejectUser: () => {},
    checkPermission: () => ({ allowed: true }),
    checkLoginRateLimit: () => ({ allowed: true }),
    getSystemStatus: () => ({ initialized: false }),
    logout: () => {},
    init: async () => {},
  };
}

// ── Helper: insert a user into the db for membership tests ──

function insertUser(db: DatabaseSync, userId: string, tenantId: string, displayName: string): void {
  const now = Date.now();
  db.prepare("INSERT OR IGNORE INTO tenants (tenantId, name, createdAt) VALUES (?, ?, ?)").run(
    tenantId,
    "Test",
    now,
  );
  db.prepare(
    "INSERT OR IGNORE INTO users (userId, username, displayName, passwordHash, role, tenantId, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(
    userId,
    `user_${userId.slice(0, 8)}`,
    displayName,
    "sha256:salt:hash",
    "member",
    tenantId,
    "approved",
    now,
  );
}

// ── Arbitraries ──

const arbUserId = fc
  .string({ minLength: 4, maxLength: 16 })
  .map((s) => `u-${s.replace(/[^a-z0-9]/gi, "x")}`);

const arbSessionKey = fc
  .string({ minLength: 4, maxLength: 16 })
  .map((s) => `sess-${s.replace(/[^a-z0-9]/gi, "x")}`);

const arbTenantId = fc
  .string({ minLength: 4, maxLength: 12 })
  .map((s) => `t-${s.replace(/[^a-z0-9]/gi, "x")}`);

// ── Test state ──

let db: DatabaseSync;
let cleanup: () => void;
let bridge: GatewayAuthBridge;

beforeEach(() => {
  const result = createTestDatabase();
  db = result.db;
  cleanup = result.cleanup;
  bridge = new GatewayAuthBridge(createMockTenantService(), db);
});

afterEach(() => {
  cleanup();
});

// ────────────────────────────────────────────────────────────────────────────
// Property 6: 会话隔离完备性
// ────────────────────────────────────────────────────────────────────────────

describe("Property 6: 会话隔离完备性", () => {
  /**
   * User without membership cannot access session.
   * Validates: Requirements 4.2, 4.3, 4.4
   */
  it("user without membership is denied session access", () => {
    fc.assert(
      fc.property(
        arbUserId,
        arbUserId,
        arbSessionKey,
        arbTenantId,
        (ownerUserId, otherUserId, sessionKey, tenantId) => {
          // Ensure distinct user IDs
          if (ownerUserId === otherUserId) {
            return;
          }

          // Clean up any leftover session data from previous iterations
          db.prepare("DELETE FROM session_memberships WHERE sessionKey = ?").run(sessionKey);
          db.prepare("DELETE FROM session_ownership WHERE sessionKey = ?").run(sessionKey);

          insertUser(db, ownerUserId, tenantId, "Owner");
          insertUser(db, otherUserId, tenantId, "Other");

          // Owner creates session → gets membership
          sessionManager.recordSessionCreated(db, sessionKey, ownerUserId, tenantId);

          // Other user has no membership → access denied
          const otherAuth: MasAuthContext = {
            userId: otherUserId,
            tenantId,
            masRole: "member",
          };

          const accessResult = bridge.checkSessionAccess(sessionKey, otherAuth);
          expect(accessResult.allowed).toBe(false);
          if (!accessResult.allowed) {
            expect(accessResult.code).toBe(SESSION_ACCESS_DENIED);
          }

          // filterSessionsForUser should exclude the session
          const sessions = [{ key: sessionKey, label: "test" }];
          const filtered = bridge.filterSessionsForUser(sessions, otherAuth);
          expect(filtered).toHaveLength(0);
        },
      ),
      { numRuns: 50 },
    );
  });

  /**
   * filterSessionsForUser attaches correct masRole.
   */
  it("filterSessionsForUser attaches correct masRole", () => {
    fc.assert(
      fc.property(
        arbUserId,
        arbUserId,
        arbSessionKey,
        arbTenantId,
        (ownerUserId, participantUserId, sessionKey, tenantId) => {
          if (ownerUserId === participantUserId) {
            return;
          }

          db.prepare("DELETE FROM session_memberships WHERE sessionKey = ?").run(sessionKey);
          db.prepare("DELETE FROM session_ownership WHERE sessionKey = ?").run(sessionKey);

          insertUser(db, ownerUserId, tenantId, "Owner");
          insertUser(db, participantUserId, tenantId, "Participant");

          sessionManager.recordSessionCreated(db, sessionKey, ownerUserId, tenantId);
          sessionManager.inviteToSession(db, sessionKey, participantUserId, ownerUserId);

          const ownerAuth: MasAuthContext = { userId: ownerUserId, tenantId, masRole: "member" };
          const participantAuth: MasAuthContext = {
            userId: participantUserId,
            tenantId,
            masRole: "member",
          };

          const rawSessions = [{ key: sessionKey, label: "test" }];

          // Owner should see masRole: 'owner'
          const ownerFiltered = bridge.filterSessionsForUser(rawSessions, ownerAuth) as (Record<
            string,
            unknown
          > & { masRole: string })[];
          expect(ownerFiltered).toHaveLength(1);
          expect(ownerFiltered[0].masRole).toBe("owner");

          // Participant should see masRole: 'participant'
          const participantFiltered = bridge.filterSessionsForUser(
            rawSessions,
            participantAuth,
          ) as (Record<string, unknown> & { masRole: string })[];
          expect(participantFiltered).toHaveLength(1);
          expect(participantFiltered[0].masRole).toBe("participant");
        },
      ),
      { numRuns: 30 },
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Property 7: 会话创建记录完整性
// ────────────────────────────────────────────────────────────────────────────

describe("Property 7: 会话创建记录完整性", () => {
  /**
   * onSessionCreated creates both ownership and membership records.
   * Validates: Requirements 4.1
   */
  it("onSessionCreated creates ownership and owner membership records", () => {
    fc.assert(
      fc.property(arbUserId, arbSessionKey, arbTenantId, (userId, sessionKey, tenantId) => {
        // Skip if sessionKey already used in a prior iteration
        const existing = db
          .prepare("SELECT 1 FROM session_ownership WHERE sessionKey = ?")
          .get(sessionKey);
        fc.pre(existing === undefined);

        insertUser(db, userId, tenantId, "Creator");

        const masAuth: MasAuthContext = { userId, tenantId, masRole: "member" };
        bridge.onSessionCreated(sessionKey, "Test Session", masAuth);

        // Ownership record must exist
        const ownership = db
          .prepare("SELECT * FROM session_ownership WHERE sessionKey = ? AND userId = ?")
          .get(sessionKey, userId) as { sessionKey: string; userId: string } | undefined;
        expect(ownership).toBeDefined();
        expect(ownership?.userId).toBe(userId);

        // Membership record must exist with role="owner"
        const membership = db
          .prepare("SELECT * FROM session_memberships WHERE sessionKey = ? AND userId = ?")
          .get(sessionKey, userId) as
          | { sessionKey: string; userId: string; role: string }
          | undefined;
        expect(membership).toBeDefined();
        expect(membership?.role).toBe("owner");
      }),
      { numRuns: 50 },
    );
  });

  /**
   * onSessionCreated in compat mode (userId=null) creates no records.
   * Validates: Requirements 4.1, 4.6
   */
  it("onSessionCreated in compat mode creates no records", () => {
    fc.assert(
      fc.property(arbSessionKey, (sessionKey) => {
        const compatAuth: MasAuthContext = { userId: null, tenantId: null, masRole: null };
        bridge.onSessionCreated(sessionKey, "Test", compatAuth);

        const ownership = db
          .prepare("SELECT * FROM session_ownership WHERE sessionKey = ?")
          .get(sessionKey);
        expect(ownership).toBeUndefined();

        const membership = db
          .prepare("SELECT * FROM session_memberships WHERE sessionKey = ?")
          .get(sessionKey);
        expect(membership).toBeUndefined();
      }),
      { numRuns: 30 },
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Property 8: 会话邀请权限与成员增长
// ────────────────────────────────────────────────────────────────────────────

describe("Property 8: 会话邀请权限与成员增长", () => {
  /**
   * Owner and participant can invite; invited user immediately becomes member.
   * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.9
   */
  it("owner can invite a non-member and member count increases", () => {
    fc.assert(
      fc.property(
        arbUserId,
        arbUserId,
        arbSessionKey,
        arbTenantId,
        (ownerUserId, inviteeUserId, sessionKey, tenantId) => {
          if (ownerUserId === inviteeUserId) {
            return;
          }

          // Clean up any leftover session data from previous iterations
          db.prepare("DELETE FROM session_memberships WHERE sessionKey = ?").run(sessionKey);
          db.prepare("DELETE FROM session_ownership WHERE sessionKey = ?").run(sessionKey);

          insertUser(db, ownerUserId, tenantId, "Owner");
          insertUser(db, inviteeUserId, tenantId, "Invitee");

          sessionManager.recordSessionCreated(db, sessionKey, ownerUserId, tenantId);

          const membersBefore = sessionManager.getSessionMemberUserIds(db, sessionKey);
          expect(membersBefore).toHaveLength(1);

          const result = bridge.inviteToSession({
            sessionKey,
            targetUserId: inviteeUserId,
            callerUserId: ownerUserId,
          });

          expect(result.ok).toBe(true);

          const membersAfter = sessionManager.getSessionMemberUserIds(db, sessionKey);
          expect(membersAfter).toHaveLength(2);
          expect(membersAfter).toContain(inviteeUserId);
        },
      ),
      { numRuns: 50 },
    );
  });

  /**
   * Participant can also invite.
   * Validates: Requirements 5.1, 5.2
   */
  it("participant can invite a non-member", () => {
    fc.assert(
      fc.property(
        arbUserId,
        arbUserId,
        arbUserId,
        arbSessionKey,
        arbTenantId,
        (ownerUserId, participantUserId, inviteeUserId, sessionKey, tenantId) => {
          if (
            ownerUserId === participantUserId ||
            ownerUserId === inviteeUserId ||
            participantUserId === inviteeUserId
          ) {
            return;
          }

          insertUser(db, ownerUserId, tenantId, "Owner");
          insertUser(db, participantUserId, tenantId, "Participant");
          insertUser(db, inviteeUserId, tenantId, "Invitee");

          sessionManager.recordSessionCreated(db, sessionKey, ownerUserId, tenantId);
          // Add participant
          sessionManager.inviteToSession(db, sessionKey, participantUserId, ownerUserId);

          // Participant invites invitee
          const result = bridge.inviteToSession({
            sessionKey,
            targetUserId: inviteeUserId,
            callerUserId: participantUserId,
          });

          expect(result.ok).toBe(true);
          const members = sessionManager.getSessionMemberUserIds(db, sessionKey);
          expect(members).toContain(inviteeUserId);
        },
      ),
      { numRuns: 30 },
    );
  });

  /**
   * Non-member cannot invite.
   * Validates: Requirements 5.3
   */
  it("non-member invite returns SESSION_ACCESS_DENIED", () => {
    fc.assert(
      fc.property(
        arbUserId,
        arbUserId,
        arbUserId,
        arbSessionKey,
        arbTenantId,
        (ownerUserId, nonMemberUserId, inviteeUserId, sessionKey, tenantId) => {
          if (
            ownerUserId === nonMemberUserId ||
            ownerUserId === inviteeUserId ||
            nonMemberUserId === inviteeUserId
          ) {
            return;
          }

          insertUser(db, ownerUserId, tenantId, "Owner");
          insertUser(db, nonMemberUserId, tenantId, "NonMember");
          insertUser(db, inviteeUserId, tenantId, "Invitee");

          sessionManager.recordSessionCreated(db, sessionKey, ownerUserId, tenantId);

          const result = bridge.inviteToSession({
            sessionKey,
            targetUserId: inviteeUserId,
            callerUserId: nonMemberUserId,
          });

          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.code).toBe(SESSION_ACCESS_DENIED);
          }
        },
      ),
      { numRuns: 30 },
    );
  });

  /**
   * Duplicate invite returns ALREADY_MEMBER.
   * Validates: Requirements 5.9
   */
  it("duplicate invite returns ALREADY_MEMBER", () => {
    fc.assert(
      fc.property(
        arbUserId,
        arbUserId,
        arbSessionKey,
        arbTenantId,
        (ownerUserId, inviteeUserId, sessionKey, tenantId) => {
          if (ownerUserId === inviteeUserId) {
            return;
          }

          insertUser(db, ownerUserId, tenantId, "Owner");
          insertUser(db, inviteeUserId, tenantId, "Invitee");

          sessionManager.recordSessionCreated(db, sessionKey, ownerUserId, tenantId);

          // First invite succeeds
          const first = bridge.inviteToSession({
            sessionKey,
            targetUserId: inviteeUserId,
            callerUserId: ownerUserId,
          });
          expect(first.ok).toBe(true);

          // Second invite returns ALREADY_MEMBER
          const second = bridge.inviteToSession({
            sessionKey,
            targetUserId: inviteeUserId,
            callerUserId: ownerUserId,
          });
          expect(second.ok).toBe(false);
          if (!second.ok) {
            expect(second.code).toBe(ALREADY_MEMBER);
          }
        },
      ),
      { numRuns: 30 },
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Property 9: owner 不可自行退出
// ────────────────────────────────────────────────────────────────────────────

describe("Property 9: owner 不可自行退出", () => {
  /**
   * Owner calling leaveSession returns OWNER_CANNOT_LEAVE.
   * Validates: Requirements 5.8
   */
  it("owner calling leave returns OWNER_CANNOT_LEAVE and membership is preserved", () => {
    fc.assert(
      fc.property(arbUserId, arbSessionKey, arbTenantId, (ownerUserId, sessionKey, tenantId) => {
        insertUser(db, ownerUserId, tenantId, "Owner");
        sessionManager.recordSessionCreated(db, sessionKey, ownerUserId, tenantId);

        const result = bridge.leaveSession(sessionKey, ownerUserId);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.code).toBe(OWNER_CANNOT_LEAVE);
        }

        // Membership must still exist
        const membership = db
          .prepare("SELECT * FROM session_memberships WHERE sessionKey = ? AND userId = ?")
          .get(sessionKey, ownerUserId);
        expect(membership).toBeDefined();
      }),
      { numRuns: 50 },
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Property 11: 事件广播隔离
// ────────────────────────────────────────────────────────────────────────────

describe("Property 11: 事件广播隔离", () => {
  /**
   * Events only sent to session members; approval events only to owners.
   * Validates: Requirements 7.1, 7.2, 7.3
   */
  it("chat events are filtered to session members only", () => {
    fc.assert(
      fc.property(
        arbUserId,
        arbUserId,
        arbUserId,
        arbSessionKey,
        arbTenantId,
        (ownerUserId, memberUserId, outsiderUserId, sessionKey, tenantId) => {
          if (
            ownerUserId === memberUserId ||
            ownerUserId === outsiderUserId ||
            memberUserId === outsiderUserId
          ) {
            return;
          }

          // Clean up any leftover session data from previous iterations
          db.prepare("DELETE FROM session_memberships WHERE sessionKey = ?").run(sessionKey);
          db.prepare("DELETE FROM session_ownership WHERE sessionKey = ?").run(sessionKey);

          insertUser(db, ownerUserId, tenantId, "Owner");
          insertUser(db, memberUserId, tenantId, "Member");
          insertUser(db, outsiderUserId, tenantId, "Outsider");

          sessionManager.recordSessionCreated(db, sessionKey, ownerUserId, tenantId);
          sessionManager.inviteToSession(db, sessionKey, memberUserId, ownerUserId);

          // Build connectedUsers map: all three are connected
          const connectedUsers = new Map<string, MasAuthContext>([
            [ownerUserId, { userId: ownerUserId, tenantId, masRole: "member" }],
            [memberUserId, { userId: memberUserId, tenantId, masRole: "member" }],
            [outsiderUserId, { userId: outsiderUserId, tenantId, masRole: "member" }],
          ]);

          const payload = { sessionKey };

          // chat event → all members (owner + member), not outsider
          const chatTargets = bridge.filterBroadcastTargets(
            "chat.message",
            payload,
            connectedUsers,
          );
          expect(chatTargets).not.toBeNull();
          expect(chatTargets!.has(ownerUserId)).toBe(true);
          expect(chatTargets!.has(memberUserId)).toBe(true);
          expect(chatTargets!.has(outsiderUserId)).toBe(false);
        },
      ),
      { numRuns: 30 },
    );
  });

  it("exec.approval.requested events are filtered to owners only", () => {
    fc.assert(
      fc.property(
        arbUserId,
        arbUserId,
        arbSessionKey,
        arbTenantId,
        (ownerUserId, participantUserId, sessionKey, tenantId) => {
          if (ownerUserId === participantUserId) {
            return;
          }

          // Clean up any leftover session data from previous iterations
          db.prepare("DELETE FROM session_memberships WHERE sessionKey = ?").run(sessionKey);
          db.prepare("DELETE FROM session_ownership WHERE sessionKey = ?").run(sessionKey);

          insertUser(db, ownerUserId, tenantId, "Owner");
          insertUser(db, participantUserId, tenantId, "Participant");

          sessionManager.recordSessionCreated(db, sessionKey, ownerUserId, tenantId);
          sessionManager.inviteToSession(db, sessionKey, participantUserId, ownerUserId);

          const connectedUsers = new Map<string, MasAuthContext>([
            [ownerUserId, { userId: ownerUserId, tenantId, masRole: "member" }],
            [participantUserId, { userId: participantUserId, tenantId, masRole: "member" }],
          ]);

          const payload = { sessionKey };

          // approval event → only owner
          const approvalTargets = bridge.filterBroadcastTargets(
            "exec.approval.requested",
            payload,
            connectedUsers,
          );
          expect(approvalTargets).not.toBeNull();
          expect(approvalTargets!.has(ownerUserId)).toBe(true);
          expect(approvalTargets!.has(participantUserId)).toBe(false);
        },
      ),
      { numRuns: 30 },
    );
  });

  /**
   * Compat mode (any userId=null in connectedUsers) returns null (no filtering).
   * Validates: Requirements 7.4
   */
  it("compat mode (any userId=null in connectedUsers) returns null", () => {
    fc.assert(
      fc.property(arbUserId, arbSessionKey, arbTenantId, (ownerUserId, sessionKey, tenantId) => {
        insertUser(db, ownerUserId, tenantId, "Owner");
        sessionManager.recordSessionCreated(db, sessionKey, ownerUserId, tenantId);

        // One connected user has null userId → compat mode
        const connectedUsers = new Map<string, MasAuthContext>([
          [ownerUserId, { userId: ownerUserId, tenantId, masRole: "member" }],
          ["compat-client", { userId: null, tenantId: null, masRole: null }],
        ]);

        const payload = { sessionKey };
        const result = bridge.filterBroadcastTargets("chat.message", payload, connectedUsers);
        expect(result).toBeNull();
      }),
      { numRuns: 30 },
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Property 12: 兼容模式透明性
// ────────────────────────────────────────────────────────────────────────────

describe("Property 12: 兼容模式透明性", () => {
  const NULL_MAS_AUTH: MasAuthContext = { userId: null, tenantId: null, masRole: null };

  /**
   * interceptMethod with userId=null skips all checks → always allowed.
   * Validates: Requirements 3.4, 4.6
   */
  it("interceptMethod with userId=null returns allowed for any method", () => {
    const methods = [
      "sessions.create",
      "chat.send",
      "sessions.list",
      "sessions.resolve",
      "session.invite",
      "session.removeMember",
      "session.members",
      "session.leave",
      "exec.approval.resolve",
      "user.update",
    ];

    fc.assert(
      fc.property(fc.constantFrom(...methods), (method) => {
        const result = bridge.interceptMethod(method, {}, NULL_MAS_AUTH);
        expect(result.allowed).toBe(true);
      }),
      { numRuns: 50 },
    );
  });

  /**
   * filterSessionsForUser with userId=null returns sessions unchanged.
   * Validates: Requirements 4.6
   */
  it("filterSessionsForUser with userId=null returns sessions unchanged", () => {
    fc.assert(
      fc.property(
        fc.array(fc.record({ key: arbSessionKey, label: fc.string() }), {
          minLength: 0,
          maxLength: 5,
        }),
        (sessions) => {
          const result = bridge.filterSessionsForUser(sessions, NULL_MAS_AUTH);
          expect(result).toEqual(sessions);
        },
      ),
      { numRuns: 50 },
    );
  });

  /**
   * checkSessionAccess with userId=null returns allowed.
   * Validates: Requirements 4.6
   */
  it("checkSessionAccess with userId=null returns allowed", () => {
    fc.assert(
      fc.property(arbSessionKey, (sessionKey) => {
        const result = bridge.checkSessionAccess(sessionKey, NULL_MAS_AUTH);
        expect(result.allowed).toBe(true);
      }),
      { numRuns: 50 },
    );
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Property 19: 成员移除完整性
// ────────────────────────────────────────────────────────────────────────────

describe("Property 19: 成员移除完整性", () => {
  /**
   * Owner can remove participant; removed user is no longer a member.
   * Validates: Requirements 5.10, 5.11
   */
  it("owner can remove participant and participant is no longer a member", () => {
    fc.assert(
      fc.property(
        arbUserId,
        arbUserId,
        arbSessionKey,
        arbTenantId,
        (ownerUserId, participantUserId, sessionKey, tenantId) => {
          if (ownerUserId === participantUserId) {
            return;
          }

          insertUser(db, ownerUserId, tenantId, "Owner");
          insertUser(db, participantUserId, tenantId, "Participant");

          sessionManager.recordSessionCreated(db, sessionKey, ownerUserId, tenantId);
          sessionManager.inviteToSession(db, sessionKey, participantUserId, ownerUserId);

          // Verify participant is a member before removal
          expect(sessionManager.checkSessionAccess(db, sessionKey, participantUserId)).toBe(true);

          const result = bridge.removeMember({
            sessionKey,
            targetUserId: participantUserId,
            callerUserId: ownerUserId,
          });

          expect(result.ok).toBe(true);

          // Participant is no longer a member
          expect(sessionManager.checkSessionAccess(db, sessionKey, participantUserId)).toBe(false);

          // filterSessionsForUser should exclude the session for removed user
          const participantAuth: MasAuthContext = {
            userId: participantUserId,
            tenantId,
            masRole: "member",
          };
          const sessions = [{ key: sessionKey, label: "test" }];
          const filtered = bridge.filterSessionsForUser(sessions, participantAuth);
          expect(filtered).toHaveLength(0);
        },
      ),
      { numRuns: 50 },
    );
  });

  /**
   * Owner cannot remove self → OWNER_CANNOT_LEAVE.
   * Validates: Requirements 5.12
   */
  it("owner cannot remove self → OWNER_CANNOT_LEAVE", () => {
    fc.assert(
      fc.property(arbUserId, arbSessionKey, arbTenantId, (ownerUserId, sessionKey, tenantId) => {
        insertUser(db, ownerUserId, tenantId, "Owner");
        sessionManager.recordSessionCreated(db, sessionKey, ownerUserId, tenantId);

        const result = bridge.removeMember({
          sessionKey,
          targetUserId: ownerUserId,
          callerUserId: ownerUserId,
        });

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.code).toBe(OWNER_CANNOT_LEAVE);
        }

        // Owner membership must still exist
        expect(sessionManager.checkSessionAccess(db, sessionKey, ownerUserId)).toBe(true);
      }),
      { numRuns: 50 },
    );
  });

  /**
   * Removing a non-member target returns NOT_A_MEMBER.
   * Validates: Requirements 5.13
   */
  it("removing non-member target returns NOT_A_MEMBER", () => {
    fc.assert(
      fc.property(
        arbUserId,
        arbUserId,
        arbSessionKey,
        arbTenantId,
        (ownerUserId, nonMemberUserId, sessionKey, tenantId) => {
          if (ownerUserId === nonMemberUserId) {
            return;
          }

          insertUser(db, ownerUserId, tenantId, "Owner");
          insertUser(db, nonMemberUserId, tenantId, "NonMember");

          sessionManager.recordSessionCreated(db, sessionKey, ownerUserId, tenantId);
          // nonMemberUserId is NOT invited

          const result = bridge.removeMember({
            sessionKey,
            targetUserId: nonMemberUserId,
            callerUserId: ownerUserId,
          });

          expect(result.ok).toBe(false);
          if (!result.ok) {
            expect(result.code).toBe(NOT_A_MEMBER);
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});
