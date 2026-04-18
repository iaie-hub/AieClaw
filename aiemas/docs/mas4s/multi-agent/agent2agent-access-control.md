# 权限控制体系

**源文件：** `src/agents/tools/sessions-access.ts`

## 1. 双层权限检查

跨 agent 访问必须**同时满足**两层：

**第一层：Visibility（会话可见性）**

| 模式      | 可见范围                                   | 配置项                            |
| --------- | ------------------------------------------ | --------------------------------- |
| `"self"`  | 仅自己的当前 session                       | `tools.sessions.visibility=self`  |
| `"tree"`  | 自己 + 所有 spawned 子 session（**默认**） | `tools.sessions.visibility=tree`  |
| `"agent"` | 仅本 agent 的所有 session                  | `tools.sessions.visibility=agent` |
| `"all"`   | 所有 session                               | `tools.sessions.visibility=all`   |

> 跨 agent 访问要求 visibility 为 `"all"`，否则直接拒绝。

**第二层：A2A Policy（跨 agent 权限策略）**

```yaml
tools:
  agentToAgent:
    enabled: true # 总开关，默认 false（关闭）
    allow: # 白名单，空列表 = 允许所有
      - "agent-a"
      - "agent-b"
      - "agent-*" # 支持通配符
      - "*" # 允许全部
```

## 2. isAllowed 判断逻辑

```typescript
isAllowed = (requesterAgentId: string, targetAgentId: string): boolean => {
  // 同 agent 内部访问始终允许（不跨 agent）
  if (requesterAgentId === targetAgentId) return true;
  // 总开关
  if (!enabled) return false;
  // 双方都必须在白名单中
  return matchesAllow(requesterAgentId) && matchesAllow(targetAgentId);
};
```

## 3. 沙盒会话的额外限制

沙盒 session（`sandboxed=true`）即使配置了 `visibility=all`，也会被强制收紧为 `"tree"`：

```typescript
// src/agents/tools/sessions-access.ts: resolveEffectiveSessionToolsVisibility
if (sandboxed && sandboxClamp === "spawned" && visibility !== "tree") {
  return "tree"; // 强制收紧
}
```
