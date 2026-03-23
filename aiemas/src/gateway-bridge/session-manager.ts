import type { DatabaseSync } from "node:sqlite";
import {
  TenantServiceError,
  ALREADY_MEMBER,
  NOT_A_MEMBER,
  OWNER_CANNOT_LEAVE,
  SESSION_ACCESS_DENIED,
} from "../errors.js";
import type { SessionMember } from "../models.js";

/**
 * Record session creation: create SessionOwnership AND SessionMembership (role="owner")
 */
export function recordSessionCreated(
  db: DatabaseSync,
  sessionKey: string,
  userId: string,
  tenantId: string,
): void {
  const now = Date.now();
  db.prepare(
    "INSERT OR IGNORE INTO session_ownership (sessionKey, userId, tenantId, createdAt) VALUES (?, ?, ?, ?)",
  ).run(sessionKey, userId, tenantId, now);
  db.prepare(
    "INSERT OR IGNORE INTO session_memberships (sessionKey, userId, role, joinedAt) VALUES (?, ?, 'owner', ?)",
  ).run(sessionKey, userId, now);
}

/**
 * List all sessionKeys where user has a membership
 */
export function listSessionsForUser(db: DatabaseSync, userId: string): string[] {
  const rows = db
    .prepare("SELECT sessionKey FROM session_memberships WHERE userId = ?")
    .all(userId) as Array<{ sessionKey: string }>;
  return rows.map((r) => r.sessionKey);
}

/**
 * Check if user has membership for a session
 */
export function checkSessionAccess(db: DatabaseSync, sessionKey: string, userId: string): boolean {
  const row = db
    .prepare("SELECT 1 FROM session_memberships WHERE sessionKey = ? AND userId = ?")
    .get(sessionKey, userId);
  return row != null;
}

/**
 * Invite user to session (immediate membership, no confirmation needed).
 * Both owner and participant can invite.
 * Returns ALREADY_MEMBER if targetUserId is already a member.
 * Returns SESSION_ACCESS_DENIED if callerUserId is not a member.
 */
export function inviteToSession(
  db: DatabaseSync,
  sessionKey: string,
  targetUserId: string,
  callerUserId: string,
): SessionMember {
  // Check caller is a member
  if (!checkSessionAccess(db, sessionKey, callerUserId)) {
    throw new TenantServiceError(SESSION_ACCESS_DENIED, "You are not a member of this session");
  }

  // Check target is not already a member
  if (checkSessionAccess(db, sessionKey, targetUserId)) {
    throw new TenantServiceError(ALREADY_MEMBER, "User is already a member of this session");
  }

  const now = Date.now();
  db.prepare(
    "INSERT INTO session_memberships (sessionKey, userId, role, joinedAt) VALUES (?, ?, 'participant', ?)",
  ).run(sessionKey, targetUserId, now);

  // Fetch displayName for the new member
  const user = db.prepare("SELECT displayName FROM users WHERE userId = ?").get(targetUserId) as
    | { displayName: string }
    | undefined;

  return {
    userId: targetUserId,
    displayName: user?.displayName ?? targetUserId,
    role: "participant",
    joinedAt: now,
  };
}

/**
 * Remove a member from session. Only owner can call.
 * Returns OWNER_CANNOT_LEAVE if trying to remove self (owner).
 * Returns NOT_A_MEMBER if targetUserId is not a member.
 * Returns SESSION_ACCESS_DENIED if callerUserId is not the owner.
 */
export function removeMember(
  db: DatabaseSync,
  sessionKey: string,
  targetUserId: string,
  callerUserId: string,
): void {
  // Check caller is the owner
  const callerRow = db
    .prepare("SELECT role FROM session_memberships WHERE sessionKey = ? AND userId = ?")
    .get(sessionKey, callerUserId) as { role: string } | undefined;

  if (!callerRow || callerRow.role !== "owner") {
    throw new TenantServiceError(
      SESSION_ACCESS_DENIED,
      "Only the session owner can remove members",
    );
  }

  // Owner cannot remove themselves
  if (targetUserId === callerUserId) {
    throw new TenantServiceError(
      OWNER_CANNOT_LEAVE,
      "Owner cannot remove themselves from the session",
    );
  }

  // Check target is a member
  if (!checkSessionAccess(db, sessionKey, targetUserId)) {
    throw new TenantServiceError(NOT_A_MEMBER, "Target user is not a member of this session");
  }

  db.prepare("DELETE FROM session_memberships WHERE sessionKey = ? AND userId = ?").run(
    sessionKey,
    targetUserId,
  );
}

/**
 * List all members of a session with their displayName.
 * Only members can call.
 * Returns SESSION_ACCESS_DENIED if callerUserId is not a member.
 */
export function listSessionMembers(
  db: DatabaseSync,
  sessionKey: string,
  callerUserId: string,
): SessionMember[] {
  if (!checkSessionAccess(db, sessionKey, callerUserId)) {
    throw new TenantServiceError(SESSION_ACCESS_DENIED, "You are not a member of this session");
  }

  const rows = db
    .prepare(
      `SELECT sm.userId, u.displayName, sm.role, sm.joinedAt
       FROM session_memberships sm
       JOIN users u ON u.userId = sm.userId
       WHERE sm.sessionKey = ?`,
    )
    .all(sessionKey) as Array<{
    userId: string;
    displayName: string;
    role: string;
    joinedAt: number;
  }>;

  return rows.map((r) => ({
    userId: r.userId,
    displayName: r.displayName,
    role: r.role as "owner" | "participant",
    joinedAt: r.joinedAt,
  }));
}

/**
 * Leave a session. Participant can leave, owner cannot.
 * Returns OWNER_CANNOT_LEAVE if owner tries to leave.
 * Returns SESSION_ACCESS_DENIED if not a member.
 */
export function leaveSession(db: DatabaseSync, sessionKey: string, callerUserId: string): void {
  const row = db
    .prepare("SELECT role FROM session_memberships WHERE sessionKey = ? AND userId = ?")
    .get(sessionKey, callerUserId) as { role: string } | undefined;

  if (!row) {
    throw new TenantServiceError(SESSION_ACCESS_DENIED, "You are not a member of this session");
  }

  if (row.role === "owner") {
    throw new TenantServiceError(OWNER_CANNOT_LEAVE, "Owner cannot leave the session");
  }

  db.prepare("DELETE FROM session_memberships WHERE sessionKey = ? AND userId = ?").run(
    sessionKey,
    callerUserId,
  );
}

/**
 * Get all member userIds for a session (for broadcast filtering)
 */
export function getSessionMemberUserIds(db: DatabaseSync, sessionKey: string): string[] {
  const rows = db
    .prepare("SELECT userId FROM session_memberships WHERE sessionKey = ?")
    .all(sessionKey) as Array<{ userId: string }>;
  return rows.map((r) => r.userId);
}

/**
 * Get owner userIds for a session (for approval event broadcast)
 */
export function getSessionOwnerUserIds(db: DatabaseSync, sessionKey: string): string[] {
  const rows = db
    .prepare("SELECT userId FROM session_memberships WHERE sessionKey = ? AND role = 'owner'")
    .all(sessionKey) as Array<{ userId: string }>;
  return rows.map((r) => r.userId);
}
