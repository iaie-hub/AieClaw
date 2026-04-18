# 需求文档：AIE IaaS Multi-Agent 编排系统

## 简介

构建以 aie-iaas 为编排中心的 Multi-Agent 系统，通过 OpenClaw A2A 机制（`sessions_send` / `sessions_spawn`）协调 4 个专业子 Agent 完成 xstack 云平台的 IaaS 资源管理。每个子 Agent 拥有独立的 workspace、Skill 脚本和 SOP 定义，不修改 aiemas 核心代码。

## Agent 拓扑

```
aie-iaas（编排 Agent）
├── aie-iaas-resource（资源管理 Agent）  ← xstack 2.1.1
├── aie-iaas-model（模型服务 Agent）     ← xstack 2.1.6
├── aie-iaas-task（任务调度 Agent）      ← xstack 2.1.5
└── aie-iaas-monitor（监控 Agent）       ← xstack 2.1.4 + SOP
```

## 术语表

- **编排 Agent（aie-iaas）**：顶层 Agent，负责意图识别、任务分解和子 Agent 调度，自身不直接调用 xstack API
- **子 Agent**：拥有独立 workspace 和 Skill 的专业 Agent，通过 A2A 接收编排 Agent 的指令
- **Skill**：Agent workspace 中 `skills/<name>/` 目录下的 Python 脚本 + SKILL.md，Agent 通过 `read` + `exec` 调用
- **SOP（标准作业程序）**：AGENTS.md 中定义的多步骤标准流程，Agent 按顺序调用多个 Skill 完成端到端业务
- **A2A（Agent-to-Agent）**：OpenClaw 的跨 Agent 通信机制，本系统统一使用 `sessions_send` 工具实现，支持同步等待回复和 Ping-Pong 多轮对话
- **xstack_API**：xstack 云平台 REST API，基础路径 `/xstack/v1/`
- **Pagination（分页）**：xstack 所有 GET 查询接口默认返回 25 条，Skill 需以 pageSize=100 循环获取
- **SOPTracker**：aiemas 中已有的 SOP 执行状态追踪组件，监听 tool call 事件匹配 SOP 步骤，广播 `sop.state` WebSocket 事件
- **ProgressWatcher**：aiemas 中已有的进度文件轮询组件，每 2 秒读取 progress.jsonl 新增行，广播 `skill.progress` WebSocket 事件
- **ProgressReporter**：Python 工具库（`_lib/progress.py`），Skill 脚本通过它写入 progress.jsonl 进度行（start/item/log/done）
- **progress.jsonl**：Skill 执行过程中写入的 JSONL 进度文件，路径为 `~/.openclaw/agents/<agentId>/workspace/progress/<skill>.progress.jsonl`

## 架构约束

1. 每个 Agent 是独立的 OpenClaw Agent，拥有独立的 workspace、agentDir 和 session store
2. 所有 Skill 以 Python 脚本实现，放置在各 Agent 的 `skills/` 目录下
3. 不修改 aiemas 核心代码（`aiemas/src/` 下的任何文件）
4. Agent 间协作统一通过 OpenClaw `sessions_send` A2A 机制实现（不使用 `sessions_spawn`）
5. 敏感配置（API URL、Token）通过环境变量传递
6. 只封装各 Agent 职责范围内 SOP 和查询所需的 API

---

## 需求 1：编排 Agent（aie-iaas）

**用户故事：** 作为 aiemas 平台用户，我希望通过一个统一入口向 aie-iaas 发送 IaaS 管理请求，由它自动识别意图并委派给对应的子 Agent 执行。

### 验收标准

1. WHEN 用户发送 IaaS 管理请求, THE aie-iaas SHALL 根据 AGENTS.md 中的路由规则将请求分类到资源管理、模型服务、任务调度、监控四个领域之一
2. WHEN aie-iaas 确定目标领域后, THE aie-iaas SHALL 通过 `sessions_send` 将任务委派给对应的子 Agent，使用同步模式（timeoutSeconds > 0）等待结果
3. WHEN 任务需要多个子 Agent 协作（如"部署模型并监控"）, THE aie-iaas SHALL 通过串行 `sessions_send` 按依赖顺序调度多个子 Agent
4. WHEN 子 Agent 返回结果后, THE aie-iaas SHALL 汇总结果并以结构化格式回复用户
5. IF 子 Agent 执行失败, THEN THE aie-iaas SHALL 向用户报告失败的子 Agent 和错误原因
6. THE aie-iaas 自身 SHALL NOT 直接调用任何 xstack API，所有 API 调用由子 Agent 完成

---

## 需求 2：资源管理 Agent（aie-iaas-resource）

**用户故事：** 作为运维人员，我希望通过资源管理 Agent 查询和管理 xstack 云平台的计算、存储、网络等基础资源。

### 2.1 资源查询 Skills

#### 验收标准

1. WHEN Agent 调用 resource_query Skill 并指定 --resource-type（vms、hosts、clusters、zones、volumes、storages、images、snapshots）和 --query-type 为 list, THE Skill SHALL 调用 `GET /xstack/v1/{resource_type}` 并自动分页返回完整列表
2. WHEN --query-type 为 detail 且提供 --uuid, THE Skill SHALL 调用 `GET /xstack/v1/{resource_type}/{uuid}` 返回详情
3. WHEN --query-type 为 statistics, THE Skill SHALL 调用 `GET /xstack/v1/{resource_type}/statistics` 返回聚合统计
4. THE Skill SHALL 支持 vms 的扩展查询：candidate-gpus、gpus、candidate-pci、pci-devices、candidate-volumes、nics、candidate-usb、usb、vnc-url、notebook、logs
5. THE Skill SHALL 支持 hosts 的扩展查询：aggregated-statistics、sys_graph、candidate-clusters、block-devices、nics、gpus、usb、devices、pci-devices、GPU 规格（`host/pci-devices/gpus/spec`）、GPU 统计（`pci-devices/gpus/statistics`）

### 2.2 VM 生命周期 Skill

#### 验收标准

1. WHEN Agent 调用 vm_lifecycle Skill 并指定 --action（start、stop、poweroff、reboot、suspend、resume、reset、create、rebuild、backup、recover、export、migrate）, THE Skill SHALL 调用对应的 `POST /xstack/v1/vms/{uuid}/{action}` 接口
2. WHEN --batch 标志被设置, THE Skill SHALL 调用批量接口 `POST /xstack/v1/vms/{action}` 并传入 --uuids
3. WHEN --action 为 create, THE Skill SHALL 调用 `POST /xstack/v1/vms` 并传入完整创建参数 JSON
4. THE Skill SHALL 支持 VM 信息更新：`PUT /xstack/v1/vms/{uuid}`（名称）、`PUT /xstack/v1/vms/{uuid}/spec`（规格）、`PUT /xstack/v1/vms/{uuid}/ha-mode`（HA）、`PUT /xstack/v1/vms/{uuid}/owner`（所有者）
5. THE Skill SHALL 支持 VM 删除：`DELETE /xstack/v1/vms/{uuid}`（回收站）、`DELETE /xstack/v1/vms/{uuid}/expunge`（彻底删除）

### 2.3 VM 硬件管理 Skill

#### 验收标准

1. WHEN Agent 调用 vm_hardware Skill 并指定 --device-type（gpu、pci、usb、volume、nic）和 --operation（attach、detach）, THE Skill SHALL 调用 `POST /xstack/v1/vms/{uuid}/{device_type}/{operation}`
2. THE Skill SHALL 支持网卡的弹性 IP 和虚拟 IP 绑定/解绑操作

### 2.4 存储管理 Skill

#### 验收标准

1. THE Skill SHALL 支持主存储的 CRUD：添加（local/nfs/ceph/ceph-rbd）、更新、删除、挂载/卸载集群
2. THE Skill SHALL 支持云盘的 CRUD：创建、更新、扩容、删除、恢复、挂载/卸载 VM
3. THE Skill SHALL 支持快照的 CRUD：创建、恢复、删除、查询快照链

### 2.5 镜像管理 Skill

#### 验收标准

1. THE Skill SHALL 支持 VM 镜像和容器镜像的查询、创建、更新、删除、恢复
2. THE Skill SHALL 支持镜像仓库和容器镜像仓库的管理

### 2.6 创建云主机 SOP

#### 验收标准

1. THE 创建云主机 SOP SHALL 包含以下步骤：基础资源查询 → 配置确认 → 创建提交 → 异步任务追踪
2. WHEN 执行基础资源查询, THE Agent SHALL 调用 resource_query 查询 zones、images、networks/l3、storages
3. WHEN 执行创建提交, THE Agent SHALL 调用 vm_lifecycle --action create 并传入配置参数
4. WHEN xstack API 返回 jobId, THE Agent SHALL 调用 job_poll 以后台异步模式启动轮询，立即向用户返回 jobId 和"创建已提交，后台追踪中"的确认消息
5. THE job_poll SHALL 在后台持续轮询 `GET /xstack/v1/jobs/{jobId}`（默认间隔 10s，最大超时 4h），直到状态为 Succeeded 或 Failed
6. WHEN job 达到终态, THE Agent SHALL 通过 progress.jsonl 写入 done 行，并主动向用户推送最终结果（成功/失败详情）

---

## 需求 3：模型服务 Agent（aie-iaas-model）

**用户故事：** 作为 AI 工程师，我希望通过模型服务 Agent 管理模型仓库、推理服务、AI 网关和 API Key，实现模型的全生命周期管理。

### 3.1 模型仓库管理 Skill

#### 验收标准

1. THE Skill SHALL 支持模型仓库 CRUD：`POST /xstack/v1/model/repository`（创建）、`PUT`（更新）、`DELETE`（删除）、`GET`（查询/详情/统计）
2. THE Skill SHALL 支持仓库模型操作：添加模型、下载模型、发布/取消发布、同步模型、查询模型列表和文件
3. THE Skill SHALL 支持大模型聚合查询：`GET /xstack/v1/model/models`（列表）、`GET /xstack/v1/model/models/{uuid}`（详情）
4. THE Skill SHALL 支持数据集仓库和数据集的完整 CRUD

### 3.2 模型服务管理 Skill

#### 验收标准

1. THE Skill SHALL 支持模型服务生命周期：创建、启动、停止、删除、更新、扩缩容
2. THE Skill SHALL 支持服务查询：列表、详情、实例列表、API 信息、已部署模型名称、别名、扩展信息
3. THE Skill SHALL 支持服务别名和扩展信息的创建/更新

### 3.3 AI 网关管理 Skill

#### 验收标准

1. THE Skill SHALL 支持网关 CRUD：创建、更新、删除、同步
2. THE Skill SHALL 支持子网关管理和自定义服务管理
3. THE Skill SHALL 支持网关统计查询：records、models/top-by-calls、models/top-by-tokens、api-keys/top-by-calls、api-keys/top-by-tokens

### 3.4 API Key 管理 Skill

#### 验收标准

1. THE Skill SHALL 支持 API Key CRUD：创建、重新生成、更新（信息/配置）、删除、查询

### 3.5 部署模型服务 SOP

#### 验收标准

1. THE 部署模型 SOP SHALL 包含以下完整步骤：检查模型仓库 → 创建模型仓库（条件） → 添加模型（条件） → 下载模型（条件） → 等待下载完成 → 发布模型（条件） → 创建模型服务 → 启动模型服务 → 等待服务就绪
2. WHEN 目标模型仓库已存在, THE Agent SHALL 跳过创建仓库步骤，直接使用已有仓库
3. WHEN 目标模型已存在于仓库中且状态为 Downloaded 或 Published, THE Agent SHALL 跳过添加模型和下载模型步骤
4. WHEN 目标模型状态为 Published, THE Agent SHALL 跳过发布步骤，直接创建模型服务
5. WHEN 执行下载模型步骤, THE Skill SHALL 调用下载 API 启动异步下载任务并立即返回
6. WHEN 等待下载完成步骤, THE Agent SHALL 以后台异步模式定时查询模型状态（`GET /xstack/v1/model/repository/models`，按 uuid 过滤），间隔 30s，最大超时 4h，直到模型状态变为 Downloaded 或 DownloadFailed；轮询期间 Agent session 不阻塞，达到终态后通过 `sessions_send` 异步通知编排 Agent
7. WHEN 下载完成（Downloaded）, THE 后台轮询进程 SHALL 通过 progress.jsonl 写入 done 行，并通过 `sessions_send` 通知编排 Agent 继续执行后续步骤
8. IF 模型下载失败（DownloadFailed）, THEN THE 后台轮询进程 SHALL 通过 `sessions_send` 通知编排 Agent 终止流程并向用户推送失败原因
9. WHEN 执行启动模型服务步骤, THE Skill SHALL 调用 start API 创建服务实例并立即返回
10. WHEN 等待服务就绪步骤, THE Agent SHALL 先查询服务 API 信息（`GET /xstack/v1/model/service/api`），然后以后台异步模式定时尝试调用该 API 端点（健康探测），间隔 30s，最大超时 4h；轮询期间 Agent session 不阻塞，服务就绪后通过 `sessions_send` 异步通知编排 Agent
11. IF 服务健康探测持续失败超过超时时间, THEN THE 后台轮询进程 SHALL 通过 `sessions_send` 通知编排 Agent 报告服务未就绪

### 3.6 模型部署情况查询 SOP

#### 验收标准

1. THE 部署情况 SOP SHALL 包含以下步骤：模型筛选 → 服务发现 → 计算资源追踪 → 物理节点映射 → 拓扑汇总
2. WHEN 执行计算资源追踪, THE Agent SHALL 查询 `model/service/{uuid}/instance` 和 `vms/{uuid}` 获取实例详情
3. WHEN 执行物理节点映射, THE Agent SHALL 通过 hostUuid 查询 `hosts/{uuid}` 获取物理机详情
4. WHEN 执行拓扑汇总, THE Agent SHALL 查询网关统计获取模型实时调用指标

---

## 需求 4：任务调度 Agent（aie-iaas-task）

**用户故事：** 作为运维人员，我希望通过任务调度 Agent 管理 xstack 平台的异步任务、脚本任务、执行器和定时任务。

### 4.1 Job 查询 Skill

#### 验收标准

1. THE Skill SHALL 支持任务状态查询：`GET /xstack/v1/jobs/{jobId}`
2. THE Skill SHALL 支持同步轮询模式：循环查询直到任务达到终态（Succeeded/Failed），支持 --interval 和 --timeout 参数
3. THE Skill SHALL 支持后台异步轮询模式（--async 标志）：启动后台进程持续轮询，立即返回 jobId 给调用方，通过 progress.jsonl 报告轮询进度
4. THE 后台异步模式 SHALL 支持长时间运行（最大超时 4h），轮询间隔可配置（默认 10s，模型下载建议 30s）
5. WHEN job 达到终态, THE 后台进程 SHALL 写入 progress.jsonl done 行（含 succeeded/failed 和最终状态详情）

### 4.2 脚本/命令任务管理 Skill

#### 验收标准

1. THE Skill SHALL 支持脚本任务 CRUD：创建（script/command）、启动、停止、调试、更新（任务/脚本/命令/资源/后台/调度）、查询（列表/详情/结果/日志/脚本/调度）、删除
2. THE Skill SHALL 支持任务结果和日志的查询：results、results/log、results/logfile

### 4.3 执行器管理 Skill

#### 验收标准

1. THE Skill SHALL 支持执行器 CRUD：创建、启动、停止、更新（信息/扩缩容/配置）、查询（列表/详情）、删除

### 4.4 定时任务管理 Skill

#### 验收标准

1. THE Skill SHALL 支持定时任务 CRUD：创建、更新（信息/状态）、批量更新状态、查询（列表/详情/日志）、删除

---

## 需求 5：监控 Agent（aie-iaas-monitor）

**用户故事：** 作为运维人员，我希望通过监控 Agent 查询硬件性能监控数据、告警信息和模型调用统计。

### 5.1 硬件监控查询 Skill

#### 验收标准

1. THE Skill SHALL 支持监控概览查询：`GET /xstack/v1/monitor`
2. THE Skill SHALL 支持系统图表查询：`GET /xstack/v1/monitor/sys_graph`
3. THE Skill SHALL 支持系统瞬时数据查询：`GET /xstack/v1/monitor/sys_moment`

### 5.2 告警查询 Skill

#### 验收标准

1. THE Skill SHALL 支持告警消息查询：message、message/graph、message/distribution
2. THE Skill SHALL 支持告警统计：`GET /xstack/v1/alarms/statistics`
3. THE Skill SHALL 支持资源告警配置 CRUD 和事件告警配置 CRUD

### 5.3 日志查询 Skill

#### 验收标准

1. THE Skill SHALL 支持操作日志查询：`GET /xstack/v1/oplog`
2. THE Skill SHALL 支持运行日志查询：`GET /xstack/v1/runlog`

### 5.4 网关统计查询 Skill

#### 验收标准

1. THE Skill SHALL 支持网关统计记录查询：records、指定网关 records
2. THE Skill SHALL 支持 Top 排行查询：models/top-by-calls、models/top-by-tokens、api-keys/top-by-calls、api-keys/top-by-tokens
3. THE Skill SHALL 支持已部署模型名称查询和 API Key 列表查询

### 5.5 硬件设施监控 SOP

#### 验收标准

1. THE 硬件监控 SOP SHALL 包含以下步骤：资源分配审计 → 实时状态统计 → 性能趋势监测 → 清单明细审计 → 结果汇总
2. WHEN 执行资源分配审计, THE Agent SHALL 查询 zones/statistics 获取 CPU/内存/GPU 分配率
3. WHEN 执行实时状态统计, THE Agent SHALL 查询 hosts/statistics 和 vms/statistics
4. WHEN 执行性能趋势监测, THE Agent SHALL 查询 monitor/sys_graph 获取 CPU、内存、GPU、网络、磁盘指标

### 5.6 模型调用统计 SOP

#### 验收标准

1. THE 模型统计 SOP SHALL 包含以下步骤：资源发现 → 统计数据检索 → 排行榜检索 → 结果汇总
2. WHEN 执行资源发现, THE Agent SHALL 查询已部署模型名称和 API Key 列表
3. WHEN 执行统计数据检索, THE Agent SHALL 查询网关统计 records
4. WHEN 执行排行榜检索, THE Agent SHALL 查询 top-by-calls 和 top-by-tokens

---

## 需求 6：Multi-Agent 配置与协作

**用户故事：** 作为系统管理员，我希望所有 Agent 在 OpenClaw Gateway 中正确注册并配置 A2A 权限，实现安全的跨 Agent 协作。

### 验收标准

1. THE OpenClaw 配置 SHALL 注册 5 个 Agent：aieiaas（编排）、aieiaas-resource、aieiaas-model、aieiaas-task、aieiaas-monitor
2. THE 配置 SHALL 启用 agentToAgent 并将所有 5 个 Agent 加入 allow 白名单
3. THE 配置 SHALL 设置 sessions.visibility 为 "all" 以允许跨 Agent 通信
4. EACH 子 Agent SHALL 拥有独立的 workspace 目录（`~/.openclaw/workspace-aieiaas-{role}/`）
5. THE 编排 Agent 统一使用 `sessions_send`（A2A 通信）调度子 Agent，支持同步等待（timeoutSeconds=30~120 视操作复杂度）和 Ping-Pong 多轮对话模式

---

## 需求 7：共享基础设施

**用户故事：** 作为系统开发者，我希望所有子 Agent 共享统一的 HTTP 客户端和分页/重试逻辑，避免重复代码。

### 验收标准

1. ALL 子 Agent SHALL 共享 `_lib/xstack_client.py` HTTP 客户端模块，提供 get/get_all/post/put/delete 方法
2. THE get_all 方法 SHALL 以 pageSize=100 自动循环获取所有分页数据
3. IF xstack API 返回 HTTP 5xx 或网络超时, THEN THE 客户端 SHALL 进行最多 3 次指数退避重试（1s/2s/4s）
4. IF xstack API 返回 HTTP 4xx, THEN THE 客户端 SHALL 不重试，直接返回错误
5. ALL Skill 脚本 SHALL 通过环境变量 AIE_IAAS_API_URL 和 AIE_IAAS_API_TOKEN 获取 API 配置
6. ALL Skill 脚本的错误输出 SHALL 统一为 JSON 格式：`{"error": true, "statusCode": N, "message": "..."}`

---

## 需求 8：SOP 可视化与 SOPTracker/ProgressWatcher 集成

**用户故事：** 作为用户，我希望在前端实时看到 SOP 执行的全貌——当前处于哪个步骤、每个 Skill 执行了多久、内部进度日志——而非只能等待最终结果。

### 8.1 SOP.json 定义

#### 验收标准

1. EACH SOP SHALL 提供符合 SOPDefinition 接口的 SOP.json 文件，放置在对应子 Agent 的 workspace 根目录下
2. THE SOP.json SHALL 包含 name（英文标识）、label（中文显示名）和 steps 数组
3. EACH step SHALL 包含 skill（Skill 脚本文件名，去掉 .py 后缀）、label（中文步骤名称）和 icon 字段
4. THE skill 字段值 SHALL 与 SOPTracker 的 tool name 匹配规则一致：SOPTracker 从 `exec` 命令中正则提取 `/([a-z_]+)\.py`，因此 skill 值必须等于 Python 脚本文件名（不含 .py）

### 8.2 Skill 进度报告（progress.jsonl）

#### 验收标准

1. EACH 耗时 Skill 脚本 SHALL 通过共享的 `_lib/progress.py` ProgressReporter 写入 progress.jsonl 文件
2. THE progress.jsonl 路径 SHALL 为 `~/.openclaw/agents/<agentId>/workspace/progress/<skill>.progress.jsonl`
3. THE ProgressReporter SHALL 支持四种行类型：start（声明总量）、item（单项进度）、log（自由文本日志）、done（执行完成）
4. EACH 进度行 SHALL 包含 skill（字符串）和 ts（毫秒时间戳）字段
5. THE start 行 SHALL 包含 total（总项数）和可选 label
6. THE item 行 SHALL 包含 index（当前项索引）和可选 pct、status、message
7. THE done 行 SHALL 包含 succeeded 和 failed 计数
8. THE ProgressReporter SHALL 每次写入后立即 flush，确保 ProgressWatcher 下次轮询可读
9. IF Skill 使用多线程, THEN THE 调用方 SHALL 通过 threading.Lock 保护 ProgressReporter 调用

### 8.3 SOPTracker 集成

#### 验收标准

1. THE SOPTracker SHALL 通过 `loadSOP(workspaceDir, agentId)` 从子 Agent workspace 加载 SOP.json
2. THE SOPTracker SHALL 监听 `stream:tool` 事件，从 exec 命令中提取 skill 名称并匹配 SOP 步骤
3. WHEN SOP 步骤状态变更, THE SOPTracker SHALL 通过回调触发 `sop.state` WebSocket 事件广播
4. THE `sop.state` 事件 payload SHALL 包含 sessionKey、sopName、sopLabel、steps[]（含 status/startedAt/completedAt/elapsed）、currentStepIndex

### 8.4 ProgressWatcher 集成

#### 验收标准

1. WHEN Skill 开始执行（tool phase=start）, THE ProgressWatcher SHALL 开始轮询对应的 progress.jsonl 文件
2. THE ProgressWatcher SHALL 每 2 秒轮询一次，使用字节偏移量增量读取新行
3. WHEN 读取到新的进度行, THE ProgressWatcher SHALL 通过回调触发 `skill.progress` WebSocket 事件广播
4. WHEN 读取到 type=done 行, THE ProgressWatcher SHALL 自动停止轮询
5. WHEN Skill 执行完成（tool phase=result）, THE ProgressWatcher SHALL 停止轮询

### 8.5 前端可视化

#### 验收标准

1. THE 前端 SHALL 在消息列表顶部渲染 `<sop-pipeline>` 组件，展示 SOP 步骤列表（图标 + 标签 + 状态 + 耗时）
2. THE 前端 SHALL 在当前 running 步骤下方展示进度条（completed/total + 百分比）
3. THE 前端 SHALL 提供可折叠日志面板展示最近进度日志
4. THE 前端 SHALL 支持 WebSocket 重连后通过 `session.run.state` RPC 恢复 SOP 状态
