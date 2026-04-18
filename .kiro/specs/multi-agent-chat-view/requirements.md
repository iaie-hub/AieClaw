# 需求文档

## 简介

AIEMAS 多 Agent 协作平台中，Orchestrator Agent（根 Agent）通过 `aiemas_sessions_send` 调用子 Agent 执行任务。当前前端 `chat-view.ts` 采用单窗口视图，所有 Agent 的 streaming 输出混合渲染在同一个消息列表中，导致根 Agent 和子 Agent 的输出交叉割裂显示，用户体验严重受损。

本需求基于 Agent 拓扑关系，将 chat-view 改造为多窗口视图：根 Agent 为主窗口，子 Agent 为辅窗口，将不同 Agent 的输出路由到对应窗口中，消除交叉割裂问题。

## 术语表

- **Chat_View**：聊天视图组件（`chat-view.ts`），负责消息列表渲染和用户输入
- **Main_Workspace**：主工作区组件（`main-workspace.ts`），承载 chat-view 的父容器
- **Event_Handler**：WebSocket 事件处理器（`event-handler.ts`），负责接收和分发 agent/chat 事件
- **App_Store**：全局状态管理（`app-store.ts`），存储消息、会话、审批等数据
- **Session_Key**：会话标识，格式为 `agent:{agentId}:group:{sessionUuid}`
- **Agent_Id**：Agent 标识符，从 Session_Key 中提取，如 `aieiaas`、`aieiaas-resource`
- **Root_Agent**：根 Agent（Orchestrator），拓扑树的根节点，如 `aieiaas`
- **Sub_Agent**：子 Agent，由根 Agent 通过 `aiemas_sessions_send` 调用的下游 Agent
- **Topology**：Agent 拓扑关系，通过 `fetchTopology(client, rootAgentId)` 获取，包含 `edges: [{from, to}]`
- **Primary_Panel**：主窗口面板，显示根 Agent 的消息流
- **Secondary_Panel**：辅窗口面板，显示子 Agent 的消息流
- **Single_View_Mode**：单窗口模式，无拓扑关系时的默认视图（当前行为）
- **Multi_View_Mode**：多窗口模式，有拓扑关系时的分屏视图
- **Streaming_Fragment**：Streaming 碎片，指实时 streaming 期间因 tool event 插入打断 assistant delta 连续性而产生的多余消息气泡
- **History_Range_API**：`session.history.range` 接口，用于获取指定 run 的完整历史消息列表
- **Run_Id**：Agent 单次执行的唯一标识符，用于关联同一次 run 内的所有 streaming 事件和最终消息
- **Timeout_Seconds**：`aiemas_sessions_send` 工具调用中 `agent.wait` 的超时时间参数

## 需求

### 需求 1：Agent 事件的消息路由

**用户故事：** 作为 AIEMAS 用户，我希望不同 Agent 的消息被路由到各自独立的消息存储中，以便前端能按 Agent 分别渲染。

#### 验收标准

1. WHEN Event_Handler 收到 `agent` 或 `chat` 事件时，THE Event_Handler SHALL 从事件 payload 的 `sessionKey` 中提取 Agent_Id
2. WHEN Event_Handler 提取到 Agent_Id 后，THE Event_Handler SHALL 将消息存储到 App_Store 中以 Agent_Id 为维度的消息集合中
3. THE App_Store SHALL 提供按 Agent_Id 查询消息列表的接口（`messagesByAgent` 或等效机制）
4. WHEN 事件的 `sessionKey` 中 Agent_Id 与当前会话的 Root_Agent 一致时，THE Event_Handler SHALL 将消息路由到 Primary_Panel 的消息集合
5. WHEN 事件的 `sessionKey` 中 Agent_Id 与当前会话的 Root_Agent 不一致时，THE Event_Handler SHALL 将消息路由到对应 Sub_Agent 的 Secondary_Panel 消息集合
6. THE Event_Handler SHALL 保持审批事件（`exec.approval.requested`、`exec.approval.resolved`）的现有处理逻辑不变，审批卡片仍渲染在 Primary_Panel 中
7. WHILE Single_View_Mode 激活时，WHEN `handleAgentEvent` 收到 `stream=assistant` 的事件且事件 `sessionKey` 中的 Agent_Id 与当前会话的 Root_Agent 不一致时，THE Event_Handler SHALL 仍将该消息路由到对应 Sub_Agent 的 `messagesByAgent` 消息集合中（不丢弃），但 Secondary_Panel 的 DOM 容器处于隐藏状态，用户不可见
8. WHILE Single_View_Mode 激活时，WHEN `handleChatEvent` 收到 `state=final` 的事件且事件 `sessionKey` 中的 Agent_Id 与当前会话的 Root_Agent 不一致时，THE Event_Handler SHALL 仍将该消息路由到对应 Sub_Agent 的 `messagesByAgent` 消息集合中（不丢弃），Secondary_Panel 隐藏确保子 Agent 的最终输出不与 Root_Agent 的输出重复显示
9. WHILE Single_View_Mode 激活时，WHEN `handleAgentEvent` 收到 `stream=tool` 的事件且事件 `sessionKey` 中的 Agent_Id 与当前会话的 Root_Agent 不一致时，THE Event_Handler SHALL 仍将该消息路由到对应 Sub_Agent 的 `messagesByAgent` 消息集合中（不丢弃），子 Agent 的工具调用结果在 Primary_Panel 中由 Root_Agent 通过 `aiemas_sessions_send` 的 tool_result 统一呈现
10. WHILE Single_View_Mode 激活时，THE Event_Handler SHALL 保留所有来自 Sub_Agent 的审批事件（`exec.approval.requested`、`exec.approval.resolved`），不对其进行过滤

### 需求 2：Agent 拓扑数据获取与缓存

**用户故事：** 作为 AIEMAS 用户，我希望系统自动获取当前会话关联 Agent 的拓扑关系，以便确定是否需要多窗口视图以及窗口布局。

#### 验收标准

1. WHEN 用户选择一个会话时，THE App_Store SHALL 根据会话 Session_Key 中的 Agent_Id 调用 `fetchTopology(client, rootAgentId)` 获取拓扑数据
2. THE App_Store SHALL 缓存已获取的拓扑数据，避免重复请求
3. WHEN 拓扑数据返回的 `edges` 数组为空时，THE Chat_View SHALL 使用 Single_View_Mode 渲染
4. WHEN 拓扑数据返回的 `edges` 数组包含至少一条边时，THE Chat_View SHALL 使用 Multi_View_Mode 渲染
5. IF 拓扑数据获取失败，THEN THE Chat_View SHALL 回退到 Single_View_Mode 并在控制台记录错误

### 需求 3：多窗口视图布局

**用户故事：** 作为 AIEMAS 用户，我希望在多 Agent 协作场景下看到分屏布局，根 Agent 为主窗口、子 Agent 为辅窗口，以便清晰区分不同 Agent 的输出。

#### 验收标准

1. WHILE Multi_View_Mode 激活时，THE Main_Workspace SHALL 将工作区水平分割为 Primary_Panel 和 Secondary_Panel 区域
2. THE Primary_Panel SHALL 占据主要空间（建议 60% 宽度），显示 Root_Agent 的消息流和用户输入区
3. THE Secondary_Panel SHALL 占据辅助空间（建议 40% 宽度），显示当前活跃 Sub_Agent 的消息流
4. WHEN 拓扑中存在多个 Sub_Agent 时，THE Secondary_Panel SHALL 提供 Tab 切换机制，允许用户在不同 Sub_Agent 的消息流之间切换
5. THE Primary_Panel SHALL 保留完整的用户输入区（textarea + 发送/中止按钮），Secondary_Panel 不包含用户输入区
6. WHILE Single_View_Mode 激活时，THE Chat_View SHALL 保持当前的单窗口全宽布局不变

### 需求 4：主窗口（Primary_Panel）渲染

**用户故事：** 作为 AIEMAS 用户，我希望主窗口只显示根 Agent 的消息和我的输入，不被子 Agent 的输出干扰。

#### 验收标准

1. THE Primary_Panel SHALL 仅渲染 Root_Agent 的 assistant streaming 消息、用户消息、审批卡片和工具调用卡片
2. THE Primary_Panel SHALL 过滤掉所有 Sub_Agent 的 assistant streaming 和 chat final 消息
3. WHEN Root_Agent 调用 `aiemas_sessions_send` 工具时，THE Primary_Panel SHALL 显示该工具调用卡片（tool_call），表明根 Agent 正在调用子 Agent
4. WHEN Root_Agent 的 `aiemas_sessions_send` 工具返回结果时，THE Primary_Panel SHALL 显示工具结果卡片（tool_result），包含子 Agent 的汇总回复
5. WHEN `handleChatEvent` 收到 `state=final` 事件且 `sessionKey` 中的 Agent_Id 为 Sub_Agent 时，THE Primary_Panel SHALL 不渲染该 final 消息，避免子 Agent 的最终输出在主窗口中重复显示
6. WHEN `handleAgentEvent` 收到 `stream=tool` 事件且 `sessionKey` 中的 Agent_Id 为 Sub_Agent 时，THE Primary_Panel SHALL 不渲染该工具事件，子 Agent 的工具调用过程仅在 Secondary_Panel 中展示
7. THE Primary_Panel SHALL 保留并渲染所有来自 Sub_Agent 的审批事件（`exec.approval.requested`、`exec.approval.resolved`），审批卡片不受 Sub_Agent 过滤规则影响

### 需求 5：辅窗口（Secondary_Panel）渲染

**用户故事：** 作为 AIEMAS 用户，我希望在辅窗口中实时看到子 Agent 的执行过程，包括思考、工具调用和输出结果。

#### 验收标准

1. THE Secondary_Panel SHALL 渲染对应 Sub_Agent 的 assistant streaming 消息、工具调用卡片和工具结果卡片
2. WHEN Sub_Agent 正在执行时（收到 streaming 事件），THE Secondary_Panel SHALL 自动切换到该 Sub_Agent 的 Tab
3. THE Secondary_Panel SHALL 在每个 Tab 标签上显示 Sub_Agent 的 Agent_Id 作为标识
4. WHEN Sub_Agent 有新消息到达且当前未选中该 Tab 时，THE Secondary_Panel SHALL 在对应 Tab 标签上显示未读指示器
5. THE Secondary_Panel SHALL 支持独立滚动，不影响 Primary_Panel 的滚动位置

### 需求 6：视图模式自动切换

**用户故事：** 作为 AIEMAS 用户，我希望系统根据会话的 Agent 拓扑自动选择合适的视图模式，无需手动配置。

#### 验收标准

1. WHEN 用户切换到一个新会话时，THE Chat_View SHALL 根据该会话的拓扑数据自动选择 Single_View_Mode 或 Multi_View_Mode
2. WHEN 会话的 Root_Agent 没有拓扑关系（无子 Agent）时，THE Chat_View SHALL 自动使用 Single_View_Mode
3. WHEN 会话的 Root_Agent 存在拓扑关系（有子 Agent）时，THE Chat_View SHALL 自动使用 Multi_View_Mode
4. WHEN 视图模式切换时，THE Chat_View SHALL 保留已加载的消息数据，避免重新请求历史消息
5. WHILE Single_View_Mode 激活时，THE Event_Handler SHALL 仍然按 Agent_Id 将消息分发到对应的消息集合中，仅 Secondary_Panel 的 DOM 容器不渲染（隐藏），消息路由逻辑与 Multi_View_Mode 保持一致

### 需求 7：Streaming 消息的连续性保障

**用户故事：** 作为 AIEMAS 用户，我希望每个窗口内的 streaming 消息连续渲染，不被其他 Agent 的事件打断。

#### 验收标准

1. THE Event_Handler SHALL 确保同一 Agent 的 assistant streaming delta 在对应窗口内连续更新，不因其他 Agent 的 tool event 插入而产生新气泡
2. WHEN `updateChatStream` 处理某个 Agent 的 streaming 消息时，THE App_Store SHALL 仅在该 Agent 对应的消息列表中查找匹配的末尾消息进行原地更新
3. THE Primary_Panel 和 Secondary_Panel SHALL 各自独立维护滚动位置和自动吸底行为

### 需求 8：历史消息的多窗口回放

**用户故事：** 作为 AIEMAS 用户，我希望切换到历史会话时，历史消息也能按 Agent 分窗口显示。

#### 验收标准

1. WHEN 加载历史消息时，THE Event_Handler SHALL 根据每条消息的 `sessionKey` 将其路由到对应 Agent 的消息集合
2. WHEN 历史消息中包含多个 Agent 的消息时，THE Chat_View SHALL 使用 Multi_View_Mode 渲染
3. THE Primary_Panel 和 Secondary_Panel SHALL 各自支持独立的向上翻页加载更早历史消息

### 需求 9：消息 sessionKey 完整性保障

**用户故事：** 作为开发者，我希望所有 ChatMessage 对象都携带 `sessionKey` 字段，以便消息路由和 Agent 标识能正确工作。

#### 验收标准

1. WHEN Event_Handler 构建 ChatMessage 对象时（包括 assistant streaming、tool、chat final 等所有类型），THE Event_Handler SHALL 将事件 payload 中的 `sessionKey` 写入 ChatMessage 的 `sessionKey` 字段
2. THE Session_Utils SHALL 提供 `extractAgentNameFromKey(sessionKey)` 函数，从 Session_Key 中提取 Agent_Id
3. THE Session_Utils SHALL 提供 `buildSessionKey(agentId, sessionUuid)` 函数，从 Agent_Id 和 sessionUuid 构建 Session_Key
4. FOR ALL 合法的 Session_Key 值，解析后再构建 SHALL 产生等价的 Session_Key（往返一致性）

### 需求 10：Streaming 碎片的兜底修复

**用户故事：** 作为 AIEMAS 用户，我希望在 Agent run 结束后，实时 streaming 期间产生的碎片化消息能被自动修复为与历史视图一致的完整消息，确保最终渲染结果干净准确。

#### 验收标准

1. WHEN `handleChatEvent` 收到 `state=final` 事件且携带有效的 Run_Id 时，THE Event_Handler SHALL 调用 History_Range_API 获取该 Run_Id 对应的完整消息列表
2. WHEN History_Range_API 返回成功时，THE Event_Handler SHALL 用返回的完整消息列表替换 `messagesBySession` 中该 Run_Id 期间累积的所有 Streaming_Fragment
3. WHEN History_Range_API 返回的消息列表替换完成后，THE Chat_View SHALL 保持当前滚动位置不发生跳动，用户无感知地完成碎片修复
4. IF History_Range_API 请求失败，THEN THE Event_Handler SHALL 保留现有的 streaming 消息不做替换，并在控制台记录错误信息
5. THE Event_Handler SHALL 仅对 Root_Agent 的 `state=final` 事件触发碎片修复流程，Sub_Agent 的 `state=final` 事件不触发（Sub_Agent 的消息已被需求 1 的过滤规则处理）
6. WHEN 碎片修复替换消息时，THE Event_Handler SHALL 保留已有的审批卡片消息和用户消息，仅替换 assistant 和 tool 类型的 Streaming_Fragment

### 需求 11：aiemas_sessions_send 超时优化

**用户故事：** 作为 AIEMAS 用户，我希望子 Agent 有足够的执行时间完成任务，减少因超时导致的 `running` 状态返回和重复输出。

#### 验收标准

1. THE aiemas_sessions_send 工具 SHALL 将 `agent.wait` 的 Timeout_Seconds 默认值从 30 秒增加到 120 秒
2. WHEN 子 Agent 在 120 秒内完成执行时，THE aiemas_sessions_send 工具 SHALL 返回子 Agent 的完整执行结果（`status=ok`），而非超时状态（`status=running`）
3. IF 子 Agent 在 120 秒内仍未完成执行，THEN THE aiemas_sessions_send 工具 SHALL 返回 `status=running`，Root_Agent 可根据该状态决定后续行为
4. THE aiemas_sessions_send 工具 SHALL 支持通过工具参数覆盖默认的 Timeout_Seconds 值，允许调用方根据任务复杂度自定义超时时间
