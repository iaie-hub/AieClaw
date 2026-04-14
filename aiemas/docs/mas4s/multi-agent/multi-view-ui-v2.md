### 多Agent聊天视图UI/UX优化方案

#### 一、核心设计原则

1. **输入框绝对可见**：任何分辨率下固定于可视区底部。
2. **垂直空间高效利用**：拓扑关系默认精简，详情浮层展示。
3. **会话上下文物理隔离**：主/子Agent会话通过右侧抽屉并行展示，避免消息流混淆。
4. **新增—事件驱动视图**：子Agent有新消息时可自动唤起抽屉或给予明确感知，支持用户配置通知行为。

#### 二、全局布局结构（不变基础 + 抽屉扩展插槽）

采用 `100dvh` Flex 视口分区，并预留子Agent抽屉插槽。

```html
<div class="app-layout" style="display: flex; flex-direction: column; height: 100dvh;">
  <!-- 1. 紧凑拓扑栏 -->
  <header class="topology-bar" style="flex-shrink: 0;">...</header>

  <!-- 2. 主体弹性区域 -->
  <div class="main-row" style="display: flex; flex: 1; min-height: 0;">
    <!-- 侧边栏（会话列表等） -->
    <aside class="sidebar" style="width: 260px;">...</aside>

    <!-- 聊天工作台（包含主聊天区 + 抽屉容器） -->
    <div class="chat-workspace" style="display: flex; flex: 1; min-width: 0;">
      <!-- 主Agent聊天区（永远存在） -->
      <section
        class="primary-chat"
        style="flex: 1; display: flex; flex-direction: column; min-width: 0;"
      >
        <div class="message-list" style="flex: 1; overflow-y: auto; min-height: 0;">
          <!-- 主Agent消息流 -->
        </div>
        <div class="input-area" style="flex-shrink: 0;">...</div>
      </section>

      <!-- 子Agent抽屉容器（动态宽度） -->
      <aside
        class="sub-agent-drawer"
        :style="{ width: drawerWidth }"
        style="overflow: hidden; transition: width 0.25s ease; display: flex; flex-direction: column; border-left: 1px solid #eee;"
      >
        <!-- 抽屉内部内容由子Agent组件渲染，保留插槽 -->
        <div
          v-if="activeSubAgent"
          class="drawer-content"
          style="width: 360px; height: 100%; display: flex; flex-direction: column;"
        >
          <!-- 包含：头部（名称/关闭/设置）、消息列表、输入框 -->
        </div>
      </aside>
    </div>
  </div>
</div>
```

**关键CSS规则（必须遵守）：**

- `.message-list` 设置 `min-height: 0` 防止内容撑破 Flex 容器。
- 抽屉容器使用 `width` 过渡动画，展开时 `width` 设为 `360px`（桌面）或 `85vw`（移动），关闭时为 `0`。
- 移动端适配 `100dvh` 与 `env(safe-area-inset-bottom)`。

#### 三、顶部拓扑栏设计（含未读聚合提示）

**3.1 默认精简状态条**

```
[主Agent: iaas-11]  ⇢  [IaaS Orchestrator]  ⇢  [3个子Agent]  ▼
```

右侧箭头切换浮层。

**3.2 演进增强：聚合未读提示**
当任一子Agent有新消息时：

- 拓扑条右侧出现红点徽章或数字角标。
- 点击展开浮层后，有未读的子Agent节点高亮（橙色圆点）。

**3.3 拓扑浮层内容**

- 使用 `position: absolute` 弹出，不挤压布局高度。
- 每个子Agent节点显示：名称、状态、未读计数（如有）。
- 节点支持点击，触发打开抽屉并定位至该子Agent。

#### 四、子Agent抽屉与自动展示演进设计

##### 4.1 抽屉组件状态定义

```typescript
interface SubAgentDrawerState {
  activeSubAgentId: string | null; // 当前展示的子Agent ID
  isOpen: boolean; // 抽屉是否展开
  subAgentMessages: Map<string, Message[]>; // 各子Agent消息缓存
  unreadCounts: Map<string, number>; // 各子Agent未读计数
  autoOpenMode: "immediate" | "badge-only" | "off"; // 用户偏好设置
}
```

##### 4.2 自动展示行为定义（演进核心）

当后端推送“子Agent新消息”事件时，系统根据用户设置和当前界面状态执行不同策略：

| 场景                                       | 自动展示行为                                                                                   |
| :----------------------------------------- | :--------------------------------------------------------------------------------------------- |
| **用户设置 `autoOpenMode = 'immediate'`**  | 抽屉自动展开，切换到该子Agent视图，并滚动至新消息。若抽屉已打开但显示其他子Agent，则切换内容。 |
| **用户设置 `autoOpenMode = 'badge-only'`** | 不自动展开抽屉，仅在拓扑栏显示未读角标，并在子Agent节点上标记未读数。                          |
| **用户正与主Agent进行输入交互时**          | 延迟自动展开，待用户停止输入3秒后再执行，避免打断操作。                                        |
| **屏幕宽度 < 768px（小屏模式）**           | 自动展示改为弹出 `Toast` 提示：“[子Agent名] 有新回复，点击查看”，保留用户当前视图。            |
| **抽屉已关闭且无用户活跃操作**             | 遵循 `autoOpenMode` 设置执行。                                                                 |

**用户偏好设置入口**：

- 在子Agent抽屉顶部菜单中提供“通知设置”图标，可选择：`即时展开`、`仅角标提示`、`关闭通知`。

##### 4.3 抽屉内部组件结构（确保独立消息能力）

```html
<div class="drawer-header">
  <span class="agent-name">{{ activeSubAgent.name }}</span>
  <span v-if="unreadCount > 0" class="unread-badge">{{ unreadCount }}</span>
  <button @click="closeDrawer">✕</button>
  <button @click="openNotificationSettings">⚙️</button>
</div>

<div class="drawer-message-list" style="flex: 1; overflow-y: auto;" ref="messageList">
  <!-- 消息渲染 -->
</div>

<div class="drawer-input-area">
  <textarea placeholder="回复 {{ activeSubAgent.name }}..."></textarea>
</div>
```

- 抽屉打开时，自动标记该子Agent消息为已读（清空未读计数）。
- 若用户通过抽屉内输入框发送消息，也视为已读。

##### 4.4 与主Agent消息流的联动

- 主Agent消息流中，来自子Agent的回复会以 **卡片形式** 嵌入显示，卡片上提供“在抽屉中打开”按钮。
- 点击该按钮行为等同于从拓扑节点打开抽屉。

#### 五、状态管理与事件流设计

**5.1 核心事件**

| 事件名                  | 载荷                   | 触发者                 |
| :---------------------- | :--------------------- | :--------------------- |
| `sub-agent:new-message` | `{ agentId, message }` | WebSocket/后端推送     |
| `sub-agent:view`        | `{ agentId }`          | 用户点击节点/卡片按钮  |
| `drawer:close`          | -                      | 用户点击关闭或外部区域 |
| `unread:clear`          | `{ agentId }`          | 抽屉打开或用户标记已读 |

**5.2 消息流处理伪代码**

```javascript
onSubAgentNewMessage(agentId, message) {
  // 1. 存储消息
  store.commit('addSubAgentMessage', { agentId, message });

  // 2. 若当前抽屉展示的正是该Agent，直接追加并滚动到底部
  if (state.activeSubAgentId === agentId && state.isOpen) {
    scrollToBottom();
    return;
  }

  // 3. 未打开或展示其他Agent：累加未读数
  store.commit('incrementUnread', agentId);

  // 4. 根据用户偏好决定是否自动打开抽屉
  if (userSettings.autoOpenMode === 'immediate') {
    // 延迟策略：检查主输入框聚焦状态
    if (!isUserTypingInPrimary) {
      openDrawer(agentId);
    } else {
      // 等待空闲后打开
      scheduleOpenWhenIdle(agentId);
    }
  }
}
```

#### 六、响应式与移动端适配细则

| 屏幕条件              | 抽屉处理策略                       | 自动展示策略                      |
| :-------------------- | :--------------------------------- | :-------------------------------- |
| 宽度 ≥ 1024px         | 侧边栏常驻，抽屉展开宽度360px      | 正常执行即时展开或角标            |
| 768px ≤ 宽度 < 1024px | 侧边栏折叠为图标，抽屉宽度300px    | 正常执行                          |
| 宽度 < 768px          | 抽屉不适用侧边模式，改为全屏模态页 | 自动展示改为非侵入式 `Toast` 提示 |
| 高度 < 700px          | 拓扑栏强制保持折叠                 | 无影响                            |

**移动端全屏子会话页实现**：

- 点击子Agent入口时，路由进入 `/sub-agent/:id` 视图。
- 该视图顶部包含返回按钮，底部独立输入框。
- 新消息到达时，若在当前页面则直接展示，否则通过全局通知栏提醒。

#### 七、实施检查清单（包含演进能力）

- [ ] 全局布局使用 `100dvh` Flex，消息列表 `min-height:0`。
- [ ] 拓扑浮层绝对定位，不挤占高度。
- [ ] 子Agent抽屉状态管理独立，支持宽度过渡动画。
- [ ] 实现 `sub-agent:new-message` 事件监听与未读计数逻辑。
- [ ] 提供用户偏好设置（即时展开 / 仅角标）。
- [ ] 检测主输入框聚焦状态，实现延迟自动展开。
- [ ] 移动端全屏子会话页面与抽屉模式共存，按宽度切换。
- [ ] 测试小屏下输入框、键盘弹起、自动展示均符合预期。
