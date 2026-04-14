# 多 Agent 聊天视图（Multi-View）优化方案

> 基于 `requirements.md` 需求 1–11 的符合性审查与截图实测分析，本文档给出当前实现的差距诊断和分阶段优化方案。

---

## 一、现状诊断

### 1.1 代码层面已完成的工作

通过审查 `tasks.md`（全部 ✅）和源码，以下基础设施已落地：

| 层级     | 已完成内容                                                                                                                                       |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| 基础设施 | `buildSessionKey` 往返一致性、`extractAgentNameFromKey`                                                                                          |
| 状态层   | `messagesByAgent`、`topologyByAgent`、`viewModeBySession`、`activeSubAgentTab`、`unreadByAgent` 及全套 CRUD 方法                                 |
| 路由层   | `resolveMessageTarget`、`handleChatEvent`/`handleAgentEvent` 按 agentId 双写（`messagesByAgent` + `messagesBySession`）、`updateAgentChatStream` |
| 视图层   | `secondary-panel.ts`（Tab 栏 + 独立 message-list）、`main-workspace.ts` 多视图布局（primary-panel 60% / secondary-panel 40%）                    |
| 数据传递 | `app-shell.ts` → `main-workspace` 传递 `viewMode`、`subAgentMessages`、`subAgents`、`activeSubAgentTab`、`unreadAgents`                          |
| 控制层   | `session-controller.ts` 拓扑获取 + 历史消息按 agentId 路由                                                                                       |
| 碎片修复 | Root_Agent `state=final` 时调用 `fetchSessionHistoryRange` 替换碎片                                                                              |
| 超时优化 | `aiemas_sessions_send` 默认超时已改为 120s                                                                                                       |

### 1.2 截图暴露的实际问题

尽管代码层面的路由和存储逻辑已实现，截图显示 **UI 渲染层仍存在严重问题**：

| 问题编号 | 现象                                                                            | 根因分析                                                                                                                                                |
| -------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1**   | 子 Agent（`aieiaas-resource`）的思考过程、ToolCall、ToolResult 直接渲染在主窗口 | `messagesBySession`（向后兼容写入）仍包含所有 Agent 消息，Primary_Panel 的 `.messages` 绑定的是 `messagesBySession` 而非 `messagesByAgent[rootAgentId]` |
| **P2**   | 子 Agent 的 `assistant` 消息被 ToolCall/ToolResult 切割成多段碎片气泡           | `updateChatStream` 在 `messagesBySession` 中按末尾消息匹配，工具事件插入后末尾不再是 assistant 消息，导致新建气泡而非原地更新                           |
| **P3**   | 右侧辅窗口 Tab 栏存在但内容与主窗口重复                                         | 双写机制导致主窗口未过滤子 Agent 消息，辅窗口正确显示了子 Agent 消息，形成重复                                                                          |
| **P4**   | 无"根 Agent 正在等待子 Agent"的状态反馈                                         | 缺少 `aiemas_sessions_send` 工具调用期间的等待状态卡片                                                                                                  |
| **P5**   | 历史消息回放时同样混合渲染                                                      | 历史消息加载后写入 `messagesBySession` 时未按 agentId 过滤                                                                                              |

### 1.3 需求符合性总览

| 需求                           | 状态                        | 关键差距                                                                          |
| ------------------------------ | --------------------------- | --------------------------------------------------------------------------------- |
| 需求 1（消息路由）             | ⚠️ 数据层满足，渲染层不满足 | `messagesByAgent` 路由正确，但 Primary_Panel 仍读取未过滤的 `messagesBySession`   |
| 需求 2（拓扑获取与缓存）       | ✅ 满足                     | 拓扑获取、缓存、视图模式切换逻辑完整                                              |
| 需求 3（多窗口布局）           | ⚠️ 结构存在，渲染不正确     | 三栏布局 DOM 已就位，但主窗口内容未过滤                                           |
| 需求 4（主窗口仅渲染根 Agent） | ❌ 未满足                   | 主窗口渲染了所有 Agent 的消息                                                     |
| 需求 5（辅窗口渲染子 Agent）   | ⚠️ 部分满足                 | Tab 切换和消息显示正常，但与主窗口重复                                            |
| 需求 6（视图模式自动切换）     | ✅ 满足                     | 拓扑驱动的 single/multi 切换正常                                                  |
| 需求 7（Streaming 连续性）     | ❌ 未满足                   | `messagesBySession` 中子 Agent 消息打断了 streaming 连续性                        |
| 需求 8（历史消息多窗口回放）   | ❌ 未满足                   | 历史消息未按 Agent 分离渲染                                                       |
| 需求 9（sessionKey 完整性）    | ✅ 满足                     | 所有 ChatMessage 已携带 sessionKey                                                |
| 需求 10（碎片修复）            | ⚠️ 逻辑存在，效果不佳       | 碎片修复替换的是 `messagesBySession`，但该列表本身包含子 Agent 消息导致替换不彻底 |
| 需求 11（超时优化）            | ✅ 满足                     | 默认超时已改为 120s                                                               |

---

## 二、根因分析

所有 UI 层问题归结为 **一个核心矛盾**：

> **Primary_Panel 的数据源是 `messagesBySession`（包含所有 Agent 消息），而非 `messagesByAgent[rootAgentId]`（仅根 Agent 消息）。**

设计文档明确要求：

- `messagesBySession` 保留用于向后兼容（仅存储 Root_Agent 消息）
- `messagesByAgent` 作为主存储

但当前实现中，`handleChatEvent` 和 `handleAgentEvent` 的双写逻辑将 **所有 Agent 的消息都写入了 `messagesBySession`**（Root_Agent 通过 `updateChatStream`，Sub_Agent 的消息虽然不直接写入 `messagesBySession`，但碎片修复时 `fetchSessionHistoryRange` 返回的完整消息列表包含所有 Agent 的消息，替换后 `messagesBySession` 又被污染）。

此外，`app-shell.ts` 中 Primary_Panel 的 `.messages` 绑定：

```typescript
.messages=${store.activeSessionUuid
  ? (store.messagesBySession.get(store.activeSessionUuid) ?? [])
  : []}
```

直接使用了 `messagesBySession`，未做 Root_Agent 过滤。

---

## 三、优化方案

### 阶段一：核心渲染修复（解决 P1–P3、P5，满足需求 1/3/4/5/7/8）

#### 3.1 Primary_Panel 数据源切换

**目标**：主窗口仅显示根 Agent 消息。

**修改文件**：`aiemas/ui/mas4s/src/views/app-shell.ts`

**方案**：将 Primary_Panel 的 `.messages` 从 `messagesBySession` 切换为 `messagesByAgent[rootAgentId]`。

```typescript
// 当前（有问题）
.messages=${store.messagesBySession.get(store.activeSessionUuid) ?? []}

// 修改为
.messages=${(() => {
  if (!store.activeSessionUuid || !store.activeSession) return [];
  const rootAgentId = extractAgentNameFromKey(store.activeSession.key);
  return store.getAgentMessages(store.activeSessionUuid, rootAgentId);
})()}
```

**影响范围**：

- Primary_Panel 将仅渲染根 Agent 的 assistant、tool、user 消息
- 子 Agent 的所有消息（assistant streaming、ToolCall、ToolResult）将不再出现在主窗口
- 审批事件需确保路由到根 Agent 的消息集合（当前 `handleAgentEvent` 中审批事件保持现有逻辑，已满足）

#### 3.2 `messagesBySession` 双写策略调整

**目标**：`messagesBySession` 仅包含根 Agent 消息，与设计文档一致。

**修改文件**：`aiemas/ui/mas4s/src/gateway/event-handler.ts`

**方案**：确认当前双写逻辑中，仅 `isRootAgent` 为 true 时才写入 `messagesBySession`。审查发现当前代码已正确实现此逻辑（`handleChatEvent` 和 `handleAgentEvent` 中均有 `if (isRootAgent)` 守卫）。

**需额外修复**：碎片修复逻辑中 `fetchSessionHistoryRange` 返回的消息列表可能包含子 Agent 消息，替换时需过滤。

```typescript
// 碎片修复：仅保留根 Agent 的 assistant + tool 消息
const apiNonUserMsgs = completeMessages.filter((m) => {
  if (m.role === "user" || m.subType === "pending") return false;
  // 仅保留根 Agent 的消息
  if (m.sessionKey) {
    const msgAgentId = extractAgentNameFromKey(m.sessionKey);
    return msgAgentId === rootAgentId;
  }
  return true; // 无 sessionKey 的消息保留（兼容）
});
```

#### 3.3 历史消息加载的 `messagesBySession` 过滤

**目标**：历史消息加载后，`messagesBySession` 仅包含根 Agent 消息。

**修改文件**：`aiemas/ui/mas4s/src/controllers/session-controller.ts`

**方案**：`onSessionSelect` 中加载历史消息后，写入 `messagesBySession` 时过滤掉子 Agent 消息。

```typescript
// 当前（有问题）
this.store.messagesBySession.set(uuid, result.messages);

// 修改为：仅将根 Agent 消息写入 messagesBySession
const rootAgentId = extractAgentNameFromKey(sessionKey);
const rootMessages = result.messages.filter((msg) => {
  if (!msg.sessionKey) return true; // 无 sessionKey 的消息保留（兼容）
  return extractAgentNameFromKey(msg.sessionKey) === rootAgentId;
});
this.store.messagesBySession.set(uuid, rootMessages);
```

同时保留现有的 `messagesByAgent` 路由逻辑不变（所有消息按 agentId 分发）。

#### 3.4 Streaming 连续性修复

**目标**：同一 Agent 的 assistant streaming 不被其他 Agent 的事件打断。

**分析**：由于 3.1 已将 Primary_Panel 数据源切换为 `messagesByAgent[rootAgentId]`，根 Agent 的 streaming 不再被子 Agent 事件打断。辅窗口中 `updateAgentChatStream` 已按 agentId 隔离查找末尾消息，子 Agent 的 streaming 也不会被其他 Agent 打断。

**结论**：3.1 的修改自动解决了 Streaming 连续性问题，无需额外改动。

---

### 阶段二：交互体验增强（解决 P4，提升需求 4/5 体验）

#### 3.5 根 Agent 等待子 Agent 的状态反馈

**目标**：当根 Agent 调用 `aiemas_sessions_send` 时，主窗口显示等待状态。

**修改文件**：

- `aiemas/ui/mas4s/src/views/msg-agent.ts`（或新建 `msg-waiting-card.ts`）
- `aiemas/ui/mas4s/src/views/message-list.ts`

**方案**：

1. 在 `message-list.ts` 的 `_renderMessage` 中，识别 `aiemas_sessions_send` 的 ToolCall 消息，渲染为专用的"等待子 Agent"卡片：

```
┌─────────────────────────────────────────┐
│ 🔄 正在调用子 Agent: aieiaas-resource   │
│    任务：列出物理机                      │
│    已等待 45s / 120s                     │
└─────────────────────────────────────────┘
```

2. 当对应的 ToolResult 到达时，卡片自动更新为完成状态：

```
┌─────────────────────────────────────────┐
│ ✅ 子 Agent aieiaas-resource 执行完成    │
│    耗时 52s                              │
└─────────────────────────────────────────┘
```

**实现要点**：

- 通过 `msg.toolName === "aiemas_sessions_send"` 识别
- 等待计时器通过 `msg.timestamp` 与当前时间差计算
- 超时阈值从 ToolCall 的 args 中提取 `timeoutSeconds`（默认 120s）

#### 3.6 子 Agent Tab 活跃状态增强

**目标**：子 Agent 正在执行时，Tab 标签显示动态指示。

**修改文件**：`aiemas/ui/mas4s/src/views/secondary-panel.ts`

**方案**：

1. 新增 `activeAgents: Set<string>` 属性，由 `event-handler.ts` 在收到子 Agent streaming 事件时设置，`state=final` 时清除
2. Tab 标签渲染时，活跃 Agent 显示脉冲动画：

```html
<div class="tab-item ${agentId === this.activeTab ? 'active' : ''}">
  <span>${agentId}</span>
  ${this.activeAgents.has(agentId) ? html`<span class="pulse-dot"></span>` :
  this.unreadAgents.has(agentId) ? html`<span class="unread-dot"></span>` : ''}
</div>
```

---

### 阶段三：视觉降噪与信息层级（提升整体 UX）

#### 3.7 消息气泡差异化

**目标**：视觉上区分根 Agent 和子 Agent 的消息。

**修改文件**：

- `aiemas/ui/mas4s/src/views/msg-agent.ts`
- `aiemas/ui/mas4s/src/views/secondary-panel.ts`

**方案**：

| 元素       | 主窗口（根 Agent）    | 辅窗口（子 Agent）                           |
| ---------- | --------------------- | -------------------------------------------- |
| 气泡背景   | `#ffffff`（当前样式） | `#f8fafc`（略灰）                            |
| 左侧边线   | 无                    | 3px 实线，颜色与 Tab 高亮色一致（`#3b82f6`） |
| Agent 标识 | `Agent: {agentId}`    | Tab 已标识，气泡内可省略前缀                 |

#### 3.8 工具调用折叠

**目标**：ToolCall/ToolResult 默认折叠，降低信息密度。

**修改文件**：`aiemas/ui/mas4s/src/views/msg-tool-result.ts`

**方案**：

1. 默认显示单行摘要：`🔧 调用 read 工具 → 成功`
2. 点击展开显示完整的 args 和 result JSON
3. 使用 `<details>` + `<summary>` 原生折叠，或 Lit 状态控制

#### 3.9 思考过程折叠

**目标**：子 Agent 的"思考过程"默认折叠。

**修改文件**：`aiemas/ui/mas4s/src/views/msg-agent.ts`

**方案**：

1. 辅窗口中的 `thinking` 内容块默认折叠为一行：`▶ 思考过程`
2. 点击展开显示完整思考文本
3. 主窗口中根 Agent 的思考过程保持当前行为（默认展开）

---

## 四、实施优先级与依赖关系

```
阶段一（核心修复）─ 必须优先完成
  ├── 3.1 Primary_Panel 数据源切换 ← 核心修复，解决 P1/P3
  ├── 3.2 碎片修复过滤 ← 依赖 3.1
  ├── 3.3 历史消息过滤 ← 依赖 3.1
  └── 3.4 Streaming 连续性 ← 由 3.1 自动解决

阶段二（交互增强）─ 阶段一完成后
  ├── 3.5 等待状态卡片 ← 独立
  └── 3.6 Tab 活跃状态 ← 独立

阶段三（视觉降噪）─ 可并行或后续
  ├── 3.7 气泡差异化 ← 独立
  ├── 3.8 工具调用折叠 ← 独立
  └── 3.9 思考过程折叠 ← 独立
```

---

## 五、涉及文件清单

| 文件                                                    | 阶段  | 改动类型                                          |
| ------------------------------------------------------- | ----- | ------------------------------------------------- |
| `aiemas/ui/mas4s/src/views/app-shell.ts`                | 一    | 修改 `.messages` 数据源                           |
| `aiemas/ui/mas4s/src/gateway/event-handler.ts`          | 一    | 碎片修复过滤子 Agent 消息                         |
| `aiemas/ui/mas4s/src/controllers/session-controller.ts` | 一    | 历史消息写入 `messagesBySession` 时过滤           |
| `aiemas/ui/mas4s/src/views/message-list.ts`             | 二    | 识别 `aiemas_sessions_send` ToolCall 渲染等待卡片 |
| `aiemas/ui/mas4s/src/views/msg-agent.ts`                | 二/三 | 等待卡片 + 气泡差异化                             |
| `aiemas/ui/mas4s/src/views/secondary-panel.ts`          | 二/三 | Tab 活跃状态 + 气泡差异化                         |
| `aiemas/ui/mas4s/src/views/msg-tool-result.ts`          | 三    | 工具调用折叠                                      |
| 新建 `msg-waiting-card.ts`（可选）                      | 二    | 等待子 Agent 状态卡片组件                         |

---

## 六、验证策略

### 阶段一验证

1. **主窗口过滤验证**：发送消息触发根 Agent 调用子 Agent，确认主窗口仅显示：
   - 用户消息
   - 根 Agent 的 assistant 回复
   - 根 Agent 的 ToolCall（`aiemas_sessions_send`）和 ToolResult
   - 审批卡片
   - 子 Agent 的 assistant、ToolCall、ToolResult **不出现**在主窗口

2. **辅窗口隔离验证**：确认辅窗口 Tab 切换后，仅显示对应子 Agent 的消息流

3. **Streaming 连续性验证**：子 Agent 执行期间，观察辅窗口中 assistant 消息是否连续更新（不被 ToolCall 打断产生新气泡）

4. **历史回放验证**：切换到历史会话，确认主窗口和辅窗口各自正确显示对应 Agent 的历史消息

5. **碎片修复验证**：根 Agent run 结束后，主窗口消息列表应被 History_Range_API 返回的完整消息替换，无碎片残留

### 阶段二/三验证

- 等待卡片：根 Agent 调用 `aiemas_sessions_send` 时主窗口出现等待状态，ToolResult 到达后更新
- Tab 活跃状态：子 Agent streaming 时 Tab 显示脉冲动画
- 折叠行为：ToolCall/ToolResult 和思考过程默认折叠，点击可展开

---

## 七、风险与回退

| 风险                                              | 影响           | 缓解措施                                                                |
| ------------------------------------------------- | -------------- | ----------------------------------------------------------------------- |
| `messagesByAgent` 中根 Agent 消息缺失（路由 bug） | 主窗口空白     | 保留 `messagesBySession` 作为 fallback，`getAgentMessages` 返回空时回退 |
| 审批事件未正确路由到根 Agent 集合                 | 审批卡片消失   | 审批事件的路由逻辑独立于 agentId 过滤，当前实现已保障                   |
| 碎片修复过滤过度（误删根 Agent 消息）             | 主窗口消息丢失 | 过滤条件严格匹配 `sessionKey` 中的 agentId，无 sessionKey 的消息保留    |
| 辅窗口 `messagesByAgent` 数据延迟（拓扑未就绪）   | 辅窗口短暂空白 | 拓扑异步获取期间使用 Single_View_Mode，拓扑到达后自动切换               |

---

## 八、与现有设计文档的关系

本方案不修改 `design.md` 中的架构设计，而是修复实现层面与设计意图的偏差：

- 设计文档要求 `messagesBySession` 仅存储 Root_Agent 消息 → 阶段一 3.2/3.3 修复
- 设计文档要求 Primary_Panel 渲染 `rootMessages (agentId == rootAgent)` → 阶段一 3.1 修复
- 设计文档中 `updateAgentChatStream` 的 Agent 隔离已正确实现 → 无需改动
- 设计文档中 Secondary_Panel 的 Tab 切换和未读指示器已正确实现 → 阶段二增强

**核心结论**：设计方案本身是正确的，问题出在实现层面 Primary_Panel 的数据源绑定未遵循设计意图。阶段一的修复量很小（约 3 个文件、~30 行代码），但能解决截图中暴露的所有核心问题。

---

## 九、实施记录

> 以下为实际实施的变更记录。

### 阶段一 ✅ 已完成

1. `app-shell.ts`：Primary_Panel 的 `.messages` 数据源从 `messagesBySession` 切换为 `messagesByAgent[rootAgentId]`，带 fallback 兼容
2. `event-handler.ts`：碎片修复逻辑增加根 Agent 过滤，`completeMessages` 中子 Agent 消息不再写入 `messagesBySession`；碎片修复后同步更新 `messagesByAgent[rootAgentId]`
3. `session-controller.ts`：历史消息加载时 `messagesBySession` 仅写入根 Agent 消息，`messagesByAgent` 仍接收所有 Agent 消息；`onLoadMoreHistory` 翻页时同步过滤并路由到 `messagesByAgent`

### 阶段二 ✅ 已完成

1. `msg-tool-card.ts`：`aiemas_sessions_send` 的 ToolCall 专用渲染——等待状态卡片（紫色主题、旋转动画、实时计时器 `Ns / 120s`）
2. `msg-agent.ts`：向 `msg-tool-card` 传递 `hasResult` 属性，仅最新 agent 消息中的 `sessions_send` 显示等待状态
3. `secondary-panel.ts`：Tab 栏增加 `activeAgents` 脉冲动画（绿色圆点），优先级高于未读指示器
4. `app-store.ts`：新增 `activeAgentsBySession`、`markAgentActive`、`clearAgentActive`
5. `event-handler.ts`：子 Agent streaming 时标记活跃，`state=final` 时清除
6. `main-workspace.ts` + `app-shell.ts`：传递 `activeAgents` 到 secondary-panel

### 阶段三 ✅ 已完成

1. `msg-agent.ts`：气泡样式支持 CSS 自定义属性 `--msg-agent-bg` 和 `--msg-agent-border-left`
2. `secondary-panel.ts`：辅窗口 `.message-area` 设置 CSS 变量，子 Agent 气泡显示蓝色左侧边线 + 浅灰背景
3. 工具调用折叠：`msg-tool-card` 已默认折叠（`_expanded = false`），无需额外改动
4. 思考过程折叠：`msg-agent` 已默认折叠（`_thinkingExpanded = false`），无需额外改动

---

## 十、子 Agent 实时视图缺失 Thinking / Tool 消息的分析与修复方案

> 2026-04-14 追加。问题：实时消息视图中子 Agent 窗口（Secondary_Panel）不显示思考消息和工具调用消息，但历史视图中能正常显示。

### 10.1 问题现象

| 视图                        | Thinking（思考过程） | ToolCall（工具调用） | ToolResult（工具结果） | Assistant（最终文本） |
| --------------------------- | -------------------- | -------------------- | ---------------------- | --------------------- |
| 实时视图（Secondary_Panel） | ❌ 不显示            | ❌ 不显示            | ❌ 不显示              | ✅ 显示（仅最终文本） |
| 历史视图（Secondary_Panel） | ✅ 显示              | ✅ 显示              | ✅ 显示                | ✅ 显示               |

### 10.2 历史消息为什么能记录子 Agent 的 Thinking 和 Tool 消息

历史消息的持久化走的是**完全独立于 WebSocket 广播**的路径：

#### 路径 A：Transcript 事件（assistant 消息，含 thinking + toolCall）

```
子 Agent run (pi-coding-agent)
  → SessionManager.appendMessage(message)     // 写入 JSONL transcript 文件
    → emitSessionTranscriptUpdate(...)         // 触发全局事件
      → SessionTranscriptStore.handleUpdate()  // 监听器
        → extractContent(msg.content)          // 序列化 content 数组
          // [thinking] 用户请求列出物理机列表...
          // [text] 我将为您列出...
          // [tool_use:read] {"path":"skills/resource_query/SKILL.md"}
        → pushToBuffer(sessionKey, role="assistant", content=序列化文本)
        → flush() → persistBatch() → INSERT INTO session_messages
```

关键点：`extractContent` 函数遍历 assistant 消息的 `content` 数组，将 `thinking`、`text`、`toolCall` 块分别序列化为 `[thinking] ...`、`[text] ...`、`[tool_use:name] ...` 格式，**一条 assistant 消息包含了完整的 thinking + text + toolCall 内容**。

#### 路径 B：Tool 事件旁路捕获（toolResult）

```
子 Agent run → emitAgentEvent(stream="tool", phase="start/result")
  → server-chat.ts agent event handler
    → broadcastToConnIds("agent", ..., toolEventRecipients)  // 广播给 run 发起者
    → broadcastToConnIds("session.tool", ..., sessionSubscribers)  // 广播给 session 订阅者
    ↓ (同时)
    mas4s-integration.ts wrappedBroadcast 不经过此路径（tool 事件走 broadcastToConnIds）
    ↓ (但)
    SessionTranscriptStore.recordToolEvent(phase="start") → 暂存 pendingToolCalls
    SessionTranscriptStore.recordToolEvent(phase="result") → 合并为 tool 角色消息写入 buffer
```

注意：tool 事件的持久化不依赖 `filterBroadcast`（tool 事件走 `broadcastToConnIds` 路径，不经过 `broadcast`/`wrappedBroadcast`）。`recordToolEvent` 是在 `server-chat.ts` 的 agent event handler 中直接调用的。

#### 历史查询路径

```
前端 fetchSessionHistoryRange(sessionKey)
  → RPC: session.history.range
    → queryHistoryRange(db, { sessionUuid })
      → SELECT * FROM session_messages WHERE sessionUuid = ?
      // sessionUuid 是 group UUID，根 Agent 和子 Agent 共享
      // 返回所有 Agent 的消息（含 thinking、toolCall、toolResult）
  → 前端 session-controller.ts
    → 按 msg.sessionKey 中的 agentId 路由到 messagesByAgent[agentId]
    → normalizeMessage() 解析 [thinking]、[text]、[tool_use:name]、[tool_result] 前缀
    → 子 Agent 消息完整还原到 Secondary_Panel
```

### 10.3 实时视图为什么缺失子 Agent 的 Thinking 和 Tool 消息

#### 根因 1：子 Agent 没有发出 `stream: "thinking"` 事件

| 入口方法                                           | `onReasoningStream` 回调 | 是否发出 `stream: "thinking"` |
| -------------------------------------------------- | ------------------------ | ----------------------------- |
| `server-methods/chat.ts` → `chat.send`（根 Agent） | ✅ 有                    | ✅ 发出                       |
| `server-methods/agent.ts` → `agent`（子 Agent）    | ❌ 没有                  | ❌ 不发出                     |

根 Agent 的 run 通过 `chat.send` 发起，其中有 `onReasoningStream` 回调，会调用 `emitAgentEvent({ stream: "thinking", data: { text, delta } })`。该事件走 `broadcast("agent", ...)` 路径，经过 `wrappedBroadcast` → `filterBroadcastTargets` 广播到前端。

子 Agent 的 run 通过 `agent` 方法发起（由 gateway 内部客户端 `gateway:agent` 调用），该方法**没有 `onReasoningStream` 回调**，所以子 Agent 的 thinking 内容不会通过实时事件发送。

前端 `event-handler.ts` 中 `handleAgentEvent` 的 `stream === "assistant"` 处理依赖 `_thinkingByRun` 缓存来拼接 thinking 内容：

```typescript
if (stream === "assistant" && data?.text !== undefined && runId) {
    const thinkingText = _thinkingByRun.get(runId);  // 子 Agent 的 runId 没有 thinking 缓存
    const content = [];
    if (thinkingText) {
      content.push({ type: "thinking", thinking: thinkingText });  // 不会执行
    }
    content.push({ type: "text", text: data.text });
```

由于 `_thinkingByRun` 中没有子 Agent runId 的条目，assistant 消息中不包含 thinking 内容。

#### 根因 2：子 Agent 的 `stream: "tool"` 事件不广播到前端

`server-chat.ts` 中 tool 事件的广播路径：

```typescript
if (isToolEvent) {
    // 路径 1：只发给 toolEventRecipients（按 runId 注册）
    const recipients = toolEventRecipients.get(evt.runId);
    if (recipients && recipients.size > 0) {
        broadcastToConnIds("agent", ..., recipients);
    }
    // 路径 2：只发给 sessionEventSubscribers（全局订阅）
    const sessionSubscribers = sessionEventSubscribers.getAll();
    if (sessionSubscribers.size > 0) {
        broadcastToConnIds("session.tool", ..., sessionSubscribers);
    }
} else {
    // 非 tool 事件（thinking、assistant、lifecycle 等）走 broadcast 路径
    broadcast("agent", agentPayload);
}
```

前端 mas4s 客户端不在这两个接收者集合中：

1. **`toolEventRecipients`**：按 runId 注册。子 Agent 的 runId 由 gateway 内部客户端（`gateway:agent`）发起 `agent` 方法时注册，注册的 connId 是内部客户端的 connId，不是前端 mas4s 客户端的 connId。
2. **`sessionEventSubscribers`**：需要前端调用 `sessions.subscribe` RPC 注册。前端当前没有调用该方法。

#### 对比：子 Agent 的 `stream: "assistant"` 为什么能显示

`stream: "assistant"` 不是 tool 事件，走的是 `broadcast("agent", agentPayload)` 路径。`broadcast` 被 `wrappedBroadcast` 包装，经过 `filterBroadcastTargets` 按 sessionKey 中的 group UUID 查找 `session_memberships` 表，找到前端用户的 userId，映射回 connId，广播到前端。所以子 Agent 的 assistant 文本能实时显示。

### 10.4 修复方案

#### 改动 1：`server-methods/agent.ts` — 增加 `onReasoningStream` 回调

**目标**：使子 Agent 的 thinking 内容能通过 `stream: "thinking"` 事件实时广播。

**修改文件**：`src/gateway/server-methods/agent.ts`

**方案**：在 `agent` 方法的 agent run 启动参数中，增加 `onReasoningStream` 回调，与 `chat.ts` 中的实现对齐。该回调通过 `emitAgentEvent({ stream: "thinking", ... })` 发出事件，事件走 `broadcast("agent", ...)` 路径，经过 `filterBroadcastTargets` 广播到前端。

```typescript
onReasoningStream: ({ text }) => {
    const prior = _reasoningBufferByRun.get(runId) ?? "";
    const delta = text && text.startsWith(prior) ? text.slice(prior.length) : (text ?? "");
    if (delta) {
        _reasoningBufferByRun.set(runId, text ?? "");
        emitAgentEvent({
            runId,
            stream: "thinking",
            sessionKey: canonicalSessionKey,
            data: { text: text ?? "", delta },
        });
    }
},
```

**风险评估**：

- 低风险：`stream: "thinking"` 事件走 `broadcast` 路径，经过 `filterBroadcastTargets` 权限过滤，只发给有权限的用户。
- 兼容性：现有 Control UI 已处理 `stream: "thinking"` 事件，不受影响。
- 性能：thinking 事件是增量 delta，数据量小。
- 注意：需要在 `agent.ts` 中维护一个 `_reasoningBufferByRun` Map（与 `chat.ts` 中类似），用于计算 delta。

#### 改动 2：前端调用 `sessions.subscribe` 注册 session 事件订阅

**目标**：使前端能接收子 Agent 的 `session.tool` 事件。

**修改文件**：`aiemas/ui/mas4s/src/controllers/auth-controller.ts`（或 `session-controller.ts`）

**方案**：在前端 WebSocket 连接成功（`connect` RPC 完成）后，调用 `sessions.subscribe` RPC 注册为 session 事件订阅者。

```typescript
// 连接成功后
await client.request("sessions.subscribe", {});
```

注册后，前端客户端的 connId 会被加入 `sessionEventSubscribers`。子 Agent 的 tool 事件会通过 `session.tool` 事件发送到前端。前端 `event-handler.ts` 已经将 `session.tool` 事件复用 `handleAgentEvent` 处理：

```typescript
case "session.tool":
    handleAgentEvent(store, evt.payload);
    break;
```

**风险评估**：

- 低风险：`session.tool` 事件已有 `dropIfSlow: true` 保护。
- 多余流量：`sessionEventSubscribers` 是全局的（不按 session 过滤），前端会收到所有 session 的 tool 事件。但 `handleAgentEvent` 中 `resolveMessageTarget` 按 sessionKey 路由，不会造成数据混乱。对于单用户场景（通常只有 1-2 个活跃 session），多余流量可忽略。
- 重复事件：根 Agent 的 tool 事件同时通过 `toolEventRecipients`（`event: "agent"`）和 `sessionEventSubscribers`（`event: "session.tool"`）发送到前端。前端 `handleAgentEvent` 中 tool 事件通过 `toolCallId` 构造的 id（`${toolCallId}-result`）去重，`appendAgentMessage` 不会重复追加（但 `upsertToolStream` 会覆盖更新）。需要确认 `appendAgentMessage` 中是否有 id 去重逻辑。
- **需要验证**：`store.appendAgentMessage` 当前没有 id 去重，可能导致根 Agent 的 toolResult 消息在 `messagesByAgent` 中重复。需要在 `handleAgentEvent` 的 tool result 处理中增加去重判断，或在 `appendAgentMessage` 中增加 id 去重。

#### 改动 3（可选）：`appendAgentMessage` 增加 id 去重

**目标**：防止同一 toolResult 消息因 `agent` 和 `session.tool` 双路径到达而重复追加。

**修改文件**：`aiemas/ui/mas4s/src/store/app-store.ts`

**方案**：在 `appendAgentMessage` 中检查末尾消息的 id 是否与新消息相同，相同则跳过。

```typescript
appendAgentMessage(sessionUuid: string, agentId: string, msg: ChatMessage): void {
    let agentMap = this.messagesByAgent.get(sessionUuid);
    if (!agentMap) {
        agentMap = new Map();
        this.messagesByAgent.set(sessionUuid, agentMap);
    }
    const msgs = agentMap.get(agentId) ?? [];
    // 去重：如果末尾消息 id 相同，跳过
    if (msg.id && msgs.length > 0 && msgs[msgs.length - 1].id === msg.id) {
        return;
    }
    agentMap.set(agentId, [...msgs, msg]);
    this.notify();
}
```

### 10.5 方案总结

| 改动   | 文件                                                 | 目的                                           | 风险                                                 |
| ------ | ---------------------------------------------------- | ---------------------------------------------- | ---------------------------------------------------- |
| 改动 1 | `src/gateway/server-methods/agent.ts`                | 子 Agent 发出 `stream: "thinking"` 事件        | 低：走 broadcast 路径，有权限过滤                    |
| 改动 2 | `aiemas/ui/mas4s/src/controllers/auth-controller.ts` | 前端注册 session 事件订阅，接收 `session.tool` | 低：有 dropIfSlow 保护；需验证根 Agent tool 事件去重 |
| 改动 3 | `aiemas/ui/mas4s/src/store/app-store.ts`             | `appendAgentMessage` id 去重，防止双路径重复   | 极低：纯防御性检查                                   |

### 10.6 不采用的替代方案

**替代方案 B：将前端 connId 注册为子 Agent runId 的 `toolEventRecipient`**

在 `aiemas_sessions_send` 工具执行时，将发起 `chat.send` 的前端客户端 connId 传递给子 Agent 的 run，并注册为 `toolEventRecipient`。

不采用原因：

- 需要在 aiemas 工具层和 gateway 之间传递 connId，侵入性大
- 子 Agent 的 runId 在 `agent` 方法内部生成，需要回调机制将 runId 传回给注册逻辑
- `sessions.subscribe` 方案更简单，复用已有基础设施

### 10.7 验证要点

1. **Thinking 实时显示**：发送消息触发子 Agent，确认 Secondary_Panel 中子 Agent 的思考过程实时显示（折叠状态下显示 `▶ 思考过程`，展开可见完整文本）
2. **ToolCall/ToolResult 实时显示**：确认 Secondary_Panel 中子 Agent 的工具调用卡片实时出现（`read`、`exec` 等工具）
3. **根 Agent 无重复**：确认 Primary_Panel 中根 Agent 的 toolResult 消息不重复
4. **历史视图一致性**：切换会话后重新加载历史，确认 Secondary_Panel 显示内容与实时视图一致
5. **多会话隔离**：同时存在多个活跃会话时，确认 `session.tool` 事件不会串到错误的会话
