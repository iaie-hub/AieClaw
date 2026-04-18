# 实现计划：A2A Session 级联创建与删除

## 概述

本实现计划将 A2A Session 级联创建与删除功能分解为 16 个核心任务，涵盖数据库设计、核心服务实现、RPC 接口注册、权限配置、拓扑集成和完整测试。所有任务使用 TypeScript 实现，遵循 AIEMAS 架构约束。

## 任务列表

- [ ] 1. 创建 aiemas_sessions 表和数据库 DDL
  - 在 `ensureMas4sSchema` 中追加 DDL 脚本
  - 创建 `aiemas_sessions` 表及其索引（agentId、userId、tenantId）
  - 验证表结构和约束
  - _需求: 9.1, 9.2, 9.3_

- [ ] 2. 实现 Session Store（aiemas-sessions-store.ts）
  - 创建 `aiemas/src/store/aiemas-sessions-store.ts`
  - 实现 `saveRootSession`、`loadRootSession`、`listRootSessions`、`deleteRootSession`、`updateDescendantSessions` 方法
  - 处理 JSON 序列化/反序列化（descendantSessions 字段）
  - _需求: 9.4, 9.5, 9.6, 9.7, 9.8_

- [ ] 3. 实现后代 Agent 提取和 SessionKey 派生工具函数
  - 创建 `aiemas/src/gateway-bridge/topology-utils.ts`
  - 实现 `extractDescendantAgentIds` 函数（从 edges 中提取后代 Agent ID）
  - 实现 `deriveDescendantSessionKey` 函数（派生后代 Agent sessionKey）
  - 实现 `extractSessionUuid` 函数（从 sessionKey 中提取 sessionUuid）
  - _需求: 1.3, 2.3, 3.2, 3.3, 3.4_

- [ ] 4. 实现 Session_Cascade_Service 的级联创建逻辑
  - 创建 `aiemas/src/gateway-bridge/aiemas-session.ts`
  - 实现 `cascadeCreate` 方法（包含兼容模式检查、拓扑查询、后代 Agent 提取、session 创建、记录持久化）
  - 处理后代 Agent session 创建失败时的日志记录和继续流程
  - 调用 `recordSessionCreated` 记录所有权
  - _需求: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 4.1, 4.2_

- [ ] 5. 实现 Session_Cascade_Service 的级联删除逻辑
  - 在 `aiemas-session.ts` 中实现 `cascadeDelete` 方法
  - 从 sessionKey 中解析 agentId
  - 加载根 Agent 记录，提取后代 Agent session 列表
  - 删除后代 Agent session，处理失败情况
  - 删除根 Agent session 和数据库记录
  - 调用 `deleteSessionRecords` 清理所有权记录
  - _需求: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6_

- [ ] 6. 实现 Session_Cascade_Service 的查询逻辑
  - 在 `aiemas-session.ts` 中实现 `listRootSessions` 方法
  - 支持空参数调用（与 Gateway 的 `sessions.list` 保持一致）
  - 返回完整的 session 记录（包含所有必需字段）
  - _需求: 7.3, 7.4_

- [ ] 7. 注册 aiemas.sessions.create RPC handler
  - 在 `aiemas/src/gateway-bridge/mas4s-gateway-plugin.ts` 的 `extraHandlers` 中注册
  - 实现 handler 函数，调用 `cascadeCreate`
  - 处理参数验证和错误返回
  - _需求: 5.1, 5.2_

- [ ] 8. 注册 aiemas.sessions.delete RPC handler
  - 在 `mas4s-gateway-plugin.ts` 的 `extraHandlers` 中注册
  - 实现 handler 函数，调用 `cascadeDelete`
  - 处理参数验证和错误返回
  - _需求: 5.1, 5.2_

- [ ] 9. 注册 aiemas.sessions.list RPC handler
  - 在 `mas4s-gateway-plugin.ts` 的 `extraHandlers` 中注册
  - 实现 handler 函数，调用 `listRootSessions`
  - 支持空参数调用
  - _需求: 7.1, 7.2_

- [ ] 10. 在 permission-checker.ts 中注册 RBAC 权限
  - 在 `GLOBAL_ROLE_PERMISSIONS` 中注册三个 RPC 方法的权限
  - `aiemas.sessions.create` → `["admin", "member"]`
  - `aiemas.sessions.delete` → `["admin", "member"]`
  - `aiemas.sessions.list` → `["admin", "member", "viewer"]`
  - _需求: 5.1, 5.2_

- [ ] 11. 实现拓扑变更增量同步逻辑
  - 在 `aiemas-session.ts` 中实现 `syncTopologyChanges` 方法
  - 计算新旧拓扑树的差异（新增和移除的 Agent ID）
  - 查询活跃 session 记录
  - 为新增后代 Agent 创建 session
  - 为移除后代 Agent 删除 session
  - 更新 `aiemas_sessions` 表中的 descendantSessions 字段
  - _需求: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 9.7_

- [ ] 12. 在 aiemas.agents.topology.save 中集成拓扑变更增量同步
  - 在 `aiemas/src/gateway-bridge/` 中找到或创建 topology save handler
  - 在 TopologyCache 更新后调用 `syncTopologyChanges`
  - 传入 rootAgentId、oldTopology、newTopology、tenantId
  - _需求: 9.6_

- [ ] 13. 编写属性测试（Property-Based Tests）
  - 创建 `aiemas/src/gateway-bridge/aiemas-session.property.test.ts`
  - 编写 14 个属性测试，每个最少 100 次迭代
  - 属性 1-5, 7-9, 11-14：在此文件中实现
  - 使用 `fast-check` 库生成测试数据
  - _需求: 所有需求的正确性属性验证_

- [ ] 14. 编写 Session Store 属性测试
  - 创建 `aiemas/src/store/aiemas-sessions-store.property.test.ts`
  - 编写属性 6, 10 的测试
  - 验证记录往返一致性、字段完整性
  - _需求: 6, 10_

- [ ] 15. 编写单元测试和集成测试
  - 创建 `aiemas/src/gateway-bridge/aiemas-session.test.ts`
  - 创建 `aiemas/src/store/aiemas-sessions-store.test.ts`
  - 测试级联创建/删除的成功路径和失败处理
  - 测试后代 Agent session 创建失败时的继续流程
  - 测试拓扑变更增量同步
  - 测试 RBAC 权限注册
  - 测试兼容模式（userId=null）处理
  - _需求: 所有需求的单元和集成测试_

- [ ] 16. 更新 WebSocket API 文档
  - 在 `aiemas/docs/openclaw/websocket_api.md` 中记录三个新 RPC 方法
  - 记录方法签名、参数、返回值、权限要求
  - 记录相关事件（如有）
  - _需求: 6.1, 6.2, 8.1, 8.2_

- [ ] 17. 最终验证与检查点
  - 确保所有测试通过（`pnpm test -- aiemas/src`）
  - 验证与现有系统的兼容性
  - 验证数据库迁移脚本正确性
  - 验证权限配置完整性
  - 确认所有需求已覆盖

## 实现注意事项

### 编程语言

所有代码使用 **TypeScript** 实现，遵循 AIEMAS 架构约束和 AGENTS.md 规范。

### 关键设计点

1. **SessionKey 派生规则**：仅替换 agentId 段，其余部分（kind、sessionUuid）保持不变
2. **兼容模式处理**：当 userId 为 null 时，跳过级联操作，仅执行根 Agent 自身操作
3. **错误隔离**：后代 Agent session 创建/删除失败时记录警告日志但继续处理其余 Agent
4. **事务一致性**：数据库写入操作使用 SQLite 事务保证原子性
5. **内存缓存集中管理**：所有缓存通过 CacheService 统一管理

### 测试策略

- **属性测试**：验证 14 个正确性属性，每个最少 100 次迭代
- **单元测试**：验证各个模块的功能正确性
- **集成测试**：验证完整的级联创建/删除流程和拓扑变更同步

### 文档更新

- 在 `aiemas/docs/openclaw/websocket_api.md` 中记录新增 RPC 方法
- 在 `aiemas/AGENTS.md` 中补充开发约束（如有新增）

## 任务执行顺序

建议按以下顺序执行任务以保证依赖关系：

1. 任务 1-3：基础设施（数据库、Store、工具函数）
2. 任务 4-6：核心服务逻辑（级联创建、删除、查询）
3. 任务 7-10：RPC 接口和权限（API 注册、RBAC）
4. 任务 11-12：拓扑集成（增量同步）
5. 任务 13-15：测试（属性测试、单元测试、集成测试）
6. 任务 16-17：文档和验证
