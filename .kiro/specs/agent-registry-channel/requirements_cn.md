# 需求文档

## 简介

本功能在 OpenClaw 的 `extensions/` 目录中实现一个新的 **Channel 插件**，将 OpenClaw 接入 Agent Registry 的 A2A（Agent-to-Agent）协作网络。插件通过原生 NATS JetStream 连接 Agent Registry，使 OpenClaw 能够作为一个 Agent Worker 节点注册、接收并处理来自其他 Agent 的消息和协作任务。

该插件遵循 OpenClaw 的 TypeScript ESM 插件体系，参照 `extensions/telegram` 的结构实现，通过 `openclaw/plugin-sdk/*` 提供的 SDK API 与核心系统集成。

---

## 术语表

- **Agent Registry**：Multi-Agent 协作系统的核心注册与发现组件，底层使用 NATS JetStream。
- **AgentCard**：Agent 的数字名片，包含身份、能力、技能列表等信息，遵循 A2A 协议规范。
- **AgentSkill**：AgentCard 中的技能条目，包含 id、name、description、tags、examples、inputModes、outputModes。
- **RegistryEnvelope**：所有 Registry 消息的通用信封格式，包含 message_id、timestamp、source、seq、action、resource_type、payload 字段。
- **RegisterResponse**：Registry 返回给 Agent 的注册响应，包含分配的 Topics（unicast、multicast、broadcast）和 TTL。
- **Unicast Topic**：点对点私有通信 Topic，格式为 `a2a.agent.unicast.{agentId}`，全局唯一。
- **Multicast Topic**：同能力组内任务分发 Topic，格式为 `a2a.agent.group.{groupId}`。
- **Broadcast Topic**：系统级全局通知 Topic，固定为 `a2a.agent.broadcast.all`。
- **Discussion**：通用讨论场景，Topic 格式为 `a2a.discussion.{discussionId}`，支持 join/leave/message/conclude 动作。
- **Cowork**：协作任务场景，Topic 格式为 `a2a.cowork.{taskId}`，支持 join/leave/assign/progress/message/complete/abort 动作。
- **TTL**：注册有效期（毫秒），Agent 需在 TTL 内发送心跳续约，心跳间隔为 TTL/3。
- **Plugin**：OpenClaw Channel 插件，通过 `openclaw/plugin-sdk/*` 与核心系统集成。
- **Channel**：OpenClaw 中的消息通道抽象，负责入站消息接收和出站消息发送。
- **NATS_Client**：插件内部的 NATS 连接与订阅管理模块。
- **Registration_Manager**：负责 AgentCard 构建与向 Registry 注册的模块。
- **Heartbeat_Manager**：负责定时心跳发送的守护模块。
- **Message_Router**：负责入站消息解析与路由的模块。
- **Outbound_Adapter**：负责将 OpenClaw 出站消息转换为 NATS 消息并发布的模块。
- **Bound_Agent**：插件配置中绑定的 OpenClaw Agent，用于处理入站 A2A 消息及协作决策；未配置时使用 OpenClaw 默认 Agent。
- **Collaboration_Arbiter**：Bound_Agent 的专属会话，用于接收 `discussion.created` / `cowork.created` 广播并由 Agent 自主决定是否加入；每个插件实例维护一个长期存活的 Arbiter 会话。
- **Configured_Skills**：通过配置项 `AGENT_REGISTRY_SKILLS` 显式声明的 OpenClaw Skill 名称列表，用于构建 AgentCard；未配置时 AgentCard 的 `skills` 数组为空。

---

## 需求说明

### 需求 1: NATS 连接管理

**用户故事:** 作为 OpenClaw 运营商，我希望 agent-registry 插件能够管理其 NATS 连接生命周期，以便插件能够可靠地连接到 Agent Registry 并从中断开连接。

#### 验收标准

1. 当插件启动时，NATS_Client 应使用配置的 `AGENT_REGISTRY_NATS_URL` 与 NATS 服务器建立连接。
2. 如果配置了 `AGENT_REGISTRY_NATS_TOKEN`，NATS_Client 在 NATS 连接选项中应包含该令牌用于身份验证。
3. 如果 NATS 连接丢失，NATS_Client 应尝试使用指数退避策略重新连接，从 1 秒开始，每次尝试翻倍，最大重试间隔为 30 秒。
4. 当插件停止时，NATS_Client 应在排空（drain）处理中的消息最多 5 秒后，无论排空是否完成，都必须关闭 NATS 连接且仅执行一次。
5. 当插件处于正常运行且未停止时，NATS_Client 应保持 NATS 连接开启。
6. 如果在启动时 NATS 服务器无法访问，插件应记录包含 `AGENT_REGISTRY_NATS_URL` 值的错误消息，并将通道状态设置为 `unavailable`。
7. 当插件启动且 `AGENT_REGISTRY_NATS_URL` 缺失或不符合 `nats://{host}:{port}` 模式时，插件应将通道状态设置为 `unavailable` 且不尝试连接。

---

### 需求 2: AgentCard 构建

**用户故事:** 作为 OpenClaw 运营商，我希望插件能够从显式配置的技能列表中构建 AgentCard 并将其绑定到特定的 OpenClaw Agent，以便 Agent Registry 仅发现我有意暴露的能力，并将消息路由到正确的 Agent。

#### 验收标准

1. 当插件启动时，Registration_Manager 应仅使用名称出现在 `AGENT_REGISTRY_SKILLS` 配置列表中的 Skills 构建 AgentCard；当 `AGENT_REGISTRY_SKILLS` 缺失或为空时，Registration_Manager 应构建一个包含空 `skills` 数组的 AgentCard 且不记录警告。
2. 当插件启动时，Registration_Manager 应使用 `AGENT_REGISTRY_AGENT_ID` 的值填充 AgentCard 的 `agent_id` 字段。
3. 当插件启动时，Registration_Manager 应使用 `AGENT_REGISTRY_AGENT_NAME` 的值填充 AgentCard 的 `name` 字段。
4. 当插件启动时，Registration_Manager 应将 AgentCard 的 `transport` 字段设置为 `"mq"`。
5. 当插件启动时，Registration_Manager 应无条件地将 AgentCard 的 `mac` 字段设置为 `"00:00:00:00:00:00"`；Registration_Manager 不得读取或暴露宿主机的实际 MAC 地址。
6. 对于 `AGENT_REGISTRY_SKILLS` 中列出的所有 Skill 名称，Registration_Manager 应查找匹配的已安装 OpenClaw Skill，并将其 `id`、`name`、`description` 和 `tags` 映射到相应的 AgentSkill 字段；如果存在匹配 Skill 的 `examples`、`inputModes` 或 `outputModes` 字段，Registration_Manager 应包含它们；如果缺失这些字段，Registration_Manager 应在 AgentSkill 条目中省略它们；如果 `AGENT_REGISTRY_SKILLS` 中的名称未匹配任何已安装 Skill，Registration_Manager 应记录包含该未识别名称的警告并跳过该条目。
7. 当插件启动时，Registration_Manager 应将 AgentCard 的 `capabilities.longRunningOperations` 设置为 `true`。
8. 当插件启动时，Registration_Manager 应将插件绑定到其 ID 匹配 `AGENT_REGISTRY_BOUND_AGENT_ID` 值的 OpenClaw Agent；当 `AGENT_REGISTRY_BOUND_AGENT_ID` 缺失或为空时，Registration_Manager 应绑定到 OpenClaw 默认 Agent；所有入站 A2A 消息和 Collaboration_Arbiter 会话均应分发给该 Bound_Agent。

---

### 需求 3: Agent 注册

**用户故事:** 作为 OpenClaw 运营商，我希望插件在启动时向 Agent Registry 注册，以便 OpenClaw 能够加入 A2A 网络并接收任务。

#### 验收标准

1. 当 NATS 连接建立后，Registration_Manager 应使用 NATS 请求-响应模式（10 秒超时）将 AgentCard 作为注册请求发布到 `registry.agent.register` 主题。
2. 发布注册请求时，Registration_Manager 应将 AgentCard 负载包装在 RegistryEnvelope 中，并将 `action` 设置为 `"register"`，`resource_type` 设置为 `"agent"`。
3. 当 Registry 返回成功的 RegisterResponse（其中 `success` 为 `true`）时，Registration_Manager 应提取并存储分配的 `topics.unicast`、`topics.multicast`、`topics.broadcast` 和 `ttl` 值。
4. 如果 Registry 返回 `success` 为 `false` 的 RegisterResponse，Registration_Manager 应记录响应中的 `error` 字段并将通道状态设置为 `unavailable`。
5. 如果注册请求超时或 NATS 发布失败，Registration_Manager 应记录失败原因并将通道状态设置为 `unavailable`。
6. 在重新连接后重新注册时，Registration_Manager 应重新向 `registry.agent.register` 发布 AgentCard，并使用响应中的新值替换之前存储的主题分配。

---

### 需求 4: Topic 订阅

**用户故事:** 作为 OpenClaw 运营商，我希望插件在注册后订阅分配的 NATS 主题，以便 OpenClaw 可以接收来自其他 Agent 的消息。

#### 验收标准

1. 当注册成功时，NATS_Client 应订阅单播主题 `a2a.agent.unicast.{agentId}`；如果订阅失败，NATS_Client 应记录错误并将通道状态设置为 `unavailable`。
2. 当注册成功时，NATS_Client 应订阅 `topics.multicast` 列表中的每个多播主题；如果 `topics.multicast` 列表为空，NATS_Client 应跳过多播订阅且不报错。
3. 当注册成功时，NATS_Client 应订阅广播主题 `a2a.agent.broadcast.all`；如果订阅失败，NATS_Client 应记录错误并将通道状态设置为 `unavailable`。
4. 当断开连接后重新建立 NATS 连接时，NATS_Client 应尝试独立地重新订阅每个先前分配的主题；如果其中一个主题重新订阅失败，NATS_Client 应记录该主题的错误并继续重新订阅剩余主题。
5. 当插件停止时，NATS_Client 应在关闭连接前取消订阅所有活动的主题订阅，包括任何动态加入的 Discussion 和 Cowork 主题。

---

### 需求 5: 心跳保活

**用户故事:** 作为 OpenClaw 运营商，我希望插件定期向 Agent Registry 发送心跳，以便 OpenClaw 的注册保持活动状态且 Registry 了解其当前状态。

#### 验收标准

1. 当注册成功时，Heartbeat_Manager 应启动一个周期性定时器，间隔为 `floor(TTL / 3)` 毫秒，其中 TTL 是 RegisterResponse 中返回的值。
2. 当心跳定时器触发时，Heartbeat_Manager 应向 `registry.agent.heartbeat` 发布一条心跳消息，其中包含 `agent_id`、当前 `status` 和 `load` 字段。
3. 当 OpenClaw 有一个或多个活动的 agent 会话时，Heartbeat_Manager 应将 `status` 字段设置为 `"busy"`。
4. 当 OpenClaw 没有活动的 agent 会话且插件已连接时，Heartbeat_Manager 应将 `status` 字段设置为 `"idle"`。
5. Heartbeat_Manager 应使用当前活动的 OpenClaw agent 会话数量填充 `load.active_task_count` 字段。
6. 当插件停止时，Heartbeat_Manager 应在关闭 NATS 连接前取消心跳定时器。
7. 如果心跳发布失败，Heartbeat_Manager 应记录包含 `agent_id` 和错误原因的失败信息，并在下一个定时器间隔继续尝试心跳。
8. 当重新连接后重新注册成功时，Heartbeat_Manager 应取消任何现有的心跳定时器，并使用新 RegisterResponse 中的 TTL 值启动新的定时器。

---

### 需求 6: 入站消息路由

**用户故事:** 作为 OpenClaw 运营商，我希望插件将入站 A2A 消息路由到 Bound_Agent，并由 Agent 自主决定是否加入讨论或协作任务，以便加入决策基于语义理解而非死板的标签匹配。

#### 验收标准

1. 当在任何订阅的主题上接收到消息时，Message_Router 应将消息体解析为 RegistryEnvelope。
2. 如果接收到的消息体不是有效的 RegistryEnvelope，Message_Router 应记录解析错误（包含原始消息字节，截断至 512 字节）并丢弃该消息而不进行进一步处理。
3. 当在单播主题上接收到有效的 RegistryEnvelope 时，Message_Router 应将消息路由到由 envelope 的 `source` 字段标识且绑定到 Bound_Agent 的 OpenClaw agent 会话；如果该 `source` 不存在会话，Message_Router 应为该源 Agent 创建一个新的 Bound_Agent 会话。
4. 当在多播主题上接收到有效的 RegistryEnvelope 时，Message_Router 应将消息路由到具有最少活动任务的 Bound_Agent 会话（负载最轻选择）；如果不存在会话，Message_Router 应创建一个新的 Bound_Agent 会话来处理该消息。
5. 当在广播主题上接收到 `action` 设置为 `"discussion.created"` 的有效 RegistryEnvelope 时，Message_Router 应将完整的讨论上下文（包括 `content.text`、`content.description`、`content.tags` 和 `content.conversation`）转发给 Collaboration_Arbiter 会话，作为结构化提示询问 Bound_Agent 是否加入；如果 Bound_Agent 做出肯定回答，Message_Router 应订阅该讨论主题（`a2a.discussion.{discussionId}`）并发布 `action` 设置为 `"join"` 的加入消息；如果 Bound_Agent 做出否定回答或在 30 秒内未响应，Message_Router 应不订阅并丢弃该广播。
6. 当在广播主题上接收到 `action` 设置为 `"cowork.created"` 的有效 RegistryEnvelope 时，Message_Router 应将完整的协作任务上下文（包括 `content.text`、`content.description`、`content.required_skills` 和 `content.conversation`）转发给 Collaboration_Arbiter 会话，作为结构化提示询问 Bound_Agent 是否加入以及可以提供哪些技能；如果 Bound_Agent 做出肯定回答，Message_Router 应订阅该协作任务主题（`a2a.cowork.{taskId}`）并发布 `action` 设置为 `"join"` 且 `offered_skills` 设置为 Bound_Agent 声明技能的加入消息；如果 Bound_Agent 做出否定回答或在 30 秒内未响应，Message_Router 应不订阅并丢弃该广播。
7. 当在 Discussion 或 Cowork 主题上接收到有效的 RegistryEnvelope 时，Message_Router 应将消息负载路由到与该主题 ID 关联的 Bound_Agent 会话；如果没有关联的会话，Message_Router 应创建一个新的 Bound_Agent 会话并将其与该主题 ID 关联。
8. 当在广播主题上接收到 `action` 值不是 `"discussion.created"` 或 `"cowork.created"` 的有效 RegistryEnvelope 时，Message_Router 应记录该 action 值并丢弃该消息。
9. Collaboration_Arbiter 会话应是一个在插件启动时创建的长效 Bound_Agent 会话，并复用于所有后续的 `discussion.created` 和 `cowork.created` 决策；如果 Arbiter 会话意外终止，Message_Router 应在处理下一个广播前重新创建它。

---

### 需求 7: 出站消息发送

**用户故事:** 作为 OpenClaw 运营商，我希望插件能够通过 NATS 将 OpenClaw agent 的响应发送回源 Agent，以便正确交付 A2A 任务结果。

#### 验收标准

1. 当 OpenClaw agent 会话产生响应时，Outbound_Adapter 应将响应文本包装在 RegistryEnvelope 中，并将 `action` 设置为 `"message"`，`source` 设置为 `AGENT_REGISTRY_AGENT_ID`，`resource_type` 设置为 `"agent"`。
2. 当入站消息包含非空的 `reply_to` 字段时，Outbound_Adapter 应将响应发布到 `reply_to` 主题，此规则优先级高于所有其他路由规则。
3. 当入站消息不包含 `reply_to` 字段且响应不是针对 Discussion 或 Cowork 主题时，Outbound_Adapter 应将响应发布到 `a2a.agent.unicast.{source}`，其中 `source` 是入站信封的 `source` 字段；如果入站 `source` 字段缺失或为空，Outbound_Adapter 应记录警告并丢弃该出站消息。
4. 当向 Discussion 主题发送响应且入站消息不包含 `reply_to` 字段时，Outbound_Adapter 应发布到该讨论主题（`a2a.discussion.{discussionId}`），将 RegistryEnvelope 的 `action` 设置为 `"message"`，并在负载中包含 `discussion_id`。
5. 当向 Cowork 主题发送响应且入站消息不包含 `reply_to` 字段时，Outbound_Adapter 应发布到该 cowork 主题（`a2a.cowork.{taskId}`）；如果 agent 会话仍处于活动状态，Outbound_Adapter 应将 `action` 设置为 `"progress"`；当 agent 会话已完成时，Outbound_Adapter 应将 `action` 设置为 `"complete"`。
6. Outbound_Adapter 应为每个新的 agent 会话将 `seq` 计数器初始化为 0，并为该会话内发布的每个出站 RegistryEnvelope 将其递增 1。

---

### 需求 8: 主动注销

**用户故事:** 作为 OpenClaw 运营商，我希望插件在关机时向 Agent Registry 注销，以便 Registry 及时将 OpenClaw 标记为离线。

#### 验收标准

1. 当插件处于已注册状态并接收到关机信号时，Registration_Manager 应在关闭 NATS 连接前发布一条注销消息到 `registry.agent.deregister`（5 秒超时）。
2. 发布注销消息时，Registration_Manager 应将负载包装在 RegistryEnvelope 中，并将 `action` 设置为 `"deregister"`，`resource_type` 设置为 `"agent"`，且 `payload` 中包含设置为 `AGENT_REGISTRY_AGENT_ID` 的 `agent_id`。
3. 如果注销发布失败或超时，Registration_Manager 应记录包含 `agent_id` 和错误原因的失败信息，并继续执行关闭 NATS 连接的操作。

---

### 需求 9: 配置 Schema

**用户故事:** 作为 OpenClaw 运营商，我希望插件在启动时验证其配置，以便通过清晰的错误消息尽早发现配置错误的部署。

#### 验收标准

1. 当插件启动时，插件应验证 `AGENT_REGISTRY_NATS_URL` 是一个非空字符串，且符合 `nats://{host}:{port}` 模式，其中 port 是 1 到 65535 之间的整数。
2. 当插件启动时，插件应验证 `AGENT_REGISTRY_AGENT_ID` 是一个最多 64 个字符的非空字符串，且仅包含字母数字字符、连字符和下划线。
3. 当插件启动时，插件应验证 `AGENT_REGISTRY_AGENT_NAME` 是一个最大长度为 128 个字符的非空字符串。
4. 如果提供了 `AGENT_REGISTRY_NATS_TOKEN`，插件应接受其作为一个最多 512 个字符的可选字符串，用于 NATS 身份验证。
5. 如果提供了 `AGENT_REGISTRY_SKILLS`，插件应将其作为一个可选的以逗号分隔的 Skill 名称字符串列表接受；每个名称应为最多 128 个字符的非空字符串；当 `AGENT_REGISTRY_SKILLS` 缺失或为空时，插件应将配置的 Skills 列表视为为空。
6. 如果提供了 `AGENT_REGISTRY_BOUND_AGENT_ID`，插件应将其作为一个可选的、最多 64 个字符的非空字符串接受，用于标识要绑定的 OpenClaw Agent；当 `AGENT_REGISTRY_BOUND_AGENT_ID` 缺失或为空时，插件应绑定到 OpenClaw 默认 Agent。
7. 如果任何必填配置字段验证失败，插件应发出验证错误消息，指明具体字段、违反的约束并提供预期格式；在所有必填字段通过验证之前，插件应拒绝启动 NATS 连接。

---

### 需求 10: RegistryEnvelope 序列化

**用户故事:** 作为开发者，我希望插件能正确地对 RegistryEnvelope 消息进行序列化和反序列化，以确保所有 A2A 协议消息在结构上都是有效的。

#### 验收标准

1. 插件应将所有出站消息序列化为 JSON 编码的 RegistryEnvelope 对象，其中 `message_id`、`timestamp`、`source`、`seq`、`action`、`resource_type` 和 `payload` 均存在且不为 null。
2. 插件应为每个出站 RegistryEnvelope 的 `message_id` 字段生成一个唯一的 UUID v4。
3. 插件应将 `timestamp` 字段设置为当前 Unix 时间戳（以毫秒为单位，且为非负整数）。
4. 插件应将 `seq` 字段设置为一个每个 agent 会话单调递增的非负整数。
5. 对于所有有效的 RegistryEnvelope 对象，当序列化的 JSON 输出被解析时，所得对象的所有必填字段值应与原始对象相等。
6. 如果接收到的消息无法解析为有效的 RegistryEnvelope，插件应记录协议错误（包含接收到该消息的主题），丢弃该消息，并继续处理后续消息。

---

### 需求 11: 插件生命周期集成

**用户故事:** 作为 OpenClaw 运营商，我希望 agent-registry 插件能够与 OpenClaw 的插件生命周期集成，以便它随 OpenClaw 进程干净地启动和停止。

#### 验收标准

1. 插件应导出 `defineBundledChannelEntry` 调用，该调用返回一个至少包含设置为 `"agent-registry"` 的 `id` 字段和 `start` 函数的对象，符合 OpenClaw 插件 SDK 通道入口契约。
2. 当 OpenClaw 加载插件时，插件应将自己注册为 ID 为 `"agent-registry"` 的通道。
3. 当插件通道被显式启用（配置键存在且设置为 `true`）时，插件应启动 NATS 连接和注册流程。
4. 当插件通道配置键缺失、设置为 `false` 或设置为除 `true` 以外的任何值时，插件应将该通道视为已禁用且不启动 NATS 连接。
5. 当插件通道被禁用或 OpenClaw 关闭时，插件应在 10 秒内执行注销和连接拆除序列；如果拆除在 10 秒内未完成，插件应强制关闭 NATS 连接。
6. 插件应公开一个通道状态适配器，在状态发生变化后 1 秒内报告以下状态之一：`connecting`、`registered`、`unavailable`、`disabled` 或 `disconnected`。
