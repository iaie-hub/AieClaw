# Agent SOP 可视化与 Skill 进度观测

> 目标：让用户在前端实时看到 Agent 执行 SOP 的全貌——当前处于哪个 Step、每个 Skill 执行了多久、内部进度日志——而非只能等待最终结果。

---

## 1. 问题现状

以 researcher agent 为例，用户发送"分析 multi-agent 的最新 5 篇研究成果"后：

- SOP 共 5 步（search → download → pdf_to_markdown → summary → analyze），端到端耗时可达 **1 小时以上**
- `pdf_to_markdown` 单步可能超过 1 小时（逐篇转换，每篇含页级并发）
- 用户在前端只能看到 agent 的文本回复和 tool call 卡片，无法感知：
  - 当前正在执行哪个 Step / Skill
  - 该 Skill 已处理了几篇论文、还剩几篇
  - 单篇论文的页级转换进度
- 长时间无反馈，用户体验差，无法判断是卡住还是正常运行

---

## 2. 整体架构（已实现）

```
┌─────────────────────────────────────────────────────────────────┐
│  Skill 脚本 (Python)                                            │
│                                                                 │
│  pdf_to_markdown.py / download_papers.py / summary / analyze    │
│    ├─ from lib.progress import ProgressReporter                 │
│    ├─ 写 progress.jsonl（追加模式，每行 JSON）                   │
│    │   {"type":"start","skill":"pdf_to_markdown","total":10}    │
│    │   {"type":"item","index":1,"label":"2603.xxx","pct":0}     │
│    │   {"type":"log","message":"页 5/42 转换完成"}               │
│    │   {"type":"done","succeeded":10,"failed":0}                │
│    └─ 最终 stdout 输出 JSON 结果（不变，向后兼容）               │
└──────────────────────────┬──────────────────────────────────────┘
                           │  文件系统（轮询读取）
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Gateway (src/gateway/mas4s-integration.ts)                     │
│                                                                 │
│  onAgentEvent 监听 stream:tool 事件                              │
│    ├─ 从 exec 命令中提取 skill 名称（正则匹配 .py 脚本名）      │
│    ├─ _toolCallSkillMap 跟踪 toolCallId → skillName             │
│    │                                                            │
│    ├─ SOPTracker (aiemas/src/sop-tracker/sop-tracker.ts)        │
│    │   ├─ 加载 workspace SOP.json 定义                          │
│    │   ├─ 匹配 skill → SOP step                                │
│    │   ├─ 维护 per-session SOPState                             │
│    │   └─ 回调 → broadcastToAll("sop.state", payload)          │
│    │         → transcriptStore.recordProgressEvent(...)         │
│    │                                                            │
│    └─ ProgressWatcher (aiemas/src/sop-tracker/progress-watcher) │
│        ├─ skill start → startWatch(progress.jsonl)              │
│        ├─ 每 2s 轮询新增行，解析 JSON                           │
│        ├─ 回调 → broadcastToAll("skill.progress", payload)     │
│        │       → transcriptStore.recordProgressEvent(...)      │
│        └─ skill result → stopWatch()                           │
└──────────────────────────┬──────────────────────────────────────┘
                           │  WebSocket event
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  前端 (Lit, mas4s UI)                                           │
│                                                                 │
│  event-handler.ts                                               │
│    ├─ case "sop.state"     → store.updateSOPState()             │
│    └─ case "skill.progress" → store.updateSkillProgress()       │
│                                                                 │
│  app-store.ts                                                   │
│    ├─ sopStepsBySession: Map<uuid, {steps, sopLabel}>           │
│    ├─ activeProgressBySession: Map<uuid, SkillProgressView>     │
│    └─ progressLogsBySession: Map<uuid, ProgressLogEntry[]>      │
│                                                                 │
│  数据流: app-shell → main-workspace → chat-view → message-list  │
│                                                                 │
│  sop-pipeline 组件（消息列表顶部）                               │
│    ├─ SOP 流程图（步骤状态 + 耗时）                              │
│    ├─ 进度条（当前 skill 的 item 级进度）                        │
│    └─ 可折叠日志面板（最近 500 条）                              │
│                                                                 │
│  历史回放：从 role="progress" 消息提取最终 SOP 状态              │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. 进度协议

### 3.1 进度文件

Skill 脚本通过 `lib.progress.ProgressReporter` 写入 JSONL 文件：

```
~/.openclaw/agents/<agentId>/workspace/progress/<skill>.progress.jsonl
~/.openclaw/agents/<agentId>/workspace/progress/<run_id>_<skill>.progress.jsonl  (传入 run_id 时)
```

### 3.2 进度行类型

| type    | 含义           | 必填字段                             | 可选字段                            |
| ------- | -------------- | ------------------------------------ | ----------------------------------- |
| `start` | Skill 开始执行 | `skill`, `total`, `ts`               | `label`                             |
| `item`  | 单项进度更新   | `skill`, `index`, `ts`               | `label`, `pct`, `status`, `message` |
| `log`   | 自由文本日志   | `skill`, `message`, `ts`             | `level`（info/warn/error）          |
| `done`  | Skill 执行完成 | `skill`, `succeeded`, `failed`, `ts` | `elapsed_ms`, `message`             |

### 3.3 SOP 定义文件

`~/.openclaw/workspace-<agentId>/SOP.json`：

```json
{
  "name": "research_pipeline",
  "label": "学术论文研究流程",
  "steps": [
    { "skill": "search_arxiv", "label": "检索论文", "icon": "🔍" },
    { "skill": "download_papers", "label": "下载 PDF", "icon": "📥" },
    { "skill": "pdf_to_markdown", "label": "PDF 转 Markdown", "icon": "📄" },
    { "skill": "summary_paper", "label": "生成摘要", "icon": "📝" },
    { "skill": "analyze_paper", "label": "精读分析", "icon": "🔬" }
  ]
}
```

---

## 4. 后端实现

### 4.1 SOPTracker (`aiemas/src/sop-tracker/sop-tracker.ts`)

- 加载 `SOP.json`（按 agentId 缓存）
- 维护 `Map<sessionKey, SOPState>`
- `onToolEvent()` 接收 tool call 事件，匹配 skill → step，更新状态
- 状态变更时通过回调通知调用方（gateway 集成层）

### 4.2 ProgressWatcher (`aiemas/src/sop-tracker/progress-watcher.ts`)

- `startWatch()` 开始轮询指定 progress.jsonl 文件
- 每 2 秒读取文件新增字节，逐行解析 JSON
- 通过回调通知调用方
- `stopWatch()` 停止轮询并清理

### 4.3 Gateway 集成 (`src/gateway/mas4s-integration.ts`)

关键集成逻辑：

```typescript
// 1. 实例化
const sopTracker = new SOPTracker({
  onStateChange: (payload) => {
    broadcastToAll("sop.state", payload);
    transcriptStore.recordProgressEvent({ type: "sop:state", ... });
  },
});
const progressWatcher = new ProgressWatcher({
  onProgress: (payload) => {
    broadcastToAll("skill.progress", payload);
    transcriptStore.recordProgressEvent({ type: "skill:progress", ... });
  },
});

// 2. 监听 agent tool 事件
onAgentEvent((evt) => {
  // 从 exec 命令中提取 skill 名称: /path/to/pdf_to_markdown.py → "pdf_to_markdown"
  // _toolCallSkillMap 跟踪 toolCallId → skillName（跨 start/result 阶段）
  // 过滤非 skill 工具（exec, read, tool 等）
  sopTracker.onToolEvent({ skillName, phase, ... });
  // skill start → progressWatcher.startWatch()
  // skill result → progressWatcher.stopWatch()
});

// 3. broadcastToAll 直接遍历 activeClients 发送 WebSocket 帧
```

Skill 名称提取逻辑：

- tool name 为 `exec` 时，从 `args.command` 中正则提取 `/([a-z_]+)\.py`
- 使用 `_toolCallSkillMap` (Map<toolCallId, skillName>) 在 result 阶段回查 skill 名称
- 过滤掉 `exec`、`read`、`tool` 等非 skill 工具名

### 4.4 数据持久化

`SessionTranscriptStore.recordProgressEvent()` 将进度事件写入 `session_messages` 表：

- `role`: `"progress"`（数据库 CHECK 约束已扩展）
- `content`: `[sop:state] {...}` 或 `[skill:progress] {...}`
- 复用现有 buffer → flush → SQLite 事务管线

### 4.5 WebSocket 事件

| 事件             | 触发时机              | payload 关键字段                                       |
| ---------------- | --------------------- | ------------------------------------------------------ |
| `sop.state`      | SOP step 状态变更     | `sessionKey`, `sopName`, `steps[]`, `currentStepIndex` |
| `skill.progress` | progress.jsonl 新增行 | `sessionKey`, `skill`, `progress` (ProgressLine)       |

---

## 5. 前端实现

### 5.1 事件处理 (`gateway/event-handler.ts`)

```typescript
case "sop.state":
  store.updateSOPState(sessionUuid, data);
  break;
case "skill.progress":
  store.updateSkillProgress(sessionUuid, data);
  break;
```

### 5.2 状态管理 (`store/app-store.ts`)

```typescript
// per-session SOP 状态
sopStepsBySession: Map<uuid, { steps: SOPStepView[]; sopLabel: string }>;
activeProgressBySession: Map<uuid, SkillProgressView>;
progressLogsBySession: Map<uuid, ProgressLogEntry[]>;

// updateSOPState() — 更新 steps
// updateSkillProgress() — 处理 start/item/log/done，维护 activeProgress + logs
// clearSOPState() — 清理
```

### 5.3 组件 (`components/sop-pipeline.ts`)

Lit 自定义元素 `<sop-pipeline>`，接收属性：

- `steps: SOPStepView[]` — SOP 步骤状态
- `sopLabel: string` — SOP 标题
- `activeProgress: SkillProgressView | null` — 当前 skill 进度
- `logs: ProgressLogEntry[]` — 进度日志

渲染：

- 步骤列表（图标 + 标签 + 状态 + 耗时）
- 当前 running step 下方展示进度条（completed/total + 百分比）
- 可折叠日志面板（最近 100 条，倒序，等宽字体，深色背景）

### 5.4 数据传递链路

```
app-shell.ts (从 store 读取 SOP 状态)
  → main-workspace.ts (.sopSteps, .sopLabel, .activeProgress, .progressLogs)
    → chat-view.ts (透传)
      → message-list.ts (透传 + 历史回放降级)
        → <sop-pipeline> (渲染)
```

### 5.5 历史回放

`message-list._extractSOPFromHistory()` 从 `role="progress"` 消息中提取最后一条 `sop_state` content item，还原 SOP 最终状态。

### 5.6 消息解析 (`lib/message-normalizer.ts`)

新增行前缀解析：

- `[sop:state] {...}` → `{ type: "sop_state", args: data }`
- `[skill:progress] {...}` → `{ type: "skill_progress", args: data }`

---

## 6. Skill 脚本改造

### 6.1 Python 进度工具库

`tools/lib/progress.py` 提供 `ProgressReporter` 类：

```python
from lib.progress import ProgressReporter

reporter = ProgressReporter("pdf_to_markdown", run_id="optional-uuid")
reporter.start(total=10, label="PDF 转 Markdown (10 篇)")
reporter.update(index=1, pct=0, label="2603.xxx", status="running")
reporter.log("开始转换 2603.xxx (共 42 页)")
reporter.update(index=1, pct=100, label="2603.xxx", status="completed")
reporter.done(succeeded=10, failed=0, elapsed_ms=3600000)
```

内部实现：追加写入 `progress.jsonl`，每次 `flush()`。

### 6.2 已改造的脚本

| 脚本               | 进度粒度                                 | 状态 |
| ------------------ | ---------------------------------------- | ---- |
| search_arxiv.py    | 无（< 10s，无需进度）                    | 不改 |
| download_papers.py | 每篇下载状态（start/skip/complete/fail） | ✅   |
| pdf_to_markdown.py | 每篇转换状态 + 页级日志（最细粒度）      | ✅   |
| summary_paper.py   | 每篇摘要生成状态                         | ✅   |
| analyze_paper.py   | 每篇精读分析状态                         | ✅   |

所有脚本：

- 通过 `try/except ImportError` 保护 `ProgressReporter` 导入，缺失时静默降级
- 接受可选 `run_id` 参数，用于隔离不同次执行的进度文件
- 原有 stdout JSON 输出不变，向后兼容

### 6.3 Skill 参数约束

所有 SKILL.md 已更新：

- `title` 标记为**必需**（文件名依赖 `{id}_{title}.pdf/.md`）
- 新增 `run_id` 可选参数
- SOUL.md 新增"关键约束：title 必须全程传递"章节

---

## 7. 涉及文件

| 文件                                                     | 变更类型 | 说明                                                                   |
| -------------------------------------------------------- | -------- | ---------------------------------------------------------------------- |
| `aiemas/src/sop-tracker/types.ts`                        | 新增     | SOPState、ProgressLine、WebSocket payload 类型                         |
| `aiemas/src/sop-tracker/sop-tracker.ts`                  | 新增     | SOP 状态追踪器                                                         |
| `aiemas/src/sop-tracker/progress-watcher.ts`             | 新增     | 进度文件轮询监听器                                                     |
| `aiemas/src/sop-tracker/index.ts`                        | 新增     | 模块导出                                                               |
| `aiemas/src/index.ts`                                    | 修改     | 导出 SOPTracker、ProgressWatcher                                       |
| `aiemas/src/store/database.ts`                           | 修改     | session_messages.role CHECK 新增 `'progress'`                          |
| `aiemas/src/session-history/session-transcript-store.ts` | 修改     | StoredMessage.role 新增 `'progress'`；新增 `recordProgressEvent()`     |
| `src/gateway/mas4s-integration.ts`                       | 修改     | 实例化 SOPTracker + ProgressWatcher；onAgentEvent 集成；broadcastToAll |
| `aiemas/ui/mas4s/src/lib/chat-types.ts`                  | 修改     | MessageContentItem.type 新增 `sop_state` / `skill_progress`            |
| `aiemas/ui/mas4s/src/lib/message-normalizer.ts`          | 修改     | 新增 `[sop:state]` / `[skill:progress]` 行前缀解析                     |
| `aiemas/ui/mas4s/src/components/sop-pipeline.ts`         | 新增     | SOP 流程图 + 进度条 + 日志面板组件                                     |
| `aiemas/ui/mas4s/src/store/app-store.ts`                 | 修改     | SOP 状态管理（sopSteps/activeProgress/progressLogs per session）       |
| `aiemas/ui/mas4s/src/gateway/event-handler.ts`           | 修改     | 新增 `sop.state` / `skill.progress` 事件处理                           |
| `aiemas/ui/mas4s/src/views/app-shell.ts`                 | 修改     | 传递 SOP 状态到 main-workspace                                         |
| `aiemas/ui/mas4s/src/components/main-workspace.ts`       | 修改     | 接收并传递 SOP 属性到 chat-view                                        |
| `aiemas/ui/mas4s/src/views/chat-view.ts`                 | 修改     | 接收并传递 SOP 属性到 message-list                                     |
| `aiemas/ui/mas4s/src/views/message-list.ts`              | 修改     | 渲染 sop-pipeline；历史回放提取 SOP 状态                               |

| `tools/lib/progress.py` | 新增 | Python ProgressReporter 工具库 |
| `tools/download_papers.py` | 修改 | 集成 ProgressReporter |
| `tools/pdf_to_markdown.py` | 修改 | 集成 ProgressReporter（论文级 + 页级日志） |
| `tools/summary_paper.py` | 修改 | 集成 ProgressReporter |
| `tools/analyze_paper.py` | 修改 | 集成 ProgressReporter |
| `workspace-researcher/SOP.json` | 新增 | SOP 步骤定义 |
| `workspace-researcher/SOUL.md` | 修改 | 新增 title 必传约束 + run_id 说明 |
| `workspace-researcher/skills/*/SKILL.md` | 修改 | title 改为必需；新增 run_id 可选参数 |

---

## 8. 数据流时序

```
T+0s     用户发送 "分析 multi-agent 最新 5 篇"
         └─ chat.send → agent run 开始

T+2s     Agent exec search_arxiv.py
         └─ onAgentEvent: stream=tool, name=exec, phase=start
         └─ 正则提取 skillName=search_arxiv
         └─ SOPTracker.onToolEvent → step[0]=running
         └─ broadcastToAll("sop.state", ...) → 前端更新
         └─ ProgressWatcher.startWatch(search_arxiv.progress.jsonl)

T+5s     search_arxiv 完成
         └─ onAgentEvent: stream=tool, phase=result
         └─ _toolCallSkillMap 回查 skillName=search_arxiv
         └─ SOPTracker.onToolEvent → step[0]=completed (3s)
         └─ broadcastToAll("sop.state", ...) → 前端更新
         └─ ProgressWatcher.stopWatch()

T+6s     Agent exec download_papers.py
         └─ SOPTracker → step[1]=running
         └─ ProgressWatcher 开始监听 download_papers.progress.jsonl

T+8s     download_papers 写入进度行
         └─ ProgressWatcher 轮询读取 → broadcastToAll("skill.progress", ...)
         └─ 前端 store.updateSkillProgress() → sop-pipeline 更新

T+50s    download_papers 完成
         └─ SOPTracker → step[1]=completed (44s)

T+51s    Agent exec pdf_to_markdown.py
         └─ SOPTracker → step[2]=running
         └─ ProgressWatcher 开始监听 pdf_to_markdown.progress.jsonl

T+53s    pdf_to_markdown 写入 {"type":"start","total":10}
         └─ skill.progress 推送 → 前端显示进度条 0/10

T+120s   pdf_to_markdown 写入页级日志
         └─ skill.progress 推送 → 前端日志面板更新

         ... (每 2 秒轮询，推送新增行)

T+3600s  pdf_to_markdown 写入 {"type":"done","succeeded":10}
         └─ SOPTracker → step[2]=completed
         └─ ProgressWatcher 停止

T+3601s  Agent exec summary_paper.py → step[3]=running ...
```

## 9. SOP.json 加载与执行流程分析

本文档分析了 `workspace-researcher/SOP.json` 在 AieClaw 架构中的加载和处理流程，并评估了其对其他 Agent 定义的扩展性。

### 9.1. 加载工作流

加载过程是一个涉及 Gateway、SOP Tracker 和 Agent 工作区的多阶段流程。

#### A. 触发阶段

当 Agent（例如 Researcher）发起工具调用时，会通过 `onAgentEvent` 总线发出事件。`src/gateway/mas4s-integration.ts` 模块会拦截这些事件。

#### B. 路径解析

Gateway 动态解析 SOP 定义的路径：

1. **提取 Agent ID**：解析 `sessionKey`（例如 `agent:researcher:123` → `agentId = "researcher"`）。
2. **构造工作区路径**：构建路径：`~/.openclaw/workspace-${agentId}/SOP.json`。
   - 对于 Researcher，这映射到 `~/.openclaw/workspace-researcher/SOP.json`。

#### C. Tracker 加载

`SOPTracker`（位于 `aiemas/src/sop-tracker/sop-tracker.ts`）处理文件操作：

- **`loadSOP(workspaceDir, agentId)`**：
  - 检查文件是否存在。
  - 读取并解析 JSON 为 `SOPDefinition` 对象。
  - **缓存机制**：定义被缓存在 `Map<agentId, SOPDefinition>` 中，以确保同一 Agent 的后续工具调用不需要重复访问磁盘。

#### D. 技能匹配

随着工具调用的进行，Tracker 将其与 SOP 步骤进行匹配：

- **启发式匹配**：在 `mas4s-integration.ts` 中，如果工具是 `exec`，它会尝试从命令字符串中提取“技能名称”（例如从 `/path/to/search_arxiv.py` 中提取 `search_arxiv`）。
- **步骤查找**：`SOPTracker` 找到 `toolName === s.skill` 或 `toolName.includes(s.skill)` 的步骤索引。

### 9.2. 扩展性分析

当前实现具有**良好的扩展性设计**，支持以极低的配置成本支持其他 Agent。

#### 如何支持新 Agent

要为新 Agent（例如 `coder`）添加 SOP 支持：

1. 创建目录：`~/.openclaw/workspace-coder/`。
2. 在该目录下创建一个符合结构的 `SOP.json`。
3. 确保 Agent 的工具名称或脚本文件名与 JSON 中的 `skill` 键匹配。

#### 扩展性检查清单

| 特性           | 状态        | 扩展要求                                                                        |
| :------------- | :---------- | :------------------------------------------------------------------------------ |
| **工作区隔离** | ✅ 支持     | Agent ID 必须匹配目录后缀（例如 `workspace-X`）。                               |
| **步骤定义**   | ✅ 支持     | 遵循 `SOPDefinition` 架构（名称、标签、步骤）。                                 |
| **UI 渲染**    | ✅ 支持     | 前端 `sop-pipeline` 是通用的，直接渲染后端发送的数据。                          |
| **进度轮询**   | ✅ 支持     | 如果需要项级进度，其他 Agent 必须写入 `progress.jsonl` 文件。                   |
| **工具提取**   | ⚠️ 部分支持 | 当前针对 `exec` 的正则针对 Python (`.py`)。非 Python 脚本可能需要完善提取逻辑。 |

#### 总结建议

目前的实现对于现有用例非常稳健。为了进一步增强扩展性，我们可以：

- 将 `workspace` 基础路径和 `.py` 正则表达式移至可配置的插件配置项中。
- 允许 Agent 在其注册清单中显式声明其 SOP 路径。

---

_相关文件：_

- [sop-tracker.ts](file:///Users/admin/Desktop/code/AieClaw/aiemas/src/sop-tracker/sop-tracker.ts)
- [mas4s-integration.ts](file:///Users/admin/Desktop/code/AieClaw/src/gateway/mas4s-integration.ts)
- [types.ts](file:///Users/admin/Desktop/code/AieClaw/aiemas/src/sop-tracker/types.ts)
