/**
 * Property-based tests for AppStore state layer.
 *
 * Feature: multi-agent-chat-view
 *
 * Properties tested in this file:
 *   Property 5: Streaming 消息的 Agent 隔离
 *   Property 7: 未读指示器准确性
 *   Property 10: 拓扑缓存幂等性
 *   Property 11: 视图模式切换保留消息数据
 *
 * Validates: Requirements 2.2, 5.4, 6.4, 6.5, 7.1, 7.2
 */

import * as fc from "fast-check";
import { describe, it, expect, beforeEach } from "vitest";
import type { ChatMessage } from "../types/chat-types.js";
import { AppStore } from "./app-store.js";
import type { TopologyEdge } from "./app-store.js";

// ── Helpers ──

/** Reset the AppStore singleton state between tests */
function resetStore(): AppStore {
  const store = AppStore.instance;
  store.messagesByAgent.clear();
  store.topologyByAgent.clear();
  store.viewModeBySession.clear();
  store.activeSubAgentTab.clear();
  store.unreadByAgent.clear();
  store.messagesBySession.clear();
  store.sessions = [];
  return store;
}

// ── Arbitraries ──

/** agentId: alphanumeric + hyphens, starts with a letter, 1-20 chars */
const arbAgentId = fc.stringMatching(/^[a-z][a-z0-9-]{0,19}$/);

/** UUID v4 format string */
const arbUuid = fc.uuid();

/** Minimal ChatMessage for testing */
const arbChatMessage: fc.Arbitrary<ChatMessage> = fc.record({
  role: fc.constantFrom("assistant", "user", "tool"),
  content: fc.array(
    fc.record({
      type: fc.constantFrom("text", "tool_call", "tool_result"),
      text: fc.option(fc.string({ maxLength: 50 }), { nil: undefined }),
    }),
    { minLength: 1, maxLength: 3 },
  ),
  timestamp: fc.nat({ max: 2_000_000_000_000 }),
  id: fc.option(fc.uuid(), { nil: undefined }),
  senderLabel: fc.option(fc.string({ maxLength: 10 }), { nil: undefined }),
});

/** Two distinct agentIds guaranteed to differ */
const arbTwoDistinctAgentIds = fc.tuple(arbAgentId, arbAgentId).filter(([a, b]) => a !== b);

/** TopologyEdge arbitrary */
const arbTopologyEdge: fc.Arbitrary<TopologyEdge> = fc.record({
  from: arbAgentId,
  to: arbAgentId,
});

/** View mode arbitrary */
const arbViewMode = fc.constantFrom("single" as const, "multi" as const);

// ── Property 5: Streaming 消息的 Agent 隔离 ──

describe("Feature: multi-agent-chat-view, Property 5: Streaming 消息的 Agent 隔离", () => {
  beforeEach(() => {
    resetStore();
  });

  /**
   * Validates: Requirements 7.1, 7.2
   *
   * For any two different Agents (agentA ≠ agentB) with interleaved streaming
   * event sequences, updateAgentLastMessage only modifies the target Agent's
   * message list. The other agent's messages must remain unchanged.
   */
  it("updateAgentLastMessage only modifies the target Agent's messages", () => {
    fc.assert(
      fc.property(
        arbTwoDistinctAgentIds,
        arbUuid,
        fc.array(arbChatMessage, { minLength: 1, maxLength: 5 }),
        fc.array(arbChatMessage, { minLength: 1, maxLength: 5 }),
        fc.array(
          fc.record({
            target: fc.constantFrom("A", "B"),
            msg: arbChatMessage,
          }),
          { minLength: 1, maxLength: 10 },
        ),
        ([agentA, agentB], sessionUuid, msgsA, msgsB, streamOps) => {
          const store = resetStore();

          // Seed initial messages for both agents
          for (const m of msgsA) {
            store.appendAgentMessage(sessionUuid, agentA, m);
          }
          for (const m of msgsB) {
            store.appendAgentMessage(sessionUuid, agentB, m);
          }

          // Apply interleaved streaming updates
          for (const op of streamOps) {
            const targetAgent = op.target === "A" ? agentA : agentB;
            const otherAgent = op.target === "A" ? agentB : agentA;

            // Snapshot the other agent's messages before update
            const otherBefore = store.getAgentMessages(sessionUuid, otherAgent);
            const otherBeforeSnapshot = JSON.stringify(otherBefore);

            // Perform streaming update on target agent
            store.updateAgentLastMessage(sessionUuid, targetAgent, op.msg);

            // Verify other agent's messages are unchanged
            const otherAfter = store.getAgentMessages(sessionUuid, otherAgent);
            expect(JSON.stringify(otherAfter)).toBe(otherBeforeSnapshot);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── Property 7: 未读指示器准确性 ──

describe("Feature: multi-agent-chat-view, Property 7: 未读指示器准确性", () => {
  beforeEach(() => {
    resetStore();
  });

  /**
   * Validates: Requirements 5.4
   *
   * For random sub-agent messages and random activeTab:
   * - After markAgentUnread(uuid, agentId), the agentId is in the unread set
   * - After clearAgentUnread(uuid, agentId), the agentId is NOT in the unread set
   * - markAgentUnread for one agent doesn't affect other agents' unread status
   */
  it("markAgentUnread/clearAgentUnread correctly tracks per-agent unread state", () => {
    fc.assert(
      fc.property(
        arbUuid,
        fc.array(arbAgentId, { minLength: 2, maxLength: 6 }),
        fc.array(
          fc.record({
            action: fc.constantFrom("mark", "clear"),
            agentIndex: fc.nat({ max: 5 }),
          }),
          { minLength: 1, maxLength: 20 },
        ),
        (sessionUuid, agentIds, operations) => {
          const store = resetStore();
          // Deduplicate agent IDs
          const uniqueAgents = [...new Set(agentIds)];
          if (uniqueAgents.length < 2) {
            return;
          } // Need at least 2 distinct agents

          for (const op of operations) {
            const agentIdx = op.agentIndex % uniqueAgents.length;
            const agentId = uniqueAgents[agentIdx];

            if (op.action === "mark") {
              // Snapshot other agents' unread status before
              const otherStatuses = new Map<string, boolean>();
              for (const other of uniqueAgents) {
                if (other !== agentId) {
                  const unreadSet = store.unreadByAgent.get(sessionUuid);
                  otherStatuses.set(other, unreadSet?.has(other) ?? false);
                }
              }

              store.markAgentUnread(sessionUuid, agentId);

              // After mark: agentId must be in unread set
              const unreadSet = store.unreadByAgent.get(sessionUuid);
              expect(unreadSet?.has(agentId)).toBe(true);

              // Other agents' unread status must be unchanged
              for (const [other, wasBefore] of otherStatuses) {
                expect(unreadSet?.has(other) ?? false).toBe(wasBefore);
              }
            } else {
              store.clearAgentUnread(sessionUuid, agentId);

              // After clear: agentId must NOT be in unread set
              const unreadSet = store.unreadByAgent.get(sessionUuid);
              expect(unreadSet?.has(agentId) ?? false).toBe(false);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── Property 10: 拓扑缓存幂等性 ──

describe("Feature: multi-agent-chat-view, Property 10: 拓扑缓存幂等性", () => {
  beforeEach(() => {
    resetStore();
  });

  /**
   * Validates: Requirements 2.2
   *
   * For any rootAgentId and edges array:
   * - setTopology followed by getTopology returns the same data
   * - Calling setTopology multiple times with same data produces same result as single call
   */
  it("setTopology/getTopology round-trip and idempotency", () => {
    fc.assert(
      fc.property(
        arbAgentId,
        fc.array(arbTopologyEdge, { maxLength: 10 }),
        fc.integer({ min: 1, max: 5 }),
        (rootAgentId, edges, repeatCount) => {
          const store = resetStore();

          // Single call: set and get
          store.setTopology(rootAgentId, edges);
          const afterSingle = store.getTopology(rootAgentId);

          // Verify round-trip: getTopology returns same data
          expect(afterSingle).toEqual(edges);

          // Multiple calls with same data
          for (let i = 0; i < repeatCount; i++) {
            store.setTopology(rootAgentId, edges);
          }
          const afterMultiple = store.getTopology(rootAgentId);

          // Idempotency: multiple calls produce same result as single call
          expect(afterMultiple).toEqual(afterSingle);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── Property 11: 视图模式切换保留消息数据 ──

describe("Feature: multi-agent-chat-view, Property 11: 视图模式切换保留消息数据", () => {
  beforeEach(() => {
    resetStore();
  });

  /**
   * Validates: Requirements 6.4, 6.5
   *
   * For random messages and random mode switch sequences:
   * - First populate messagesByAgent with messages via appendAgentMessage
   * - Then switch view modes multiple times via setViewMode
   * - Verify messagesByAgent data is NOT cleared or modified by mode switches
   */
  it("setViewMode does not clear or modify messagesByAgent data", () => {
    fc.assert(
      fc.property(
        arbUuid,
        fc.array(fc.tuple(arbAgentId, arbChatMessage), { minLength: 1, maxLength: 10 }),
        fc.array(arbViewMode, { minLength: 1, maxLength: 10 }),
        (sessionUuid, agentMessages, modeSwitches) => {
          const store = resetStore();

          // Populate messages for various agents
          for (const [agentId, msg] of agentMessages) {
            store.appendAgentMessage(sessionUuid, agentId, msg);
          }

          // Snapshot messagesByAgent before mode switches
          const snapshotBefore = new Map<string, string>();
          const agentMap = store.messagesByAgent.get(sessionUuid);
          if (agentMap) {
            for (const [agentId, msgs] of agentMap) {
              snapshotBefore.set(agentId, JSON.stringify(msgs));
            }
          }

          // Apply mode switches
          for (const mode of modeSwitches) {
            store.setViewMode(sessionUuid, mode);
          }

          // Verify messagesByAgent is unchanged after mode switches
          const agentMapAfter = store.messagesByAgent.get(sessionUuid);
          expect(agentMapAfter).toBeDefined();
          for (const [agentId, expectedJson] of snapshotBefore) {
            const actualMsgs = agentMapAfter!.get(agentId);
            expect(JSON.stringify(actualMsgs)).toBe(expectedJson);
          }

          // Verify no agents were removed
          expect(agentMapAfter!.size).toBe(snapshotBefore.size);
        },
      ),
      { numRuns: 100 },
    );
  });
});
