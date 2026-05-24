/**
 * Unit + property tests for RegistryEnvelope serialization.
 *
 * Feature: agent-registry-channel
 * Property 1: RegistryEnvelope serialization round-trip
 * Property 2: message_id uniqueness
 * Property 3: timestamp is a non-negative integer
 *
 * Validates: Requirements 10.1, 10.2, 10.3, 10.5, 10.6
 */

import * as fc from "fast-check";
import { describe, it, expect } from "vitest";
import { serializeEnvelope, deserializeEnvelope, createEnvelope } from "../src/envelope.js";
import type { RegistryEnvelope } from "../src/types.js";

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Non-empty printable ASCII string (avoids surrogate pairs / control chars). */
const arbNonEmptyString = fc.string({ minLength: 1, maxLength: 64 });

/** Arbitrary for a valid RegistryEnvelope with all required fields populated. */
const arbRegistryEnvelope: fc.Arbitrary<RegistryEnvelope> = fc.record({
  message_id: fc.uuid(),
  request_id: fc.uuid(),
  message_type: fc.constantFrom("req" as const, "res" as const, "event" as const),
  timestamp: fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
  source: arbNonEmptyString,
  session: fc.oneof(fc.constant(null), arbNonEmptyString),
  seq: fc.integer({ min: 0, max: 1_000_000 }),
  action: arbNonEmptyString,
  resource_type: fc.constantFrom("agent", "collaboration", "cowork", "discussion"),
  payload: fc.dictionary(
    fc.string({ minLength: 1, maxLength: 16 }),
    fc.oneof(fc.string(), fc.integer(), fc.boolean()),
  ),
  reply_to: fc.oneof(fc.constant(null), arbNonEmptyString),
});

/** Base fields for createEnvelope (everything except message_id and timestamp). */
const arbCreateEnvelopeBase = fc.record({
  request_id: fc.uuid(),
  message_type: fc.constantFrom("req" as const, "res" as const, "event" as const),
  source: arbNonEmptyString,
  session: fc.oneof(fc.constant(null), arbNonEmptyString),
  seq: fc.integer({ min: 0, max: 1_000_000 }),
  action: arbNonEmptyString,
  resource_type: fc.constantFrom("agent", "collaboration", "cowork", "discussion"),
  payload: fc.dictionary(
    fc.string({ minLength: 1, maxLength: 16 }),
    fc.oneof(fc.string(), fc.integer(), fc.boolean()),
  ),
  reply_to: fc.oneof(fc.constant(null), arbNonEmptyString),
});

// ---------------------------------------------------------------------------
// Property 1: RegistryEnvelope serialization round-trip
// Validates: Requirements 10.1, 10.5
// ---------------------------------------------------------------------------

describe("Feature: agent-registry-channel, Property 1: RegistryEnvelope serialization round-trip", () => {
  it("deserializeEnvelope(serializeEnvelope(e)) preserves all required fields", () => {
    fc.assert(
      fc.property(arbRegistryEnvelope, (envelope) => {
        const bytes = serializeEnvelope(envelope);
        const parsed = deserializeEnvelope(bytes);

        expect(parsed.message_id).toBe(envelope.message_id);
        expect(parsed.request_id).toBe(envelope.request_id);
        expect(parsed.message_type).toBe(envelope.message_type);
        expect(parsed.timestamp).toBe(envelope.timestamp);
        expect(parsed.source).toBe(envelope.source);
        expect(parsed.session).toBe(envelope.session);
        expect(parsed.seq).toBe(envelope.seq);
        expect(parsed.action).toBe(envelope.action);
        expect(parsed.resource_type).toBe(envelope.resource_type);
        expect(parsed.payload).toEqual(envelope.payload);
        expect(parsed.reply_to).toBe(envelope.reply_to);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2: message_id uniqueness
// Validates: Requirements 10.2
// ---------------------------------------------------------------------------

describe("Feature: agent-registry-channel, Property 2: message_id uniqueness", () => {
  it("two successive createEnvelope calls produce distinct message_id values", () => {
    fc.assert(
      fc.property(arbCreateEnvelopeBase, (base) => {
        const e1 = createEnvelope(base);
        const e2 = createEnvelope(base);
        expect(e1.message_id).not.toBe(e2.message_id);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Property 3: timestamp is a non-negative integer
// Validates: Requirements 10.3
// ---------------------------------------------------------------------------

describe("Feature: agent-registry-channel, Property 3: timestamp is a non-negative integer", () => {
  it("createEnvelope always produces a non-negative integer timestamp", () => {
    fc.assert(
      fc.property(arbCreateEnvelopeBase, (base) => {
        const envelope = createEnvelope(base);
        expect(Number.isInteger(envelope.timestamp)).toBe(true);
        expect(envelope.timestamp).toBeGreaterThanOrEqual(0);
      }),
    );
  });

  it("successive createEnvelope calls produce non-decreasing timestamps", () => {
    fc.assert(
      fc.property(arbCreateEnvelopeBase, (base) => {
        const e1 = createEnvelope(base);
        const e2 = createEnvelope(base);
        expect(e2.timestamp).toBeGreaterThanOrEqual(e1.timestamp);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

describe("deserializeEnvelope — unit tests", () => {
  const REQUIRED_FIELDS = [
    "message_id",
    "request_id",
    "message_type",
    "timestamp",
    "source",
    "seq",
    "action",
    "resource_type",
    "payload",
  ] as const;

  /** A complete valid envelope object for use in unit tests. */
  const validEnvelopeObj: RegistryEnvelope = {
    message_id: "00000000-0000-4000-8000-000000000001",
    request_id: "00000000-0000-4000-8000-000000000002",
    message_type: "req",
    timestamp: 1_700_000_000_000,
    source: "agent-abc",
    session: null,
    seq: 0,
    action: "register",
    resource_type: "agent",
    payload: { hello: "world" },
    reply_to: null,
  };

  it("accepts a fully valid envelope", () => {
    const bytes = new TextEncoder().encode(JSON.stringify(validEnvelopeObj));
    const result = deserializeEnvelope(bytes);
    expect(result.message_id).toBe(validEnvelopeObj.message_id);
    expect(result.action).toBe("register");
  });

  it("throws on malformed JSON", () => {
    const bytes = new TextEncoder().encode("{not valid json");
    expect(() => deserializeEnvelope(bytes)).toThrow();
  });

  it("throws when the parsed value is not an object (array)", () => {
    const bytes = new TextEncoder().encode("[1, 2, 3]");
    expect(() => deserializeEnvelope(bytes)).toThrow();
  });

  it("throws when the parsed value is null", () => {
    const bytes = new TextEncoder().encode("null");
    expect(() => deserializeEnvelope(bytes)).toThrow();
  });

  it("throws when the parsed value is a primitive string", () => {
    const bytes = new TextEncoder().encode('"just a string"');
    expect(() => deserializeEnvelope(bytes)).toThrow();
  });

  it("allows missing 'reply_to' and defaults it to null", () => {
    const incomplete = { ...validEnvelopeObj } as Record<string, unknown>;
    delete incomplete.reply_to;
    const bytes = new TextEncoder().encode(JSON.stringify(incomplete));
    const result = deserializeEnvelope(bytes);
    expect(result.reply_to).toBeNull();
  });

  it("allows missing 'session' and defaults it to null", () => {
    const incomplete = { ...validEnvelopeObj } as Record<string, unknown>;
    delete incomplete.session;
    const bytes = new TextEncoder().encode(JSON.stringify(incomplete));
    const result = deserializeEnvelope(bytes);
    expect(result.session).toBeNull();
  });

  it("accepts session as a valid sessionKey string", () => {
    const withSession = {
      ...validEnvelopeObj,
      session: "agent:agent-001:group:abc12345-def6-7890-abcd-ef1234567890",
    };
    const bytes = new TextEncoder().encode(JSON.stringify(withSession));
    const result = deserializeEnvelope(bytes);
    expect(result.session).toBe("agent:agent-001:group:abc12345-def6-7890-abcd-ef1234567890");
  });

  it("accepts session as null", () => {
    const withNullSession = { ...validEnvelopeObj, session: null };
    const bytes = new TextEncoder().encode(JSON.stringify(withNullSession));
    const result = deserializeEnvelope(bytes);
    expect(result.session).toBeNull();
  });

  // One test per required field — missing field must throw
  for (const field of REQUIRED_FIELDS) {
    it(`throws when required field "${field}" is missing`, () => {
      const incomplete = { ...validEnvelopeObj } as Record<string, unknown>;
      delete incomplete[field];
      const bytes = new TextEncoder().encode(JSON.stringify(incomplete));
      expect(() => deserializeEnvelope(bytes)).toThrow();
    });

    it(`throws when required field "${field}" is null`, () => {
      const withNull = { ...validEnvelopeObj, [field]: null };
      const bytes = new TextEncoder().encode(JSON.stringify(withNull));
      expect(() => deserializeEnvelope(bytes)).toThrow();
    });
  }
});

describe("serializeEnvelope — unit tests", () => {
  it("produces a Uint8Array", () => {
    const envelope = createEnvelope({
      request_id: "00000000-0000-4000-8000-000000000002",
      message_type: "req",
      source: "agent-test",
      session: null,
      seq: 0,
      action: "register",
      resource_type: "agent",
      payload: {},
      reply_to: null,
    });
    const bytes = serializeEnvelope(envelope);
    expect(bytes).toBeInstanceOf(Uint8Array);
  });

  it("serialized output contains all required fields", () => {
    const envelope = createEnvelope({
      request_id: "00000000-0000-4000-8000-000000000002",
      message_type: "req",
      source: "agent-test",
      session: null,
      seq: 1,
      action: "heartbeat",
      resource_type: "agent",
      payload: { status: "online" },
      reply_to: null,
    });
    const bytes = serializeEnvelope(envelope);
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;

    const requiredFields = [
      "message_id",
      "request_id",
      "message_type",
      "timestamp",
      "source",
      "session",
      "seq",
      "action",
      "resource_type",
      "payload",
      "reply_to",
    ];
    for (const field of requiredFields) {
      expect(parsed).toHaveProperty(field);
    }
  });
});

describe("createEnvelope — unit tests", () => {
  it("auto-generates message_id as a UUID v4 string", () => {
    const envelope = createEnvelope({
      request_id: "00000000-0000-4000-8000-000000000002",
      message_type: "req",
      source: "agent-test",
      session: null,
      seq: 0,
      action: "register",
      resource_type: "agent",
      payload: {},
      reply_to: null,
    });
    // UUID v4 pattern: xxxxxxxx-xxxx-4xxx-[89ab]xxx-xxxxxxxxxxxx
    expect(envelope.message_id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("respects a caller-supplied message_id override", () => {
    const fixedId = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    const envelope = createEnvelope({
      message_id: fixedId,
      request_id: "00000000-0000-4000-8000-000000000002",
      message_type: "req",
      source: "agent-test",
      session: null,
      seq: 0,
      action: "register",
      resource_type: "agent",
      payload: {},
      reply_to: null,
    });
    expect(envelope.message_id).toBe(fixedId);
  });

  it("respects a caller-supplied timestamp override", () => {
    const fixedTs = 1_234_567_890_000;
    const envelope = createEnvelope({
      timestamp: fixedTs,
      request_id: "00000000-0000-4000-8000-000000000002",
      message_type: "req",
      source: "agent-test",
      session: null,
      seq: 0,
      action: "register",
      resource_type: "agent",
      payload: {},
      reply_to: null,
    });
    expect(envelope.timestamp).toBe(fixedTs);
  });

  it("defaults session to null when not provided", () => {
    const envelope = createEnvelope({
      request_id: "00000000-0000-4000-8000-000000000002",
      message_type: "req",
      source: "agent-test",
      seq: 0,
      action: "register",
      resource_type: "agent",
      payload: {},
      reply_to: null,
    } as any);
    expect(envelope.session).toBeNull();
  });

  it("preserves a caller-supplied session value", () => {
    const sessionKey = "agent:agent-test:group:abc123";
    const envelope = createEnvelope({
      request_id: "00000000-0000-4000-8000-000000000002",
      message_type: "req",
      source: "agent-test",
      session: sessionKey,
      seq: 0,
      action: "message",
      resource_type: "agent",
      payload: {},
      reply_to: null,
    });
    expect(envelope.session).toBe(sessionKey);
  });
});
