**AIEMAS UI** 色彩优化实施方案，所有内容均聚焦于色系替换，不涉及布局、DOM 结构或交互逻辑的改动。

---

## 🎯 实施目标

将现有界面配色升级为**科技平台风格**（冷灰基底 + 电光蓝主色 + 青绿点缀），整体视觉效果参考 Linear / Vercel / Slack 的现代 SaaS 产品调性。

## 📦 交付物清单

1. **全局 CSS 变量定义文件**（新增或覆盖）
2. **区域颜色映射表**（具体选择器与属性对照）
3. **实施步骤指令**
4. **视觉验证清单**

---

## 一、全局 CSS 变量定义

请将以下代码块**完整替换或追加**至项目的全局样式文件（如 `globals.css`、`variables.scss`、`:root` 选择器内）。

```css
:root {
  /* ===== 科技平台色系 v1.0 ===== */

  /* ---- 背景色系统 (冷灰基底) ---- */
  --tech-bg-app: #f5f7fa; /* 应用底板，轻微蓝调 */
  --tech-bg-sidebar: #edf1f7; /* 左侧最深底，用于一级导航与二级面板 */
  --tech-bg-card: #ffffff; /* 卡片与输入框背景 */
  --tech-bg-hover: rgba(37, 99, 235, 0.04); /* 统一悬停效果 (淡蓝) */
  --tech-bg-selected: #e9f0fd; /* 列表项选中背景 */

  /* ---- 文字色系统 (深石板蓝) ---- */
  --tech-text-primary: #1a2639; /* 主要文字 (标题、正文) */
  --tech-text-secondary: #4b5b73; /* 辅助文字 (时间戳、描述、图标) */
  --tech-text-tertiary: #8896a8; /* 占位符、禁用文字 */
  --tech-text-inverse: #ffffff; /* 深色背景反白字 */

  /* ---- 品牌与点缀色 ---- */
  --tech-primary: #1e6df2; /* 主蓝色 (按钮、选中态、链接) */
  --tech-primary-hover: #1557d0; /* 主蓝色悬停加深 */
  --tech-accent-cyan: #00b4d8; /* 青绿色 (在线状态、提示徽标) */
  --tech-accent-purple: #6c5ce7; /* 紫色点缀 (智能体标识) */

  /* ---- 边框与分割线 ---- */
  --tech-border-default: 1px solid rgba(26, 38, 57, 0.06);
  --tech-border-heavy: 1px solid rgba(26, 38, 57, 0.12);

  /* ---- 状态色 (降低饱和度) ---- */
  --tech-success: #10a861;
  --tech-warning: #f59e0b;
  --tech-danger: #ef4444;
}
```

---

## 二、区域颜色映射表（精确选择器参考）

请按照下表逐项修改对应 CSS 选择器的颜色属性。**若原选择器不存在，请新建对应类名并应用变量。**

| 界面区域                 | 需修改的属性       | 新值（CSS变量）                 | 参考选择器示例                                  |
| :----------------------- | :----------------- | :------------------------------ | :---------------------------------------------- |
| **全局应用底板**         | `background-color` | `var(--tech-bg-app)`            | `body, #root, .app-wrapper`                     |
| **一级导航栏 L1**        | `background-color` | `var(--tech-bg-sidebar)`        | `.primary-nav, .sidebar-l1`                     |
| 一级导航图标（默认）     | `color`            | `var(--tech-text-secondary)`    | `.nav-item .icon`                               |
| 一级导航图标（选中）     | `color`            | `var(--tech-primary)`           | `.nav-item.active .icon`                        |
| **二级会话面板 L2**      | `background-color` | `var(--tech-bg-sidebar)`        | `.session-sidebar, .sidebar-l2`                 |
| 会话列表项（默认）       | `color`            | `var(--tech-text-primary)`      | `.session-item`                                 |
| 会话列表项（悬停）       | `background-color` | `var(--tech-bg-hover)`          | `.session-item:hover`                           |
| 会话列表项（选中）       | `background-color` | `var(--tech-bg-selected)`       | `.session-item.active`                          |
| 会话列表项选中左侧指示条 | `border-left`      | `3px solid var(--tech-primary)` | `.session-item.active`                          |
| 会话标题文字             | `color`            | `var(--tech-text-primary)`      | `.session-item .session-name`                   |
| 会话预览/时间戳          | `color`            | `var(--tech-text-secondary)`    | `.session-item .session-preview, .session-time` |
| **顶部操作栏 Header**    | `background-color` | `var(--tech-bg-app)`            | `.app-header, .chat-header`                     |
| 顶部标题文字             | `color`            | `var(--tech-text-primary)`      | `.header-title`                                 |
| 顶部图标按钮             | `color`            | `var(--tech-text-secondary)`    | `.header-actions .icon-btn`                     |
| **主要按钮（如“发送”）** | `background-color` | `var(--tech-primary)`           | `.btn-primary`                                  |
| 主要按钮（悬停）         | `background-color` | `var(--tech-primary-hover)`     | `.btn-primary:hover`                            |
| **次要/幽灵按钮**        | `color`            | `var(--tech-text-secondary)`    | `.btn-ghost, .btn-secondary`                    |
| 次要按钮（悬停）         | `background-color` | `var(--tech-bg-hover)`          | `.btn-ghost:hover`                              |
| **输入框背景**           | `background-color` | `var(--tech-bg-card)`           | `input, textarea, .message-input`               |
| 输入框边框（默认）       | `border`           | `var(--tech-border-default)`    | `input, textarea`                               |
| 输入框边框（聚焦）       | `border-color`     | `var(--tech-primary)`           | `input:focus, textarea:focus`                   |
| **未读/运行中徽标**      | `background-color` | `var(--tech-accent-cyan)`       | `.badge, .status-dot`                           |
| 徽标文字                 | `color`            | `var(--tech-text-inverse)`      | `.badge`                                        |
| **智能体名称前缀图标**   | `color`            | `var(--tech-accent-purple)`     | `.agent-prefix, .bot-icon`                      |
| **在线状态点**           | `background-color` | `var(--tech-accent-cyan)`       | `.online-indicator`                             |
| **右侧辅助面板**         | `background-color` | `#FAFBFD`                       | `.right-panel, .detail-panel`                   |
| 面板内文字标题           | `color`            | `var(--tech-text-primary)`      | `.panel-header`                                 |
| **分割线**               | `border-top`       | `var(--tech-border-default)`    | `.divider, hr`                                  |

---

## 三、实施步骤（AI 助手执行顺序）

1. **全局变量注入**  
   找到项目全局样式入口文件，将第一部分 CSS 变量定义粘贴至 `:root` 选择器内。若已有 `:root` 定义，请合并而非覆盖无关变量。

2. **逐区域覆盖样式**  
   按照第二部分的映射表，定位对应组件或页面的样式文件，将原有硬编码色值（如 `#333`、`#f5f5f5`、`#1890ff`）替换为对应的 CSS 变量引用。

3. **处理未覆盖的硬编码颜色**  
   使用项目全局搜索功能，查找关键词 `color:`、`background:`、`border:` 后跟十六进制色值或 `rgb` 的样式，若属于上述区域范畴，手动替换为变量。

4. **图标颜色继承处理**  
   确保图标组件（如 SVG、IconFont）的 `fill` 或 `color` 设置为 `currentColor`，以便继承父级文字颜色变量。

5. **状态色统一**  
   将全局的 `success`、`warning`、`danger` 类名的颜色属性替换为对应的 `--tech-success` 等变量。

---

## 四、视觉验证清单（人工复核项）

实施完成后，请对照以下条目进行快速视觉检查：

- [ ] 整体背景呈冷灰色调，无刺眼纯白或纯黑区域。
- [ ] 左侧导航栏背景明显深于右侧内容区，层次分明。
- [ ] 选中会话项有淡蓝色背景 + 左侧蓝色竖条，且不刺眼。
- [ ] 所有文字清晰，主文字接近深蓝灰，辅助文字为柔和灰蓝。
- [ ] 按钮主色为电光蓝（`#1E6DF2`），悬停有加深反馈。
- [ ] 在线状态点为青绿色，微带发光感（可选）。
- [ ] 输入框边框极淡，聚焦时变为蓝色。
- [ ] 没有遗留的大红、大绿、高饱和橙色。

---

## 五、可选增强（如需进一步提升质感）

以下为低优先级微调，可根据项目进度选择性实施。

### 1. 在线状态呼吸灯效果

```css
.online-indicator {
  background-color: var(--tech-accent-cyan);
  box-shadow: 0 0 6px rgba(0, 180, 216, 0.3);
}
```

### 2. 智能体名称前自动添加圆点标识

```css
.session-item[data-type="agent"] .session-name::before {
  content: "";
  display: inline-block;
  width: 8px;
  height: 8px;
  border-radius: 2px; /* 小菱形感 */
  background-color: var(--tech-accent-purple);
  margin-right: 8px;
}
```

### 3. 输入框发送按钮动态变色

当输入框有内容时，可配合 JavaScript 添加 `.has-content` 类：

```css
.message-input.has-content + .send-btn {
  color: var(--tech-primary);
}
```

---

## 附录：实施前 / 后效果对比描述（供参考）

| 维度       | 修改前               | 修改后                   |
| :--------- | :------------------- | :----------------------- |
| 整体氛围   | 杂乱、刺眼、后台感强 | 冷静、专业、科技感       |
| 左侧导航   | 白色块混杂，无层次   | 冷灰分层，选中态柔和突出 |
| 文字可读性 | 纯黑高对比，易疲劳   | 深蓝灰，长时阅读舒适     |
| 品牌感     | 无明显主色，廉价感   | 电光蓝统一贯穿，精致     |

---
