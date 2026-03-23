# 设计文档：mas4s 会话协作管理

## 概述

本设计文档描述 mas4s 会话协作管理功能的技术实现方案，覆盖以下需求：会话邀请（需求 1）、删除协作者（需求 2）、会话归档（需求 3）、会话摘要（需求 4）、数据库 Schema 扩展（需求 5）。所有需求一次性实现。

所有新功能在现有实现基础上扩展，遵循"最小入侵原 gateway"原则。

---

## 架构

### 整体分层

```
┌─────────────────────────────────────────────────────────────┐
│  前端（aiemas/ui/mas4s/src/）                                │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────────┐  │
│  │ InviteDialog │  │SessionSidebar│  │  SummaryPanel     │  │
│  └──────┬───────┘  └──────┬───────┘  └────────┬──────────┘  │
│         │                 │                   │              │
│  ┌──────▼─────────────────▼───────────────────▼──────────┐  │
│  │  AppStore（会话列表、归档状态、摘要缓存）               │  │
│  └──────────────────────────┬──────────────────────────┘  │
│                             │                              │
│  ┌──────────────────────────▼──────────────────────────┐  │
│  │  EventHandler（session.joined/removed/archived/      │  │
│  │               summary.updated）                      │  │
│  └──────────────────────────┬──────────────────────────┘  │
│                             │ WebSocket                    │
└─────────────────────────────┼────────────────────────────┘
                              │
┌─────────────────────────────▼────────────────────────────┐
│  后端（aiemas/src/gateway-bridge/）                        │
│  ┌─────────────────────────────────────────────────────┐  │
│  │  mas4s-gateway-plugin.ts（extraHandlers 路由）       │  │
│  │  session.invite / session.removeMember               │  │
│  │  session.archive / session.summary.generate          │  │
│  │  session.summary.get                                 │  │
│  └──────────────────┬──────────────────────────────────┘  │
│                     │                                      │
│  ┌──────────────────▼──────────────────────────────────┐  │
│  │  GatewayAuthBridge（bridge.ts）                      │  │
│  │  inviteToSession / removeMember                      │  │
│  │  archiveSession / generateSummary / getSummary       │  │
│  │  pushSessionArchived / pushSummaryUpdated            │  │
│  └──────────────────┬──────────────────────────────────┘  │
│                     │                                      │
│  ┌──────────────────▼──────────────────────────────────┐  │
│  │  session-manager.ts（纯 SQLite 操作）                │  │
│  │  inviteToSession / removeMember                      │  │
│  │  archiveSession / isSessionArchived                  │  │
│  │  upsertSummary / getSummary                          │  │
│  └──────────────────┬──────────────────────────────────┘  │
│                     │                                      │
│  ┌──────────────────▼──────────────────────────────────┐  │
│  │  database.ts（ensureMas4sSchema）                    │  │
│  │  session_ownership.archivedAt 字段迁移               │  │
│  │  session_summaries 表创建                            │  │
│  └─────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────┘
```

### 数据流：chat.send 归档拦截

```
chat.send 请求
    │
    ▼
bridge.interceptMethod()
    │
    ├─ checkSessionAccess() → SESSION_ACCESS_DENIED（非成员）
    │
    └─ isSessionArchived() → SESSION_ARCHIVED（已归档）
            │
            ▼
        允许继续（未归档）
```

### 数据流：session.unarchive 启用会话

```
session.unarchive 请求
    │
    ▼
bridge.unarchiveSession()
    │
    ├─ 权限校验（仅 owner）
    ├─ 将 session_ownership.archivedAt 重置为 NULL
    └─ pushSessionUnarchived() 推送事件给所有在线成员
```

### 数据流：session.archive 自动触发摘要

```
session.archive 请求
    │
    ▼
bridge.archiveSession()
    │
    ├─ 权限校验（仅 owner）
    ├─ 更新 session_ownership.archivedAt
    │
    └─ 自动调用 generateSummary()
            │
            ├─ 调用 chat.history 获取消息
            ├─ 提取 textLines + toolPairs
            ├─ 调用 LLM 生成 textSummary + toolSummary
            ├─ upsertSummary() 持久化到 session_summaries
            └─ pushSummaryUpdated() 推送事件给所有在线成员
```

### 数据流：session.summary.generate（未归档 vs 已归档）

```
session.summary.generate 请求
    │
    ▼
bridge.generateSummary()
    │
    ├─ isSessionArchived() == false（未归档）
    │       ├─ 校验调用者为 Session_Member（owner 或 participant）
    │       ├─ 调用 chat.history + LLM 生成摘要
    │       └─ 直接返回 { persisted: false }，不写库，不推送事件
    │
    └─ isSessionArchived() == true（已归档）
            ├─ 校验调用者为 Session_Owner → 非 owner 返回 SESSION_ACCESS_DENIED
            ├─ 调用 chat.history + LLM 生成摘要
            ├─ upsertSummary() 持久化
            ├─ pushSummaryUpdated() 推送事件
            └─ 返回 { persisted: true }
```

---

## 组件与接口

### 后端新增接口（extraHandlers）

所有新接口在 `aiemas/src/gateway-bridge/mas4s-gateway-plugin.ts` 的 `extraHandlers` 中注册，遵循现有模式。

#### `session.archive`

```typescript
// 请求
{ sessionKey: string }

// 成功响应（摘要生成成功）
{ ok: true, archivedAt: number, summaryGenerated: true }

// 成功响应（消息为空，无法生成摘要，但归档仍成功）
{ ok: true, archivedAt: number, summaryGenerated: false }

// 错误响应
{ code: "SESSION_ACCESS_DENIED" | "INTERNAL", message: string }
```

#### `session.unarchive`

```typescript
// 请求
{ sessionKey: string }

// 成功响应
{ ok: true }

// 错误响应
{ code: "SESSION_ACCESS_DENIED" | "INTERNAL", message: string }
```

#### `session.summary.generate`

```typescript
// 请求
{ sessionKey: string }

// 成功响应（未归档：仅返回，不持久化）
{ ok: true, textSummary: string | null, toolSummary: string | null, generatedAt: number, persisted: false }

// 成功响应（已归档：返回并持久化）
{ ok: true, textSummary: string | null, toolSummary: string | null, generatedAt: number, persisted: true }

// 错误响应
{ code: "SESSION_ACCESS_DENIED" | "NO_MESSAGES_TO_SUMMARIZE" | "LLM_NOT_CONFIGURED" | "INTERNAL", message: string }
```

#### `session.summary.get`

```typescript
// 请求
{ sessionKey: string }

// 成功响应
{ summary: SessionSummary | null }
// SessionSummary: { textSummary: string | null, toolSummary: string | null, generatedAt: number, generatedBy: string }

// 错误响应
{ code: "SESSION_ACCESS_DENIED" | "INTERNAL", message: string }
```

### 后端 bridge.ts 新增方法

```typescript
// 归档会话（自动触发摘要生成并持久化）
archiveSession(params: {
  sessionKey: string;
  callerUserId: string;
  fetchHistory: () => Promise<unknown[]>;  // 由 plugin 注入，用于自动生成摘要
}): Promise<{ ok: true; archivedAt: number } | { ok: false; code: string; message: string }>

// 生成摘要（含 LLM 调用）
// - 未归档：生成后直接返回，不写库
// - 已归档：生成后写库并推送 event:session.summary.updated
generateSummary(params: {
  sessionKey: string;
  callerUserId: string;
  fetchHistory: () => Promise<unknown[]>;  // 由 plugin 注入，调用 chat.history
}): Promise<{ ok: true; textSummary: string | null; toolSummary: string | null; generatedAt: number; persisted: boolean } | { ok: false; code: string; message: string }>

// 获取摘要
getSummary(params: {
  sessionKey: string;
  callerUserId: string;
}): { ok: true; summary: SessionSummary | null } | { ok: false; code: string; message: string }

// 推送归档事件
pushSessionArchived(
  sessionKey: string,
  payload: { sessionKey: string; archivedAt: number; archivedBy: string },
  connectedUsers: Map<string, MasAuthContext>,
  sendToClient: (userId: string, event: string, data: unknown) => void,
): void

// 推送摘要更新事件
pushSummaryUpdated(
  sessionKey: string,
  payload: { sessionKey: string; generatedAt: number },
  connectedUsers: Map<string, MasAuthContext>,
  sendToClient: (userId: string, event: string, data: unknown) => void,
): void

// 会话删除钩子：同步删除摘要记录（若存在）
onSessionDeleted(sessionKey: string): void
```

### chat.send 归档拦截

在 `bridge.ts` 的 `interceptMethod` 中，对 `chat.send` 方法增加归档检查：

```typescript
// 在现有 checkSessionAccess 之后
if (method === "chat.send" && sessionKey) {
  const archived = sessionManager.isSessionArchived(this.db, sessionKey);
  if (archived) {
    return { allowed: false, code: SESSION_ARCHIVED, message: "Session is archived" };
  }
}
```

同时在 `_isSessionAccessMethod` 中保持 `chat.send` 的成员校验。

### 前端新增接口（gateway/session-archive.ts）

```typescript
// 归档会话
export async function archiveSession(
  client: GatewayBrowserClient,
  sessionKey: string,
): Promise<void>;

// 生成摘要
export async function generateSummary(
  client: GatewayBrowserClient,
  sessionKey: string,
): Promise<SessionSummary>;

// 获取摘要
export async function getSummary(
  client: GatewayBrowserClient,
  sessionKey: string,
): Promise<SessionSummary | null>;
```

---

## 数据模型

### 后端模型扩展（models.ts）

```typescript
// 新增
export interface SessionSummary {
  sessionKey: string;
  textSummary: string | null; // 对话文本摘要，无对话内容时为 null
  toolSummary: string | null; // 工具调用摘要，无工具调用时为 null
  generatedAt: number;
  generatedBy: string; // userId
}
```

### 前端类型扩展（types/session-types.ts）

```typescript
export interface MasSession extends GatewaySessionRow {
  masType: "initiated" | "participated";
  hasNotification: boolean;
  notificationCount: number;
  participants: MasParticipant[];
  archivedAt?: number | null; // 新增：NULL 表示未归档
  hasSummary?: boolean; // 新增：是否已有持久化摘要
}
```

`sessions.list` 响应中每条会话记录由 `filterSessionsForUser` 钩子附加这两个字段：

```typescript
// bridge.ts filterSessionsForUser 扩展
// 对每条有 SessionMembership 的会话，查询 session_ownership.archivedAt 和
// session_summaries 是否存在记录，附加到会话对象
function enrichSessionRow(
  db: DatabaseSync,
  session: Record<string, unknown>,
): Record<string, unknown> {
  const sessionKey = session["key"] as string;
  const ownership = db
    .prepare("SELECT archivedAt FROM session_ownership WHERE sessionKey = ?")
    .get(sessionKey) as { archivedAt: number | null } | undefined;
  const hasSummary =
    db.prepare("SELECT 1 FROM session_summaries WHERE sessionKey = ?").get(sessionKey) != null;
  return { ...session, archivedAt: ownership?.archivedAt ?? null, hasSummary };
}
```

### 数据库 Schema 扩展

#### session_ownership 表迁移

```sql
-- 幂等迁移：若 archivedAt 列不存在则添加
ALTER TABLE session_ownership ADD COLUMN archivedAt INTEGER;
-- 使用 pragma_table_info 检查列是否存在，避免重复执行报错
```

实现方式：在 `ensureMas4sSchema` 中使用 `pragma_table_info` 检查列存在性：

```typescript
const cols = db.prepare("PRAGMA table_info(session_ownership)").all() as Array<{ name: string }>;
if (!cols.some((c) => c.name === "archivedAt")) {
  db.exec("ALTER TABLE session_ownership ADD COLUMN archivedAt INTEGER");
}
```

#### session_summaries 表

```sql
CREATE TABLE IF NOT EXISTS session_summaries (
  sessionKey   TEXT PRIMARY KEY,
  textSummary  TEXT,             -- 对话文本摘要，可为 NULL
  toolSummary  TEXT,             -- 工具调用摘要，可为 NULL
  generatedAt  INTEGER NOT NULL,
  generatedBy  TEXT NOT NULL
);
```

### session-manager.ts 新增函数

```typescript
// 归档会话（幂等：已归档则不更新 archivedAt）
export function archiveSession(db: DatabaseSync, sessionKey: string, callerUserId: string): number; // 返回 archivedAt 时间戳

// 检查会话是否已归档
export function isSessionArchived(db: DatabaseSync, sessionKey: string): boolean;

// 写入/覆盖摘要
export function upsertSummary(
  db: DatabaseSync,
  sessionKey: string,
  content: string,
  generatedBy: string,
): SessionSummary;

// 读取摘要
export function getSummary(db: DatabaseSync, sessionKey: string): SessionSummary | null;

// 删除摘要（会话删除时调用，幂等）
export function deleteSummary(db: DatabaseSync, sessionKey: string): void;
```

### LLM 调用方式

`session.summary.generate` 通过 gateway 的 `chat.history` 接口获取消息历史，提取其中的 `messages` 数组，再调用 LLM 生成摘要。

#### chat.history 响应结构

`chat.history` 返回标准 gateway 响应格式，摘要生成时从 `payload.messages` 中提取内容：

```typescript
// chat.history 响应结构（简化）
interface ChatHistoryResponse {
  type: "res";
  ok: boolean;
  payload: {
    sessionKey: string;
    messages: ChatHistoryMessage[];
    thinkingLevel: string;
  };
}

interface ChatHistoryMessage {
  role: "user" | "assistant" | "toolResult";
  content: Array<
    | { type: "text"; text: string }
    | { type: "thinking"; thinking: string }
    | { type: "toolCall"; id: string; name: string; arguments: unknown }
  >;
  timestamp: number;
  senderLabel?: string; // 用户消息的发送者标签，如 "管理员 (webchat-ui)"
  // toolResult 专属字段
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
  __openclaw?: { id: string; seq: number };
}
```

#### 消息提取规则

会话摘要分为两个独立部分，分别提取、分别生成：

**文本摘要（textSummary）**：提取对话文本内容

- `role="user"`：提取 `content` 中 `type="text"` 的 `text` 字段，附加 `senderLabel`（若有）作为发送者标识
- `role="assistant"`：提取 `content` 中 `type="text"` 的 `text` 字段，忽略 `type="thinking"` 和 `type="toolCall"`
- `role="toolResult"`：忽略

**工具调用摘要（toolSummary）**：提取工具调用及其结果

- `role="assistant"` 中 `type="toolCall"` 的条目：提取 `name`（工具名）和 `arguments`
- `role="toolResult"`：提取 `toolName`、`content` 中 `type="text"` 的 `text`、`isError` 字段
- 将同一 `toolCallId` 的调用与结果配对

```typescript
interface ExtractedContent {
  textLines: string[]; // 对话文本行，用于文本摘要
  toolPairs: Array<{
    // 工具调用+结果对，用于工具调用摘要
    name: string;
    arguments: unknown;
    result: string;
    isError: boolean;
  }>;
}

function extractContentForSummary(messages: ChatHistoryMessage[]): ExtractedContent {
  const textLines: string[] = [];
  const toolCallMap = new Map<string, { name: string; arguments: unknown }>();
  const toolPairs: ExtractedContent["toolPairs"] = [];

  for (const m of messages) {
    if (m.role === "user") {
      const text = m.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("")
        .trim();
      if (text) textLines.push(`${m.senderLabel ?? "用户"}: ${text}`);
    } else if (m.role === "assistant") {
      const text = m.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("")
        .trim();
      if (text) textLines.push(`助手: ${text}`);
      // 收集工具调用
      for (const c of m.content) {
        if (c.type === "toolCall") {
          toolCallMap.set(c.id, { name: c.name, arguments: c.arguments });
        }
      }
    } else if (m.role === "toolResult") {
      const call = toolCallMap.get(m.toolCallId);
      const resultText = m.content
        .filter((c): c is { type: "text"; text: string } => c.type === "text")
        .map((c) => c.text)
        .join("")
        .trim();
      toolPairs.push({
        name: call?.name ?? m.toolName,
        arguments: call?.arguments ?? {},
        result: resultText,
        isError: m.isError ?? false,
      });
    }
  }

  return { textLines, toolPairs };
}
```

#### LLM 调用

直接调用 OpenAI/Anthropic 兼容接口（通过环境变量 `MAS4S_LLM_BASE_URL`、`MAS4S_LLM_API_KEY`、`MAS4S_LLM_MODEL` 配置）。

对提取的两部分内容**分别发起 LLM 调用**，生成两段独立摘要：

**文本摘要 Prompt**：

```
你是一个会话摘要助手。请对以下多智能体协作会话的对话内容生成简洁摘要（不超过 300 字），
涵盖主要讨论话题和关键决策。

对话内容：
{textLines}
```

**工具调用摘要 Prompt**：

```
你是一个会话摘要助手。请对以下工具调用记录生成简洁摘要（不超过 300 字），
列出执行了哪些工具、主要参数和结果，标注失败的调用。

工具调用记录：
{toolPairs}
```

若 `textLines` 为空且 `toolPairs` 为空，返回错误 `NO_MESSAGES_TO_SUMMARIZE`。若某一部分为空，则对应摘要字段为 `null`，不发起该部分的 LLM 调用。

若环境变量未配置，`generateSummary` 返回错误 `LLM_NOT_CONFIGURED`（前端显示友好提示）。

### 前端 AppStore 扩展

```typescript
// 新增字段
summaryBySession: Map<string, SessionSummary> = new Map();

// 新增方法
updateSessionArchived(sessionKey: string, archivedAt: number): void
setSummary(sessionKey: string, summary: SessionSummary): void
getSummary(sessionKey: string): SessionSummary | undefined
```

### 前端事件处理扩展（event-handler.ts）

新增两个事件处理分支：

```typescript
case "session.archived": {
  const { sessionKey, archivedAt } = evt.payload as {
    sessionKey: string; archivedAt: number; archivedBy: string;
  };
  store.updateSessionArchived(sessionKey, archivedAt);
  console.info("会话已归档，无法继续发送消息");
  break;
}
case "session.summary.updated": {
  const { sessionKey } = evt.payload as { sessionKey: string; generatedAt: number };
  // 触发摘要刷新（由组件监听 store 变化后主动拉取）
  store.notify();
  break;
}
```

### 前端组件变更

#### SessionSidebar

- 在会话列表项中，若 `session.archivedAt` 不为 null，显示归档图标（📦）
- 归档会话在列表中以灰色样式渲染，区别于活跃会话

#### ChatInput（输入框禁用逻辑）

- 当 `activeSession.archivedAt` 不为 null 时，输入框 `disabled` 属性为 `true`
- 输入框占位文本变为"会话已归档，无法发送消息"

#### SummaryPanel（新增组件）

- 位于会话详情区域底部
- 所有 Session_Member 均可见"生成摘要"按钮（已归档会话仅 Session_Owner 可见），点击调用 `session.summary.generate`
- 未归档会话：摘要结果仅在当前客户端展示，不推送给其他成员，刷新后消失
- 已归档会话：摘要结果持久化，所有成员均可通过 `session.summary.get` 查看
- **初始化加载**：前端加载会话列表时，若某会话的 `hasSummary=true`，自动调用 `session.summary.get` 获取摘要并写入 `AppStore.summaryBySession`
- 摘要内容区域分两个子区域展示：
  - **对话摘要**：显示 `textSummary`（为 null 时显示"暂无对话内容"）
  - **工具调用摘要**：显示 `toolSummary`（为 null 时显示"暂无工具调用"）
- 显示 `generatedAt` 时间戳
- 收到 `event:session.summary.updated` 事件（归档触发）后自动调用 `getSummary` 刷新

---

## 正确性属性

_属性是在系统所有有效执行中应保持为真的特征或行为——本质上是关于系统应做什么的形式化陈述。属性是人类可读规范与机器可验证正确性保证之间的桥梁。_

### 属性 1：邀请权限对称性

_对于任意_ 会话 S 和用户 U，当 U 是 S 的 Session_Member（无论 owner 还是 participant）时，`session.invite` 应成功；当 U 不是 S 的 Session_Member 时，`session.invite` 应返回 `SESSION_ACCESS_DENIED`。

**验证：需求 1.1、1.2、1.5**

---

### 属性 2：邀请成员增长不变量

_对于任意_ 会话 S，成功调用 `session.invite(targetUserId)` 后，`session.members` 返回的列表长度应恰好增加 1，且列表中包含 `targetUserId`；若 `targetUserId` 已是成员，列表长度不变，接口返回 `ALREADY_MEMBER`。

**验证：需求 1.2、1.6**

---

### 属性 3：删除成员完整性

_对于任意_ 会话 S 的 Session_Owner A 和 Session_Participant B，A 调用 `session.removeMember(B)` 后，`session.members` 不包含 B，B 调用 `sessions.list` 不包含 S；若 B 在线，B 应收到 `event:session.removed` 推送。

**验证：需求 2.2、2.3**

---

### 属性 4：owner 不可自行移除

_对于任意_ 会话 S 的 Session_Owner U，U 调用 `session.removeMember(U)` 应返回 `OWNER_CANNOT_LEAVE`，`session_memberships` 中 U 的记录不应被删除。

**验证：需求 2.6**

---

### 属性 5：归档后拒绝发送消息

_对于任意_ 已归档会话 S（`archivedAt` 不为 NULL），任意 Session_Member 调用 `chat.send` 到 S 应返回 `SESSION_ARCHIVED`；调用 `chat.history` 应正常返回历史消息（只读操作不受归档影响）。

**验证：需求 3.4、3.5**

---

### 属性 6：归档幂等性

_对于任意_ 已归档会话 S，再次调用 `session.archive` 应成功（或返回已归档状态），`archivedAt` 字段值不应被更新为新的时间戳（保留首次归档时间）。

**验证：需求 3.2**

---

### 属性 7：摘要持久化条件

_对于任意_ 会话 S，当 S **未归档**时调用 `session.summary.generate`，摘要内容直接返回，`session_summaries` 表中不应存在 S 的记录；当 S **已归档**时调用 `session.summary.generate`，摘要内容应同时持久化，`session.summary.get` 应返回等价内容。

**验证：需求 4.3、4.4、4.6**

---

### 属性 7b：归档自动触发摘要持久化

_对于任意_ 消息历史非空的会话 S，调用 `session.archive` 成功后，`session_summaries` 表中应存在 S 的摘要记录，`session.summary.get` 应返回该摘要。

**验证：需求 4.5**

---

### 属性 8：摘要权限隔离

_对于任意_ 非 Session_Member 用户 U，U 调用 `session.summary.get` 或 `session.summary.generate` 均应返回 `SESSION_ACCESS_DENIED`；未归档会话的 Session_Participant 调用 `session.summary.generate` 应成功（返回摘要但不持久化）；已归档会话的 Session_Participant 调用 `session.summary.generate` 应返回 `SESSION_ACCESS_DENIED`。

**验证：需求 4.1、4.7、4.8**

---

### 属性 9：Schema 迁移幂等性

_对于任意_ 已包含 `archivedAt` 字段的 `session_ownership` 表或已存在的 `session_summaries` 表，重复调用 `ensureMas4sSchema` 不应抛出错误，数据库状态应保持不变。

**验证：需求 5.1、5.2、5.3**

---

## 错误处理

### 新增错误码（errors.ts）

```typescript
export const SESSION_ARCHIVED = "SESSION_ARCHIVED";
export const NO_MESSAGES_TO_SUMMARIZE = "NO_MESSAGES_TO_SUMMARIZE";
```

### 错误处理策略

| 错误码                     | 触发场景                                    | 前端处理                               |
| -------------------------- | ------------------------------------------- | -------------------------------------- |
| `SESSION_ARCHIVED`         | 已归档会话调用 `chat.send`                  | 输入框禁用，显示"会话已归档"提示       |
| `NO_MESSAGES_TO_SUMMARIZE` | 无消息历史时调用 `session.summary.generate` | Toast 提示"会话暂无消息，无法生成摘要" |
| `SESSION_ACCESS_DENIED`    | 非成员/非 owner 调用受限接口                | Toast 提示"权限不足"                   |
| `ALREADY_MEMBER`           | 重复邀请已有成员                            | Toast 提示"该用户已是会话成员"         |
| `NOT_A_MEMBER`             | 移除不存在的成员                            | Toast 提示"该用户不是会话成员"         |
| `OWNER_CANNOT_LEAVE`       | owner 尝试移除自己                          | Toast 提示"会话创建者无法被移除"       |

### bridge.ts 错误包装

所有 session-manager 抛出的 `TenantServiceError` 在 bridge 方法中统一捕获，转换为 `{ ok: false, code, message }` 格式返回，与现有模式一致。

---

## 测试策略

### 双轨测试方法

单元测试和属性测试互补，共同保证正确性：

- **单元测试**（`*.test.ts`）：验证具体示例、边界条件、错误路径
- **属性测试**（`*.property.test.ts`）：使用 fast-check 验证普遍属性，覆盖随机输入

### 属性测试配置

- 使用 **fast-check** 库（项目已有，见 `aiemas/src/auth/jwt.property.test.ts`）
- 每个属性测试最少运行 **100 次**迭代
- 每个属性测试必须引用设计文档中对应的属性编号

标签格式：`// Feature: mas4s-session-collaboration, Property {N}: {属性描述}`

### 属性测试文件

新增 `aiemas/src/gateway-bridge/session-collaboration.property.test.ts`，覆盖属性 1-9。

#### 属性 1 测试示例

```typescript
// Feature: mas4s-session-collaboration, Property 1: 邀请权限对称性
it("成员可邀请，非成员被拒绝", () => {
  fc.assert(
    fc.property(
      fc.record({ sessionKey: fc.string(), ownerId: fc.string(), targetId: fc.string() }),
      ({ sessionKey, ownerId, targetId }) => {
        // 成员调用应成功
        // 非成员调用应返回 SESSION_ACCESS_DENIED
      },
    ),
    { numRuns: 100 },
  );
});
```

#### 属性 2 测试示例

```typescript
// Feature: mas4s-session-collaboration, Property 2: 邀请成员增长不变量
it("邀请后成员列表长度恰好增加 1", () => {
  fc.assert(
    fc.property(
      fc.record({ sessionKey: fc.string(), ownerId: fc.string(), newUserId: fc.string() }),
      ({ sessionKey, ownerId, newUserId }) => {
        const before = listSessionMembers(db, sessionKey, ownerId).length;
        inviteToSession(db, sessionKey, newUserId, ownerId);
        const after = listSessionMembers(db, sessionKey, ownerId).length;
        return after === before + 1;
      },
    ),
    { numRuns: 100 },
  );
});
```

#### 属性 6 测试示例（幂等性）

```typescript
// Feature: mas4s-session-collaboration, Property 6: 归档幂等性
it("重复归档不更新 archivedAt", () => {
  fc.assert(
    fc.property(
      fc.record({ sessionKey: fc.string(), ownerId: fc.string() }),
      ({ sessionKey, ownerId }) => {
        const first = archiveSession(db, sessionKey, ownerId);
        const second = archiveSession(db, sessionKey, ownerId);
        return first === second; // archivedAt 不变
      },
    ),
    { numRuns: 100 },
  );
});
```

#### 属性 7 测试示例（round-trip）

```typescript
// Feature: mas4s-session-collaboration, Property 7: 摘要 round-trip
it("生成摘要后立即查询返回等价内容", () => {
  fc.assert(
    fc.property(
      fc.record({
        sessionKey: fc.string(),
        content: fc.string({ minLength: 1 }),
        userId: fc.string(),
      }),
      ({ sessionKey, content, userId }) => {
        upsertSummary(db, sessionKey, content, userId);
        const result = getSummary(db, sessionKey);
        return result?.content === content;
      },
    ),
    { numRuns: 100 },
  );
});
```

#### 属性 9 测试示例（幂等性）

```typescript
// Feature: mas4s-session-collaboration, Property 9: Schema 迁移幂等性
it("重复调用 ensureMas4sSchema 不抛出错误", () => {
  expect(() => {
    ensureMas4sSchema(db);
    ensureMas4sSchema(db);
    ensureMas4sSchema(db);
  }).not.toThrow();
});
```

### 单元测试覆盖点

- `session.archive`：owner 可归档、非 owner 被拒绝、归档后 `chat.send` 返回 `SESSION_ARCHIVED`
- `session.summary.generate`：无消息时返回 `NO_MESSAGES_TO_SUMMARIZE`、非 owner 被拒绝
- `session.summary.get`：非成员被拒绝、participant 可读取
- Schema 迁移：`archivedAt` 列添加、`session_summaries` 表创建

### 测试辅助工具

在 `aiemas/src/test-helpers/generators.ts` 中新增：

```typescript
// 生成随机会话（含 owner 和若干 participant）
export function arbSession(db: DatabaseSync): fc.Arbitrary<{ sessionKey: string; ownerId: string }>;

// 生成随机摘要内容
export function arbSummaryContent(): fc.Arbitrary<string>;
```
