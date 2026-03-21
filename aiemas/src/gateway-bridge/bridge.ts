import type { DatabaseSync } from "node:sqlite";
import { TenantServiceError, SESSION_ACCESS_DENIED, MAS_AUTH_FAILED } from "../errors.js";
import type { TenantService } from "../index.js";
import type { SessionMember } from "../models.js";
import type { MasAuthContext } from "./context.js";
import { NULL_MAS_AUTH } from "./context.js";
import * as sessionManager from "./session-manager.js";

export class GatewayAuthBridge {
  constructor(
    private readonly tenantService: TenantService,
    private readonly db: DatabaseSync,
  ) {}

  /**
   * Authenticate a WS connect request.
   * Extracts masToken from connectAuth, verifies it, returns MasAuthContext.
   * Returns NULL_MAS_AUTH (compat mode) if no masToken.
   */
  authenticateConnect(connectAuth: {
    masToken?: string;
    token?: string;
    password?: string;
  }): MasAuthContext {
    const { masToken } = connectAuth;
    if (!masToken) {
      return NULL_MAS_AUTH;
    }

    const result = this.tenantService.verify(masToken);
    if (!result.ok) {
      throw new TenantServiceError(MAS_AUTH_FAILED, `MAS authentication failed: ${result.error}`);
    }

    return {
      userId: result.userId,
      tenantId: result.tenantId,
      masRole: result.role,
    };
  }

  /**
   * Method interceptor: check global role + session-level permissions.
   * Compat mode (userId=null) skips all checks.
   * Returns { allowed: true } or { allowed: false, code, message }.
   */
  interceptMethod(
    method: string,
    params: Record<string, unknown>,
    masAuth: MasAuthContext,
  ): { allowed: true } | { allowed: false; code: string; message: string } {
    // Compat mode: skip all checks
    if (masAuth.userId === null) {
      return { allowed: true };
    }

    // Determine session context for session-specific methods
    const sessionKey = this._extractSessionKey(params);
    let sessionContext: { sessionKey: string; sessionRole?: "owner" | "participant" } | undefined;

    if (sessionKey) {
      // Look up the caller's session role
      const sessionRole = this._getSessionRole(sessionKey, masAuth.userId);
      sessionContext = { sessionKey, sessionRole: sessionRole ?? undefined };
    }

    const result = this.tenantService.checkPermission(
      masAuth.userId,
      masAuth.masRole,
      method,
      sessionContext,
    );
    if (!result.allowed) {
      return { allowed: false, code: result.code, message: result.reason };
    }

    // For session-specific methods that require membership, check access
    if (sessionKey && this._isSessionAccessMethod(method)) {
      const accessResult = this.checkSessionAccess(sessionKey, masAuth);
      if (!accessResult.allowed) {
        return accessResult;
      }
    }

    return { allowed: true };
  }

  /**
   * Filter sessions.list response to only include sessions the user has membership for.
   * Compat mode: return original list unchanged.
   */
  filterSessionsForUser(sessions: unknown[], masAuth: MasAuthContext): unknown[] {
    if (masAuth.userId === null) {
      return sessions;
    }

    const memberSessionKeys = new Set(sessionManager.listSessionsForUser(this.db, masAuth.userId));

    return sessions.filter((session) => {
      if (typeof session === "object" && session !== null) {
        const s = session as Record<string, unknown>;
        const key = s["key"] ?? s["sessionKey"];
        if (typeof key === "string") {
          return memberSessionKeys.has(key);
        }
      }
      return false;
    });
  }

  /**
   * Check session access for sessions.resolve, chat.send etc.
   * Compat mode: always allowed.
   */
  checkSessionAccess(
    sessionKey: string,
    masAuth: MasAuthContext,
  ): { allowed: true } | { allowed: false; code: string; message: string } {
    if (masAuth.userId === null) {
      return { allowed: true };
    }

    const hasAccess = sessionManager.checkSessionAccess(this.db, sessionKey, masAuth.userId);
    if (!hasAccess) {
      return {
        allowed: false,
        code: SESSION_ACCESS_DENIED,
        message: "You do not have access to this session",
      };
    }

    return { allowed: true };
  }

  /**
   * Called after sessions.create: record ownership and membership.
   */
  onSessionCreated(sessionKey: string, _label: string, masAuth: MasAuthContext): void {
    if (masAuth.userId === null || masAuth.tenantId === null) {
      return;
    }
    sessionManager.recordSessionCreated(this.db, sessionKey, masAuth.userId, masAuth.tenantId);
    console.log(
      `[mas4s] Session created: ${sessionKey} (User: ${masAuth.userId}, Tenant: ${masAuth.tenantId})`,
    );
  }

  /**
   * Invite user to session.
   */
  inviteToSession(params: {
    sessionKey: string;
    targetUserId: string;
    callerUserId: string;
  }): { ok: true; member: SessionMember } | { ok: false; code: string; message: string } {
    try {
      const member = sessionManager.inviteToSession(
        this.db,
        params.sessionKey,
        params.targetUserId,
        params.callerUserId,
      );
      return { ok: true, member };
    } catch (err) {
      if (err instanceof TenantServiceError) {
        return { ok: false, code: err.code, message: err.message };
      }
      throw err;
    }
  }

  /**
   * Remove member from session.
   */
  removeMember(params: {
    sessionKey: string;
    targetUserId: string;
    callerUserId: string;
  }): { ok: true } | { ok: false; code: string; message: string } {
    try {
      sessionManager.removeMember(
        this.db,
        params.sessionKey,
        params.targetUserId,
        params.callerUserId,
      );
      return { ok: true };
    } catch (err) {
      if (err instanceof TenantServiceError) {
        return { ok: false, code: err.code, message: err.message };
      }
      throw err;
    }
  }

  /**
   * List session members.
   */
  listSessionMembers(sessionKey: string, callerUserId: string): SessionMember[] {
    return sessionManager.listSessionMembers(this.db, sessionKey, callerUserId);
  }

  /**
   * Leave session.
   */
  leaveSession(
    sessionKey: string,
    callerUserId: string,
  ): { ok: true } | { ok: false; code: string; message: string } {
    try {
      sessionManager.leaveSession(this.db, sessionKey, callerUserId);
      return { ok: true };
    } catch (err) {
      if (err instanceof TenantServiceError) {
        return { ok: false, code: err.code, message: err.message };
      }
      throw err;
    }
  }

  /**
   * Get member userIds for broadcast filtering.
   */
  getSessionMemberUserIds(sessionKey: string): string[] {
    return sessionManager.getSessionMemberUserIds(this.db, sessionKey);
  }

  /**
   * Get owner userIds for approval event broadcast.
   */
  getSessionOwnerUserIds(sessionKey: string): string[] {
    return sessionManager.getSessionOwnerUserIds(this.db, sessionKey);
  }

  /**
   * Mark a user as offline (called on logout or WS disconnect).
   */
  logout(userId: string): void {
    console.log(`[mas4s:bridge] logout → marking offline userId=${userId}`);
    this.tenantService.logout(userId);
  }

  /**
   * Filter broadcast targets.
   * Returns Set<userId> of users who should receive the event.
   * Returns null in compat mode (no filtering).
   * chat/agent events: all session members
   * exec.approval.requested: only owners
   */
  filterBroadcastTargets(
    event: string,
    payload: unknown,
    connectedUsers: Map<string, MasAuthContext>,
  ): Set<string> | null {
    // Compat mode: any connected user with null userId means no filtering
    for (const auth of connectedUsers.values()) {
      if (auth.userId === null) {
        return null;
      }
    }

    // Extract sessionKey from payload
    const sessionKey =
      typeof payload === "object" && payload !== null
        ? ((payload as Record<string, unknown>)["sessionKey"] as string | undefined)
        : undefined;

    if (!sessionKey) {
      return null;
    }

    // Determine target user set based on event type
    let targetUserIds: string[];
    if (event === "exec.approval.requested") {
      targetUserIds = sessionManager.getSessionOwnerUserIds(this.db, sessionKey);
    } else {
      // chat, agent, and other session events: all members
      targetUserIds = sessionManager.getSessionMemberUserIds(this.db, sessionKey);
    }

    return new Set(targetUserIds);
  }

  /**
   * Push event:session.joined to target user's connected clients.
   */
  pushSessionJoined(
    targetUserId: string,
    payload: { sessionKey: string; label: string; invitedBy: string; joinedAt: number },
    connectedUsers: Map<string, MasAuthContext>,
    sendToClient: (userId: string, event: string, data: unknown) => void,
  ): void {
    for (const [userId, auth] of connectedUsers.entries()) {
      if (auth.userId === targetUserId) {
        sendToClient(userId, "session.joined", payload);
      }
    }
  }

  /**
   * Push user.presence event to all connected users in the same tenant.
   * Used to notify peers when a user comes online or goes offline.
   */
  pushUserPresence(
    userId: string,
    tenantId: string,
    isOnline: boolean,
    connectedUsers: Map<string, MasAuthContext>,
    sendToClient: (connId: string, event: string, data: unknown) => void,
  ): void {
    const payload = { userId, tenantId, isOnline, ts: Date.now() };
    for (const [connId, auth] of connectedUsers.entries()) {
      // Broadcast to same-tenant peers only (not the user themselves)
      if (auth.tenantId === tenantId && auth.userId !== userId) {
        sendToClient(connId, "user.presence", payload);
      }
    }
  }

  /**
   * Push event:session.removed to target user's connected clients.
   */
  pushSessionRemoved(
    targetUserId: string,
    payload: { sessionKey: string; removedBy: string },
    connectedUsers: Map<string, MasAuthContext>,
    sendToClient: (userId: string, event: string, data: unknown) => void,
  ): void {
    for (const [userId, auth] of connectedUsers.entries()) {
      if (auth.userId === targetUserId) {
        sendToClient(userId, "session.removed", payload);
      }
    }
  }

  // ── Private helpers ──

  /** Extract sessionKey from method params (various field names used across methods) */
  private _extractSessionKey(params: Record<string, unknown>): string | undefined {
    const key = params["sessionKey"] ?? params["key"] ?? params["session"];
    return typeof key === "string" ? key : undefined;
  }

  /** Methods that require session membership check */
  private _isSessionAccessMethod(method: string): boolean {
    return (
      method === "sessions.resolve" ||
      method === "chat.send" ||
      method === "session.invite" ||
      method === "session.removeMember" ||
      method === "session.members" ||
      method === "session.leave" ||
      method === "exec.approval.resolve"
    );
  }

  /** Get the caller's role in a session, or null if not a member */
  private _getSessionRole(sessionKey: string, userId: string): "owner" | "participant" | null {
    const row = this.db
      .prepare("SELECT role FROM session_memberships WHERE sessionKey = ? AND userId = ?")
      .get(sessionKey, userId) as { role: string } | undefined;
    if (!row) {
      return null;
    }
    return row.role as "owner" | "participant";
  }
}
