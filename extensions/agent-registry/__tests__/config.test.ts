/**
 * Config validation tests for the agent-registry plugin.
 *
 * Covers Properties 8, 9, and 10 from the design document, plus unit tests
 * for missing required fields and error message content.
 *
 * Validates: Requirements 9.1, 9.2, 1.2
 */

import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { buildNatsConnectOptions, parseConfig } from "../src/config.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal valid env that satisfies all required fields. */
function validEnv(overrides: Record<string, string | undefined> = {}): NodeJS.ProcessEnv {
  return {
    AGENT_REGISTRY_NATS_URL: "nats://localhost:4222",
    AGENT_REGISTRY_AGENT_ID: "my-agent",
    AGENT_REGISTRY_AGENT_NAME: "My Agent",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Unit tests — missing required fields
// ---------------------------------------------------------------------------

describe("parseConfig — missing required fields", () => {
  it("throws when AGENT_REGISTRY_NATS_URL is absent", () => {
    expect(() =>
      parseConfig({
        AGENT_REGISTRY_AGENT_ID: "agent-1",
        AGENT_REGISTRY_AGENT_NAME: "Agent One",
      }),
    ).toThrow("AGENT_REGISTRY_NATS_URL");
  });

  it("throws when AGENT_REGISTRY_AGENT_ID is absent", () => {
    expect(() =>
      parseConfig({
        AGENT_REGISTRY_NATS_URL: "nats://localhost:4222",
        AGENT_REGISTRY_AGENT_NAME: "Agent One",
      }),
    ).toThrow("AGENT_REGISTRY_AGENT_ID");
  });

  it("throws when AGENT_REGISTRY_AGENT_NAME is absent", () => {
    expect(() =>
      parseConfig({
        AGENT_REGISTRY_NATS_URL: "nats://localhost:4222",
        AGENT_REGISTRY_AGENT_ID: "agent-1",
      }),
    ).toThrow("AGENT_REGISTRY_AGENT_NAME");
  });
});

// ---------------------------------------------------------------------------
// Unit tests — error message content
// ---------------------------------------------------------------------------

describe("parseConfig — error message content", () => {
  it("mentions AGENT_REGISTRY_NATS_URL when URL is invalid", () => {
    expect(() =>
      parseConfig(validEnv({ AGENT_REGISTRY_NATS_URL: "http://localhost:4222" })),
    ).toThrow("AGENT_REGISTRY_NATS_URL");
  });

  it("mentions AGENT_REGISTRY_AGENT_ID when agent ID is invalid", () => {
    expect(() =>
      parseConfig(validEnv({ AGENT_REGISTRY_AGENT_ID: "invalid id!" })),
    ).toThrow("AGENT_REGISTRY_AGENT_ID");
  });
});

// ---------------------------------------------------------------------------
// Property 8: NATS URL validation rejects invalid inputs
// Feature: agent-registry-channel, Property 8
// Validates: Requirements 1.7, 9.1
// ---------------------------------------------------------------------------

describe("Property 8: NATS URL validation", () => {
  // ── Invalid: arbitrary strings ──
  it("rejects arbitrary strings that are not NATS URLs", () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 100 }).filter(
          (s) => !/^nats:\/\/[^:]+:\d{1,5}$/.test(s),
        ),
        (invalidUrl) => {
          expect(() =>
            parseConfig(validEnv({ AGENT_REGISTRY_NATS_URL: invalidUrl })),
          ).toThrow();
        },
      ),
    );
  });

  // ── Invalid: wrong scheme ──
  it("rejects URLs with wrong scheme (http, tcp, ws, etc.)", () => {
    const wrongSchemes = ["http", "https", "tcp", "ws", "wss", "mqtt", "amqp"];
    fc.assert(
      fc.property(
        fc.constantFrom(...wrongSchemes),
        fc.stringMatching(/^[a-z0-9.-]+$/),
        fc.integer({ min: 1, max: 65535 }),
        (scheme, host, port) => {
          const url = `${scheme}://${host}:${port}`;
          expect(() =>
            parseConfig(validEnv({ AGENT_REGISTRY_NATS_URL: url })),
          ).toThrow();
        },
      ),
    );
  });

  // ── Invalid: missing port ──
  it("rejects nats:// URLs without a port", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z0-9.-]+$/),
        (host) => {
          const url = `nats://${host}`;
          expect(() =>
            parseConfig(validEnv({ AGENT_REGISTRY_NATS_URL: url })),
          ).toThrow();
        },
      ),
    );
  });

  // ── Invalid: port 0 ──
  it("rejects port 0", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z0-9.-]+$/),
        (host) => {
          const url = `nats://${host}:0`;
          expect(() =>
            parseConfig(validEnv({ AGENT_REGISTRY_NATS_URL: url })),
          ).toThrow();
        },
      ),
    );
  });

  // ── Invalid: port >= 65536 ──
  it("rejects ports >= 65536", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z0-9.-]+$/),
        fc.integer({ min: 65536, max: 99999 }),
        (host, port) => {
          const url = `nats://${host}:${port}`;
          expect(() =>
            parseConfig(validEnv({ AGENT_REGISTRY_NATS_URL: url })),
          ).toThrow();
        },
      ),
    );
  });

  // ── Valid: nats://{host}:{port} with port 1–65535 ──
  it("accepts valid nats://{host}:{port} URLs with port in [1, 65535]", () => {
    fc.assert(
      fc.property(
        // host: non-empty, no colon
        fc.stringMatching(/^[a-z0-9][a-z0-9.-]{0,30}$/),
        fc.integer({ min: 1, max: 65535 }),
        (host, port) => {
          const url = `nats://${host}:${port}`;
          expect(() =>
            parseConfig(validEnv({ AGENT_REGISTRY_NATS_URL: url })),
          ).not.toThrow();
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Property 9: Agent ID validation
// Feature: agent-registry-channel, Property 9
// Validates: Requirements 9.2
// ---------------------------------------------------------------------------

describe("Property 9: Agent ID validation", () => {
  // ── Invalid: strings with out-of-charset characters ──
  it("rejects agent IDs containing characters outside [a-zA-Z0-9_-]", () => {
    // Generate strings that contain at least one invalid character
    const invalidCharArb = fc.string({ minLength: 1, maxLength: 64 }).filter(
      (s) => s.length > 0 && /[^a-zA-Z0-9_-]/.test(s),
    );
    fc.assert(
      fc.property(invalidCharArb, (invalidId) => {
        expect(() =>
          parseConfig(validEnv({ AGENT_REGISTRY_AGENT_ID: invalidId })),
        ).toThrow();
      }),
    );
  });

  // ── Invalid: strings longer than 64 characters ──
  it("rejects agent IDs longer than 64 characters", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-zA-Z0-9_-]+$/).filter((s) => s.length > 0),
        fc.integer({ min: 65, max: 128 }),
        (base, targetLen) => {
          // Pad with valid chars to reach targetLen
          const padded = base.repeat(Math.ceil(targetLen / base.length)).slice(0, targetLen);
          expect(() =>
            parseConfig(validEnv({ AGENT_REGISTRY_AGENT_ID: padded })),
          ).toThrow();
        },
      ),
    );
  });

  // ── Valid: non-empty strings of [a-zA-Z0-9_-] with length 1–64 ──
  it("accepts valid agent IDs: non-empty [a-zA-Z0-9_-] strings up to 64 chars", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-zA-Z0-9_-]{1,64}$/),
        (validId) => {
          expect(() =>
            parseConfig(validEnv({ AGENT_REGISTRY_AGENT_ID: validId })),
          ).not.toThrow();
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Property 10: NATS token included in connect options
// Feature: agent-registry-channel, Property 10
// Validates: Requirements 1.2
// ---------------------------------------------------------------------------

describe("Property 10: NATS token included in connect options", () => {
  it("includes the token in connect options for any non-empty token string ≤512 chars", () => {
    fc.assert(
      fc.property(
        // Non-empty string up to 512 chars
        fc.string({ minLength: 1, maxLength: 512 }),
        (token) => {
          const config = parseConfig(
            validEnv({ AGENT_REGISTRY_NATS_TOKEN: token }),
          );
          const opts = buildNatsConnectOptions(config);
          expect(opts.token).toBe(token);
        },
      ),
    );
  });

  it("does not include token field when token is absent", () => {
    const config = parseConfig(validEnv());
    const opts = buildNatsConnectOptions(config);
    expect(opts.token).toBeUndefined();
  });
});
