# 需求文档：拓扑布局切换器（Topology Layout Switcher）

## 简介

在拓扑状态条（topology-bar）右侧添加布局切换按钮，点击后展开布局样式选择面板，支持用户在多种多窗口布局模式之间切换。根 Agent（Orchestrator）占据主窗口，子 Agent 复用 `sub-agent-drawer` 组件分布在其它窗口中，实现多 Agent 对话区域的并行可视化。

## 术语表

- **Topology_Bar**：拓扑状态条组件（`topology-bar.ts`），水平展示主 Agent 和子 Agent 节点卡片
- **Layout_Switcher**：布局切换器，包含布局按钮和布局选择面板的整体功能模块
- **Layout_Button**：布局切换按钮，位于 Topology_Bar 右侧，点击触发布局选择面板的展开/收起
- **Layout_Panel**：布局选择面板，展示可选的布局样式图标供用户选择
- **Layout_Mode**：布局模式，描述对话区域的窗口排列方式，包含 single（单视图）和多种 multi 子模式
- **Main_Workspace**：主工作区组件（`main-workspace.ts`），组合 header、topology-bar、chat-view、sub-agent-drawer
- **Sub_Agent_Drawer**：子 Agent 抽屉面板组件（`sub-agent-drawer.ts`），包含独立消息列表、输入框、审批卡片、通知设置等完整功能
- **Chat_View**：聊天视图组件（`chat-view.ts`），主 Agent 的消息列表和输入区
- **Root_Agent**：根 Agent（Orchestrator），在多窗口布局中占据第1个窗口
- **Single**：单窗口模式，主聊天区占满，子 Agent 通过右侧抽屉覆盖层展开，为默认布局模式
- **Grid_2x2**：动态网格布局，根据拓扑结构中的 agent 数量（1个根 agent + N个子 agent）自动计算行列数
- **Three_Column**：全列布局，所有 agent（根 + 子）窗口按列水平排列，列数等于 agent 总数
- **Left_Main**：左主右副布局，根 agent 的 Chat_View 在左侧，子 agent 在右侧按行垂直堆叠
- **Top_Bottom**：上主下副布局，根 agent 的 Chat_View 在上部，子 agent 在下部按列水平排列

## 需求

### 需求 1：布局切换按钮

**用户故事：** 作为用户，我希望在拓扑状态条右侧看到一个布局切换按钮，以便快速进入布局选择。

#### 验收标准

1. THE Topology_Bar SHALL 在子 Agent 卡片区域右侧渲染一个 Layout_Button
2. THE Layout_Button SHALL 使用田字格风格的 SVG 图标表示布局切换功能
3. WHEN 用户点击 Layout_Button，THE Topology_Bar SHALL 派发 `layout-toggle` 自定义事件（CustomEvent），事件通过 bubbles 和 composed 传播
4. THE Layout_Button SHALL 具备 `cursor: pointer` 样式和 hover 视觉反馈（背景色变化或边框高亮）
5. THE Layout_Button SHALL 具备 `role="button"`、`tabindex="0"` 和 `aria-label="布局切换"` 无障碍属性
6. WHEN 用户通过键盘按下 Enter 或 Space 键聚焦在 Layout_Button 上，THE Topology_Bar SHALL 派发与点击相同的 `layout-toggle` 事件

### 需求 2：布局选择面板

**用户故事：** 作为用户，我希望点击布局按钮后看到一个布局样式选择面板，以便从多种布局中选择适合的窗口排列方式。

#### 验收标准

1. WHEN `layout-toggle` 事件被触发且 Layout_Panel 处于关闭状态，THE Main_Workspace SHALL 展开 Layout_Panel
2. WHEN `layout-toggle` 事件被触发且 Layout_Panel 处于展开状态，THE Main_Workspace SHALL 关闭 Layout_Panel
3. THE Layout_Panel SHALL 以浮层（popover）形式渲染在 Layout_Button 下方，不遮挡 Topology_Bar 主体内容
4. THE Layout_Panel SHALL 展示五种布局样式图标：Single、Grid_2x2、Three_Column、Left_Main、Top_Bottom
5. WHEN 用户点击某个布局样式图标，THE Layout_Panel SHALL 派发 `layout-change` 自定义事件，事件 detail 包含所选 Layout_Mode 标识符
6. WHEN 用户点击 Layout_Panel 外部区域，THE Main_Workspace SHALL 关闭 Layout_Panel
7. THE Layout_Panel SHALL 高亮显示当前激活的 Layout_Mode 对应的图标
8. THE Layout_Panel SHALL 具备磨砂玻璃质感样式，与 Topology_Bar 的设计语言保持一致

### 需求 3：布局模式数据模型

**用户故事：** 作为开发者，我希望布局模式有清晰的类型定义和状态管理，以便各组件之间正确传递布局信息。

#### 验收标准

1. THE Main_Workspace SHALL 维护一个 `layoutMode` 属性，类型为 `"single" | "grid-2x2" | "three-column" | "left-main" | "top-bottom"`
2. THE Main_Workspace SHALL 将 `layoutMode` 默认值设为 `"single"`
3. WHEN `layout-change` 事件被接收，THE Main_Workspace SHALL 更新 `layoutMode` 为事件 detail 中指定的值
4. WHEN `layoutMode` 值为 `"single"`，THE Main_Workspace SHALL 保持现有的单视图布局行为（主聊天区占满，子 Agent 通过抽屉覆盖层展开）
5. WHEN `layoutMode` 值不为 `"single"`，THE Main_Workspace SHALL 将 `viewMode` 属性同步设为 `"multi"`

### 需求 4：Single 单窗口模式

**用户故事：** 作为用户，我希望在单窗口模式下，主聊天区占满整个工作区，子 Agent 通过右侧抽屉覆盖层展开，保持当前已有的交互体验。

#### 验收标准

1. THE Main_Workspace SHALL 将 `"single"` 作为 `layoutMode` 的默认值
2. WHEN `layoutMode` 为 `"single"`，THE Main_Workspace SHALL 将 Root_Agent 的 Chat_View 渲染为占满 chat-workspace 区域的全宽布局
3. WHEN `layoutMode` 为 `"single"` 且用户点击 Topology_Bar 上的子 Agent 卡片，THE Main_Workspace SHALL 以右侧抽屉覆盖层形式展开对应子 Agent 的 Sub_Agent_Drawer
4. WHILE `layoutMode` 为 `"single"`，THE Sub_Agent_Drawer SHALL 以浮层形式从右侧滑入，覆盖在 Chat_View 之上，宽度为 chat-workspace 的 70%（平板 60%，移动端 100%）
5. WHEN 用户点击抽屉遮罩或关闭按钮，THE Main_Workspace SHALL 关闭 Sub_Agent_Drawer 覆盖层

### 需求 5：Grid_2x2 动态网格布局

**用户故事：** 作为用户，我希望选择网格布局后，对话区域根据 agent 数量自动分为合适的网格窗口，以便同时查看所有 Agent 的对话。

#### 验收标准

1. WHEN `layoutMode` 为 `"grid-2x2"`，THE Main_Workspace SHALL 根据拓扑结构中的 agent 总数（1个 Root_Agent + N个子 Agent）动态计算网格的行数和列数
2. WHEN agent 总数为 2，THE Main_Workspace SHALL 将 chat-workspace 区域渲染为 1 行 × 2 列的 CSS Grid 布局
3. WHEN agent 总数为 3，THE Main_Workspace SHALL 将 chat-workspace 区域渲染为 1 行 × 3 列或 2 行 × 2 列的 CSS Grid 布局
4. WHEN agent 总数为 4，THE Main_Workspace SHALL 将 chat-workspace 区域渲染为 2 行 × 2 列的 CSS Grid 布局
5. WHEN agent 总数为 5 或 6，THE Main_Workspace SHALL 将 chat-workspace 区域渲染为 2 行 × 3 列的 CSS Grid 布局
6. WHEN agent 总数超过 6，THE Main_Workspace SHALL 按照 ceil(sqrt(N)) 列数自动计算行列数
7. THE Main_Workspace SHALL 将 Root_Agent 的 Chat_View 放置在 Grid_2x2 布局的第一个窗口（左上角）
8. THE Main_Workspace SHALL 将每个子 Agent 的 Sub_Agent_Drawer 实例按顺序放置在 Grid_2x2 布局的其余窗口中
9. IF 网格窗口数量大于 agent 总数，THEN THE Main_Workspace SHALL 在空余窗口中显示占位提示（如"暂无 Agent"）

### 需求 6：Three_Column 全列布局

**用户故事：** 作为用户，我希望选择全列布局后，所有 Agent（根 + 子）的窗口按列水平排列，以便并排查看所有 Agent 的对话。

#### 验收标准

1. WHEN `layoutMode` 为 `"three-column"`，THE Main_Workspace SHALL 将 chat-workspace 区域渲染为 N 列等宽的 CSS Grid 布局，其中 N 等于 agent 总数（1个 Root_Agent + 子 Agent 数量）
2. THE Main_Workspace SHALL 将 Root_Agent 的 Chat_View 放置在 Three_Column 布局的第一列
3. THE Main_Workspace SHALL 将每个子 Agent 的 Sub_Agent_Drawer 实例按顺序分别放置在 Three_Column 布局的后续各列中
4. IF 子 Agent 数量为 0，THEN THE Main_Workspace SHALL 仅显示 Root_Agent 的 Chat_View 占满整行

### 需求 7：Left_Main 左主右副布局

**用户故事：** 作为用户，我希望选择左主右副布局后，左侧为根 Agent 对话主窗口，右侧为所有子 Agent 按行垂直堆叠排列。

#### 验收标准

1. WHEN `layoutMode` 为 `"left-main"`，THE Main_Workspace SHALL 将 chat-workspace 区域渲染为左右两栏布局，左侧占比约 60%，右侧占比约 40%
2. THE Main_Workspace SHALL 将 Root_Agent 的 Chat_View 放置在 Left_Main 布局的左侧主窗口
3. THE Main_Workspace SHALL 将所有子 Agent 的 Sub_Agent_Drawer 实例在右侧区域按行垂直堆叠排列，每个子 Agent 占据等高的一行
4. WHILE 右侧子 Agent 数量超过可视区域容量，THE Main_Workspace SHALL 在右侧区域提供垂直滚动能力
5. IF 子 Agent 数量为 0，THEN THE Main_Workspace SHALL 在右侧窗口中显示占位提示

### 需求 8：Top_Bottom 上主下副布局

**用户故事：** 作为用户，我希望选择上主下副布局后，上部为根 Agent 对话主窗口，下部为所有子 Agent 按列水平排列。

#### 验收标准

1. WHEN `layoutMode` 为 `"top-bottom"`，THE Main_Workspace SHALL 将 chat-workspace 区域渲染为上下两行布局，上方占 50% 高度，下方占 50% 高度
2. THE Main_Workspace SHALL 将 Root_Agent 的 Chat_View 放置在 Top_Bottom 布局的上方窗口
3. THE Main_Workspace SHALL 将所有子 Agent 的 Sub_Agent_Drawer 实例在下方区域按列水平排列，每个子 Agent 占据等宽的一列
4. WHILE 下方子 Agent 数量超过可视区域容量，THE Main_Workspace SHALL 在下方区域提供水平滚动能力
5. IF 子 Agent 数量为 0，THEN THE Main_Workspace SHALL 在下方窗口中显示占位提示

### 需求 9：子 Agent 窗口复用 Sub_Agent_Drawer 组件

**用户故事：** 作为开发者，我希望多窗口布局中的子 Agent 窗口完整复用 Sub_Agent_Drawer 组件，以便保留消息列表、输入框、审批卡片、通知设置等全部功能。

#### 验收标准

1. THE Main_Workspace SHALL 在多窗口布局的每个子 Agent 窗口中渲染 `<sub-agent-drawer>` 组件实例
2. THE Main_Workspace SHALL 为每个 Sub_Agent_Drawer 实例传入正确的 `activeAgentId`、`messages`、`agents`、`pendingApprovals`、`resolvedApprovals`、`isInitiator`、`isActive`、`showToolMessages` 属性
3. WHILE 处于多窗口布局模式，THE Sub_Agent_Drawer SHALL 将 `isOpen` 属性设为 `true` 以保持内容始终可见
4. THE Sub_Agent_Drawer SHALL 在多窗口布局模式下隐藏关闭按钮（因为窗口不可单独关闭）
5. WHEN Sub_Agent_Drawer 派发 `drawer-send-message` 事件，THE Main_Workspace SHALL 将该事件正确转发给父组件

### 需求 10：布局模式与抽屉模式的互斥切换

**用户故事：** 作为用户，我希望切换到多窗口布局时自动关闭抽屉覆盖层，切换回单视图时恢复抽屉行为，以避免界面冲突。

#### 验收标准

1. WHEN `layoutMode` 从 `"single"` 切换为任意多窗口模式，THE Main_Workspace SHALL 关闭当前打开的抽屉覆盖层
2. WHILE `layoutMode` 不为 `"single"`，THE Main_Workspace SHALL 禁止抽屉覆盖层的展开操作
3. WHILE `layoutMode` 不为 `"single"`，WHEN 用户点击 Topology_Bar 上的子 Agent 卡片，THE Main_Workspace SHALL 将对应子 Agent 的窗口高亮或滚动到可见位置，而非打开抽屉
4. WHEN `layoutMode` 从多窗口模式切换回 `"single"`，THE Main_Workspace SHALL 恢复抽屉覆盖层的正常展开/关闭行为

### 需求 11：响应式适配

**用户故事：** 作为用户，我希望在小屏设备上多窗口布局能自动降级为单视图模式，以保证可用性。

#### 验收标准

1. WHILE 视口宽度小于 768px，THE Main_Workspace SHALL 强制使用 `"single"` 布局模式，忽略用户选择的多窗口布局
2. WHILE 视口宽度小于 768px，THE Layout_Button SHALL 处于禁用状态（`disabled`），并显示禁用样式
3. WHEN 视口宽度从小于 768px 变为大于等于 768px，THE Main_Workspace SHALL 恢复用户之前选择的 Layout_Mode
4. WHILE 视口宽度在 768px 至 1023px 之间，THE Main_Workspace SHALL 将 Grid_2x2 布局降级为 Left_Main 布局以保证每个窗口有足够的可读宽度
