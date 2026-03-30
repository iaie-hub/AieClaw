import type { DatabaseSync } from "node:sqlite";
import {
  TenantServiceError,
  ALREADY_MEMBER,
  NOT_A_MEMBER,
  OWNER_CANNOT_LEAVE,
  SESSION_ACCESS_DENIED,
} from "../errors.js";
import type { SessionMember } from "../models.js";
import { extractUuidFromKey } from "../utils/session-utils.js";

/**
 * Record session creation: create SessionOwnership AND SessionMembership (role="owner")
 */
export function recordSessionCreated(
  db: DatabaseSync,
  sessionKey: string,
  userId: string,
  tenantId: string,
): void {
  const uuid = extractUuidFromKey(sessionKey);
  const now = Date.now();
  db.prepare(
    "INSERT OR IGNORE INTO session_ownership (sessionUuid, userId, tenantId, createdAt) VALUES (?, ?, ?, ?)",
  ).run(uuid, userId, tenantId, now);
  db.prepare(
    "INSERT OR IGNORE INTO session_memberships (sessionUuid, userId, role, joinedAt) VALUES (?, ?, 'owner', ?)",
  ).run(uuid, userId, now);
}

/**
 * List all sessionUuuids where user has a membership
 */
export function listSessionsForUser(db: DatabaseSync, userId: string): string[] {
  const rows = db
    .prepare("SELECT sessionUuid FROM session_memberships WHERE userId = ?")
    .all(userId) as Array<{ sessionUuid: string }>;
  return rows.map((r) => r.sessionUuid);
}

/**
 * Check if user has membership for a session
 */
export function checkSessionAccess(db: DatabaseSync, identifier: string, userId: string): boolean {
  const uuid = identifier.includes(":") ? extractUuidFromKey(identifier) : identifier;
  const row = db
    .prepare("SELECT 1 FROM session_memberships WHERE sessionUuid = ? AND userId = ?")
    .get(uuid, userId);
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
  const uuid = extractUuidFromKey(sessionKey);
  // Check caller is a member
  if (!checkSessionAccess(db, uuid, callerUserId)) {
    throw new TenantServiceError(SESSION_ACCESS_DENIED, "You are not a member of this session");
  }

  // Check target is not already a member
  if (checkSessionAccess(db, uuid, targetUserId)) {
    throw new TenantServiceError(ALREADY_MEMBER, "User is already a member of this session");
  }

  const now = Date.now();
  db.prepare(
    "INSERT INTO session_memberships (sessionUuid, userId, role, joinedAt) VALUES (?, ?, 'participant', ?)",
  ).run(uuid, targetUserId, now);

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
  const uuid = extractUuidFromKey(sessionKey);
  // Check caller is the owner
  const callerRow = db
    .prepare("SELECT role FROM session_memberships WHERE sessionUuid = ? AND userId = ?")
    .get(uuid, callerUserId) as { role: string } | undefined;

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
  if (!checkSessionAccess(db, uuid, targetUserId)) {
    throw new TenantServiceError(NOT_A_MEMBER, "Target user is not a member of this session");
  }

  db.prepare("DELETE FROM session_memberships WHERE sessionUuid = ? AND userId = ?").run(
    uuid,
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
  identifier: string,
  callerUserId: string,
): SessionMember[] {
  const uuid = identifier.includes(":") ? extractUuidFromKey(identifier) : identifier;
  if (!checkSessionAccess(db, uuid, callerUserId)) {
    throw new TenantServiceError(SESSION_ACCESS_DENIED, "You are not a member of this session");
  }

  const rows = db
    .prepare(
      `SELECT sm.userId, u.displayName, sm.role, sm.joinedAt
       FROM session_memberships sm
       JOIN users u ON u.userId = sm.userId
       WHERE sm.sessionUuid = ?`,
    )
    .all(uuid) as Array<{
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
  const uuid = extractUuidFromKey(sessionKey);
  const row = db
    .prepare("SELECT role FROM session_memberships WHERE sessionUuid = ? AND userId = ?")
    .get(uuid, callerUserId) as { role: string } | undefined;

  if (!row) {
    throw new TenantServiceError(SESSION_ACCESS_DENIED, "You are not a member of this session");
  }

  if (row.role === "owner") {
    throw new TenantServiceError(OWNER_CANNOT_LEAVE, "Owner cannot leave the session");
  }

  db.prepare("DELETE FROM session_memberships WHERE sessionUuid = ? AND userId = ?").run(
    uuid,
    callerUserId,
  );
}

/**
 * Get all member userIds for a session (for broadcast filtering)
 */
export function getSessionMemberUserIds(db: DatabaseSync, identifier: string): string[] {
  const uuid = identifier.includes(":") ? extractUuidFromKey(identifier) : identifier;
  const rows = db
    .prepare("SELECT userId FROM session_memberships WHERE sessionUuid = ?")
    .all(uuid) as Array<{ userId: string }>;
  return rows.map((r) => r.userId);
}

/**
 * Get owner userIds for a session (for approval event broadcast)
 */
export function getSessionOwnerUserIds(db: DatabaseSync, identifier: string): string[] {
  const uuid = identifier.includes(":") ? extractUuidFromKey(identifier) : identifier;
  const rows = db
    .prepare("SELECT userId FROM session_memberships WHERE sessionUuid = ? AND role = 'owner'")
    .all(uuid) as Array<{ userId: string }>;
  return rows.map((r) => r.userId);
}

/**
 * Archive a session. Only the owner can archive.
 * Idempotent: if already archived, returns the existing archivedAt timestamp without updating.
 * Returns the archivedAt timestamp.
 */
export function archiveSession(db: DatabaseSync, sessionKey: string, callerUserId: string): number {
  const uuid = extractUuidFromKey(sessionKey);
  // Verify caller is the owner
  const callerRow = db
    .prepare("SELECT role FROM session_memberships WHERE sessionUuid = ? AND userId = ?")
    .get(uuid, callerUserId) as { role: string } | undefined;

  if (!callerRow || callerRow.role !== "owner") {
    throw new TenantServiceError(
      SESSION_ACCESS_DENIED,
      "Only the session owner can archive the session",
    );
  }

  // Check if already archived (idempotent)
  const ownership = db
    .prepare("SELECT archivedAt FROM session_ownership WHERE sessionUuid = ?")
    .get(uuid) as { archivedAt: number | null } | undefined;

  if (ownership?.archivedAt != null) {
    return ownership.archivedAt;
  }

  const now = Date.now();
  db.prepare("UPDATE session_ownership SET archivedAt = ? WHERE sessionUuid = ?").run(now, uuid);
  return now;
}

/**
 * Check if a session is archived (archivedAt is not NULL).
 */
export function isSessionArchived(db: DatabaseSync, identifier: string): boolean {
  const uuid = identifier.includes(":") ? extractUuidFromKey(identifier) : identifier;
  const row = db
    .prepare("SELECT archivedAt FROM session_ownership WHERE sessionUuid = ?")
    .get(uuid) as { archivedAt: number | null } | undefined;
  return row?.archivedAt != null;
}

/**
 * Unarchive a session (reset archivedAt to NULL). Only the owner can unarchive.
 */
export function unarchiveSession(db: DatabaseSync, sessionKey: string, callerUserId: string): void {
  const uuid = extractUuidFromKey(sessionKey);
  // Verify caller is the owner
  const callerRow = db
    .prepare("SELECT role FROM session_memberships WHERE sessionUuid = ? AND userId = ?")
    .get(uuid, callerUserId) as { role: string } | undefined;

  if (!callerRow || callerRow.role !== "owner") {
    throw new TenantServiceError(
      SESSION_ACCESS_DENIED,
      "Only the session owner can unarchive the session",
    );
  }

  db.prepare("UPDATE session_ownership SET archivedAt = NULL WHERE sessionUuid = ?").run(uuid);
}

/**
 * Delete all session records (ownership + memberships) for a deleted session.
 */
export function deleteSessionRecords(db: DatabaseSync, identifier: string): void {
  const uuid = identifier.includes(":") ? extractUuidFromKey(identifier) : identifier;
  db.prepare("DELETE FROM session_memberships WHERE sessionUuid = ?").run(uuid);
  db.prepare("DELETE FROM session_ownership WHERE sessionUuid = ?").run(uuid);
}
