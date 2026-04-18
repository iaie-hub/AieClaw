# 需求文档：A2A Session 级联创建与删除

## 简介

为减少对原 Gateway 的改动，系统新增 AIEMAS 级别的 Session 级联 RPC API：`aiemas.sessions.create`、`aiemas.sessions.delete` 和 `aiemas.sessions.list`，在 `aiemas/src/gateway-bridge/aiemas-session.ts` 中实现。当客户端（如 webchat-ui）调用 `aiemas.sessions.create` 时，系统根据 TopologyCache 中以该 rootAgentId 为主键存储的完整拓扑树，自动为拓扑树中所有后代 Agent 创建 session，并将根 Agent 的 session 记录持久化到 `aiemas_sessions` 表中。sessionKey 由 3 部分组成：`agent:{agentId}:group:{sessionUuid}`，根 Agent 及所有后代 Agent 的 sessionKey 中 sessionUuid 保持一致，使得根 Agent 可根据自身的 sessionUuid 直接派生后代 Agent 的 sessionKey 进行 A2A 通信。`aiemas.sessions.list` 仅返回 `aiemas_sessions` 表中记录的根 Agent session，不返回 Gateway `sessions.list` 中包含的后代 Agent 级联 session，避免前端展示冗余的子 Agent session。当调用 `aiemas.sessions.delete` 时，根 Agent 及所有后代 Agent 的 session 一并删除，同时清理 `aiemas_sessions` 表中的记录。这些 AIEMAS API 内部通过 `callGateway` 调用现有 Gateway 的 `sessions.create` 和 `sessions.delete` 完成实际操作。该机制为通用的拓扑级联方案，不与任何具体 A2A 场景绑定。此外，当拓扑关系通过 `aiemas.agents.topology.save` 发生变更时，系统自动对比新旧拓扑树的后代 Agent 集合，为新增的子 Agent 增量创建级联 session，为移除的子 Agent 增量删除级联 session，保持级联 session 与拓扑关系的一致性。

## 术语表

- **Session_Cascade_Service**：负责根据拓扑关系级联创建和删除后代 Agent session 的服务模块，实现在 `aiemas/src/gateway-bridge/aiemas-session.ts` 中
- **AIEMAS_Session_API**：AIEMAS 级别的 Session 级联 RPC 接口，包括 `aiemas.sessions.create`、`aiemas.sessions.delete` 和 `aiemas.sessions.list`，作为级联操作和查询的入口点
- **aiemas_sessions 表**：持久化 `aiemas.sessions.create` 创建的根 Agent session 记录的数据库表，存储在 `mas4s.db` 中。`aiemas.sessions.list` 仅返回此表中记录的 session，不返回级联创建的后代 Agent session
- **TopologyCache**：内存中的拓扑关系缓存，维护 `byRoot: Map<string, TopologyTree>`（rootAgentId → TopologyTree）和 `childrenIndex: Map<string, string[]>`（agentId → 子 Agent ID 列表）双层索引
- **TopologyTree**：一棵完整的拓扑树文档，数据结构为 `{ edges: Array<{ from: string, to: string }> }`，以 rootAgentId 为主键存储在 TopologyCache 的 byRoot 索引中
- **rootAgentId**：拓扑树的根节点 Agent ID，作为 TopologyCache 中 byRoot 索引的主键。只有 rootAgentId 对应的 Agent 的 session 级联操作才会通过 AIEMAS_Session_API 触发
- **sessionKey**：session 的唯一标识，由 3 部分组成：`agent:{agentId}:group:{sessionUuid}`。其中 `agent` 为固定前缀，`{agentId}` 为 Agent ID，`group` 为固定的 kind 标识，`{sessionUuid}` 为会话组唯一标识。根 Agent 及所有后代 Agent 的 sessionKey 中 sessionUuid 保持一致
- **sessionUuid**：sessionKey 中的最后一段（第三部分），用于标识同一组会话。同一次级联创建中，根 Agent 和所有后代 Agent 共享相同的 sessionUuid
- **Descendant_Agent**：拓扑树中根节点以外的所有 Agent，即 TopologyTree 的 edges 中出现的所有 agentId（from 和 to 字段）中排除 rootAgentId 后的集合
- **Gateway**：消息路由和 session 管理的核心进程
- **GatewayAuthBridge**：AIEMAS 与 Gateway 之间的桥接层，位于 `aiemas/src/gateway-bridge/`
- **callGateway**：统一的 Gateway RPC 调用入口，AIEMAS_Session_API 通过此入口调用 Gateway 的 `sessions.create` 和 `sessions.delete`
- **extraHandlers**：`mas4s-gateway-plugin.ts` 中注册 AIEMAS RPC handler 的机制，`aiemas-session.ts` 的 handler 通过此机制挂载
- **aiemas_sessions**：持久化根 Agent session 记录的数据库表，存储在 `mas4s.db` 中，仅记录通过 `aiemas.sessions.create` 创建的根 Agent session，不记录级联创建的后代 Agent session

## 需求

### 需求 1：Session 级联创建

**用户故事：** 作为编排 Agent 的使用者，我希望当调用 `aiemas.sessions.create` 时，系统自动为拓扑树中所有后代 Agent 创建 session，以便根 Agent 可以通过 A2A 通信向后代 Agent 发送消息而无需手动初始化。

#### 验收标准

1. WHEN 客户端调用 `aiemas.sessions.create` 并传入 `agentId` 参数，THE Session_Cascade_Service SHALL 调用 `TopologyCache.getTopology(agentId)` 判断该 agentId 是否为 rootAgentId（即 byRoot 索引中是否存在以该 agentId 为主键的 TopologyTree）
2. IF 该 agentId 不是 rootAgentId（`getTopology(agentId)` 返回 undefined），THEN THE Session_Cascade_Service SHALL 仅通过 `callGateway("sessions.create", ...)` 为该 Agent 自身创建 session，不执行任何级联操作
3. WHEN 该 agentId 是 rootAgentId 且 `getTopology(agentId)` 返回的 TopologyTree 包含至少一条 edge，THE Session_Cascade_Service SHALL 从 TopologyTree 的 edges 中提取所有唯一的 agentId（edges 中所有 from 和 to 字段的并集），排除 rootAgentId 自身，得到所有后代 Agent ID 列表
4. WHEN 后代 Agent ID 列表非空时，THE Session_Cascade_Service SHALL 先通过 `callGateway("sessions.create", ...)` 为根 Agent 创建 session，再为每个后代 Agent 调用 `callGateway("sessions.create", ...)` 创建 session（一次性遍历列表，无需递归）
5. IF 级联创建某个后代 Agent 的 session 失败，THEN THE Session_Cascade_Service SHALL 记录警告日志并继续创建其余后代 Agent 的 session，不中断整体流程
6. WHEN `getTopology(agentId)` 返回的 TopologyTree 的 edges 为空数组时，THE Session_Cascade_Service SHALL 仅为根 Agent 自身创建 session，不执行任何级联操作
7. WHEN 根 Agent 的 session 创建成功后，THE Session_Cascade_Service SHALL 将该 session 记录持久化到 `aiemas_sessions` 表中（仅记录根 Agent session，不记录后代 Agent 的级联 session）

### 需求 2：Session 级联删除

**用户故事：** 作为编排 Agent 的使用者，我希望当调用 `aiemas.sessions.delete` 时，根 Agent 及拓扑树中所有后代 Agent 的级联 session 一并删除，以避免残留的孤立 session 占用资源。

#### 验收标准

1. WHEN 客户端调用 `aiemas.sessions.delete` 并传入 `sessionKey` 参数，THE Session_Cascade_Service SHALL 从 sessionKey 中解析出 agentId，并调用 `TopologyCache.getTopology(agentId)` 判断该 agentId 是否为 rootAgentId
2. IF 该 agentId 不是 rootAgentId（`getTopology(agentId)` 返回 undefined），THEN THE Session_Cascade_Service SHALL 仅通过 `callGateway("sessions.delete", ...)` 删除该 Agent 自身的 session，不执行任何级联删除操作
3. WHEN 该 agentId 是 rootAgentId 且 TopologyTree 包含至少一条 edge，THE Session_Cascade_Service SHALL 从 TopologyTree 的 edges 中提取所有后代 Agent ID（与需求 1 验收标准 3 相同的提取逻辑），为每个后代 Agent 调用 `callGateway("sessions.delete", ...)` 删除对应的级联 session，并通过 `callGateway("sessions.delete", ...)` 删除根 Agent 自身的 session
4. WHEN 删除后代 Agent 的级联 session 时，THE Session_Cascade_Service SHALL 使用与根 Agent 相同的 sessionUuid 构造后代 Agent 的 sessionKey 进行删除
5. IF 级联删除某个后代 Agent 的 session 失败，THEN THE Session_Cascade_Service SHALL 记录警告日志并继续删除其余后代 Agent 的 session，不中断整体流程
6. WHEN 根 Agent 的 session 删除完成后，THE Session_Cascade_Service SHALL 从 `aiemas_sessions` 表中删除对应的记录

### 需求 3：SessionKey 派生规则

**用户故事：** 作为系统开发者，我希望后代 Agent 的 sessionKey 派生规则清晰且一致，以便根 Agent 在调用 `sessions_send` 时能正确构造目标 sessionKey。

#### 验收标准

1. THE sessionKey SHALL 由 3 部分组成：`agent:{agentId}:group:{sessionUuid}`，其中 `group` 为固定的 kind 标识
2. THE Session_Cascade_Service SHALL 从根 Agent 的 sessionKey 中提取 `sessionUuid` 字段（即 `agent:{rootAgentId}:group:{sessionUuid}` 中的第三段）
3. THE Session_Cascade_Service SHALL 使用 `agent:{descendantAgentId}:group:{sessionUuid}` 格式构造后代 Agent 的 sessionKey，仅替换 agentId 段，`group` 和 `sessionUuid` 保持不变
4. WHEN 根 Agent 的 sessionKey 为 `agent:aie-iaas:group:mas-d4548844` 时，THE Session_Cascade_Service SHALL 为后代 Agent `aieiaas-resource` 生成 sessionKey `agent:aieiaas-resource:group:mas-d4548844`
5. FOR ALL 同一次级联创建中生成的 sessionKey，THE Session_Cascade_Service SHALL 保证根 Agent 及所有后代 Agent 的 sessionKey 共享相同的 sessionUuid

### 需求 4：通用性与解耦

**用户故事：** 作为系统架构师，我希望级联机制是通用的拓扑级联方案，不与任何具体 A2A 场景绑定，以便支持未来新增的 Agent 拓扑关系。

#### 验收标准

1. THE Session_Cascade_Service SHALL 仅依赖 TopologyCache 的 `getTopology(rootAgentId)` 接口获取完整拓扑树，再从 TopologyTree 的 edges 中提取后代 Agent 列表，不硬编码任何具体的 agentId
2. THE Session_Cascade_Service SHALL 作为独立模块实现在 `aiemas/src/gateway-bridge/aiemas-session.ts` 中，不修改原 Gateway（`src/gateway/`）的核心代码
3. WHEN 拓扑关系通过 `aiemas.agents.topology.save` 更新后，THE Session_Cascade_Service SHALL 自动使用最新的拓扑关系进行级联操作（因为 TopologyCache 在保存时已同步更新）
4. WHEN 某个 agentId 在 TopologyCache 的 byRoot 索引中不存在时，THE Session_Cascade_Service SHALL 仅为该 Agent 自身执行操作，不执行任何级联操作

### 需求 5：Session 所有权记录级联

**用户故事：** 作为多租户平台的使用者，我希望级联创建的后代 Agent session 也正确记录所有权和成员关系，以便 session 列表过滤和权限控制正常工作。

#### 验收标准

1. WHEN `aiemas.sessions.create` handler 通过 `callGateway("sessions.create", ...)` 成功创建后代 Agent 的级联 session 后，THE Session_Cascade_Service SHALL 调用 `recordSessionCreated` 为每个后代 Agent session 记录 session_ownership 和 session_memberships
2. THE Session_Cascade_Service SHALL 使用与根 Agent session 相同的 userId 和 tenantId 记录后代 Agent session 的所有权
3. WHEN `aiemas.sessions.delete` handler 删除后代 Agent 的级联 session 时，THE Session_Cascade_Service SHALL 调用 `deleteSessionRecords` 清理对应的 session_ownership 和 session_memberships 记录

### 需求 6：与现有 Session 生命周期集成

**用户故事：** 作为系统开发者，我希望级联机制通过独立的 AIEMAS RPC API 实现，与现有 Gateway session 生命周期解耦，不破坏现有功能。

#### 验收标准

1. WHEN 客户端需要创建带级联的 session 时，THE 客户端 SHALL 调用 `aiemas.sessions.create` 而非直接调用 Gateway 的 `sessions.create`
2. WHEN 客户端需要删除带级联的 session 时，THE 客户端 SHALL 调用 `aiemas.sessions.delete` 而非直接调用 Gateway 的 `sessions.delete`
3. THE GatewayAuthBridge 的 `onSessionCreated` 和 `onSessionDeleted` 生命周期钩子 SHALL 继续为非级联 session（直接通过 Gateway 创建的 session）记录所有权，不受 AIEMAS_Session_API 影响
4. IF 级联操作中发生任何异常，THEN THE Session_Cascade_Service SHALL 捕获异常并记录日志，不影响根 Agent session 的正常创建或删除流程
5. WHILE 系统处于兼容模式（userId 为 null）时，THE Session_Cascade_Service SHALL 跳过级联操作，仅通过 `callGateway` 执行根 Agent 自身的 session 操作，保持原有行为不变

### 需求 7：级联触发范围限定

**用户故事：** 作为系统架构师，我希望级联操作仅在 `aiemas.sessions.create` / `aiemas.sessions.delete` 被调用时触发，避免非根 Agent 的操作导致重复或错误的级联。

#### 验收标准

1. THE Session_Cascade_Service SHALL 仅在 `aiemas.sessions.create` 或 `aiemas.sessions.delete` RPC 被调用且 `getTopology(agentId)` 返回非 undefined 值时触发级联操作
2. WHEN 通过 Gateway 的 `sessions.create` 直接创建后代 Agent 的 session 时（如级联过程中 `callGateway` 触发的 `onSessionCreated` 回调），THE GatewayAuthBridge SHALL 正常记录所有权但不触发二次级联
3. WHEN 一个后代 Agent（非 rootAgentId）的 agentId 被传入 `aiemas.sessions.create` 时，THE Session_Cascade_Service SHALL 仅为该 Agent 自身创建 session，不触发任何级联操作

### 需求 8：Session 列表查询（aiemas.sessions.list）

**用户故事：** 作为 webchat-ui 的使用者，我希望查询 session 列表时只看到根 Agent 的 session，不看到级联创建的后代 Agent session，以避免界面展示冗余信息。

#### 验收标准

1. THE AIEMAS_Session_API SHALL 提供 `aiemas.sessions.list` RPC 方法，仅返回 `aiemas_sessions` 表中记录的根 Agent session 列表
2. THE `aiemas.sessions.list` SHALL 不调用 Gateway 的 `sessions.list`，而是直接从 `aiemas_sessions` 表中查询数据
3. THE `aiemas.sessions.list` SHALL 支持空参数调用（与 Gateway 的 `sessions.list` 保持一致）
4. THE `aiemas.sessions.list` 的返回结果 SHALL 包含每条 session 的 `sessionKey`、`agentId`、`sessionUuid`、`label`、`userId`、`tenantId` 和 `createdAt` 字段
5. THE `aiemas.sessions.list` handler SHALL 在 `aiemas/src/gateway-bridge/aiemas-session.ts` 中实现，通过 `mas4s-gateway-plugin.ts` 的 `extraHandlers` 注册
6. THE `aiemas.sessions.list` 的 RBAC 权限 SHALL 为 `admin | member | viewer`（只读查询）

### 需求 9：Session 持久化表设计（aiemas_sessions）

**用户故事：** 作为系统开发者，我希望 `aiemas.sessions.create` 创建的根 Agent session 有独立的持久化存储，并维护根 Agent 及所有后代 Agent 的 sessionKey 和 sessionId 映射，以便在拓扑变更时能准确增量创建或删除后代 Agent 的 session。

#### 验收标准

1. THE `aiemas_sessions` 表 SHALL 在 `mas4s.db` 中创建，DDL 在 `ensureMas4sSchema` 中追加
2. THE `aiemas_sessions` 表 SHALL 包含以下字段：

| 字段               | 类型    | 约束            | 说明                                                                                                                                              |
| ------------------ | ------- | --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| sessionKey         | TEXT    | PRIMARY KEY     | 根 Agent 的 sessionKey，格式 `agent:{agentId}:group:{sessionUuid}`                                                                                |
| sessionId          | TEXT    | NOT NULL        | 根 Agent 的 sessionId（由 Gateway 返回）                                                                                                          |
| agentId            | TEXT    | NOT NULL, INDEX | 根 Agent ID                                                                                                                                       |
| sessionUuid        | TEXT    | NOT NULL        | 会话组唯一标识，与所有后代 Agent 共享                                                                                                             |
| label              | TEXT    |                 | 用户可读的 session 标签（可选）                                                                                                                   |
| userId             | TEXT    | NOT NULL, INDEX | 创建者用户 ID                                                                                                                                     |
| tenantId           | TEXT    | NOT NULL        | 所属租户 ID                                                                                                                                       |
| descendantSessions | TEXT    | NOT NULL        | JSON 字符串，维护所有后代 Agent 的 sessionKey 和 sessionId 映射，格式：`[{"agentId":"xxx","sessionKey":"agent:xxx:group:yyy","sessionId":"zzz"}]` |
| createdAt          | INTEGER | NOT NULL        | 创建时间戳（ms）                                                                                                                                  |

3. THE `aiemas_sessions` 表 SHALL 创建 `idx_aiemas_sessions_agentId` 索引（agentId 字段）和 `idx_aiemas_sessions_userId` 索引（userId 字段），以支持按 agentId 和 userId 的高效过滤查询
4. WHEN `aiemas.sessions.create` 成功创建根 Agent 及所有后代 Agent 的 session 后，THE Session_Cascade_Service SHALL 向 `aiemas_sessions` 表插入一条记录，其中 `descendantSessions` 字段包含所有后代 Agent 的 sessionKey 和 sessionId 映射
5. WHEN `aiemas.sessions.delete` 删除根 Agent 及所有后代 Agent 的 session 后，THE Session_Cascade_Service SHALL 从 `aiemas_sessions` 表删除对应的记录
6. WHEN 拓扑变更时增量创建后代 Agent session 后，THE Session_Cascade_Service SHALL 更新 `aiemas_sessions` 表中该记录的 `descendantSessions` 字段，追加新增后代 Agent 的 sessionKey 和 sessionId
7. WHEN 拓扑变更时增量删除后代 Agent session 后，THE Session_Cascade_Service SHALL 更新 `aiemas_sessions` 表中该记录的 `descendantSessions` 字段，移除已删除后代 Agent 的记录
8. THE `aiemas_sessions` 表的读写操作 SHALL 在 `aiemas/src/store/` 目录下实现，与现有的 `topology-store.ts` 保持一致的组织方式

### 需求 10：拓扑变更时增量同步级联 Session

**用户故事：** 作为系统管理员，我希望当 Agent 的拓扑关系发生变化时（通过 `aiemas.agents.topology.save` 更新），系统自动为新增的子 Agent 创建级联 session，并为移除的子 Agent 删除级联 session，以保持级联 session 与拓扑关系的一致性。

#### 验收标准

1. WHEN `aiemas.agents.topology.save` 被调用且拓扑树发生变化时，THE Session_Cascade_Service SHALL 对比新旧拓扑树的后代 Agent 集合，计算出新增的 Agent ID 列表（新拓扑中有但旧拓扑中没有的）和移除的 Agent ID 列表（旧拓扑中有但新拓扑中没有的）
2. WHEN 存在新增的后代 Agent 时，THE Session_Cascade_Service SHALL 查询 `aiemas_sessions` 表获取该 rootAgentId 的所有活跃 session 记录，为每个活跃 session 的每个新增后代 Agent 调用 `callGateway("sessions.create", ...)` 创建级联 session，sessionKey 使用与根 Agent 相同的 sessionUuid
3. WHEN 存在移除的后代 Agent 时，THE Session_Cascade_Service SHALL 查询 `aiemas_sessions` 表获取该 rootAgentId 的所有活跃 session 记录，为每个活跃 session 的每个移除后代 Agent 调用 `callGateway("sessions.delete", ...)` 删除级联 session
4. IF 增量创建或删除某个后代 Agent 的 session 失败，THEN THE Session_Cascade_Service SHALL 记录警告日志并继续处理其余后代 Agent，不中断整体流程
5. WHEN 拓扑树从无到有（新建拓扑）或从有到无（删除所有 edges）时，THE Session_Cascade_Service SHALL 分别视为全量新增或全量移除，按相同的增量逻辑处理
6. THE 增量同步逻辑 SHALL 在 `aiemas.agents.topology.save` handler 成功更新 TopologyCache 后执行，确保使用的是最新的拓扑关系
7. WHEN 该 rootAgentId 在 `aiemas_sessions` 表中没有任何活跃 session 记录时，THE Session_Cascade_Service SHALL 跳过增量同步，不执行任何级联操作
