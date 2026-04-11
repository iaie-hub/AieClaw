# IaaS Multi-Agent A2A 通信问题分析与解决方案

## 问题背景

用户通过 webchat-ui 向编排 Agent（aie-iaas）发送"列出所有虚拟机"，编排 Agent 正确识别意图后尝试通过 `sessions_send` 调度子 Agent（aieiaas-resource），但整个调度链路失败。

---

## 一、请求执行路径追踪

### Step 1：意图识别 ✅

编排 Agent 正确识别"虚拟机"关键词，按 AGENTS.md 路由表匹配到资源管理领域，决定调度 `aieiaas-resource`。

### Step 2：首次 sessions_send ❌

```
sessions_send(agentId="aieiaas-resource", message="查询所有虚拟机列表", timeoutSeconds=30)
```

返回错误：`"Either sessionKey or label is required"`

编排 Agent 只传了 `agentId` + `message`，没有传 `sessionKey` 或 `label`。

### Step 3：sessions_list 查找 ⚠️

编排 Agent 调用 `sessions_list(kinds=["subagent"], limit=20)` 试图找到 aieiaas-resource 的 session key。返回的唯一结果是编排 Agent 自己的 session：

```json
{
  "key": "agent:aieiaas:group:mas-d4548844",
  "label": "iaas-1"
}
```

没有找到 aieiaas-resource 的任何 session。

### Step 4：错误重试 ❌

编排 Agent 用自己的 session key 重新调用：

```
sessions_send(
  agentId="aieiaas-resource",
  message="查询所有虚拟机列表",
  sessionKey="agent:aieiaas:group:mas-d4548844",  ← 这是编排 Agent 自己的 key
  timeoutSeconds=30
)
```

### Step 5：Gateway 超时 ❌

返回 `gateway timeout after 10000ms`。消息被发回了自己的 session，无法路由到 aieiaas-resource。

---

## 二、根因分析

### 根因 1：sessions_send 的 agentId 参数不能独立定位目标 session

根据 `sessions-send-tool.ts` 源码，`sessions_send` 的参数 schema：

```typescript
const SessionsSendToolSchema = Type.Object({
  sessionKey: Type.Optional(Type.String()),
  label: Type.Optional(Type.String()),
  agentId: Type.Optional(Type.String()), // 仅配合 label 使用
  message: Type.String(),
  timeoutSeconds: Type.Optional(Type.Number()),
});
```

`agentId` 是配合 `label` 使用的辅助参数（跨 agent label 查找时限定 agentId 范围），不能独立定位目标 session。代码路径：

```typescript
// sessions-send-tool.ts 第 100-105 行
let sessionKey = sessionKeyParam;
if (!sessionKey && labelParam) {
  // label 路径：通过 sessions.resolve({ label, agentId }) 查找
}
if (!sessionKey) {
  // 两者都没有 → 返回 "Either sessionKey or label is required"
  return jsonResult({ status: "error", error: "Either sessionKey or label is required" });
}
```

当只传 `agentId` 不传 `sessionKey` 和 `label` 时，直接走到最后的 error 分支。

### 根因 2：aieiaas-resource 子 Agent 没有活跃 session

`sessions_list` 只返回了编排 Agent 自己的 session，说明 aieiaas-resource 此时没有任何已建立的 session。`sessions_send` 无法向不存在的 session 发送消息。

### 根因 3：AGENTS.md 路由表的调用示例与实际 API 不匹配

AGENTS.md 中的调度方式示例：

```
sessions_send(agentId="aieiaas-xxx", message="查询所有运行中的虚拟机", timeoutSeconds=30)
```

缺少必需的 `sessionKey` 或 `label` 参数。LLM（Qwen3.5）按照 AGENTS.md 的示例生成了不完整的工具调用。

### 根因 4：缺少子 Agent session 初始化机制

需求文档和设计文档都没有定义子 Agent 的 session 如何初始化。设计假设子 Agent 已经有可用的 session，但没有说明 session 何时创建、由谁创建。

---

## 三、解决路径

### 路径 A：通过 label 查找（不可行）

**思路**：编排 Agent 用 `sessions_send(label="xxx", agentId="aieiaas-resource")` 定位子 Agent。

**不可行原因**：`sessions.resolve` 的 label 路径（`sessions-resolve.ts`）只能查找已存在的 session，不能创建新 session。如果子 Agent 从未被触发过，没有 session entry，label 查找返回 `"No session found with label: xxx"`。

```typescript
// sessions-resolve.ts — label 查找路径
const list = listSessionsFromStore({ cfg, storePath, store, opts: { label, agentId } });
if (list.sessions.length === 0) {
  return { ok: false, error: "No session found with label: xxx" };
}
```

### 路径 B：通过 sessionKey 派生（推荐）

**思路**：编排 Agent 从自己的 sessionKey 派生子 Agent 的 sessionKey，直接传给 `sessions_send`。Gateway 在 session 不存在时自动创建。

**代码级可行性验证**：

#### Step 1 — resolveSessionReference 不查 store

```typescript
// sessions-resolution.ts: resolveSessionReference()
// 对于 "agent:aieiaas-resource:group:mas-d4548844"：
// looksLikeSessionKey() = true（startsWith("agent:")）
// shouldResolveSessionIdInput() = false
// → 直接走 resolveInternalSessionKey()，原样返回
// → { ok: true, key: "agent:aieiaas-resource:group:mas-d4548844" }
// ⚠️ 不查 session store，不需要 session 预先存在
```

#### Step 2 — resolveVisibleSessionReference 跳过检查

```typescript
// sessions-resolution.ts: resolveVisibleSessionReference()
// restrictToSpawned = false（非沙盒模式）
// → isResolvedSessionVisibleToRequester() 直接返回 true
```

#### Step 3 — visibilityGuard.check 通过 A2A 权限

```typescript
// sessions-access.ts: createSessionVisibilityGuard.check()
// targetAgentId = "aieiaas-resource", requesterAgentId = "aieiaas"
// isCrossAgent = true
// visibility = "all" ✅（openclaw.json 已配置 tools.sessions.visibility="all"）
// a2aPolicy.enabled = true ✅
// a2aPolicy.isAllowed("aieiaas", "aieiaas-resource") = true ✅（两者都在 allow 列表）
// → { allowed: true }
```

#### Step 4 — Gateway agent 方法自动创建 session

```typescript
// agent.ts: agentHandlers.agent()
// classifySessionKeyShape("agent:aieiaas-resource:group:mas-d4548844")
//   → parseAgentSessionKey() 成功（parts=["agent","aieiaas-resource","group","mas-d4548844"]）
//   → 返回 "agent"（不是 "malformed_agent"）→ 通过格式校验 ✅
//
// loadSessionEntry("agent:aieiaas-resource:group:mas-d4548844")
//   → entry = undefined（session 不存在）
//   → isNewSession = !entry = true
//   → 自动创建 session entry，sessionId = randomUUID()
//
// agentCommandFromIngress() 正常执行
//   → aieiaas-resource Agent 被唤起，加载 workspace-aieiaas-resource/AGENTS.md
```

#### sessionKey 派生规则

编排 Agent 的 sessionKey 格式：`agent:aieiaas:{kind}:{suffix}`

派生规则：只替换 agentId 段（第二段），其余保持不变。

```
编排 Agent:  agent:aieiaas:group:mas-d4548844
                    ↓ 替换 agentId
资源管理:    agent:aieiaas-resource:group:mas-d4548844
模型服务:    agent:aieiaas-model:group:mas-d4548844
任务调度:    agent:aieiaas-task:group:mas-d4548844
监控:        agent:aieiaas-monitor:group:mas-d4548844
```

#### AGENTS.md 修改内容

```markdown
## 子 Agent SessionKey 派生规则

我的 sessionKey 格式为：agent:aieiaas:{kind}:{suffix}
例如：agent:aieiaas:group:mas-d4548844

子 Agent 的 sessionKey 通过替换 agentId 段派生（其余部分完全不变）：

- aieiaas-resource → agent:aieiaas-resource:{kind}:{suffix}
- aieiaas-model → agent:aieiaas-model:{kind}:{suffix}
- aieiaas-task → agent:aieiaas-task:{kind}:{suffix}
- aieiaas-monitor → agent:aieiaas-monitor:{kind}:{suffix}

## 调度方式（sessions_send）

调度前，先从系统上下文中获取我的 sessionKey，然后按派生规则构造目标子 Agent 的 sessionKey。

### 同步查询

sessions_send(
sessionKey="agent:aieiaas-resource:{kind}:{suffix}",
message="查询所有运行中的虚拟机",
timeoutSeconds=30
)

### 注意事项

子 Agent 的 session 无需预先创建。首次向子 Agent 发送消息时，
Gateway 会自动创建对应的 session 并唤起子 Agent。
```

#### 风险

1. **LLM 需要正确读取自己的 sessionKey**：依赖系统上下文注入。如果系统提示中没有 sessionKey，可以通过 `sessions_list` 获取。
2. **Session 不会自动释放**：通过 `sessions_send` 隐式创建的 session 没有自动清理机制，会持久化在 session store 中。但这是可接受的——子 Agent session 本身就应该长期存在以保持对话上下文。如需清理，可通过 webchat UI 或 CLI 手动删除。
3. **sessionKey 后缀完全可控**：Gateway 的 `agent` 方法对传入的 sessionKey 原样使用，不会修改或追加随机后缀。

### 路径 C：系统启动时预创建 session（备选）

**思路**：编写启动脚本，在 Gateway 启动后为每个子 Agent 调用 `sessions.create` 预创建 session。

**实现方式**：

```bash
# 通过 openclaw CLI 或直接调用 Gateway RPC
openclaw message send --agent aieiaas-resource --message "初始化" --session-key "agent:aieiaas-resource:main"
```

或通过 Gateway RPC：

```json
{
  "method": "sessions.create",
  "params": {
    "agentId": "aieiaas-resource",
    "key": "agent:aieiaas-resource:iaas-worker",
    "label": "iaas-resource-worker"
  }
}
```

`sessions.create` 支持通过 `key` 参数指定完整 sessionKey 或后缀：

```typescript
// session-key.ts: toAgentStoreSessionKey()
// 传 key="agent:aieiaas-resource:iaas-worker" → 直接使用
// 传 key="iaas-worker" + agentId="aieiaas-resource" → 拼接为 agent:aieiaas-resource:iaas-worker
// 不传 key → 自动生成 agent:{agentId}:dashboard:{randomUUID()}
```

**优点**：确定性高，不依赖 LLM 字符串操作。

**缺点**：需要额外的启动脚本或配置；session key 是固定的，不随编排 Agent 的 session 变化。

### 路径 D：修改 sessions_send 支持 agentId-only 模式（不推荐）

**思路**：修改 `sessions-send-tool.ts`，当只传 `agentId` 时自动解析到目标 Agent 的 main session。

**不推荐原因**：违反架构约束（不修改 aiemas 核心代码），且需要定义"目标 Agent 的默认 session"语义。

---

## 四、方案对比

| 方案                     | 可行性    | 改动范围       | 确定性                    | 推荐度      |
| ------------------------ | --------- | -------------- | ------------------------- | ----------- |
| 路径 A：label 查找       | ❌ 不可行 | —              | —                         | —           |
| 路径 B：sessionKey 派生  | ✅ 可行   | 仅改 AGENTS.md | 中（依赖 LLM 字符串操作） | ⭐⭐⭐ 推荐 |
| 路径 C：预创建 session   | ✅ 可行   | 需启动脚本     | 高                        | ⭐⭐ 备选   |
| 路径 D：改 sessions_send | ✅ 可行   | 需改核心代码   | 高                        | ⭐ 不推荐   |

---

## 五、Session 生命周期补充说明

### 自动创建

通过 `sessions_send` 传入不存在的 sessionKey 时，Gateway `agent` 方法在 `loadSessionEntry` 返回 `entry=undefined` 后，设置 `isNewSession=true`，自动创建 session entry 并持久化到 session store。

### 释放机制

Gateway 提供 `sessions.delete` RPC 方法，但 Agent 侧没有暴露 `sessions_delete` 工具。Agent 可用的 session 工具仅有：`sessions_send`、`sessions_list`、`sessions_history`、`sessions_spawn`、`session_status`。

释放途径：

- **手动释放**：通过 webchat UI session 管理面板或 `openclaw` CLI 调用 `sessions.delete`
- **spawn 自动清理**：`sessions_spawn` 的 `cleanup: "delete"` 参数（路径 B 不适用）
- **路径 B 创建的 session 不会自动释放**，需手动清理

`sessions.delete` 的行为：

1. 从 session store 中删除 entry（`delete store[primaryKey]`）
2. 如果 `deleteTranscript=true`（默认），归档 transcript 文件
3. 触发 plugin hook 和 lifecycle event
4. 限制：不能删除 main session

### sessionKey 后缀控制

`sessions.create` 的 `key` 参数处理逻辑（`toAgentStoreSessionKey`）：

```typescript
// 传完整 key → parseAgentSessionKey 成功 → 直接使用
"agent:aieiaas-resource:group:mas-d4548844" → "agent:aieiaas-resource:group:mas-d4548844"

// 传后缀 + agentId → 拼接
"group:mas-d4548844" + agentId="aieiaas-resource" → "agent:aieiaas-resource:group:mas-d4548844"

// 不传 key → 自动生成随机后缀
→ "agent:aieiaas-resource:dashboard:{randomUUID()}"
```

通过 `sessions_send` 隐式创建时，sessionKey 完全由调用方控制，Gateway 原样使用。

---

## 六、补充方案评估：两种 Gateway 层面的调度参数构建方式

在路径 B（sessionKey 派生）的基础上，进一步评估两种实现策略的可行性。

### 方案 E：在 AGENTS.md 中显式指定 sessions_send 的调度参数

**核心思路**：在 `workspace-aieiaas/AGENTS.md` 中教会编排 Agent 从自己的 sessionKey 派生子 Agent 的 sessionKey，直接传给 `sessions_send`。

**可行性：✅ 可行，但有明确风险**

优点：

- 零代码改动，只改 AGENTS.md
- Gateway `agent` 方法在 session 不存在时会自动创建，无需预创建
- `resolveSessionReference` 对标准格式 key（`agent:xxx:yyy`）直接原样返回，不查 session store

风险：

- 依赖 LLM 正确执行字符串操作（从自己的 sessionKey 中提取 `{kind}:{suffix}` 再拼接）。不同模型的字符串操作可靠性差异大，Qwen3.5 等模型可能出错
- 编排 Agent 需要在运行时获取自己的 sessionKey。经源码分析，系统提示的 Runtime 行（`buildRuntimeLine` in `src/agents/system-prompt.ts`）中**不包含 sessionKey**，需要通过 `session_status(sessionKey="current")` 或 `sessions_list` 获取，增加一次 RPC 开销
- 通过 `sessions_send` 隐式创建的 session 绕过了 `aiemas.sessions.create` 的级联机制，不会在 `aiemas_sessions` 表中记录，也不会触发 `recordSessionCreated` 记录所有权。影响：
  - `aiemas.sessions.list` 不会返回这些隐式创建的子 Agent session
  - session 所有权/成员关系缺失，RBAC 过滤可能出问题
  - 拓扑变更时的增量同步无法感知这些 session

**结论**：作为快速验证可行，但与已实现的 `aiemas.sessions.create` 级联机制存在语义冲突。当用户通过 webchat-ui 发起会话时，`aiemas.sessions.create` 已经预创建了所有后代 Agent 的 session，此时不存在"隐式创建"问题，方案 E 可以正常工作。

### 方案 F：Gateway 根据拓扑关系和 descendantSessions 自动构建调度参数

**核心思路**：编排 Agent 调用 `sessions_send` 时只传 `agentId`（或 `agentId` + 自己的 `sessionKey`），由 AIEMAS 层拦截/增强，根据 `aiemas_sessions.descendantSessions` 中记录的子 Agent sessionKey 自动解析目标 sessionKey。

**可行性：✅ 可行，且与现有架构更一致**

优点：

- 编排 Agent 不需要做字符串操作，只需传 `agentId`，降低 LLM 出错概率
- 复用 `aiemas.sessions.create` 已经建立的级联 session 和 `descendantSessions` 映射
- session 所有权、RBAC、拓扑同步等机制保持完整
- 对 LLM 的要求最低：只需知道目标 agentId

实现子方案分析：

**F1：新增 AIEMAS RPC `aiemas.sessions.send`**

- 在 `aiemas-session.ts` 中新增 `aiemas.sessions.send` handler
- 接收 `{ agentId, message, timeoutSeconds }` 参数
- 从调用者的 masAuth 获取 userId → 查 `aiemas_sessions` 表找到当前根 Agent 的活跃 session → 从 `descendantSessions` 中查找目标 agentId 的 sessionKey → 调用 Gateway 的 `agent` 方法注入消息
- **问题**：等于重新实现 `sessions_send` 的大部分逻辑（权限检查、同步等待、A2A Flow 等），工作量大且容易与核心逻辑不一致

**F2：在 `sessions_send` 的 agentId-only 路径增加 AIEMAS 解析**

- 修改 `sessions-send-tool.ts`，当只传 `agentId` 时，先查 AIEMAS 的 `aiemas_sessions` 表解析出目标 sessionKey
- **问题**：违反"不修改 Gateway 核心代码"的架构约束（`src/agents/tools/sessions-send-tool.ts` 属于 Gateway 核心）

**F3：AGENTS.md 指导 + 级联预创建保障**

- 与方案 E 相同的 AGENTS.md 修改，但明确依赖 `aiemas.sessions.create` 级联预创建
- 不是让 LLM 做复杂字符串操作，而是在 AGENTS.md 中给出明确的派生公式和示例
- 关键区别：子 Agent session 已经通过级联机制预创建，不存在"隐式创建"问题

### 方案对比（补充）

| 方案                                | 可行性 | 改动范围                  | 确定性                    | 架构一致性 | 推荐度        |
| ----------------------------------- | ------ | ------------------------- | ------------------------- | ---------- | ------------- |
| 方案 E：AGENTS.md 显式指定          | ✅     | 仅改 AGENTS.md            | 中（依赖 LLM 字符串操作） | 中         | ⭐⭐⭐ 推荐   |
| 方案 F1：新增 aiemas.sessions.send  | ✅     | 新增 AIEMAS RPC + handler | 高                        | 高         | ⭐⭐ 工作量大 |
| 方案 F2：改 sessions_send           | ✅     | 修改 Gateway 核心代码     | 高                        | 低（违规） | ⭐ 不推荐     |
| 方案 F3：AGENTS.md + 级联预创建保障 | ✅     | 仅改 AGENTS.md            | 中偏高                    | 高         | ⭐⭐⭐⭐ 最优 |

### 推荐方案：F3（AGENTS.md 指导 + 级联预创建保障）

**理由**：

1. 零代码改动，只修改 `workspace-aieiaas/AGENTS.md`
2. 依赖 `aiemas.sessions.create` 已实现的级联机制，子 Agent session 已预创建，所有权/RBAC/拓扑同步完整
3. LLM 字符串操作的风险通过清晰的派生表和示例缓解
4. 不违反"不修改 Gateway 核心代码"的架构约束

---

## 七、推荐方案 F3 的具体修改内容

### 7.1 前提条件

`aiemas.sessions.create` 级联机制已保证：当用户通过 webchat-ui 创建会话时，根 Agent（aieiaas）和所有后代 Agent（aieiaas-resource、aieiaas-model 等）的 session 已预创建完毕，且共享相同的 `sessionUuid`。

sessionKey 格式：

```
根 Agent:     agent:aieiaas:group:{sessionUuid}
子 Agent:     agent:{childAgentId}:group:{sessionUuid}
```

### 7.2 编排 Agent 获取自己 sessionKey 的方式

经源码分析，Agent 系统提示的 Runtime 行（`buildRuntimeLine` in `src/agents/system-prompt.ts`）中**不包含 sessionKey**。编排 Agent 需要通过以下方式获取：

- `session_status(sessionKey="current")` → 返回 `details.sessionKey`，例如 `agent:aieiaas:group:mas-d4548844`
- `sessions_list()` → 返回列表中包含 `key` 字段

推荐在 AGENTS.md 的"会话启动"步骤中增加一步：调用 `session_status(sessionKey="current")` 获取并记住自己的 sessionKey。

### 7.3 `workspace-aieiaas/AGENTS.md` 具体修改

#### 修改 1：会话启动增加获取 sessionKey 步骤

```markdown
## 会话启动

每次会话开始，立即执行（无需询问）：

1. 读取 `memory/YYYY-MM-DD.md`（今天 + 昨天）— 恢复近期上下文
2. 调用 `session_status(sessionKey="current")` 获取当前 sessionKey 并记住，后续调度子 Agent 时需要用到
```

#### 修改 2：新增"子 Agent SessionKey 派生规则"章节（插入在"路由表"和"调度方式"之间）

```markdown
## 子 Agent SessionKey 派生规则

通过 `aiemas.sessions.create` 级联创建的 session，根 Agent 和所有子 Agent 共享相同的 sessionUuid。

我的 sessionKey 格式为：`agent:aieiaas:group:{sessionUuid}`

子 Agent 的 sessionKey 只需将 `aieiaas` 替换为子 Agent 的 agentId，其余部分完全不变：

| 子 Agent | agentId          | sessionKey                                   |
| -------- | ---------------- | -------------------------------------------- |
| 资源管理 | aieiaas-resource | `agent:aieiaas-resource:group:{sessionUuid}` |
| 模型服务 | aieiaas-model    | `agent:aieiaas-model:group:{sessionUuid}`    |
| 任务调度 | aieiaas-task     | `agent:aieiaas-task:group:{sessionUuid}`     |
| 监控     | aieiaas-monitor  | `agent:aieiaas-monitor:group:{sessionUuid}`  |

**派生方法**：取我的 sessionKey，将第二段（`aieiaas`）替换为目标子 Agent 的 agentId。

**示例**：若我的 sessionKey 为 `agent:aieiaas:group:mas-d4548844`，则：

- aieiaas-resource 的 sessionKey = `agent:aieiaas-resource:group:mas-d4548844`
- aieiaas-model 的 sessionKey = `agent:aieiaas-model:group:mas-d4548844`
```

#### 修改 3：替换"调度方式"章节为使用 sessionKey 的版本

```markdown
## 调度方式（sessions_send）

统一使用 `sessions_send` 工具进行子 Agent 调度。调度前，先按"子 Agent SessionKey 派生规则"构造目标子 Agent 的 sessionKey。

### 同步查询

用于简单查询类请求，等待子 Agent 返回结果：

sessions_send(
sessionKey="agent:aieiaas-resource:group:{sessionUuid}",
message="查询所有运行中的虚拟机",
timeoutSeconds=30
)

### SOP 执行

用于需要多步骤执行的标准作业程序，设置较长超时：

sessions_send(
sessionKey="agent:aieiaas-model:group:{sessionUuid}",
message="执行模型部署 SOP: Qwen2-72B",
timeoutSeconds=120
)

### 多 Agent 串行调度

当任务需要多个子 Agent 协作时，按依赖顺序逐个调用，前一个完成后再调下一个：

# 步骤 1：调用模型服务 Agent 部署模型

result1 = sessions_send(
sessionKey="agent:aieiaas-model:group:{sessionUuid}",
message="执行模型部署 SOP: Qwen2-72B",
timeoutSeconds=120
)

# 步骤 2：等步骤 1 完成后，查询部署拓扑

result2 = sessions_send(
sessionKey="agent:aieiaas-model:group:{sessionUuid}",
message="查询 Qwen2-72B 部署拓扑",
timeoutSeconds=60
)

# 步骤 3：汇总结果回复用户

### 注意事项

- 子 Agent 的 session 已通过级联机制预创建，无需手动创建
- `{sessionUuid}` 是会话启动时通过 `session_status` 获取的 sessionKey 中的最后一段
- 不要传 `agentId` 参数，直接传完整的 `sessionKey`
```

### 7.4 风险评估

| 风险                                                         | 等级 | 缓解措施                                                     |
| ------------------------------------------------------------ | ---- | ------------------------------------------------------------ |
| LLM 字符串替换出错                                           | 中   | 在 AGENTS.md 中给出明确的派生表和示例，减少 LLM 推理负担     |
| Agent 忘记在会话启动时获取 sessionKey                        | 低   | 写在"会话启动"的必做步骤中，且排在第 2 步                    |
| sessionUuid 提取错误（从 sessionKey 中取错段）               | 低   | 明确说明"替换第二段"而非"提取最后一段再拼接"，降低操作复杂度 |
| 子 Agent session 未预创建（用户绕过 aiemas.sessions.create） | 低   | Gateway `agent` 方法在 session 不存在时会自动创建，不会报错  |

### 7.5 验证方法

修改后，通过 webchat-ui 发送"列出所有虚拟机"，预期流程：

1. 编排 Agent 会话启动时调用 `session_status(sessionKey="current")` → 获得 `agent:aieiaas:group:mas-d4548844`
2. 识别意图 → 资源管理 → aieiaas-resource
3. 派生 sessionKey → `agent:aieiaas-resource:group:mas-d4548844`
4. 调用 `sessions_send(sessionKey="agent:aieiaas-resource:group:mas-d4548844", message="查询所有虚拟机列表", timeoutSeconds=30)`
5. Gateway 路由到 aieiaas-resource 的已有 session → 子 Agent 执行查询 → 返回结果

---

## 八、方案 G 评估：封装 `aiemas_sessions_send` 工具

### 8.1 方案描述

新增一个 Agent 工具 `aiemas_sessions_send`，封装 `sessions_send` 的调用。该工具接收 `agentId` + `message` 参数，内部根据拓扑关系和 `aiemas_sessions.descendantSessions` 字段自动解析出目标子 Agent 的 `sessionKey`，再调用 `sessions_send` 完成实际调度。

### 8.2 架构层面分析

#### Agent 工具 vs RPC Handler 的区别

经源码分析，系统中存在两个不同的扩展层面：

1. **Agent 工具（Tool）**：由 LLM 在运行时调用，注册在 `createOpenClawTools()`（`src/agents/openclaw-tools.ts`）中。`sessions_send`、`sessions_list`、`session_status` 等都是 Agent 工具。
2. **RPC Handler（extraHandlers）**：由 WebSocket 客户端（如 webchat-ui）调用，注册在 `mas4s-gateway-plugin.ts` 的 `extraHandlers` 中。`aiemas.sessions.create`、`aiemas.sessions.delete` 等都是 RPC handler。

`aiemas_sessions_send` 作为一个 Agent 工具，需要注册到 `createOpenClawTools()` 的工具列表中，才能被 LLM 调用。

#### 注册路径分析

`createOpenClawTools()` 位于 Gateway 核心代码 `src/agents/openclaw-tools.ts`，AIEMAS 不应直接修改。可选的注册路径：

- **路径 1：修改 `src/agents/openclaw-tools.ts`**（违反架构约束）
  - 直接在 `createOpenClawTools()` 中添加 `createAiemasSessionsSendTool()`
  - 问题：违反"AIEMAS 功能闭环在 `aiemas/src` 目录内"的约束

- **路径 2：通过插件工具机制注册**
  - OpenClaw 支持通过 `openclaw.plugin.json` 注册插件工具（`resolvePluginTools`）
  - 问题：AIEMAS 不是一个标准的 OpenClaw 插件（没有 `openclaw.plugin.json`），它是通过 `mas4s-gateway-plugin.ts` 的 `extraHandlers` 机制集成的。插件工具注册需要完整的插件包结构。

- **路径 3：通过 Channel Agent Tool 机制注册**
  - Channel 插件可以通过 `agentTools` 属性注册 Agent 工具（`listChannelAgentTools`）
  - 问题：AIEMAS 不是 Channel 插件

- **路径 4：新增 AIEMAS 工具注入点**
  - 在 `createOpenClawTools()` 中新增一个 AIEMAS 工具注入钩子
  - 问题：仍然需要修改 Gateway 核心代码来添加注入点

### 8.3 实现方案（假设选择路径 1 或路径 4）

假设接受修改 Gateway 核心代码的约束，`aiemas_sessions_send` 的实现逻辑如下：

```
aiemas_sessions_send(agentId, message, timeoutSeconds)
  │
  ├─ 步骤 1：获取调用者的 sessionKey（从 opts.agentSessionKey）
  │
  ├─ 步骤 2：从调用者 sessionKey 中提取 sessionUuid
  │   └── extractUuidFromKey("agent:aieiaas:group:mas-d4548844") → "mas-d4548844"
  │
  ├─ 步骤 3：查询 aiemas_sessions 表
  │   └── SELECT descendantSessions FROM aiemas_sessions
  │       WHERE sessionKey = "agent:aieiaas:group:mas-d4548844"
  │   └── 从 descendantSessions JSON 中查找 agentId 匹配的记录
  │   └── 得到目标 sessionKey = "agent:aieiaas-resource:group:mas-d4548844"
  │
  ├─ 步骤 4：调用 sessions_send
  │   └── sessions_send(sessionKey=目标sessionKey, message=message, timeoutSeconds=timeoutSeconds)
  │
  └─ 步骤 5：返回 sessions_send 的结果
```

#### 关键依赖

- 需要访问 `aiemas_sessions` 表（`mas4s.db`）→ 需要 `DatabaseSync` 实例
- 需要访问 `aiemas/src/store/aiemas-sessions-store.ts` 的 `loadRootSession` 方法
- 需要调用 `sessions_send` 工具的 `execute` 方法，或者直接复用其内部逻辑

#### 调用 sessions_send 的两种方式

**方式 A：直接调用 `createSessionsSendTool().execute()`**

```typescript
const sendTool = createSessionsSendTool({
  agentSessionKey: opts.agentSessionKey,
  agentChannel: opts.agentChannel,
  sandboxed: opts.sandboxed,
  config: opts.config,
  callGateway: opts.callGateway,
});
return sendTool.execute(toolCallId, {
  sessionKey: targetSessionKey,
  message,
  timeoutSeconds,
});
```

优点：完全复用 `sessions_send` 的权限检查、同步等待、A2A Flow 等逻辑。
问题：`createSessionsSendTool` 位于 `src/agents/tools/sessions-send-tool.ts`（Gateway 核心），从 AIEMAS 代码中导入它违反了 import boundary 约束（`aiemas/` 不应导入 `src/` 内部模块）。

**方式 B：通过 `callGateway("agent", ...)` 直接注入消息**

```typescript
const result = await callGateway("agent", {
  message,
  sessionKey: targetSessionKey,
  idempotencyKey: crypto.randomUUID(),
  deliver: false,
  channel: "internal",
  lane: "nested",
});
```

优点：不依赖 `sessions_send` 工具的内部实现。
问题：丢失了 `sessions_send` 的所有高级功能（权限检查、同步等待回复、A2A Flow、Ping-Pong 多轮对话、Announce 投递等）。本质上是重新实现了一个简化版的 `sessions_send`。

### 8.4 可行性结论

| 维度          | 评估                                                                                                 |
| ------------- | ---------------------------------------------------------------------------------------------------- |
| 技术可行性    | ✅ 可行，但需要修改 Gateway 核心代码（`src/agents/openclaw-tools.ts`）来注册工具                     |
| 架构合规性    | ❌ 违反"AIEMAS 功能闭环在 `aiemas/src`"约束；违反 import boundary（AIEMAS 不应导入 `src/` 内部模块） |
| 功能完整性    | 方式 A ✅ 完整复用 sessions_send；方式 B ⚠️ 丢失权限检查/同步等待/A2A Flow                           |
| 对 LLM 的要求 | ✅ 最低（只需传 agentId + message，无需字符串操作）                                                  |
| 实现复杂度    | 中偏高（需要工具注册、DB 访问、sessions_send 集成）                                                  |
| 维护成本      | 中（新增工具需要与 sessions_send 保持同步演进）                                                      |

### 8.5 与方案 F3 的对比

| 对比维度     | 方案 F3（AGENTS.md 派生）         | 方案 G（aiemas_sessions_send 工具）       |
| ------------ | --------------------------------- | ----------------------------------------- |
| 代码改动     | 零（仅改 AGENTS.md）              | 需改 Gateway 核心 + 新增 AIEMAS 工具代码  |
| 架构合规性   | ✅ 完全合规                       | ❌ 违反 AIEMAS 闭环约束和 import boundary |
| LLM 出错概率 | 中（字符串替换）                  | 低（只传 agentId）                        |
| 功能完整性   | ✅ 完整（直接调用 sessions_send） | 取决于实现方式（A 完整 / B 不完整）       |
| 维护成本     | 低                                | 中                                        |
| 上线速度     | 快（改文档即可验证）              | 慢（需开发、测试、注册）                  |

### 8.6 总结

方案 G 在技术上可行，对 LLM 的要求最低，但存在两个核心障碍：

1. **工具注册需要修改 Gateway 核心代码**：AIEMAS 没有独立的 Agent 工具注册机制，必须修改 `src/agents/openclaw-tools.ts` 才能让 LLM 看到新工具
2. **Import boundary 违规**：无论是从 AIEMAS 导入 `sessions_send` 工具，还是从 Gateway 核心导入 AIEMAS 的 DB 访问逻辑，都会跨越架构边界

如果未来 AIEMAS 需要注册更多 Agent 工具，建议先在 Gateway 核心中建立一个通用的 AIEMAS 工具注入点（类似 `extraHandlers` 对 RPC handler 的作用），再基于该注入点实现 `aiemas_sessions_send`。在此之前，方案 F3（AGENTS.md 派生 + 级联预创建保障）仍是最优选择。

---

## 九、方案重新评估：建立 AIEMAS 工具注入点 + `aiemas_sessions_send`

### 9.1 重新评估背景

方案 F3 虽然零代码改动，但存在根本性的设计问题：

1. **泄露内部实现细节**：sessionKey 的派生规则（`agent:{agentId}:group:{sessionUuid}`）和 session 级联机制是 AIEMAS 的内部实现，不应要求 Agent 用户在 AGENTS.md 中了解和手动执行这些规则
2. **未来扩展性不足**：AIEMAS 未来可能需要定义多个 Agent 工具（如 `aiemas_sessions_history`、`aiemas_topology_query` 等），每个都需要工具注入能力

因此，需要在 Gateway 核心中建立一个通用的 AIEMAS 工具注入点，类似 `extraHandlers` 对 RPC handler 的作用。

### 9.2 架构分析：现有集成点

Gateway 核心通过 `src/gateway/mas4s-integration.ts` 的 `initMas4sIntegration()` 加载 AIEMAS 插件，返回 `Mas4sIntegration` 接口。该接口目前提供：

- `extraHandlers`：RPC handler 注入（WebSocket 客户端调用）
- `interceptRequest`：请求拦截（RBAC 权限检查）
- `filterBroadcast`：广播过滤（多租户隔离）
- `filterSessionsList`：session 列表过滤
- `onSessionCreated` / `onClientConnected` / `onClientDisconnected`：生命周期钩子

**缺失的能力**：Agent 工具注入（LLM 运行时调用的工具）。

### 9.3 推荐方案：扩展 `Mas4sIntegration` 接口 + `aiemas_sessions_send` 工具

#### 9.3.1 步骤 1：在 `Mas4sIntegration` 接口中新增工具注入方法

```typescript
// src/gateway/mas4s-integration.ts
interface Mas4sIntegration {
  // ... 现有字段 ...

  /**
   * 返回 AIEMAS 提供的 Agent 工具列表。
   * 由 createOpenClawTools() 调用，将 AIEMAS 工具注入到 Agent 工具集中。
   */
  resolveAgentTools?: (context: {
    agentSessionKey?: string;
    config?: OpenClawConfig;
  }) => AnyAgentTool[];
}
```

#### 9.3.2 步骤 2：在 `createOpenClawTools()` 中调用注入点

```typescript
// src/agents/openclaw-tools.ts — createOpenClawTools() 末尾
const tools: AnyAgentTool[] = [
  // ... 现有工具 ...
];

// AIEMAS 工具注入
const mas4sTools =
  getMas4sIntegration()?.resolveAgentTools?.({
    agentSessionKey: options?.agentSessionKey,
    config: resolvedConfig,
  }) ?? [];
tools.push(...mas4sTools);
```

这需要一个全局访问点来获取 `Mas4sIntegration` 实例。可以通过模块级变量实现（类似现有的 `plugin.gatewayDispatch` 模式）。

#### 9.3.3 步骤 3：在 AIEMAS 中实现 `aiemas_sessions_send` 工具

```typescript
// aiemas/src/gateway-bridge/aiemas-tools.ts
export function createAiemasSessionsSendTool(deps: {
  db: DatabaseSync;
  topologyCache: TopologyCache;
}): AnyAgentTool {
  return {
    name: "aiemas_sessions_send",
    label: "AIEMAS Session Send",
    description: "向拓扑树中的子 Agent 发送消息。根据 agentId 自动解析目标 sessionKey。",
    parameters: Type.Object({
      agentId: Type.String({ description: "目标子 Agent 的 agentId" }),
      message: Type.String({ description: "要发送的消息" }),
      timeoutSeconds: Type.Optional(
        Type.Number({ minimum: 0, description: "等待回复的超时秒数，默认 30" }),
      ),
    }),
    execute: async (_toolCallId, args, toolContext) => {
      const { agentId, message, timeoutSeconds } = args;
      const callerSessionKey = toolContext.agentSessionKey; // 从工具上下文获取

      // 步骤 1：从调用者 sessionKey 中提取 sessionUuid
      const sessionUuid = extractUuidFromKey(callerSessionKey);

      // 步骤 2：查询 aiemas_sessions 表，查找调用者的根 session 记录
      const store = createAiemasSessionsStore(deps.db);
      const rootSession = store.loadRootSession(callerSessionKey);

      let targetSessionKey: string | undefined;

      if (rootSession) {
        // 步骤 3a：从 descendantSessions 中查找目标 agentId
        const descendant = rootSession.descendantSessions.find((d) => d.agentId === agentId);
        targetSessionKey = descendant?.sessionKey;
      }

      if (!targetSessionKey) {
        // 步骤 3b：fallback — 按派生规则构造 sessionKey
        targetSessionKey = constructKeyFromUuid(agentId, sessionUuid);
      }

      // 步骤 4：调用 sessions_send（通过 callGateway 间接调用）
      // 构造与 sessions_send 相同的参数，传给内部的 sessions_send 工具
      return internalSessionsSend({
        sessionKey: targetSessionKey,
        message,
        timeoutSeconds: timeoutSeconds ?? 30,
        callerSessionKey,
      });
    },
  };
}
```

#### 9.3.4 步骤 4：在 `initMas4sIntegration` 中注册工具

```typescript
// src/gateway/mas4s-integration.ts — initMas4sIntegration() 返回值中
return {
  // ... 现有字段 ...
  resolveAgentTools: (context) => {
    const tools: AnyAgentTool[] = [];
    tools.push(
      createAiemasSessionsSendTool({
        db: plugin.db,
        topologyCache: plugin.tenantService.cacheService.topologyCache,
        agentSessionKey: context.agentSessionKey,
      }),
    );
    // 未来可在此添加更多 AIEMAS 工具
    return tools;
  },
};
```

### 9.4 `aiemas_sessions_send` 内部调用 `sessions_send` 的方式

关键问题：`aiemas_sessions_send` 解析出 `targetSessionKey` 后，如何调用 `sessions_send` 的完整逻辑？

**推荐方式：直接调用 `createSessionsSendTool().execute()`**

```typescript
// aiemas_sessions_send 内部
const sendTool = createSessionsSendTool({
  agentSessionKey: callerSessionKey,
  agentChannel: toolContext.agentChannel,
  config: toolContext.config,
  callGateway: toolContext.callGateway,
});
return sendTool.execute(toolCallId, {
  sessionKey: targetSessionKey,
  message,
  timeoutSeconds,
});
```

**Import boundary 问题的解决**：

由于 `aiemas_sessions_send` 的工具实例是在 `initMas4sIntegration`（Gateway 核心代码）中创建的，而 `initMas4sIntegration` 已经同时导入了 AIEMAS 模块和 Gateway 核心模块，因此不存在 import boundary 违规。具体来说：

- `initMas4sIntegration`（`src/gateway/mas4s-integration.ts`）已经 `import` 了 `aiemas/src/gateway-bridge/*.js`
- `createOpenClawTools`（`src/agents/openclaw-tools.ts`）已经 `import` 了 `src/agents/tools/sessions-send-tool.js`
- 工具注入点在 Gateway 核心层面完成桥接，AIEMAS 代码本身不需要直接导入 Gateway 核心的 `sessions-send-tool.ts`

实际实现时，`createAiemasSessionsSendTool` 可以接收一个 `callSessionsSend` 回调作为依赖注入，由 `initMas4sIntegration` 在桥接层构造：

```typescript
// initMas4sIntegration 中
resolveAgentTools: (context) => {
  return [createAiemasSessionsSendTool({
    db: plugin.db,
    topologyCache: plugin.tenantService.cacheService.topologyCache,
    // 依赖注入：由桥接层构造 sessions_send 调用
    callSessionsSend: async (params) => {
      const sendTool = createSessionsSendTool({
        agentSessionKey: context.agentSessionKey,
        config: context.config,
      });
      return sendTool.execute("aiemas-internal", params);
    },
  })];
},
```

这样 AIEMAS 代码（`aiemas/src/gateway-bridge/aiemas-tools.ts`）只需要定义工具的参数 schema 和 sessionKey 解析逻辑，不需要导入任何 Gateway 核心模块。

### 9.5 对 AGENTS.md 的影响

采用此方案后，`workspace-aieiaas/AGENTS.md` 的调度方式变为：

```markdown
## 调度方式（aiemas_sessions_send）

统一使用 `aiemas_sessions_send` 工具进行子 Agent 调度，只需传 agentId 和 message：

### 同步查询

aiemas_sessions_send(agentId="aieiaas-resource", message="查询所有运行中的虚拟机", timeoutSeconds=30)

### SOP 执行

aiemas_sessions_send(agentId="aieiaas-model", message="执行模型部署 SOP: Qwen2-72B", timeoutSeconds=120)
```

Agent 用户无需了解 sessionKey 派生规则、session 级联机制或任何 AIEMAS 内部实现细节。

### 9.6 改动范围

| 文件                                        | 改动类型 | 说明                                                                                            |
| ------------------------------------------- | -------- | ----------------------------------------------------------------------------------------------- |
| `src/gateway/mas4s-integration.ts`          | 修改     | `Mas4sIntegration` 接口新增 `resolveAgentTools` 方法；`initMas4sIntegration` 返回值中实现该方法 |
| `src/agents/openclaw-tools.ts`              | 修改     | `createOpenClawTools()` 末尾调用 `resolveAgentTools` 注入 AIEMAS 工具                           |
| `aiemas/src/gateway-bridge/aiemas-tools.ts` | 新增     | `createAiemasSessionsSendTool` 实现（sessionKey 解析 + 参数构造）                               |
| `.openclaw/workspace-aieiaas/AGENTS.md`     | 修改     | 调度方式改为使用 `aiemas_sessions_send`                                                         |

### 9.7 方案对比（最终版）

| 方案                                       | 对 LLM 的要求    | 架构合规性  | 封装性          | 扩展性            | 改动量 | 推荐度            |
| ------------------------------------------ | ---------------- | ----------- | --------------- | ----------------- | ------ | ----------------- |
| F3：AGENTS.md 派生                         | 中（字符串操作） | ✅          | ❌ 泄露内部实现 | ❌ 无             | 零     | ⭐⭐              |
| G（旧）：无注入点直接加工具                | 低               | ❌ 违反边界 | ✅              | ❌ 无通用机制     | 中     | ⭐⭐              |
| **G（新）：注入点 + aiemas_sessions_send** | **低**           | **✅**      | **✅ 完全封装** | **✅ 通用注入点** | **中** | **⭐⭐⭐⭐ 最优** |

### 9.8 结论

方案 G（新）通过在 `Mas4sIntegration` 接口中新增 `resolveAgentTools` 方法，建立了一个通用的 AIEMAS Agent 工具注入点。这个注入点：

1. **不违反架构边界**：桥接在 `mas4s-integration.ts`（Gateway 核心的 AIEMAS 集成点）中完成，AIEMAS 代码不直接导入 Gateway 核心模块
2. **完全封装内部实现**：Agent 用户只需传 `agentId` + `message`，无需了解 sessionKey 派生规则或级联机制
3. **支持未来扩展**：`resolveAgentTools` 返回工具数组，未来可轻松添加更多 AIEMAS 工具
4. **复用现有 `sessions_send` 逻辑**：通过依赖注入回调调用 `sessions_send`，保留完整的权限检查、同步等待、A2A Flow 等能力
5. **改动最小化**：仅修改 2 个 Gateway 核心文件（接口扩展 + 工具注入调用），新增 1 个 AIEMAS 文件（工具实现）
