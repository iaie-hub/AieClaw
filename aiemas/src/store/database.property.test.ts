/**
 * Property-based tests for SQLite storage layer.
 *
 * Feature: mas4s-multi-tenant-rbac
 * Property 15: 数据持久化 round-trip
 * Property 16: 并发写入安全
 */

import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as fc from "fast-check";
import { describe, it, expect, afterEach } from "vitest";
import { initDatabase } from "./database.js";

// Track temp paths for cleanup
const tempPaths: string[] = [];

function tmpDbPath(): string {
  const p = join(tmpdir(), `mas4s-prop-${randomUUID()}`, "mas4s.db");
  tempPaths.push(p);
  return p;
}

afterEach(() => {
  for (const p of tempPaths.splice(0)) {
    try {
      rmSync(join(p, ".."), { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  }
});

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

const tenantIdArb = fc.uuid();
const tenantNameArb = fc.string({ minLength: 1, maxLength: 64 });
const userIdArb = fc.uuid();
const usernameArb = fc
  .string({ minLength: 1, maxLength: 32 })
  .filter((s) => /^[a-zA-Z0-9_]+$/.test(s));
const displayNameArb = fc.string({ minLength: 1, maxLength: 64 });
const passwordHashArb = fc.string({ minLength: 8, maxLength: 128 });
const globalRoleArb = fc.constantFrom("admin" as const, "member" as const, "viewer" as const);
const userStatusArb = fc.constantFrom("pending" as const, "approved" as const, "rejected" as const);
const sessionRoleArb = fc.constantFrom("owner" as const, "participant" as const);
const sessionKeyArb = fc.uuid();
const timestampArb = fc.integer({ min: 1_000_000_000_000, max: 9_999_999_999_999 });

// ---------------------------------------------------------------------------
// Property 15: 数据持久化 round-trip
// Validates: Requirements 10.1, 10.2, 10.3, 10.4
// ---------------------------------------------------------------------------

describe("Property 15: 数据持久化 round-trip", () => {
  it("tenants table: written data survives close/reopen", () => {
    fc.assert(
      fc.property(tenantIdArb, tenantNameArb, timestampArb, (tenantId, name, createdAt) => {
        const dbPath = tmpDbPath();

        // Write
        const db1 = initDatabase(dbPath);
        db1
          .prepare("INSERT INTO tenants (tenantId, name, createdAt) VALUES (?, ?, ?)")
          .run(tenantId, name, createdAt);
        db1.close();

        // Reopen and read
        const db2 = initDatabase(dbPath);
        const row = db2
          .prepare("SELECT tenantId, name, createdAt FROM tenants WHERE tenantId = ?")
          .get(tenantId) as { tenantId: string; name: string; createdAt: number } | undefined;
        db2.close();

        expect(row).toBeDefined();
        expect(row!.tenantId).toBe(tenantId);
        expect(row!.name).toBe(name);
        expect(row!.createdAt).toBe(createdAt);
      }),
      { numRuns: 100 },
    );
  });

  it("users table: written data survives close/reopen", () => {
    fc.assert(
      fc.property(
        userIdArb,
        usernameArb,
        displayNameArb,
        passwordHashArb,
        globalRoleArb,
        userStatusArb,
        timestampArb,
        (userId, username, displayName, passwordHash, role, status, createdAt) => {
          const dbPath = tmpDbPath();
          const tenantId = randomUUID();

          const db1 = initDatabase(dbPath);
          db1
            .prepare("INSERT INTO tenants (tenantId, name, createdAt) VALUES (?, ?, ?)")
            .run(tenantId, "T", createdAt);
          db1
            .prepare(
              "INSERT INTO users (userId, username, displayName, passwordHash, role, tenantId, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .run(userId, username, displayName, passwordHash, role, tenantId, status, createdAt);
          db1.close();

          const db2 = initDatabase(dbPath);
          const row = db2.prepare("SELECT * FROM users WHERE userId = ?").get(userId) as
            | Record<string, unknown>
            | undefined;
          db2.close();

          expect(row).toBeDefined();
          expect(row!["userId"]).toBe(userId);
          expect(row!["username"]).toBe(username);
          expect(row!["displayName"]).toBe(displayName);
          expect(row!["passwordHash"]).toBe(passwordHash);
          expect(row!["role"]).toBe(role);
          expect(row!["tenantId"]).toBe(tenantId);
          expect(row!["status"]).toBe(status);
          expect(row!["createdAt"]).toBe(createdAt);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("session_ownership table: written data survives close/reopen", () => {
    fc.assert(
      fc.property(sessionKeyArb, timestampArb, (sessionKey, createdAt) => {
        const dbPath = tmpDbPath();
        const tenantId = randomUUID();
        const userId = randomUUID();

        const db1 = initDatabase(dbPath);
        db1
          .prepare("INSERT INTO tenants (tenantId, name, createdAt) VALUES (?, ?, ?)")
          .run(tenantId, "T", createdAt);
        db1
          .prepare(
            "INSERT INTO users (userId, username, displayName, passwordHash, role, tenantId, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .run(userId, "u", "U", "h", "member", tenantId, "approved", createdAt);
        db1
          .prepare(
            "INSERT INTO session_ownership (sessionKey, userId, tenantId, createdAt) VALUES (?, ?, ?, ?)",
          )
          .run(sessionKey, userId, tenantId, createdAt);
        db1.close();

        const db2 = initDatabase(dbPath);
        const row = db2
          .prepare("SELECT * FROM session_ownership WHERE sessionKey = ?")
          .get(sessionKey) as Record<string, unknown> | undefined;
        db2.close();

        expect(row).toBeDefined();
        expect(row!["sessionKey"]).toBe(sessionKey);
        expect(row!["userId"]).toBe(userId);
        expect(row!["tenantId"]).toBe(tenantId);
        expect(row!["createdAt"]).toBe(createdAt);
      }),
      { numRuns: 100 },
    );
  });

  it("session_memberships table: written data survives close/reopen", () => {
    fc.assert(
      fc.property(sessionKeyArb, sessionRoleArb, timestampArb, (sessionKey, role, joinedAt) => {
        const dbPath = tmpDbPath();
        const tenantId = randomUUID();
        const userId = randomUUID();

        const db1 = initDatabase(dbPath);
        db1
          .prepare("INSERT INTO tenants (tenantId, name, createdAt) VALUES (?, ?, ?)")
          .run(tenantId, "T", joinedAt);
        db1
          .prepare(
            "INSERT INTO users (userId, username, displayName, passwordHash, role, tenantId, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          )
          .run(userId, "u", "U", "h", "member", tenantId, "approved", joinedAt);
        db1
          .prepare(
            "INSERT INTO session_memberships (sessionKey, userId, role, joinedAt) VALUES (?, ?, ?, ?)",
          )
          .run(sessionKey, userId, role, joinedAt);
        db1.close();

        const db2 = initDatabase(dbPath);
        const row = db2
          .prepare("SELECT * FROM session_memberships WHERE sessionKey = ? AND userId = ?")
          .get(sessionKey, userId) as Record<string, unknown> | undefined;
        db2.close();

        expect(row).toBeDefined();
        expect(row!["sessionKey"]).toBe(sessionKey);
        expect(row!["userId"]).toBe(userId);
        expect(row!["role"]).toBe(role);
        expect(row!["joinedAt"]).toBe(joinedAt);
      }),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 16: 并发写入安全
// Validates: Requirements 10.6
// ---------------------------------------------------------------------------

describe("Property 16: 并发写入安全", () => {
  it("N sequential inserts all persist correctly (WAL + busy_timeout)", () => {
    // node:sqlite DatabaseSync is synchronous; we simulate concurrent-access
    // patterns by performing N rapid sequential writes and verifying all persist.
    fc.assert(
      fc.property(fc.integer({ min: 10, max: 50 }), timestampArb, (n, baseTime) => {
        const dbPath = tmpDbPath();
        const tenantId = randomUUID();

        const db = initDatabase(dbPath);
        db.prepare("INSERT INTO tenants (tenantId, name, createdAt) VALUES (?, ?, ?)").run(
          tenantId,
          "T",
          baseTime,
        );

        // Insert N users in rapid succession
        const userIds: string[] = [];
        for (let i = 0; i < n; i++) {
          const userId = randomUUID();
          userIds.push(userId);
          db.prepare(
            "INSERT INTO users (userId, username, displayName, passwordHash, role, tenantId, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          ).run(
            userId,
            `user_${i}_${userId.slice(0, 8)}`,
            `User ${i}`,
            "hash",
            "member",
            tenantId,
            "approved",
            baseTime + i,
          );
        }
        db.close();

        // Reopen and verify all N rows are present
        const db2 = initDatabase(dbPath);
        const count = (
          db2.prepare("SELECT COUNT(*) as cnt FROM users WHERE tenantId = ?").get(tenantId) as {
            cnt: number;
          }
        ).cnt;
        db2.close();

        expect(count).toBe(n);
      }),
      { numRuns: 100 },
    );
  });

  it("interleaved writes across multiple tables all persist (no data loss)", () => {
    fc.assert(
      fc.property(fc.integer({ min: 5, max: 20 }), timestampArb, (n, baseTime) => {
        const dbPath = tmpDbPath();

        const db = initDatabase(dbPath);

        // Create n tenants, each with one user and one session
        const tenantIds: string[] = [];
        const userIds: string[] = [];
        const sessionKeys: string[] = [];

        for (let i = 0; i < n; i++) {
          const tenantId = randomUUID();
          const userId = randomUUID();
          const sessionKey = randomUUID();
          tenantIds.push(tenantId);
          userIds.push(userId);
          sessionKeys.push(sessionKey);

          db.prepare("INSERT INTO tenants (tenantId, name, createdAt) VALUES (?, ?, ?)").run(
            tenantId,
            `Tenant ${i}`,
            baseTime + i,
          );
          db.prepare(
            "INSERT INTO users (userId, username, displayName, passwordHash, role, tenantId, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          ).run(
            userId,
            `u${i}_${userId.slice(0, 8)}`,
            `User ${i}`,
            "hash",
            "admin",
            tenantId,
            "approved",
            baseTime + i,
          );
          db.prepare(
            "INSERT INTO session_ownership (sessionKey, userId, tenantId, createdAt) VALUES (?, ?, ?, ?)",
          ).run(sessionKey, userId, tenantId, baseTime + i);
          db.prepare(
            "INSERT INTO session_memberships (sessionKey, userId, role, joinedAt) VALUES (?, ?, ?, ?)",
          ).run(sessionKey, userId, "owner", baseTime + i);
        }
        db.close();

        // Reopen and verify counts across all tables
        const db2 = initDatabase(dbPath);
        const tenantCount = (
          db2.prepare("SELECT COUNT(*) as cnt FROM tenants").get() as { cnt: number }
        ).cnt;
        const userCount = (
          db2.prepare("SELECT COUNT(*) as cnt FROM users").get() as { cnt: number }
        ).cnt;
        const ownershipCount = (
          db2.prepare("SELECT COUNT(*) as cnt FROM session_ownership").get() as { cnt: number }
        ).cnt;
        const membershipCount = (
          db2.prepare("SELECT COUNT(*) as cnt FROM session_memberships").get() as { cnt: number }
        ).cnt;
        db2.close();

        expect(tenantCount).toBe(n);
        expect(userCount).toBe(n);
        expect(ownershipCount).toBe(n);
        expect(membershipCount).toBe(n);
      }),
      { numRuns: 100 },
    );
  });
});
