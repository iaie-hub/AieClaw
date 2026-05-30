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
 *
 * Methods NOT listed here fall back to GATEWAY_SCOPE_FALLBACK classification:
 *   read  → admin | member | viewer
 *   write → admin | member
 *   admin → admin only
 *   unknown → denied
 */
export const GLOBAL_ROLE_PERMISSIONS: Record<string, Set<GlobalRole>> = {
  "system.status": new Set([]), // no auth required
  "user.register": new Set(["admin"]), // self-registration handled separately
  "user.approve": new Set(["admin"]),
  "user.reject": new Set(["admin"]),
  "user.list": new Set(["admin", "member", "viewer"]),
  "user.update": new Set(["admin"]),
  "sessions.create": new Set(["admin", "member"]),
  "chat.send": new Set(["admin", "member"]),
  "chat.history": new Set(["admin", "member", "viewer"]),
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
  "user.logout": new Set(["admin", "member", "viewer"]),
  "session.archive": new Set(["admin", "member"]),
  "session.unarchive": new Set(["admin", "member"]),
  "session.summary.generate": new Set(["admin", "member"]),
  "session.summary.get": new Set(["admin", "member", "viewer"]),
  "session.history.range": new Set(["admin", "member", "viewer"]),
  "session.label.get": new Set(["admin", "member", "viewer"]),
  "session.label.list": new Set(["admin", "member", "viewer"]),
  "session.agent.update": new Set(["admin", "member"]),
  "session.run.state": new Set(["admin", "member", "viewer"]),
  "aiemas.agents.preDelete": new Set(["admin", "member"]),
  "aiemas.agents.export": new Set(["admin", "member"]),
  "aiemas.agents.import": new Set(["admin"]),
  "aiemas.files.download": new Set(["admin", "member"]),
  "aiemas.file.upload": new Set(["admin", "member"]),
  "aiemas.fs.list": new Set(["admin", "member", "viewer"]),
  "aiemas.agents.topology.list": new Set(["admin", "member", "viewer"]),
  "aiemas.agents.topology.save": new Set(["admin", "member"]),
  "aiemas.sessions.create": new Set(["admin", "member"]),
  "aiemas.sessions.delete": new Set(["admin", "member"]),
  "aiemas.sessions.list": new Set(["admin", "member", "viewer"]),
  "aiemas.clawhub.config.get": new Set(["admin", "member", "viewer"]),
  "aiemas.clawhub.agents.list": new Set(["admin", "member", "viewer"]),
  "aiemas.clawhub.agenthub.list": new Set(["admin", "member", "viewer"]),
  "aiemas.clawhub.config.save": new Set(["admin"]),
  "aiemas.clawhub.healthy": new Set(["admin"]),
  "aiemas.clawhub.registry-config.get": new Set(["admin", "member", "viewer"]),
  "aiemas.clawhub.registry-config.save": new Set(["admin"]),
  "aiemas.clawhub.nats-config.get": new Set(["admin", "member", "viewer"]),
  "aiemas.clawhub.nats-config.save": new Set(["admin"]),
  "aiemas.clawhub.agent.upload": new Set(["admin", "member"]),
  "aiemas.clawhub.skillhub.list": new Set(["admin", "member", "viewer"]),
  "aiemas.clawhub.skillhub.visibility.update": new Set(["admin", "member"]),
  "aiemas.clawhub.skill.download": new Set(["admin", "member"]),
  "aiemas.clawhub.skill.upload": new Set(["admin", "member"]),
};

/**
 * Fallback scope classification mirroring src/gateway/method-scopes.ts.
 * Kept in sync manually; avoids a cross-package import that breaks the build.
 *
 * read  → admin | member | viewer
 * write → admin | member
 * admin → admin only
 */
const GATEWAY_READ_METHODS = new Set([
  "health",
  "doctor.memory.status",
  "logs.tail",
  "channels.status",
  "status",
  "usage.status",
  "usage.cost",
  "tts.status",
  "tts.providers",
  "models.list",
  "tools.catalog",
  "agents.list",
  "agent.identity.get",
  "skills.status",
  "voicewake.get",
  "sessions.list",
  "sessions.get",
  "sessions.preview",
  "sessions.resolve",
  "sessions.subscribe",
  "sessions.unsubscribe",
  "sessions.messages.subscribe",
  "sessions.messages.unsubscribe",
  "sessions.usage",
  "sessions.usage.timeseries",
  "sessions.usage.logs",
  "cron.list",
  "cron.status",
  "cron.runs",
  "gateway.identity.get",
  "system-presence",
  "last-heartbeat",
  "node.list",
  "node.describe",
  "chat.history",
  "config.get",
  "config.schema.lookup",
  "talk.config",
  "agents.files.list",
  "agents.files.get",
  "system.status",
  "auth.login",
  "auth.refresh",
  "auth.verify",
  "user.register",
  "session.members",
  "session.summary.get",
  "session.history.range",
  "session.label.get",
  "session.label.list",
]);

const GATEWAY_WRITE_METHODS = new Set([
  "send",
  "poll",
  "agent",
  "agent.wait",
  "wake",
  "talk.mode",
  "talk.speak",
  "tts.enable",
  "tts.disable",
  "tts.convert",
  "tts.setProvider",
  "voicewake.set",
  "node.invoke",
  "chat.send",
  "chat.abort",
  "sessions.create",
  "sessions.send",
  "sessions.abort",
  "browser.request",
  "push.test",
  "node.pending.enqueue",
  "session.invite",
  "session.removeMember",
  "session.leave",
  "session.archive",
  "session.unarchive",
  "session.summary.generate",
]);

const GATEWAY_ADMIN_METHODS = new Set([
  "channels.logout",
  "agents.create",
  "agents.update",
  "agents.delete",
  "skills.install",
  "skills.update",
  "secrets.reload",
  "secrets.resolve",
  "cron.add",
  "cron.update",
  "cron.remove",
  "cron.run",
  "sessions.patch",
  "sessions.reset",
  "sessions.delete",
  "sessions.compact",
  "connect",
  "chat.inject",
  "web.login.start",
  "web.login.wait",
  "set-heartbeats",
  "system-event",
  "agents.files.set",
  "user.list",
  "user.update",
  "user.approve",
  "user.reject",
]);

const GATEWAY_ADMIN_PREFIXES = ["exec.approvals.", "config.", "wizard.", "update."] as const;

/**
 * Derive allowed roles for methods not listed in GLOBAL_ROLE_PERMISSIONS,
 * using the gateway scope classification as a fallback.
 */
function deriveAllowedRoles(method: string): Set<GlobalRole> | undefined {
  if (GATEWAY_READ_METHODS.has(method)) {
    return new Set(["admin", "member", "viewer"]);
  }
  if (GATEWAY_WRITE_METHODS.has(method)) {
    return new Set(["admin", "member"]);
  }
  if (
    GATEWAY_ADMIN_METHODS.has(method) ||
    GATEWAY_ADMIN_PREFIXES.some((p) => method.startsWith(p))
  ) {
    return new Set(["admin"]);
  }
  return undefined; // truly unknown → deny
}

/**
 * Session-level role permission matrix.
 * Applied after global role check passes.
 */
export const SESSION_ROLE_PERMISSIONS: Record<string, Set<SessionRole>> = {
  "session.invite": new Set(["owner", "participant"]),
  "session.removeMember": new Set(["owner"]),
  "exec.approval.resolve": new Set(["owner"]),
  "session.archive": new Set(["owner"]),
  "session.unarchive": new Set(["owner"]),
  "session.summary.generate": new Set(["owner", "participant"]),
  "session.summary.get": new Set(["owner", "participant"]),
  "session.history.range": new Set(["owner", "participant"]),
  "session.agent.update": new Set(["owner"]),
  "session.run.state": new Set(["owner", "participant"]),
};

/**
 * Check whether a user is permitted to call a method.
 *
 * Logic:
 * 1. If method has an empty global-role set → public endpoint, always allowed.
 * 2. If userId is null (compat mode) → skip all checks, allowed.
 * 3. Explicit GLOBAL_ROLE_PERMISSIONS match first; otherwise fall back to
 *    gateway scope classification (deriveAllowedRoles). Unknown methods → denied.
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

  // Step 3: explicit matrix first, then gateway scope fallback
  const effectiveAllowed = globalAllowed ?? deriveAllowedRoles(method);
  if (role === null || effectiveAllowed === undefined || !effectiveAllowed.has(role)) {
    const reason = `Role '${role ?? "none"}' is not permitted to call '${method}'`;
    auditLogger?.(userId, method, reason);
    return { allowed: false, code: "PERMISSION_DENIED", reason };
  }

  // Step 4: session-level role check (only when sessionContext is provided)
  // Admin override: admins bypass session-level restrictions (consistent with checkSessionAccess)
  const sessionAllowed = SESSION_ROLE_PERMISSIONS[method];
  if (sessionAllowed !== undefined && sessionContext !== undefined && role !== "admin") {
    const { sessionRole } = sessionContext;
    if (sessionRole === undefined || !sessionAllowed.has(sessionRole)) {
      const reason = `Session role '${sessionRole ?? "none"}' is not permitted to call '${method}' on session '${sessionContext.sessionKey}'`;
      auditLogger?.(userId, method, reason);
      return { allowed: false, code: "PERMISSION_DENIED", reason };
    }
  }

  return { allowed: true };
}
