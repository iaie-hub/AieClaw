import { createHmac } from "node:crypto";
import {
  TenantServiceError,
  TOKEN_EXPIRED,
  TOKEN_INVALID,
  JWT_SECRET_TOO_SHORT,
} from "../errors.js";
import { GlobalRole } from "../models.js";

// ── Key initialisation ────────────────────────────────────────────────────────

function loadSecret(): string {
  const envSecret = process.env["MAS4S_JWT_SECRET"];
  if (envSecret) {
    return envSecret;
  }
  // No secret configured – generate a random one for this process lifetime.
  // Tokens will be invalidated on restart.
  const random = createHmac("sha256", "seed")
    .update(String(Date.now()) + String(Math.random()))
    .digest("hex");
  console.warn(
    "[mas4s] MAS4S_JWT_SECRET is not set. A random JWT secret has been generated. " +
      "All tokens will be invalidated on process restart. " +
      "Set MAS4S_JWT_SECRET to a value of at least 32 bytes for production use.",
  );
  return random;
}

let _secret: string | undefined;

function getSecret(): string {
  if (!_secret) {
    _secret = loadSecret();
  }
  return _secret;
}

/** Returns the active JWT secret (initialising it on first call). */
export function getJwtSecret(): string {
  return getSecret();
}

/**
 * Reset the cached JWT secret (for testing purposes only).
 * @internal
 */
export function _resetJwtSecretForTesting(): void {
  _secret = undefined;
}

function validateKeyLength(key: string): void {
  if (Buffer.byteLength(key, "utf8") < 32) {
    throw new TenantServiceError(
      JWT_SECRET_TOO_SHORT,
      "JWT secret must be at least 32 bytes long.",
    );
  }
}

// ── Base64url helpers ─────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-redundant-type-constituents
function base64urlEncode(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(input: string): Buffer {
  // Restore standard base64 padding
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const pad = padded.length % 4;
  const padded2 = pad === 0 ? padded : padded + "=".repeat(4 - pad);
  return Buffer.from(padded2, "base64");
}

// ── JWT core ──────────────────────────────────────────────────────────────────

const HEADER = base64urlEncode(JSON.stringify({ alg: "HS256", typ: "JWT" }));

function sign(headerPayload: string, secret: string): string {
  return base64urlEncode(createHmac("sha256", secret).update(headerPayload).digest());
}

export interface JwtPayload {
  userId: string;
  tenantId: string;
  role: GlobalRole;
  iat: number;
  exp: number;
}

// ── Public API ────────────────────────────────────────────────────────────────

const DEFAULT_EXPIRY_SECONDS = 86400; // 24 hours

/**
 * Sign a new JWT token for the given user payload.
 * Expiry defaults to 24 hours from now.
 */
export function signToken(payload: { userId: string; tenantId: string; role: GlobalRole }): string {
  const secret = getSecret();
  validateKeyLength(secret);

  const now = Math.floor(Date.now() / 1000);
  const claims: JwtPayload = {
    userId: payload.userId,
    tenantId: payload.tenantId,
    role: payload.role,
    iat: now,
    exp: now + DEFAULT_EXPIRY_SECONDS,
  };

  const encodedPayload = base64urlEncode(JSON.stringify(claims));
  const headerPayload = `${HEADER}.${encodedPayload}`;
  const signature = sign(headerPayload, secret);
  return `${headerPayload}.${signature}`;
}

/**
 * Verify a JWT token and return its decoded payload.
 * Throws TOKEN_EXPIRED if the token has expired.
 * Throws TOKEN_INVALID if the signature is wrong or the token is malformed.
 */
export function verifyToken(token: string): JwtPayload {
  const secret = getSecret();
  validateKeyLength(secret);

  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new TenantServiceError(TOKEN_INVALID, "Malformed JWT token.");
  }

  const [header, encodedPayload, signature] = parts as [string, string, string];
  const headerPayload = `${header}.${encodedPayload}`;
  const expectedSig = sign(headerPayload, secret);

  // Constant-time comparison to prevent timing attacks
  if (!timingSafeEqual(Buffer.from(signature, "utf8"), Buffer.from(expectedSig, "utf8"))) {
    throw new TenantServiceError(TOKEN_INVALID, "JWT signature mismatch.");
  }

  let claims: JwtPayload;
  try {
    claims = JSON.parse(base64urlDecode(encodedPayload).toString("utf8")) as JwtPayload;
  } catch {
    throw new TenantServiceError(TOKEN_INVALID, "JWT payload could not be decoded.");
  }

  const now = Math.floor(Date.now() / 1000);
  if (claims.exp < now) {
    throw new TenantServiceError(TOKEN_EXPIRED, "JWT token has expired.");
  }

  return claims;
}

/**
 * Refresh a valid (non-expired) token, issuing a new one with a fresh iat/exp.
 * Throws TOKEN_EXPIRED or TOKEN_INVALID if the existing token is not valid.
 */
export function refreshToken(token: string): string {
  // verifyToken will throw if expired or invalid
  const claims = verifyToken(token);
  return signToken({ userId: claims.userId, tenantId: claims.tenantId, role: claims.role });
}

// ── Timing-safe comparison ────────────────────────────────────────────────────

/**
 * Constant-time buffer comparison to prevent timing side-channels.
 * Falls back to a manual loop when lengths differ (always returns false).
 */
function timingSafeEqual(a: Buffer, b: Buffer): boolean {
  if (a.length !== b.length) {
    // Still iterate to avoid length-based timing leak
    let _diff = 0;
    for (let i = 0; i < a.length; i++) {
      _diff |= (a[i] ?? 0) ^ 0;
    }
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  return diff === 0;
}
