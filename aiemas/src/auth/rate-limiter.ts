/**
 * Sliding window rate limiter for login attempts.
 * Tracks failed attempts per IP within a configurable time window.
 */

export class RateLimiter {
  private readonly failureMap = new Map<string, number[]>();

  constructor(
    private readonly windowMs: number = 60_000,
    private readonly maxFailures: number = 10,
  ) {}

  /**
   * Check whether the given IP is allowed to attempt a login.
   * Does NOT record a failure — call recordFailure() separately on auth failure.
   */
  check(ip: string): { allowed: true } | { allowed: false; retryAfterMs: number } {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const timestamps = (this.failureMap.get(ip) ?? []).filter((t) => t > windowStart);
    // Prune stale entries
    this.failureMap.set(ip, timestamps);

    if (timestamps.length >= this.maxFailures) {
      const oldest = timestamps[0]!;
      const retryAfterMs = oldest + this.windowMs - now;
      return { allowed: false, retryAfterMs: Math.max(retryAfterMs, 0) };
    }

    return { allowed: true };
  }

  /** Record a failed login attempt for the given IP. */
  recordFailure(ip: string): void {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    const timestamps = (this.failureMap.get(ip) ?? []).filter((t) => t > windowStart);
    timestamps.push(now);
    this.failureMap.set(ip, timestamps);
  }

  /** Remove all recorded failures for the given IP (useful for testing/cleanup). */
  reset(ip: string): void {
    this.failureMap.delete(ip);
  }
}

/** Factory function for creating a RateLimiter instance. */
export function createRateLimiter(windowMs?: number, maxFailures?: number): RateLimiter {
  return new RateLimiter(windowMs, maxFailures);
}
