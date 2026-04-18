# Implementation Plan: Multi-Agent Chat View

## 概述

将 AIEMAS 前端 chat-view 从单窗口视图改造为多窗口视图。按依赖关系分层实施：基础设施（session-utils）→ 状态层（app-store）→ 路由层（event-handler）→ 视图层（main-workspace、secondary-panel、app-shell）→ 控制层（session-controller）→ 后端超时优化（aiemas-tools）→ 碎片修复。每个任务明确涉及的文件和验收标准。

## Tasks

- [x] 1. 基础设施：SessionKey 工具函数扩展
  - [x] 1.1 在 `session-utils.ts` 中新增 `buildSessionKey(agentId, sessionUuid)` 函数
    - 文件：`aiemas/ui/mas4s/src/utils/session-utils.ts`
    - 实现 `buildSessionKey`，返回 `agent:${agentId}:group:${sessionUuid}`
    - 确保与已有的 `extractAgentNameFromKey` 和 `extractUuidFromKey` 形成往返一致性
    - _Requirements: 9.2, 9.3, 9.4_

  - [x] 1.2 编写 SessionKey 往返一致性属性测试
    - **Property 1: SessionKey 往返一致性**
    - **Validates: Requirements 9.2, 9.3, 9.4**
    - 文件：`aiemas/ui/mas4s/src/utils/session-utils.property.test.ts`
    - 使用 fast-check 生成随机 agentId（字母数字+连字符）和随机 UUID
    - 验证 `buildSessionKey(extractAgentNameFromKey(key), extractUuidFromKey(key)) === key`

- [x] 2. Checkpoint — 确保基础设施测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 3. 状态层：AppStore 多 Agent 消息存储与拓扑缓存
  - [x] 3.1 在 `app-store.ts` 中新增 `messagesByAgent`、拓扑缓存、视图模式、Tab 状态和未读指示器
    - 文件：`aiemas/ui/mas4s/src/store/app-store.ts`
    - 新增字段：`messagesByAgent: Map<string, Map<string, ChatMessage[]>>`、`topologyByAgent: Map<string, TopologyEdge[]>`、`viewModeBySession: Map<string, "single" | "multi">`、`activeSubAgentTab: Map<string, string>`、`unreadByAgent: Map<string, Set<string>>`
    - 新增方法：`appendAgentMessage`、`getAgentMessages`、`updateAgentLastMessage`、`setTopology`、`getTopology`、`setViewMode`、`getViewMode`、`setActiveSubAgentTab`、`markAgentUnread`、`clearAgentUnread`、`getSubAgentMessages`、`getSubAgentList`
    - 定义 `TopologyEdge` 接口（`{ from: string; to: string }`）
    - _Requirements: 1.2, 1.3, 2.2, 5.4, 6.4, 6.5_

  - [x] 3.2 编写 Streaming 消息 Agent 隔离属性测试
    - **Property 5: Streaming 消息的 Agent 隔离**
    - **Validates: Requirements 7.1, 7.2**
    - 文件：`aiemas/ui/mas4s/src/store/app-store.property.test.ts`
    - 生成两个不同 Agent 的交错 streaming 事件序列，验证 `updateAgentLastMessage` 仅修改目标 Agent 的消息列表

  - [x] 3.3 编写未读指示器准确性属性测试
    - **Property 7: 未读指示器准确性**
    - **Validates: Requirements 5.4**
    - 文件：`aiemas/ui/mas4s/src/store/app-store.property.test.ts`
    - 生成随机 sub-agent 消息和随机 activeTab，验证 `markAgentUnread`/`clearAgentUnread` 行为

  - [x] 3.4 编写拓扑缓存幂等性属性测试
    - **Property 10: 拓扑缓存幂等性**
    - **Validates: Requirements 2.2**
    - 文件：`aiemas/ui/mas4s/src/store/app-store.property.test.ts`
    - 生成随机 rootAgentId 和 edges 数组，验证 `setTopology` 后 `getTopology` 返回相同数据

  - [x] 3.5 编写视图模式切换保留消息数据属性测试
    - **Property 11: 视图模式切换保留消息数据**
    - **Validates: Requirements 6.4, 6.5**
    - 文件：`aiemas/ui/mas4s/src/store/app-store.property.test.ts`
    - 生成随机消息和随机模式切换序列，验证 `messagesByAgent` 数据不被清除

- [x] 4. Checkpoint — 确保状态层测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. 路由层：Event Handler 消息路由改造
  - [x] 5.1 在 `event-handler.ts` 中新增 `resolveMessageTarget` 函数并改造 `handleChatEvent`
    - 文件：`aiemas/ui/mas4s/src/gateway/event-handler.ts`
    - 新增 `resolveMessageTarget(store, sessionKey)` 返回 `{ sessionUuid, agentId, isRootAgent }`
    - 改造 `handleChatEvent`：所有消息按 agentId 路由到 `messagesByAgent`，Root_Agent 消息同时写入 `messagesBySession`（向后兼容）
    - `state=final` 时：仅 Root_Agent 触发碎片修复流程（需求 10.5）
    - 确保所有构建的 ChatMessage 对象携带 `sessionKey` 字段（需求 9.1）
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.7, 1.8, 4.2, 4.5, 6.5, 9.1, 10.5_

  - [x] 5.2 改造 `handleAgentEvent` 的消息路由逻辑
    - 文件：`aiemas/ui/mas4s/src/gateway/event-handler.ts`
    - `stream=assistant`：按 agentId 路由到 `messagesByAgent`，Root_Agent 同时写入 `messagesBySession`
    - `stream=tool`：按 agentId 路由到 `messagesByAgent`，Root_Agent 同时写入 `messagesBySession`
    - Sub_Agent 消息在 Single_View_Mode 下仍存储到 `messagesByAgent`（不丢弃）
    - 审批事件保持现有逻辑不变，始终路由到 Primary_Panel
    - 非活跃 Tab 的 Sub_Agent 收到消息时调用 `markAgentUnread`
    - 活跃 Sub_Agent streaming 时自动切换 Tab（`setActiveSubAgentTab`）
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.6, 1.7, 1.9, 1.10, 4.1, 4.3, 4.4, 4.6, 4.7, 5.1, 5.2, 7.1_

  - [x] 5.3 改造 `updateChatStream` 支持按 Agent 维度的消息更新
    - 文件：`aiemas/ui/mas4s/src/gateway/event-handler.ts`
    - 新增 `updateAgentChatStream(store, sessionUuid, agentId, msg, isFinal)` 函数
    - 在 `messagesByAgent[sessionUuid][agentId]` 中查找末尾消息进行原地更新
    - 确保不同 Agent 的 streaming delta 互不干扰
    - _Requirements: 7.1, 7.2_

  - [x] 5.4 编写消息按 Agent 路由属性测试
    - **Property 2: 消息按 Agent 维度路由**
    - **Validates: Requirements 1.1, 1.2, 1.3, 1.4, 1.5, 4.1, 4.2, 8.1**
    - 文件：`aiemas/ui/mas4s/src/gateway/event-handler.property.test.ts`
    - 生成随机 sessionKey 和 ChatMessage payload，验证消息仅出现在对应 agentId 的集合中

  - [x] 5.5 编写 Single_View_Mode 消息不丢失属性测试
    - **Property 3: Single_View_Mode 消息存储不丢失**
    - **Validates: Requirements 1.7, 1.8, 1.9, 6.4, 6.5**
    - 文件：`aiemas/ui/mas4s/src/gateway/event-handler.property.test.ts`
    - 生成随机 sub-agent 事件（assistant/tool/final），验证 Single_View_Mode 下消息仍存储到 `messagesByAgent`

  - [x] 5.6 编写审批事件不受过滤规则影响属性测试
    - **Property 4: 审批事件不受过滤规则影响**
    - **Validates: Requirements 1.6, 1.10, 4.7**
    - 文件：`aiemas/ui/mas4s/src/gateway/event-handler.property.test.ts`
    - 生成随机审批事件 + 随机 agentId + 随机 viewMode，验证审批事件始终保留

  - [x] 5.7 编写 ChatMessage sessionKey 完整性属性测试
    - **Property 9: ChatMessage sessionKey 完整性**
    - **Validates: Requirements 9.1**
    - 文件：`aiemas/ui/mas4s/src/gateway/event-handler.property.test.ts`
    - 生成所有事件类型的随机 payload，验证构建的 ChatMessage 的 `sessionKey` 字段非空且等于原始值

- [x] 6. Checkpoint — 确保路由层测试通过
  - Ensure all tests pass, ask the user if questions arise.

- [x] 7. 视图层：Secondary Panel 新组件
  - [x] 7.1 创建 `secondary-panel.ts` Web Component
    - 文件：`aiemas/ui/mas4s/src/views/secondary-panel.ts`
    - 使用 Lit 实现 `<secondary-panel>` 自定义元素
    - 属性：`agentMessages: Map<string, ChatMessage[]>`、`subAgents: string[]`、`activeTab: string`、`unreadAgents: Set<string>`、`showToolMessages: boolean`
    - 渲染 Tab 栏（显示 Sub_Agent 的 Agent_Id，未读指示器 ●）
    - 渲染当前活跃 Tab 对应的 message-list（独立滚动区域）
    - Tab 切换时触发 `tab-change` 事件
    - 不包含用户输入区
    - _Requirements: 3.3, 3.4, 3.5, 5.1, 5.3, 5.4, 5.5_

- [x] 8. 视图层：Main Workspace 布局改造
  - [x] 8.1 在 `main-workspace.ts` 中新增多窗口布局属性和渲染逻辑
    - 文件：`aiemas/ui/mas4s/src/components/main-workspace.ts`
    - 新增属性：`viewMode`、`subAgentMessages`、`subAgents`、`activeSubAgentTab`、`unreadAgents`
    - Multi_View_Mode：水平分割为 Primary_Panel（60%）和 Secondary_Panel（40%），中间加分隔线
    - Single_View_Mode：Primary_Panel 全宽，Secondary_Panel 隐藏（`display: none`）但保留 DOM
    - 导入 `../views/secondary-panel.js`
    - 处理 `tab-change` 事件，冒泡给父组件
    - _Requirements: 3.1, 3.2, 3.5, 3.6, 4.1, 4.2_

- [x] 9. 视图层：App Shell 数据传递
  - [x] 9.1 在 `app-shell.ts` 的 `renderMain()` 中传递新增的 Agent 维度数据
    - 文件：`aiemas/ui/mas4s/src/views/app-shell.ts`
    - 向 `<main-workspace>` 传递 `.viewMode`、`.subAgentMessages`、`.subAgents`、`.activeSubAgentTab`、`.unreadAgents`
    - 从 `store` 读取 `getViewMode`、`getSubAgentMessages`、`getSubAgentList`、`activeSubAgentTab`、`unreadByAgent`
    - _Requirements: 3.1, 5.1, 6.1_

- [x] 10. 控制层：Session Controller 拓扑获取
  - [x] 10.1 在 `session-controller.ts` 的 `onSessionSelect` 中增加拓扑获取逻辑
    - 文件：`aiemas/ui/mas4s/src/controllers/session-controller.ts`
    - 会话选择时提取 rootAgentId，检查拓扑缓存
    - 缓存命中：直接设置 viewMode
    - 缓存未命中：异步调用 `fetchTopology(client, rootAgentId)`，成功后 `setTopology` + `setViewMode`
    - 获取失败：回退到 Single_View_Mode，`console.error` 记录错误
    - 历史消息加载时按 sessionKey 将消息路由到 `messagesByAgent`
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 6.1, 6.2, 6.3, 8.1, 8.2_

- [x] 11. Checkpoint — 确保视图层和控制层集成正常
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. 后端超时优化
  - [x] 12.1 修改 `aiemas-tools.ts` 中 `aiemas_sessions_send` 的默认超时值
    - 文件：`aiemas/src/gateway-bridge/aiemas-tools.ts`
    - 将 `timeoutSeconds: timeoutSeconds ?? 30` 改为 `timeoutSeconds: timeoutSeconds ?? 120`
    - 更新 schema description 中的默认值说明
    - _Requirements: 11.1, 11.2, 11.3, 11.4_

  - [x] 12.2 编写超时参数透传属性测试
    - **Property 8: 超时参数透传**
    - **Validates: Requirements 11.1, 11.4**
    - 文件：`aiemas/src/gateway-bridge/aiemas-tools.property.test.ts`
    - 生成随机 timeoutSeconds 数值（含 undefined），验证传入值原样透传，未传入时使用默认值 120

- [x] 13. 碎片修复：Root_Agent run 结束后的消息替换
  - [x] 13.1 在 `event-handler.ts` 中实现碎片修复逻辑
    - 文件：`aiemas/ui/mas4s/src/gateway/event-handler.ts`
    - 在 `handleChatEvent` 的 `state=final` 分支中，当 `isRootAgent && runId` 时调用 History_Range_API
    - 用返回的完整消息列表替换 `messagesBySession` 中该 run 期间的 assistant + tool 碎片
    - 保留 user 和 approval（pending）类型的消息不替换
    - API 失败时保留现有消息，`console.error` 记录错误
    - 替换后保持滚动位置不跳动
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6_

  - [x] 13.2 编写碎片修复保留非 Streaming 消息属性测试
    - **Property 6: 碎片修复保留非 Streaming 消息**
    - **Validates: Requirements 10.2, 10.6**
    - 文件：`aiemas/ui/mas4s/src/gateway/event-handler.property.test.ts`
    - 生成混合类型消息列表 + 替换消息列表，验证 user 和 approval 消息被保留

- [x] 14. Final Checkpoint — 确保所有测试通过
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- 标记 `*` 的子任务为可选，可跳过以加速 MVP 交付
- 每个任务引用了具体的需求编号，确保需求可追溯
- Checkpoint 任务确保增量验证，避免问题累积
- 属性测试验证设计文档中定义的正确性属性，单元测试验证具体示例和边界情况
- `messagesBySession` 保留用于向后兼容（仅存储 Root_Agent 消息），`messagesByAgent` 作为主存储
