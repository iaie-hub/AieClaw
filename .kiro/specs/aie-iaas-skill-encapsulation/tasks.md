# 实施计划：AIE IaaS Multi-Agent 编排系统

## 概述

以 5 个阶段递进实施：先搭建共享基础设施和 OpenClaw 多 Agent 配置，再逐个构建 4 个子 Agent 的 workspace（配置文件 + Python Skill 脚本 + SOP 定义），最后更新编排 Agent 的路由规则完成串联。所有 workspace 文件位于 `.openclaw/workspace-aieiaas-{role}/` 目录下。

## Tasks

- [x] 1. 共享基础设施 + OpenClaw 多 Agent 配置
  - [x] 1.1 创建共享 HTTP 客户端 `_lib/xstack_client.py`
    - 在 `.openclaw/workspace-aieiaas-resource/skills/_lib/` 下创建 `xstack_client.py`
    - 实现 `XstackClient` 类：`__init__`（环境变量校验）、`get`、`get_all`（pageSize=100 自动分页）、`post`、`put`、`delete`
    - 重试逻辑：HTTP 5xx / 网络异常 → 指数退避 1s→2s→4s，最多 3 次；4xx 不重试
    - 统一错误输出：`{"error": true, "statusCode": N, "message": "..."}`
    - _需求: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [x] 1.2 创建共享 ProgressReporter `_lib/progress.py`
    - 在 `.openclaw/workspace-aieiaas-resource/skills/_lib/` 下创建 `progress.py`
    - 实现 `ProgressReporter` 类：`start`（type=start, total）、`update`（type=item）、`log`（type=log）、`done`（type=done, succeeded/failed）
    - 每行包含 `skill` + `ts`（毫秒时间戳），写入后立即 flush
    - 进度文件路径：`~/.openclaw/agents/<agentId>/workspace/progress/<skill>.progress.jsonl`
    - _需求: 8.2.1, 8.2.2, 8.2.3, 8.2.4, 8.2.5, 8.2.6, 8.2.7, 8.2.8_

  - [x] 1.3 编写 `_lib/xstack_client.py` 单元测试
    - 测试分页循环（get_all）、重试逻辑、环境变量校验、错误格式
    - _需求: 7.1, 7.2, 7.3, 7.4_

  - [x] 1.4 编写 `_lib/progress.py` 单元测试
    - 测试 start/item/log/done 行格式、flush 即时性、文件路径生成
    - _需求: 8.2_

  - [x] 1.5 更新 OpenClaw 配置 `openclaw.json`，注册 5 个 Agent
    - 在 `.openclaw/openclaw.json` 的 `agents.list` 中添加 4 个子 Agent 条目：aieiaas-resource、aieiaas-model、aieiaas-task、aieiaas-monitor
    - 每个条目包含 id、name、workspace 路径、agentDir 路径
    - 确保 A2A 通信配置（tools.agentToAgent.enabled=true, allow 白名单包含全部 5 个 Agent）
    - 设置 sessions.visibility 为 "all"
    - _需求: 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 2. Checkpoint - 确认共享基础设施
  - 确保 `_lib/xstack_client.py` 和 `_lib/progress.py` 代码正确，openclaw.json 配置完整，如有疑问请询问用户。

- [x] 3. 资源管理 Agent（aie-iaas-resource）workspace 搭建
  - [x] 3.1 创建 workspace 配置文件
    - 创建 `.openclaw/workspace-aieiaas-resource/` 目录
    - 创建 `SOUL.md`：资源管理专家角色定义（xstack 计算/存储/网络资源管理）
    - 创建 `IDENTITY.md`：Agent 身份信息（ResourceAdmin）
    - 创建 `TOOLS.md`：环境变量配置备忘 + 可用 Skills 列表表格
    - _需求: 6.4_

  - [x] 3.2 创建 `AGENTS.md` 操作手册
    - 包含会话启动流程、记忆管理、核心职责
    - 定义创建云主机 SOP 的完整步骤指令（基础资源查询 → 配置确认 → 创建提交 → 异步任务追踪）
    - 包含条件分支说明和 Skill 调用规范（先 read SKILL.md 再 exec）
    - _需求: 2.6.1, 2.6.2, 2.6.3, 2.6.4, 2.6.5, 2.6.6_

  - [x] 3.3 创建 `SOP.json`（创建云主机）
    - 放置在 workspace 根目录，符合 SOPDefinition 接口
    - 包含 4 个步骤：resource_query（基础资源查询）→ resource_query（配置确认）→ vm_lifecycle（创建提交）→ job_query（异步任务追踪）
    - skill 字段值与 Python 脚本文件名一致（不含 .py）
    - _需求: 8.1.1, 8.1.2, 8.1.3, 8.1.4_

  - [x] 3.4 实现 `resource_query` Skill
    - 创建 `skills/resource_query/SKILL.md`：描述用法、参数、输出格式
    - 创建 `skills/resource_query/resource_query.py`：支持 --resource-type（vms/hosts/clusters/zones/volumes/storages/images/snapshots）、--query-type（list/detail/statistics/sub-resource）、--uuid、--sub-resource、--filters
    - 使用 `_lib/xstack_client.py` 进行 HTTP 调用
    - 支持 vms 和 hosts 的扩展子资源查询
    - _需求: 2.1.1, 2.1.2, 2.1.3, 2.1.4, 2.1.5_

  - [x] 3.5 实现 `vm_lifecycle` Skill
    - 创建 `skills/vm_lifecycle/SKILL.md` + `skills/vm_lifecycle/vm_lifecycle.py`
    - 支持 --action（start/stop/poweroff/reboot/suspend/resume/reset/create/rebuild/backup/recover/export/migrate）
    - 支持 --batch + --uuids 批量操作
    - 支持 --update-field（name/spec/ha-mode/owner）和 --delete-mode（recycle/expunge）
    - _需求: 2.2.1, 2.2.2, 2.2.3, 2.2.4, 2.2.5_

  - [x] 3.6 实现 `vm_hardware` Skill
    - 创建 `skills/vm_hardware/SKILL.md` + `skills/vm_hardware/vm_hardware.py`
    - 支持 --device-type（gpu/pci/usb/volume/nic）、--operation（attach/detach）
    - 支持 --nic-operation（bind-eip/unbind-eip/bind-vip/unbind-vip）
    - _需求: 2.3.1, 2.3.2_

  - [x] 3.7 实现 `storage_manage` Skill
    - 创建 `skills/storage_manage/SKILL.md` + `skills/storage_manage/storage_manage.py`
    - 支持 --target（main-storage/volume/snapshot）、--action（create/update/delete/attach/detach/resize/recover/revert）
    - 支持 --storage-type（local/nfs/ceph/ceph-rbd）
    - _需求: 2.4.1, 2.4.2, 2.4.3_

  - [x] 3.8 实现 `image_manage` Skill
    - 创建 `skills/image_manage/SKILL.md` + `skills/image_manage/image_manage.py`
    - 支持 --target（image/container-image/image-repository/container-image-repository）
    - 支持 --action（create/update/delete/recover/enable/disable）
    - _需求: 2.5.1, 2.5.2_

  - [x] 3.9 实现 `job_poll` Skill（资源 Agent 专用异步轮询）
    - 创建 `skills/job_poll/SKILL.md` + `skills/job_poll/job_poll.py`
    - 支持单次查询：`--job-id <uuid>`
    - 支持同步轮询：`--job-id <uuid> --poll --interval 10 --timeout 300`
    - 支持后台异步轮询：`--job-id <uuid> --poll --async --interval 10 --timeout 14400`
    - 异步模式：fork 后台进程，父进程立即返回，后台进程通过 ProgressReporter 写入 progress.jsonl
    - _需求: 2.6.4, 2.6.5, 2.6.6_

  - [x] 3.10 将 `_lib/` 目录复制到 resource Agent 的 skills 目录
    - 确保 `skills/_lib/xstack_client.py` 和 `skills/_lib/progress.py` 在 resource workspace 中可用
    - _需求: 7.1_

- [x] 4. Checkpoint - 确认资源管理 Agent
  - 确保所有 Skill 脚本语法正确，SKILL.md 描述完整，SOP.json 格式正确，如有疑问请询问用户。

- [x] 5. 模型服务 Agent（aie-iaas-model）workspace 搭建
  - [x] 5.1 创建 workspace 配置文件
    - 创建 `.openclaw/workspace-aieiaas-model/` 目录
    - 创建 `SOUL.md`：模型服务专家角色定义（模型仓库/推理服务/AI 网关/API Key 管理）
    - 创建 `IDENTITY.md`：Agent 身份信息（ModelAdmin）
    - 创建 `TOOLS.md`：环境变量配置备忘 + 可用 Skills 列表表格
    - _需求: 6.4_

  - [x] 5.2 创建 `AGENTS.md` 操作手册
    - 定义部署模型服务 SOP 完整步骤指令（含条件跳步逻辑：检查仓库→创建仓库→添加模型→下载→等待下载→发布→创建服务→启动→等待就绪）
    - 定义模型部署情况查询 SOP 步骤指令（模型筛选→服务发现→计算资源追踪→物理节点映射→拓扑汇总）
    - 包含 Skill 调用规范和条件分支说明
    - _需求: 3.5, 3.6_

  - [x] 5.3 创建 `SOP.json`（部署模型服务 + 模型部署情况查询）
    - 部署模型 SOP：8 个步骤（model_repository×3 + model_status_poll + model_repository + model_service×2 + model_service_probe）
    - 模型部署情况 SOP：5 个步骤（model_repository + model_service×2 + resource_query + gateway_manage）
    - 两个 SOP 定义放在同一个 SOP.json 文件中（数组格式）或分别放置
    - _需求: 8.1.1, 8.1.2, 8.1.3, 8.1.4_

  - [x] 5.4 实现 `model_repository` Skill
    - 创建 `skills/model_repository/SKILL.md` + `skills/model_repository/model_repository.py`
    - 支持 --action（create/update/delete/add-model/download/publish/unpublish/sync/query/detail/statistics/list-models/list-files）
    - 支持 --target（repository/model/dataset-repository/dataset）
    - _需求: 3.1.1, 3.1.2, 3.1.3, 3.1.4_

  - [x] 5.5 实现 `model_service` Skill
    - 创建 `skills/model_service/SKILL.md` + `skills/model_service/model_service.py`
    - 支持 --action（create/start/stop/delete/update/scale/query/detail/instances/api-info/served-names/alias/extra）
    - _需求: 3.2.1, 3.2.2, 3.2.3_

  - [x] 5.6 实现 `gateway_manage` Skill
    - 创建 `skills/gateway_manage/SKILL.md` + `skills/gateway_manage/gateway_manage.py`
    - 支持 --action（create/update/delete/sync/query/detail/add-sub-gateway/add-custom-service）
    - _需求: 3.3.1, 3.3.2, 3.3.3_

  - [x] 5.7 实现 `apikey_manage` Skill
    - 创建 `skills/apikey_manage/SKILL.md` + `skills/apikey_manage/apikey_manage.py`
    - 支持 --action（create/regenerate/update/update-config/delete/query/detail）
    - _需求: 3.4.1_

  - [x] 5.8 实现 `model_status_poll` Skill（模型下载状态轮询）
    - 创建 `skills/model_status_poll/SKILL.md` + `skills/model_status_poll/model_status_poll.py`
    - 定时查询 `GET /xstack/v1/model/repository/models`（按 uuid 过滤），间隔 30s，超时 4h
    - 支持 --async 后台模式：fork 后台进程，通过 ProgressReporter 报告轮询状态
    - 达到终态（Downloaded/DownloadFailed）后写入 done 行，并通过 `openclaw message send` 通知编排 Agent
    - _需求: 3.5.5, 3.5.6, 3.5.7, 3.5.8_

  - [x] 5.9 实现 `model_service_probe` Skill（模型服务健康探测）
    - 创建 `skills/model_service_probe/SKILL.md` + `skills/model_service_probe/model_service_probe.py`
    - 先查询 `GET /xstack/v1/model/service/api` 获取服务端点
    - 支持 --async 后台模式：定时尝试调用端点（如 `GET /v1/models`），间隔 30s，超时 4h
    - 通过 ProgressReporter 报告探测状态，服务就绪后通知编排 Agent
    - _需求: 3.5.9, 3.5.10, 3.5.11_

  - [x] 5.10 实现 `job_poll` Skill（模型 Agent 专用）
    - 创建 `skills/job_poll/SKILL.md` + `skills/job_poll/job_poll.py`
    - 与资源 Agent 的 job_poll 功能一致，复制并适配
    - _需求: 4.1_

  - [x] 5.11 复制 `_lib/` 到模型 Agent workspace
    - 确保 `skills/_lib/xstack_client.py` 和 `skills/_lib/progress.py` 可用
    - _需求: 7.1_

- [x] 6. Checkpoint - 确认模型服务 Agent
  - 确保所有 Skill 脚本语法正确，SOP.json 格式正确，AGENTS.md 中 SOP 条件分支逻辑完整，如有疑问请询问用户。

- [x] 7. 任务调度 Agent（aie-iaas-task）workspace 搭建
  - [x] 7.1 创建 workspace 配置文件
    - 创建 `.openclaw/workspace-aieiaas-task/` 目录
    - 创建 `SOUL.md`：任务调度专家角色定义
    - 创建 `IDENTITY.md`：Agent 身份信息（TaskAdmin）
    - 创建 `TOOLS.md`：环境变量配置备忘 + 可用 Skills 列表表格
    - _需求: 6.4_

  - [x] 7.2 创建 `AGENTS.md` 操作手册
    - 包含会话启动流程、记忆管理、核心职责（异步任务/脚本任务/执行器/定时任务管理）
    - 包含 Skill 调用规范
    - 任务调度 Agent 无 SOP，仅提供查询和管理能力
    - _需求: 4.1, 4.2, 4.3, 4.4_

  - [x] 7.3 实现 `job_query` Skill
    - 创建 `skills/job_query/SKILL.md` + `skills/job_query/job_query.py`
    - 支持单次查询：`--job-id <uuid>`
    - 支持同步轮询：`--poll --interval 10 --timeout 300`
    - 支持后台异步轮询：`--poll --async --interval 10 --timeout 14400`
    - 异步模式集成 ProgressReporter
    - _需求: 4.1.1, 4.1.2, 4.1.3, 4.1.4, 4.1.5_

  - [x] 7.4 实现 `task_job_manage` Skill
    - 创建 `skills/task_job_manage/SKILL.md` + `skills/task_job_manage/task_job_manage.py`
    - 支持 --action（create-script/create-command/start/stop/debug/update/query/detail/results/log/delete）
    - _需求: 4.2.1, 4.2.2_

  - [x] 7.5 实现 `executor_manage` Skill
    - 创建 `skills/executor_manage/SKILL.md` + `skills/executor_manage/executor_manage.py`
    - 支持 --action（create/start/stop/update/scale/config/query/detail/delete）
    - _需求: 4.3.1_

  - [x] 7.6 实现 `scheduler_manage` Skill
    - 创建 `skills/scheduler_manage/SKILL.md` + `skills/scheduler_manage/scheduler_manage.py`
    - 支持 --action（create/update/update-state/batch-update-state/query/detail/log/delete）
    - _需求: 4.4.1_

  - [x] 7.7 复制 `_lib/` 到任务调度 Agent workspace
    - 确保 `skills/_lib/xstack_client.py` 和 `skills/_lib/progress.py` 可用
    - _需求: 7.1_

- [x] 8. Checkpoint - 确认任务调度 Agent
  - 确保所有 Skill 脚本语法正确，SKILL.md 描述完整，如有疑问请询问用户。

- [x] 9. 监控 Agent（aie-iaas-monitor）workspace 搭建
  - [x] 9.1 创建 workspace 配置文件
    - 创建 `.openclaw/workspace-aieiaas-monitor/` 目录
    - 创建 `SOUL.md`：监控专家角色定义（硬件监控/告警/日志/模型调用统计）
    - 创建 `IDENTITY.md`：Agent 身份信息（MonitorAdmin）
    - 创建 `TOOLS.md`：环境变量配置备忘 + 可用 Skills 列表表格
    - _需求: 6.4_

  - [x] 9.2 创建 `AGENTS.md` 操作手册
    - 定义硬件设施监控 SOP 步骤指令（资源分配审计→实时状态统计→性能趋势监测→清单明细审计→结果汇总）
    - 定义模型调用统计 SOP 步骤指令（资源发现→统计数据检索→排行榜检索→结果汇总）
    - 包含 Skill 调用规范
    - _需求: 5.5, 5.6_

  - [x] 9.3 创建 `SOP.json`（硬件设施监控 + 模型调用统计）
    - 硬件监控 SOP：5 个步骤（monitor_query×5）
    - 模型调用统计 SOP：4 个步骤（gateway_statistics×4）
    - _需求: 8.1.1, 8.1.2, 8.1.3, 8.1.4_

  - [x] 9.4 实现 `monitor_query` Skill
    - 创建 `skills/monitor_query/SKILL.md` + `skills/monitor_query/monitor_query.py`
    - 支持 --query-type（overview/sys-graph/sys-moment）
    - 支持 --host-uuid、--start、--end 参数
    - _需求: 5.1.1, 5.1.2, 5.1.3_

  - [x] 9.5 实现 `alarm_query` Skill
    - 创建 `skills/alarm_query/SKILL.md` + `skills/alarm_query/alarm_query.py`
    - 支持 --query-type（message/message-graph/message-distribution/statistics）
    - 支持 --target（resource/event）、--action（query/detail/create/update/enable/disable/delete）
    - _需求: 5.2.1, 5.2.2, 5.2.3_

  - [x] 9.6 实现 `log_query` Skill
    - 创建 `skills/log_query/SKILL.md` + `skills/log_query/log_query.py`
    - 支持 --log-type（oplog/runlog）、--filters
    - _需求: 5.3.1, 5.3.2_

  - [x] 9.7 实现 `gateway_statistics` Skill
    - 创建 `skills/gateway_statistics/SKILL.md` + `skills/gateway_statistics/gateway_statistics.py`
    - 支持 --query-type（records/top-by-calls/top-by-tokens/apikey-top-calls/apikey-top-tokens/served-models/apikeys）
    - 支持 --start-time、--end-time、--model-name、--apikey-uuid、--gateway-uuid
    - _需求: 5.4.1, 5.4.2, 5.4.3_

  - [x] 9.8 复制 `_lib/` 到监控 Agent workspace
    - 确保 `skills/_lib/xstack_client.py` 和 `skills/_lib/progress.py` 可用
    - _需求: 7.1_

- [x] 10. Checkpoint - 确认监控 Agent
  - 确保所有 Skill 脚本语法正确，SOP.json 格式正确，如有疑问请询问用户。

- [x] 11. 编排 Agent 路由更新 + 最终集成
  - [x] 11.1 更新编排 Agent `AGENTS.md` 路由规则
    - 更新 `.openclaw/workspace-aieiaas/AGENTS.md`
    - 添加完整路由表（意图关键词 → 目标 Agent agentId → timeoutSeconds）
    - 添加 sessions_send 调度方式说明（同步查询/SOP 执行/多 Agent 串行）
    - 添加子 Agent 失败处理规则
    - _需求: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [x] 11.2 更新编排 Agent `SOUL.md`
    - 更新角色定义为编排中心（意图识别 + 任务分解 + 子 Agent 调度）
    - 明确编排 Agent 不直接调用 xstack API
    - _需求: 1.6_

  - [x] 11.3 更新编排 Agent `TOOLS.md`
    - 添加 sessions_send 工具用法说明
    - 更新可用 Skills 表格（编排 Agent 无 skills，仅通过 A2A 调度）
    - _需求: 1.2, 6.5_

- [x] 12. 最终 Checkpoint - 全系统验证
  - 确保所有 5 个 Agent workspace 配置完整，openclaw.json 注册正确，编排 Agent 路由规则覆盖全部 4 个子 Agent，所有 SOP.json 的 skill 字段与 Python 脚本文件名一致，如有疑问请询问用户。

## 备注

- 标记 `*` 的任务为可选任务，可跳过以加速 MVP 交付
- 每个任务引用了具体的需求编号以确保可追溯性
- `_lib/` 目录在各子 Agent workspace 中通过复制方式共享（也可后续改为符号链接）
- Checkpoint 任务确保阶段性验证，及时发现问题
- 所有 Skill 脚本使用 Python 3，依赖 `requests` 库
- 不修改 aiemas 核心代码（`aiemas/src/` 下的任何文件）
- SOPTracker、ProgressWatcher 和前端 sop-pipeline 组件已存在且正常工作，无需修改
