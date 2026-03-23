/**
 * JWT property-based tests.
 * Feature: mas4s-multi-tenant-rbac
 *
 * Property 3: AuthToken round-trip          — Validates: Requirements 2.1, 2.3, 2.5, 2.7
 * Property 4: 过期令牌拒绝                   — Validates: Requirements 2.6
 * Property 5: 认证错误不泄露信息             — Validates: Requirements 2.2
 */

import { createHmac } from "node:crypto";
import * as fc from "fast-check";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { signToken, verifyToken, _resetJwtSecretForTesting } from "../auth/jwt.js";
import { TenantServiceError } from "../errors.js";
import { TOKEN_EXPIRED, TOKEN_INVALID } from "../errors.js";
import type { GlobalRole } from "../models.js";

const TEST_SECRET = "test-secret-that-is-at-least-32-bytes-long!!";

// ── Arbitraries ───────────────────────────────────────────────────────────────

// UUID-like string: 8-4-4-4-12 hex segments
const arbUuid = fc.uuid();

const arbRole: fc.Arbitrary<GlobalRole> = fc.constantFrom("admin", "member", "viewer");

// ── Helpers ───────────────────────────────────────────────────────────────────

/** base64url-encode a buffer or string (mirrors jwt.ts internals). */
// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
function base64urlEncode(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Re-sign a modified payload with the test secret to produce a structurally valid but expired token. */
function buildExpiredToken(userId: string, tenantId: string, role: GlobalRole): string {
  const header = base64urlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const pastTs = Math.floor(Date.now() / 1000) - 7200; // 2 hours ago
  const claims = { userId, tenantId, role, iat: pastTs - 86400, exp: pastTs };
  const encodedPayload = base64urlEncode(JSON.stringify(claims));
  const headerPayload = `${header}.${encodedPayload}`;
  const sig = base64urlEncode(createHmac("sha256", TEST_SECRET).update(headerPayload).digest());
  return `${headerPayload}.${sig}`;
}

/** Flip one character in the signature part of a JWT. */
function tamperSignature(token: string): string {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return token;
  }
  const sig = parts[2];
  // Replace the first character with a different one
  const flipped = sig[0] === "A" ? "B" + sig.slice(1) : "A" + sig.slice(1);
  return `${parts[0]}.${parts[1]}.${flipped}`;
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("JWT property tests", () => {
  beforeEach(() => {
    _resetJwtSecretForTesting();
    process.env["MAS4S_JWT_SECRET"] = TEST_SECRET;
  });

  afterEach(() => {
    _resetJwtSecretForTesting();
    delete process.env["MAS4S_JWT_SECRET"];
  });

  /**
   * Property 3: AuthToken round-trip
   * **Validates: Requirements 2.1, 2.3, 2.5, 2.7**
   *
   * For any valid (userId, tenantId, role), sign then verify must return
   * the same userId, tenantId, and role.
   */
  it("Property 3: sign → verify round-trip preserves userId, tenantId, role", () => {
    fc.assert(
      fc.property(arbUuid, arbUuid, arbRole, (userId, tenantId, role) => {
        const token = signToken({ userId, tenantId, role });
        const claims = verifyToken(token);
        expect(claims.userId).toBe(userId);
        expect(claims.tenantId).toBe(tenantId);
        expect(claims.role).toBe(role);
      }),
    );
  });

  /**
   * Property 4: 过期令牌拒绝
   * **Validates: Requirements 2.6**
   *
   * For any valid payload, a token whose exp is in the past must cause
   * verifyToken to throw with code TOKEN_EXPIRED.
   */
  it("Property 4: expired tokens are rejected with TOKEN_EXPIRED", () => {
    fc.assert(
      fc.property(arbUuid, arbUuid, arbRole, (userId, tenantId, role) => {
        const expiredToken = buildExpiredToken(userId, tenantId, role);
        expect(() => verifyToken(expiredToken)).toThrow(
          expect.objectContaining({ code: TOKEN_EXPIRED }),
        );
      }),
    );
  });

  /**
   * Property 5: 认证错误不泄露信息
   * **Validates: Requirements 2.2**
   *
   * For any valid token whose signature has been tampered, verifyToken must
   * throw with code TOKEN_INVALID — never leaking internal details.
   */
  it("Property 5: tampered tokens are rejected with TOKEN_INVALID", () => {
    fc.assert(
      fc.property(arbUuid, arbUuid, arbRole, (userId, tenantId, role) => {
        const token = signToken({ userId, tenantId, role });
        const tampered = tamperSignature(token);
        let threw = false;
        try {
          verifyToken(tampered);
        } catch (err) {
          threw = true;
          expect(err).toBeInstanceOf(TenantServiceError);
          expect((err as TenantServiceError).code).toBe(TOKEN_INVALID);
        }
        expect(threw).toBe(true);
      }),
    );
  });
});
