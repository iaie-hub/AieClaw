# Agent SOP 可视化与 Skill 进度观测方案

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

## 2. 设计目标

| 目标           | 说明                                                               |
| -------------- | ------------------------------------------------------------------ |
| SOP 全局可视化 | 前端展示 SOP 流程图，标记已完成 / 进行中 / 待执行的 Step           |
| Skill 粒度进度 | 每个 Skill 可上报结构化进度（已完成数 / 总数、百分比、当前处理项） |
| 进度日志流     | Skill 脚本可写入进度日志行，前端定时拉取或推送展示                 |
| 非侵入式       | 不改变 OpenClaw 核心的 tool call 协议，通过旁路事件通道实现        |
| 向后兼容       | 不上报进度的 Skill 仍正常工作，前端降级为仅显示 tool call 状态     |

---

## 3. 整体架构

```
┌─────────────────────────────────────────────────────────────────┐
│  Skill 脚本 (Python)                                            │
│                                                                 │
│  pdf_to_markdown.py                                             │
│    ├─ 写 progress.jsonl（追加模式）                              │
│    │   {"type":"start","total":5,"ts":...}                      │
│    │   {"type":"item","index":1,"label":"2406.xxxxx","pct":32}  │
│    │   {"type":"item","index":1,"label":"2406.xxxxx","pct":100} │
│    │   {"type":"item","index":2,"label":"2407.xxxxx","pct":15}  │
│    │   ...                                                      │
│    │   {"type":"done","succeeded":5,"failed":0,"ts":...}        │
│    └─ 最终 stdout 输出 JSON 结果（不变）                         │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           │  文件系统
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  Progress Watcher (Node.js, aiemas 侧)                         │
│                                                                 │
│  监听 progress.jsonl 文件变更（fs.watch / tail -f 语义）         │
│  解析新增行 → 生成 skill.progress 事件                          │
│  通过 WebSocket broadcast 推送给订阅该 session 的前端客户端      │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           │  WebSocket event
                           ▼
┌─────────────────────────────────────────────────────────────────┐
│  前端 (Vue 3, mas4s UI)                                         │
│                                                                 │
│  ┌─────────────────────────────────────┐                        │
│  │  SOP Pipeline 组件                   │                        │
│  │                                     │                        │
│  │  ① search_arxiv      ✅ 完成 (3s)   │                        │
│  │  ② download_papers    ✅ 完成 (45s)  │                        │
│  │  ③ pdf_to_markdown    🔄 进行中      │                        │
│  │     ├─ 论文 3/5                      │                        │
│  │     ├─ 当前: 2407.xxxxx (页 18/42)   │                        │
│  │     └─ ████████░░░░ 62%             │                        │
│  │  ④ summary_paper      ⏳ 待执行      │                        │
│  │  ⑤ analyze_paper      ⏳ 待执行      │                        │
│  └─────────────────────────────────────┘                        │
│                                                                 │
│  ┌─────────────────────────────────────┐                        │
│  │  进度日志面板（可折叠）              │                        │
│  │                                     │                        │
│  │  15:34:09  开始转换 2406.xxxxx      │                        │
│  │  15:34:12  页 1-10 转换完成          │                        │
│  │  15:35:01  页 11-20 转换完成         │                        │
│  │  15:36:22  2406.xxxxx 转换完成       │                        │
│  │  15:36:23  开始转换 2407.xxxxx      │                        │
│  │  ...                                │                        │
│  └─────────────────────────────────────┘                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. 进度协议设计

### 4.1 进度文件约定

每个 Skill 执行时，可选地在工作目录下写入 `progress.jsonl` 文件（追加模式，每行一个 JSON 对象）。

文件路径约定：

```
~/.openclaw/agents/<agentId>/workspace/papers/<runId>/progress.jsonl
```

其中 `<runId>` 由 Skill 脚本的调用参数传入，与本次 SOP 执行关联。

### 4.2 进度行类型

| type    | 含义           | 必填字段                             | 可选字段                            |
| ------- | -------------- | ------------------------------------ | ----------------------------------- |
| `start` | Skill 开始执行 | `skill`, `total`, `ts`               | `label`                             |
| `item`  | 单项进度更新   | `skill`, `index`, `ts`               | `label`, `pct`, `status`, `message` |
| `log`   | 自由文本日志   | `skill`, `message`, `ts`             | `level`（info/warn/error）          |
| `done`  | Skill 执行完成 | `skill`, `succeeded`, `failed`, `ts` | `elapsed_ms`, `message`             |

示例：

```jsonl
{"type":"start","skill":"pdf_to_markdown","total":5,"ts":1774529145000}
{"type":"item","skill":"pdf_to_markdown","index":1,"label":"2406.12345","pct":0,"status":"running","ts":1774529145100}
{"type":"log","skill":"pdf_to_markdown","message":"开始转换 2406.12345 (共 42 页)","ts":1774529145200}
{"type":"item","skill":"pdf_to_markdown","index":1,"label":"2406.12345","pct":50,"message":"页 1-21 完成","ts":1774529175000}
{"type":"item","skill":"pdf_to_markdown","index":1,"label":"2406.12345","pct":100,"status":"completed","ts":1774529205000}
{"type":"item","skill":"pdf_to_markdown","index":2,"label":"2407.67890","pct":0,"status":"running","ts":1774529205100}
{"type":"done","skill":"pdf_to_markdown","succeeded":5,"failed":0,"elapsed_ms":3600000,"ts":1774532745000}
```

### 4.3 SOP 定义文件

在 workspace 中新增 `SOP.json`，声明 SOP 的步骤序列，供前端渲染流程图：

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

路径：`~/.openclaw/workspace-<agentId>/SOP.json`

---

## 5. 后端实现方案

### 5.1 SOP 状态追踪器（SOPTracker）

新增模块 `aiemas/src/sop-tracker/`，职责：

- 监听 agent 的 tool call 事件（已有的 `stream:tool` 事件流）
- 根据 tool call 的 `name` 字段匹配 SOP.json 中的 step
- 维护每个 session 的 SOP 执行状态（Map<sessionKey, SOPState>）
- 当 tool call `phase: "start"` 时标记 step 为 `running`
- 当 tool call `phase: "result"` 时标记 step 为 `completed` 或 `failed`

```
SOPState {
  sopName: string
  steps: Array<{
    skill: string
    label: string
    status: "pending" | "running" | "completed" | "failed" | "skipped"
    startedAt?: number
    completedAt?: number
    elapsed?: number
  }>
  currentStepIndex: number
  startedAt: number
}
```

### 5.2 Progress Watcher（进度文件监听器）

新增模块 `aiemas/src/sop-tracker/progress-watcher.ts`，职责：

- 当 SOPTracker 检测到某个 Skill 进入 `running` 状态时，开始监听对应的 `progress.jsonl`
- 使用 `fs.watch` + 轮询读取新增行（处理 macOS 的 FSEvents 合并问题）
- 解析每行 JSON，生成 `skill.progress` 事件
- Skill 完成后停止监听，清理资源

轮询间隔：默认 2 秒（可配置），平衡实时性与 I/O 开销。

### 5.3 WebSocket 事件推送

新增两个 WebSocket 推送事件：

#### `sop.state` — SOP 全局状态变更

当任意 step 状态变化时推送：

```json
{
  "type": "event",
  "method": "sop.state",
  "params": {
    "sessionKey": "agent:researcher:group:mas-xxx",
    "sopName": "research_pipeline",
    "steps": [
      { "skill": "search_arxiv", "status": "completed", "elapsed": 3200 },
      { "skill": "download_papers", "status": "completed", "elapsed": 45000 },
      { "skill": "pdf_to_markdown", "status": "running", "startedAt": 1774529145000 },
      { "skill": "summary_paper", "status": "pending" },
      { "skill": "analyze_paper", "status": "pending" }
    ],
    "currentStepIndex": 2,
    "ts": 1774529145000
  }
}
```

#### `skill.progress` — Skill 粒度进度更新

从 progress.jsonl 解析出的进度行，逐条或批量推送：

```json
{
  "type": "event",
  "method": "skill.progress",
  "params": {
    "sessionKey": "agent:researcher:group:mas-xxx",
    "skill": "pdf_to_markdown",
    "progress": {
      "type": "item",
      "index": 2,
      "total": 5,
      "label": "2407.67890",
      "pct": 62,
      "message": "页 18/42 完成"
    },
    "ts": 1774529300000
  }
}
```

### 5.4 数据持久化

进度事件写入 `session_messages` 表，复用现有持久化管线：

- `role`: 新增 `"progress"` 值
- `content`: 序列化的进度 JSON，前缀 `[sop:state]` 或 `[skill:progress]`
- 历史回放时可还原 SOP 执行时间线

示例：

```
[sop:state] {"sopName":"research_pipeline","steps":[...],"currentStepIndex":2}
[skill:progress] {"skill":"pdf_to_markdown","type":"item","index":2,"total":5,"pct":62}
```

---

## 6. 前端实现方案

### 6.1 新增组件

| 组件                 | 职责                                       |
| -------------------- | ------------------------------------------ |
| `sop-pipeline`       | SOP 流程图，横向或纵向展示各 Step 状态     |
| `skill-progress-bar` | 单个 Skill 的进度条 + 当前处理项信息       |
| `skill-progress-log` | 可折叠的进度日志面板，按时间倒序展示日志行 |

### 6.2 状态管理

在 `message-list` 或独立的 `sop-store` 中维护：

```typescript
interface SOPViewState {
  sopName: string;
  steps: SOPStepView[];
  currentStepIndex: number;
  // 当前 running step 的细粒度进度
  activeProgress: {
    skill: string;
    total: number;
    completed: number;
    currentItem?: { index: number; label: string; pct: number };
  } | null;
  // 进度日志（最近 N 条）
  logs: Array<{ ts: number; message: string; level: string }>;
}
```

### 6.3 渲染策略

- 实时模式：监听 `sop.state` 和 `skill.progress` WebSocket 事件，实时更新 UI
- 历史回放模式：从 `session_messages` 中读取 `role="progress"` 的记录，按时间线还原 SOP 状态（静态展示最终状态，不播放动画）

### 6.4 展示位置

SOP Pipeline 组件嵌入消息流中，有两种方案：

**方案 A：独立面板（推荐）**

- 在消息列表右侧或顶部固定一个 SOP 状态面板
- 不随消息滚动，始终可见
- 点击某个 Step 可展开查看进度详情和日志

**方案 B：内联消息卡片**

- 作为特殊消息卡片插入消息流
- 随 SOP 状态变化自动更新
- 与现有的 tool call 卡片、approval 卡片风格一致

---

## 7. Skill 脚本改造

### 7.1 改造范围

仅需改造耗时较长的 Skill 脚本，添加 progress.jsonl 写入逻辑：

| Skill           | 是否需要改造 | 说明                            |
| --------------- | ------------ | ------------------------------- |
| search_arxiv    | 否           | 通常 < 10s，无需进度            |
| download_papers | 可选         | 并发下载，可上报每篇下载状态    |
| pdf_to_markdown | 是（优先）   | 最耗时，需上报论文级 + 页级进度 |
| summary_paper   | 可选         | 可上报每篇摘要生成状态          |
| analyze_paper   | 可选         | 可上报每篇分析状态              |

### 7.2 Python 侧进度写入工具

提供一个轻量 Python 工具函数，Skill 脚本引入即可使用：

```
tools/lib/progress.py

  class ProgressReporter:
      def __init__(self, skill_name: str, run_id: str)
      def start(self, total: int, label: str = "")
      def update(self, index: int, pct: int, label: str = "", message: str = "")
      def log(self, message: str, level: str = "info")
      def done(self, succeeded: int, failed: int, message: str = "")
```

内部实现：以追加模式写入 `progress.jsonl`，每次写入后 `flush()`，确保 watcher 能及时读取。

### 7.3 调用参数扩展

Skill 脚本的调用参数中新增 `run_id` 字段，由 agent 在 SOP 开始时生成（UUID），贯穿整个 SOP 流程，用于关联进度文件路径。

---

## 8. 数据流时序

```
T+0s     用户发送 "分析 multi-agent 最新 5 篇"
         └─ chat.send → agent run 开始

T+1s     Agent read skills/search_arxiv/SKILL.md
         └─ sop.state: step[0] = running

T+2s     Agent exec search_arxiv.py
         └─ tool call start → SOPTracker 更新
         └─ sop.state 推送: search_arxiv = running

T+5s     search_arxiv 完成，返回 10 篇论文
         └─ tool call result → SOPTracker 更新
         └─ sop.state 推送: search_arxiv = completed (3s)

T+6s     Agent exec download_papers.py
         └─ sop.state 推送: download_papers = running
         └─ Progress Watcher 开始监听 progress.jsonl

T+8s     download_papers 写入进度
         └─ skill.progress 推送: 2/10 下载完成

T+50s    download_papers 完成
         └─ sop.state 推送: download_papers = completed (44s)

T+51s    Agent exec pdf_to_markdown.py
         └─ sop.state 推送: pdf_to_markdown = running
         └─ Progress Watcher 开始监听

T+53s    pdf_to_markdown 写入 start
         └─ skill.progress 推送: total=10

T+120s   pdf_to_markdown 写入 item 进度
         └─ skill.progress 推送: 论文 1/10, 页 20/42

         ... (每 2 秒轮询一次 progress.jsonl，推送新增行)

T+3600s  pdf_to_markdown 完成
         └─ sop.state 推送: pdf_to_markdown = completed

T+3601s  Agent exec summary_paper.py
         └─ sop.state 推送: summary_paper = running
         ...
```

---

## 9. 与现有系统的集成点

| 集成点         | 现有机制                             | 新增行为                                                           |
| -------------- | ------------------------------------ | ------------------------------------------------------------------ |
| tool call 事件 | `filterBroadcast` 捕获 `stream:tool` | SOPTracker 订阅同一事件流，提取 skill 名称匹配 SOP step            |
| WebSocket 推送 | `context.broadcast()`                | 新增 `sop.state` 和 `skill.progress` 事件类型                      |
| 消息持久化     | `SessionTranscriptStore`             | 新增 `role="progress"` 消息类型，复用 buffer → flush → SQLite 管线 |
| 前端消息解析   | `normalizeMessage`                   | 新增 `[sop:state]` 和 `[skill:progress]` 行前缀解析                |
| 历史回放       | `session.history.range`              | 返回 progress 消息，前端还原 SOP 最终状态                          |

---

## 10. 配置项

```json
{
  "agents": {
    "defaults": {
      "sopTracker": {
        "enabled": true,
        "progressPollIntervalMs": 2000,
        "maxLogLines": 500,
        "persistProgress": true
      }
    }
  }
}
```

| 配置项                   | 默认值 | 说明                                    |
| ------------------------ | ------ | --------------------------------------- |
| `enabled`                | `true` | 是否启用 SOP 追踪                       |
| `progressPollIntervalMs` | `2000` | 进度文件轮询间隔（ms）                  |
| `maxLogLines`            | `500`  | 前端保留的最大日志行数                  |
| `persistProgress`        | `true` | 是否将进度事件持久化到 session_messages |

---

## 11. 涉及文件（预估）

| 文件                                                     | 变更类型 | 说明                                          |
| -------------------------------------------------------- | -------- | --------------------------------------------- |
| `aiemas/src/sop-tracker/sop-tracker.ts`                  | 新增     | SOP 状态追踪器，监听 tool call 事件           |
| `aiemas/src/sop-tracker/progress-watcher.ts`             | 新增     | 进度文件监听器，tail progress.jsonl           |
| `aiemas/src/sop-tracker/types.ts`                        | 新增     | SOPState、ProgressLine 等类型定义             |
| `aiemas/src/store/database.ts`                           | 修改     | session_messages.role CHECK 新增 `'progress'` |
| `aiemas/src/session-history/session-transcript-store.ts` | 修改     | 新增 `recordProgressEvent()` 方法             |
| `src/gateway/mas4s-integration.ts`                       | 修改     | 注册 SOPTracker，转发进度事件                 |
| `aiemas/ui/mas4s/src/components/sop-pipeline.ts`         | 新增     | SOP 流程图组件                                |
| `aiemas/ui/mas4s/src/components/skill-progress-bar.ts`   | 新增     | Skill 进度条组件                              |
| `aiemas/ui/mas4s/src/components/skill-progress-log.ts`   | 新增     | 进度日志面板组件                              |
| `aiemas/ui/mas4s/src/lib/chat-types.ts`                  | 修改     | MessageContentItem 新增 progress 类型         |
| `aiemas/ui/mas4s/src/lib/message-normalizer.ts`          | 修改     | 新增 `[sop:state]` / `[skill:progress]` 解析  |
| `tools/lib/progress.py`                                  | 新增     | Python 进度上报工具库                         |
| `tools/pdf_to_markdown.py`                               | 修改     | 集成 ProgressReporter                         |
| `~/.openclaw/workspace-researcher/SOP.json`              | 新增     | SOP 步骤定义                                  |

---

## 12. 分阶段实施建议

### Phase 1：SOP 状态可视化（最小可用）

- 实现 SOPTracker，基于 tool call 事件自动推断 step 状态
- 新增 `sop.state` WebSocket 事件
- 前端实现 `sop-pipeline` 组件，展示 step 状态和耗时
- 不需要改造 Skill 脚本

### Phase 2：Skill 进度上报

- 实现 Progress Watcher
- 提供 Python `ProgressReporter` 工具库
- 改造 `pdf_to_markdown.py`（最耗时，优先）
- 新增 `skill.progress` WebSocket 事件
- 前端实现 `skill-progress-bar` 组件

### Phase 3：进度日志 + 持久化

- Skill 脚本写入 `log` 类型进度行
- 前端实现 `skill-progress-log` 面板
- 进度事件持久化到 session_messages
- 历史回放支持 SOP 状态还原
