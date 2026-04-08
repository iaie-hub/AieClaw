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
