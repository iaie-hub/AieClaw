# 子 Agent 消息路由修复 — Bugfix Design

## Overview

AIEMAS 多 Agent 聊天 UI（mas4s 前端）中存在消息路由 bug：子 Agent 的消息在三个代码路径中错误地写入了 `messagesBySession`（根 Agent 主面板的数据源），导致子 Agent 的审批卡片和历史消息泄漏到根 Agent 的 Primary Panel。

修复策略：在三个代码路径中添加 `isSubAgent` 判定，仅当消息属于根 Agent 时才写入 `messagesBySession`，子 Agent 消息仅路由到 `messagesByAgent`。这与 `event-handler.ts` 中 `handleChatEvent` 和 `handleAgentEvent` 已有的 `isRootAgent` 路由逻辑保持一致。

## Glossary

- **Bug_Condition (C)**: 子 Agent 的消息被错误写入 `messagesBySession`（根 Agent 主面板数据源）的条件
- **Property (P)**: 子 Agent 消息仅出现在 `messagesByAgent[sessionUuid][subAgentId]`，不出现在 `messagesBySession[sessionUuid]`
- **Preservation**: 根 Agent 的审批消息、历史加载、实时消息路由等现有行为保持不变
- **messagesBySession**: `AppStore` 中按 `sessionUuid` 索引的消息缓存，作为根 Agent Primary Panel 的数据源
- **messagesByAgent**: `AppStore` 中按 `sessionUuid → agentId` 二级索引的消息缓存，作为各 Agent 独立面板的数据源
- **sessionKey**: 格式为 `agent:{agentId}:group:{sessionUuid}` 的会话标识符
- **extractAgentNameFromKey()**: `session-utils.ts` 中的工具函数，从 sessionKey 中提取 agentId
- **isSubAgent**: 当 `extractAgentNameFromKey(msg.sessionKey) !== rootAgentId` 时为 true

## Bug Details

### Bug Condition

Bug 在三个代码路径中触发：

1. **`addApproval()` 路径**：当子 Agent 触发 `exec.approval.requested` 事件时，`addApproval()` 将 pending 消息无条件写入 `messagesBySession[targetSessionUuid]`，未检查该审批是否来自子 Agent。
2. **`resolveApproval()` 路径**：当子 Agent 审批被决策时，`resolveApproval()` 将用户操作消息（如"允许一次：command"）无条件写入 `messagesBySession[sessionUuid]`，未检查该审批是否属于子 Agent。
3. **`onSessionHistoryRefresh` 路径**：历史刷新时，`fetchSessionHistoryRange` 返回的所有消息（包含子 Agent 消息）被全量写入 `messagesBySession[uuid]`，未按 `rootAgentId` 过滤。

**Formal Specification:**

```
FUNCTION isBugCondition(input)
  INPUT: input of type { codePath: "addApproval" | "resolveApproval" | "historyRefresh", sessionKey: string, rootSessionKey: string }
  OUTPUT: boolean

  agentId ← extractAgentNameFromKey(input.sessionKey)
  rootAgentId ← extractAgentNameFromKey(input.rootSessionKey)

  IF input.codePath = "addApproval" THEN
    RETURN agentId ≠ rootAgentId
  ELSE IF input.codePath = "resolveApproval" THEN
    RETURN agentId ≠ rootAgentId
  ELSE IF input.codePath = "historyRefresh" THEN
    // historyRefresh 对所有消息都有 bug（不过滤），但 bug 仅在存在子 Agent 消息时可观察
    RETURN TRUE
  END IF
END FUNCTION
```

### Examples

- **示例 1 (addApproval)**：子 Agent `aieiaas-model` 触发审批，`sessionKey = "agent:aieiaas-model:group:abc123"`，`targetSessionUuid = "abc123"`。当前行为：pending 消息写入 `messagesBySession["abc123"]`，在根 Agent 主面板显示审批卡片。预期行为：pending 消息仅写入 `messagesByAgent["abc123"]["aieiaas-model"]`。
- **示例 2 (resolveApproval)**：用户对子 Agent 审批点击"允许一次"，`resolveApproval()` 将"允许一次：ls -la"消息写入 `messagesBySession["abc123"]`。预期行为：该消息仅写入 `messagesByAgent["abc123"]["aieiaas-model"]`。
- **示例 3 (historyRefresh)**：用户刷新历史，API 返回 10 条消息（6 条根 Agent、4 条子 Agent）。当前行为：全部 10 条写入 `messagesBySession`。预期行为：仅 6 条根 Agent 消息写入 `messagesBySession`，4 条子 Agent 消息路由到 `messagesByAgent`。
- **示例 4 (根 Agent 审批 — 不受影响)**：根 Agent `Root_Agent` 触发审批，`sessionKey = "agent:Root_Agent:group:abc123"`。当前行为和预期行为一致：pending 消息同时写入 `messagesBySession` 和 `messagesByAgent`。

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**

- 根 Agent 的审批卡片必须继续在 Primary Panel 中正常显示（`addApproval` 和 `resolveApproval` 对根 Agent 的行为不变）
- `_loadSessionState`（会话选择/初始加载）的过滤逻辑已正确，必须保持不变
- `handleChatEvent` 和 `handleAgentEvent` 中基于 `isRootAgent` 的实时消息路由已正确，必须保持不变
- 根 Agent run 结束后的碎片修复（fragment repair）逻辑已正确过滤子 Agent 消息，必须保持不变
- `onLoadMoreHistory`（向上翻页）的过滤逻辑已正确，必须保持不变
- `messagesByAgent` 的写入行为对所有 Agent（根和子）保持不变

**Scope:**
所有不涉及子 Agent 消息路由的输入应完全不受此修复影响。包括：

- 根 Agent 的所有消息操作（审批、聊天、历史加载）
- 鼠标点击、键盘输入等 UI 交互
- 会话创建、重命名、删除等管理操作

## Hypothesized Root Cause

基于代码分析，三个 bug 的根本原因如下：

1. **`addApproval()` 缺少 isSubAgent 检查**：`app-store.ts` 第 ~470 行，`addApproval()` 从 `req.request.sessionKey` 提取 `targetSessionUuid`，然后无条件将 pending 消息写入 `messagesBySession.set(targetSessionUuid, ...)`。缺少对 `sessionKey` 中 `agentId` 的检查。
   - 对比：`event-handler.ts` 中的 `handleChatEvent` 和 `handleAgentEvent` 都有 `if (isRootAgent)` 守卫，仅根 Agent 消息写入 `messagesBySession`。

2. **`resolveApproval()` 缺少 isSubAgent 检查**：`app-store.ts` 第 ~520 行，`resolveApproval()` 从 `approval.request.sessionKey` 提取 `sessionUuid`，然后无条件将 action 消息写入 `messagesBySession.set(sessionUuid, ...)`。同样缺少 `agentId` 检查。

3. **`onSessionHistoryRefresh` 缺少过滤逻辑**：`session-controller.ts` 第 ~85 行，`onSessionHistoryRefresh` 将 `result.messages` 全量写入 `messagesBySession.set(uuid, result.messages)`，未像 `_loadSessionState` 那样按 `rootAgentId` 过滤。
   - 对比：同文件中 `_loadSessionState` 已有正确的过滤逻辑：`result.messages.filter(msg => !msg.sessionKey || extractAgentNameFromKey(msg.sessionKey) === rootAgentId)`。

4. **`onSessionHistoryRefresh` 缺少 messagesByAgent 路由**：除了未过滤 `messagesBySession`，该方法也未将消息按 `agentId` 路由到 `messagesByAgent`，导致子 Agent 面板在历史刷新后无数据。

## Correctness Properties

Property 1: Bug Condition - 子 Agent 审批消息不泄漏到 messagesBySession

_For any_ approval event (addApproval or resolveApproval) where the approval's sessionKey belongs to a sub-agent (extractAgentNameFromKey(sessionKey) ≠ rootAgentId), the fixed functions SHALL NOT write any message to messagesBySession[sessionUuid], and SHALL write the message to messagesByAgent[sessionUuid][subAgentId].

**Validates: Requirements 2.1, 2.2**

Property 2: Bug Condition - 历史刷新仅将根 Agent 消息写入 messagesBySession

_For any_ history refresh (onSessionHistoryRefresh), the fixed function SHALL filter messages by root agent's sessionKey before writing to messagesBySession[sessionUuid], ensuring that for every message m in messagesBySession[sessionUuid], either m.sessionKey is null/undefined OR extractAgentNameFromKey(m.sessionKey) equals rootAgentId. Sub-agent messages SHALL be routed to messagesByAgent[sessionUuid][agentId].

**Validates: Requirements 2.3**

Property 3: Preservation - 根 Agent 审批行为不变

_For any_ approval event (addApproval or resolveApproval) where the approval's sessionKey belongs to the root agent (extractAgentNameFromKey(sessionKey) === rootAgentId), the fixed functions SHALL produce the same result as the original functions, preserving the root agent's approval card display in both messagesBySession and messagesByAgent.

**Validates: Requirements 3.1, 3.2**

Property 4: Preservation - 已有正确路由路径不变

_For any_ input that flows through \_loadSessionState, handleChatEvent, handleAgentEvent, fragment repair, or onLoadMoreHistory, the fixed code SHALL produce exactly the same behavior as the original code, preserving all existing correct routing logic.

**Validates: Requirements 3.3, 3.4, 3.5, 3.6**

## Fix Implementation

### Changes Required

假设根因分析正确：

**File**: `aiemas/ui/mas4s/src/store/app-store.ts`

**Function**: `addApproval(req: ApprovalRequest)`

**Specific Changes**:

1. **添加 isSubAgent 判定**：在将 pending 消息写入 `messagesBySession` 之前，使用 `extractAgentNameFromKey(targetSessionKey)` 提取 `agentId`，与根 Agent 的 `agentId` 比较
2. **条件写入 messagesBySession**：仅当 `agentId === rootAgentId`（即根 Agent 审批）时，才将 pending 消息写入 `messagesBySession[targetSessionUuid]`
3. **保持 messagesByAgent 写入不变**：子 Agent 和根 Agent 的审批消息都继续写入 `messagesByAgent`

**判定根 Agent 的方法**：从 `store.sessions` 中查找匹配 `targetSessionUuid` 的 session，提取其 `key` 中的 `agentId` 作为 `rootAgentId`。若找不到匹配 session，回退到 `store.activeSession?.key`。

---

**File**: `aiemas/ui/mas4s/src/store/app-store.ts`

**Function**: `resolveApproval(id: string, resolved?: ApprovalResolved)`

**Specific Changes**:

1. **添加 isSubAgent 判定**：在将 action 消息写入 `messagesBySession` 之前，使用 `extractAgentNameFromKey(sessionKey)` 提取 `agentId`，与根 Agent 的 `agentId` 比较
2. **条件写入 messagesBySession**：仅当 `agentId === rootAgentId` 时，才将 action 消息写入 `messagesBySession[sessionUuid]`
3. **保持 messagesByAgent 写入不变**：子 Agent 和根 Agent 的 action 消息都继续写入 `messagesByAgent`

---

**File**: `aiemas/ui/mas4s/src/controllers/session-controller.ts`

**Function**: `onSessionHistoryRefresh`

**Specific Changes**:

1. **添加 rootAgentId 提取**：使用 `extractAgentNameFromKey(sessionKey)` 提取根 Agent ID
2. **过滤 messagesBySession**：参照 `_loadSessionState` 的模式，仅将 `extractAgentNameFromKey(msg.sessionKey) === rootAgentId` 或 `!msg.sessionKey` 的消息写入 `messagesBySession`
3. **添加 messagesByAgent 路由**：遍历所有历史消息，按 `msg.sessionKey` 中的 `agentId` 路由到 `messagesByAgent[uuid][agentId]`
4. **添加子 Agent Tab 初始化**：调用 `_initActiveSubAgentTab(uuid, rootAgentId)` 确保历史刷新后子 Agent Tab 正确初始化

## Testing Strategy

### Validation Approach

测试策略分两阶段：首先在未修复代码上运行探索性测试，确认 bug 存在并验证根因假设；然后在修复后验证 fix 正确性和行为保持。

### Exploratory Bug Condition Checking

**Goal**: 在实施修复之前，通过测试用例复现 bug，确认根因分析。如果探索性测试未能复现 bug，需要重新假设根因。

**Test Plan**: 编写单元测试，模拟子 Agent 审批事件和历史刷新场景，断言子 Agent 消息出现在 `messagesBySession` 中（在未修复代码上应通过，证明 bug 存在）。

**Test Cases**:

1. **addApproval 子 Agent 泄漏测试**：构造 `ApprovalRequest`，其 `sessionKey = "agent:sub-agent:group:uuid1"`，调用 `addApproval()`，断言 `messagesBySession["uuid1"]` 包含该 pending 消息（未修复代码上会通过）
2. **resolveApproval 子 Agent 泄漏测试**：先 `addApproval()` 一个子 Agent 审批，再 `resolveApproval()`，断言 `messagesBySession["uuid1"]` 包含 action 消息（未修复代码上会通过）
3. **onSessionHistoryRefresh 未过滤测试**：模拟 `fetchSessionHistoryRange` 返回混合消息，调用 `onSessionHistoryRefresh`，断言 `messagesBySession` 包含子 Agent 消息（未修复代码上会通过）

**Expected Counterexamples**:

- `messagesBySession` 中出现 `sessionKey` 属于子 Agent 的消息
- 根因：`addApproval` 和 `resolveApproval` 缺少 `isSubAgent` 检查；`onSessionHistoryRefresh` 缺少按 `rootAgentId` 过滤

### Fix Checking

**Goal**: 验证对所有满足 bug 条件的输入，修复后的函数产生正确行为。

**Pseudocode:**

```
FOR ALL input WHERE isBugCondition(input) DO
  IF input.codePath = "addApproval" THEN
    result := addApproval_fixed(input.approvalRequest)
    ASSERT input.pendingMsg NOT IN messagesBySession[sessionUuid]
    ASSERT input.pendingMsg IN messagesByAgent[sessionUuid][subAgentId]
  ELSE IF input.codePath = "resolveApproval" THEN
    result := resolveApproval_fixed(input.id, input.resolved)
    ASSERT input.actionMsg NOT IN messagesBySession[sessionUuid]
    ASSERT input.actionMsg IN messagesByAgent[sessionUuid][subAgentId]
  ELSE IF input.codePath = "historyRefresh" THEN
    result := onSessionHistoryRefresh_fixed(input.sessionKey)
    FOR ALL msg IN messagesBySession[sessionUuid] DO
      ASSERT msg.sessionKey IS NULL OR extractAgentNameFromKey(msg.sessionKey) = rootAgentId
    END FOR
    FOR ALL msg IN input.allMessages WHERE msg.sessionKey IS NOT NULL DO
      agentId := extractAgentNameFromKey(msg.sessionKey)
      ASSERT msg IN messagesByAgent[sessionUuid][agentId]
    END FOR
  END IF
END FOR
```

### Preservation Checking

**Goal**: 验证对所有不满足 bug 条件的输入，修复后的函数与原函数行为一致。

**Pseudocode:**

```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT F(input) = F'(input)
  // 根 Agent 审批仍出现在 messagesBySession
  // _loadSessionState、fragment repair、pagination 行为完全一致
END FOR
```

**Testing Approach**: 推荐使用属性基测试（Property-Based Testing）进行保持性验证，因为：

- 可自动生成大量测试用例覆盖输入域
- 能捕获手动单元测试可能遗漏的边界情况
- 对"非 bug 输入行为不变"提供强保证

**Test Plan**: 先在未修复代码上观察根 Agent 审批和历史加载的行为，然后编写属性基测试验证修复后这些行为保持不变。

**Test Cases**:

1. **根 Agent addApproval 保持测试**：验证根 Agent 审批的 pending 消息在修复后仍同时出现在 `messagesBySession` 和 `messagesByAgent`
2. **根 Agent resolveApproval 保持测试**：验证根 Agent 审批决策的 action 消息在修复后仍同时出现在两个 store
3. **\_loadSessionState 保持测试**：验证会话选择时的历史加载过滤逻辑在修复后行为不变
4. **实时消息路由保持测试**：验证 `handleChatEvent` 和 `handleAgentEvent` 的 `isRootAgent` 路由在修复后行为不变

### Unit Tests

- 测试 `addApproval()` 对子 Agent 审批的路由：pending 消息不写入 `messagesBySession`，写入 `messagesByAgent`
- 测试 `addApproval()` 对根 Agent 审批的路由：pending 消息同时写入两个 store
- 测试 `resolveApproval()` 对子 Agent 审批的路由：action 消息不写入 `messagesBySession`，写入 `messagesByAgent`
- 测试 `resolveApproval()` 对根 Agent 审批的路由：action 消息同时写入两个 store
- 测试 `onSessionHistoryRefresh` 过滤逻辑：仅根 Agent 消息写入 `messagesBySession`
- 测试 `onSessionHistoryRefresh` 路由逻辑：所有消息按 `agentId` 路由到 `messagesByAgent`
- 测试边界情况：无 `sessionKey` 的消息保留在 `messagesBySession`（兼容）

### Property-Based Tests

- 生成随机 `ApprovalRequest`（随机 `sessionKey` 含不同 `agentId`），验证子 Agent 审批不泄漏到 `messagesBySession`
- 生成随机历史消息集合（混合根 Agent 和子 Agent 的 `sessionKey`），验证 `onSessionHistoryRefresh` 后 `messagesBySession` 仅含根 Agent 消息
- 生成随机根 Agent 审批，验证修复后行为与原行为一致（保持性）

### Integration Tests

- 端到端测试：模拟子 Agent 审批流程（请求 → 决策），验证 Primary Panel 不显示子 Agent 审批卡片
- 端到端测试：模拟历史刷新，验证 Primary Panel 仅显示根 Agent 消息，子 Agent Drawer 显示对应消息
- 端到端测试：模拟根 Agent 审批流程，验证 Primary Panel 正常显示审批卡片（回归验证）
