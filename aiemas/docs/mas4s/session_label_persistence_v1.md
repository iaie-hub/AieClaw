# aiemas 会话名称持久化方案 v1

## 1. 问题背景

openclaw 核心将会话元数据（`label`、`displayName`）存储在 `sessions.json` 中。
Session reset（自动定时重置或用户主动 `/new`）会重建 `SessionEntry`，在某些代码路径下 `displayName` 未被正确携带，导致会话名称丢失。

根本原因：`sessions.json` 是运行时状态文件，不是持久化存储；aiemas 作为多租户平台需要一个独立的、不受 reset 影响的名称存储。

---

## 2. 方案：aiemas DB 作为 label 权威存储

### 2.1 存储位置

`~/.openclaw/aiemas/mas4s.db` — 主库（已有 WAL 模式）

新增表：

```sql
CREATE TABLE IF NOT EXISTS session_labels (
  sessionKey   TEXT    PRIMARY KEY,
  label        TEXT    NULL,
  displayName  TEXT    NULL,
  updatedAt    INTEGER NOT NULL
);
```

`sessionKey` 在 session reset 后保持不变，因此该表天然跨 reset 持久化。

### 2.2 写入路径

通过 `onSessionLifecycleEvent`（`src/sessions/session-lifecycle-events.ts`）订阅，在以下时机写入：

| 触发点            | reason              | 写入内容                                 |
| ----------------- | ------------------- | ---------------------------------------- |
| `sessions.create` | `"create"`          | `label`、`displayName`                   |
| `sessions.patch`  | `"patch"`           | `label`、`displayName`（仅有变化时）     |
| `sessions.reset`  | `"new"` / `"reset"` | 重置后新 entry 的 `label`、`displayName` |
| `sessions.delete` | `"session-delete"`  | 删除该 `sessionKey` 的记录               |

核心侧改动（`src/gateway/server-methods/sessions.ts`）：在上述四个 handler 的 `emitSessionsChanged` 之后，同时调用 `emitSessionLifecycleEvent`，携带 `label`/`displayName`。

aiemas 侧（`aiemas/src/gateway-bridge/mas4s-gateway-plugin.ts`）：在 `createMas4sGatewayPlugin` 里订阅 `onSessionLifecycleEvent`，调用 `upsertSessionLabel` / `deleteSessionLabel`。

### 2.3 读取路径

新增两个 gateway handler：

- `session.label.get` — 按 `sessionKey` 查询，返回 `{ sessionKey, label, displayName, updatedAt }`
- `session.label.list` — 返回所有记录（需认证），按 `updatedAt DESC` 排序

前端可在 `sessions.list` 返回的 `displayName` 为 null 时，fallback 调用 `session.label.get` 从 aiemas DB 读取。

### 2.4 合并策略

```
sessions.list 返回的 displayName（来自 sessions.json）
  ?? session.label.get 返回的 displayName（来自 mas4s.db）
  ?? session.label.get 返回的 label
  ?? sessionKey
```

---

## 3. 文件变更清单

| 文件                                                | 变更                                                                                                                                |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `aiemas/src/store/database.ts`                      | `ensureMas4sSchema` 新增 `session_labels` 表                                                                                        |
| `aiemas/src/session-history/session-label-store.ts` | 新建：`upsertSessionLabel`、`getSessionLabel`、`listSessionLabels`、`deleteSessionLabel`                                            |
| `aiemas/src/gateway-bridge/mas4s-gateway-plugin.ts` | 订阅 `onSessionLifecycleEvent`；新增 `session.label.get`、`session.label.list` handler；`Mas4sGatewayPlugin` 接口加 `stopLabelSync` |
| `src/gateway/server-methods/sessions.ts`            | `sessions.create`、`sessions.patch`、`sessions.reset`、`sessions.delete` 后 emit `SessionLifecycleEvent`                            |

---

## 4. 与 session_label.md 的关系

`session_label.md` 描述的是 `performGatewaySessionReset`（路径 A）和 `initSessionState`（路径 B）中 `displayName` 字段遗漏的修复方案。

本方案是**补充层**，不依赖 `sessions.json` 的字段是否被正确携带：

- 即使 `sessions.json` 中的 `displayName` 因任何原因丢失，aiemas DB 仍保有最后一次写入的值
- 两个方案可以同时存在，互不干扰
- aiemas DB 的值作为 fallback，不覆盖 `sessions.json` 的权威值

---

## 5. 生命周期管理

`stopLabelSync()` 在 `Mas4sGatewayPlugin` 接口上暴露，调用方（集成层）在 gateway 关闭时调用，取消 `onSessionLifecycleEvent` 订阅，防止内存泄漏。
