# 实现计划：mas4s Skills管理功能

## 概述

本实现计划将mas4s Skills管理功能分解为可执行的编码任务。该功能使用Lit Web Components框架，通过Gateway WebSocket API与后端通信，提供Skills的浏览、分类、详情查看和状态管理能力。

实现将分为5个阶段：基础架构、UI组件、交互逻辑、样式和动画、集成和测试。

## 任务

- [x] 1. 扩展AppStore添加Skills状态管理
  - 在AppStore类中添加skillsReport、skillsLoading、skillsError属性
  - 实现setSkillsReport、setSkillsLoading、setSkillsError方法
  - 确保状态更新时调用notify()通知订阅组件
  - _需求: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

- [x] 1.1 编写AppStore Skills状态管理的单元测试
  - 测试skillsReport、skillsLoading、skillsError属性的初始值
  - 测试setSkillsReport、setSkillsLoading、setSkillsError方法
  - 测试状态更新后notify()被调用
  - _需求: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7_

- [x] 2. 创建Skills类型定义
  - 在src/types/目录创建skills-types.ts
  - 定义SkillStatusEntry接口（包含name、description、source、skillKey、filePath、disabled、eligible、missing、install等字段）
  - 定义SkillStatusReport接口（包含workspaceDir、managedSkillsDir、skills数组）
  - _需求: 5.1, 5.2, 5.3_

- [x] 3. 实现Skills Gateway API集成
  - 在src/gateway/目录创建skills-api.ts
  - 实现fetchSkills函数，调用skills.status方法
  - 实现toggleSkillEnabled函数，调用skills.update方法
  - 实现错误处理（超时、断开连接、Gateway错误）
  - 实现请求超时设置（skills.status: 10秒，skills.update: 5秒）
  - _需求: 5.1, 5.2, 5.3, 5.4, 9.1, 9.2, 9.3_

- [x] 3.1 编写Skills API的单元测试
  - 测试fetchSkills成功调用skills.status
  - 测试toggleSkillEnabled成功调用skills.update
  - 测试超时错误处理
  - 测试断开连接错误处理
  - 测试Gateway错误处理
  - _需求: 5.1, 5.2, 5.3, 5.4, 9.1, 9.2, 9.3_

- [x] 4. 创建SkillsController控制器
  - 在src/controllers/目录创建skills-controller.ts
  - 实现fetchSkills方法，调用Gateway API并更新AppStore
  - 实现toggleSkillEnabled方法，处理Skill启用/禁用操作
  - 实现classifySkill方法，根据source字段分类Skills
  - 实现filterSkills方法，根据页签和搜索文本过滤Skills
  - 实现错误重试逻辑（最多3次，指数退避）
  - _需求: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 9.5, 9.6, 11.3, 11.4_

- [x] 4.1 编写SkillsController的单元测试
  - 测试fetchSkills调用Gateway API并更新AppStore
  - 测试classifySkill正确分类不同source的Skills
  - 测试filterSkills根据页签和搜索文本过滤
  - 测试toggleSkillEnabled调用skills.update API
  - 测试错误重试逻辑
  - _需求: 5.1, 5.2, 5.3, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7, 9.5, 11.3_

- [x] 5. 创建skill-card组件
  - 在src/components/目录创建skill-card.ts
  - 定义skill属性（SkillStatusEntry类型）和selected属性（Boolean类型）
  - 实现卡片布局：图标、名称、描述、状态指示器
  - 实现状态指示器逻辑（Ready: 绿色，Needs Setup: 黄色，Disabled: 灰色）
  - 实现点击事件，触发skill-select事件
  - 应用卡片样式：边框、圆角、悬停效果、选中态样式
  - _需求: 2.2, 2.3, 2.4, 2.5, 4.1, 11.7, 11.8_

- [x] 5.1 编写skill-card组件的单元测试
  - 测试卡片显示Skill名称、描述
  - 测试状态指示器根据disabled、eligible、missing字段显示正确颜色
  - 测试点击卡片触发skill-select事件
  - 测试选中态样式应用
  - _需求: 2.3, 2.4, 2.5, 4.1, 11.7, 11.8_

- [ ] 6. 创建skill-detail-panel组件
  - 在src/components/目录创建skill-detail-panel.ts
  - 定义skill属性（SkillStatusEntry | null）、open属性（Boolean）、updating属性（Boolean）
  - 实现详情面板布局：标题、完整描述、配置要求、安装状态、文件路径
  - 实现关闭按钮，触发close事件
  - 实现启用/禁用切换按钮，触发toggle-enabled事件
  - 实现滑入/滑出动画（transform: translateX）
  - 实现背景遮罩，点击关闭详情面板
  - 实现响应式布局（小屏全屏模态）
  - _需求: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 8.6, 11.1, 11.2_

- [~] 6.1 编写skill-detail-panel组件的单元测试
  - 测试详情面板显示完整Skill信息
  - 测试关闭按钮触发close事件
  - 测试切换按钮触发toggle-enabled事件
  - 测试点击背景遮罩关闭面板
  - 测试updating状态禁用切换按钮
  - _需求: 4.2, 4.3, 4.4, 4.5, 4.7, 11.1, 11.2_

- [~] 7. 创建skills-manager主容器组件
  - 在src/views/目录创建skills-manager.ts
  - 定义activeTab、searchFilter、selectedSkillKey属性
  - 实现页签切换UI（所有/工作空间/内置）
  - 实现搜索输入框，实时过滤Skills列表
  - 实现Skills卡片网格布局（使用CSS Grid）
  - 实现响应式断点（>1200px: 3列，768-1200px: 2列，<768px: 1列）
  - 集成skill-card和skill-detail-panel组件
  - 处理skill-select事件，打开详情面板
  - 处理close事件，关闭详情面板
  - 处理toggle-enabled事件，调用SkillsController切换Skill状态
  - _需求: 2.1, 2.2, 2.6, 2.7, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 4.1, 4.7, 8.1, 8.2, 8.3, 8.4, 8.5_

- [~] 7.1 编写skills-manager组件的单元测试
  - 测试页签切换逻辑
  - 测试搜索过滤逻辑
  - 测试卡片网格布局
  - 测试详情面板打开/关闭
  - 测试响应式断点
  - _需求: 2.7, 3.1, 3.5, 3.6, 3.7, 4.1, 4.7, 8.2, 8.3, 8.4_

- [~] 8. 实现加载、错误和空状态UI
  - 在skills-manager中实现加载状态UI（spinner + 提示文本）
  - 实现错误状态UI（错误消息 + 重试按钮）
  - 实现空状态UI（图标 + "暂无可用的Skills"提示）
  - 实现搜索结果为空状态UI（"未找到匹配的Skills" + 清除搜索按钮）
  - 处理重试按钮点击，调用SkillsController重新获取数据
  - _需求: 5.5, 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 10.1, 10.2, 10.3, 10.4, 10.5_

- [~] 8.1 编写加载、错误和空状态的单元测试
  - 测试加载状态显示
  - 测试错误状态显示和重试按钮
  - 测试空状态显示
  - 测试搜索结果为空状态
  - _需求: 5.5, 9.1, 9.2, 9.3, 9.4, 10.1, 10.2, 10.4, 10.5_

- [~] 9. 集成skills-manager到main-workspace
  - 修改main-workspace.ts，在activeNav为"skills"时渲染skills-manager组件
  - 导入skills-manager组件
  - 传递必要的属性和事件处理器
  - _需求: 2.1_

- [~] 9.1 编写main-workspace集成的单元测试
  - 测试activeNav为"skills"时渲染skills-manager
  - 测试activeNav为其他值时不渲染skills-manager
  - _需求: 2.1_

- [~] 10. 实现Skills生命周期管理
  - 在app-shell.ts或app.ts中集成SkillsController
  - 在导航切换到Skills时调用fetchSkills
  - 在从其他导航切换回Skills时重新调用fetchSkills
  - 实现组件挂载时自动获取Skills数据
  - _需求: 5.2, 5.6_

- [~] 11. 检查点 - 确保所有测试通过
  - 运行pnpm test -- aiemas/ui/mas4s确保所有单元测试通过
  - 检查是否有TypeScript类型错误
  - 确认所有组件正确集成，如有问题请询问用户

- [~] 12. 实现Skills样式和动画
  - 应用设计系统变量（颜色、间距、圆角、阴影）
  - 实现卡片悬停动画（translateY、box-shadow）
  - 实现详情面板滑入/滑出动画（transform: translateX，cubic-bezier缓动）
  - 实现页签切换淡入动画（fadeIn）
  - 实现切换按钮动画（toggle-switch滑动效果）
  - 优化响应式布局过渡效果
  - _需求: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

- [~] 12.1 测试样式和动画效果
  - 手动测试不同屏幕尺寸下的布局
  - 测试动画流畅性
  - 测试悬停和点击交互效果
  - _需求: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

- [~] 13. 实现搜索防抖优化
  - 在skills-manager中实现搜索输入防抖（300ms延迟）
  - 避免每次输入都触发过滤计算
  - _需求: 2.7_

- [~] 13.1 编写属性测试：搜索过滤正确性
  - **属性 6: 搜索过滤正确筛选Skills**
  - **验证需求: 2.7**
  - 使用fast-check生成随机Skills列表和搜索文本
  - 验证过滤结果只包含名称或描述匹配的Skills
  - _需求: 2.7_

- [~] 14. 编写属性测试：页签过滤正确性
  - **属性 7: 工作空间页签过滤正确的Skills**
  - **验证需求: 3.5**
  - 使用fast-check生成随机Skills列表
  - 验证工作空间页签只显示source为"openclaw-workspace"或"agents-skills-project"的Skills
  - _需求: 3.5_

- [~] 14.1 编写属性测试：内置页签过滤正确性
  - **属性 8: 内置页签过滤正确的Skills**
  - **验证需求: 3.6**
  - 使用fast-check生成随机Skills列表
  - 验证内置页签只显示source不为"openclaw-workspace"和"agents-skills-project"的Skills
  - _需求: 3.6_

- [~] 15. 编写属性测试：AppStore状态更新通知
  - **属性 15: AppStore状态更新触发通知**
  - **验证需求: 6.4, 6.5, 6.6, 6.7**
  - 使用fast-check生成随机状态更新
  - 验证每次状态更新都调用notify()
  - _需求: 6.4, 6.5, 6.6, 6.7_

- [~] 16. 编写属性测试：Skill卡片必需信息
  - **属性 5: Skill卡片包含必需信息**
  - **验证需求: 2.3, 2.4, 2.5**
  - 使用fast-check生成随机Skill数据
  - 验证skill-card渲染包含名称、描述和状态指示器
  - _需求: 2.3, 2.4, 2.5_

- [~] 17. 编写属性测试：启用状态更新正确性
  - **属性 18: 启用状态更新后刷新显示**
  - **验证需求: 11.4, 11.5**
  - 使用fast-check生成随机Skill和enabled值
  - 验证skills.update成功后AppStore中对应Skill的disabled字段更新正确
  - _需求: 11.4, 11.5_

- [~] 18. 实现可访问性支持
  - 为页签添加ARIA标签（role="tablist"、role="tab"、aria-selected）
  - 为Skills网格添加ARIA标签（role="grid"）
  - 实现键盘导航（Escape关闭详情面板，ArrowLeft/ArrowRight切换页签）
  - 实现焦点管理（打开详情面板时移动焦点）
  - _需求: 2.1, 3.1, 4.7_

- [~] 18.1 测试可访问性功能
  - 测试键盘导航功能
  - 测试ARIA标签正确性
  - 测试焦点管理
  - _需求: 2.1, 3.1, 4.7_

- [~] 19. 最终检查点 - 确保所有测试通过
  - 运行pnpm test -- aiemas/ui/mas4s确保所有测试通过
  - 运行pnpm check确保代码格式和类型检查通过
  - 手动测试完整的用户交互流程
  - 确认所有需求都已实现，如有问题请询问用户

## 注意事项

- 标记为`*`的任务是可选的，可以跳过以加快MVP交付
- 每个任务都引用了具体的需求编号，确保可追溯性
- 检查点任务确保增量验证
- 属性测试验证通用正确性属性
- 单元测试验证特定示例和边缘情况
- 所有代码应遵循现有的Lit组件模式和AppStore响应式模式
- 使用fast-check库进行属性测试，每个测试至少运行100次迭代
- 遵循AGENTS.md中的编码规范和测试指南
