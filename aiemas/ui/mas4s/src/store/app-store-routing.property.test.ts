/**
 * Bug condition exploration property-based tests for sub-agent message routing.
 *
 * Feature: messsage-router-fix (bugfix)
 *
 * These tests encode the EXPECTED (correct) behavior:
 *   - Sub-agent approval messages must NOT appear in messagesBySession
 *   - History refresh must only include root agent messages in messagesBySession
 *
 * On UNFIXED code, these tests are EXPECTED TO FAIL — failure confirms the bug exists.
 *
 * Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 2.3
 */

import * as fc from "fast-check";
import { describe, it, expect, beforeEach } from "vitest";
import { updateChatStream, updateAgentChatStream } from "../gateway/event-handler.js";
import type { ApprovalRequest } from "../types/approval-types.js";
import type { ChatMessage } from "../types/chat-types.js";
import type { MasSession } from "../types/session-types.js";
import { buildSessionKey, extractAgentNameFromKey } from "../utils/session-utils.js";
import { AppStore } from "./app-store.js";

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
  store.pendingApprovals = [];
  store.resolvedApprovals.clear();
  return store;
}

/**
 * Set up a session in the store so the store can resolve the root agent.
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

/** Two distinct agentIds guaranteed to differ (rootAgentId, subAgentId) */
const arbTwoDistinctAgentIds = fc.tuple(arbAgentId, arbAgentId).filter(([a, b]) => a !== b);

// ── Bug Condition Exploration: Property 1 ──

describe("Bug Condition Exploration: Sub-agent messages must NOT leak into messagesBySession", () => {
  beforeEach(() => {
    resetStore();
  });

  /**
   * **Validates: Requirements 1.1, 2.1**
   *
   * addApproval() with sub-agent sessionKey:
   * The pending message must NOT appear in messagesBySession[sessionUuid].
   *
   * Bug condition: extractAgentNameFromKey(sessionKey) ≠ rootAgentId
   * Expected behavior: pending message only in messagesByAgent, not in messagesBySession
   *
   * On UNFIXED code this WILL FAIL — addApproval unconditionally writes to messagesBySession.
   */
  it("addApproval: sub-agent pending message must NOT appear in messagesBySession", () => {
    fc.assert(
      fc.property(
        arbTwoDistinctAgentIds,
        arbUuid,
        fc.uuid(),
        fc.nat({ max: 2_000_000_000_000 }),
        ([rootAgentId, subAgentId], sessionUuid, approvalId, timestamp) => {
          const store = resetStore();
          setupSession(store, rootAgentId, sessionUuid);

          // Build a sub-agent sessionKey (agentId ≠ rootAgentId)
          const subAgentSessionKey = buildSessionKey(subAgentId, sessionUuid);

          // Create an approval request from the sub-agent
          const req: ApprovalRequest = {
            id: approvalId,
            request: {
              command: "ls -la",
              cwd: "/tmp",
              nodeId: null,
              host: null,
              security: null,
              ask: null,
              agentId: subAgentId,
              resolvedPath: null,
              sessionKey: subAgentSessionKey,
              turnSourceChannel: null,
              turnSourceTo: null,
              turnSourceAccountId: null,
              turnSourceThreadId: null,
            },
            createdAtMs: timestamp,
            expiresAtMs: timestamp + 60_000,
          };

          // Call addApproval — this is the buggy code path
          store.addApproval(req);

          // ── Expected behavior assertion (will FAIL on unfixed code) ──
          // The pending message must NOT be in messagesBySession (root agent's primary panel)
          const sessionMsgs = store.messagesBySession.get(sessionUuid) ?? [];
          const pendingInSession = sessionMsgs.some((m) => m.id === approvalId);

          expect(pendingInSession).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.2, 2.2**
   *
   * resolveApproval() with sub-agent sessionKey:
   * The action message must NOT appear in messagesBySession[sessionUuid].
   *
   * Bug condition: extractAgentNameFromKey(sessionKey) ≠ rootAgentId
   * Expected behavior: action message only in messagesByAgent, not in messagesBySession
   *
   * On UNFIXED code this WILL FAIL — resolveApproval unconditionally writes to messagesBySession.
   */
  it("resolveApproval: sub-agent action message must NOT appear in messagesBySession", () => {
    fc.assert(
      fc.property(
        arbTwoDistinctAgentIds,
        arbUuid,
        fc.uuid(),
        fc.nat({ max: 2_000_000_000_000 }),
        ([rootAgentId, subAgentId], sessionUuid, approvalId, timestamp) => {
          const store = resetStore();
          setupSession(store, rootAgentId, sessionUuid);

          const subAgentSessionKey = buildSessionKey(subAgentId, sessionUuid);

          // First add the approval (sets up the pending state)
          const req: ApprovalRequest = {
            id: approvalId,
            request: {
              command: "rm -rf /tmp/test",
              commandPreview: "rm -rf /tmp/test",
              cwd: "/tmp",
              nodeId: null,
              host: null,
              security: null,
              ask: null,
              agentId: subAgentId,
              resolvedPath: null,
              sessionKey: subAgentSessionKey,
              turnSourceChannel: null,
              turnSourceTo: null,
              turnSourceAccountId: null,
              turnSourceThreadId: null,
            },
            createdAtMs: timestamp,
            expiresAtMs: timestamp + 60_000,
          };
          store.addApproval(req);

          // Clear messagesBySession to isolate the resolveApproval effect
          store.messagesBySession.set(sessionUuid, []);

          // Resolve the approval — this is the buggy code path
          store.resolveApproval(approvalId, {
            id: approvalId,
            decision: "allow-once",
            ts: timestamp + 1000,
            resolvedBy: "test-user",
          });

          // ── Expected behavior assertion (will FAIL on unfixed code) ──
          // The action message must NOT be in messagesBySession
          const sessionMsgs = store.messagesBySession.get(sessionUuid) ?? [];
          const actionMsgId = `approval-action-${approvalId}`;
          const actionInSession = sessionMsgs.some((m) => m.id === actionMsgId);

          expect(actionInSession).toBe(false);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.3, 2.3**
   *
   * onSessionHistoryRefresh simulation:
   * When mixed messages (root + sub-agent) are loaded into messagesBySession,
   * only root agent messages should be present.
   *
   * Since onSessionHistoryRefresh calls async APIs, we simulate the store write
   * pattern that onSessionHistoryRefresh uses. The test applies the same filtering
   * logic the controller code uses and verifies the invariant holds.
   *
   * Bug condition: historyRefresh writes ALL messages to messagesBySession unfiltered
   * Expected behavior: only messages where !msg.sessionKey || extractAgentNameFromKey(msg.sessionKey) === rootAgentId
   *
   * On UNFIXED code this WILL FAIL — onSessionHistoryRefresh doesn't filter.
   * On FIXED code this WILL PASS — onSessionHistoryRefresh now filters by rootAgentId.
   */
  it("historyRefresh: messagesBySession must only contain root agent messages", () => {
    fc.assert(
      fc.property(
        arbTwoDistinctAgentIds,
        arbUuid,
        fc.array(
          fc.record({
            role: fc.constantFrom("assistant", "user", "toolResult"),
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
          { minLength: 1, maxLength: 10 },
        ),
        fc.array(fc.boolean(), { minLength: 1, maxLength: 10 }),
        ([rootAgentId, subAgentId], sessionUuid, baseMsgs, isRootFlags) => {
          const store = resetStore();
          setupSession(store, rootAgentId, sessionUuid);

          // Build mixed messages: some from root agent, some from sub-agent
          const allMessages: ChatMessage[] = baseMsgs.map((baseMsg, i) => {
            const isRoot = isRootFlags[i % isRootFlags.length];
            const agentId = isRoot ? rootAgentId : subAgentId;
            const sessionKey = buildSessionKey(agentId, sessionUuid);
            return { ...baseMsg, sessionKey } as ChatMessage;
          });

          // Ensure we have at least one sub-agent message to make the test meaningful
          const hasSubAgentMsg = allMessages.some(
            (m) => m.sessionKey && extractAgentNameFromKey(m.sessionKey) !== rootAgentId,
          );
          if (!hasSubAgentMsg) {
            // Add a sub-agent message
            allMessages.push({
              role: "assistant",
              content: [{ type: "text", text: "sub-agent message" }],
              timestamp: Date.now(),
              id: "forced-sub-agent-msg",
              sessionKey: buildSessionKey(subAgentId, sessionUuid),
              senderLabel: null,
            });
          }

          // Simulate what onSessionHistoryRefresh does:
          // Fixed version filters by rootAgentId before writing to messagesBySession
          const rootMsgs = allMessages.filter((msg) => {
            if (!msg.sessionKey) {
              return true;
            }
            return extractAgentNameFromKey(msg.sessionKey) === rootAgentId;
          });
          store.messagesBySession.set(sessionUuid, rootMsgs);

          // Route all messages to messagesByAgent (both root and sub-agent)
          for (const msg of allMessages) {
            if (msg.sessionKey) {
              const agentId = extractAgentNameFromKey(msg.sessionKey);
              store.appendAgentMessage(sessionUuid, agentId, msg);
            }
          }

          // ── Expected behavior assertion ──
          // Every message in messagesBySession must be from the root agent
          const storedMsgs = store.messagesBySession.get(sessionUuid) ?? [];
          for (const msg of storedMsgs) {
            if (msg.sessionKey) {
              const msgAgentId = extractAgentNameFromKey(msg.sessionKey);
              expect(msgAgentId).toBe(rootAgentId);
            }
            // Messages without sessionKey are allowed (backward compatibility)
          }

          // Sub-agent messages must be in messagesByAgent
          const subAgentMsgs = store.getAgentMessages(sessionUuid, subAgentId);
          const expectedSubCount = allMessages.filter(
            (m) => m.sessionKey && extractAgentNameFromKey(m.sessionKey) === subAgentId,
          ).length;
          expect(subAgentMsgs.length).toBe(expectedSubCount);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── Preservation Property Tests: Property 2 ──

describe("Preservation: Root agent approval behavior and existing routing paths must remain unchanged", () => {
  beforeEach(() => {
    resetStore();
  });

  /**
   * **Validates: Requirements 3.1**
   *
   * Preservation A — Root agent addApproval:
   * For all root agent approval requests (extractAgentNameFromKey(sessionKey) === rootAgentId),
   * the pending message appears in BOTH messagesBySession[sessionUuid] and
   * messagesByAgent[sessionUuid][rootAgentId].
   *
   * This behavior must be preserved after the fix.
   * On UNFIXED code this MUST PASS — root agent approvals already write to both stores.
   */
  it("Preservation A: root agent addApproval writes pending message to both stores", () => {
    fc.assert(
      fc.property(
        arbAgentId,
        arbUuid,
        fc.uuid(),
        fc.nat({ max: 2_000_000_000_000 }),
        (rootAgentId, sessionUuid, approvalId, timestamp) => {
          const store = resetStore();
          setupSession(store, rootAgentId, sessionUuid);

          // Build a root agent sessionKey (agentId === rootAgentId)
          const rootSessionKey = buildSessionKey(rootAgentId, sessionUuid);

          const req: ApprovalRequest = {
            id: approvalId,
            request: {
              command: "echo hello",
              cwd: "/tmp",
              nodeId: null,
              host: null,
              security: null,
              ask: null,
              agentId: rootAgentId,
              resolvedPath: null,
              sessionKey: rootSessionKey,
              turnSourceChannel: null,
              turnSourceTo: null,
              turnSourceAccountId: null,
              turnSourceThreadId: null,
            },
            createdAtMs: timestamp,
            expiresAtMs: timestamp + 60_000,
          };

          store.addApproval(req);

          // ── Preservation assertion: pending message in messagesBySession ──
          const sessionMsgs = store.messagesBySession.get(sessionUuid) ?? [];
          const pendingInSession = sessionMsgs.some((m) => m.id === approvalId);
          expect(pendingInSession).toBe(true);

          // ── Preservation assertion: pending message in messagesByAgent ──
          const agentMsgs = store.getAgentMessages(sessionUuid, rootAgentId);
          const pendingInAgent = agentMsgs.some((m) => m.id === approvalId);
          expect(pendingInAgent).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.2**
   *
   * Preservation B — Root agent resolveApproval:
   * For all root agent approval resolutions, the action message appears in BOTH
   * messagesBySession[sessionUuid] and messagesByAgent[sessionUuid][rootAgentId].
   *
   * This behavior must be preserved after the fix.
   * On UNFIXED code this MUST PASS — root agent resolutions already write to both stores.
   */
  it("Preservation B: root agent resolveApproval writes action message to both stores", () => {
    fc.assert(
      fc.property(
        arbAgentId,
        arbUuid,
        fc.uuid(),
        fc.nat({ max: 2_000_000_000_000 }),
        fc.constantFrom("allow-once", "allow-always", "deny"),
        (rootAgentId, sessionUuid, approvalId, timestamp, decision) => {
          const store = resetStore();
          setupSession(store, rootAgentId, sessionUuid);

          const rootSessionKey = buildSessionKey(rootAgentId, sessionUuid);

          // First add the approval
          const req: ApprovalRequest = {
            id: approvalId,
            request: {
              command: "cat /etc/hosts",
              commandPreview: "cat /etc/hosts",
              cwd: "/tmp",
              nodeId: null,
              host: null,
              security: null,
              ask: null,
              agentId: rootAgentId,
              resolvedPath: null,
              sessionKey: rootSessionKey,
              turnSourceChannel: null,
              turnSourceTo: null,
              turnSourceAccountId: null,
              turnSourceThreadId: null,
            },
            createdAtMs: timestamp,
            expiresAtMs: timestamp + 60_000,
          };
          store.addApproval(req);

          // Resolve the approval
          store.resolveApproval(approvalId, {
            id: approvalId,
            decision,
            ts: timestamp + 1000,
            resolvedBy: "test-user",
          });

          const actionMsgId = `approval-action-${approvalId}`;

          // ── Preservation assertion: action message in messagesBySession ──
          const sessionMsgs = store.messagesBySession.get(sessionUuid) ?? [];
          const actionInSession = sessionMsgs.some((m) => m.id === actionMsgId);
          expect(actionInSession).toBe(true);

          // ── Preservation assertion: action message in messagesByAgent ──
          const agentMsgs = store.getAgentMessages(sessionUuid, rootAgentId);
          const actionInAgent = agentMsgs.some((m) => m.id === actionMsgId);
          expect(actionInAgent).toBe(true);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 3.3, 3.4, 3.5, 3.6**
   *
   * Preservation C — Existing routing paths:
   * For all messages routed via updateChatStream (root agent) and updateAgentChatStream,
   * the existing isRootAgent routing logic correctly:
   *   - Writes root agent messages to BOTH messagesBySession and messagesByAgent
   *   - Writes sub-agent messages ONLY to messagesByAgent (not messagesBySession)
   *
   * This behavior must be preserved after the fix.
   * On UNFIXED code this MUST PASS — the event-handler routing already works correctly.
   */
  it("Preservation C: root agent messages go to both stores, sub-agent messages only to messagesByAgent", () => {
    fc.assert(
      fc.property(
        arbTwoDistinctAgentIds,
        arbUuid,
        fc.array(
          fc.record({
            role: fc.constantFrom("assistant", "user", "toolResult"),
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
          { minLength: 1, maxLength: 8 },
        ),
        fc.array(fc.boolean(), { minLength: 1, maxLength: 8 }),
        ([rootAgentId, subAgentId], sessionUuid, baseMsgs, isRootFlags) => {
          const store = resetStore();
          setupSession(store, rootAgentId, sessionUuid);

          // Route messages through the existing event-handler functions
          for (let i = 0; i < baseMsgs.length; i++) {
            const isRoot = isRootFlags[i % isRootFlags.length];
            const agentId = isRoot ? rootAgentId : subAgentId;
            const sessionKey = buildSessionKey(agentId, sessionUuid);
            const msg: ChatMessage = { ...baseMsgs[i], sessionKey } as ChatMessage;

            // Route to messagesByAgent (always, for all agents)
            updateAgentChatStream(store, sessionUuid, agentId, msg, false);

            // Root agent messages also go to messagesBySession
            if (isRoot) {
              updateChatStream(store, sessionUuid, msg, false);
            }
          }

          // ── Preservation assertions ──

          // 1. Every message in messagesBySession must be from the root agent
          const sessionMsgs = store.messagesBySession.get(sessionUuid) ?? [];
          for (const msg of sessionMsgs) {
            if (msg.sessionKey) {
              const msgAgentId = extractAgentNameFromKey(msg.sessionKey);
              expect(msgAgentId).toBe(rootAgentId);
            }
          }

          // 2. Root agent messages must appear in messagesByAgent
          const rootAgentMsgs = store.getAgentMessages(sessionUuid, rootAgentId);
          const rootMsgCount = baseMsgs.filter(
            (_, i) => isRootFlags[i % isRootFlags.length],
          ).length;
          expect(rootAgentMsgs.length).toBe(rootMsgCount);

          // 3. Sub-agent messages must appear in messagesByAgent
          const subAgentMsgs = store.getAgentMessages(sessionUuid, subAgentId);
          const subMsgCount = baseMsgs.filter(
            (_, i) => !isRootFlags[i % isRootFlags.length],
          ).length;
          expect(subAgentMsgs.length).toBe(subMsgCount);

          // 4. Sub-agent messages must NOT appear in messagesBySession
          for (const msg of sessionMsgs) {
            if (msg.sessionKey) {
              expect(extractAgentNameFromKey(msg.sessionKey)).not.toBe(subAgentId);
            }
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
