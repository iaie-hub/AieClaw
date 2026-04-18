# Requirements Document

## Introduction

在智能体页面（agents-view）中实现智能体的完整生命周期管理功能，包括创建、更新、删除、导出和导入。删除/导出操作通过智能体卡片右下角的图标触发，导入操作通过列表页右上角的导入按钮触发。导出流程允许用户选择工作区中的文件和目录进行打包下载；导入流程支持上传已导出的压缩包并自动创建智能体及恢复工作区文件。

所有新增功能闭环在 `aiemas/src` 目录内实现，遵循最小入侵原 Gateway 原则。新增的 API 和事件需记录到 `aiemas/docs/openclaw/websocket_api.md`。

## Glossary

- **Agents_View**: 智能体列表视图组件（`aiemas/ui/mas4s/src/views/agents-view.ts`），以卡片网格展示所有智能体
- **Agent_Card**: 智能体卡片组件（`aiemas/ui/mas4s/src/components/agent-card.ts`），展示单个智能体摘要信息
- **Confirm_Dialog**: 通用确认弹窗组件（`aiemas/ui/mas4s/src/components/confirm-dialog.ts`），提供确认/取消交互
- **Agents_API**: 前端 Gateway API 封装层（`aiemas/ui/mas4s/src/gateway/agents-api.ts`），封装所有智能体相关的 RPC 调用
- **Gateway_Plugin**: MAS4S Gateway 插件（`aiemas/src/gateway-bridge/mas4s-gateway-plugin.ts`），通过 extraHandlers 注册 aiemas 自定义方法
- **Gateway_Client**: GatewayBrowserClient 单例（`aiemas/ui/mas4s/src/gateway/client.ts`），负责 WebSocket RPC 通信
- **Export_Dialog**: 导出确认对话框组件（新增），展示工作区文件/目录列表供用户勾选
- **Import_Dialog**: 导入对话框组件（新增），提供文件选择和上传交互
- **Create_Dialog**: 创建智能体对话框组件（新增），提供名称和工作区目录输入
- **Agent_Workspace**: 智能体的工作区目录，存放智能体相关的配置文件和资源
- **Session_Labels**: 会话标签表（`aiemas/src/store/database.ts` 中的 `session_labels` 表），存储会话元数据，其中 `currentAgentId` 列记录会话当前关联的智能体 ID

## Requirements

### Requirement 1: 创建智能体

**User Story:** As a 平台用户, I want 在智能体列表页面创建新的智能体, so that 我可以为不同任务配置独立的智能体。

#### Acceptance Criteria

1. THE Agents_View SHALL 在页面头部区域右上角渲染一个创建按钮（与导入按钮并列）
2. WHEN 用户点击创建按钮, THE Agents_View SHALL 显示创建智能体对话框，包含名称（必填）和工作区目录（必填）输入项
3. WHEN 用户填写完成并确认创建, THE Agents_View SHALL 调用 agents.create RPC 方法，传入 name 和 workspace 参数
4. WHEN agents.create 调用成功返回, THE Agents_View SHALL 重新获取智能体列表以刷新页面
5. IF agents.create 调用失败（如名称重复、参数无效）, THEN THE Agents_View SHALL 向用户展示错误提示信息
6. WHEN 用户在创建对话框中点击取消, THE Agents_View SHALL 关闭对话框且不执行创建操作

### Requirement 2: 删除智能体

**User Story:** As a 平台用户, I want 在智能体卡片上直接删除不需要的智能体, so that 我可以清理不再使用的智能体资源。

#### Acceptance Criteria

1. THE Agent_Card SHALL 在卡片右下角渲染一个删除图标按钮
2. WHEN 用户点击删除图标按钮, THE Agent_Card SHALL 阻止事件冒泡以避免触发卡片的 agent-select 事件
3. WHEN 用户点击删除图标按钮, THE Agent_Card SHALL 触发 agent-delete 自定义事件，事件 detail 包含待删除的 AgentEntry 对象
4. WHEN Agents_View 接收到 agent-delete 事件, THE Agents_View SHALL 显示 Confirm_Dialog 确认弹窗，提示用户确认删除操作
5. WHEN 用户在 Confirm_Dialog 中点击确认, THE Agents_View SHALL 先调用 aiemas.agents.preDelete RPC 方法检查该智能体是否存在关联会话
6. WHEN aiemas.agents.preDelete 返回成功（无关联会话）, THE Agents_View SHALL 调用 agents.delete RPC 方法，传入待删除智能体的 id
7. WHEN agents.delete 调用成功返回, THE Agents_View SHALL 重新获取智能体列表以刷新页面
8. IF aiemas.agents.preDelete 返回 AGENT_IN_USE 错误, THEN THE Agents_View SHALL 向用户展示错误提示，说明该智能体仍有关联的会话，无法删除
9. IF agents.delete 调用失败, THEN THE Agents_View SHALL 向用户展示错误提示信息
10. WHEN 用户在 Confirm_Dialog 中点击取消, THE Agents_View SHALL 关闭确认弹窗且不执行删除操作

### Requirement 3: 导出智能体

**User Story:** As a 平台用户, I want 将智能体的工作区文件打包导出, so that 我可以备份智能体配置或在其他环境中复用。

#### Acceptance Criteria

1. THE Agent_Card SHALL 在卡片右下角渲染一个导出图标按钮（与删除图标并列）
2. WHEN 用户点击导出图标按钮, THE Agent_Card SHALL 阻止事件冒泡以避免触发卡片的 agent-select 事件
3. WHEN 用户点击导出图标按钮, THE Agent_Card SHALL 触发 agent-export 自定义事件，事件 detail 包含待导出的 AgentEntry 对象
4. WHEN Agents_View 接收到 agent-export 事件, THE Agents_View SHALL 以该智能体的 workspace 目录为参数调用 aiemas.fs.list RPC 方法
5. WHEN aiemas.fs.list 返回成功, THE Agents_View SHALL 显示 Export_Dialog，展示工作区目录中的文件列表和子目录列表（不展开子目录）
6. THE Export_Dialog SHALL 以复选框形式展示每个文件和目录条目，允许用户勾选需要导出的项目
7. THE Export_Dialog SHALL 默认选中所有文件和目录条目
8. THE Export_Dialog SHALL 提供全选/取消全选功能
9. WHEN 用户在 Export_Dialog 中确认导出, THE Agents_View SHALL 以选中的文件和目录列表为参数调用 aiemas.agents.export RPC 方法
10. WHEN aiemas.agents.export 返回压缩包路径, THE Agents_View SHALL 调用 aiemas.files.download 下载该压缩包
11. IF aiemas.fs.list 或 aiemas.agents.export 调用失败, THEN THE Agents_View SHALL 向用户展示错误提示信息
12. WHEN 用户在 Export_Dialog 中点击取消, THE Agents_View SHALL 关闭导出对话框且不执行导出操作

### Requirement 4: 导入智能体

**User Story:** As a 平台用户, I want 通过上传已导出的智能体压缩包来导入智能体, so that 我可以快速恢复或迁移智能体配置。

#### Acceptance Criteria

1. THE Agents_View SHALL 在页面头部区域右上角渲染一个导入按钮
2. WHEN 用户点击导入按钮, THE Agents_View SHALL 显示 Import_Dialog 对话框
3. THE Import_Dialog SHALL 提供文件选择器，限制文件类型为压缩包格式（.zip, .tar.gz 等）
4. WHEN 用户选择压缩包文件后确认导入, THE Agents_View SHALL 调用 aiemas.file.upload RPC 方法上传压缩包
5. WHEN aiemas.file.upload 返回上传成功, THE Agents_View SHALL 调用 aiemas.agents.import RPC 方法，传入上传后的文件路径
6. WHEN aiemas.agents.import 返回成功, THE Agents_View SHALL 重新获取智能体列表以刷新页面
7. IF aiemas.file.upload 或 aiemas.agents.import 调用失败, THEN THE Agents_View SHALL 向用户展示错误提示信息
8. WHEN 用户在 Import_Dialog 中点击取消, THE Agents_View SHALL 关闭导入对话框且不执行导入操作

### Requirement 5: Gateway 端 — aiemas.fs.list 接口

**User Story:** As a 前端组件, I want 通过 RPC 获取指定目录的文件和子目录列表, so that 导出对话框可以展示工作区内容供用户选择。

#### Acceptance Criteria

1. THE Gateway_Plugin SHALL 注册 aiemas.fs.list 方法到 extraHandlers
2. WHEN 收到 aiemas.fs.list 请求且 params 包含有效的 dirPath 字符串, THE Gateway_Plugin SHALL 读取该目录下的直接子项（不递归）
3. THE Gateway_Plugin SHALL 返回包含 entries 数组的响应，每个条目包含 name（文件/目录名）、type（"file" 或 "directory"）、size（文件大小，目录为 0）字段
4. IF dirPath 参数缺失或为空, THEN THE Gateway_Plugin SHALL 返回 INVALID_PARAMS 错误
5. IF 指定目录不存在, THEN THE Gateway_Plugin SHALL 返回 NOT_FOUND 错误

### Requirement 6: Gateway 端 — aiemas.agents.export 接口

**User Story:** As a 前端组件, I want 通过 RPC 将选中的工作区文件和目录打包为压缩包, so that 用户可以下载导出的智能体。

#### Acceptance Criteria

1. THE Gateway_Plugin SHALL 注册 aiemas.agents.export 方法到 extraHandlers
2. WHEN 收到 aiemas.agents.export 请求, THE Gateway_Plugin SHALL 接受 agentId（智能体 ID）、workspace（工作区目录路径）、items（选中的文件和目录名称数组）参数
3. THE Gateway_Plugin SHALL 在工作区目录中创建以 {agentId}-export 命名的临时目录
4. THE Gateway_Plugin SHALL 将 items 中指定的文件和目录复制到临时目录
5. THE Gateway_Plugin SHALL 将临时目录压缩为 .zip 格式的压缩包
6. THE Gateway_Plugin SHALL 返回包含 archivePath（压缩包绝对路径）字段的响应
7. THE Gateway_Plugin SHALL 在压缩完成后清理临时目录
8. IF agentId 或 workspace 或 items 参数缺失, THEN THE Gateway_Plugin SHALL 返回 INVALID_PARAMS 错误
9. IF 工作区目录不存在, THEN THE Gateway_Plugin SHALL 返回 NOT_FOUND 错误

### Requirement 7: Gateway 端 — aiemas.agents.import 接口

**User Story:** As a 前端组件, I want 通过 RPC 导入智能体压缩包并自动创建智能体, so that 用户可以一键恢复智能体及其工作区文件。

#### Acceptance Criteria

1. THE Gateway_Plugin SHALL 注册 aiemas.agents.import 方法到 extraHandlers
2. WHEN 收到 aiemas.agents.import 请求, THE Gateway_Plugin SHALL 接受 archivePath（上传后的压缩包路径）参数
3. THE Gateway_Plugin SHALL 复用 agents.create 流程创建新的智能体
4. THE Gateway_Plugin SHALL 将压缩包解压并覆盖新创建智能体的工作区目录
5. THE Gateway_Plugin SHALL 返回包含新创建智能体信息的响应（与 agents.create 返回格式一致）
6. THE Gateway_Plugin SHALL 在解压完成后清理上传的临时压缩包文件
7. IF archivePath 参数缺失或文件不存在, THEN THE Gateway_Plugin SHALL 返回 INVALID_PARAMS 错误
8. IF agents.create 流程失败, THEN THE Gateway_Plugin SHALL 返回对应的错误信息且不执行解压操作
9. IF 解压过程失败, THEN THE Gateway_Plugin SHALL 返回 EXTRACT_FAILED 错误

### Requirement 8: Gateway 端 — aiemas.files.download 接口

**User Story:** As a 前端组件, I want 通过 RPC 下载服务端指定路径的文件, so that 导出的压缩包可以传输到用户本地。

#### Acceptance Criteria

1. THE Gateway_Plugin SHALL 注册 aiemas.files.download 方法到 extraHandlers
2. WHEN 收到 aiemas.files.download 请求且 params 包含有效的 filePath 字符串, THE Gateway_Plugin SHALL 读取该文件内容并以 base64 编码返回
3. THE Gateway_Plugin SHALL 返回包含 data（base64 编码的文件内容）、fileName（文件名）、mimeType（MIME 类型）字段的响应
4. IF filePath 参数缺失或为空, THEN THE Gateway_Plugin SHALL 返回 INVALID_PARAMS 错误
5. IF 指定文件不存在, THEN THE Gateway_Plugin SHALL 返回 NOT_FOUND 错误

### Requirement 9: Gateway 端 — aiemas.file.upload 接口

**User Story:** As a 前端组件, I want 通过 RPC 上传文件到服务端临时目录, so that 导入流程可以获取用户上传的压缩包。

#### Acceptance Criteria

1. THE Gateway_Plugin SHALL 注册 aiemas.file.upload 方法到 extraHandlers
2. WHEN 收到 aiemas.file.upload 请求, THE Gateway_Plugin SHALL 接受 fileName（文件名）和 data（base64 编码的文件内容）参数
3. THE Gateway_Plugin SHALL 在临时目录中创建文件并写入解码后的内容
4. THE Gateway_Plugin SHALL 返回包含 filePath（服务端文件绝对路径）字段的响应
5. IF fileName 或 data 参数缺失, THEN THE Gateway_Plugin SHALL 返回 INVALID_PARAMS 错误

### Requirement 10: 前端 API 封装层

**User Story:** As a 前端开发者, I want agents-api.ts 中封装所有新增的 RPC 调用, so that 视图组件可以通过统一的 API 层与 Gateway 通信。

#### Acceptance Criteria

1. THE Agents_API SHALL 提供 createAgent 函数，调用 agents.create 方法并传入 name 和 workspace 参数
2. THE Agents_API SHALL 提供 deleteAgent 函数，调用 agents.delete 方法并传入 agentId 参数
3. THE Agents_API SHALL 提供 listWorkspaceFiles 函数，调用 aiemas.fs.list 方法并传入 dirPath 参数
4. THE Agents_API SHALL 提供 exportAgent 函数，调用 aiemas.agents.export 方法并传入 agentId、workspace、items 参数
5. THE Agents_API SHALL 提供 downloadFile 函数，调用 aiemas.files.download 方法并传入 filePath 参数
6. THE Agents_API SHALL 提供 uploadFile 函数，调用 aiemas.file.upload 方法并传入 fileName 和 data（base64）参数
7. THE Agents_API SHALL 提供 importAgent 函数，调用 aiemas.agents.import 方法并传入 archivePath 参数
8. THE Agents_API SHALL 提供 preDeleteAgent 函数，调用 aiemas.agents.preDelete 方法并传入 agentId 参数

### Requirement 11: WebSocket API 文档更新

**User Story:** As a 开发者, I want 新增的 API 接口记录在 websocket_api.md 中, so that 所有接口有统一的文档参考。

#### Acceptance Criteria

1. THE websocket_api.md SHALL 在 "Agent 与插件管理" 表格中新增 aiemas.agents.export 方法条目，标注处理程序为 aiemas
2. THE websocket_api.md SHALL 在 "Agent 与插件管理" 表格中新增 aiemas.agents.import 方法条目，标注处理程序为 aiemas
3. THE websocket_api.md SHALL 在 "系统、配置与治理" 表格中新增 aiemas.fs.list 方法条目，标注处理程序为 aiemas
4. THE websocket_api.md SHALL 在 "Agent 与插件管理" 表格中新增 aiemas.files.download 方法条目，标注处理程序为 aiemas
5. THE websocket_api.md SHALL 在 "Agent 与插件管理" 表格中新增 aiemas.file.upload 方法条目，标注处理程序为 aiemas
6. THE websocket_api.md SHALL 在 "Agent 与插件管理" 表格中新增 aiemas.agents.preDelete 方法条目，标注处理程序为 aiemas
7. THE websocket_api.md SHALL 为每个新增方法提供 RPC 请求/响应的 JSON 示例

### Requirement 12: Gateway 端 — aiemas.agents.preDelete 接口

**User Story:** As a 前端组件, I want 在删除智能体前通过 RPC 检查该智能体是否被会话引用, so that 系统可以阻止删除仍在使用中的智能体。

#### Acceptance Criteria

1. THE Gateway_Plugin SHALL 注册 aiemas.agents.preDelete 方法到 extraHandlers
2. WHEN 收到 aiemas.agents.preDelete 请求, THE Gateway_Plugin SHALL 接受 agentId（智能体 ID）参数
3. WHEN agentId 参数有效, THE Gateway_Plugin SHALL 查询 Session_Labels 表中 currentAgentId 等于该 agentId 的记录数量
4. WHEN 查询结果为 0（无关联会话）, THE Gateway_Plugin SHALL 返回 { ok: true } 表示可以安全删除
5. WHEN 查询结果大于 0（存在关联会话）, THE Gateway_Plugin SHALL 返回 AGENT_IN_USE 错误，错误消息中包含关联会话的数量
6. IF agentId 参数缺失或为空, THEN THE Gateway_Plugin SHALL 返回 INVALID_PARAMS 错误
