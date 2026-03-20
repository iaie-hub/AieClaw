import * as fc from "fast-check";
import { describe, it, expect } from "vitest";
import { RateLimiter } from "../auth/rate-limiter.js";

/**
 * Property 13: 登录速率限制
 * Validates: Requirement 11.1
 */
describe("RateLimiter property tests", () => {
  it("Property 13: after 10 failures, 11th check is rate-limited", () => {
    fc.assert(
      fc.property(fc.ipV4(), (ip) => {
        const limiter = new RateLimiter(60_000, 10);

        // Before any failures: allowed
        expect(limiter.check(ip)).toEqual({ allowed: true });

        // Record 10 failures
        for (let i = 0; i < 10; i++) {
          limiter.recordFailure(ip);
        }

        // 11th check: rate limited
        const result = limiter.check(ip);
        expect(result.allowed).toBe(false);
        if (!result.allowed) {
          expect(result.retryAfterMs).toBeGreaterThanOrEqual(0);
        }

        // After reset: allowed again
        limiter.reset(ip);
        expect(limiter.check(ip)).toEqual({ allowed: true });
      }),
    );
  });
});
