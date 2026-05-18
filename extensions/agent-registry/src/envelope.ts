/**
 * RegistryEnvelope serialization, deserialization, and factory.
 *
 * - serializeEnvelope: JSON → UTF-8 bytes
 * - deserializeEnvelope: UTF-8 bytes → validated RegistryEnvelope
 * - createEnvelope: build a RegistryEnvelope with auto-generated message_id / timestamp
 */

import { v4 as uuidv4 } from "uuid";
import type { RegistryEnvelope } from "./types.js";

// ---------------------------------------------------------------------------
// Required fields — all must be present and non-null, except reply_to which
// is typed as `string | null` and may legitimately be null.
// ---------------------------------------------------------------------------

/** Fields that must be present AND non-null. */
const REQUIRED_NON_NULL_FIELDS: ReadonlyArray<keyof RegistryEnvelope> = [
  "message_id",
  "request_id",
  "message_type",
  "timestamp",
  "source",
  "seq",
  "action",
  "resource_type",
  "payload",
];

/** Fields that must be present (key exists) but may be null. */
const REQUIRED_PRESENT_FIELDS: ReadonlyArray<keyof RegistryEnvelope> = [];

// ---------------------------------------------------------------------------
// serializeEnvelope
// ---------------------------------------------------------------------------

/**
 * Serialize a RegistryEnvelope to UTF-8 encoded JSON bytes.
 *
 * Requirements: 10.1, 10.5
 */
export function serializeEnvelope(envelope: RegistryEnvelope): Uint8Array {
  const json = JSON.stringify(envelope);
  return new TextEncoder().encode(json);
}

// ---------------------------------------------------------------------------
// deserializeEnvelope
// ---------------------------------------------------------------------------

/**
 * Deserialize UTF-8 bytes into a validated RegistryEnvelope.
 *
 * Throws if:
 * - bytes cannot be decoded as UTF-8
 * - the decoded string is not valid JSON
 * - any required non-nullable field is missing or null/undefined
 *
 * Requirements: 10.1, 10.6
 */
export function deserializeEnvelope(bytes: Uint8Array): RegistryEnvelope {
  let json: string;
  try {
    json = new TextDecoder().decode(bytes);
  } catch (err) {
    throw new Error(`RegistryEnvelope: failed to decode bytes as UTF-8: ${String(err)}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new Error(`RegistryEnvelope: invalid JSON: ${String(err)}`);
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("RegistryEnvelope: parsed value is not an object");
  }

  const obj = parsed as Record<string, unknown>;

  for (const field of REQUIRED_NON_NULL_FIELDS) {
    if (obj[field] === undefined || obj[field] === null) {
      throw new Error(`RegistryEnvelope: required field "${field}" is missing or null`);
    }
  }

  for (const field of REQUIRED_PRESENT_FIELDS) {
    if (!(field in obj)) {
      throw new Error(`RegistryEnvelope: required field "${field}" is missing`);
    }
  }

  // reply_to is optional; defaults to null if missing or undefined
  if (obj.reply_to === undefined) {
    obj.reply_to = null;
  }

  return obj as unknown as RegistryEnvelope;
}

// ---------------------------------------------------------------------------
// createEnvelope
// ---------------------------------------------------------------------------

/**
 * Build a RegistryEnvelope, auto-generating `message_id` (UUID v4) and
 * `timestamp` (Date.now()) when not provided by the caller.
 *
 * Callers may override both fields for deterministic testing.
 *
 * Requirements: 10.2, 10.3
 */
export function createEnvelope(
  fields: Omit<RegistryEnvelope, "message_id" | "timestamp"> &
    Partial<Pick<RegistryEnvelope, "message_id" | "timestamp">>,
): RegistryEnvelope {
  return {
    message_id: fields.message_id ?? uuidv4(),
    timestamp: fields.timestamp ?? Date.now(),
    request_id: fields.request_id,
    message_type: fields.message_type,
    source: fields.source,
    seq: fields.seq,
    action: fields.action,
    resource_type: fields.resource_type,
    payload: fields.payload,
    reply_to: fields.reply_to,
  };
}
