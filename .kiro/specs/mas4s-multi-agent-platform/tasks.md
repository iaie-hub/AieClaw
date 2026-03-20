# 实现任务列表：mas4s 多智能体协作平台前端

## 第一期：多人会话基础 + 分享链接

---

- [-] 1. 项目脚手架与基础配置
  - [x] 1.1 在 `aiemas/ui/mas4s/` 创建 Vite 8 + TypeScript ESM 项目（`package.json`、`vite.config.ts`、`tsconfig.json`、`index.html`）
  - [ ] 1.2 安装依赖：`lit@^3`、`vite@^8`、`typescript`；开发依赖：`vitest`、`@vitest/coverage-v8`
  - [x] 1.3 配置 `vite.config.ts`：设置 `resolve.alias` 将 `../../ui/src/ui` 映射到正确路径，确保可复用 `GatewayBrowserClient`
  - [x] 1.4 创建 `src/styles/tokens.css`，写入设计文档中定义的全部 CSS 变量（色板、尺寸、阴影、头像渐变、气泡颜色）
  - [ ] 1.5 验证：`pnpm check` 通过（lint/format/type 无报错）

- [-] 2. 类型定义层
  - [x] 2.1 创建 `src/types/session-types.ts`：定义 `MasSession`（继承 `GatewaySessionRow`）、`MasParticipant`、`resolveStatusType` 函数
  - [x] 2.2 创建 `src/types/chat-types.ts`：定义 `ChatMessage`（继承 `NormalizedMessage`，追加 `subType` 字段）、重导出 `MessageContentItem`
  - [x] 2.3 创建 `src/types/approval-types.ts`：定义 `ApprovalRequest`、`ApprovalResolved`，字段与 gateway `exec.approval.*` payload 完全对齐
  - [x] 2.4 创建 `src/types/protocol-extensions.ts`：定义 `MasApprovalContext`、`MasProposal`、`MasProposalDiff`（预留，第三/四期使用）
  - [ ] 2.5 验证：`pnpm tsgo` 类型检查通过，无 `any` 类型

- [-] 3. 工具函数层
  - [x] 3.1 创建 `src/utils/message-format.ts`：实现 `buildGroupMessage(senderName, text)` 和 `parseSenderPrefix(text)`
  - [x] 3.2 为 `message-format.ts` 编写单元测试 `src/utils/message-format.test.ts`：
    - 属性 3（round-trip）：对任意合法发送者名和正文，`parseSenderPrefix(buildGroupMessage(name, text))` 返回原始值
    - 属性 4（无前缀解析）：不含前缀格式的字符串返回 `{ senderLabel: null, cleanText: 原始字符串 }`
    - 边界：发送者名含特殊字符（中文、数字）、正文含冒号、多行正文

- [-] 4. 全局状态管理（AppStore）
  - [x] 4.1 创建 `src/store/app-store.ts`：实现 `AppStore` 单例类，包含 `sessions`、`activeSessionId`、`messagesBySession`、`pendingApprovals`、`pendingSpawnConfirms` 字段及全部状态方法
  - [x] 4.2 在 `app-store.ts` 中实现 `AppStoreController`（`ReactiveController` 适配器）
  - [x] 4.3 为 `app-store.ts` 编写单元测试 `src/store/app-store.test.ts`：
    - 属性 9（单例）：多次 `AppStore.instance` 返回同一引用
    - 属性 7（审批队列增长）：`addApproval` 后 `pendingApprovals` 长度 +1
    - 属性 8（审批队列移除）：`resolveApproval(id)` 后队列中不含该 id
    - 属性 10（响应式通知）：状态变更后所有已注册 host 的 `requestUpdate` 被调用
    - 属性 6（消息追加）：`appendMessage` 后对应 sessionKey 的消息数组末尾含新消息

- [-] 5. Gateway 客户端封装
  - [x] 5.1 创建 `src/gateway/client.ts`：封装 `GatewayBrowserClient`，在 `connect` 时声明 `scopes: ["operator.admin", "operator.approvals"]` 和 `caps: ["tool-events"]`，导出 `getClient()` 单例获取函数
  - [x] 5.2 创建 `src/gateway/event-handler.ts`：实现 `registerEventHandlers(client)`，处理 `chat`、`agent`、`exec.approval.requested`、`exec.approval.resolved` 四类事件；实现 `tryParseSpawnConfirm(text)` 函数；实现内部 `updateChatStream` 辅助函数
  - [x] 5.3 为 `event-handler.ts` 编写单元测试 `src/gateway/event-handler.test.ts`：
    - 属性 12（SPAWN_CONFIRM 解析）：含标记的文本正确提取 agentName/task，不含标记返回 null
    - `updateChatStream`：delta 时追加/更新最后一条消息，final 时标记完成

- [-] 6. 会话管理模块
  - [x] 6.1 创建 `src/gateway/session-manager.ts`：实现 `createSession(client, opts)` 和 `joinSession(client, sessionKey)`
    - `createSession`：生成 `agent:{agentId}:group:mas-{uuid}` 格式 key，调用 `sessions.create`，返回 `masType="initiated"` 的 `MasSession`
    - `joinSession`：调用 `sessions.resolve` 验证存在性，再调用 `sessions.list` 获取完整 row，返回 `masType="participated"` 的 `MasSession`
  - [x] 6.2 为 `session-manager.ts` 编写单元测试 `src/gateway/session-manager.test.ts`：
    - 属性 1（sessionKey 格式）：生成的 key 包含 `:group:` 且符合正则 `/^agent:[^:]+:group:mas-[0-9a-f-]+$/`
    - 属性 2（masType）：`joinSession` 返回的 `masType` 为 `"participated"`
    - `sessions.resolve` 返回 `ok: false` 时抛出包含 sessionKey 的错误

- [-] 7. 会话分享链接模块
  - [x] 7.1 创建 `src/gateway/session-invite.ts`：实现 `buildInviteUrl(sessionKey)`、`parseInviteFromUrl()`、`parseInviteInput(input)`、`joinSession(client, sessionKey)`（与 session-manager 中的 joinSession 逻辑相同，此处为 invite 入口专用）
  - [x] 7.2 为 `session-invite.ts` 编写单元测试 `src/gateway/session-invite.test.ts`：
    - `buildInviteUrl` 生成的 URL 包含 `?join=` 参数，且 Base64 解码后等于原始 sessionKey
    - `parseInviteInput` 支持完整 URL 和裸 sessionKey 两种格式
    - `parseInviteInput` 对无效输入返回 `null`
    - `parseInviteFromUrl` 在无 `?join=` 参数时返回 `null`

- [-] 8. 基础 UI 组件
  - [x] 8.1 创建 `src/components/primary-sidebar.ts`：实现 `primary-sidebar` 组件，80px 宽，包含六个导航项（工作台、使用情况、智能体、Skills、定时任务、设置），激活态样式，`@nav-change` 事件
  - [x] 8.2 创建 `src/components/session-sidebar.ts`：实现 `session-sidebar` 组件，280px 宽，"发起的会话"和"参与的会话"两个分组，会话项点击触发 `@session-select`，"+"按钮下拉菜单触发 `@session-create` / `@session-join`，badge 显示逻辑
  - [x] 8.3 创建 `src/components/main-header.ts`：实现 `main-header` 组件，70px 高，左侧会话标题+状态 Tag+邀请按钮，右侧 Bell 角标+用户头像+用户名
  - [x] 8.4 创建 `src/components/notif-badge.ts`：实现 `notif-badge` 组件，Bell 图标+数字角标，`count=0` 时隐藏数字
  - [x] 8.5 创建 `src/components/main-workspace.ts`：实现 `main-workspace` 组件，组合 `main-header`、`chat-view`、`approval-drawer`，向上冒泡 `send-message` 和 `resolve-approval` 事件

- [-] 9. 消息渲染组件
  - [x] 9.1 创建 `src/views/msg-user.ts`：用户消息气泡，蓝紫渐变头像+气泡，右对齐，右上角圆角 4px
  - [x] 9.2 创建 `src/views/msg-colleague.ts`：同事消息气泡，琥珀渐变头像（姓氏首字）+白色气泡，左对齐，左上角圆角 4px
  - [x] 9.3 创建 `src/views/msg-agent.ts`：Agent 消息气泡，绿色渐变头像+白色气泡，左对齐，发送者名后附"Agent"小标签；第一期推理折叠块占位（空实现）
  - [x] 9.4 创建 `src/views/msg-pending.ts`：审批挂起卡片，红色渐变头像+"Awaiting HITL"标签，`pending-card` 样式，`isInitiator` 控制操作按钮可见性，`@resolve` 事件
  - [x] 9.5 创建 `src/views/message-list.ts`：根据 `ChatMessage.role` 和 `subType` 分发渲染 `msg-user`、`msg-colleague`、`msg-agent`、`msg-pending`
  - [x] 9.6 创建 `src/views/chat-view.ts`：聊天视图，消息列表+输入区，Enter 发送/Shift+Enter 换行，空白消息拦截，`@send-message` 事件，发送后清空输入框

- [x] 10. 分享链接 UI 组件
  - [x] 10.1 创建 `src/components/invite-dialog.ts`：显示分享链接、复制按钮（`navigator.clipboard.writeText`）、"已复制"2s 提示、会话 ID 展示
  - [x] 10.2 创建 `src/components/join-session-dialog.ts`：手动输入 sessionKey/链接，`parseInviteInput` 实时解析，错误提示，`@join` 事件
  - [x] 10.3 创建 `src/components/join-confirm-dialog.ts`：URL 参数自动触发的加入确认弹窗，显示会话 label/status，`@confirm` / `@cancel` 事件

- [x] 11. 根组件与应用入口
  - [x] 11.1 创建 `src/app.ts`：实现 `mas4s-app` 根组件，三栏布局（`primary-sidebar` + 条件显示 `session-sidebar` + `main-workspace`），`AppStoreController` 注入，`connectedCallback` 中调用 `parseInviteFromUrl()` 检测 `?join=` 参数并触发 `join-confirm-dialog`
  - [x] 11.2 在 `src/app.ts` 中实现 `_onSendMessage`：调用 `MessageFormatter.buildGroupMessage` 构造消息体，调用 `client.request("chat.send", ...)`
  - [x] 11.3 在 `src/app.ts` 中实现 `_onResolveApproval`：调用 `client.request("exec.approval.resolve", { id, decision })`
  - [x] 11.4 在 `src/app.ts` 中实现 `_onSessionCreate`：调用 `SessionManager.createSession`，将结果添加到 `AppStore.sessions`
  - [x] 11.5 在 `src/app.ts` 中实现 `_onSessionJoin`（手动输入入口）：调用 `SessionInvite.joinSession`，将结果添加到 `AppStore.sessions`
  - [x] 11.6 更新 `index.html`：引入 `src/app.ts`，挂载 `<mas4s-app>`

- [-] 12. 第一期集成验证
  - [x] 12.1 运行 `pnpm check`，确保 lint/format/type 全部通过
  - [ ] 12.2 运行 `pnpm test`，确保所有单元测试通过（覆盖率 ≥ 70% lines/branches/functions/statements）
  - [ ] 12.3 手动验证：发起新会话 → 发送消息 → 收到 Agent 回复 → 消息正确渲染
  - [ ] 12.4 手动验证：生成分享链接 → 复制 → 新标签页打开 → 自动弹出加入确认弹窗 → 确认后加入会话

---

## 第二期：Human-in-the-Loop 审批 + 透明化推理

---

- [ ] 13. 审批抽屉组件
  - [ ] 13.1 创建 `src/components/approval-drawer.ts`：渲染 `pendingApprovals` 列表，每项显示 `msg-pending` 卡片，向上冒泡 `@resolve` 事件
  - [ ] 13.2 完善 `src/views/msg-pending.ts`：实现完整的"批准执行"、"驳回"、"修改参数"按钮交互，`isInitiator=false` 时隐藏按钮
  - [ ] 13.3 验证属性 7（审批队列增长）和属性 8（审批队列移除）的集成行为

- [ ] 14. 透明化推理（reasoning-block）
  - [ ] 14.1 创建 `src/components/reasoning-block.ts`：可折叠推理块，默认折叠，展开后深色终端样式（背景 `#1e293b`，绿色字体），流式接收中显示旋转 Loading 图标
  - [ ] 14.2 更新 `src/gateway/event-handler.ts`：处理 `event:agent { stream:"thinking", delta }` 事件，将 delta 追加到 AppStore 的推理缓存（新增 `reasoningBySession: Map<string, string>`）
  - [ ] 14.3 更新 `src/views/msg-agent.ts`：当有推理内容时，在气泡上方渲染 `reasoning-block`

- [ ] 15. 跨会话 Bell 角标
  - [ ] 15.1 更新 `src/components/notif-badge.ts`：`count > 0` 时显示数字，`count === 0` 时隐藏
  - [ ] 15.2 更新 `src/components/main-header.ts`：将 `pendingApprovals.length` 传入 `notif-badge`

---

## 第三期：子 Agent 挂起确认（Prompt Engineering 方案）

---

- [ ] 16. SpawnConfirmCard 组件
  - [ ] 16.1 创建 `src/components/spawn-confirm-card.ts`：显示 agentName、task，"确认"/"取消"按钮，触发 `@spawn-confirm` / `@spawn-cancel` 事件
  - [ ] 16.2 更新 `src/gateway/event-handler.ts`：在 `chat` 事件处理中调用 `tryParseSpawnConfirm`，解析成功时将结果添加到 `AppStore.pendingSpawnConfirms`
  - [ ] 16.3 更新 `src/app.ts`：监听 `@spawn-confirm` 事件，调用 `chat.send { message: "confirm" }`；监听 `@spawn-cancel` 事件，调用 `chat.send { message: "cancel" }`

---

## 第四期：个性化方案 & Diff（预留）

---

- [ ]\* 17. MasProposal 提交与选择 UI（可选，第四期）
  - [ ]\* 17.1 实现 `src/views/proposal-view.ts`：渲染 Agent 输出的 `MasProposal` 结构化内容
  - [ ]\* 17.2 实现 `src/views/proposal-diff-view.ts`：纯前端 diff 计算（使用 `diff` 库），渲染 unified diff

---

## 第五期：使用情况 & 智能体管理（预留）

---

- [ ]\* 18. 使用情况视图（可选，第五期）
  - [ ]\* 18.1 创建 `src/views/usage-view.ts`：使用情况统计展示

- [ ]\* 19. 智能体管理视图（可选，第五期）
  - [ ]\* 19.1 创建 `src/views/agents-view.ts`：智能体列表与配置
