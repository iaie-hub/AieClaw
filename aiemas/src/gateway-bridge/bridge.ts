import type { DatabaseSync } from "node:sqlite";
import {
  TenantServiceError,
  SESSION_ACCESS_DENIED,
  SESSION_ARCHIVED,
  MAS_AUTH_FAILED,
} from "../errors.js";
import type { TenantService } from "../index.js";
import type { SessionMember } from "../models.js";
import type { SessionTranscriptStore } from "../session-history/session-transcript-store.js";
import type { MasAuthContext } from "./context.js";
import { NULL_MAS_AUTH } from "./context.js";
import * as sessionManager from "./session-manager.js";
import { extractContentFromStoredMessages, generateSummaryWithLLM } from "./summary-llm.js";
import type { StoredMessageForSummary } from "./summary-llm.js";

export class GatewayAuthBridge {
  constructor(
    private readonly tenantService: TenantService,
    private readonly db: DatabaseSync,
    public llmConfig?: { baseUrl: string; apiKey: string; model: string },
    private readonly transcriptStore?: SessionTranscriptStore,
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

    const { user } = result;

    return {
      userId: user.userId,
      tenantId: user.tenantId,
      masRole: user.role,
      displayName: user.displayName,
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

    // Archive check: block chat.send on archived sessions
    if (method === "chat.send" && sessionKey) {
      const archived = sessionManager.isSessionArchived(this.db, sessionKey);
      if (archived) {
        return { allowed: false, code: SESSION_ARCHIVED, message: "Session is archived" };
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

    return sessions
      .filter((session) => {
        if (typeof session === "object" && session !== null) {
          const s = session as Record<string, unknown>;
          const key = s["key"] ?? s["sessionKey"];
          if (typeof key === "string") {
            return memberSessionKeys.has(key);
          }
        }
        return false;
      })
      .map((session) =>
        enrichSessionRow(this.db, session as Record<string, unknown>, masAuth.userId!),
      );
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
    _connectedUsers: Map<string, MasAuthContext>,
  ): Set<string> | null {
    // Extract sessionKey from payload
    const payloadObj =
      typeof payload === "object" && payload !== null
        ? (payload as Record<string, unknown>)
        : undefined;
    const sessionKey = payloadObj?.["sessionKey"] as string | undefined;

    if (!sessionKey) {
      return null;
    }

    // Compat mode: if any connected client has no userId (e.g. legacy or unauthenticated system client),
    // skip filtering to ensure they receive essential system events.
    for (const context of _connectedUsers.values()) {
      if (context.userId === null) {
        return null;
      }
    }

    // Determine target user set based on event type
    let targetUserIds: string[];
    if (event === "exec.approval.requested") {
      targetUserIds = sessionManager.getSessionOwnerUserIds(this.db, sessionKey);
    } else {
      // chat, agent, and other session events: all members
      targetUserIds = sessionManager.getSessionMemberUserIds(this.db, sessionKey);

      // For chat:user events, exclude the sender to avoid double-rendering in the sender's UI
      if (event === "chat" && payloadObj?.["state"] === "user") {
        const senderUserId = payloadObj["senderUserId"];
        if (typeof senderUserId === "string") {
          const lowerSenderId = senderUserId.trim().toLowerCase();
          targetUserIds = targetUserIds.filter((id) => id.trim().toLowerCase() !== lowerSenderId);
        }
      }
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

  /**
   * Archive a session. Only owner can archive.
   * Auto-triggers summary generation; if messages are empty, summaryGenerated=false but archive still succeeds.
   */
  async archiveSession(params: {
    sessionKey: string;
    callerUserId: string;
    fetchHistory: () => Promise<StoredMessageForSummary[]>;
  }): Promise<
    | { ok: true; archivedAt: number; summaryGenerated: boolean }
    | { ok: false; code: string; message: string }
  > {
    try {
      const archivedAt = sessionManager.archiveSession(
        this.db,
        params.sessionKey,
        params.callerUserId,
      );

      // Auto-trigger summary generation (best-effort)
      let summaryGenerated = false;
      try {
        const result = await this.generateSummary({
          sessionKey: params.sessionKey,
          callerUserId: params.callerUserId,
          fetchHistory: params.fetchHistory,
        });
        summaryGenerated = result.ok && result.persisted;
      } catch {
        // Summary generation failure should not fail the archive
      }

      return { ok: true, archivedAt, summaryGenerated };
    } catch (err) {
      if (err instanceof TenantServiceError) {
        return { ok: false, code: err.code, message: err.message };
      }
      throw err;
    }
  }

  /**
   * Generate session summary.
   * - Not archived: verify caller is Session_Member (owner or participant), generate and return without persisting.
   * - Archived: verify caller is Session_Owner, generate, persist, and push event.
   */
  async generateSummary(params: {
    sessionKey: string;
    callerUserId: string;
    fetchHistory: () => Promise<StoredMessageForSummary[]>;
  }): Promise<
    | {
        ok: true;
        textSummary: string | null;
        toolSummary: string | null;
        generatedAt: number;
        persisted: boolean;
      }
    | { ok: false; code: string; message: string }
  > {
    const { sessionKey, callerUserId, fetchHistory } = params;
    const isArchived = sessionManager.isSessionArchived(this.db, sessionKey);

    if (!isArchived) {
      // Not archived: any Session_Member can generate (no persist)
      if (!sessionManager.checkSessionAccess(this.db, sessionKey, callerUserId)) {
        return {
          ok: false,
          code: SESSION_ACCESS_DENIED,
          message: "You are not a member of this session",
        };
      }
    } else {
      // Archived: only Session_Owner can generate (persist)
      const role = this._getSessionRole(sessionKey, callerUserId);
      if (role !== "owner") {
        return {
          ok: false,
          code: SESSION_ACCESS_DENIED,
          message: "Only the session owner can regenerate summary for archived sessions",
        };
      }
    }

    try {
      const messages = await fetchHistory();
      const { textLines, toolPairs } = extractContentFromStoredMessages(messages);
      const llmResult = await generateSummaryWithLLM(
        textLines,
        toolPairs,
        callerUserId,
        this.llmConfig,
      );

      if (isArchived) {
        this.transcriptStore?.persistSummary({
          sessionKey,
          textSummary: llmResult.textSummary,
          toolSummary: llmResult.toolSummary,
          generatedAt: llmResult.generatedAt,
          generatedBy: callerUserId,
        });
        return {
          ok: true,
          textSummary: llmResult.textSummary,
          toolSummary: llmResult.toolSummary,
          generatedAt: llmResult.generatedAt,
          persisted: true,
        };
      }

      // Not archived: return without persisting
      this.transcriptStore?.persistSummary({
        sessionKey,
        textSummary: llmResult.textSummary,
        toolSummary: llmResult.toolSummary,
        generatedAt: llmResult.generatedAt,
        generatedBy: callerUserId,
      });
      return {
        ok: true,
        textSummary: llmResult.textSummary,
        toolSummary: llmResult.toolSummary,
        generatedAt: llmResult.generatedAt,
        persisted: false,
      };
    } catch (err) {
      if (err instanceof TenantServiceError) {
        return { ok: false, code: err.code, message: err.message };
      }
      throw err;
    }
  }

  /**
   * Push event:session.archived to all online session members.
   */
  pushSessionArchived(
    sessionKey: string,
    payload: { sessionKey: string; archivedAt: number; archivedBy: string },
    connectedUsers: Map<string, MasAuthContext>,
    sendToClient: (connId: string, event: string, data: unknown) => void,
  ): void {
    const memberUserIds = new Set(sessionManager.getSessionMemberUserIds(this.db, sessionKey));
    for (const [connId, auth] of connectedUsers.entries()) {
      if (auth.userId && memberUserIds.has(auth.userId)) {
        sendToClient(connId, "session.archived", payload);
      }
    }
  }

  /**
   * Unarchive a session. Only owner can unarchive.
   */
  unarchiveSession(params: {
    sessionKey: string;
    callerUserId: string;
  }): { ok: true } | { ok: false; code: string; message: string } {
    try {
      sessionManager.unarchiveSession(this.db, params.sessionKey, params.callerUserId);
      return { ok: true };
    } catch (err) {
      if (err instanceof TenantServiceError) {
        return { ok: false, code: err.code, message: err.message };
      }
      throw err;
    }
  }

  /**
   * Push event:session.summary.updated to all online session members.
   */
  pushSummaryUpdated(
    sessionKey: string,
    payload: { sessionKey: string; generatedAt: number },
    connectedUsers: Map<string, MasAuthContext>,
    sendToClient: (connId: string, event: string, data: unknown) => void,
  ): void {
    const memberUserIds = new Set(sessionManager.getSessionMemberUserIds(this.db, sessionKey));
    for (const [connId, auth] of connectedUsers.entries()) {
      if (auth.userId && memberUserIds.has(auth.userId)) {
        sendToClient(connId, "session.summary.updated", payload);
      }
    }
  }

  /**
   * Called when a session is deleted: clean up membership/ownership records.
   */
  onSessionDeleted(sessionKey: string): void {
    sessionManager.deleteSessionRecords(this.db, sessionKey);
    console.log(`[mas4s] Session deleted: ${sessionKey}`);
  }

  /**
   * Push event:session.unarchived to all online session members.
   */
  pushSessionUnarchived(
    sessionKey: string,
    payload: { sessionKey: string; unarchivedBy: string },
    connectedUsers: Map<string, MasAuthContext>,
    sendToClient: (connId: string, event: string, data: unknown) => void,
  ): void {
    const memberUserIds = new Set(sessionManager.getSessionMemberUserIds(this.db, sessionKey));
    for (const [connId, auth] of connectedUsers.entries()) {
      if (auth.userId && memberUserIds.has(auth.userId)) {
        sendToClient(connId, "session.unarchived", payload);
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
      method === "exec.approval.resolve" ||
      method === "session.archive" ||
      method === "session.summary.generate" ||
      method === "session.summary.get" ||
      method === "session.unarchive"
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

// ── Module-level helpers ─────────────────────────────────────────────────────

/**
 * Enrich a session row with archivedAt, hasSummary and masRole fields.
 * Used by filterSessionsForUser to attach archive/summary/role metadata.
 */
function enrichSessionRow(
  db: DatabaseSync,
  session: Record<string, unknown>,
  userId: string,
): Record<string, unknown> {
  const sessionKey = (session["key"] ?? session["sessionKey"]) as string;
  const ownership = db
    .prepare("SELECT archivedAt FROM session_ownership WHERE sessionKey = ?")
    .get(sessionKey) as { archivedAt: number | null } | undefined;
  const membership = db
    .prepare("SELECT role FROM session_memberships WHERE sessionKey = ? AND userId = ?")
    .get(sessionKey, userId) as { role: string } | undefined;

  // Resolve displayName: always prefer persisted label in session_labels
  // (survives session resets because sessionKey is stable) over the gateway
  // value, which may be stale or derived from the sender name after a reset.
  const gatewayDisplayName = session["displayName"] as string | null | undefined;
  const persisted = db
    .prepare("SELECT label, displayName FROM session_labels WHERE sessionKey = ?")
    .get(sessionKey) as { label: string | null; displayName: string | null } | undefined;
  const resolvedDisplayName =
    persisted?.displayName ??
    persisted?.label ??
    gatewayDisplayName ??
    (session["label"] as string | null | undefined) ??
    null;

  return {
    ...session,
    displayName: resolvedDisplayName,
    archivedAt: ownership?.archivedAt ?? null,
    masRole: membership?.role ?? null,
  };
}
