import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { TenantServiceError, WEAK_PASSWORD } from "../errors.js";

/**
 * Validates password strength. Throws WEAK_PASSWORD if the password is too short.
 */
export function validatePasswordStrength(password: string): void {
  if (password.length < 8) {
    throw new TenantServiceError(WEAK_PASSWORD, "Password must be at least 8 characters long.");
  }
}

/**
 * Hashes a plain-text password using SHA-256 with a random UUID salt.
 * NOTE: bcrypt is not available in this project. In production, prefer bcrypt (cost >= 10).
 */
export function hashPassword(plain: string): string {
  const salt = randomUUID();
  const hash = createHash("sha256")
    .update(salt + plain)
    .digest("hex");
  return `sha256:${salt}:${hash}`;
}

/**
 * Verifies a plain-text password against a stored hash.
 * Uses constant-time comparison to prevent timing attacks.
 */
export function verifyPassword(plain: string, stored: string): boolean {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "sha256") {
    return false;
  }
  const [, salt, hash] = parts as [string, string, string];
  const expected = createHash("sha256")
    .update(salt + plain)
    .digest("hex");
  if (expected.length !== hash.length) {
    return false;
  }
  // Use Node's built-in constant-time buffer comparison
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(hash, "hex"));
}
