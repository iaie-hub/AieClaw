/**
 * Property-based tests for permission-checker.
 * Feature: mas4s-multi-tenant-rbac
 *
 * **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5, 6.6**
 */

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { GlobalRole, SessionRole } from "../models.js";
import {
  GLOBAL_ROLE_PERMISSIONS,
  SESSION_ROLE_PERMISSIONS,
  checkPermission,
} from "../rbac/permission-checker.js";

// Known public methods (empty set = no auth required)
const PUBLIC_METHODS = Object.entries(GLOBAL_ROLE_PERMISSIONS)
  .filter(([, roles]) => roles.size === 0)
  .map(([method]) => method);

// Known authenticated methods (non-empty set)
const AUTH_METHODS = Object.entries(GLOBAL_ROLE_PERMISSIONS)
  .filter(([, roles]) => roles.size > 0)
  .map(([method]) => method);

// Methods with session-level restrictions
const SESSION_RESTRICTED_METHODS = Object.keys(SESSION_ROLE_PERMISSIONS);

const arbGlobalRole: fc.Arbitrary<GlobalRole> = fc.constantFrom("admin", "member", "viewer");

// const arbSessionRole: fc.Arbitrary<SessionRole> = fc.constantFrom("owner", "participant");

const arbUserId = fc.string({ minLength: 1, maxLength: 36 });
const arbSessionKey = fc.stringMatching(/^[a-z0-9-]{5,30}$/);

describe("Property 10: 全局与会话级权限矩阵一致性", () => {
  /**
   * Public endpoints (empty set) are always allowed regardless of role.
   * Validates: Requirements 6.1
   */
  it("public endpoints are always allowed for any role", () => {
    fc.assert(
      fc.property(
        arbUserId,
        arbGlobalRole,
        fc.constantFrom(...PUBLIC_METHODS),
        (userId, role, method) => {
          const result = checkPermission(userId, role, method);
          expect(result.allowed).toBe(true);
        },
      ),
    );
  });

  /**
   * Public endpoints are allowed even with null userId.
   * Validates: Requirements 6.1
   */
  it("public endpoints are allowed with null userId", () => {
    fc.assert(
      fc.property(fc.constantFrom(...PUBLIC_METHODS), (method) => {
        const result = checkPermission(null, null, method);
        expect(result.allowed).toBe(true);
      }),
    );
  });

  /**
   * Compat mode: userId=null always returns allowed for any method.
   * Validates: Requirements 3.4, 4.6
   */
  it("compat mode (userId=null) always returns allowed", () => {
    fc.assert(
      fc.property(arbGlobalRole, fc.constantFrom(...AUTH_METHODS), (role, method) => {
        const result = checkPermission(null, role, method);
        expect(result.allowed).toBe(true);
      }),
    );
  });

  /**
   * For authenticated methods, if role is in the allowed set → allowed.
   * Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5
   */
  it("role in allowed set → allowed for authenticated methods", () => {
    fc.assert(
      fc.property(arbUserId, fc.constantFrom(...AUTH_METHODS), (userId, method) => {
        const allowedRoles = GLOBAL_ROLE_PERMISSIONS[method];
        for (const role of allowedRoles) {
          const result = checkPermission(userId, role as GlobalRole, method);
          expect(result.allowed).toBe(true);
        }
      }),
    );
  });

  /**
   * For authenticated methods, if role is NOT in the allowed set → denied.
   * Validates: Requirements 6.2, 6.3, 6.4
   */
  it("role NOT in allowed set → denied for authenticated methods", () => {
    const allRoles: GlobalRole[] = ["admin", "member", "viewer"];

    fc.assert(
      fc.property(arbUserId, fc.constantFrom(...AUTH_METHODS), (userId, method) => {
        const allowedRoles = GLOBAL_ROLE_PERMISSIONS[method];
        const deniedRoles = allRoles.filter((r) => !allowedRoles.has(r));

        for (const role of deniedRoles) {
          const result = checkPermission(userId, role, method);
          expect(result.allowed).toBe(false);
          if (!result.allowed) {
            expect(result.code).toBe("PERMISSION_DENIED");
          }
        }
      }),
    );
  });

  /**
   * null role on authenticated methods → denied.
   * Validates: Requirements 6.1
   */
  it("null role on authenticated methods → denied", () => {
    fc.assert(
      fc.property(arbUserId, fc.constantFrom(...AUTH_METHODS), (userId, method) => {
        const result = checkPermission(userId, null, method);
        expect(result.allowed).toBe(false);
        if (!result.allowed) {
          expect(result.code).toBe("PERMISSION_DENIED");
        }
      }),
    );
  });

  /**
   * Unknown method (not in matrix) → denied for any authenticated user.
   * Validates: Requirements 6.1
   */
  it("unknown method → denied for authenticated users", () => {
    fc.assert(
      fc.property(
        arbUserId,
        arbGlobalRole,
        fc.string({ minLength: 1, maxLength: 30 }).filter((m) => !(m in GLOBAL_ROLE_PERMISSIONS)),
        (userId, role, unknownMethod) => {
          const result = checkPermission(userId, role, unknownMethod);
          expect(result.allowed).toBe(false);
          if (!result.allowed) {
            expect(result.code).toBe("PERMISSION_DENIED");
          }
        },
      ),
    );
  });

  /**
   * Session-level: sessionRole in SESSION_ROLE_PERMISSIONS[method] → allowed.
   * Validates: Requirements 6.5, 6.6
   */
  it("sessionRole in session matrix → allowed (when global role also passes)", () => {
    fc.assert(
      fc.property(
        arbUserId,
        arbSessionKey,
        fc.constantFrom(...SESSION_RESTRICTED_METHODS),
        (userId, sessionKey, method) => {
          const allowedSessionRoles = SESSION_ROLE_PERMISSIONS[method];
          const globalAllowed = GLOBAL_ROLE_PERMISSIONS[method];

          // Pick a global role that passes the global check
          const globalRole = [...globalAllowed][0] as GlobalRole | undefined;
          if (!globalRole) {
            return;
          } // skip if no global role passes (shouldn't happen)

          for (const sessionRole of allowedSessionRoles) {
            const result = checkPermission(userId, globalRole, method, {
              sessionKey,
              sessionRole: sessionRole as SessionRole,
            });
            expect(result.allowed).toBe(true);
          }
        },
      ),
    );
  });

  /**
   * Session-level: sessionRole NOT in SESSION_ROLE_PERMISSIONS[method] → denied.
   * Validates: Requirements 6.5, 6.6
   */
  it("sessionRole NOT in session matrix → denied", () => {
    const allSessionRoles: SessionRole[] = ["owner", "participant"];

    fc.assert(
      fc.property(
        arbUserId,
        arbSessionKey,
        fc.constantFrom(...SESSION_RESTRICTED_METHODS),
        (userId, sessionKey, method) => {
          const allowedSessionRoles = SESSION_ROLE_PERMISSIONS[method];
          const globalAllowed = GLOBAL_ROLE_PERMISSIONS[method];
          const deniedSessionRoles = allSessionRoles.filter((r) => !allowedSessionRoles.has(r));

          if (deniedSessionRoles.length === 0) {
            return;
          } // all roles allowed, skip

          const globalRole = [...globalAllowed][0] as GlobalRole | undefined;
          if (!globalRole) {
            return;
          }

          for (const sessionRole of deniedSessionRoles) {
            const result = checkPermission(userId, globalRole, method, {
              sessionKey,
              sessionRole,
            });
            expect(result.allowed).toBe(false);
            if (!result.allowed) {
              expect(result.code).toBe("PERMISSION_DENIED");
            }
          }
        },
      ),
    );
  });

  /**
   * Session-level: undefined sessionRole with session-restricted method → denied.
   * Validates: Requirements 6.5, 6.6
   */
  it("undefined sessionRole on session-restricted method → denied", () => {
    fc.assert(
      fc.property(
        arbUserId,
        arbSessionKey,
        fc.constantFrom(...SESSION_RESTRICTED_METHODS),
        (userId, sessionKey, method) => {
          const globalAllowed = GLOBAL_ROLE_PERMISSIONS[method];
          const globalRole = [...globalAllowed][0] as GlobalRole | undefined;
          if (!globalRole) {
            return;
          }

          const result = checkPermission(userId, globalRole, method, {
            sessionKey,
            sessionRole: undefined,
          });
          expect(result.allowed).toBe(false);
          if (!result.allowed) {
            expect(result.code).toBe("PERMISSION_DENIED");
          }
        },
      ),
    );
  });

  /**
   * Session-level: no sessionContext provided → global check only (allowed if global passes).
   * Validates: Requirements 6.5
   */
  it("no sessionContext → session restrictions not applied, global check only", () => {
    fc.assert(
      fc.property(arbUserId, fc.constantFrom(...SESSION_RESTRICTED_METHODS), (userId, method) => {
        const globalAllowed = GLOBAL_ROLE_PERMISSIONS[method];
        const globalRole = [...globalAllowed][0] as GlobalRole | undefined;
        if (!globalRole) {
          return;
        }

        // Without sessionContext, session-level check is skipped
        const result = checkPermission(userId, globalRole, method);
        expect(result.allowed).toBe(true);
      }),
    );
  });

  /**
   * Specific matrix spot-checks: viewer cannot chat.send or sessions.create.
   * Validates: Requirements 6.2, 6.3
   */
  it("viewer is denied chat.send and sessions.create", () => {
    fc.assert(
      fc.property(arbUserId, (userId) => {
        const chatResult = checkPermission(userId, "viewer", "chat.send");
        expect(chatResult.allowed).toBe(false);

        const sessionsResult = checkPermission(userId, "viewer", "sessions.create");
        expect(sessionsResult.allowed).toBe(false);
      }),
    );
  });

  /**
   * Specific matrix spot-checks: member and viewer cannot user.update.
   * Validates: Requirements 6.4
   */
  it("member and viewer are denied user.update", () => {
    fc.assert(
      fc.property(arbUserId, (userId) => {
        const memberResult = checkPermission(userId, "member", "user.update");
        expect(memberResult.allowed).toBe(false);

        const viewerResult = checkPermission(userId, "viewer", "user.update");
        expect(viewerResult.allowed).toBe(false);
      }),
    );
  });

  /**
   * Specific matrix spot-checks: participant cannot exec.approval.resolve.
   * Validates: Requirements 6.6
   */
  it("participant is denied exec.approval.resolve", () => {
    fc.assert(
      fc.property(arbUserId, arbSessionKey, (userId, sessionKey) => {
        // member has global access, but participant does not have session access
        const result = checkPermission(userId, "member", "exec.approval.resolve", {
          sessionKey,
          sessionRole: "participant",
        });
        expect(result.allowed).toBe(false);
        if (!result.allowed) {
          expect(result.code).toBe("PERMISSION_DENIED");
        }
      }),
    );
  });

  /**
   * Audit logger is called on denial.
   * Validates: Requirements 11.3
   */
  it("audit logger is invoked on permission denial", () => {
    fc.assert(
      fc.property(arbUserId, fc.constantFrom(...AUTH_METHODS), (userId, method) => {
        const allowedRoles = GLOBAL_ROLE_PERMISSIONS[method];
        const allRoles: GlobalRole[] = ["admin", "member", "viewer"];
        const deniedRoles = allRoles.filter((r) => !allowedRoles.has(r));
        if (deniedRoles.length === 0) {
          return;
        }

        const role = deniedRoles[0];
        const auditCalls: Array<{ userId: string | null; method: string; reason: string }> = [];

        checkPermission(userId, role, method, undefined, (uid, m, reason) => {
          auditCalls.push({ userId: uid, method: m, reason });
        });

        expect(auditCalls).toHaveLength(1);
        expect(auditCalls[0].userId).toBe(userId);
        expect(auditCalls[0].method).toBe(method);
      }),
    );
  });
});
