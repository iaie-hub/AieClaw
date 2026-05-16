# extensions/agent-registry 启用与配置指南

`extensions/agent-registry` 是一个 OpenClaw Channel 插件，通过原生 NATS JetStream 将 OpenClaw 接入 Agent Registry 的 A2A（Agent-to-Agent）协作网络。启用后，OpenClaw 作为一个 Agent Worker 节点注册到 Registry，可接收并处理来自其他 Agent 的消息和协作任务。

---

## 前置条件

- OpenClaw 已安装并可正常运行（`pnpm openclaw` 或 `pnpm dev`）
- 可访问的 NATS 服务器（支持 JetStream），地址格式为 `nats://{host}:{port}`
- Agent Registry 服务已部署并监听 `registry.agent.register` subject

---

## 启用方式

插件通过环境变量驱动，**无需修改 OpenClaw 配置文件**。只要以下必填环境变量存在，插件即自动激活。

### 必填环境变量

| 变量名 | 说明 | 格式约束 |
|---|---|---|
| `AGENT_REGISTRY_NATS_URL` | NATS 服务器地址 | `nats://{host}:{port}`，端口 1–65535 |
| `AGENT_REGISTRY_AGENT_ID` | 本 Agent 的唯一标识符 | 最多 64 字符，仅限字母、数字、`-`、`_` |
| `AGENT_REGISTRY_AGENT_NAME` | 本 Agent 的显示名称 | 最多 128 字符 |

### 可选环境变量

| 变量名 | 说明 | 格式约束 |
|---|---|---|
| `AGENT_REGISTRY_NATS_TOKEN` | NATS 认证 Token | 最多 512 字符 |
| `AGENT_REGISTRY_SKILLS` | 向 Registry 声明的 Skill 名称列表 | 逗号分隔，每项最多 128 字符；缺省时 AgentCard 的 `skills` 为空数组 |
| `AGENT_REGISTRY_BOUND_AGENT_ID` | 绑定的 OpenClaw Agent ID | 最多 64 字符；缺省时绑定 OpenClaw 默认 Agent |

---

## 配置示例

### 最小配置（仅必填项）

```bash
export AGENT_REGISTRY_NATS_URL="nats://localhost:4222"
export AGENT_REGISTRY_AGENT_ID="my-openclaw-agent"
export AGENT_REGISTRY_AGENT_NAME="My OpenClaw Agent"
```

### 完整配置

```bash
export AGENT_REGISTRY_NATS_URL="nats://nats.example.com:4222"
export AGENT_REGISTRY_AGENT_ID="openclaw-prod-01"
export AGENT_REGISTRY_AGENT_NAME="OpenClaw Production Agent"
export AGENT_REGISTRY_NATS_TOKEN="your-nats-auth-token"
export AGENT_REGISTRY_SKILLS="coding-agent,summarize,github"
export AGENT_REGISTRY_BOUND_AGENT_ID="my-custom-agent-id"
```

### 写入 `.env` 文件

在 OpenClaw 项目根目录的 `.env` 文件中添加：

```dotenv
AGENT_REGISTRY_NATS_URL=nats://localhost:4222
AGENT_REGISTRY_AGENT_ID=my-openclaw-agent
AGENT_REGISTRY_AGENT_NAME=My OpenClaw Agent
# AGENT_REGISTRY_NATS_TOKEN=optional-token
# AGENT_REGISTRY_SKILLS=coding-agent,summarize
# AGENT_REGISTRY_BOUND_AGENT_ID=
```

---

## 启动流程说明

OpenClaw 启动时，插件按以下顺序执行：

1. **配置校验** — 读取并验证所有 `AGENT_REGISTRY_*` 环境变量；任何必填项缺失或格式错误时，Channel 状态设为 `unavailable` 并打印详细错误信息，不尝试连接 NATS。
2. **NATS 连接** — 连接到 `AGENT_REGISTRY_NATS_URL`；连接失败时状态设为 `unavailable`。断线后自动重连，退避策略：初始 1 秒，每次翻倍，上限 30 秒。
3. **向 Registry 注册** — 发布 AgentCard 到 `registry.agent.register`（request-reply，10 秒超时）；注册失败时状态设为 `unavailable`。
4. **订阅 Topics** — 订阅 Registry 分配的 Unicast、Multicast、Broadcast Topics。
5. **心跳保活** — 按 `TTL/3` 间隔向 `registry.agent.heartbeat` 发送心跳，维持注册有效期。
6. **就绪** — Channel 状态变为 `registered`，开始处理入站 A2A 消息。

### Channel 状态说明

| 状态 | 含义 |
|---|---|
| `connecting` | 正在建立 NATS 连接 |
| `registering` | 正在向 Registry 注册 |
| `registered` | 已注册，正常运行 |
| `reconnecting` | NATS 断线，正在重连 |
| `unavailable` | 配置错误或注册失败，不可用 |
| `disconnected` | 插件已停止 |

---

## AgentCard 构建规则

插件启动时自动构建 AgentCard 并提交给 Registry：

- **`agent_id`** — 取自 `AGENT_REGISTRY_AGENT_ID`
- **`name`** — 取自 `AGENT_REGISTRY_AGENT_NAME`
- **`transport`** — 固定为 `"mq"`
- **`mac`** — 固定为 `"00:00:00:00:00:00"`（不读取宿主机真实 MAC 地址）
- **`capabilities.longRunningOperations`** — 固定为 `true`
- **`skills`** — 仅包含 `AGENT_REGISTRY_SKILLS` 中列出的、已安装的 OpenClaw Skill；未配置时为空数组；列表中找不到对应 Skill 时打印警告并跳过该条目

---

## 消息路由行为

| 入站 Topic 类型 | 路由策略 |
|---|---|
| Unicast (`a2a.agent.unicast.{agentId}`) | 路由到以 `source` 字段为 key 的 Bound_Agent 会话；不存在则新建 |
| Multicast (`a2a.agent.group.{groupId}`) | 路由到活跃任务数最少的会话；不存在则新建 |
| Broadcast — `discussion.created` | 转发给 Collaboration_Arbiter 决策是否加入；同意则订阅 `a2a.discussion.{id}` 并发送 join |
| Broadcast — `cotask.created` | 转发给 Collaboration_Arbiter 决策是否加入及可提供的 Skills；同意则订阅 `a2a.cotask.{id}` 并发送 join |
| Discussion / Cotask topic | 路由到与该 topic id 关联的 Bound_Agent 会话 |

Collaboration_Arbiter 是一个长期存活的单一会话，顺序处理所有广播决策，每条广播最多等待 30 秒。

---

## 出站消息路由规则

| 场景 | 发布目标 |
|---|---|
| 入站消息含非空 `reply_to` | 发布到 `reply_to` subject（优先级最高） |
| 普通 Unicast 回复 | 发布到 `a2a.agent.unicast.{source}` |
| Discussion 回复 | 发布到 `a2a.discussion.{discussionId}`，`action` 为 `"message"` |
| Cotask 进行中回复 | 发布到 `a2a.cotask.{taskId}`，`action` 为 `"progress"` |
| Cotask 完成回复 | 发布到 `a2a.cotask.{taskId}`，`action` 为 `"complete"` |

---

## 停止与注销

OpenClaw 停止时，插件按以下顺序清理：

1. 停止心跳定时器
2. 释放 Collaboration_Arbiter 会话
3. 向 `registry.agent.deregister` 发送注销消息（5 秒超时，失败时仅打印日志）
4. 取消所有 Topic 订阅
5. Drain 飞行中消息（5 秒）
6. 关闭 NATS 连接

整个清理过程有 10 秒强制超时，超时后强制关闭连接。

---

## 常见问题

**Q: 配置了环境变量但 Channel 状态仍为 `unavailable`？**

检查 OpenClaw 日志中的 `[agent-registry]` 前缀条目。常见原因：
- `AGENT_REGISTRY_NATS_URL` 格式不符合 `nats://{host}:{port}`（端口必须是 1–65535 的整数）
- `AGENT_REGISTRY_AGENT_ID` 包含非法字符（只允许字母、数字、`-`、`_`）
- NATS 服务器不可达
- Registry 服务未运行或 `registry.agent.register` subject 无响应（10 秒超时）

**Q: `AGENT_REGISTRY_SKILLS` 中的某个 Skill 名称被跳过？**

该 Skill 名称在当前 OpenClaw 安装中找不到对应的已安装 Skill。检查 `pnpm openclaw skills list` 输出，确认 Skill 名称拼写正确。

**Q: 如何绑定到特定 Agent 而非默认 Agent？**

设置 `AGENT_REGISTRY_BOUND_AGENT_ID` 为目标 Agent 的 ID。所有入站 A2A 消息和协作决策都将路由到该 Agent。

**Q: 多个 OpenClaw 实例能否使用同一个 `AGENT_REGISTRY_AGENT_ID`？**

不建议。`agent_id` 在 Registry 中是全局唯一标识符，重复注册会导致 Topic 分配冲突。每个实例应使用不同的 `AGENT_REGISTRY_AGENT_ID`。
