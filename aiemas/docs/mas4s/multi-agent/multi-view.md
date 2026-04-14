# 多 Agent 聊天视图（Multi-View）优化方案

> 基于 `requirements.md` 需求 1–11 的符合性审查与截图实测分析，本文档给出当前实现的差距诊断和分阶段优化方案。

---

## 一、现状诊断

### 1.1 代码层面已完成的工作

通过审查 `tasks.md`（全部 ✅）和源码，以下基础设施已落地：

| 层级     | 已完成内容                                                                                                                                        |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 基础设施 | `buildSessionKey` 往返一致性、`extractAgentNameFromKey`                                                                                           |
| 状态层   | `messagesByAgent`、`topologyByAgent`、`viewModeBySession`、`activeSubAgentTab`、`unreadByAgent` 及全套 CRUD 方法                                  |
| 路由层   | `resolveMessageTarget`、`handleChatEvent`/`handleAgentEvent` 按 agentId 双写（`messagesByAgent` + `messagesBySession`）、`updateAgentChatStream`  |
| 视图层   | `secondary-panel.ts`（Tab 栏 + 独立 message-list）、`topology-bar.ts`（紧凑 DAG 拓扑图）、`main-workspace.ts` 单列布局 + 悬浮面板                 |
| 数据传递 | `app-shell.ts` → `main-workspace` 传递 `viewMode`、`subAgentMessages`、`subAgents`、`agents`、`activeSubAgentTab`、`unreadAgents`、`activeAgents` |
| 控制层   | `session-controller.ts` 拓扑获取 + 历史消息按 agentId 路由                                                                                        |
| 碎片修复 | Root_Agent `state=final` 时调用 `fetchSessionHistoryRange` 替换碎片                                                                               |
| 超时优化 | `aiemas_sessions_send` 默认超时已改为 120s                                                                                                        |

### 1.2 截图暴露的实际问题

尽管代码层面的路由和存储逻辑已实现，截图显示 **UI 渲染层仍存在严重问题**：

| 问题编号 | 现象                                                                            | 根因分析                                                                                                                                                |
| -------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1**   | 子 Agent（`aieiaas-resource`）的思考过程、ToolCall、ToolResult 直接渲染在主窗口 | `messagesBySession`（向后兼容写入）仍包含所有 Agent 消息，Primary_Panel 的 `.messages` 绑定的是 `messagesBySession` 而非 `messagesByAgent[rootAgentId]` |
| **P2**   | 子 Agent 的 `assistant` 消息被 ToolCall/ToolResult 切割成多段碎片气泡           | `updateChatStream` 在 `messagesBySession` 中按末尾消息匹配，工具事件插入后末尾不再是 assistant 消息，导致新建气泡而非原地更新                           |
| **P3**   | 右侧辅窗口 Tab 栏存在但内容与主窗口重复                                         | 双写机制导致主窗口未过滤子 Agent 消息，辅窗口正确显示了子 Agent 消息，形成重复                                                                          |
| **P4**   | 无"根 Agent 正在等待子 Agent"的状态反馈                                         | 缺少 `aiemas_sessions_send` 工具调用期间的等待状态卡片                                                                                                  |
| **P5**   | 历史消息回放时同样混合渲染                                                      | 历史消息加载后写入 `messagesBySession` 时未按 agentId 过滤                                                                                              |
| **P6**   | 双列布局（60%/40%）压缩消息区域，表格/代码块显示不美观                          | `main-workspace.ts` 使用 `flex-direction: row` 双列布局，主消息区宽度被压缩到 60%                                                                       |

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

#### 3.2 `messagesBySession` 双写策略调整

**修改文件**：`aiemas/ui/mas4s/src/gateway/event-handler.ts`

碎片修复逻辑中 `fetchSessionHistoryRange` 返回的消息列表过滤子 Agent 消息。

#### 3.3 历史消息加载的 `messagesBySession` 过滤

**修改文件**：`aiemas/ui/mas4s/src/controllers/session-controller.ts`

`onSessionSelect` 中加载历史消息后，写入 `messagesBySession` 时过滤掉子 Agent 消息。

#### 3.4 Streaming 连续性修复

由 3.1 自动解决。`messagesByAgent[rootAgentId]` 中不包含子 Agent 事件，streaming 连续性自然恢复。

---

### 阶段二：交互体验增强（解决 P4，提升需求 4/5 体验）

#### 3.5 根 Agent 等待子 Agent 的状态反馈

`msg-tool-card.ts` 识别 `aiemas_sessions_send` ToolCall，渲染等待状态卡片（紫色主题、旋转动画、实时计时器）。

#### 3.6 子 Agent Tab 活跃状态增强

`secondary-panel.ts` Tab 栏增加 `activeAgents` 脉冲动画（绿色圆点），优先级高于未读指示器。

---

### 阶段三：视觉降噪与信息层级（提升整体 UX）

#### 3.7 消息气泡差异化

辅窗口子 Agent 气泡显示蓝色左侧边线 + 浅灰背景，通过 CSS 自定义属性 `--msg-agent-bg` 和 `--msg-agent-border-left` 传递。

#### 3.8 工具调用折叠

`msg-tool-card` 默认折叠（`_expanded = false`）。

#### 3.9 思考过程折叠

`msg-agent` 默认折叠（`_thinkingExpanded = false`）。

---

## 四、实施优先级与依赖关系

```
阶段一（核心修复）─ ✅ 已完成
  ├── 3.1 Primary_Panel 数据源切换
  ├── 3.2 碎片修复过滤
  ├── 3.3 历史消息过滤
  └── 3.4 Streaming 连续性

阶段二（交互增强）─ ✅ 已完成
  ├── 3.5 等待状态卡片
  └── 3.6 Tab 活跃状态

阶段三（视觉降噪）─ ✅ 已完成
  ├── 3.7 气泡差异化
  ├── 3.8 工具调用折叠
  └── 3.9 思考过程折叠

阶段四（布局优化）─ ✅ 已完成
  ├── 4.1 双列 → 单列布局
  ├── 4.2 内嵌紧凑拓扑图
  ├── 4.3 悬浮子 Agent 面板
  └── 4.4 Header 拓扑文字移除
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
| `aiemas/ui/mas4s/src/components/main-workspace.ts`      | 四    | 单列布局 + 拓扑条 + 悬浮面板                      |
| `aiemas/ui/mas4s/src/components/topology-bar.ts`        | 四    | 新建：紧凑 DAG 拓扑图组件                         |
| `aiemas/ui/mas4s/src/components/main-header.ts`         | 四    | 删除拓扑关系文字                                  |

---

## 六、验证策略

### 阶段一验证

1. **主窗口过滤验证**：发送消息触发根 Agent 调用子 Agent，确认主窗口仅显示根 Agent 消息
2. **辅窗口隔离验证**：确认辅窗口 Tab 切换后，仅显示对应子 Agent 的消息流
3. **Streaming 连续性验证**：子 Agent 执行期间，观察辅窗口中 assistant 消息是否连续更新
4. **历史回放验证**：切换到历史会话，确认主窗口和辅窗口各自正确显示对应 Agent 的历史消息
5. **碎片修复验证**：根 Agent run 结束后，主窗口消息列表应被完整消息替换，无碎片残留

### 阶段四验证

1. **拓扑图显示**：有子 Agent 的会话中，聊天区顶部显示 DAG 拓扑图
2. **消息预览**：子 Agent 节点底部显示最新消息预览文本
3. **悬浮面板展开**：点击子 Agent 消息预览行，悬浮面板从拓扑图下方弹出
4. **面板外部收起**：点击悬浮面板外部遮罩区域，面板收起
5. **Tab 切换**：悬浮面板内 Tab 切换正常，切换后面板保持展开
6. **Header 简化**：Header 中不再显示拓扑关系文字

---

## 七、风险与回退

| 风险                                              | 影响           | 缓解措施                                                                |
| ------------------------------------------------- | -------------- | ----------------------------------------------------------------------- |
| `messagesByAgent` 中根 Agent 消息缺失（路由 bug） | 主窗口空白     | 保留 `messagesBySession` 作为 fallback，`getAgentMessages` 返回空时回退 |
| 审批事件未正确路由到根 Agent 集合                 | 审批卡片消失   | 审批事件的路由逻辑独立于 agentId 过滤，当前实现已保障                   |
| 碎片修复过滤过度（误删根 Agent 消息）             | 主窗口消息丢失 | 过滤条件严格匹配 `sessionKey` 中的 agentId，无 sessionKey 的消息保留    |
| 拓扑 API 未返回 edges 但有子 Agent 消息           | 拓扑条不显示   | fallback 从 `subAgentMessages` keys 推断子 Agent 列表                   |

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
