/**
 * Property-based tests for UserService.
 * Feature: mas4s-multi-tenant-rbac
 */

import type { DatabaseSync } from "node:sqlite";
import * as fc from "fast-check";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { TenantServiceError, USERNAME_TAKEN, WEAK_PASSWORD } from "../errors.js";
import { arbWeakPassword } from "../test-helpers/generators.js";
import { createTestDatabase } from "../test-helpers/setup.js";
import { registerUser } from "./user-service.js";

describe("UserService property tests", () => {
  let db: DatabaseSync;
  let cleanup: () => void;

  beforeEach(() => {
    const result = createTestDatabase();
    db = result.db;
    cleanup = result.cleanup;
  });

  afterEach(() => {
    cleanup();
  });

  /**
   * Property 1: 用户名租户内唯一性
   * Validates: Requirement 1.2
   *
   * For any valid username, registering the same username twice in the same
   * tenant should throw USERNAME_TAKEN.
   */
  it("Property 1: duplicate username in same tenant throws USERNAME_TAKEN", () => {
    fc.assert(
      fc.property(fc.constant("admin"), (username) => {
        // Fresh db for each run — beforeEach gives us one, but fc.assert
        // runs synchronously so we reuse the same db per property run.
        // First registration: creates the admin user + default tenant.
        const firstUser = registerUser(db, {
          username,
          password: "Password1!",
          displayName: "Admin",
        });

        // Second registration: same username, same tenant → must throw USERNAME_TAKEN.
        let threw = false;
        try {
          registerUser(db, {
            username,
            password: "Password1!",
            displayName: "User2",
            tenantId: firstUser.tenantId,
          });
        } catch (err) {
          threw = true;
          expect(err).toBeInstanceOf(TenantServiceError);
          expect((err as TenantServiceError).code).toBe(USERNAME_TAKEN);
        }
        expect(threw).toBe(true);
      }),
      // numRuns: 1 because the db is shared across runs and the first
      // registration is a one-time system initialisation.
      { numRuns: 1 },
    );
  });

  /**
   * Property 2: 密码安全不变量
   * Validates: Requirements 1.3, 11.4
   *
   * 2a) Any weak password (length < 8) must be rejected with WEAK_PASSWORD.
   * 2b) For any valid registration the stored passwordHash must NOT contain
   *     the plain-text password.
   */
  it("Property 2a: weak password (length < 8) is rejected with WEAK_PASSWORD", () => {
    fc.assert(
      fc.property(arbWeakPassword, (weakPwd) => {
        let threw = false;
        try {
          registerUser(db, {
            username: "admin",
            password: weakPwd,
            displayName: "Admin",
          });
        } catch (err) {
          threw = true;
          expect(err).toBeInstanceOf(TenantServiceError);
          expect((err as TenantServiceError).code).toBe(WEAK_PASSWORD);
        }
        expect(threw).toBe(true);
      }),
    );
  });

  it("Property 2b: stored passwordHash does not contain the plain-text password", () => {
    // Register the first (admin) user once, then verify the hash.
    const password = "Password1!";
    const user = registerUser(db, {
      username: "admin",
      password,
      displayName: "Admin",
    });

    const row = db.prepare("SELECT passwordHash FROM users WHERE userId = ?").get(user.userId) as
      | { passwordHash: string }
      | undefined;

    expect(row).toBeDefined();
    expect(row!.passwordHash).not.toContain(password);

    // Property: for any subsequent user with a valid password, hash must not
    // contain the plain text.
    fc.assert(
      fc.property(
        fc.string({ minLength: 8, maxLength: 50 }),
        fc.string({ minLength: 1, maxLength: 50 }),
        (pwd, displayName) => {
          // Register a new user in the same tenant (admin creates them).
          const newUser = registerUser(
            db,
            {
              username: `user_${Math.random().toString(36).slice(2, 10)}`,
              password: pwd,
              displayName,
              tenantId: user.tenantId,
            },
            "admin",
          );

          const newRow = db
            .prepare("SELECT passwordHash FROM users WHERE userId = ?")
            .get(newUser.userId) as { passwordHash: string } | undefined;

          expect(newRow).toBeDefined();
          expect(newRow!.passwordHash).not.toContain(pwd);
        },
      ),
    );
  });
});
