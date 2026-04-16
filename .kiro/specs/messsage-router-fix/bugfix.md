# Bugfix Requirements Document

## Introduction

AIEMAS 多 Agent 聊天 UI（mas4s 前端）中存在两个相关的消息路由 bug，导致子 Agent 的消息错误地显示在根 Agent 的主聊天面板（Primary Panel）中。

**Bug 1**：子 Agent 的审批卡片（approval card）在实时视图中错误地出现在根 Agent 的主面板。
**Bug 2**：历史刷新（`onSessionHistoryRefresh`）时，所有 Agent 的消息未经过滤全部加载到根 Agent 的主面板。

这两个 bug 的根本原因相同：根 Agent 和子 Agent 共享同一个 `sessionUuid`（session key 的尾部 UUID），而 `messagesBySession`（根 Agent 主面板的数据源）在某些代码路径中未按 `sessionKey` 中的 `agentId` 进行过滤，导致子 Agent 的消息泄漏到根 Agent 的主面板。

**影响范围**：仅前端变更，涉及 `aiemas/ui/mas4s/src/` 下的文件。

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN a sub-agent (e.g., `aieiaas-model`) triggers an `exec.approval.requested` event THEN the system inserts the pending approval message into `messagesBySession[sessionUuid]` (root agent's primary panel data source), causing the approval card to appear in the root agent's primary chat panel in addition to the sub-agent's drawer panel

1.2 WHEN a sub-agent approval is resolved via `resolveApproval()` THEN the system inserts the user action message (e.g., "允许一次：command") into `messagesBySession[sessionUuid]` using `sessionKey.split(":").pop()!` to derive the target UUID, causing the resolution message to appear in the root agent's primary panel regardless of which agent the approval belongs to

1.3 WHEN `onSessionHistoryRefresh` is called to reload history for a session THEN the system loads ALL messages returned by `fetchSessionHistoryRange` into `messagesBySession[sessionUuid]` without filtering by root agent's `sessionKey`, causing sub-agent messages to appear in the root agent's primary chat panel

### Expected Behavior (Correct)

2.1 WHEN a sub-agent triggers an `exec.approval.requested` event THEN the system SHALL insert the pending approval message ONLY into `messagesByAgent[sessionUuid][agentId]` (the sub-agent's drawer panel data source) and SHALL NOT insert it into `messagesBySession[sessionUuid]` (root agent's primary panel); root agent approvals SHALL continue to be inserted into both `messagesBySession` and `messagesByAgent`

2.2 WHEN a sub-agent approval is resolved via `resolveApproval()` THEN the system SHALL insert the user action message ONLY into `messagesByAgent[sessionUuid][agentId]` for the sub-agent and SHALL NOT insert it into `messagesBySession[sessionUuid]`; root agent approval resolutions SHALL continue to be inserted into both stores

2.3 WHEN `onSessionHistoryRefresh` is called THEN the system SHALL filter history messages by root agent's `sessionKey` before storing them in `messagesBySession[sessionUuid]`, only including messages where `extractAgentNameFromKey(msg.sessionKey)` matches the root agent ID (consistent with the existing `_loadSessionState` logic); sub-agent messages SHALL be routed to `messagesByAgent[sessionUuid][agentId]`

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a root agent triggers an `exec.approval.requested` event THEN the system SHALL CONTINUE TO insert the pending approval message into both `messagesBySession[sessionUuid]` and `messagesByAgent[sessionUuid][rootAgentId]`, displaying the approval card in the root agent's primary panel

3.2 WHEN a root agent approval is resolved THEN the system SHALL CONTINUE TO insert the resolution action message into both `messagesBySession[sessionUuid]` and `messagesByAgent[sessionUuid][rootAgentId]`

3.3 WHEN `_loadSessionState` is called (session selection / initial load) THEN the system SHALL CONTINUE TO correctly filter history messages by root agent for `messagesBySession` and route all messages to `messagesByAgent` by `agentId` (this path already works correctly)

3.4 WHEN real-time chat events (`handleChatEvent`) arrive for a sub-agent THEN the system SHALL CONTINUE TO route them only to `messagesByAgent[sessionUuid][agentId]` without writing to `messagesBySession` (this path already works correctly via the `isRootAgent` check)

3.5 WHEN the fragment repair logic runs after a root agent run completes (state="final") THEN the system SHALL CONTINUE TO filter sub-agent messages from the `fetchSessionHistoryRange` result before writing to `messagesBySession` (this path already works correctly)

3.6 WHEN `onLoadMoreHistory` (pagination) is called THEN the system SHALL CONTINUE TO correctly filter root agent messages for `messagesBySession.prependMessages` and route all messages to `messagesByAgent` by `agentId` (this path already works correctly)

---

## Bug Condition & Property Specification

### Bug Condition Function

```pascal
FUNCTION isBugCondition(X)
  INPUT: X of type { event: ApprovalEvent | HistoryRefreshEvent, sessionKey: string }
  OUTPUT: boolean

  agentId ← extractAgentNameFromKey(X.sessionKey)
  rootAgentId ← extractAgentNameFromKey(rootSession.key)

  // Bug triggers when:
  // (a) An approval event (add or resolve) comes from a sub-agent, OR
  // (b) onSessionHistoryRefresh is called (it doesn't filter by agent at all)
  RETURN (X.event IS ApprovalEvent AND agentId ≠ rootAgentId)
      OR (X.event IS HistoryRefreshEvent)
END FUNCTION
```

### Property Specification — Fix Checking

```pascal
// Property: Fix Checking — Sub-agent approvals not in primary panel
FOR ALL X WHERE isBugCondition(X) AND X.event IS ApprovalEvent DO
  result ← addApproval'(X) OR resolveApproval'(X)
  ASSERT X.approvalMessage NOT IN messagesBySession[sessionUuid]
  ASSERT X.approvalMessage IN messagesByAgent[sessionUuid][subAgentId]
END FOR

// Property: Fix Checking — History refresh filters by root agent
FOR ALL X WHERE isBugCondition(X) AND X.event IS HistoryRefreshEvent DO
  result ← onSessionHistoryRefresh'(X)
  FOR ALL msg IN messagesBySession[sessionUuid] DO
    ASSERT msg.sessionKey IS NULL OR extractAgentNameFromKey(msg.sessionKey) = rootAgentId
  END FOR
END FOR
```

### Preservation Property

```pascal
// Property: Preservation Checking — Root agent behavior unchanged
FOR ALL X WHERE NOT isBugCondition(X) DO
  ASSERT F(X) = F'(X)
  // Root agent approvals still appear in messagesBySession
  // _loadSessionState, fragment repair, and pagination still work identically
END FOR
```
