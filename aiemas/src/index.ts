import { homedir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { logPermissionFailure } from "./audit/audit-logger.js";
import { signToken, verifyToken, refreshToken, getJwtSecret } from "./auth/jwt.js";
import { AUTH_FAILED, ACCOUNT_PENDING_APPROVAL, ACCOUNT_REJECTED } from "./errors.js";
import type { GlobalRole, PublicUser } from "./models.js";
import { checkPermission as _checkPermission } from "./rbac/permission-checker.js";
import type { SessionPermissionContext, PermissionResult } from "./rbac/permission-checker.js";
import { initDatabase } from "./store/database.js";
import {
  registerUser,
  listUsers,
  updateUser,
  approveUser,
  rejectUser,
  findUserByUsername,
  verifyPassword,
  getSystemStatus,
} from "./users/user-service.js";
import type { RegisterParams, UpdateUserParams } from "./users/user-service.js";

export type { GlobalRole, PublicUser } from "./models.js";
export type { SessionPermissionContext, PermissionResult } from "./rbac/permission-checker.js";
export type { RegisterParams, UpdateUserParams } from "./users/user-service.js";

export interface TenantServiceConfig {
  jwtSecret?: string;
  dbPath?: string;
  bcryptRounds?: number;
  tokenExpirySeconds?: number;
}

export interface TenantService {
  // Auth
  login(params: {
    username: string;
    password: string;
    tenantId?: string;
    clientIp?: string;
  }):
    | { ok: true; token: string; user: PublicUser }
    | { ok: false; error: string; retryAfterMs?: number };

  verify(
    token: string,
  ):
    | { ok: true; userId: string; tenantId: string; role: GlobalRole }
    | { ok: false; error: string };

  refresh(token: string): { ok: true; token: string } | { ok: false; error: string };

  // User management
  registerUser(params: RegisterParams, callerRole?: GlobalRole): PublicUser;
  listUsers(tenantId: string, callerRole: GlobalRole): PublicUser[];
  updateUser(params: UpdateUserParams, callerRole: GlobalRole): PublicUser;
  approveUser(targetUserId: string, callerRole: GlobalRole): void;
  rejectUser(targetUserId: string, callerRole: GlobalRole): void;

  // Permission
  checkPermission(
    userId: string | null,
    role: GlobalRole | null,
    method: string,
    sessionContext?: SessionPermissionContext,
  ): PermissionResult;

  // Rate limiting
  checkLoginRateLimit(
    clientIp: string,
  ): { allowed: true } | { allowed: false; retryAfterMs: number };

  // System status
  getSystemStatus(): { initialized: boolean };

  // Lifecycle
  init(): Promise<void>;
}

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_FAILURES = 10;

export function createTenantService(config?: TenantServiceConfig): TenantService {
  const dbPath = config?.dbPath ?? join(homedir(), ".openclaw", "aiemas", "mas4s.db");

  // eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
  let db: DatabaseSync | undefined;

  // In-memory sliding window rate limiter: ip -> timestamps of failures
  const failureMap = new Map<string, number[]>();

  function getDb(): DatabaseSync {
    if (!db) {
      throw new Error("TenantService not initialized. Call init() first.");
    }
    return db;
  }

  return {
    async init(): Promise<void> {
      // Set JWT secret from config if provided
      if (config?.jwtSecret) {
        process.env["MAS4S_JWT_SECRET"] = config.jwtSecret;
      }
      // Ensure secret is loaded (triggers warning if not set)
      getJwtSecret();
      // Initialize database
      db = initDatabase(dbPath);
    },

    login(params) {
      const { username, password, tenantId, clientIp } = params;

      // Check rate limit first
      if (clientIp) {
        const limitResult = this.checkLoginRateLimit(clientIp);
        if (!limitResult.allowed) {
          return { ok: false, error: "RATE_LIMITED", retryAfterMs: limitResult.retryAfterMs };
        }
      }

      const database = getDb();

      // Find user by username (and optional tenantId)
      const user = findUserByUsername(database, username, tenantId);

      if (!user) {
        // Record failure for rate limiting
        if (clientIp) {
          recordLoginFailure(failureMap, clientIp);
        }
        return { ok: false, error: AUTH_FAILED };
      }

      // Verify password
      if (!verifyPassword(password, user.passwordHash)) {
        if (clientIp) {
          recordLoginFailure(failureMap, clientIp);
        }
        return { ok: false, error: AUTH_FAILED };
      }

      // Check user status
      if (user.status === "pending") {
        return { ok: false, error: ACCOUNT_PENDING_APPROVAL };
      }
      if (user.status === "rejected") {
        return { ok: false, error: ACCOUNT_REJECTED };
      }

      // Sign token
      const token = signToken({ userId: user.userId, tenantId: user.tenantId, role: user.role });

      const publicUser: PublicUser = {
        userId: user.userId,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        tenantId: user.tenantId,
        status: user.status,
        createdAt: user.createdAt,
      };

      return { ok: true, token, user: publicUser };
    },

    verify(token) {
      try {
        const claims = verifyToken(token);
        return { ok: true, userId: claims.userId, tenantId: claims.tenantId, role: claims.role };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message };
      }
    },

    refresh(token) {
      try {
        const newToken = refreshToken(token);
        return { ok: true, token: newToken };
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message };
      }
    },

    registerUser(params, callerRole) {
      return registerUser(getDb(), params, callerRole);
    },

    listUsers(tenantId, callerRole) {
      return listUsers(getDb(), tenantId, callerRole);
    },

    updateUser(params, callerRole) {
      return updateUser(getDb(), params, callerRole);
    },

    approveUser(targetUserId, callerRole) {
      approveUser(getDb(), targetUserId, callerRole);
    },

    rejectUser(targetUserId, callerRole) {
      rejectUser(getDb(), targetUserId, callerRole);
    },

    checkPermission(userId, role, method, sessionContext) {
      return _checkPermission(userId, role, method, sessionContext, (uid, meth, reason) => {
        logPermissionFailure({
          userId: uid,
          action: meth,
          resource: meth,
          timestamp: Date.now(),
          result: "denied",
          reason,
        });
      });
    },

    checkLoginRateLimit(clientIp) {
      const now = Date.now();
      const windowStart = now - RATE_LIMIT_WINDOW_MS;
      const timestamps = (failureMap.get(clientIp) ?? []).filter((t) => t > windowStart);
      failureMap.set(clientIp, timestamps);

      if (timestamps.length >= RATE_LIMIT_MAX_FAILURES) {
        const oldest = timestamps[0];
        const retryAfterMs = oldest + RATE_LIMIT_WINDOW_MS - now;
        return { allowed: false, retryAfterMs: Math.max(retryAfterMs, 0) };
      }

      return { allowed: true };
    },

    getSystemStatus() {
      return getSystemStatus(getDb());
    },
  };
}

function recordLoginFailure(failureMap: Map<string, number[]>, clientIp: string): void {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;
  const timestamps = (failureMap.get(clientIp) ?? []).filter((t) => t > windowStart);
  timestamps.push(now);
  failureMap.set(clientIp, timestamps);
}
