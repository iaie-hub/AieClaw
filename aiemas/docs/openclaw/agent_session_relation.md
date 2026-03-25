# OpenClaw: Agent 与 Session 关系分析报告

本记录详细分析了 OpenClaw 中 Agent（智能体）与 Session（会话）的层级关系、物理存储结构以及多智能体协作机制。

## 1. Agent 与 Session 的包含关系

在 OpenClaw 中，Session 是归属于特定的 Agent 的。

### 1.1 目录结构

所有 Agent 的数据均存放在 `~/.openclaw/agents/` 下。每个 Agent 拥有自己独立的会话子目录：

- `~/.openclaw/agents/<agentId>/sessions/`

该目录下包含两个核心组成部分：

1.  **`sessions.json`**：该 Agent 的会话索引文件（Metadata Registry），记录了所有关联会话的状态、配置和统计信息。
2.  **`*.jsonl` 文件**：实际的对话转录文件（Transcripts），采用 JSON Lines 格式。

### 1.2 物理隔离

这种结构确保了多租户和多 Agent 环境下的安全性。一个 Agent 默认只能读写其自身目录下的会话，实现了上下文的物理隔离。

---

## 2. 会话文件的生命周期与归档机制

为了防止数据丢失并保持系统整洁，OpenClaw 采用了一套归档机制，而不是直接物理删除会话记录。

### 2.1 会话文件后缀说明

当你观察到文件“变动”时，通常是以下逻辑触发了重命名：

- **`.deleted.<timestamp>`**：
  - **来源**：手动删除会话，或由后台 `session-reaper` 进程因超过保留期限（默认 24 小时）而自动清理。
- **`.reset.<timestamp>`**：
  - **来源**：执行了重置命令（如 `/new` 或 `/reset`）。原对话文件被归档，系统会启动全新的转录流程。

### 2.2 自动清理（Session Reaper）

后台有一个定时器（每 5 分钟扫描一次），负责根据 `sessions.json` 的更新时间清理过期的会话记录和对应的转录文件。

---

## 3. 多智能体协作（Subagent）机制

虽然物理上一个 Session 属于一个 Agent，但 OpenClaw 支持**逻辑上的多智能体协作**。

### 3.1 子会话派生（Spawn）

当一个 Agent（主 Agent）需要协作时，它会“派生”出一个子运行任务：

1.  系统会为目标 Agent（子 Agent）创建一个**全新的会话**。
2.  该会话文件存放在子 Agent 自己的目录下。

### 3.2 关联逻辑

- **父子关联**：子会话的元数据中包含 `spawnedBy` 或 `parentSessionKey` 字段，指向主 Agent 的会话。
- **状态同步**：系统通过 `subagent-registry` 跟踪所有跨 Agent 的调用。
- **结果回传**：子 Agent 完成任务后，其结果会作为一条特殊的消息同步回主会话。

### 3.3 总结

通过这种**“一 Session 一 Agent，多 Session 接力”**的分布式架构，OpenClaw 既保证了单个 Agent 运行环境的精简和安全，又实现了复杂的跨 Agent 任务编排。
