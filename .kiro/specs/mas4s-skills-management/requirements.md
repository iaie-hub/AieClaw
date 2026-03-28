# 需求文档：mas4s Skills管理功能

## 简介

本文档定义了在mas4s前端（基于Vue 3 + Lit框架）中实现Skills管理界面的功能需求。该功能参考原OpenClaw UI的Skills管理设计模式，提供Skills的浏览、分类、详情查看和状态管理能力。

## 术语表

- **Skills_Manager**: Skills管理界面组件，负责展示和管理Skills列表
- **Primary_Sidebar**: 一级导航侧边栏组件，提供主要功能模块的导航入口
- **Main_Workspace**: 主工作区组件，显示当前选中功能模块的内容
- **Skills_Controller**: Skills业务逻辑控制器，处理Skills数据获取和状态管理
- **AppStore**: 全局应用状态存储，管理跨组件共享的数据
- **Gateway_API**: WebSocket通信接口，用于与后端Gateway服务交互
- **Skill_Card**: Skills卡片组件，以卡片形式展示单个Skill的信息
- **Skill_Detail_Panel**: Skills详情面板组件，显示选中Skill的完整信息
- **Workspace_Skill**: 工作空间Skills，source为"openclaw-workspace"或"agents-skills-project"
- **Builtin_Skill**: 内置Skills，source为"openclaw-bundled"、"openclaw-managed"、"agents-skills-personal"或"openclaw-extra"
- **Skill_Status**: Skill状态，包括Ready（就绪）、Needs_Setup（需要配置）、Disabled（已禁用）

## 需求

### 需求 1：导航集成

**用户故事：** 作为用户，我希望在主导航栏中看到Skills入口，以便快速访问Skills管理功能。

#### 验收标准

1. THE Primary_Sidebar SHALL 在导航列表中显示"Skills"导航项
2. THE Primary_Sidebar SHALL 为"Skills"导航项显示对应的图标（layers图标）
3. WHEN 用户点击"Skills"导航项，THE Primary_Sidebar SHALL 触发nav-change事件，携带nav值为"skills"
4. WHEN "Skills"导航项被选中，THE Primary_Sidebar SHALL 为该导航项应用激活态样式
5. THE Primary_Sidebar SHALL 将"Skills"导航项放置在"智能体"和"定时任务"之间

### 需求 2：Skills列表展示

**用户故事：** 作为用户，我希望以卡片形式查看所有可用的Skills，以便了解系统中有哪些Skills。

#### 验收标准

1. WHEN 用户选择"Skills"导航项，THE Main_Workspace SHALL 在主工作区显示Skills_Manager组件
2. THE Skills_Manager SHALL 以卡片网格布局展示所有Skills
3. FOR ALL Skills，THE Skill_Card SHALL 显示Skill名称
4. FOR ALL Skills，THE Skill_Card SHALL 显示Skill描述
5. FOR ALL Skills，THE Skill_Card SHALL 显示Skill状态图标（Ready、Needs_Setup或Disabled）
6. THE Skills_Manager SHALL 提供搜索输入框，用于过滤Skills列表
7. WHEN 用户在搜索框输入文本，THE Skills_Manager SHALL 实时过滤Skills列表，仅显示名称或描述包含搜索文本的Skills

### 需求 3：Skills分类和分组

**用户故事：** 作为用户，我希望按照不同类别查看Skills，以便区分工作空间Skills和内置Skills。

#### 验收标准

1. THE Skills_Manager SHALL 在顶部显示3个页签："所有"、"工作空间"、"内置"
2. WHEN 用户选择"所有"页签，THE Skills_Manager SHALL 显示所有Skills，并按Workspace_Skill和Builtin_Skill分组
3. WHEN 用户选择"所有"页签，THE Skills_Manager SHALL 在Workspace_Skill组前显示"WORKSPACE SKILLS"分组标题
4. WHEN 用户选择"所有"页签，THE Skills_Manager SHALL 在Builtin_Skill组前显示"BUILT-IN SKILLS"分组标题
5. WHEN 用户选择"工作空间"页签，THE Skills_Manager SHALL 仅显示source为"openclaw-workspace"或"agents-skills-project"的Skills
6. WHEN 用户选择"内置"页签，THE Skills_Manager SHALL 仅显示source为"openclaw-bundled"、"openclaw-managed"、"agents-skills-personal"或"openclaw-extra"的Skills
7. THE Skills_Manager SHALL 默认选中"所有"页签

### 需求 4：Skills详情面板

**用户故事：** 作为用户，我希望查看Skill的详细信息，以便了解Skill的完整配置和使用方式。

#### 验收标准

1. WHEN 用户点击Skill_Card，THE Skills_Manager SHALL 在右侧显示Skill_Detail_Panel
2. THE Skill_Detail_Panel SHALL 显示Skill的完整描述
3. THE Skill_Detail_Panel SHALL 显示Skill的配置要求（requires字段）
4. THE Skill_Detail_Panel SHALL 显示Skill的安装状态
5. WHEN Skill包含相关文件路径，THE Skill_Detail_Panel SHALL 显示文件路径列表
6. THE Skill_Detail_Panel SHALL 提供关闭按钮，用于隐藏详情面板
7. WHEN 用户点击关闭按钮或点击面板外部区域，THE Skills_Manager SHALL 隐藏Skill_Detail_Panel

### 需求 5：Gateway API集成

**用户故事：** 作为系统，我需要通过Gateway API获取Skills数据，以便向用户展示最新的Skills信息。

#### 验收标准

1. THE Skills_Controller SHALL 通过Gateway_API调用"skills.status"方法获取Skills数据
2. WHEN Skills_Manager组件挂载，THE Skills_Controller SHALL 自动发起"skills.status"请求
3. WHEN "skills.status"请求成功，THE Skills_Controller SHALL 将返回的SkillStatusReport存储到AppStore
4. WHEN "skills.status"请求失败，THE Skills_Controller SHALL 在Skills_Manager中显示错误提示信息
5. THE Skills_Controller SHALL 在请求期间显示加载状态指示器
6. WHEN 用户从其他导航项切换回"Skills"，THE Skills_Controller SHALL 重新发起"skills.status"请求以刷新数据

### 需求 6：Skills状态管理

**用户故事：** 作为系统，我需要在AppStore中管理Skills数据，以便在组件间共享Skills状态。

#### 验收标准

1. THE AppStore SHALL 提供skillsReport属性，用于存储SkillStatusReport数据
2. THE AppStore SHALL 提供skillsLoading属性，用于标识Skills数据加载状态
3. THE AppStore SHALL 提供skillsError属性，用于存储Skills数据加载错误信息
4. THE AppStore SHALL 提供setSkillsReport方法，用于更新skillsReport
5. THE AppStore SHALL 提供setSkillsLoading方法，用于更新skillsLoading
6. THE AppStore SHALL 提供setSkillsError方法，用于更新skillsError
7. WHEN AppStore中的Skills相关属性更新，THE AppStore SHALL 通知所有订阅的组件重新渲染

### 需求 7：Skills分类逻辑

**用户故事：** 作为系统，我需要正确识别Skills的类别，以便在界面上正确分组显示。

#### 验收标准

1. WHEN Skill的source字段为"openclaw-workspace"，THE Skills_Controller SHALL 将该Skill分类为Workspace_Skill
2. WHEN Skill的source字段为"agents-skills-project"，THE Skills_Controller SHALL 将该Skill分类为Workspace_Skill
3. WHEN Skill的source字段为"openclaw-bundled"，THE Skills_Controller SHALL 将该Skill分类为Builtin_Skill
4. WHEN Skill的source字段为"openclaw-managed"，THE Skills_Controller SHALL 将该Skill分类为Builtin_Skill
5. WHEN Skill的source字段为"agents-skills-personal"，THE Skills_Controller SHALL 将该Skill分类为Builtin_Skill
6. WHEN Skill的source字段为"openclaw-extra"，THE Skills_Controller SHALL 将该Skill分类为Builtin_Skill
7. WHEN Skill的source字段不属于上述任何值，THE Skills_Controller SHALL 将该Skill分类为Builtin_Skill（默认分类）

### 需求 8：响应式布局

**用户故事：** 作为用户，我希望Skills管理界面能够适应不同的屏幕尺寸，以便在各种设备上使用。

#### 验收标准

1. THE Skills_Manager SHALL 使用响应式网格布局展示Skill_Card
2. WHEN 视口宽度大于1200px，THE Skills_Manager SHALL 在每行显示3个Skill_Card
3. WHEN 视口宽度在768px到1200px之间，THE Skills_Manager SHALL 在每行显示2个Skill_Card
4. WHEN 视口宽度小于768px，THE Skills_Manager SHALL 在每行显示1个Skill_Card
5. WHEN Skill_Detail_Panel打开，THE Skills_Manager SHALL 调整卡片网格宽度以适应详情面板
6. THE Skill_Detail_Panel SHALL 在小屏幕设备上以全屏模态形式显示

### 需求 9：错误处理

**用户故事：** 作为用户，当Skills数据加载失败时，我希望看到清晰的错误提示，以便了解问题所在。

#### 验收标准

1. WHEN "skills.status"请求超时，THE Skills_Manager SHALL 显示"请求超时，请稍后重试"错误消息
2. WHEN "skills.status"请求返回错误响应，THE Skills_Manager SHALL 显示Gateway返回的错误消息
3. WHEN Gateway连接断开，THE Skills_Manager SHALL 显示"连接已断开，请检查网络"错误消息
4. THE Skills_Manager SHALL 在错误消息下方提供"重试"按钮
5. WHEN 用户点击"重试"按钮，THE Skills_Controller SHALL 重新发起"skills.status"请求
6. WHEN "skills.status"请求成功，THE Skills_Manager SHALL 清除之前显示的错误消息

### 需求 10：空状态处理

**用户故事：** 作为用户，当系统中没有Skills时，我希望看到友好的提示信息，以便了解如何添加Skills。

#### 验收标准

1. WHEN SkillStatusReport中没有任何Skills，THE Skills_Manager SHALL 显示空状态提示
2. THE Skills_Manager SHALL 在空状态提示中显示"暂无可用的Skills"文本
3. THE Skills_Manager SHALL 在空状态提示中显示引导图标
4. WHEN 搜索结果为空，THE Skills_Manager SHALL 显示"未找到匹配的Skills"提示
5. WHEN 搜索结果为空，THE Skills_Manager SHALL 提供"清除搜索"按钮，用于重置搜索条件

### 需求 11：Skill启用/禁用

**用户故事：** 作为用户，我希望能够启用或禁用单个Skill，以便控制哪些Skills在系统中可用。

#### 验收标准

1. THE Skill_Detail_Panel SHALL 显示Skill的当前启用状态（已启用/已禁用）
2. THE Skill_Detail_Panel SHALL 提供切换按钮，用于启用或禁用Skill
3. WHEN 用户点击切换按钮，THE Skills_Controller SHALL 通过Gateway_API调用"skills.update"方法更新Skill状态
4. WHEN "skills.update"请求成功，THE Skills_Controller SHALL 更新AppStore中的Skill状态
5. WHEN "skills.update"请求成功，THE Skill_Card SHALL 更新显示以反映新的启用状态
6. WHEN "skills.update"请求失败，THE Skills_Manager SHALL 显示错误提示信息
7. WHEN Skill被禁用，THE Skill_Card SHALL 显示禁用状态指示器（灰色）
8. WHEN Skill被启用，THE Skill_Card SHALL 显示启用状态指示器（绿色或黄色，取决于配置状态）

### 需求 11：批量启用/禁用Skills

**用户故事：** 作为用户，我希望能够批量启用或禁用多个Skills，以便快速管理Skills的激活状态。

#### 验收标准

1. THE Skills_Manager SHALL 提供批量选择模式切换按钮
2. WHEN 用户进入批量选择模式，THE Skill_Card SHALL 显示复选框
3. WHEN 用户选择一个或多个Skill卡片，THE Skills_Manager SHALL 显示批量操作工具栏
4. THE 批量操作工具栏 SHALL 显示已选择的Skills数量
5. THE 批量操作工具栏 SHALL 提供"启用"按钮
6. THE 批量操作工具栏 SHALL 提供"禁用"按钮
7. THE 批量操作工具栏 SHALL 提供"取消选择"按钮
8. WHEN 用户点击"启用"按钮，THE Skills_Controller SHALL 调用Gateway API批量启用所选Skills
9. WHEN 用户点击"禁用"按钮，THE Skills_Controller SHALL 调用Gateway API批量禁用所选Skills
10. WHEN 批量操作成功，THE Skills_Manager SHALL 显示成功提示信息
11. WHEN 批量操作失败，THE Skills_Manager SHALL 显示失败的Skills列表和错误信息
12. WHEN 批量操作完成，THE Skills_Controller SHALL 刷新Skills列表
13. THE Skill_Card SHALL 在禁用状态下显示禁用标识
14. WHEN 用户退出批量选择模式，THE Skills_Manager SHALL 清除所有选择状态
