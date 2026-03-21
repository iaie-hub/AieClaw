import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  ADMIN_USERNAME_REQUIRED,
  PERMISSION_DENIED,
  TenantServiceError,
  USERNAME_TAKEN,
  WEAK_PASSWORD,
} from "../errors.js";
import type { GlobalRole, PublicUser, Tenant, User } from "../models.js";

// ── Password hashing ──────────────────────────────────────────────────────────
// NOTE: bcrypt is not available in this project's package.json.
// Using a sha256-based hash with a random salt as a fallback.
// In production, replace with bcrypt (cost factor >= 10) for proper security.

function hashPassword(plain: string): string {
  const salt = randomUUID(); // 36-char random salt
  const hash = createHash("sha256")
    .update(salt + plain)
    .digest("hex");
  return `sha256:${salt}:${hash}`;
}

function verifyPassword(plain: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "sha256") {
    return false;
  }
  const [, salt, hash] = parts as [string, string, string];
  const expected = createHash("sha256")
    .update(salt + plain)
    .digest("hex");
  // Constant-time comparison
  if (expected.length !== hash.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ hash.charCodeAt(i);
  }
  return diff === 0;
}

// ── Exported for auth module use ──────────────────────────────────────────────
export { hashPassword, verifyPassword };

// ── Password strength validation ──────────────────────────────────────────────

function validatePasswordStrength(password: string): void {
  if (password.length < 8) {
    throw new TenantServiceError(WEAK_PASSWORD, "Password must be at least 8 characters long.");
  }
}

// ── System status ─────────────────────────────────────────────────────────────

export function getSystemStatus(db: DatabaseSync): { initialized: boolean } {
  const row = db.prepare("SELECT COUNT(*) as count FROM users").get() as { count: number };
  return { initialized: row.count > 0 };
}

// ── Register user ─────────────────────────────────────────────────────────────

export interface RegisterParams {
  username: string;
  password: string;
  displayName: string;
  tenantId?: string;
}

export function registerUser(
  db: DatabaseSync,
  params: RegisterParams,
  callerRole?: GlobalRole,
): PublicUser {
  const { username, password, displayName } = params;
  const { initialized } = getSystemStatus(db);

  // Validate password strength first
  validatePasswordStrength(password);

  if (!initialized) {
    // First-ever registration: must be "admin"
    if (username !== "admin") {
      throw new TenantServiceError(
        ADMIN_USERNAME_REQUIRED,
        'The first user must have username "admin".',
      );
    }

    // Auto-create default tenant
    const tenantId = randomUUID();
    const now = Date.now();
    db.prepare("INSERT INTO tenants (tenantId, name, createdAt) VALUES (?, ?, ?)").run(
      tenantId,
      "Default",
      now,
    );

    const userId = randomUUID();
    const passwordHash = hashPassword(password);

    db.prepare(
      "INSERT INTO users (userId, username, displayName, passwordHash, role, tenantId, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(userId, username, displayName, passwordHash, "admin", tenantId, "approved", now);

    console.log(
      `[mas4s] System initialized: created initial admin user "${username}" (Tenant: ${tenantId})`,
    );

    return {
      userId,
      username,
      displayName,
      role: "admin",
      tenantId,
      status: "approved",
      createdAt: now,
    };
  }

  // System is initialized
  let resolvedTenantId = params.tenantId;
  let role: GlobalRole = "member";
  let status: User["status"] = "pending";

  if (!resolvedTenantId) {
    // No tenantId specified for self-registration:
    // Join the default (first) tenant instead of creating a new one,
    // so that the new user becomes a pending member of the main workspace.
    const defaultTenantRow = db
      .prepare("SELECT tenantId FROM tenants ORDER BY createdAt ASC LIMIT 1")
      .get() as { tenantId: string } | undefined;

    if (defaultTenantRow) {
      resolvedTenantId = defaultTenantRow.tenantId;
    } else {
      // Fallback in case of corruption
      resolvedTenantId = randomUUID();
      const now = Date.now();
      db.prepare("INSERT INTO tenants (tenantId, name, createdAt) VALUES (?, ?, ?)").run(
        resolvedTenantId,
        "Fallback Tenant",
        now,
      );
      role = "admin";
      status = "approved";
    }
  }

  if (callerRole === "admin") {
    // Admin creating user: skip approval
    status = "approved";
  }
  // else: self-registration → status stays "pending", role stays "member"

  // Check username uniqueness within the same tenantId
  const existing = db
    .prepare("SELECT userId FROM users WHERE tenantId = ? AND username = ?")
    .get(resolvedTenantId, username);
  if (existing) {
    throw new TenantServiceError(
      USERNAME_TAKEN,
      `Username "${username}" is already taken in this tenant.`,
    );
  }

  const userId = randomUUID();
  const now = Date.now();
  const passwordHash = hashPassword(password);

  db.prepare(
    "INSERT INTO users (userId, username, displayName, passwordHash, role, tenantId, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(userId, username, displayName, passwordHash, role, resolvedTenantId, status, now);

  console.log(
    `[mas4s] User registered: ${username} (Role: ${role}, Tenant: ${resolvedTenantId}, Status: ${status})`,
  );

  return {
    userId,
    username,
    displayName,
    role,
    tenantId: resolvedTenantId,
    status,
    createdAt: now,
  };
}

// ── List users ────────────────────────────────────────────────────────────────

export function listUsers(
  db: DatabaseSync,
  tenantId: string,
  callerRole: GlobalRole,
): PublicUser[] {
  if (callerRole === "admin") {
    const rows = db
      .prepare(
        `SELECT u.userId, u.username, u.displayName, u.role, u.tenantId, u.status, u.createdAt,
                COALESCE(p.isOnline, 0) AS isOnline
         FROM users u
         LEFT JOIN user_presence p ON u.userId = p.userId
         WHERE u.tenantId = ?`,
      )
      .all(tenantId) as (PublicUser & { isOnline: number })[];
    return rows.map((r) => ({ ...r, isOnline: r.isOnline === 1 }));
  }

  // member/viewer: only approved users, without status field
  const rows = db
    .prepare(
      `SELECT u.userId, u.username, u.displayName, u.role, u.tenantId, u.createdAt,
              COALESCE(p.isOnline, 0) AS isOnline
       FROM users u
       LEFT JOIN user_presence p ON u.userId = p.userId
       WHERE u.tenantId = ? AND u.status = 'approved'`,
    )
    .all(tenantId) as (Omit<PublicUser, "status"> & { isOnline: number })[];

  // Return with implicit approved status
  return rows.map((r) => ({ ...r, status: "approved" as const, isOnline: r.isOnline === 1 }));
}

// ── Update user ───────────────────────────────────────────────────────────────

export interface UpdateUserParams {
  userId: string;
  displayName?: string;
  role?: GlobalRole;
}

export function updateUser(
  db: DatabaseSync,
  params: UpdateUserParams,
  callerRole: GlobalRole,
): PublicUser {
  if (callerRole !== "admin") {
    throw new TenantServiceError(PERMISSION_DENIED, "Only admin can update users.");
  }

  const { userId, displayName, role } = params;

  if (displayName !== undefined) {
    db.prepare("UPDATE users SET displayName = ? WHERE userId = ?").run(displayName, userId);
  }
  if (role !== undefined) {
    db.prepare("UPDATE users SET role = ? WHERE userId = ?").run(role, userId);
  }

  const user = db
    .prepare(
      "SELECT userId, username, displayName, role, tenantId, status, createdAt FROM users WHERE userId = ?",
    )
    .get(userId) as PublicUser | undefined;

  if (!user) {
    throw new TenantServiceError("USER_NOT_FOUND", `User ${userId} not found.`);
  }

  return user;
}

// ── Approve / Reject user ─────────────────────────────────────────────────────

export function approveUser(db: DatabaseSync, targetUserId: string, callerRole: GlobalRole): void {
  if (callerRole !== "admin") {
    throw new TenantServiceError(PERMISSION_DENIED, "Only admin can approve users.");
  }
  db.prepare("UPDATE users SET status = 'approved' WHERE userId = ?").run(targetUserId);
}

export function rejectUser(db: DatabaseSync, targetUserId: string, callerRole: GlobalRole): void {
  if (callerRole !== "admin") {
    throw new TenantServiceError(PERMISSION_DENIED, "Only admin can reject users.");
  }
  db.prepare("UPDATE users SET status = 'rejected' WHERE userId = ?").run(targetUserId);
}

// ── Lookup helper (used by auth module) ──────────────────────────────────────

export function findUserByUsername(
  db: DatabaseSync,
  username: string,
  tenantId?: string,
): User | undefined {
  if (tenantId) {
    return db
      .prepare("SELECT * FROM users WHERE username = ? AND tenantId = ?")
      .get(username, tenantId) as User | undefined;
  }
  return db.prepare("SELECT * FROM users WHERE username = ?").get(username) as User | undefined;
}

export function findUserById(db: DatabaseSync, userId: string): User | undefined {
  return db.prepare("SELECT * FROM users WHERE userId = ?").get(userId) as User | undefined;
}

// ── Tenant lookup helper ──────────────────────────────────────────────────────

export function findTenantById(db: DatabaseSync, tenantId: string): Tenant | undefined {
  return db.prepare("SELECT * FROM tenants WHERE tenantId = ?").get(tenantId) as Tenant | undefined;
}
