import type { DatabaseSync } from "node:sqlite";
import {
  TenantServiceError,
  SESSION_ACCESS_DENIED,
  SESSION_ARCHIVED,
  MAS_AUTH_FAILED,
} from "../errors.js";
import type { TenantService } from "../index.js";
import type { SessionMember } from "../models.js";
import { getSessionLabel } from "../session-history/session-label-store.js";
import type { SessionTranscriptStore } from "../session-history/session-transcript-store.js";
import {
  extractUuidFromKey,
  extractAgentNameFromKey,
  constructKeyFromUuid,
} from "../utils/session-utils.js";
import type { MasAuthContext } from "./context.js";
import { NULL_MAS_AUTH } from "./context.js";
import * as sessionManager from "./session-manager.js";
import { extractContentFromStoredMessages, generateSummaryWithLLM } from "./summary-llm.js";
import type { StoredMessageForSummary } from "./summary-llm.js";

export class GatewayAuthBridge {
  private loadSessionRow?: (sessionKey: string) => { sessionId?: string } | null;

  constructor(
    private readonly tenantService: TenantService,
    private readonly db: DatabaseSync,
    public llmConfig?: { baseUrl: string; apiKey: string; model: string },
    private readonly transcriptStore?: SessionTranscriptStore,
  ) {}

  /**
   * Set the loadSessionRow callback for resolving sessionId from sessionKey.
   * This is called by the integration layer after plugin creation.
   */
  setLoadSessionRow(fn: (sessionKey: string) => { sessionId?: string } | null): void {
    this.loadSessionRow = fn;
  }

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
      // Look up the caller's session role by UUID
      const uuid = extractUuidFromKey(sessionKey);
      const sessionRole = this.getSessionRole(uuid, masAuth.userId);
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
   * Dynamic: routes session record to the currently assigned agent.
   */
  filterSessionsForUser(sessions: unknown[], masAuth: MasAuthContext): unknown[] {
    if (masAuth.userId === null) {
      return sessions;
    }

    const memberUuids = new Set(sessionManager.listSessionsForUser(this.db, masAuth.userId));
    const seenUuids = new Set<string>();
    const result: unknown[] = [];

    for (const session of sessions) {
      if (typeof session === "object" && session !== null) {
        const s = session as Record<string, unknown>;
        const key = (s["key"] ?? s["sessionKey"]) as string | undefined;
        if (typeof key === "string") {
          const uuid = extractUuidFromKey(key);
          if (memberUuids.has(uuid) && !seenUuids.has(uuid)) {
            seenUuids.add(uuid);
            result.push(enrichSessionRow(this.db, s, masAuth.userId));
          }
        }
      }
    }

    return result;
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
    const debugLog = (...args: unknown[]) => {
      if (process.env.OPENCLAW_MAS4S_DEBUG_EVENTS === "1") {
        console.log(...args);
      }
    };

    // Extract sessionKey from payload
    const payloadObj =
      typeof payload === "object" && payload !== null
        ? (payload as Record<string, unknown>)
        : undefined;

    // exec.approval.* events carry sessionKey inside request.sessionKey, not at top level
    const sessionKey =
      (payloadObj?.["sessionKey"] as string | undefined) ??
      ((payloadObj?.["request"] as Record<string, unknown> | undefined)?.["sessionKey"] as
        | string
        | undefined);

    debugLog(
      `[bridge.filterBroadcastTargets] event=${event} sessionKey=${sessionKey ?? "(none)"} connectedUsers=${_connectedUsers.size} payloadKeys=${Object.keys(payloadObj ?? {}).join(",")}`,
    );

    if (!sessionKey) {
      if (process.env.OPENCLAW_MAS4S_DEBUG === "1") {
        console.log(
          `[aiemas:bridge] filterBroadcastTargets event=${event} → MISSING sessionKey, broadcasting to ALL`,
        );
      }
      return null;
    }

    // Compat mode: if any connected client has no userId (e.g. legacy or unauthenticated system client),
    // skip filtering to ensure they receive essential system events.
    for (const context of _connectedUsers.values()) {
      if (context.userId === null) {
        debugLog(
          `[bridge.filterBroadcastTargets] event=${event} compat-mode: unauthenticated client present, skipping filter`,
        );
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

    debugLog(
      `[bridge.filterBroadcastTargets] event=${event} sessionKey=${sessionKey} targetUserIds=[${targetUserIds.join(",")}]`,
    );

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
      const uuid = extractUuidFromKey(sessionKey);
      const role = this.getSessionRole(uuid, callerUserId);
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
        // For archived sessions, sessionId must be resolved from the gateway session entry
        // because sessions.reset generates a new sessionId while keeping the same sessionKey.
        const sessionId = this._resolveSessionId(sessionKey);
        const sessionUuid = extractUuidFromKey(sessionKey);
        this.transcriptStore?.persistSummary({
          sessionUuid,
          sessionKey,
          sessionId,
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
      const sessionId = this._resolveSessionId(sessionKey);
      const sessionUuid = extractUuidFromKey(sessionKey);
      this.transcriptStore?.persistSummary({
        sessionUuid,
        sessionKey,
        sessionId,
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
  public getSessionRole(uuid: string, userId: string): "owner" | "participant" | null {
    const row = this.db
      .prepare("SELECT role FROM session_memberships WHERE sessionUuid = ? AND userId = ?")
      .get(uuid, userId) as { role: string } | undefined;
    if (!row) {
      return null;
    }
    return row.role as "owner" | "participant";
  }

  /**
   * Resolve sessionId from sessionKey via the gateway session store.
   * Falls back to sessionKey if loadSessionRow callback is not available or returns null.
   * This is critical for sessions.reset, which generates a new sessionId while keeping
   * the same sessionKey.
   */
  private _resolveSessionId(sessionKey: string): string {
    if (this.loadSessionRow) {
      const row = this.loadSessionRow(sessionKey);
      if (row?.sessionId) {
        return row.sessionId;
      }
    }
    return sessionKey;
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
  const uuid = extractUuidFromKey(sessionKey);

  const ownership = db
    .prepare("SELECT archivedAt FROM session_ownership WHERE sessionUuid = ?")
    .get(uuid) as { archivedAt: number | null } | undefined;
  const membership = db
    .prepare("SELECT role FROM session_memberships WHERE sessionUuid = ? AND userId = ?")
    .get(uuid, userId) as { role: string } | undefined;

  // Resolve and route: use currentAgentId from labels to construct the live sessionKey
  const labelEntry = getSessionLabel(db, uuid);
  const currentAgentId = labelEntry?.currentAgentId ?? extractAgentNameFromKey(sessionKey);
  const liveKey = constructKeyFromUuid(currentAgentId, uuid);

  const gatewayDisplayName = session["displayName"] as string | null | undefined;
  const resolvedDisplayName =
    labelEntry?.displayName ??
    labelEntry?.label ??
    gatewayDisplayName ??
    (session["label"] as string | null | undefined) ??
    null;

  return {
    ...session,
    key: liveKey,
    sessionKey: liveKey,
    displayName: resolvedDisplayName,
    archivedAt: ownership?.archivedAt ?? null,
    masRole: membership?.role ?? null,
    currentAgentId,
    sessionUuid: uuid,
  };
}
