export type GlobalRole = "admin" | "member" | "viewer";
export type SessionRole = "owner" | "participant";

export interface SessionPermissionContext {
  sessionKey: string;
  sessionRole?: SessionRole;
}

export type PermissionResult =
  | { allowed: true }
  | { allowed: false; code: "PERMISSION_DENIED"; reason: string };

/**
 * Global role permission matrix.
 * Empty Set means no auth required (public endpoint).
 */
export const GLOBAL_ROLE_PERMISSIONS: Record<string, Set<GlobalRole>> = {
  "system.status": new Set([]), // no auth required
  "user.register": new Set(["admin"]), // self-registration handled separately
  "user.approve": new Set(["admin"]),
  "user.reject": new Set(["admin"]),
  "user.list": new Set(["admin", "member", "viewer"]), // all authenticated users
  "user.update": new Set(["admin"]),
  "sessions.create": new Set(["admin", "member"]),
  "chat.send": new Set(["admin", "member"]),
  "sessions.list": new Set(["admin", "member", "viewer"]),
  "sessions.resolve": new Set(["admin", "member", "viewer"]),
  "session.invite": new Set(["admin", "member"]),
  "session.removeMember": new Set(["admin", "member"]),
  "session.members": new Set(["admin", "member", "viewer"]),
  "session.leave": new Set(["admin", "member", "viewer"]),
  "exec.approval.resolve": new Set(["admin", "member"]),
  "auth.login": new Set([]), // no auth required
  "auth.refresh": new Set(["admin", "member", "viewer"]),
  "auth.verify": new Set([]), // no auth required
};

/**
 * Session-level role permission matrix.
 * Applied after global role check passes.
 */
export const SESSION_ROLE_PERMISSIONS: Record<string, Set<SessionRole>> = {
  "session.invite": new Set(["owner", "participant"]),
  "session.removeMember": new Set(["owner"]),
  "exec.approval.resolve": new Set(["owner"]),
};

/**
 * Check whether a user is permitted to call a method.
 *
 * Logic:
 * 1. If method has an empty global-role set → public endpoint, always allowed.
 * 2. If userId is null (compat mode) → skip all checks, allowed.
 * 3. If role is null or not in the allowed global-role set → PERMISSION_DENIED.
 * 4. If method has session-level restrictions and sessionContext is provided →
 *    check sessionRole against SESSION_ROLE_PERMISSIONS.
 * 5. On denial, call auditLogger if provided.
 */
export function checkPermission(
  userId: string | null,
  role: GlobalRole | null,
  method: string,
  sessionContext?: SessionPermissionContext,
  auditLogger?: (userId: string | null, method: string, reason: string) => void,
): PermissionResult {
  const globalAllowed = GLOBAL_ROLE_PERMISSIONS[method];

  // Step 1: public endpoint (empty set = no auth required)
  if (globalAllowed !== undefined && globalAllowed.size === 0) {
    return { allowed: true };
  }

  // Step 2: compat mode — no userId means no multi-tenant auth, pass through
  if (userId === null) {
    return { allowed: true };
  }

  // Step 3: global role check
  if (role === null || globalAllowed === undefined || !globalAllowed.has(role)) {
    const reason = `Role '${role ?? "none"}' is not permitted to call '${method}'`;
    auditLogger?.(userId, method, reason);
    return { allowed: false, code: "PERMISSION_DENIED", reason };
  }

  // Step 4: session-level role check (only when sessionContext is provided)
  const sessionAllowed = SESSION_ROLE_PERMISSIONS[method];
  if (sessionAllowed !== undefined && sessionContext !== undefined) {
    const { sessionRole } = sessionContext;
    if (sessionRole === undefined || !sessionAllowed.has(sessionRole)) {
      const reason = `Session role '${sessionRole ?? "none"}' is not permitted to call '${method}' on session '${sessionContext.sessionKey}'`;
      auditLogger?.(userId, method, reason);
      return { allowed: false, code: "PERMISSION_DENIED", reason };
    }
  }

  return { allowed: true };
}
