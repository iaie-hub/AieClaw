# Implementation Plan

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - 子 Agent 消息泄漏到 messagesBySession
  - **CRITICAL**: This test MUST FAIL on unfixed code — failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior — it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the bug exists in all 3 code paths
  - **Scoped PBT Approach**: Scope the property to concrete failing cases for each code path:
    - `addApproval()`: sub-agent sessionKey (agentId ≠ rootAgentId) → pending message must NOT appear in `messagesBySession`
    - `resolveApproval()`: sub-agent sessionKey → action message must NOT appear in `messagesBySession`
    - `onSessionHistoryRefresh`: mixed messages (root + sub-agent) → only root agent messages should be in `messagesBySession`
  - **Test file**: `aiemas/ui/mas4s/src/store/app-store-routing.property.test.ts` (new file, colocated with app-store)
  - **Test setup**: Use `fast-check` with arbitraries for agentId, sessionUuid, and sessionKey; reuse `resetStore()` / `setupSession()` pattern from existing `event-handler.property.test.ts`
  - **Bug Condition from design**:
    ```
    isBugCondition(input) WHERE:
      agentId ← extractAgentNameFromKey(input.sessionKey)
      rootAgentId ← extractAgentNameFromKey(input.rootSessionKey)
      RETURN agentId ≠ rootAgentId (for addApproval/resolveApproval)
      RETURN TRUE (for historyRefresh — no filtering at all)
    ```
  - **Expected Behavior assertions** (these will FAIL on unfixed code, confirming the bug):
    - For addApproval with sub-agent: `messagesBySession[sessionUuid]` must NOT contain the pending message
    - For resolveApproval with sub-agent: `messagesBySession[sessionUuid]` must NOT contain the action message
    - For historyRefresh: every message in `messagesBySession[sessionUuid]` must satisfy `!msg.sessionKey || extractAgentNameFromKey(msg.sessionKey) === rootAgentId`
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS (this is correct — it proves the bug exists)
  - Document counterexamples found (e.g., "addApproval('agent:sub-agent:group:uuid') writes pending msg to messagesBySession")
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2, 2.3_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - 根 Agent 审批行为与已有路由路径不变
  - **IMPORTANT**: Follow observation-first methodology
  - **Test file**: `aiemas/ui/mas4s/src/store/app-store-routing.property.test.ts` (same file as task 1, separate describe block)
  - **Observation phase** (run on UNFIXED code to capture baseline behavior):
    - Observe: `addApproval()` with root agent sessionKey → pending message appears in BOTH `messagesBySession` and `messagesByAgent`
    - Observe: `resolveApproval()` with root agent sessionKey → action message appears in BOTH `messagesBySession` and `messagesByAgent`
    - Observe: `updateChatStream()` / `updateAgentChatStream()` with `isRootAgent=true` → message in both stores; with `isRootAgent=false` → message only in `messagesByAgent`
  - **Property-based tests** (must PASS on unfixed code):
    - **Preservation A — Root agent addApproval**: For all root agent approval requests (extractAgentNameFromKey(sessionKey) === rootAgentId), pending message appears in both `messagesBySession[sessionUuid]` and `messagesByAgent[sessionUuid][rootAgentId]`
    - **Preservation B — Root agent resolveApproval**: For all root agent approval resolutions, action message appears in both stores
    - **Preservation C — Existing routing paths**: For all messages routed via `updateChatStream` (root agent) and `updateAgentChatStream`, the existing `isRootAgent` routing logic correctly writes root messages to both stores and sub-agent messages only to `messagesByAgent`
  - Verify tests pass on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

- [x] 3. Fix for sub-agent message routing leakage into messagesBySession
  - [x] 3.1 Implement the fix for `addApproval()` in `app-store.ts`
    - Import `extractAgentNameFromKey` from `session-utils.ts` (if not already imported)
    - Before writing pending message to `messagesBySession`, extract `agentId` from `targetSessionKey` using `extractAgentNameFromKey()`
    - Determine `rootAgentId` by finding the matching session in `store.sessions` and extracting its key's agentId (fallback to `activeSession?.key`)
    - Add guard: only write to `messagesBySession` when `agentId === rootAgentId` (root agent approval)
    - Keep `messagesByAgent` write unconditional (both root and sub-agent approvals still write there)
    - _Bug_Condition: isBugCondition(input) where extractAgentNameFromKey(sessionKey) ≠ rootAgentId for addApproval_
    - _Expected_Behavior: sub-agent pending msg NOT IN messagesBySession, IS IN messagesByAgent_
    - _Preservation: root agent addApproval behavior unchanged — pending msg in both stores_
    - _Requirements: 1.1, 2.1, 3.1_

  - [x] 3.2 Implement the fix for `resolveApproval()` in `app-store.ts`
    - Before writing action message to `messagesBySession`, extract `agentId` from `approval.request.sessionKey` using `extractAgentNameFromKey()`
    - Determine `rootAgentId` from matching session in `store.sessions` (same pattern as addApproval fix)
    - Add guard: only write to `messagesBySession` when `agentId === rootAgentId`
    - Keep `messagesByAgent` write unconditional
    - _Bug_Condition: isBugCondition(input) where extractAgentNameFromKey(sessionKey) ≠ rootAgentId for resolveApproval_
    - _Expected_Behavior: sub-agent action msg NOT IN messagesBySession, IS IN messagesByAgent_
    - _Preservation: root agent resolveApproval behavior unchanged — action msg in both stores_
    - _Requirements: 1.2, 2.2, 3.2_

  - [x] 3.3 Implement the fix for `onSessionHistoryRefresh` in `session-controller.ts`
    - Extract `rootAgentId` using `extractAgentNameFromKey(sessionKey)` (already imported in file)
    - Filter `result.messages` before writing to `messagesBySession`: only include messages where `!msg.sessionKey || extractAgentNameFromKey(msg.sessionKey) === rootAgentId` (reference `_loadSessionState` pattern at line ~170)
    - Add `messagesByAgent` routing: iterate all `result.messages`, for each message with `msg.sessionKey`, extract `agentId` and call `store.appendAgentMessage(uuid, agentId, msg)`
    - Call `_initActiveSubAgentTab(uuid, rootAgentId)` after routing to initialize sub-agent tab
    - _Bug_Condition: isBugCondition(input) where historyRefresh loads all messages unfiltered_
    - _Expected_Behavior: messagesBySession contains only root agent messages; all messages routed to messagesByAgent by agentId_
    - _Preservation: \_loadSessionState, onLoadMoreHistory, fragment repair patterns unchanged_
    - _Requirements: 1.3, 2.3, 3.3, 3.5, 3.6_

  - [x] 3.4 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - 子 Agent 消息不泄漏到 messagesBySession
    - **IMPORTANT**: Re-run the SAME test from task 1 — do NOT write a new test
    - The test from task 1 encodes the expected behavior
    - When this test passes, it confirms the expected behavior is satisfied
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms bug is fixed)
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.5 Verify preservation tests still pass
    - **Property 2: Preservation** - 根 Agent 审批行为与已有路由路径不变
    - **IMPORTANT**: Re-run the SAME tests from task 2 — do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions)
    - Confirm all tests still pass after fix (no regressions)

- [x] 4. Checkpoint — Ensure all tests pass
  - Run full test suite for the affected files: `pnpm test aiemas/ui/mas4s/src/store/app-store-routing.property.test.ts`
  - Also run existing related tests to confirm no regressions:
    - `pnpm test aiemas/ui/mas4s/src/gateway/event-handler.property.test.ts`
    - `pnpm test aiemas/ui/mas4s/src/store/app-store.property.test.ts`
  - Ensure all tests pass, ask the user if questions arise.
