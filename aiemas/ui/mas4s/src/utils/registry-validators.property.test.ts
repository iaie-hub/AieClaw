/**
 * Property-based tests for registry-validators.
 *
 * Feature: clawhub-registry-integration
 *
 * Properties tested in this file:
 *   Property 3: API Key format validation
 *   Property 4: NATS URL format validation
 *   Property 5: Agent ID format validation
 *   Property 6: Agent Name length validation
 *
 * Validates: Requirements 3.3, 3.4, 4.2, 4.3, 4.5
 */

import * as fc from "fast-check";
import { describe, it, expect } from "vitest";
import {
  validateApiKey,
  validateNatsUrl,
  validateAgentId,
  validateAgentName,
} from "./registry-validators.js";

// ── Shared Arbitraries ──

/** Characters valid for Agent ID: [a-zA-Z0-9_-] */
const agentIdCharArb = fc.mapToConstant(
  { num: 26, build: (v) => String.fromCharCode(0x61 + v) }, // a-z
  { num: 26, build: (v) => String.fromCharCode(0x41 + v) }, // A-Z
  { num: 10, build: (v) => String.fromCharCode(0x30 + v) }, // 0-9
  { num: 1, build: () => "_" },
  { num: 1, build: () => "-" },
);

/** Characters valid for hostnames (simplified): [a-zA-Z0-9.-] without colon */
const hostCharArb = fc.mapToConstant(
  { num: 26, build: (v) => String.fromCharCode(0x61 + v) }, // a-z
  { num: 26, build: (v) => String.fromCharCode(0x41 + v) }, // A-Z
  { num: 10, build: (v) => String.fromCharCode(0x30 + v) }, // 0-9
  { num: 1, build: () => "." },
  { num: 1, build: () => "-" },
);

// ── Property 3: API Key format validation ──

describe("Feature: clawhub-registry-integration, Property 3: API Key format validation", () => {
  // Feature: clawhub-registry-integration, Property 3: API Key format validation
  /**
   * **Validates: Requirements 3.3, 3.4**
   *
   * For any string input, validateApiKey returns valid=true if and only if
   * the string starts with "api-ar-" AND has a total length of exactly 64 characters.
   */

  it("valid=true for any string with prefix 'api-ar-' and total length 64 (positive direction)", () => {
    // Generate valid API keys: "api-ar-" prefix (7 chars) + 57 arbitrary printable chars
    const arbValidApiKey = fc
      .string({ minLength: 57, maxLength: 57 })
      .map((suffix) => `api-ar-${suffix}`);

    fc.assert(
      fc.property(arbValidApiKey, (key: string) => {
        expect(key.length).toBe(64);
        expect(key.startsWith("api-ar-")).toBe(true);
        const result = validateApiKey(key);
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  it("valid=false for any string that does NOT start with 'api-ar-' (negative: wrong prefix)", () => {
    // Generate strings of length 64 that do NOT start with "api-ar-"
    const arbWrongPrefix = fc
      .string({ minLength: 64, maxLength: 64 })
      .filter((s) => !s.startsWith("api-ar-"));

    fc.assert(
      fc.property(arbWrongPrefix, (key: string) => {
        const result = validateApiKey(key);
        expect(result.valid).toBe(false);
        expect(result.error).toBeDefined();
      }),
      { numRuns: 100 },
    );
  });

  it("valid=false for any string with prefix 'api-ar-' but length != 64 (negative: wrong length)", () => {
    // Generate strings with correct prefix but wrong length (not 57 suffix chars)
    const arbWrongLength = fc
      .string({ minLength: 0, maxLength: 200 })
      .filter((s) => s.length !== 57)
      .map((suffix) => `api-ar-${suffix}`);

    fc.assert(
      fc.property(arbWrongLength, (key: string) => {
        expect(key.length).not.toBe(64);
        const result = validateApiKey(key);
        expect(result.valid).toBe(false);
        expect(result.error).toBeDefined();
      }),
      { numRuns: 100 },
    );
  });

  it("biconditional: valid=true ⟺ startsWith('api-ar-') AND length === 64 (arbitrary strings)", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 200 }), (input: string) => {
        const result = validateApiKey(input);
        const shouldBeValid = input.startsWith("api-ar-") && input.length === 64;
        expect(result.valid).toBe(shouldBeValid);
      }),
      { numRuns: 100 },
    );
  });
});

// ── Property 4: NATS URL format validation ──

describe("Feature: clawhub-registry-integration, Property 4: NATS URL format validation", () => {
  // Feature: clawhub-registry-integration, Property 4: NATS URL format validation
  /**
   * **Validates: Requirements 4.2**
   *
   * For any string input, validateNatsUrl returns valid=true if and only if
   * the string matches nats://{host}:{port} where host is non-empty (no colons),
   * port is an integer in [1, 65535], and total length ≤ 256.
   */

  it("valid=true for any well-formed nats://{host}:{port} with port 1-65535 and length ≤ 256 (positive direction)", () => {
    // Generate valid NATS URLs
    const arbHost = fc.stringOf(hostCharArb, { minLength: 1, maxLength: 50 });
    const arbPort = fc.integer({ min: 1, max: 65535 });

    const arbValidNatsUrl = fc
      .tuple(arbHost, arbPort)
      .map(([host, port]) => `nats://${host}:${port}`)
      .filter((url) => url.length <= 256);

    fc.assert(
      fc.property(arbValidNatsUrl, (url: string) => {
        const result = validateNatsUrl(url);
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  it("valid=false for strings not matching nats:// prefix (negative: wrong scheme)", () => {
    const arbWrongScheme = fc.constantFrom("http://", "https://", "tcp://", "ws://", "nats//", "");
    const arbHost = fc.stringOf(hostCharArb, { minLength: 1, maxLength: 20 });
    const arbPort = fc.integer({ min: 1, max: 65535 });

    fc.assert(
      fc.property(
        arbWrongScheme,
        arbHost,
        arbPort,
        (scheme: string, host: string, port: number) => {
          const url = `${scheme}${host}:${port}`;
          const result = validateNatsUrl(url);
          expect(result.valid).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  it("valid=false for nats:// URLs with port outside 1-65535 (negative: invalid port)", () => {
    const arbHost = fc.stringOf(hostCharArb, { minLength: 1, maxLength: 10 });
    const arbInvalidPort = fc.oneof(fc.constant(0), fc.integer({ min: 65536, max: 99999 }));

    fc.assert(
      fc.property(arbHost, arbInvalidPort, (host: string, port: number) => {
        const url = `nats://${host}:${port}`;
        const result = validateNatsUrl(url);
        expect(result.valid).toBe(false);
        expect(result.error).toBeDefined();
      }),
      { numRuns: 100 },
    );
  });

  it("valid=false for nats:// URLs exceeding 256 characters (negative: too long)", () => {
    // Generate a host long enough to make the URL exceed 256 chars
    const arbLongHost = fc.stringOf(hostCharArb, { minLength: 245, maxLength: 300 });

    fc.assert(
      fc.property(arbLongHost, (host: string) => {
        const url = `nats://${host}:4222`;
        // Only test when it actually exceeds 256
        fc.pre(url.length > 256);
        const result = validateNatsUrl(url);
        expect(result.valid).toBe(false);
        expect(result.error).toBeDefined();
      }),
      { numRuns: 100 },
    );
  });
});

// ── Property 5: Agent ID format validation ──

describe("Feature: clawhub-registry-integration, Property 5: Agent ID format validation", () => {
  // Feature: clawhub-registry-integration, Property 5: Agent ID format validation
  /**
   * **Validates: Requirements 4.3**
   *
   * For any string input, validateAgentId returns valid=true if and only if
   * the string contains only characters from [a-zA-Z0-9_-] and has a length
   * between 1 and 64 inclusive.
   */

  it("valid=true for any string matching [a-zA-Z0-9_-]{1,64} (positive direction)", () => {
    const arbValidAgentId = fc.stringOf(agentIdCharArb, { minLength: 1, maxLength: 64 });

    fc.assert(
      fc.property(arbValidAgentId, (id: string) => {
        const result = validateAgentId(id);
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  it("valid=false for empty string (negative: too short)", () => {
    const result = validateAgentId("");
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("valid=false for strings longer than 64 characters even if all chars valid (negative: too long)", () => {
    const arbTooLong = fc.stringOf(agentIdCharArb, { minLength: 65, maxLength: 128 });

    fc.assert(
      fc.property(arbTooLong, (id: string) => {
        const result = validateAgentId(id);
        expect(result.valid).toBe(false);
        expect(result.error).toBeDefined();
      }),
      { numRuns: 100 },
    );
  });

  it("valid=false for strings with invalid characters even if length 1-64 (negative: bad chars)", () => {
    // Generate strings that contain at least one invalid character
    const invalidCharArb = fc.char().filter((c) => !/^[a-zA-Z0-9_-]$/.test(c));
    const validPartArb = fc.stringOf(agentIdCharArb, { minLength: 0, maxLength: 30 });

    fc.assert(
      fc.property(
        validPartArb,
        invalidCharArb,
        validPartArb,
        (prefix: string, badChar: string, suffix: string) => {
          const id = `${prefix}${badChar}${suffix}`;
          fc.pre(id.length >= 1 && id.length <= 64);
          const result = validateAgentId(id);
          expect(result.valid).toBe(false);
          expect(result.error).toBeDefined();
        },
      ),
      { numRuns: 100 },
    );
  });

  it("biconditional: valid=true ⟺ /^[a-zA-Z0-9_-]+$/ AND length 1-64 (arbitrary strings)", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 128 }), (input: string) => {
        const result = validateAgentId(input);
        const shouldBeValid =
          input.length >= 1 && input.length <= 64 && /^[a-zA-Z0-9_-]+$/.test(input);
        expect(result.valid).toBe(shouldBeValid);
      }),
      { numRuns: 100 },
    );
  });
});

// ── Property 6: Agent Name length validation ──

describe("Feature: clawhub-registry-integration, Property 6: Agent Name length validation", () => {
  // Feature: clawhub-registry-integration, Property 6: Agent Name length validation
  /**
   * **Validates: Requirements 4.5**
   *
   * For any string input, validateAgentName returns valid=true if and only if
   * the string has a length between 1 and 128 inclusive.
   */

  it("valid=true for any non-empty string with length 1-128 (positive direction)", () => {
    const arbValidName = fc.string({ minLength: 1, maxLength: 128 });

    fc.assert(
      fc.property(arbValidName, (name: string) => {
        const result = validateAgentName(name);
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });

  it("valid=false for empty string (negative: too short)", () => {
    const result = validateAgentName("");
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("valid=false for strings longer than 128 characters (negative: too long)", () => {
    const arbTooLong = fc.string({ minLength: 129, maxLength: 300 });

    fc.assert(
      fc.property(arbTooLong, (name: string) => {
        const result = validateAgentName(name);
        expect(result.valid).toBe(false);
        expect(result.error).toBeDefined();
      }),
      { numRuns: 100 },
    );
  });

  it("biconditional: valid=true ⟺ length >= 1 AND length <= 128 (arbitrary strings)", () => {
    fc.assert(
      fc.property(fc.string({ minLength: 0, maxLength: 300 }), (input: string) => {
        const result = validateAgentName(input);
        const shouldBeValid = input.length >= 1 && input.length <= 128;
        expect(result.valid).toBe(shouldBeValid);
      }),
      { numRuns: 100 },
    );
  });

  it("valid=true for unicode and special characters within length bounds", () => {
    // Generate strings with unicode characters
    const arbUnicode = fc.unicodeString({ minLength: 1, maxLength: 128 });

    fc.assert(
      fc.property(arbUnicode, (name: string) => {
        const result = validateAgentName(name);
        expect(result.valid).toBe(true);
        expect(result.error).toBeUndefined();
      }),
      { numRuns: 100 },
    );
  });
});
