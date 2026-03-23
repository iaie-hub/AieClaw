# 需求文档：mas4s 多智能体协作平台前端

## 简介

本文档定义 mas4s 多智能体科研协作平台前端的功能需求。
系统基于 OpenClaw 底座构建，在 `aiemas/ui/mas4s/` 目录实现，
技术栈为 TypeScript ESM + Lit 3.x Web Components + Vite 8。
Agent 以**会话（Session）**为交互单元，第一期聚焦多人会话功能，
后续迭代叠加 Human-in-the-Loop 审批、透明化推理、子 Agent 挂起、方案 Diff、使用情况管理等模块。

---

## 词汇表

- **System**：mas4s 前端应用整体
- **AppStore**：全局响应式状态单例，管理会话列表、消息缓存、审批队列
- **GatewayClient**：封装 `GatewayBrowserClient` 的 WebSocket 客户端模块
- **SessionManager**：负责会话创建与加入的模块（`session-manager.ts`）
- **MessageFormatter**：消息格式化工具模块（`message-format.ts`）
- **EventHandler**：WebSocket 事件处理模块（`event-handler.ts`）
- **MasSession**：继承 `GatewaySessionRow` 的会话数据结构，含 `masType`、`hasNotification`、`notificationCount`、`participants` 扩展字段
- **ChatMessage**：继承 `NormalizedMessage` 的消息数据结构，含 `subType` 扩展字段
- **ApprovalRequest**：与 gateway `exec.approval.requested` payload 对齐的审批请求结构
- **PrimarySidebar**：一级导航组件（80px 宽）
- **SessionSidebar**：会话列表组件（280px 宽，仅工作台视图显示）
- **MainWorkspace**：主工作区组件
- **ChatView**：聊天视图组件
- **MessageList**：消息列表组件
- **ApprovalDrawer**：全局审批抽屉组件
- **MsgUser**：用户消息气泡组件
- **MsgColleague**：同事消息气泡组件
- **MsgAgent**：Agent 消息气泡组件（含推理折叠块）
- **MsgPending**：审批挂起卡片组件
- **发起者（Initiator）**：`masType="initiated"` 的会话创建方，拥有审批操作权限
- **参与者（Participant）**：`masType="participated"` 的会话加入方，无审批操作权限
- **group session**：sessionKey 含 `:group:` 的多人会话，gateway 自动派生 `kind="group"`

---

## 需求

### 需求 1：系统架构与技术约束

**用户故事：** 作为开发者，我希望前端基于 OpenClaw 底座构建并复用其 gateway 客户端，以便在不修改后端的前提下实现多智能体协作功能。

#### 验收标准

1. THE System SHALL 在 `aiemas/ui/mas4s/` 目录下构建，使用 TypeScript ESM + Lit 3.x Web Components + Vite 8 技术栈
2. THE System SHALL 复用 `ui/src/ui/gateway.ts` 中的 `GatewayBrowserClient`，不修改 gateway 任何文件
3. THE System SHALL 复用 `ui/src/ui/types.ts` 中的 `GatewaySessionRow` 类型定义
4. THE System SHALL 复用 `ui/src/ui/chat/message-normalizer.ts` 中的 `normalizeMessage` 函数
5. WHEN GatewayClient 建立连接，THE GatewayClient SHALL 声明 `scopes: ["operator.admin", "operator.approvals"]` 和 `caps: ["tool-events"]`
6. THE System SHALL 以 `aiemas/docs/mas4s/mas.html` 静态原型为 UI 布局与样式基准，不复用 `ui/` 目录的布局和样式

---

### 需求 2：三栏布局与导航

**用户故事：** 作为用户，我希望看到清晰的三栏布局，以便快速在不同功能模块间切换。

#### 验收标准

1. THE System SHALL 采用三栏水平 flex 布局（高度 100vh），从左到右依次为 PrimarySidebar、SessionSidebar（条件显示）、MainWorkspace
2. THE PrimarySidebar SHALL 宽度固定为 80px，包含工作台、使用情况、智能体、Skills、定时任务、设置六个导航项
3. WHEN 用户在 PrimarySidebar 切换到工作台导航，THE System SHALL 显示 SessionSidebar
4. WHEN 用户在 PrimarySidebar 切换到非工作台导航，THE System SHALL 隐藏 SessionSidebar
5. THE SessionSidebar SHALL 宽度固定为 280px，分"发起的会话"和"参与的会话"两个可折叠分组
6. THE MainWorkspace SHALL 占据剩余宽度（flex: 1），包含顶部 Header、内容区和输入区

---

### 需求 3：会话管理

**用户故事：** 作为用户，我希望能够发起新会话或加入已有会话，以便与 Agent 和其他参与者协作。

#### 验收标准

1. WHEN 用户点击 SessionSidebar 的"+"按钮，THE SessionSidebar SHALL 显示包含"发起新会话"和"加入会话"两个选项的下拉菜单
2. WHEN 用户选择"发起新会话"，THE SessionManager SHALL 生成含 `:group:` 的 sessionKey（格式：`agent:{agentId}:group:mas-{uuid}`）并调用 `sessions.create`
3. WHEN 用户选择"加入会话"，THE SessionManager SHALL 调用 `sessions.resolve` 查找 sessionKey，并将返回的 MasSession 的 `masType` 设为 `"participated"`
4. WHEN 会话创建成功，THE AppStore SHALL 将新 MasSession（`masType="initiated"`）添加到 `sessions` 列表并设为活跃会话
5. WHEN 会话加入成功，THE AppStore SHALL 将 MasSession（`masType="participated"`）添加到 `sessions` 列表并设为活跃会话
6. IF `sessions.resolve` 返回 `ok: false`，THEN THE SessionManager SHALL 抛出包含 sessionKey 的错误信息
7. WHEN 用户在 SessionSidebar 点击某个会话项，THE AppStore SHALL 将该会话设为活跃会话（`activeSessionId`）
8. WHEN 会话有未读通知（`hasNotification: true`），THE SessionSidebar SHALL 在"发起的会话"分组的对应项显示红色 is-dot badge
9. WHEN 会话有未读消息（`notificationCount > 0`），THE SessionSidebar SHALL 在"参与的会话"分组的对应项显示蓝色数字 badge

---

### 需求 4：多人会话消息收发

**用户故事：** 作为用户，我希望能够在会话中发送和接收消息，并能区分不同发送者，以便进行多人协作。

#### 验收标准

1. WHEN 用户在 ChatView 输入消息并按 Enter 键（非 Shift+Enter），THE ChatView SHALL 触发消息发送
2. WHEN 用户按 Shift+Enter，THE ChatView SHALL 在输入框中插入换行而不触发发送
3. WHEN 消息文本为空或仅含空白字符，THE ChatView SHALL 阻止发送并保持输入框内容不变
4. WHEN 用户发送消息，THE MessageFormatter SHALL 在消息体前注入 `"{发送者名}: "` 前缀，构造 `chat.send` 的 `message` 字段
5. WHEN 消息发送成功，THE ChatView SHALL 清空输入框
6. WHEN 收到 `event:chat { state:"delta" }`，THE EventHandler SHALL 将消息内容追加到对应 sessionKey 的流式消息缓存
7. WHEN 收到 `event:chat { state:"final" }`，THE EventHandler SHALL 将流式消息标记为完成并替换缓存中的对应消息
8. WHEN 收到 `event:chat { state:"clear" }`，THE EventHandler SHALL 清空对应 sessionKey 的消息缓存
9. WHEN 收到含 `"{发送者名}: "` 前缀的消息，THE EventHandler SHALL 调用 MessageFormatter 解析前缀，将 `subType` 设为 `"colleague"`，并将发送者名存入 `senderLabel`
10. WHEN 收到不含发送者前缀的消息，THE EventHandler SHALL 保持 `subType` 为 `undefined`

---

### 需求 5：消息格式化（round-trip）

**用户故事：** 作为开发者，我希望消息前缀的构造与解析互为逆操作，以便保证多人会话消息的正确传递。

#### 验收标准

1. THE MessageFormatter SHALL 通过 `buildGroupMessage(senderName, text)` 构造格式为 `"{senderName}: {text}"` 的消息体
2. THE MessageFormatter SHALL 通过 `parseSenderPrefix(text)` 解析消息体，提取 `senderLabel` 和 `cleanText`
3. FOR ALL 有效的发送者名（长度 1-40 字符，不含冒号和换行）和消息正文，`parseSenderPrefix(buildGroupMessage(name, text))` SHALL 返回 `{ senderLabel: name, cleanText: text }`（round-trip 属性）
4. WHEN 消息文本不含 `"{名称}: "` 前缀格式，THE MessageFormatter SHALL 返回 `{ senderLabel: null, cleanText: 原始文本 }`

---

### 需求 6：消息渲染

**用户故事：** 作为用户，我希望不同类型的消息以不同样式展示，以便快速区分用户、同事、Agent 和审批挂起消息。

#### 验收标准

1. WHEN 消息 `role="user"` 且 `subType` 为 `undefined`，THE MessageList SHALL 渲染 MsgUser 组件，消息行右对齐
2. WHEN 消息 `subType="colleague"`，THE MessageList SHALL 渲染 MsgColleague 组件，消息行左对齐
3. WHEN 消息 `role="assistant"` 且 `subType` 为 `undefined`，THE MessageList SHALL 渲染 MsgAgent 组件，消息行左对齐
4. WHEN 消息 `subType="pending"`，THE MessageList SHALL 渲染 MsgPending 组件
5. THE MsgUser SHALL 显示蓝紫渐变头像（UserFilled 图标）和蓝紫渐变气泡，气泡右上角圆角为 4px
6. THE MsgColleague SHALL 显示琥珀渐变头像（姓氏首字）和白色气泡，气泡左上角圆角为 4px
7. THE MsgAgent SHALL 显示绿色渐变头像（Cpu 图标）和白色气泡，气泡左上角圆角为 4px，发送者名后附"Agent"小标签
8. THE MsgPending SHALL 显示红色渐变头像（WarningFilled 图标）和审批挂起卡片，发送者名后附"Awaiting HITL"标签

---

### 需求 7：Human-in-the-Loop 审批（第二期）

**用户故事：** 作为会话发起者，我希望在 Agent 执行高危命令前收到审批请求，以便决定是否允许执行。

#### 验收标准

1. WHEN 收到 `event:exec.approval.requested`，THE EventHandler SHALL 将 ApprovalRequest 添加到 AppStore 的 `pendingApprovals` 队列
2. WHEN 收到 `event:exec.approval.resolved`，THE EventHandler SHALL 从 AppStore 的 `pendingApprovals` 队列中移除对应 `id` 的审批请求
3. WHEN `pendingApprovals` 队列非空，THE MainWorkspace SHALL 渲染 ApprovalDrawer 组件
4. WHEN 当前会话 `masType="initiated"`，THE MsgPending SHALL 显示"批准执行"、"驳回"、"修改参数"三个操作按钮
5. WHEN 当前会话 `masType="participated"`，THE MsgPending SHALL 隐藏所有操作按钮
6. WHEN 用户点击"批准执行"，THE MsgPending SHALL 触发 `resolve` 事件，携带 `{ id, decision: "allow-once" }`
7. WHEN 用户点击"驳回"，THE MsgPending SHALL 触发 `resolve` 事件，携带 `{ id, decision: "deny" }`
8. WHEN `resolve` 事件到达根组件，THE GatewayClient SHALL 调用 `exec.approval.resolve { id, decision }`
9. THE MainWorkspace 顶部 Header 的 Bell 角标 SHALL 显示 `pendingApprovals.length` 的总数（跨会话聚合）
10. WHEN `pendingApprovals.length === 0`，THE MainWorkspace 顶部 Header SHALL 隐藏 Bell 角标数字

---

### 需求 8：透明化推理（第二期）

**用户故事：** 作为用户，我希望能够查看 Agent 的推理过程，以便理解 Agent 的决策依据。

#### 验收标准

1. WHEN 收到 `event:agent { stream:"thinking", delta:"..." }`，THE EventHandler SHALL 将 delta 内容追加到对应会话的推理缓存
2. WHEN MsgAgent 有推理内容，THE MsgAgent SHALL 在消息气泡上方渲染可折叠的 reasoning-block 组件
3. THE reasoning-block SHALL 默认折叠，展开后以深色终端样式（背景 #1e293b，绿色字体）显示推理文本
4. WHEN 推理内容仍在流式接收中，THE reasoning-block SHALL 显示旋转 Loading 图标

---

### 需求 9：子 Agent 挂起确认（第三期，Prompt Engineering 方案）

**用户故事：** 作为会话发起者，我希望在 Agent 启动子 Agent 前收到确认请求，以便控制子 Agent 的启动。

#### 验收标准

1. WHEN 收到含 `[SPAWN_CONFIRM]` 标记的 chat 消息，THE EventHandler SHALL 调用 `tryParseSpawnConfirm` 解析 `agentName` 和 `task` 字段
2. WHEN `tryParseSpawnConfirm` 解析成功，THE EventHandler SHALL 将解析结果添加到 AppStore 的 `pendingSpawnConfirms` 队列，并渲染 SpawnConfirmCard 组件
3. WHEN 消息不含 `[SPAWN_CONFIRM]` 标记，THE EventHandler SHALL 返回 `null` 并按普通消息处理
4. WHEN 用户点击 SpawnConfirmCard 的"确认"按钮，THE System SHALL 调用 `chat.send { message: "confirm" }`
5. WHEN 用户点击 SpawnConfirmCard 的"取消"按钮，THE System SHALL 调用 `chat.send { message: "cancel" }`

---

### 需求 10：全局状态管理

**用户故事：** 作为开发者，我希望有一个响应式的全局状态管理机制，以便所有组件能够实时响应状态变化。

#### 验收标准

1. THE AppStore SHALL 以单例模式存在，`AppStore.instance` 的多次调用 SHALL 返回同一对象实例
2. WHEN AppStore 的任意状态方法（`setSessions`、`setActiveSession`、`appendMessage`、`addApproval`、`resolveApproval`）被调用，THE AppStore SHALL 调用所有已注册 ReactiveControllerHost 的 `requestUpdate` 方法
3. WHEN AppStoreController 的 `hostConnected` 被调用，THE AppStoreController SHALL 将 host 注册到 AppStore
4. WHEN AppStoreController 的 `hostDisconnected` 被调用，THE AppStoreController SHALL 将 host 从 AppStore 注销
5. WHEN `setActiveSession(key)` 被调用，THE AppStore SHALL 将 `activeSessionId` 更新为传入的 `key`
6. WHEN `appendMessage(sessionKey, msg)` 被调用，THE AppStore SHALL 将 `msg` 追加到 `messagesBySession.get(sessionKey)` 数组末尾
7. WHEN `resolveApproval(id)` 被调用，THE AppStore SHALL 从 `pendingApprovals` 中移除所有 `id` 匹配的审批请求

---

### 需求 11：会话状态映射

**用户故事：** 作为用户，我希望会话状态以直观的颜色标签展示，以便快速了解会话运行情况。

#### 验收标准

1. WHEN 会话 `status` 为 `"failed"` 或 `"killed"`，THE System SHALL 将 UI Tag type 映射为 `"danger"`
2. WHEN 会话 `status` 为 `"timeout"`，THE System SHALL 将 UI Tag type 映射为 `"warning"`
3. WHEN 会话 `status` 为 `"done"`，THE System SHALL 将 UI Tag type 映射为 `"success"`
4. WHEN 会话 `status` 为 `"running"` 或 `undefined`，THE System SHALL 将 UI Tag type 映射为 `"info"`

---

### 需求 12：构建与质量门控

**用户故事：** 作为开发者，我希望有明确的构建和质量检查流程，以便保证代码质量。

#### 验收标准

1. THE System SHALL 在提交前通过 `pnpm check`（lint/format/type 检查）
2. THE System SHALL 在推送前通过 `pnpm test`（Vitest 单元测试）
3. THE System SHALL 不引入 Vue、React、Element Plus 等非约定依赖
4. THE System SHALL 对与 gateway/ui 可能重名的类型使用 `Mas` 前缀（如 `MasSession`、`MasParticipant`）

---

## 正确性属性

_属性是在系统所有有效执行中应保持为真的特征或行为——本质上是关于系统应做什么的形式化陈述。属性是人类可读规范与机器可验证正确性保证之间的桥梁。_

### 属性 1：sessionKey 格式正确性

_对于任意_ 会话标签和 agentId，`SessionManager.createSession` 生成的 sessionKey 应包含 `:group:` 子串，且符合 `agent:{agentId}:group:mas-{uuid}` 格式

**验证：需求 3.2**

---

### 属性 2：加入会话的 masType

_对于任意_ 有效的 sessionKey，`SessionManager.joinSession` 返回的 MasSession 的 `masType` 应为 `"participated"`

**验证：需求 3.3**

---

### 属性 3：消息前缀 round-trip

_对于任意_ 长度在 1-40 字符之间、不含冒号和换行的发送者名，以及任意非空消息正文，`parseSenderPrefix(buildGroupMessage(name, text))` 应返回 `{ senderLabel: name, cleanText: text }`

**验证：需求 5.3**

---

### 属性 4：无前缀消息解析

_对于任意_ 不符合 `"{名称}: {正文}"` 格式的字符串，`parseSenderPrefix` 应返回 `{ senderLabel: null, cleanText: 原始字符串 }`

**验证：需求 5.4**

---

### 属性 5：空白消息被拒绝

_对于任意_ 仅由空白字符（空格、制表符、换行等）组成的字符串，ChatView 的发送逻辑应拒绝发送，消息列表长度保持不变

**验证：需求 4.3**

---

### 属性 6：流式消息追加

_对于任意_ sessionKey 和 delta 消息，收到 `state:"delta"` 后，`messagesBySession.get(sessionKey)` 的长度应增加 1 或最后一条消息的内容应被更新（同 id 时追加内容）

**验证：需求 4.6**

---

### 属性 7：审批队列增长

_对于任意_ ApprovalRequest，调用 `AppStore.addApproval(req)` 后，`pendingApprovals` 应包含该请求，且长度增加 1

**验证：需求 7.1**

---

### 属性 8：审批队列移除

_对于任意_ 已存在于 `pendingApprovals` 的审批 id，调用 `AppStore.resolveApproval(id)` 后，`pendingApprovals` 中不应再包含该 id 的任何审批请求

**验证：需求 7.2、需求 10.7**

---

### 属性 9：AppStore 单例

_对于任意_ 次数的 `AppStore.instance` 调用，所有调用应返回同一个对象引用（`===` 相等）

**验证：需求 10.1**

---

### 属性 10：响应式通知覆盖

_对于任意_ 已注册的 ReactiveControllerHost 集合，调用 AppStore 的任意状态变更方法后，所有已注册 host 的 `requestUpdate` 应被调用至少一次

**验证：需求 10.2**

---

### 属性 11：会话状态映射完备性

_对于任意_ `SessionRunStatus` 值（`"running"` | `"done"` | `"failed"` | `"killed"` | `"timeout"` | `undefined`），`resolveStatusType` 应返回 `"danger"` | `"warning"` | `"success"` | `"info"` 之一，不应抛出异常或返回其他值

**验证：需求 11.1、11.2、11.3、11.4**

---

### 属性 12：[SPAWN_CONFIRM] 解析 round-trip

_对于任意_ agentName 和 task 字符串，若消息文本符合约定格式（含 `[SPAWN_CONFIRM]` 标记），`tryParseSpawnConfirm` 应正确提取 `agentName` 和 `task`，且对不含该标记的任意字符串应返回 `null`

**验证：需求 9.1、9.3**

---

### 属性 13：导航切换控制 SessionSidebar 可见性

_对于任意_ 导航项，当且仅当 `activeNav === "workspace"` 时，SessionSidebar 应在 DOM 中存在；切换到其他导航项后，SessionSidebar 应从 DOM 中移除

**验证：需求 2.3、2.4**
