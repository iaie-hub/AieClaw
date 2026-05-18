# OpenClaw WebSocket API

本文档详列了 OpenClaw Gateway 支持的所有 WebSocket RPC 方法（命令）和推送事件。

> [!NOTE]
> 这里的命令和事件基于 OpenClaw 核心以及 `aiemas` (MAS4S) 扩展插件的组合。

---

## 协议概览

所有 WebSocket 消息均为 JSON 格式，包含三种类型：

- `req`: 客户端请求 (RPC)
- `res`: 服务端响应
- `event`: 服务端主动推送的事件

详情参考 [OpenClaw Protocol](./openclaw_protocol)。

---

## 一、所有 RPC 命令 (Methods Index)

### 1. 聊天与消息 (Chat & Messaging)

| 方法           | 说明                          | 处理程序  |
| :------------- | :---------------------------- | :-------- |
| `chat.send`    | 发送聊天消息并启动 Agent 运行 | `chat.ts` |
| `chat.history` | 获取会话历史记录              | `chat.ts` |
| `chat.abort`   | 中止正在进行的 Agent 运行     | `chat.ts` |
| `send`         | 通用消息发送接口（底层）      | `send.ts` |
| `talk.speak`   | 文字转语音并播放              | `talk.ts` |
| `talk.mode`    | 切换对话模式                  | `talk.ts` |
| `talk.config`  | 获取/设置对话配置             | `talk.ts` |

### 2. 会话管理 (Session Management)

| 方法                          | 说明                       | 处理程序      |
| :---------------------------- | :------------------------- | :------------ |
| `sessions.list`               | 列出所有会话               | `sessions.ts` |
| `sessions.create`             | 创建新会话                 | `sessions.ts` |
| `sessions.delete`             | 删除会话                   | `sessions.ts` |
| `sessions.subscribe`          | 订阅会话状态变更           | `sessions.ts` |
| `sessions.unsubscribe`        | 取消订阅                   | `sessions.ts` |
| `sessions.messages.subscribe` | 订阅会话消息流             | `sessions.ts` |
| `sessions.preview`            | 预览会话内容               | `sessions.ts` |
| `sessions.patch`              | 修改会话元数据             | `sessions.ts` |
| `sessions.reset`              | 重置会话状态               | `sessions.ts` |
| `sessions.compact`            | 压缩/清理会话记录          | `sessions.ts` |
| `sessions.abort`              | 中止会话运行               | `sessions.ts` |
| `session.history.range`       | [MAS] 分页获取精确历史记录 | `aiemas`      |
| `session.invite`              | [MAS] 邀请用户加入会话     | `aiemas`      |
| `session.removeMember`        | [MAS] 从会话中移除成员     | `aiemas`      |
| `session.members`             | [MAS] 列出会话成员列表     | `aiemas`      |
| `session.leave`               | [MAS] 退出协作会话         | `aiemas`      |
| `session.archive`             | [MAS] 归档会话             | `aiemas`      |
| `session.unarchive`           | [MAS] 取消归档             | `aiemas`      |
| `session.summary.generate`    | [MAS] 生成会话摘要         | `aiemas`      |
| `session.summary.get`         | [MAS] 获取会话摘要         | `aiemas`      |
| `session.label.get`           | [MAS] 获取会话标签         | `aiemas`      |
| `session.label.list`          | [MAS] 列出所有会话标签     | `aiemas`      |

### 3. 用户与认证 (User & Auth)

| 方法            | 说明                       | 处理程序 |
| :-------------- | :------------------------- | :------- |
| `auth.login`    | [MAS] 用户登录（获取 JWT） | `aiemas` |
| `auth.refresh`  | [MAS] 刷新 Token           | `aiemas` |
| `auth.verify`   | [MAS] 验证 Token 有效性    | `aiemas` |
| `user.register` | [MAS] 注册新用户           | `aiemas` |
| `user.list`     | [MAS] 列出租户下的用户     | `aiemas` |
| `user.update`   | [MAS] 更新用户信息/角色    | `aiemas` |
| `user.approve`  | [MAS] 审批挂起的用户       | `aiemas` |
| `user.reject`   | [MAS] 拒绝/侧视用户        | `aiemas` |
| `user.logout`   | [MAS] 用户登出             | `aiemas` |

### 4. Agent 与 插件管理 (Agents & Skills)

| 方法                          | 说明                               | 处理程序           |
| :---------------------------- | :--------------------------------- | :----------------- |
| `agents.list`                 | 列出可用 Agent                     | `agents.ts`        |
| `agents.create`               | 创建 Agent                         | `agents.ts`        |
| `agents.update`               | 更新 Agent 配置                    | `agents.ts`        |
| `agents.delete`               | 删除 Agent                         | `agents.ts`        |
| `agents.files.list`           | 列出 Agent 关联文件                | `agents.ts`        |
| `agents.files.get`            | 读取 Agent 文件内容                | `agents.ts`        |
| `agents.files.set`            | 写入 Agent 文件内容                | `agents.ts`        |
| `aiemas.agents.preDelete`     | [MAS] 删除前检查关联会话           | `aiemas`           |
| `aiemas.agents.export`        | [MAS] 导出 Agent 工作区为 zip      | `aiemas`           |
| `aiemas.agents.import`        | [MAS] 导入 Agent 压缩包            | `aiemas`           |
| `aiemas.files.download`       | [MAS] 下载服务端文件（base64）     | `aiemas`           |
| `aiemas.file.upload`          | [MAS] 上传文件到临时目录（base64） | `aiemas`           |
| `aiemas.agents.topology.list` | [MAS] 查询智能体拓扑关系           | `aiemas`           |
| `aiemas.agents.topology.save` | [MAS] 保存智能体拓扑关系           | `aiemas`           |
| `tools.catalog`               | 内容工具包目录                     | `tools-catalog.ts` |
| `tools.effective`             | 当前生效工具                       | `tools-catalog.ts` |
| `skills.status`               | 插件状态                           | `skills.ts`        |
| `skills.bins`                 | 插件二进制文件                     | `skills.ts`        |
| `skills.install`              | 安装插件                           | `skills.ts`        |
| `skills.update`               | 更新插件                           | `skills.ts`        |

### 5. 系统、配置与治理 (System & Config)

| 方法              | 说明                   | 处理程序      |
| :---------------- | :--------------------- | :------------ |
| `health`          | 健康检查               | `health.ts`   |
| `status`          | 获取 Gateway 综合状态  | `health.ts`   |
| `system.status`   | [MAS] MAS 系统运行状态 | `aiemas`      |
| `aiemas.fs.list`  | [MAS] 列出目录直接子项 | `aiemas`      |
| `usage.status`    | 配额使用统计           | `health.ts`   |
| `usage.cost`      | 消耗统计               | `health.ts`   |
| `config.get`      | 获取配置项             | `config.ts`   |
| `config.set`      | 设置配置项             | `config.ts`   |
| `config.apply`    | 应用配置变更           | `config.ts`   |
| `config.patch`    | 增量修改配置           | `config.ts`   |
| `config.schema`   | 获取配置 Schema        | `config.ts`   |
| `logs.tail`       | 实时查看 Gateway 日志  | `logs.ts`     |
| `channels.status` | 渠道连接状态           | `channels.ts` |
| `channels.logout` | 注销渠道连接           | `channels.ts` |
| `tts.status`      | TTS 引擎状态           | `tts.ts`      |
| `tts.convert`     | TTS 转换               | `tts.ts`      |
| `cron.list`       | 列出定时任务           | `cron.ts`     |
| `cron.run`        | 运行定时任务           | `cron.ts`     |
| `secrets.reload`  | 重新加载机密           | `secrets.ts`  |
| `update.run`      | 触发系统更新           | `update.ts`   |

### 6. 节点、设备与协作 (Node & Pairing)

| 方法                    | 说明                 | 处理程序           |
| :---------------------- | :------------------- | :----------------- |
| `node.list`             | 列出计算节点         | `nodes.ts`         |
| `node.pair.request`     | 请求节点配对         | `nodes.ts`         |
| `node.pair.approve`     | 批准节点配对         | `nodes.ts`         |
| `device.pair.list`      | 列出配对设备         | `devices.ts`       |
| `device.pair.approve`   | 批准设备连接         | `devices.ts`       |
| `device.pair.remove`    | 移除设备关联         | `devices.ts`       |
| `exec.approval.request` | 手动请求审批         | `exec-approval.ts` |
| `exec.approval.resolve` | 决策审批 (批准/拒绝) | `exec-approval.ts` |

---

## 二、所有推送事件 (Events Index)

### 1. 通讯与核心状态

| 事件                | 说明                   |
| :------------------ | :--------------------- |
| `connect.challenge` | 连接挑战（握手第一步） |
| `heartbeat`         | 维持连接的心跳         |
| `tick`              | 服务端时间戳同步       |
| `health`            | 健康状态更新           |
| `presence`          | 设备/节点在线状态变更  |
| `shutdown`          | 服务端即将关闭通知     |
| `update.available`  | 发现新版本更新         |

### 2. 消息与执行过程

| 事件               | 说明                                       |
| :----------------- | :----------------------------------------- |
| `chat`             | 流式消息输出（用于 Agent 回复）            |
| `agent`            | Agent 内部执行状态追踪（如思考、执行工具） |
| `session.message`  | 会话中产生新消息持久化通知                 |
| `session.tool`     | 工具调用事件通知                           |
| `sessions.changed` | 会话列表或元数据发生变更                   |

### 3. Aiemas (MAS4S) 协作事件

| 事件                      | 说明                          |
| :------------------------ | :---------------------------- |
| `user.presence`           | 租户内协同用户的在线状态变更  |
| `session.joined`          | 当前用户被邀请加入某会话      |
| `session.removed`         | 当前用户被移出会话            |
| `session.archived`        | 会话归档通知                  |
| `session.unarchived`      | 会话取消归档通知              |
| `session.summary.updated` | 会话摘要完成更新              |
| `topology.changed`        | Agent 拓扑关系变更通知        |
| `collab.message`          | 实时协作消息（讨论/协同任务） |

### 4. 审批、安全与自动化

| 事件                      | 说明                     |
| :------------------------ | :----------------------- |
| `exec.approval.requested` | 收到新的工具执行审批请求 |
| `exec.approval.resolved`  | 审批请求已处理通知       |
| `node.pair.requested`     | 收到新的节点配对请求     |
| `device.pair.requested`   | 收到新的设备配对请求     |
| `cron`                    | 定时任务运行状态通知     |
| `voicewake.changed`       | 语音唤醒配置变更         |

---

## 三、RPC 方法详细示例 (Typical RPC Detail)

### 1. 聊天发送 (chat.send)

```json
{
  "type": "req",
  "id": "chat_1",
  "method": "chat.send",
  "params": {
    "sessionKey": "main",
    "message": "你好",
    "idempotencyKey": "uuid-123"
  }
}
```

### 2. 获取分页历史 (session.history.range)

```json
{
  "type": "req",
  "id": "5",
  "method": "session.history.range",
  "params": {
    "sessionKey": "main",
    "page": 1,
    "pageSize": 50
  }
}
```

### 3. 删除前检查 (aiemas.agents.preDelete)

请求：

```json
{
  "type": "req",
  "id": "10",
  "method": "aiemas.agents.preDelete",
  "params": { "agentId": "agent-abc123" }
}
```

成功响应（可安全删除）：

```json
{
  "type": "res",
  "id": "10",
  "ok": true,
  "payload": { "ok": true }
}
```

失败响应（存在关联会话）：

```json
{
  "type": "res",
  "id": "10",
  "ok": false,
  "error": { "code": "AGENT_IN_USE", "message": "该智能体仍有 2 个关联会话，无法删除" }
}
```

### 4. 列出工作区目录 (aiemas.fs.list)

请求：

```json
{
  "type": "req",
  "id": "11",
  "method": "aiemas.fs.list",
  "params": { "dirPath": "/home/user/.openclaw/agents/agent-abc123" }
}
```

响应：

```json
{
  "type": "res",
  "id": "11",
  "ok": true,
  "payload": {
    "entries": [
      { "name": "agent.json", "type": "file", "size": 1024 },
      { "name": "skills", "type": "directory", "size": 0 }
    ]
  }
}
```

### 5. 导出智能体 (aiemas.agents.export)

请求：

```json
{
  "type": "req",
  "id": "12",
  "method": "aiemas.agents.export",
  "params": {
    "agentId": "agent-abc123",
    "workspace": "/home/user/.openclaw/agents/agent-abc123",
    "items": ["agent.json", "skills"]
  }
}
```

响应：

```json
{
  "type": "res",
  "id": "12",
  "ok": true,
  "payload": { "archivePath": "/home/user/.openclaw/agents/agent-abc123-export.zip" }
}
```

### 6. 下载文件 (aiemas.files.download)

请求：

```json
{
  "type": "req",
  "id": "13",
  "method": "aiemas.files.download",
  "params": { "filePath": "/home/user/.openclaw/agents/agent-abc123-export.zip" }
}
```

响应：

```json
{
  "type": "res",
  "id": "13",
  "ok": true,
  "payload": {
    "data": "UEsDBBQAAAAI...",
    "fileName": "agent-abc123-export.zip",
    "mimeType": "application/octet-stream"
  }
}
```

### 7. 上传文件 (aiemas.file.upload)

请求：

```json
{
  "type": "req",
  "id": "14",
  "method": "aiemas.file.upload",
  "params": {
    "fileName": "agent-abc123-export.zip",
    "data": "UEsDBBQAAAAI..."
  }
}
```

响应：

```json
{
  "type": "res",
  "id": "14",
  "ok": true,
  "payload": { "filePath": "/tmp/aiemas-upload-x7k2m/agent-abc123-export.zip" }
}
```

### 8. 导入智能体 (aiemas.agents.import)

请求：

```json
{
  "type": "req",
  "id": "15",
  "method": "aiemas.agents.import",
  "params": { "archivePath": "/tmp/aiemas-upload-x7k2m/agent-abc123-export.zip" }
}
```

响应：

```json
{
  "type": "res",
  "id": "15",
  "ok": true,
  "payload": {
    "id": "agent-xyz789",
    "name": "agent-abc123-export",
    "workspace": "/home/user/.openclaw/agents/agent-xyz789",
    "model": { "primary": "claude-sonnet-4-5", "fallbacks": [] }
  }
}
```

---

## 四、事件详细示例 (Typical Event Detail)

### 1. 聊天流消息 (chat)

```json
{
  "type": "event",
  "method": "chat",
  "params": {
    "runId": "run_123",
    "sessionKey": "main",
    "state": "delta",
    "message": { "text": "你好" }
  }
}
```

### 2. 用户在线状态 (user.presence)

```json
{
  "type": "event",
  "method": "user.presence",
  "params": {
    "userId": "user_456",
    "tenantId": "default",
    "isOnline": true,
    "ts": 1711618000000
  }
}
```

### 3. 拓扑变更通知 (topology.changed)

当 Agent 拓扑关系被保存（`aiemas.agents.topology.save`）并完成会话级联同步后，服务端向所有在线客户端推送此事件。

```json
{
  "type": "event",
  "event": "topology.changed",
  "payload": {
    "rootAgentId": "aieiaas",
    "edges": [
      { "from": "aieiaas", "to": "aieiaas-model" },
      { "from": "aieiaas", "to": "aieiaas-monitor" },
      { "from": "aieiaas", "to": "aieiaas-resource" }
    ]
  }
}
```

### 4. 实时协作消息 (collab.message)

当 Agent 之间发生 A2A 协作（讨论或协同任务）时，网关将 NATS 协作消息实时广播给所有连接的 mas4s UI 客户端。

- **触发时机**：NATS topic `a2a.discussion.*` 或 `a2a.cowork.*` 上有消息到达时
- **方向**：服务端 → 所有已连接客户端（仅推送，无需客户端订阅）

```json
{
  "type": "event",
  "event": "collab.message",
  "payload": {
    "topic": "a2a.discussion.disc-abc123",
    "data": {
      "sender": { "agentId": "aieiaas", "tenantId": "default" },
      "recipients": ["aieiaas-model"],
      "messageType": "request",
      "body": "请分析当前数据集的特征分布…"
    }
  }
}
```

| 字段            | 类型   | 说明                                                                    |
| :-------------- | :----- | :---------------------------------------------------------------------- |
| `payload.topic` | string | 完整的 NATS topic，如 `a2a.discussion.disc-abc` / `a2a.cowork.task-xyz` |
| `payload.data`  | object | 原始的 AgentRegistry 消息信封（RegistryEnvelope），结构由协作协议定义   |

---

## 五、拓扑关系 API (Topology API Detail)

### 1. 查询拓扑关系 (aiemas.agents.topology.list)

查询智能体拓扑关系。

**权限**: admin, member, viewer

**请求参数**:

| 参数        | 类型   | 必填 | 说明                                                      |
| ----------- | ------ | ---- | --------------------------------------------------------- |
| rootAgentId | string | 否   | 根 Agent ID。提供时返回单棵拓扑树，不提供时返回所有拓扑树 |

**请求示例**（按根节点查询）：

```json
{
  "type": "req",
  "id": "20",
  "method": "aiemas.agents.topology.list",
  "params": { "rootAgentId": "aie-iaas" }
}
```

**响应示例**（提供 `rootAgentId` 时）：

```json
{
  "type": "res",
  "id": "20",
  "ok": true,
  "payload": {
    "rootAgentId": "aie-iaas",
    "topology": {
      "edges": [
        { "from": "aie-iaas", "to": "aieiaas-resource" },
        { "from": "aie-iaas", "to": "aieiaas-model" }
      ]
    }
  }
}
```

**请求示例**（查询所有拓扑树）：

```json
{
  "type": "req",
  "id": "21",
  "method": "aiemas.agents.topology.list",
  "params": {}
}
```

**响应示例**（未提供 `rootAgentId` 时）：

```json
{
  "type": "res",
  "id": "21",
  "ok": true,
  "payload": {
    "topologies": [
      {
        "rootAgentId": "aie-iaas",
        "topology": {
          "edges": [
            { "from": "aie-iaas", "to": "aieiaas-resource" },
            { "from": "aie-iaas", "to": "aieiaas-model" }
          ]
        }
      }
    ]
  }
}
```

**响应示例**（指定的 `rootAgentId` 不存在拓扑数据时）：

```json
{
  "type": "res",
  "id": "20",
  "ok": true,
  "payload": {
    "rootAgentId": "xxx",
    "topology": { "edges": [] }
  }
}
```

### 2. 保存拓扑关系 (aiemas.agents.topology.save)

保存智能体拓扑关系（整棵树覆盖写入）。

**权限**: admin, member

**请求参数**:

| 参数           | 类型   | 必填 | 说明                                       |
| -------------- | ------ | ---- | ------------------------------------------ |
| rootAgentId    | string | 是   | 根 Agent ID                                |
| topology       | object | 是   | 拓扑树文档                                 |
| topology.edges | array  | 是   | 有向边数组，每条边包含 `from` 和 `to` 字段 |

**请求示例**：

```json
{
  "type": "req",
  "id": "22",
  "method": "aiemas.agents.topology.save",
  "params": {
    "rootAgentId": "aie-iaas",
    "topology": {
      "edges": [
        { "from": "aie-iaas", "to": "aieiaas-resource" },
        { "from": "aie-iaas", "to": "aieiaas-model" },
        { "from": "aie-iaas", "to": "aieiaas-task" }
      ]
    }
  }
}
```

**成功响应**：

```json
{
  "type": "res",
  "id": "22",
  "ok": true,
  "payload": { "ok": true }
}
```

**错误码**:

| 错误码            | 说明                                                                    |
| ----------------- | ----------------------------------------------------------------------- |
| INVALID_PARAMS    | rootAgentId 为空、topology 缺失、或 edges 中存在自引用边（from === to） |
| PERMISSION_DENIED | 角色权限不足（viewer 无写权限）                                         |

**错误响应示例**（自引用边）：

```json
{
  "type": "res",
  "id": "22",
  "ok": false,
  "error": { "code": "INVALID_PARAMS", "message": "自引用边不允许" }
}
```

**错误响应示例**（权限不足）：

```json
{
  "type": "res",
  "id": "22",
  "ok": false,
  "error": { "code": "PERMISSION_DENIED", "message": "权限不足" }
}
```

---

## 六、Session 级联 API (Session Cascade API Detail)

### 1. 级联创建 Session (aiemas.sessions.create)

级联创建 session：若 `agentId` 是 TopologyCache 中已知的根 Agent，则同时为根 Agent 及其所有后代 Agent 创建 session；否则仅为该 Agent 自身创建 session。

**权限**: admin, member

**请求参数**:

| 参数    | 类型   | 必填 | 说明                                         |
| ------- | ------ | ---- | -------------------------------------------- |
| agentId | string | 是   | 目标 Agent ID（可以是根 Agent 或普通 Agent） |
| label   | string | 否   | 用户可读的 session 标签                      |

**请求示例**（根 Agent，触发级联）：

```json
{
  "type": "req",
  "id": "30",
  "method": "aiemas.sessions.create",
  "params": {
    "agentId": "aie-iaas",
    "label": "生产环境会话"
  }
}
```

**成功响应**：

```json
{
  "type": "res",
  "id": "30",
  "ok": true,
  "payload": {
    "sessionKey": "agent:aie-iaas:group:mas-d4548844",
    "sessionId": "sess-uuid-root-001"
  }
}
```

> 响应返回根 Agent 的 `sessionKey` 和 `sessionId`。后代 Agent 的 session 在后台自动创建，共享相同的 `sessionUuid`（即 `mas-d4548844`）。

**请求示例**（非根 Agent，仅创建自身 session）：

```json
{
  "type": "req",
  "id": "31",
  "method": "aiemas.sessions.create",
  "params": {
    "agentId": "standalone-agent"
  }
}
```

**错误码**:

| 错误码            | 说明                              |
| ----------------- | --------------------------------- |
| INVALID_PARAMS    | agentId 为空或参数格式错误        |
| PERMISSION_DENIED | 角色权限不足（viewer 无写权限）   |
| INTERNAL          | 数据库写入失败或 Gateway 调用异常 |

---

### 2. 级联删除 Session (aiemas.sessions.delete)

级联删除 session：若 `sessionKey` 对应 `aiemas_sessions` 表中的根 Agent 记录，则同时删除根 Agent 及所有后代 Agent 的 session；否则仅删除该 session 自身。

**权限**: admin, member

**请求参数**:

| 参数       | 类型   | 必填 | 说明                                                       |
| ---------- | ------ | ---- | ---------------------------------------------------------- |
| sessionKey | string | 是   | 要删除的 session key，格式 `agent:{agentId}:{kind}:{uuid}` |

**请求示例**（根 Agent session，触发级联删除）：

```json
{
  "type": "req",
  "id": "32",
  "method": "aiemas.sessions.delete",
  "params": {
    "sessionKey": "agent:aie-iaas:group:mas-d4548844"
  }
}
```

**成功响应**：

```json
{
  "type": "res",
  "id": "32",
  "ok": true,
  "payload": { "ok": true }
}
```

**错误码**:

| 错误码            | 说明                             |
| ----------------- | -------------------------------- |
| INVALID_PARAMS    | sessionKey 为空或格式错误        |
| PERMISSION_DENIED | 角色权限不足（viewer 无写权限）  |
| INTERNAL          | Gateway 调用异常或数据库操作失败 |

---

### 3. 查询根 Agent Session 列表 (aiemas.sessions.list)

查询当前租户下所有根 Agent 的 session 列表。仅返回 `aiemas_sessions` 表中持久化的根 Agent session 记录，不包含后代 Agent 的级联 session。

**权限**: admin, member, viewer

**请求参数**: 无（传空对象即可）

**请求示例**：

```json
{
  "type": "req",
  "id": "33",
  "method": "aiemas.sessions.list",
  "params": {}
}
```

**成功响应**：

```json
{
  "type": "res",
  "id": "33",
  "ok": true,
  "payload": {
    "sessions": [
      {
        "sessionKey": "agent:aie-iaas:group:mas-d4548844",
        "sessionId": "sess-uuid-root-001",
        "agentId": "aie-iaas",
        "sessionUuid": "mas-d4548844",
        "label": "生产环境会话",
        "userId": "user-abc",
        "tenantId": "default",
        "createdAt": 1711618000000
      },
      {
        "sessionKey": "agent:aie-iaas:group:mas-e7f91234",
        "sessionId": "sess-uuid-root-002",
        "agentId": "aie-iaas",
        "sessionUuid": "mas-e7f91234",
        "label": null,
        "userId": "user-abc",
        "tenantId": "default",
        "createdAt": 1711619000000
      }
    ]
  }
}
```

**响应字段说明**:

| 字段        | 类型           | 说明                                                                 |
| ----------- | -------------- | -------------------------------------------------------------------- |
| sessionKey  | string         | 根 Agent 的 session key，格式 `agent:{agentId}:{kind}:{sessionUuid}` |
| sessionId   | string         | 根 Agent 的 session ID（由 Gateway 分配）                            |
| agentId     | string         | 根 Agent ID                                                          |
| sessionUuid | string         | 会话组唯一标识，根 Agent 与所有后代 Agent 共享相同值                 |
| label       | string \| null | 用户可读的 session 标签（创建时未指定则为 null）                     |
| userId      | string         | 创建者用户 ID                                                        |
| tenantId    | string         | 所属租户 ID                                                          |
| createdAt   | number         | 创建时间戳（毫秒）                                                   |

**错误码**:

| 错误码            | 说明           |
| ----------------- | -------------- |
| PERMISSION_DENIED | 角色权限不足   |
| INTERNAL          | 数据库查询失败 |

---

## 七、消息格式 (Message Format)

### session_messages 表 role 字段

`session.history.range` 返回的消息中，`role` 字段标识消息的来源类型：

| role        | 说明                                                          | sourceAgentId           |
| :---------- | :------------------------------------------------------------ | :---------------------- |
| `user`      | 人类用户直接发送的消息                                        | null                    |
| `agent`     | 其他 Agent 通过 `aiemas_sessions_send` 发送的消息（A2A 通信） | 发送方 Agent 的 agentId |
| `assistant` | Agent（LLM）的回复消息                                        | null                    |
| `tool`      | 工具调用结果                                                  | null                    |
| `approval`  | 审批事件（requested / resolved / user-resolve）               | null                    |
| `system`    | 系统消息                                                      | null                    |
| `progress`  | SOP/Skill 进度事件                                            | null                    |
| `summary`   | 会话摘要                                                      | null                    |

### sourceAgentId 字段

`sourceAgentId` 仅在 `role = "agent"` 时有值，标识消息的来源 Agent。例如：

- 根 Agent `aieiaas` 通过 `aiemas_sessions_send` 向子 Agent `aieiaas-resource` 发送消息
- 子 Agent session 中该消息的 `role = "agent"`，`sourceAgentId = "aieiaas"`

这使得 UI 和审计系统能够区分"人类用户直接发送"和"Agent 间转发"的消息。
