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

| 方法                | 说明                | 处理程序           |
| :------------------ | :------------------ | :----------------- |
| `agents.list`       | 列出可用 Agent      | `agents.ts`        |
| `agents.create`     | 创建 Agent          | `agents.ts`        |
| `agents.update`     | 更新 Agent 配置     | `agents.ts`        |
| `agents.delete`     | 删除 Agent          | `agents.ts`        |
| `agents.files.list` | 列出 Agent 关联文件 | `agents.ts`        |
| `agents.files.get`  | 读取 Agent 文件内容 | `agents.ts`        |
| `agents.files.set`  | 写入 Agent 文件内容 | `agents.ts`        |
| `tools.catalog`     | 内容工具包目录      | `tools-catalog.ts` |
| `tools.effective`   | 当前生效工具        | `tools-catalog.ts` |
| `skills.status`     | 插件状态            | `skills.ts`        |
| `skills.bins`       | 插件二进制文件      | `skills.ts`        |
| `skills.install`    | 安装插件            | `skills.ts`        |
| `skills.update`     | 更新插件            | `skills.ts`        |

### 5. 系统、配置与治理 (System & Config)

| 方法              | 说明                   | 处理程序      |
| :---------------- | :--------------------- | :------------ |
| `health`          | 健康检查               | `health.ts`   |
| `status`          | 获取 Gateway 综合状态  | `health.ts`   |
| `system.status`   | [MAS] MAS 系统运行状态 | `aiemas`      |
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

| 事件                      | 说明                         |
| :------------------------ | :--------------------------- |
| `user.presence`           | 租户内协同用户的在线状态变更 |
| `session.joined`          | 当前用户被邀请加入某会话     |
| `session.removed`         | 当前用户被移出会话           |
| `session.archived`        | 会话归档通知                 |
| `session.unarchived`      | 会话取消归档通知             |
| `session.summary.updated` | 会话摘要完成更新             |

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
