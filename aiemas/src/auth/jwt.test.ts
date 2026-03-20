import { createHmac } from "node:crypto";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { TOKEN_EXPIRED, TOKEN_INVALID, JWT_SECRET_TOO_SHORT } from "../errors.js";
import {
  signToken,
  verifyToken,
  refreshToken,
  getJwtSecret,
  _resetJwtSecretForTesting,
  type JwtPayload,
} from "./jwt.js";

// Use a fixed 32-byte secret for all tests
const TEST_SECRET = "test-secret-that-is-at-least-32b";

beforeEach(() => {
  _resetJwtSecretForTesting();
  process.env["MAS4S_JWT_SECRET"] = TEST_SECRET;
});

afterEach(() => {
  _resetJwtSecretForTesting();
  delete process.env["MAS4S_JWT_SECRET"];
});

const basePayload = {
  userId: "user-1",
  tenantId: "tenant-1",
  role: "member" as const,
};

describe("signToken", () => {
  it("returns a three-part JWT string", () => {
    const token = signToken(basePayload);
    expect(token.split(".")).toHaveLength(3);
  });

  it("encodes the correct claims in the payload", () => {
    const before = Math.floor(Date.now() / 1000);
    const token = signToken(basePayload);
    const after = Math.floor(Date.now() / 1000);

    const [, encodedPayload] = token.split(".");
    const padded = encodedPayload.replace(/-/g, "+").replace(/_/g, "/");
    const pad = padded.length % 4;
    const padded2 = pad === 0 ? padded : padded + "=".repeat(4 - pad);
    const claims = JSON.parse(Buffer.from(padded2, "base64").toString("utf8")) as JwtPayload;

    expect(claims.userId).toBe("user-1");
    expect(claims.tenantId).toBe("tenant-1");
    expect(claims.role).toBe("member");
    expect(claims.iat).toBeGreaterThanOrEqual(before);
    expect(claims.iat).toBeLessThanOrEqual(after);
    expect(claims.exp).toBe(claims.iat + 86400);
  });

  it("throws JWT_SECRET_TOO_SHORT when secret is shorter than 32 bytes", () => {
    _resetJwtSecretForTesting();
    process.env["MAS4S_JWT_SECRET"] = "short";
    expect(() => signToken(basePayload)).toThrow(
      expect.objectContaining({ code: JWT_SECRET_TOO_SHORT }),
    );
  });
});

describe("verifyToken", () => {
  it("returns the original claims for a valid token", () => {
    const token = signToken(basePayload);
    const claims = verifyToken(token);
    expect(claims.userId).toBe("user-1");
    expect(claims.tenantId).toBe("tenant-1");
    expect(claims.role).toBe("member");
  });

  it("throws TOKEN_INVALID for a malformed token", () => {
    expect(() => verifyToken("not.a.valid.jwt.at.all")).toThrow(
      expect.objectContaining({ code: TOKEN_INVALID }),
    );
  });

  it("throws TOKEN_INVALID when signature is tampered", () => {
    const token = signToken(basePayload);
    const parts = token.split(".");
    const tampered = `${parts[0]}.${parts[1]}.invalidsignature`;
    expect(() => verifyToken(tampered)).toThrow(expect.objectContaining({ code: TOKEN_INVALID }));
  });

  it("throws TOKEN_EXPIRED for an expired token", () => {
    const token = signToken(basePayload);
    const parts = token.split(".");

    // Manually craft an expired payload
    const expiredClaims = {
      ...basePayload,
      iat: Math.floor(Date.now() / 1000) - 90000,
      exp: Math.floor(Date.now() / 1000) - 3600,
    };
    const encoded = Buffer.from(JSON.stringify(expiredClaims))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    // Re-sign with the correct secret so signature is valid but token is expired
    const headerPayload = `${parts[0]}.${encoded}`;
    const sig = Buffer.from(createHmac("sha256", TEST_SECRET).update(headerPayload).digest())
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");

    const expiredToken = `${headerPayload}.${sig}`;
    expect(() => verifyToken(expiredToken)).toThrow(
      expect.objectContaining({ code: TOKEN_EXPIRED }),
    );
  });

  it("throws TOKEN_INVALID for a token with only two parts", () => {
    expect(() => verifyToken("header.payload")).toThrow(
      expect.objectContaining({ code: TOKEN_INVALID }),
    );
  });
});

describe("refreshToken", () => {
  it("returns a new valid token with the same claims", () => {
    const original = signToken(basePayload);
    // Small delay to ensure iat differs
    const refreshed = refreshToken(original);
    const claims = verifyToken(refreshed);
    expect(claims.userId).toBe("user-1");
    expect(claims.tenantId).toBe("tenant-1");
    expect(claims.role).toBe("member");
  });

  it("throws TOKEN_INVALID when refreshing a tampered token", () => {
    const token = signToken(basePayload);
    const parts = token.split(".");
    const tampered = `${parts[0]}.${parts[1]}.badsig`;
    expect(() => refreshToken(tampered)).toThrow(expect.objectContaining({ code: TOKEN_INVALID }));
  });
});

describe("getJwtSecret", () => {
  it("returns the configured secret", () => {
    expect(getJwtSecret()).toBe(TEST_SECRET);
  });

  it("generates a random secret and warns when env var is not set", () => {
    _resetJwtSecretForTesting();
    delete process.env["MAS4S_JWT_SECRET"];
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const secret = getJwtSecret();
    // Random secret is a sha256 hex digest: 64 chars = 64 bytes
    expect(Buffer.byteLength(secret, "utf8")).toBeGreaterThanOrEqual(32);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("MAS4S_JWT_SECRET"));

    warnSpy.mockRestore();
  });
});
