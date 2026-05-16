# Requirements Document

## Introduction

本功能在 OpenClaw 的 `extensions/` 目录中实现一个新的 **Channel 插件**，将 OpenClaw 接入 Agent Registry 的 A2A（Agent-to-Agent）协作网络。插件通过原生 NATS JetStream 连接 Agent Registry，使 OpenClaw 能够作为一个 Agent Worker 节点注册、接收并处理来自其他 Agent 的消息和协作任务。

该插件遵循 OpenClaw 的 TypeScript ESM 插件体系，参照 `extensions/telegram` 的结构实现，通过 `openclaw/plugin-sdk/*` 提供的 SDK API 与核心系统集成。

---

## Glossary

- **Agent Registry**：Multi-Agent 协作系统的核心注册与发现组件，底层使用 NATS JetStream。
- **AgentCard**：Agent 的数字名片，包含身份、能力、技能列表等信息，遵循 A2A 协议规范。
- **AgentSkill**：AgentCard 中的技能条目，包含 id、name、description、tags、examples、inputModes、outputModes。
- **RegistryEnvelope**：所有 Registry 消息的通用信封格式，包含 message_id、timestamp、source、seq、action、resource_type、payload 字段。
- **RegisterResponse**：Registry 返回给 Agent 的注册响应，包含分配的 Topics（unicast、multicast、broadcast）和 TTL。
- **Unicast Topic**：点对点私有通信 Topic，格式为 `a2a.agent.unicast.{agentId}`，全局唯一。
- **Multicast Topic**：同能力组内任务分发 Topic，格式为 `a2a.agent.group.{groupId}`。
- **Broadcast Topic**：系统级全局通知 Topic，固定为 `a2a.agent.broadcast.all`。
- **Discussion**：通用讨论场景，Topic 格式为 `a2a.discussion.{discussionId}`，支持 join/leave/message/conclude 动作。
- **Cotask**：协作任务场景，Topic 格式为 `a2a.cotask.{taskId}`，支持 join/leave/assign/progress/message/complete/abort 动作。
- **TTL**：注册有效期（毫秒），Agent 需在 TTL 内发送心跳续约，心跳间隔为 TTL/3。
- **Plugin**：OpenClaw Channel 插件，通过 `openclaw/plugin-sdk/*` 与核心系统集成。
- **Channel**：OpenClaw 中的消息通道抽象，负责入站消息接收和出站消息发送。
- **NATS_Client**：插件内部的 NATS 连接与订阅管理模块。
- **Registration_Manager**：负责 AgentCard 构建与向 Registry 注册的模块。
- **Heartbeat_Manager**：负责定时心跳发送的守护模块。
- **Message_Router**：负责入站消息解析与路由的模块。
- **Outbound_Adapter**：负责将 OpenClaw 出站消息转换为 NATS 消息并发布的模块。
- **Bound_Agent**：插件配置中绑定的 OpenClaw Agent，用于处理入站 A2A 消息及协作决策；未配置时使用 OpenClaw 默认 Agent。
- **Collaboration_Arbiter**：Bound_Agent 的专属会话，用于接收 `discussion.created` / `cotask.created` 广播并由 Agent 自主决定是否加入；每个插件实例维护一个长期存活的 Arbiter 会话。
- **Configured_Skills**：通过配置项 `AGENT_REGISTRY_SKILLS` 显式声明的 OpenClaw Skill 名称列表，用于构建 AgentCard；未配置时 AgentCard 的 `skills` 数组为空。

---

## Requirements

### Requirement 1: NATS 连接管理

**User Story:** As an OpenClaw operator, I want the agent-registry plugin to manage its NATS connection lifecycle, so that the plugin can reliably connect to and disconnect from the Agent Registry.

#### Acceptance Criteria

1. WHEN the plugin starts, THE NATS_Client SHALL establish a connection to the NATS server using the configured `AGENT_REGISTRY_NATS_URL`.
2. WHERE `AGENT_REGISTRY_NATS_TOKEN` is configured, THE NATS_Client SHALL include the token in the NATS connection options for authentication.
3. IF the NATS connection is lost, THEN THE NATS_Client SHALL attempt to reconnect with exponential backoff starting at 1 second, doubling on each attempt, with a maximum retry interval of 30 seconds.
4. WHEN the plugin stops, THE NATS_Client SHALL drain in-flight messages for up to 5 seconds, then close the NATS connection exactly once regardless of whether the drain completed.
5. WHILE the plugin is in normal operation and not stopping, THE NATS_Client SHALL keep the NATS connection open.
6. IF the NATS server is unreachable at startup, THEN THE Plugin SHALL log an error message that includes the value of `AGENT_REGISTRY_NATS_URL` and set the channel status to `unavailable`.
7. WHEN the plugin starts and `AGENT_REGISTRY_NATS_URL` is absent or does not match the pattern `nats://{host}:{port}`, THE Plugin SHALL set the channel status to `unavailable` without attempting a connection.

---

### Requirement 2: AgentCard 构建

**User Story:** As an OpenClaw operator, I want the plugin to build an AgentCard from an explicit list of configured Skills and bind it to a specific OpenClaw Agent, so that the Agent Registry only discovers the capabilities I intentionally expose and messages are routed to the correct Agent.

#### Acceptance Criteria

1. WHEN the plugin starts, THE Registration_Manager SHALL build an AgentCard using only the Skills whose names appear in the `AGENT_REGISTRY_SKILLS` configuration list; WHERE `AGENT_REGISTRY_SKILLS` is absent or empty, THE Registration_Manager SHALL build an AgentCard with an empty `skills` array without logging a warning.
2. WHEN the plugin starts, THE Registration_Manager SHALL populate the AgentCard `agent_id` field with the value of `AGENT_REGISTRY_AGENT_ID`.
3. WHEN the plugin starts, THE Registration_Manager SHALL populate the AgentCard `name` field with the value of `AGENT_REGISTRY_AGENT_NAME`.
4. WHEN the plugin starts, THE Registration_Manager SHALL set the AgentCard `transport` field to `"mq"`.
5. WHEN the plugin starts, THE Registration_Manager SHALL set the AgentCard `mac` field to `"00:00:00:00:00:00"` unconditionally; THE Registration_Manager SHALL NOT read or expose the host machine's actual MAC address.
6. FOR ALL Skill names listed in `AGENT_REGISTRY_SKILLS`, THE Registration_Manager SHALL look up the matching installed OpenClaw Skill and map its `id`, `name`, `description`, and `tags` to the corresponding AgentSkill fields; WHERE a matched Skill's `examples`, `inputModes`, or `outputModes` fields are present, THE Registration_Manager SHALL include them; WHERE those fields are absent, THE Registration_Manager SHALL omit them from the AgentSkill entry; IF a name in `AGENT_REGISTRY_SKILLS` does not match any installed Skill, THE Registration_Manager SHALL log a warning identifying the unresolved name and skip that entry.
7. WHEN the plugin starts, THE Registration_Manager SHALL set the AgentCard `capabilities.longRunningOperations` to `true`.
8. WHEN the plugin starts, THE Registration_Manager SHALL bind the plugin to the OpenClaw Agent whose id matches the value of `AGENT_REGISTRY_BOUND_AGENT_ID`; WHERE `AGENT_REGISTRY_BOUND_AGENT_ID` is absent or empty, THE Registration_Manager SHALL bind to the OpenClaw default Agent; all inbound A2A messages and Collaboration_Arbiter sessions SHALL be dispatched to the Bound_Agent.

---

### Requirement 3: Agent 注册

**User Story:** As an OpenClaw operator, I want the plugin to register with the Agent Registry on startup, so that OpenClaw can join the A2A network and receive tasks.

#### Acceptance Criteria

1. WHEN the NATS connection is established, THE Registration_Manager SHALL publish the AgentCard as a registration request to the `registry.agent.register` subject using NATS request-reply pattern with a 10-second timeout.
2. WHEN publishing the registration request, THE Registration_Manager SHALL wrap the AgentCard payload in a RegistryEnvelope with `action` set to `"register"` and `resource_type` set to `"agent"`.
3. WHEN the Registry returns a successful RegisterResponse (where `success` is `true`), THE Registration_Manager SHALL extract and store the assigned `topics.unicast`, `topics.multicast`, `topics.broadcast`, and `ttl` values.
4. IF the Registry returns a RegisterResponse where `success` is `false`, THEN THE Registration_Manager SHALL log the `error` field from the response and set the channel status to `unavailable`.
5. IF the registration request times out or the NATS publish fails, THEN THE Registration_Manager SHALL log the failure reason and set the channel status to `unavailable`.
6. WHEN re-registering after a reconnection, THE Registration_Manager SHALL re-publish the AgentCard to `registry.agent.register` and replace the previously stored topic assignments with the new values from the response.

---

### Requirement 4: Topic 订阅

**User Story:** As an OpenClaw operator, I want the plugin to subscribe to the assigned NATS topics after registration, so that OpenClaw can receive messages from other Agents.

#### Acceptance Criteria

1. WHEN registration succeeds, THE NATS_Client SHALL subscribe to the Unicast Topic `a2a.agent.unicast.{agentId}`; IF the subscription fails, THE NATS_Client SHALL log the error and set the channel status to `unavailable`.
2. WHEN registration succeeds, THE NATS_Client SHALL subscribe to each Multicast Topic in the `topics.multicast` list; IF the `topics.multicast` list is empty, THE NATS_Client SHALL skip multicast subscription without error.
3. WHEN registration succeeds, THE NATS_Client SHALL subscribe to the Broadcast Topic `a2a.agent.broadcast.all`; IF the subscription fails, THE NATS_Client SHALL log the error and set the channel status to `unavailable`.
4. WHEN the NATS connection is re-established after a disconnect, THE NATS_Client SHALL attempt to re-subscribe to each previously assigned topic independently; IF re-subscription of one topic fails, THE NATS_Client SHALL log the error for that topic and continue re-subscribing the remaining topics.
5. WHEN the plugin stops, THE NATS_Client SHALL unsubscribe from all active topic subscriptions, including any dynamically joined Discussion and Cotask topics, before closing the connection.

---

### Requirement 5: 心跳保活

**User Story:** As an OpenClaw operator, I want the plugin to send periodic heartbeats to the Agent Registry, so that OpenClaw's registration remains active and the Registry knows its current status.

#### Acceptance Criteria

1. WHEN registration succeeds, THE Heartbeat_Manager SHALL start a periodic timer with an interval of `floor(TTL / 3)` milliseconds, where TTL is the value returned in the RegisterResponse.
2. WHEN the heartbeat timer fires, THE Heartbeat_Manager SHALL publish a heartbeat message to `registry.agent.heartbeat` containing the `agent_id`, current `status`, and `load` fields.
3. WHEN OpenClaw has one or more active agent sessions, THE Heartbeat_Manager SHALL set the `status` field to `"busy"`.
4. WHEN OpenClaw has no active agent sessions and the plugin is connected, THE Heartbeat_Manager SHALL set the `status` field to `"idle"`.
5. THE Heartbeat_Manager SHALL populate the `load.active_task_count` field with the count of currently active OpenClaw agent sessions.
6. WHEN the plugin stops, THE Heartbeat_Manager SHALL cancel the heartbeat timer before the NATS connection is closed.
7. IF the heartbeat publish fails, THEN THE Heartbeat_Manager SHALL log the failure including the `agent_id` and the error reason, and continue attempting heartbeats on the next timer interval.
8. WHEN re-registration succeeds after a reconnection, THE Heartbeat_Manager SHALL cancel any existing heartbeat timer and start a new timer using the TTL value from the new RegisterResponse.

---

### Requirement 6: 入站消息路由

**User Story:** As an OpenClaw operator, I want the plugin to route incoming A2A messages to the Bound_Agent and let the Agent autonomously decide whether to join discussions or collaborative tasks, so that join decisions are based on semantic understanding rather than rigid tag matching.

#### Acceptance Criteria

1. WHEN a message is received on any subscribed topic, THE Message_Router SHALL parse the message body as a RegistryEnvelope.
2. IF the received message body is not a valid RegistryEnvelope, THEN THE Message_Router SHALL log a parse error that includes the raw message bytes (truncated to 512 bytes) and discard the message without further processing.
3. WHEN a valid RegistryEnvelope is received on the Unicast Topic, THE Message_Router SHALL route the message to the OpenClaw agent session identified by the `source` field of the envelope and bound to the Bound_Agent; IF no session exists for that `source`, THE Message_Router SHALL create a new Bound_Agent session for the source agent.
4. WHEN a valid RegistryEnvelope is received on a Multicast Topic, THE Message_Router SHALL route the message to the Bound_Agent session with the fewest active tasks (least-loaded selection); IF no sessions exist, THE Message_Router SHALL create a new Bound_Agent session to handle the message.
5. WHEN a valid RegistryEnvelope is received on the Broadcast Topic with `action` set to `"discussion.created"`, THE Message_Router SHALL forward the full discussion context (including `content.text`, `content.description`, `content.tags`, and `content.conversation`) to the Collaboration_Arbiter session as a structured prompt asking the Bound_Agent whether to join; IF the Bound_Agent responds affirmatively, THE Message_Router SHALL subscribe to the discussion topic (`a2a.discussion.{discussionId}`) and publish a join message with `action` set to `"join"`; IF the Bound_Agent responds negatively or does not respond within 30 seconds, THE Message_Router SHALL not subscribe and shall discard the broadcast.
6. WHEN a valid RegistryEnvelope is received on the Broadcast Topic with `action` set to `"cotask.created"`, THE Message_Router SHALL forward the full cotask context (including `content.text`, `content.description`, `content.required_skills`, and `content.conversation`) to the Collaboration_Arbiter session as a structured prompt asking the Bound_Agent whether to join and which skills it can offer; IF the Bound_Agent responds affirmatively, THE Message_Router SHALL subscribe to the cotask topic (`a2a.cotask.{taskId}`) and publish a join message with `action` set to `"join"` and `offered_skills` set to the skills the Bound_Agent declared; IF the Bound_Agent responds negatively or does not respond within 30 seconds, THE Message_Router SHALL not subscribe and shall discard the broadcast.
7. WHEN a valid RegistryEnvelope is received on a Discussion or Cotask topic, THE Message_Router SHALL route the message payload to the Bound_Agent session associated with that topic's id; IF no session is associated, THE Message_Router SHALL create a new Bound_Agent session and associate it with the topic id.
8. WHEN a valid RegistryEnvelope is received on the Broadcast Topic with an `action` value other than `"discussion.created"` or `"cotask.created"`, THE Message_Router SHALL log the action value and discard the message.
9. THE Collaboration_Arbiter session SHALL be a single long-lived Bound_Agent session created when the plugin starts and reused for all subsequent `discussion.created` and `cotask.created` decisions; IF the Arbiter session terminates unexpectedly, THE Message_Router SHALL recreate it before processing the next broadcast.
10. WHEN multiple `discussion.created` or `cotask.created` broadcasts arrive concurrently, THE Message_Router SHALL process them sequentially through the Collaboration_Arbiter session in the order they were received; each broadcast SHALL wait for the Arbiter's decision on the preceding broadcast before being forwarded, up to the 30-second per-broadcast timeout.

---

### Requirement 7: 出站消息发送

**User Story:** As an OpenClaw operator, I want the plugin to send OpenClaw agent responses back to the originating Agent via NATS, so that A2A task results are delivered correctly.

#### Acceptance Criteria

1. WHEN an OpenClaw agent session produces a response, THE Outbound_Adapter SHALL wrap the response text in a RegistryEnvelope with `action` set to `"message"`, `source` set to `AGENT_REGISTRY_AGENT_ID`, and `resource_type` set to `"agent"`.
2. WHEN the inbound message contained a non-empty `reply_to` field, THE Outbound_Adapter SHALL publish the response to the `reply_to` subject, taking precedence over all other routing rules.
3. WHEN the inbound message did not contain a `reply_to` field and the response is not for a Discussion or Cotask topic, THE Outbound_Adapter SHALL publish the response to `a2a.agent.unicast.{source}` where `source` is the `source` field of the inbound envelope; IF the inbound `source` field is absent or empty, THE Outbound_Adapter SHALL log a warning and discard the outbound message.
4. WHEN sending a response to a Discussion topic and the inbound message did not contain a `reply_to` field, THE Outbound_Adapter SHALL publish to the discussion topic (`a2a.discussion.{discussionId}`), set the RegistryEnvelope `action` to `"message"`, and include `discussion_id` in the payload.
5. WHEN sending a response to a Cotask topic and the inbound message did not contain a `reply_to` field, THE Outbound_Adapter SHALL publish to the cotask topic (`a2a.cotask.{taskId}`); IF the agent session is still active, THE Outbound_Adapter SHALL set `action` to `"progress"`; WHEN the agent session has completed, THE Outbound_Adapter SHALL set `action` to `"complete"`.
6. THE Outbound_Adapter SHALL initialize the `seq` counter to 0 for each new agent session and increment it by 1 for each outbound RegistryEnvelope published within that session.

---

### Requirement 8: 主动注销

**User Story:** As an OpenClaw operator, I want the plugin to deregister from the Agent Registry on shutdown, so that the Registry promptly marks OpenClaw as offline.

#### Acceptance Criteria

1. WHEN the plugin is in a registered state and receives a shutdown signal, THE Registration_Manager SHALL publish a deregistration message to `registry.agent.deregister` with a 5-second timeout before closing the NATS connection.
2. WHEN publishing the deregistration message, THE Registration_Manager SHALL wrap the payload in a RegistryEnvelope with `action` set to `"deregister"`, `resource_type` set to `"agent"`, and `payload` containing `agent_id` set to `AGENT_REGISTRY_AGENT_ID`.
3. IF the deregistration publish fails or times out, THEN THE Registration_Manager SHALL log the failure including the `agent_id` and the error reason, and proceed with closing the NATS connection.

---

### Requirement 9: 配置 Schema

**User Story:** As an OpenClaw operator, I want the plugin to validate its configuration at startup, so that misconfigured deployments are detected early with clear error messages.

#### Acceptance Criteria

1. WHEN the plugin starts, THE Plugin SHALL validate that `AGENT_REGISTRY_NATS_URL` is a non-empty string matching the pattern `nats://{host}:{port}` where port is an integer between 1 and 65535.
2. WHEN the plugin starts, THE Plugin SHALL validate that `AGENT_REGISTRY_AGENT_ID` is a non-empty string of at most 64 characters containing only alphanumeric characters, hyphens, and underscores.
3. WHEN the plugin starts, THE Plugin SHALL validate that `AGENT_REGISTRY_AGENT_NAME` is a non-empty string with a maximum length of 128 characters.
4. WHERE `AGENT_REGISTRY_NATS_TOKEN` is provided, THE Plugin SHALL accept it as an optional string of at most 512 characters for NATS authentication.
5. WHERE `AGENT_REGISTRY_SKILLS` is provided, THE Plugin SHALL accept it as an optional comma-separated list of Skill name strings; each name SHALL be a non-empty string of at most 128 characters; WHERE `AGENT_REGISTRY_SKILLS` is absent or empty, THE Plugin SHALL treat the configured Skills list as empty.
6. WHERE `AGENT_REGISTRY_BOUND_AGENT_ID` is provided, THE Plugin SHALL accept it as an optional non-empty string of at most 64 characters identifying the OpenClaw Agent to bind; WHERE `AGENT_REGISTRY_BOUND_AGENT_ID` is absent or empty, THE Plugin SHALL bind to the OpenClaw default Agent.
7. IF any required configuration field fails validation, THEN THE Plugin SHALL emit a validation error message that names the specific field, states the violated constraint, and provides the expected format; THE Plugin SHALL refuse to start the NATS connection until all required fields pass validation.

---

### Requirement 10: RegistryEnvelope 序列化

**User Story:** As a developer, I want the plugin to correctly serialize and deserialize RegistryEnvelope messages, so that all A2A protocol messages are structurally valid.

#### Acceptance Criteria

1. THE Plugin SHALL serialize all outbound messages as JSON-encoded RegistryEnvelope objects where `message_id`, `timestamp`, `source`, `seq`, `action`, `resource_type`, and `payload` are all present and non-null.
2. THE Plugin SHALL generate a unique UUID v4 for the `message_id` field of each outbound RegistryEnvelope.
3. THE Plugin SHALL set the `timestamp` field to the current Unix epoch time in milliseconds as a non-negative integer.
4. THE Plugin SHALL set the `seq` field to a non-negative integer that is monotonically increasing per agent session.
5. FOR ALL valid RegistryEnvelope objects, WHEN the JSON output of serialization is parsed, THE resulting object SHALL have field values equal to those of the original object for all required fields.
6. IF a received message cannot be parsed as a valid RegistryEnvelope, THEN THE Plugin SHALL log a protocol error that includes the subject the message was received on, discard the message, and continue processing subsequent messages.

---

### Requirement 11: 插件生命周期集成

**User Story:** As an OpenClaw operator, I want the agent-registry plugin to integrate with OpenClaw's plugin lifecycle, so that it starts and stops cleanly alongside the OpenClaw process.

#### Acceptance Criteria

1. THE Plugin SHALL export a `defineBundledChannelEntry` call that returns an object containing at minimum an `id` field set to `"agent-registry"` and a `start` function, conforming to the OpenClaw plugin SDK channel entry contract.
2. WHEN OpenClaw loads the plugin, THE Plugin SHALL register itself as a channel with the id `"agent-registry"`.
3. WHEN the plugin channel is explicitly enabled (configuration key present and set to `true`), THE Plugin SHALL initiate the NATS connection and registration flow.
4. WHEN the plugin channel configuration key is absent, set to `false`, or set to any value other than `true`, THE Plugin SHALL treat the channel as disabled and not initiate a NATS connection.
5. WHEN the plugin channel is disabled or OpenClaw shuts down, THE Plugin SHALL execute the deregistration and connection teardown sequence within 10 seconds; IF teardown is not complete within 10 seconds, THE Plugin SHALL force-close the NATS connection.
6. THE Plugin SHALL expose a channel status adapter that reports one of the following states within 1 second of a state change: `connecting`, `registered`, `unavailable`, `disabled`, or `disconnected`.
