# 实现计划：A2A 通信 — AIEMAS 工具注入点 + `aiemas_sessions_send`

## 概述

基于方案 G（新版）实现 A2A 通信能力。按照最小入侵原则，在 `Mas4sIntegration` 接口中新增 `resolveAgentTools` 方法建立通用工具注入点，然后在 AIEMAS 侧实现 `aiemas_sessions_send` 工具，最后修改 AGENTS.md 调度方式。实现语言为 TypeScript。

## 任务

- [x] 1. 扩展 Mas4sIntegration 接口 — 新增 resolveAgentTools 方法
  - [x] 1.1 在 `src/gateway/mas4s-integration.ts` 的 `Mas4sIntegration` 接口中新增可选的 `resolveAgentTools` 方法
    - 方法签名：`resolveAgentTools?: (context: { agentSessionKey?: string; config?: OpenClawConfig }) => AnyAgentTool[]`
    - 在 `NOOP_INTEGRATION` 中不需要添加该方法（可选属性）
    - _需求: 1.1, 1.2_

  - [x] 1.2 在 `src/agents/openclaw-tools.ts` 中添加模块级 `mas4sIntegrationRef` 变量和 setter
    - 新增 `setMas4sIntegrationRef` 导出函数和 `getMas4sIntegrationRef` 内部函数
    - 与现有 `openClawToolsDeps` 模式保持一致
    - _需求: 1.3, 1.4_

  - [x] 1.3 在 `createOpenClawTools()` 中调用 `resolveAgentTools` 注入 AIEMAS 工具
    - 在核心工具列表构建完成后、插件工具解析之前（`disablePluginTools` 检查之前）调用
    - 用 try/catch 包裹，异常时记录警告日志并继续返回不含 AIEMAS 工具的列表
    - _需求: 1.3, 1.4, 1.5_

  - [x] 1.4 在 `src/gateway/server.impl.ts` 中，`initMas4sIntegration` 完成后调用 `setMas4sIntegrationRef`
    - 确保 `createOpenClawTools` 在运行时能访问到 `Mas4sIntegration` 实例
    - _需求: 1.3_

  - [x] 1.5 为 resolveAgentTools 注入点编写单元测试
    - 测试 `resolveAgentTools` 未定义时 `createOpenClawTools` 正常返回现有工具
    - 测试 `resolveAgentTools` 返回工具时追加到列表末尾
    - 测试 `resolveAgentTools` 抛出异常时 `createOpenClawTools` 捕获并继续
    - **Property 1: 工具注入追加到列表末尾**
    - **验证: 需求 1.3**

- [x] 2. 检查点 — 确保工具注入点编译通过
  - 确保所有测试通过，ask the user if questions arise.

- [x] 3. 实现 aiemas_sessions_send 工具
  - [x] 3.1 创建 `aiemas/src/gateway-bridge/aiemas-tools.ts`，实现 `createAiemasSessionsSendTool`
    - 定义 `AiemasToolDeps` 接口（`db: DatabaseSync`、`callSessionsSend` 回调）
    - 定义 `AiemasSessionsSendSchema`（TypeBox schema：`agentId`、`message`、`timeoutSeconds`）
    - 实现 `execute` 方法：
      1. 从工具上下文获取 `agentSessionKey`，验证非空
      2. 调用 `extractUuidFromKey` 提取 sessionUuid，验证有效
      3. 查询 `aiemas_sessions` 表（`loadRootSession`），从 `descendantSessions` 查找目标 agentId
      4. 若未找到，fallback 使用 `constructKeyFromUuid` 派生 sessionKey
      5. 调用 `callSessionsSend` 回调
      6. 返回结果
    - 该文件不得包含任何从 `src/` 目录导入的 import 语句
    - _需求: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 3.4, 6.1, 6.5_

  - [x] 3.2 实现错误处理逻辑
    - agentSessionKey 为空/undefined → 返回 `{ status: "error", error: "..." }`
    - sessionUuid 无法提取 → 返回 `{ status: "error", error: "..." }`
    - DB 查询失败 → 记录警告日志，回退到派生规则
    - callSessionsSend 失败 → 捕获异常，包装为 `{ status: "error", error: "..." }`
    - _需求: 7.1, 7.2, 7.3, 7.4_

  - [x] 3.3 为 aiemas_sessions_send 编写单元测试（`aiemas/src/gateway-bridge/aiemas-tools.test.ts`）
    - 测试成功路径：从 descendantSessions 查找 sessionKey
    - 测试 fallback 路径：派生规则构造 sessionKey
    - 测试错误处理：空 sessionKey、DB 异常回退、callSessionsSend 失败
    - _需求: 2.3, 2.4, 2.5, 7.1, 7.2, 7.3, 7.4_

  - [x] 3.4 为 aiemas_sessions_send 编写属性测试（`aiemas/src/gateway-bridge/aiemas-tools.property.test.ts`）
    - **Property 2: SessionKey 解析正确性**
    - **验证: 需求 2.3, 2.4, 2.5**

  - [x] 3.5 编写属性测试 — 无效 agentSessionKey
    - **Property 3: 无效 agentSessionKey 返回错误**
    - **验证: 需求 2.8, 7.1, 7.2**

  - [x] 3.6 编写属性测试 — callSessionsSend 失败时错误包装
    - **Property 4: callSessionsSend 失败时错误包装**
    - **验证: 需求 7.3**

- [x] 4. 检查点 — 确保 aiemas_sessions_send 工具测试通过
  - 确保所有测试通过，ask the user if questions arise.

- [x] 5. 在 initMas4sIntegration 中注册工具并构造依赖注入
  - [x] 5.1 在 `src/gateway/mas4s-integration.ts` 的 `initMas4sIntegration` 返回值中实现 `resolveAgentTools` 方法
    - 动态导入 `aiemas/src/gateway-bridge/aiemas-tools.js` 获取 `createAiemasSessionsSendTool`
    - 在 `resolveAgentTools` 内部构造 `callSessionsSend` 回调：
      - 使用 `createSessionsSendTool` 创建 `sessions_send` 工具实例
      - 传入调用者的 `agentSessionKey`、`agentChannel`、`config` 上下文
    - 调用 `createAiemasSessionsSendTool({ db: plugin.db, callSessionsSend })` 创建工具实例
    - 返回工具数组
    - _需求: 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 4.4_

  - [x] 5.2 确保架构边界约束
    - 验证 `aiemas/src/gateway-bridge/aiemas-tools.ts` 无 `src/` 目录的 import
    - 验证 Gateway 核心改动不超过 3 个文件
    - _需求: 6.1, 6.2, 6.3, 6.4_

- [x] 6. 修改 AGENTS.md — 调度方式改为 aiemas_sessions_send
  - [x] 6.1 修改 `.openclaw/workspace-aieiaas/AGENTS.md`
    - 将调度方式章节中所有 `sessions_send` 调用替换为 `aiemas_sessions_send`
    - 调度示例仅包含 `agentId`、`message`、`timeoutSeconds` 参数，不包含 `sessionKey`
    - 移除"子 Agent SessionKey 派生规则"章节（如果存在）
    - 移除"会话启动时获取 sessionKey"步骤（如果存在）
    - 在注意事项中说明子 Agent session 已通过级联机制预创建
    - _需求: 5.1, 5.2, 5.3, 5.4, 5.5_

- [x] 7. 最终检查点 — 确保所有测试通过
  - 确保所有测试通过，ask the user if questions arise.

## 备注

- 标记 `*` 的任务为可选，可跳过以加速 MVP
- 每个任务引用了具体的需求编号以确保可追溯性
- 检查点确保增量验证
- 属性测试验证通用正确性属性，单元测试验证具体示例和边界情况
- 本功能依赖已完成的 `a2a-session-cascade` spec
