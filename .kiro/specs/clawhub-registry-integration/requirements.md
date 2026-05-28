# Requirements Document

## Introduction

本功能为 mas4s Web UI 新增 ClawHub 模块，实现与 AgentRegistry 的集成。主要包括四部分：
1. AgentRegistry 新增健康检查端点 `GET /api/v1/healthy`，用于验证服务在线状态及 API Key 有效性
2. 在设置页面中支持配置 AgentRegistry 的 API Key（保存前通过健康检查端点验证有效性）
3. 新增 ClawHub 导航页面，包含 Agents 和 Skills 两个页签，以卡片形式展示从 AgentRegistry（远程注册中心）查询的数据
4. 在 mas4s.db 中新增 `agent_registry` 表，持久化 API Key 及 NATS 配置，将当前 `~/.openclaw/.env` 中的 NATS 配置迁移至数据库管理

## Glossary

- **AgentRegistry**: 智能体注册中心服务（Python 后端，位于 `/Users/admin/Desktop/code/AgentRegistry/`），提供 Agent 注册、发现、协作等功能的 REST API 和 NATS 消息平面
- **API_Key**: AgentRegistry 颁发的 64 字符身份凭证，以 `api-ar-` 为前缀，用于免登录调用 AgentRegistry 开放接口
- **ClawHub**: mas4s UI 中新增的导航模块，用于浏览 AgentRegistry 远程注册中心中已注册的 Agent 和 Skill 列表（非本机本地 Agent/Skill）
- **NATS_Config**: 连接 AgentRegistry NATS 消息平面所需的配置项，包括 URL、Token、Agent ID、Agent Name、Bound Agent ID
- **Gateway**: OpenClaw 网关服务，mas4s UI 通过 WebSocket 与其通信
- **Settings_Page**: mas4s UI 中的设置页面，用于管理系统配置
- **Agent_Card**: AgentRegistry 返回的 Agent 记录，包含 agent_id、name、status、skills、load 等信息
- **Skill_Entry**: 从 Agent 注册数据中提取的技能条目，包含技能名称及其所属 Agent 信息
- **Healthy_Endpoint**: AgentRegistry 新增的 `GET /api/v1/healthy` 端点，用于检测服务在线状态并验证 API Key 有效性
- **Local_Agent**: 本机 mas4s 系统中已配置的本地 Agent 列表（用于 Bound Agent ID 下拉选择）

## Requirements

### Requirement 1: AgentRegistry 健康检查端点

**User Story:** 作为系统管理员，我希望 AgentRegistry 提供一个健康检查端点，以便验证服务是否在线以及 API Key 是否有效。

#### Acceptance Criteria

1. THE AgentRegistry SHALL 提供 `GET /api/v1/healthy` 端点，用于检测服务在线状态
2. THE Healthy_Endpoint SHALL 要求请求携带有效的身份凭证（Token 或 API Key），支持通过 `Authorization: Bearer <token>` 头部或 `X-API-Key: <api_key>` 头部进行认证
3. WHEN 请求携带有效的 Token 或 API Key 时，THE Healthy_Endpoint SHALL 返回 HTTP 200 响应，Body 为 `{"success": true, "status": "healthy"}`
4. IF 请求未携带身份凭证或凭证无效，THEN THE Healthy_Endpoint SHALL 返回 HTTP 401 响应，Body 为 `{"success": false, "error": "Unauthorized", "code": "UNAUTHORIZED"}`
5. THE Healthy_Endpoint SHALL 可用于验证 API Key 是否有效：WHEN 客户端携带 API Key 调用该端点且返回 HTTP 200 时，表明该 API Key 有效且 AgentRegistry 服务在线

### Requirement 2: AgentRegistry 配置持久化

**User Story:** 作为系统管理员，我希望将 AgentRegistry 的连接配置（API Key 和 NATS 参数）保存到数据库中，以便集中管理和动态更新，无需重启服务。

#### Acceptance Criteria

1. THE Gateway SHALL 在 mas4s.db 中创建 `agent_registry` 表，包含以下字段：id (TEXT PRIMARY KEY, 固定值 'default')、api_key (TEXT)、nats_url (TEXT)、nats_token (TEXT)、agent_id (TEXT)、agent_name (TEXT)、bound_agent_id (TEXT)、created_at (INTEGER)、updated_at (INTEGER)
2. THE Gateway SHALL 通过 `ensureMas4sSchema` 函数中的 `CREATE TABLE IF NOT EXISTS` 语句创建 `agent_registry` 表，确保表中最多存在一条配置记录（id 固定为 'default' 的单例模式）
3. WHEN 系统首次启动且 `agent_registry` 表为空时，THE Gateway SHALL 从 `~/.openclaw/.env` 文件中读取以下环境变量并自动迁移写入 `agent_registry` 表：AGENT_REGISTRY_NATS_URL → nats_url、AGENT_REGISTRY_NATS_TOKEN → nats_token、AGENT_REGISTRY_AGENT_ID → agent_id、AGENT_REGISTRY_AGENT_NAME → agent_name、AGENT_REGISTRY_BOUND_AGENT_ID → bound_agent_id
4. WHEN 配置迁移完成后，THE Gateway SHALL 优先使用数据库中的配置；IF 数据库中某字段为空或 NULL，THEN THE Gateway SHALL 回退使用对应的环境变量值
5. IF 数据库写入失败，THEN THE Gateway SHALL 记录包含错误详情的 error 级别日志并继续使用环境变量中的配置，不影响系统正常启动

### Requirement 3: 设置页面 API Key 配置

**User Story:** 作为系统管理员，我希望在 mas4s 设置页面中配置 AgentRegistry 的 API Key，以便前端能够通过 API Key 调用 AgentRegistry 的 REST API。

#### Acceptance Criteria

1. WHEN 用户导航到设置页面时，THE Settings_Page SHALL 显示 AgentRegistry 配置区域，包含 API Key 输入框和 NATS 配置表单
2. THE Settings_Page SHALL 将 API Key 输入框设置为密码类型，并提供显示/隐藏切换按钮
3. WHEN API Key 输入框失去焦点且内容非空时，THE Settings_Page SHALL 验证其格式以 `api-ar-` 为前缀且总长度为 64 字符
4. IF 用户输入的 API Key 格式不合法，THEN THE Settings_Page SHALL 在输入框下方显示格式错误提示信息，指明要求以 `api-ar-` 为前缀且总长度为 64 字符
5. WHEN 用户点击保存按钮时，IF API Key 输入框内容非空且格式验证通过，THEN THE Gateway SHALL 先通过 `GET /api/v1/healthy` 端点（携带该 API Key 于 `X-API-Key` 头部）验证 API Key 有效性；IF 验证返回 HTTP 200，THEN THE Gateway SHALL 将 API Key 持久化到 `agent_registry` 表并返回保存成功响应；IF 验证返回非 200 状态码或请求超时，THEN THE Gateway SHALL 返回 API Key 验证失败的错误响应，不持久化该 API Key
6. IF 存在格式验证错误，THEN THE Settings_Page SHALL 阻止提交并保持错误提示可见
7. WHEN 配置保存成功时，THE Settings_Page SHALL 显示保存成功的提示信息
8. IF 配置保存失败（包括 API Key 验证失败），THEN THE Settings_Page SHALL 显示包含失败原因的错误信息（区分"API Key 无效"和"AgentRegistry 服务不可达"两种情况）
9. WHEN 用户导航到设置页面时，THE Settings_Page SHALL 从 `agent_registry` 表加载已保存的配置并回填到对应输入框中，其中 API Key 以掩码形式显示

### Requirement 4: 设置页面 NATS 配置管理

**User Story:** 作为系统管理员，我希望在设置页面中管理 NATS 连接配置，以便替代手动编辑 `~/.openclaw/.env` 文件。

#### Acceptance Criteria

1. WHEN Settings_Page 加载时，THE Settings_Page SHALL 从数据库读取当前 NATS 配置记录并显示以下字段的当前值：NATS URL、NATS Token、Agent ID、Agent Name、Bound Agent ID
2. WHEN 用户修改 NATS URL 时，THE Settings_Page SHALL 验证其格式匹配 `nats://{host}:{port}` 模式，其中 host 为非空字符串且端口在 1-65535 范围内，整体长度不超过 256 字符
3. WHEN 用户修改 Agent ID 时，THE Settings_Page SHALL 验证其仅包含字母、数字、连字符和下划线，且长度在 1 到 64 字符之间
4. WHEN 用户首次配置 NATS 且 Agent ID 字段为空时，THE Settings_Page SHALL 自动生成格式为 `Agent-{uuid}` 的默认值填入 Agent ID 输入框（其中 `{uuid}` 为随机生成的 UUID），用户可手动修改该默认值；保存时后端（agent-registry 扩展）会自动在 Agent ID 末尾追加当前机器的 MAC 地址作为后缀以确保全局唯一性
5. WHEN 用户修改 Agent Name 时，THE Settings_Page SHALL 验证其长度在 1 到 128 字符之间
6. THE Settings_Page SHALL 将 Bound Agent ID 字段渲染为下拉选择器（Dropdown Select），WHEN 下拉展开时，THE Settings_Page SHALL 从本机 mas4s 系统获取本地 Agent 列表并作为选项展示（与创建会话时选择 Agent 的交互模式一致），用户从列表中选择一个本地 Agent 作为绑定目标
7. WHEN 用户保存 NATS 配置时，THE Gateway SHALL 将配置记录持久化至数据库并向 agent-registry 扩展发送重新加载信号，保存成功后 Settings_Page 显示保存成功的提示消息
8. IF NATS URL 格式不合法或任一字段未通过验证，THEN THE Settings_Page SHALL 阻止提交并在对应字段旁显示指明具体验证失败原因的错误提示
9. IF 数据库写入失败或 agent-registry 扩展重新加载信号发送失败，THEN THE Gateway SHALL 返回指明保存失败的错误响应，THE Settings_Page SHALL 显示保存失败的错误消息并保留用户已编辑的表单数据
10. WHILE 当前用户角色为 Operator 或 Viewer 时，THE Settings_Page SHALL 隐藏 NATS 配置编辑区域，仅 Admin 角色可查看和修改 NATS 配置

### Requirement 5: ClawHub 导航入口

**User Story:** 作为用户，我希望在 mas4s 侧边栏中看到 ClawHub 入口，以便快速访问 AgentRegistry 远程注册中心中的 Agent 和 Skill 列表。

#### Acceptance Criteria

1. THE Primary_Sidebar SHALL 在导航菜单的 "协作讨论" 导航项之后、底部区域（设置/登出）之前新增 "ClawHub" 导航项，其图标风格、字体大小、间距和激活态高亮样式与现有导航项保持一致
2. WHEN 用户点击 ClawHub 导航项时，THE Primary_Sidebar SHALL 将该导航项设为激活态并切换主内容区域为 ClawHub 视图
3. THE ClawHub 视图 SHALL 包含 "Agents" 和 "Skills" 两个页签按钮，默认激活 Agents 页签，激活页签通过视觉高亮与非激活页签区分
4. WHEN 用户点击非激活页签时，THE ClawHub 视图 SHALL 切换显示对应页签内容并更新页签激活状态

### Requirement 6: ClawHub Agents 页签

**User Story:** 作为用户，我希望在 ClawHub 的 Agents 页签中以卡片形式浏览 AgentRegistry 远程注册中心中已注册的 Agent 列表（非本机本地 Agent），以便了解远程可用的智能体。

#### Acceptance Criteria

1. WHEN ClawHub Agents 页签激活时，THE ClawHub SHALL 显示加载指示器，并通过 Gateway 向 AgentRegistry 远程服务发送 `GET /api/v1/agents?page=1&page_size=20` 请求获取远程已注册的 Agent 列表
2. THE ClawHub SHALL 在每次向 AgentRegistry 发送请求时，于请求头中携带已配置的 API Key（通过 `X-API-Key` 头部）
3. WHEN Agent 列表请求成功返回时，THE ClawHub SHALL 以卡片网格布局展示每个 Agent，卡片内容包含：Agent 名称、Agent ID、状态标识（online/idle/busy/offline）、技能标签列表（最多显示 5 个标签，超出部分以 "+N" 形式折叠展示）
4. WHEN Agent 列表为空时（返回 `agents` 数组长度为 0），THE ClawHub SHALL 显示空状态提示，引导用户检查 AgentRegistry 配置
5. IF API Key 未配置，THEN THE ClawHub SHALL 显示配置引导提示，引导用户前往设置页面配置 API Key，且不发送 API 请求
6. IF AgentRegistry 请求在 10 秒内未响应或返回 HTTP 4xx/5xx 状态码，THEN THE ClawHub SHALL 隐藏加载指示器，显示错误信息及重试按钮，点击重试按钮后重新发送当前页的请求
7. THE ClawHub SHALL 支持分页加载，每页默认显示 20 条记录（最大不超过 100 条），并在列表底部展示分页控件，显示当前页码、总页数，提供上一页与下一页导航按钮

### Requirement 7: ClawHub Skills 页签

**User Story:** 作为用户，我希望在 ClawHub 的 Skills 页签中以卡片形式浏览 AgentRegistry 远程注册中心中所有已注册 Agent 的技能列表（非本机本地 Skill），以便了解远程系统具备的能力。

#### Acceptance Criteria

1. WHEN ClawHub Skills 页签激活时，IF Agent 列表数据已通过 Agents 页签获取，THEN THE ClawHub SHALL 从缓存的 Agent 列表中聚合所有 Skill 条目；IF Agent 列表数据尚未获取，THEN THE ClawHub SHALL 通过 Gateway 向 AgentRegistry 发送 `GET /api/v1/agents` 请求获取远程 Agent 列表后再聚合 Skill 条目
2. THE ClawHub SHALL 以卡片网格布局展示每个 Skill，卡片内容包含：技能名称、所属 Agent 名称、所属 Agent 状态标识（online/idle/busy/offline）
3. WHEN 多个 Agent 注册了名称完全相同（大小写敏感匹配）的技能时，THE ClawHub SHALL 将这些 Agent 聚合到同一张技能卡片中，并在卡片内列出所有提供该技能的 Agent 名称及其状态
4. WHEN Skill 列表为空时，THE ClawHub SHALL 显示空状态提示，指明当前 AgentRegistry 远程注册中心无已注册的技能
5. THE ClawHub SHALL 提供搜索输入框，WHEN 用户输入搜索文本时，THE ClawHub SHALL 对技能名称执行大小写不敏感的子字符串匹配，实时过滤并仅显示匹配的 Skill 卡片
6. IF API Key 未配置或 AgentRegistry 请求失败，THEN THE ClawHub SHALL 显示错误信息及重试按钮
7. IF 搜索过滤后无匹配结果，THEN THE ClawHub SHALL 显示无匹配结果的提示信息，区别于空列表状态
