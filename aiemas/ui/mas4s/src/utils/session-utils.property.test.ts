/**
 * Property-based tests for session-utils.
 *
 * Feature: multi-agent-chat-view
 *
 * Properties tested in this file:
 *   Property 1: SessionKey 往返一致性
 *
 * Validates: Requirements 9.2, 9.3, 9.4
 */

import * as fc from "fast-check";
import { describe, it, expect } from "vitest";
import { buildSessionKey, extractAgentNameFromKey, extractUuidFromKey } from "./session-utils.js";

// ── Arbitraries ──

/** agentId: alphanumeric + hyphens, starts with a letter, 1-20 chars */
const arbAgentId = fc.stringMatching(/^[a-z][a-z0-9-]{0,19}$/);

/** UUID v4 format string */
const arbUuid = fc.uuid();

describe("Feature: multi-agent-chat-view, Property 1: SessionKey 往返一致性", () => {
  /**
   * Validates: Requirements 9.2, 9.3, 9.4
   *
   * For any valid agentId and sessionUuid, building a sessionKey with
   * buildSessionKey and then extracting agentId and uuid back should
   * produce the original values. Re-building from extracted parts should
   * yield the original key.
   */
  it("buildSessionKey(extractAgentNameFromKey(key), extractUuidFromKey(key)) === key", () => {
    fc.assert(
      fc.property(arbAgentId, arbUuid, (agentId: string, sessionUuid: string) => {
        const key = buildSessionKey(agentId, sessionUuid);

        // Extract parts
        const extractedAgentId = extractAgentNameFromKey(key);
        const extractedUuid = extractUuidFromKey(key);

        // Extracted parts match originals
        expect(extractedAgentId).toBe(agentId);
        expect(extractedUuid).toBe(sessionUuid);

        // Round-trip: rebuild from extracted parts equals original key
        const rebuilt = buildSessionKey(extractedAgentId, extractedUuid);
        expect(rebuilt).toBe(key);
      }),
      { numRuns: 100 },
    );
  });
});
