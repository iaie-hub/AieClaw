# skills.status 实现方案分析

本文档分析了 `skills.status` 方法在 OpenClaw 和 Aiemas 中的实现方案，涵盖了从权限控制、协议定义到核心逻辑和前端调用的全链路过程。

## 1. 权限控制 (RBAC)

在 Aiemas 层，`skills.status` 的访问权限由 `aiemas/src/rbac/permission-checker.ts` 管理。

- **方法分类**: 被归类为 `GATEWAY_READ_METHODS`。
- **允许角色**: 拥有 `admin`、`member` 或 `viewer` 全局角色的用户均可调用。
- **会话限制**: 该方法没有定义会话级别的角色限制，属于全局只读 API。

## 2. 协议定义 (Protocol)

方法的参数和返回结构定义在 Gateway 协议层。

- **参数 (Params)**: 由 `SkillsStatusParamsSchema` 定义（`src/gateway/protocol/schema/agents-models-skills.ts`）。
  ```typescript
  {
    agentId?: string; // 可选，指定 Agent ID。若不提供则使用默认 Agent。
  }
  ```
- **返回结果 (Result)**: 返回一个 `SkillStatusReport` 对象。

## 3. Gateway 服务端实现

Gateway 接收到请求后，由 `src/gateway/server-methods/skills.ts` 中的 `skills.status` 处理程序完成分发。

1. **参数校验**: 使用 `validateSkillsStatusParams` 进行校验。
2. **Agent 解析**:
   - 如果提供了 `agentId`，则验证其是否存在。
   - 如果未提供，则调用 `resolveDefaultAgentId(cfg)` 获取默认 Agent。
3. **工作区定位**: 调用 `resolveAgentWorkspaceDir(cfg, agentId)` 定位该 Agent 的工作区目录。
4. **调用核心逻辑**: 调用 `buildWorkspaceSkillStatus` 生成报告，并将其返回给调用方。

## 4. 核心逻辑实现 (Core Logic)

核心实现在 `src/agents/skills-status.ts` 中，主要逻辑如下：

- **技能扫描**: `buildWorkspaceSkillStatus` 函数扫描工作区目录、受管技能目录 (`~/.openclaw/skills`) 和内置技能目录。
- **加载 Manifest**: 通过 `loadWorkspaceSkillEntries` 加载技能的 `manifest.json` 或元数据。
- **状态评估 (`buildSkillStatus`)**: 对每个技能进行深度检查：
  - **启用状态**: 检查配置文件中该技能是否被显式禁用。
  - **白名单检查**: 检查是否满足内置技能的允许列表要求。
  - **依赖检查 (`evaluateEntryRequirementsForCurrentPlatform`)**:
    - **二进制依赖**: 检查系统是否安装了所需的工具（如 `ffmpeg`, `sox` 等）。
    - **环境变量**: 检查所需的 API Key 或环境变量（如 `OPENAI_API_KEY`）是否已配置。
    - **配置项**: 检查配置路径是否符合要求。
  - **资格判定 (`eligible`)**: 只有当技能未被禁用、未被拦截且所有硬性要求（Requirements）都满足时，`eligible` 才为 `true`。
- **安装选项**: 如果技能缺失某些依赖，`normalizeInstallOptions` 会根据平台偏好（如 `brew`, `node`, `go`, `uv` 等）提供相应的安装方案。

## 5. 前端调用 (Frontend API)

Aiemas 前端通过 `aiemas/ui/mas4s/src/gateway/skills-api.ts` 与 Gateway 通信。

- **函数**: `fetchSkills(client: GatewayBrowserClient)`
- **超时机制**: 内置 10 秒超时限制。
- **错误映射**: 将 Gateway 层的连接错误或业务错误转换为用户友好的界面提示。

## 总结

`skills.status` 是一个典型的“自底向上”的探测接口。它不仅反映了配置文件的状态，更真实地反映了当前主机的运行环境（如二进制工具是否存在）和环境变量配置，是前端技能中心展示和引导用户安装缺失依赖的核心数据来源。
