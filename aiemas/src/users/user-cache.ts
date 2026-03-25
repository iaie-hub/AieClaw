/**
 * In-memory user cache for the aiemas TenantService.
 *
 * Loaded from the database on init(); kept in sync on every mutation
 * (register, update, approve, reject). Lookups (findById, findByUsername,
 * login, verify) never touch the database.
 *
 * Thread-safety: Node.js is single-threaded, so Map operations are atomic.
 */

import type { DatabaseSync } from "node:sqlite";
import type { User } from "../models.js";

// ── Types ─────────────────────────────────────────────────────────────────────

/** Minimal mutable fields stored in the cache (full User shape). */
export type CachedUser = User;

// ── UserCache ─────────────────────────────────────────────────────────────────

export class UserCache {
  /** Primary index: userId → User */
  private readonly byId = new Map<string, CachedUser>();

  /**
   * Secondary index: `${tenantId}:${username}` → userId
   * Allows O(1) username lookup without scanning byId.
   */
  private readonly byTenantUsername = new Map<string, string>();

  // ── Load ──────────────────────────────────────────────────────────────────

  /**
   * Populate the cache from the database.
   * Called once during TenantService.init().
   */
  load(db: DatabaseSync): void {
    this.byId.clear();
    this.byTenantUsername.clear();

    const rows = db.prepare("SELECT * FROM users").all() as unknown as CachedUser[];
    for (const row of rows) {
      this._set(row);
    }
    console.log(`[mas4s:user-cache] loaded ${this.byId.size} user(s)`);
  }

  // ── Reads ─────────────────────────────────────────────────────────────────

  findById(userId: string): CachedUser | undefined {
    return this.byId.get(userId);
  }

  findByUsername(username: string, tenantId?: string): CachedUser | undefined {
    if (tenantId) {
      const uid = this.byTenantUsername.get(`${tenantId}:${username}`);
      return uid ? this.byId.get(uid) : undefined;
    }
    // No tenantId: scan all (rare path — only used during first-user bootstrap)
    for (const user of this.byId.values()) {
      if (user.username === username) {
        return user;
      }
    }
    return undefined;
  }

  size(): number {
    return this.byId.size;
  }

  // ── Writes ────────────────────────────────────────────────────────────────

  /** Insert or fully replace a user entry. */
  set(user: CachedUser): void {
    // Remove stale secondary index entry if username changed
    const existing = this.byId.get(user.userId);
    if (existing && existing.username !== user.username) {
      this.byTenantUsername.delete(`${existing.tenantId}:${existing.username}`);
    }
    this._set(user);
  }

  /** Patch mutable fields on an existing entry. Returns the updated user or undefined. */
  patch(
    userId: string,
    fields: Partial<Pick<CachedUser, "displayName" | "role" | "status">>,
  ): CachedUser | undefined {
    const existing = this.byId.get(userId);
    if (!existing) {
      return undefined;
    }
    const updated: CachedUser = { ...existing, ...fields };
    this._set(updated);
    return updated;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _set(user: CachedUser): void {
    this.byId.set(user.userId, user);
    this.byTenantUsername.set(`${user.tenantId}:${user.username}`, user.userId);
  }
}
