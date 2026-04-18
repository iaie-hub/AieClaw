# 实现计划：拓扑布局切换器（Topology Layout Switcher）

## 概述

将拓扑布局切换功能分解为增量式编码任务。从类型定义和纯函数开始，逐步扩展到组件修改和集成联调。每个子 Agent 窗口复用 `sub-agent-drawer` 组件，通过 `hideClose` 属性控制多窗口模式下隐藏关闭按钮。

## 任务

- [x] 1. 创建布局模式类型定义和纯函数
  - [x] 1.1 创建 `src/types/layout-types.ts`，定义 `LayoutMode`、`LayoutOption`、`GridLayoutResult` 类型
    - 定义 `LayoutMode = "single" | "grid-2x2" | "three-column" | "left-main" | "top-bottom"`
    - 定义 `LayoutOption` 接口（mode、label、icon 字段）
    - 定义 `GridLayoutResult` 接口（gridTemplateColumns、gridTemplateRows、slots 数组）
    - _需求: 3.1_

  - [x] 1.2 创建 `src/utils/layout-utils.ts`，实现 `computeGridDimensions`、`computeGridLayout`、`resolveEffectiveLayout` 三个纯函数
    - `computeGridDimensions(totalAgents)`: 根据 agent 总数计算网格行列数（2→1×2, 3→2×2, 4→2×2, 5-6→2×3, >6→ceil(sqrt(N))）
    - `computeGridLayout(layoutMode, rootAgentId, subAgentIds)`: 根据布局模式和 agent 列表计算 CSS Grid 参数和窗口分配
    - `resolveEffectiveLayout(userChoice, viewportWidth)`: 响应式降级逻辑（<768→single, 768-1023+grid-2x2→left-main, 其余保持原选择）
    - _需求: 3.1, 5.1-5.9, 6.1-6.4, 7.1-7.5, 8.1-8.5, 11.1, 11.3, 11.4_

  - [x] 1.3 编写属性测试：网格维度充分性
    - **Property 1: 网格维度充分性**
    - **验证: 需求 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.9**
    - 测试文件: `src/utils/layout-utils.property.test.ts`
    - 对任意 agent 总数 N (1-20)，`computeGridDimensions(N)` 返回的 `cols × rows ≥ N`，且空余窗口数 `< cols`

  - [x] 1.4 编写属性测试：窗口分配正确性
    - **Property 2: 窗口分配正确性**
    - **验证: 需求 5.7, 5.8, 5.9, 6.2, 6.3, 6.4, 7.2, 7.3, 7.5, 8.2, 8.3, 8.5, 9.1**
    - 测试文件: `src/utils/layout-utils.property.test.ts`
    - 对任意多窗口布局模式和 agent 列表，slots[0] 为 root 且后续 sub slot 与 subAgentIds 一一对应

  - [x] 1.5 编写属性测试：全列布局列数等于 Agent 总数
    - **Property 3: 全列布局列数等于 Agent 总数**
    - **验证: 需求 6.1**
    - 测试文件: `src/utils/layout-utils.property.test.ts`
    - 对任意 rootAgentId 和 subAgentIds，three-column 模式的列数等于 `1 + subAgentIds.length`

  - [x] 1.6 编写属性测试：响应式布局降级
    - **Property 4: 响应式布局降级**
    - **验证: 需求 11.1, 11.3, 11.4**
    - 测试文件: `src/utils/layout-utils.property.test.ts`
    - 对任意 LayoutMode 和视口宽度，验证四条降级规则

- [x] 2. 检查点 — 确保所有测试通过
  - 确保所有测试通过，如有疑问请询问用户。

- [x] 3. 扩展 `sub-agent-drawer` 组件，添加 `hideClose` 属性
  - [x] 3.1 在 `src/components/sub-agent-drawer.ts` 中新增 `@property({ type: Boolean }) hideClose = false`
    - 当 `hideClose === true` 时，不渲染关闭按钮（`✕`）
    - 其余功能（消息列表、输入框、审批卡片、通知设置）保持不变
    - _需求: 9.3, 9.4_

  - [x] 3.2 编写单元测试验证 `hideClose` 属性行为
    - 测试文件: `src/components/sub-agent-drawer.test.ts`
    - 验证 `hideClose=false` 时关闭按钮可见，`hideClose=true` 时关闭按钮不渲染
    - _需求: 9.4_

- [x] 4. 扩展 `topology-bar` 组件，添加布局切换按钮
  - [x] 4.1 在 `src/components/topology-bar.ts` 中新增 `layoutMode` 和 `layoutDisabled` 属性
    - 新增 `@property({ type: String }) layoutMode: LayoutMode = "single"`
    - 新增 `@property({ type: Boolean }) layoutDisabled = false`
    - _需求: 1.1_

  - [x] 4.2 在 `.bar` 容器的子 Agent 卡片区域右侧渲染 Layout_Button
    - 使用田字格风格 SVG 图标
    - 添加 `role="button"`、`tabindex="0"`、`aria-label="布局切换"` 无障碍属性
    - 添加 `cursor: pointer` 和 hover 视觉反馈样式
    - 点击时派发 `layout-toggle` 自定义事件（bubbles + composed）
    - 支持 Enter/Space 键盘触发
    - `layoutDisabled` 为 true 时显示禁用样式
    - _需求: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [x] 4.3 编写单元测试验证 Layout_Button 渲染和事件派发
    - 测试文件: `src/components/topology-bar.test.ts`
    - 验证按钮 DOM 属性、事件派发、键盘触发、禁用状态
    - _需求: 1.1-1.6_

- [x] 5. 扩展 `main-workspace` 组件，实现布局面板和布局模式管理
  - [x] 5.1 在 `src/components/main-workspace.ts` 中新增布局相关状态
    - 新增 `_layoutMode`、`_layoutPanelOpen`、`_userLayoutChoice` 状态
    - 新增 `_onLayoutToggle()`、`_onLayoutChange()`、`_onClickOutsidePanel()` 事件处理方法
    - 导入 `LayoutMode` 类型和 `computeGridLayout`、`resolveEffectiveLayout` 函数
    - _需求: 3.1, 3.2, 3.3_

  - [x] 5.2 实现布局选择面板（Layout_Panel）的内联渲染
    - 以 popover 浮层形式渲染在 Layout_Button 下方
    - 展示五种布局样式 SVG 图标（Single、Grid_2x2、Three_Column、Left_Main、Top_Bottom）
    - 高亮当前激活的布局模式图标
    - 磨砂玻璃质感样式（`backdrop-filter: blur(8px)`），与 Topology_Bar 设计语言一致
    - 点击图标派发 `layout-change` 事件，点击外部区域关闭面板
    - _需求: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

  - [x] 5.3 实现 `layoutMode` 与 `viewMode` 的同步逻辑
    - `layoutMode` 默认值为 `"single"`
    - 接收 `layout-change` 事件时更新 `layoutMode`
    - `layoutMode !== "single"` 时同步设置 `viewMode = "multi"`
    - `layoutMode === "single"` 时同步设置 `viewMode = "single"`
    - _需求: 3.2, 3.3, 3.4, 3.5_

  - [x] 5.4 编写属性测试：非 Single 模式同步 viewMode
    - **Property 5: 非 Single 模式同步 viewMode**
    - **验证: 需求 3.5**
    - 测试文件: `src/components/main-workspace.property.test.ts`
    - 对任意非 single 的 LayoutMode，验证 viewMode 同步为 "multi"；single 时为 "single"

- [x] 6. 检查点 — 确保所有测试通过
  - 确保所有测试通过，如有疑问请询问用户。

- [x] 7. 实现多窗口布局渲染
  - [x] 7.1 实现 Single 模式下保持现有抽屉覆盖层行为
    - `layoutMode === "single"` 时保持现有的 chat-workspace 渲染逻辑不变
    - 主聊天区占满，子 Agent 通过右侧抽屉覆盖层展开
    - _需求: 4.1, 4.2, 4.3, 4.4, 4.5_

  - [x] 7.2 实现 Grid_2x2 动态网格布局渲染
    - 使用 `computeGridLayout("grid-2x2", ...)` 计算 Grid 参数
    - 在 chat-workspace 中渲染 CSS Grid 布局
    - 第一个窗口放置 `chat-view`（Root Agent），后续窗口放置 `sub-agent-drawer` 实例
    - 每个 `sub-agent-drawer` 传入正确的 `activeAgentId`、`messages`、`agents`、`isOpen=true`、`hideClose=true` 等属性
    - 空余窗口显示占位提示
    - _需求: 5.1-5.9, 9.1, 9.2, 9.3, 9.4_

  - [x] 7.3 实现 Three_Column 全列布局渲染
    - N 列等宽 CSS Grid，N = agent 总数
    - Root Agent 在第一列，子 Agent 按顺序在后续列
    - 子 Agent 数量为 0 时仅显示 Root Agent 占满整行
    - _需求: 6.1, 6.2, 6.3, 6.4_

  - [x] 7.4 实现 Left_Main 左主右副布局渲染
    - 左侧 60% 放置 Root Agent 的 Chat_View，右侧 40% 子 Agent 按行垂直堆叠
    - 右侧区域提供垂直滚动能力
    - 子 Agent 数量为 0 时右侧显示占位提示
    - _需求: 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 7.5 实现 Top_Bottom 上主下副布局渲染
    - 上方 50% 放置 Root Agent 的 Chat_View，下方 50% 子 Agent 按列水平排列
    - 下方区域提供水平滚动能力
    - 子 Agent 数量为 0 时下方显示占位提示
    - _需求: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x] 7.6 实现多窗口模式下 `drawer-send-message` 事件转发
    - 每个 `sub-agent-drawer` 实例的 `drawer-send-message` 事件正确转发给父组件
    - _需求: 9.5_

- [x] 8. 实现布局模式与抽屉模式的互斥切换
  - [x] 8.1 实现切换到多窗口模式时关闭抽屉覆盖层
    - `layoutMode` 从 `"single"` 切换为多窗口模式时，关闭当前打开的抽屉
    - 多窗口模式下禁止抽屉覆盖层展开
    - _需求: 10.1, 10.2_

  - [x] 8.2 实现多窗口模式下点击拓扑卡片的高亮/滚动行为
    - 多窗口模式下点击 Topology_Bar 上的子 Agent 卡片时，高亮或滚动到对应窗口
    - _需求: 10.3_

  - [x] 8.3 实现切换回 Single 模式时恢复抽屉行为
    - `layoutMode` 从多窗口模式切换回 `"single"` 时，恢复抽屉覆盖层的正常展开/关闭行为
    - _需求: 10.4_

- [x] 9. 实现响应式适配
  - [x] 9.1 实现小屏强制 Single 模式和按钮禁用
    - 使用 `ResizeObserver` + debounce 监听视口变化
    - 视口宽度 < 768px 时强制 `"single"` 模式，Layout_Button 禁用
    - 视口宽度恢复 ≥ 768px 时恢复用户之前选择的布局模式
    - _需求: 11.1, 11.2, 11.3_

  - [x] 9.2 实现中屏 Grid_2x2 降级为 Left_Main
    - 视口宽度 768px-1023px 时，Grid_2x2 自动降级为 Left_Main
    - 调用 `resolveEffectiveLayout()` 统一处理降级逻辑
    - _需求: 11.4_

- [x] 10. 扩展 AppStore，添加布局模式持久化
  - [x] 10.1 在 `src/store/app-store.ts` 中新增 `layoutModeBySession` Map 和相关方法
    - 新增 `layoutModeBySession: Map<string, LayoutMode>`
    - 新增 `setLayoutMode(sessionUuid, mode)` 和 `getLayoutMode(sessionUuid)` 方法
    - 默认返回 `"single"`
    - _需求: 3.1, 3.2_

- [x] 11. 集成联调与事件连线
  - [x] 11.1 在 `main-workspace` 中将 `layoutMode` 传递给 `topology-bar`
    - 传递 `layoutMode` 和 `layoutDisabled` 属性
    - 监听 `layout-toggle` 事件触发面板展开/收起
    - _需求: 1.1, 2.1, 2.2_

  - [x] 11.2 连线 `layout-change` 事件到 AppStore 持久化
    - 布局模式变更时同步写入 AppStore
    - 会话切换时从 AppStore 读取恢复布局模式
    - _需求: 3.3_

  - [x] 11.3 编写集成测试验证完整布局切换流程
    - 测试 single → grid-2x2 → three-column → left-main → top-bottom → single 完整流程
    - 验证多窗口模式下子 Agent 消息收发
    - _需求: 2.5, 3.3, 9.1, 9.2, 9.5, 10.1, 10.4_

- [x] 12. 最终检查点 — 确保所有测试通过
  - 确保所有测试通过，如有疑问请询问用户。

## 备注

- 标记 `*` 的任务为可选任务，可跳过以加速 MVP 交付
- 每个任务引用了具体的需求编号，确保可追溯性
- 检查点确保增量验证
- 属性测试验证通用正确性属性（纯函数 + 组件状态）
- 单元测试验证具体示例和边界情况
- 子 Agent 窗口务必复用 `sub-agent-drawer` 组件，通过 `hideClose` 属性控制多窗口模式下隐藏关闭按钮
