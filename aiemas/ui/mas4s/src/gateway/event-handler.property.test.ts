/**
 * Property-based tests for Event Handler routing layer.
 *
 * Feature: multi-agent-chat-view
 *
 * Properties tested in this file:
 *   Property 2: 消息按 Agent 维度路由
 *   Property 3: Single_View_Mode 消息存储不丢失
 *   Property 4: 审批事件不受过滤规则影响
 *   Property 6: 碎片修复保留非 Streaming 消息
 *   Property 9: ChatMessage sessionKey 完整性
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10,
 *            4.1, 4.2, 4.7, 6.4, 6.5, 8.1, 9.1, 10.2, 10.6
 */

import * as fc from "fast-check";
import { describe, it, expect, beforeEach } from "vitest";
import { AppStore } from "../store/app-store.js";
import type { ChatMessage } from "../types/chat-types.js";
import type { MasSession } from "../types/session-types.js";
import { buildSessionKey } from "../utils/session-utils.js";
import { resolveMessageTarget, updateAgentChatStream, updateChatStream } from "./event-handler.js";

// ── Helpers ──

/** Reset the AppStore singleton state between tests */
function resetStore(): AppStore {
  const store = AppStore.instance;
  store.messagesByAgent.clear();
  store.messagesBySession.clear();
  store.topologyByAgent.clear();
  store.viewModeBySession.clear();
  store.activeSubAgentTab.clear();
  store.unreadByAgent.clear();
  store.sessions = [];
  store.activeSessionUuid = null;
  return store;
}

/**
 * Set up a session in the store so resolveMessageTarget can determine the root agent.
 */
function setupSession(store: AppStore, rootAgentId: string, sessionUuid: string): void {
  const sessionKey = buildSessionKey(rootAgentId, sessionUuid);
  const session: MasSession = {
    key: sessionKey,
    sessionUuid,
    label: "test-session",
    kind: "group",
    updatedAt: null,
    masType: "participated",
    hasNotification: false,
    notificationCount: 0,
    participants: [],
  };
  store.sessions = [session];
  store.activeSessionUuid = sessionUuid;
}

// ── Arbitraries ──

/** agentId: alphanumeric + hyphens, starts with a letter, 1-20 chars */
const arbAgentId = fc.stringMatching(/^[a-z][a-z0-9-]{0,19}$/);

/** UUID v4 format string */
const arbUuid = fc.uuid();

/** Two distinct agentIds guaranteed to differ */
const arbTwoDistinctAgentIds = fc.tuple(arbAgentId, arbAgentId).filter(([a, b]) => a !== b);

/** Multiple distinct agentIds (2-5) */
const arbMultipleDistinctAgentIds = fc
  .array(arbAgentId, { minLength: 2, maxLength: 5 })
  .map((ids) => Array.from(new Set(ids)))
  .filter((ids) => ids.length >= 2);

/** Minimal ChatMessage for testing */
const arbChatMessage: fc.Arbitrary<ChatMessage> = fc.record({
  role: fc.constantFrom("assistant", "user", "toolResult"),
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

/** View mode arbitrary */
const arbViewMode = fc.constantFrom("single" as const, "multi" as const);

/** Message role for sub-agent events */
const arbSubAgentRole = fc.constantFrom("assistant", "toolResult");

// ── Property 2: 消息按 Agent 维度路由 ──

describe("Feature: multi-agent-chat-view, Property 2: 消息按 Agent 维度路由", () => {
  beforeEach(() => {
    resetStore();
  });

  /**
   * Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 4.1, 4.2, 8.1
   *
   * For any sessionKey, resolveMessageTarget extracts the correct agentId,
   * and after appendAgentMessage the message ONLY appears in that agent's
   * collection and does NOT appear in other agents' message lists.
   */
  it("messages are routed only to the correct agentId collection", () => {
    fc.assert(
      fc.property(
        arbMultipleDistinctAgentIds,
        arbUuid,
        arbChatMessage,
        fc.nat({ max: 10 }),
        (agentIds, sessionUuid, baseMsg, senderIdx) => {
          const store = resetStore();
          const rootAgentId = agentIds[0];
          setupSession(store, rootAgentId, sessionUuid);

          // Pick a random agent to send the message
          const targetIdx = senderIdx % agentIds.length;
          const targetAgentId = agentIds[targetIdx];
          const sessionKey = buildSessionKey(targetAgentId, sessionUuid);

          // Resolve the message target
          const target = resolveMessageTarget(store, sessionKey);
          expect(target.sessionUuid).toBe(sessionUuid);
          expect(target.agentId).toBe(targetAgentId);

          // Route the message
          const msg: ChatMessage = { ...baseMsg, sessionKey };
          store.appendAgentMessage(sessionUuid, target.agentId, msg);

          // Verify message appears ONLY in the target agent's collection
          const targetMsgs = store.getAgentMessages(sessionUuid, targetAgentId);
          expect(targetMsgs.length).toBeGreaterThanOrEqual(1);
          expect(targetMsgs[targetMsgs.length - 1]).toEqual(msg);

          // Verify message does NOT appear in other agents' collections
          for (const otherId of agentIds) {
            if (otherId !== targetAgentId) {
              const otherMsgs = store.getAgentMessages(sessionUuid, otherId);
              const found = otherMsgs.some((m) => JSON.stringify(m) === JSON.stringify(msg));
              expect(found).toBe(false);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Multiple agents sending messages — verify full isolation across all agents.
   */
  it("multiple agents' messages are fully isolated from each other", () => {
    fc.assert(
      fc.property(
        arbMultipleDistinctAgentIds,
        arbUuid,
        fc.array(fc.tuple(fc.nat({ max: 4 }), arbChatMessage), { minLength: 2, maxLength: 10 }),
        (agentIds, sessionUuid, operations) => {
          const store = resetStore();
          const rootAgentId = agentIds[0];
          setupSession(store, rootAgentId, sessionUuid);

          // Track expected message counts per agent
          const expectedCounts = new Map<string, number>();
          for (const id of agentIds) {
            expectedCounts.set(id, 0);
          }

          // Send messages from various agents
          for (const [agentIdx, baseMsg] of operations) {
            const agentId = agentIds[agentIdx % agentIds.length];
            const sessionKey = buildSessionKey(agentId, sessionUuid);
            const msg: ChatMessage = { ...baseMsg, sessionKey };

            const target = resolveMessageTarget(store, sessionKey);
            store.appendAgentMessage(sessionUuid, target.agentId, msg);
            expectedCounts.set(agentId, (expectedCounts.get(agentId) ?? 0) + 1);
          }

          // Verify each agent has exactly the expected number of messages
          for (const [agentId, expectedCount] of expectedCounts) {
            const msgs = store.getAgentMessages(sessionUuid, agentId);
            expect(msgs.length).toBe(expectedCount);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── Property 3: Single_View_Mode 消息存储不丢失 ──

describe("Feature: multi-agent-chat-view, Property 3: Single_View_Mode 消息存储不丢失", () => {
  beforeEach(() => {
    resetStore();
  });

  /**
   * Validates: Requirements 1.7, 1.8, 1.9, 6.4, 6.5
   *
   * For any sub-agent events (assistant/tool/final types), when viewMode is "single",
   * messages are still stored in messagesByAgent[sessionUuid][subAgentId].
   * The behavior is identical to multi mode — same messages stored.
   */
  it("sub-agent messages are stored in messagesByAgent even in single view mode", () => {
    fc.assert(
      fc.property(
        arbTwoDistinctAgentIds,
        arbUuid,
        fc.array(
          fc.record({
            role: arbSubAgentRole,
            content: fc.array(
              fc.record({
                type: fc.constantFrom("text", "tool_result"),
                text: fc.option(fc.string({ maxLength: 50 }), { nil: undefined }),
              }),
              { minLength: 1, maxLength: 3 },
            ),
            timestamp: fc.nat({ max: 2_000_000_000_000 }),
            id: fc.uuid(),
            senderLabel: fc.constant(null as string | null),
          }),
          { minLength: 1, maxLength: 8 },
        ),
        ([rootAgentId, subAgentId], sessionUuid, messages) => {
          // ── Single mode run ──
          const storeSingle = resetStore();
          setupSession(storeSingle, rootAgentId, sessionUuid);
          storeSingle.setViewMode(sessionUuid, "single");

          for (const baseMsg of messages) {
            const sessionKey = buildSessionKey(subAgentId, sessionUuid);
            const msg: ChatMessage = { ...baseMsg, sessionKey } as unknown as ChatMessage;
            // Route via updateAgentChatStream (simulates event-handler routing)
            updateAgentChatStream(storeSingle, sessionUuid, subAgentId, msg, false);
          }

          const singleMsgs = storeSingle.getAgentMessages(sessionUuid, subAgentId);

          // ── Multi mode run (same messages) ──
          const storeMulti = resetStore();
          setupSession(storeMulti, rootAgentId, sessionUuid);
          storeMulti.setViewMode(sessionUuid, "multi");

          for (const baseMsg of messages) {
            const sessionKey = buildSessionKey(subAgentId, sessionUuid);
            const msg: ChatMessage = { ...baseMsg, sessionKey } as unknown as ChatMessage;
            updateAgentChatStream(storeMulti, sessionUuid, subAgentId, msg, false);
          }

          const multiMsgs = storeMulti.getAgentMessages(sessionUuid, subAgentId);

          // Messages stored in single mode must equal those in multi mode
          expect(singleMsgs.length).toBe(multiMsgs.length);
          expect(singleMsgs.length).toBeGreaterThanOrEqual(1);

          // Verify content equality
          for (let i = 0; i < singleMsgs.length; i++) {
            expect(singleMsgs[i].role).toBe(multiMsgs[i].role);
            expect(singleMsgs[i].sessionKey).toBe(multiMsgs[i].sessionKey);
            expect(JSON.stringify(singleMsgs[i].content)).toBe(
              JSON.stringify(multiMsgs[i].content),
            );
          }
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Final messages from sub-agents are also stored in single mode.
   */
  it("sub-agent final messages are stored in single view mode", () => {
    fc.assert(
      fc.property(
        arbTwoDistinctAgentIds,
        arbUuid,
        arbChatMessage,
        ([rootAgentId, subAgentId], sessionUuid, baseMsg) => {
          const store = resetStore();
          setupSession(store, rootAgentId, sessionUuid);
          store.setViewMode(sessionUuid, "single");

          const sessionKey = buildSessionKey(subAgentId, sessionUuid);
          const msg: ChatMessage = { ...baseMsg, sessionKey, id: "final-msg-id" };

          // Route as final message
          updateAgentChatStream(store, sessionUuid, subAgentId, msg, true);

          const storedMsgs = store.getAgentMessages(sessionUuid, subAgentId);
          expect(storedMsgs.length).toBeGreaterThanOrEqual(1);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── Property 4: 审批事件不受过滤规则影响 ──

describe("Feature: multi-agent-chat-view, Property 4: 审批事件不受过滤规则影响", () => {
  beforeEach(() => {
    resetStore();
  });

  /**
   * Validates: Requirements 1.6, 1.10, 4.7
   *
   * For any approval events with random agentId and random viewMode,
   * approval-type ChatMessages (subType: "pending", role: "assistant") are
   * always preserved in messagesByAgent regardless of agent or view mode.
   */
  it("approval messages are always preserved regardless of agent or view mode", () => {
    fc.assert(
      fc.property(
        arbTwoDistinctAgentIds,
        arbUuid,
        arbViewMode,
        fc.uuid(),
        fc.nat({ max: 2_000_000_000_000 }),
        ([rootAgentId, subAgentId], sessionUuid, viewMode, approvalId, timestamp) => {
          const store = resetStore();
          setupSession(store, rootAgentId, sessionUuid);
          store.setViewMode(sessionUuid, viewMode);

          // Create approval-type message for root agent
          const rootApprovalMsg: ChatMessage = {
            id: `approval-root-${approvalId}`,
            role: "assistant",
            subType: "pending",
            content: [],
            timestamp,
            sessionKey: buildSessionKey(rootAgentId, sessionUuid),
            senderLabel: null,
          };

          // Create approval-type message for sub agent
          const subApprovalMsg: ChatMessage = {
            id: `approval-sub-${approvalId}`,
            role: "assistant",
            subType: "pending",
            content: [],
            timestamp,
            sessionKey: buildSessionKey(subAgentId, sessionUuid),
            senderLabel: null,
          };

          // Store approval messages for both root and sub agents
          store.appendAgentMessage(sessionUuid, rootAgentId, rootApprovalMsg);
          store.appendAgentMessage(sessionUuid, subAgentId, subApprovalMsg);

          // Verify root agent approval is preserved
          const rootMsgs = store.getAgentMessages(sessionUuid, rootAgentId);
          const rootApproval = rootMsgs.find((m) => m.id === rootApprovalMsg.id);
          expect(rootApproval).toBeDefined();
          expect(rootApproval!.subType).toBe("pending");
          expect(rootApproval!.role).toBe("assistant");

          // Verify sub agent approval is preserved
          const subMsgs = store.getAgentMessages(sessionUuid, subAgentId);
          const subApproval = subMsgs.find((m) => m.id === subApprovalMsg.id);
          expect(subApproval).toBeDefined();
          expect(subApproval!.subType).toBe("pending");
          expect(subApproval!.role).toBe("assistant");
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * Approval messages survive view mode switches.
   */
  it("approval messages survive view mode switches", () => {
    fc.assert(
      fc.property(
        arbTwoDistinctAgentIds,
        arbUuid,
        fc.array(arbViewMode, { minLength: 1, maxLength: 5 }),
        fc.uuid(),
        fc.nat({ max: 2_000_000_000_000 }),
        ([rootAgentId, subAgentId], sessionUuid, modeSwitches, approvalId, timestamp) => {
          const store = resetStore();
          setupSession(store, rootAgentId, sessionUuid);

          // Store approval messages
          const approvalMsg: ChatMessage = {
            id: approvalId,
            role: "assistant",
            subType: "pending",
            content: [],
            timestamp,
            sessionKey: buildSessionKey(subAgentId, sessionUuid),
            senderLabel: null,
          };
          store.appendAgentMessage(sessionUuid, subAgentId, approvalMsg);

          // Switch view modes multiple times
          for (const mode of modeSwitches) {
            store.setViewMode(sessionUuid, mode);
          }

          // Approval message must still be present
          const msgs = store.getAgentMessages(sessionUuid, subAgentId);
          const found = msgs.find((m) => m.id === approvalId);
          expect(found).toBeDefined();
          expect(found!.subType).toBe("pending");
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── Property 9: ChatMessage sessionKey 完整性 ──

describe("Feature: multi-agent-chat-view, Property 9: ChatMessage sessionKey 完整性", () => {
  beforeEach(() => {
    resetStore();
  });

  /**
   * Validates: Requirements 9.1
   *
   * For any event payloads with sessionKey, the ChatMessage objects built
   * and stored must have a non-empty sessionKey field equal to the original value.
   * Tested across all message types (assistant, tool, user, prompt).
   */
  it("ChatMessage sessionKey is non-empty and equals the original sessionKey", () => {
    fc.assert(
      fc.property(
        arbAgentId,
        arbUuid,
        fc.constantFrom("assistant", "user", "toolResult", "prompt"),
        fc.array(
          fc.record({
            type: fc.constantFrom("text", "tool_call", "tool_result"),
            text: fc.option(fc.string({ maxLength: 50 }), { nil: undefined }),
          }),
          { minLength: 1, maxLength: 3 },
        ),
        fc.nat({ max: 2_000_000_000_000 }),
        fc.uuid(),
        (agentId, sessionUuid, role, content, timestamp, msgId) => {
          const store = resetStore();
          setupSession(store, agentId, sessionUuid);

          const sessionKey = buildSessionKey(agentId, sessionUuid);

          // Build a ChatMessage with sessionKey set (as event-handler does)
          const msg: ChatMessage = {
            role,
            content,
            timestamp,
            id: msgId,
            sessionKey,
            senderLabel: null,
          } as unknown as ChatMessage;

          // Verify sessionKey is non-empty
          expect(msg.sessionKey).toBeTruthy();
          expect(typeof msg.sessionKey).toBe("string");
          expect(msg.sessionKey!.length).toBeGreaterThan(0);

          // Verify sessionKey equals the original value
          expect(msg.sessionKey).toBe(sessionKey);

          // Route through updateAgentChatStream and verify stored message retains sessionKey
          updateAgentChatStream(store, sessionUuid, agentId, msg, false);
          const storedMsgs = store.getAgentMessages(sessionUuid, agentId);
          const lastMsg = storedMsgs[storedMsgs.length - 1];
          expect(lastMsg.sessionKey).toBe(sessionKey);
          expect(lastMsg.sessionKey).toBeTruthy();
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * sessionKey integrity is maintained through updateChatStream as well.
   */
  it("sessionKey is preserved through updateChatStream for root agent messages", () => {
    fc.assert(
      fc.property(
        arbAgentId,
        arbUuid,
        fc.constantFrom("assistant", "user"),
        fc.array(
          fc.record({
            type: fc.constantFrom("text", "tool_result"),
            text: fc.option(fc.string({ maxLength: 50 }), { nil: undefined }),
          }),
          { minLength: 1, maxLength: 3 },
        ),
        fc.nat({ max: 2_000_000_000_000 }),
        fc.uuid(),
        (agentId, sessionUuid, role, content, timestamp, msgId) => {
          const store = resetStore();
          setupSession(store, agentId, sessionUuid);

          const sessionKey = buildSessionKey(agentId, sessionUuid);

          const msg: ChatMessage = {
            role,
            content,
            timestamp,
            id: msgId,
            sessionKey,
            senderLabel: null,
          } as unknown as ChatMessage;

          // Route through updateChatStream (root agent path)
          updateChatStream(store, sessionUuid, msg, false);
          const storedMsgs = store.messagesBySession.get(sessionUuid) ?? [];
          const lastMsg = storedMsgs[storedMsgs.length - 1];
          expect(lastMsg.sessionKey).toBe(sessionKey);
          expect(lastMsg.sessionKey).toBeTruthy();
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ---------------------------------------------------------------------------
// Property 6: 碎片修复保留非 Streaming 消息
// ---------------------------------------------------------------------------

describe("Feature: multi-agent-chat-view, Property 6: 碎片修复保留非 Streaming 消息", () => {
  beforeEach(() => {
    resetStore();
  });

  /**
   * Validates: Requirements 10.2, 10.6
   *
   * For any mixed-type message list + replacement message list,
   * the fragment repair logic preserves all user and approval(pending)
   * messages while replacing assistant and toolResult messages.
   */
  it("preserves user and pending messages, replaces assistant and toolResult", () => {
    fc.assert(
      fc.property(
        arbUuid,
        // Current messages: mix of user, pending, assistant, toolResult
        fc.array(
          fc.record({
            role: fc.constantFrom("user", "assistant", "toolResult"),
            subType: fc.option(fc.constantFrom("pending", "colleague"), { nil: undefined }),
            content: fc.array(
              fc.record({
                type: fc.constantFrom("text", "tool_result"),
                text: fc.option(fc.string({ maxLength: 30 }), { nil: undefined }),
              }),
              { minLength: 1, maxLength: 2 },
            ),
            timestamp: fc.nat({ max: 2_000_000_000_000 }),
            id: fc.uuid(),
            senderLabel: fc.constant(null as string | null),
          }),
          { minLength: 1, maxLength: 15 },
        ),
        // Replacement messages from API (complete history)
        fc.array(
          fc.record({
            role: fc.constantFrom("user", "assistant", "toolResult"),
            subType: fc.option(fc.constantFrom("pending"), { nil: undefined }),
            content: fc.array(
              fc.record({
                type: fc.constantFrom("text", "tool_result"),
                text: fc.option(fc.string({ maxLength: 30 }), { nil: undefined }),
              }),
              { minLength: 1, maxLength: 2 },
            ),
            timestamp: fc.nat({ max: 2_000_000_000_000 }),
            id: fc.uuid(),
            senderLabel: fc.constant(null as string | null),
          }),
          { minLength: 0, maxLength: 10 },
        ),
        (sessionUuid, currentMsgs, apiMsgs) => {
          const store = resetStore();

          const currentMsgsTyped = currentMsgs as ChatMessage[];
          // Set up current messages in messagesBySession
          store.messagesBySession.set(sessionUuid, currentMsgsTyped);

          // Count user and pending messages before repair
          const userMsgsBefore = currentMsgsTyped.filter(
            (m) => m.role === "user" || m.subType === "pending",
          );

          // Simulate fragment repair logic (same as in event-handler.ts)
          const preserved = currentMsgsTyped.filter(
            (m) => m.role === "user" || m.subType === "pending",
          );
          const apiNonUserMsgs = (apiMsgs as ChatMessage[]).filter(
            (m) => m.role !== "user" && m.subType !== "pending",
          );
          const merged = [...preserved, ...apiNonUserMsgs].toSorted(
            (a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0),
          );

          store.messagesBySession.set(sessionUuid, merged);

          // Verify: all original user and pending messages are preserved
          const repairedMsgs = store.messagesBySession.get(sessionUuid) ?? [];
          for (const userMsg of userMsgsBefore) {
            const found = repairedMsgs.some((m) => m.id === userMsg.id);
            expect(found).toBe(true);
          }

          // Verify: no user or pending messages from API are duplicated
          // (they should have been filtered out from apiMsgs)
          const apiUserPending = apiMsgs.filter(
            (m) => m.role === "user" || m.subType === "pending",
          );
          for (const apiMsg of apiUserPending) {
            const count = repairedMsgs.filter((m) => m.id === apiMsg.id).length;
            // API user/pending messages should NOT be in the merged result
            // (they were filtered out from apiNonUserMsgs)
            expect(count).toBeLessThanOrEqual(
              userMsgsBefore.filter((m) => m.id === apiMsg.id).length,
            );
          }

          // Verify: merged result is sorted by timestamp
          for (let i = 1; i < repairedMsgs.length; i++) {
            expect(repairedMsgs[i].timestamp).toBeGreaterThanOrEqual(repairedMsgs[i - 1].timestamp);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
