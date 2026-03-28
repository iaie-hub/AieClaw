# OpenClaw 字符限制配置

本文档记录 OpenClaw 系统中的各种字符限制和截断配置。

## Exec 命令输出限制

### DEFAULT_NOTIFY_TAIL_CHARS

**位置**：`src/agents/bash-tools.exec-runtime.ts`

**当前值**：`8000` 字符

**用途**：

- 限制 exec 命令完成通知中返回的输出长度
- 使用 `tail()` 函数从命令输出末尾截取指定字符数
- 应用于 gateway 和 node 两种执行模式

**影响范围**：

1. `bash-tools.exec-host-gateway.ts` - Gateway 模式的命令执行
2. `bash-tools.exec-host-node.ts` - Node 模式的命令执行
3. `bash-tools.exec-runtime.ts` - 命令完成通知

**历史变更**：

- 初始值：`400` 字符
- 2026-03-28：增加到 `2000` 字符
  - 原因：400 字符对于 `ls -la` 等常见命令输出不足
- 2026-03-28：增加到 `8000` 字符
  - 原因：2000 字符仍然偏小，无法完整显示较长的命令输出
  - 平衡：8000 字符可以覆盖大多数常见命令输出场景

**示例影响**：

```bash
# ls -la /private/tmp 输出约 1700 字符
# 400 字符限制：只显示最后 5-6 个文件
# 2000 字符限制：显示完整的 23 个文件列表
# 8000 字符限制：可以显示更大目录的完整列表（约 100+ 个文件）

# ps aux 输出可能达到 5000+ 字符
# docker ps -a 输出可能达到 3000+ 字符
# 8000 字符限制可以覆盖这些常见场景
```

### DEFAULT_NOTIFY_SNIPPET_CHARS

**位置**：`src/agents/bash-tools.exec-runtime.ts`

**当前值**：`180` 字符

**用途**：

- 用于生成命令输出的简短摘要片段
- 具体使用场景待确认

## 输出规范化

### normalizeNotifyOutput()

**位置**：`src/agents/bash-tools.exec-runtime.ts`

**功能**：

```typescript
export function normalizeNotifyOutput(value: string) {
  return value.replace(/\s+/g, " ").trim();
}
```

**作用**：

- 将所有连续空白字符（空格、换行、制表符）替换为单个空格
- 去除首尾空白
- 压缩输出以减少 token 消耗

**副作用**：

- 破坏原始格式（如表格对齐）
- 多行输出变为单行
- 可能影响某些命令输出的可读性

## Approval 超时限制

### DEFAULT_APPROVAL_TIMEOUT_MS

**位置**：`src/agents/bash-tools.exec-runtime.ts`

**当前值**：`120000` ms (120 秒 / 2 分钟)

**用途**：

- Exec approval 请求的默认超时时间
- 超时后根据 `askFallback` 策略决定是否执行

### DEFAULT_APPROVAL_REQUEST_TIMEOUT_MS

**位置**：`src/agents/bash-tools.exec-runtime.ts`

**当前值**：`130000` ms (130 秒 / 2 分 10 秒)

**用途**：

- Approval 请求的总超时时间（包括网络延迟等）
- 比 `DEFAULT_APPROVAL_TIMEOUT_MS` 多 10 秒缓冲

### DEFAULT_APPROVAL_RUNNING_NOTICE_MS

**位置**：`src/agents/bash-tools.exec-runtime.ts`

**当前值**：`10000` ms (10 秒)

**用途**：

- 命令开始执行后，多久发送"正在运行"通知
- 用于长时间运行的命令

## 进程输出限制

### tail() 函数默认值

**位置**：`src/agents/bash-process-registry.ts`

**默认值**：`2000` 字符（注：`DEFAULT_NOTIFY_TAIL_CHARS` 使用 8000）

**功能**：

```typescript
export function tail(text: string, max = 2000) {
  if (text.length <= max) {
    return text;
  }
  return text.slice(text.length - max);
}
```

**用途**：

- 从字符串末尾截取指定长度
- 用于各种输出截断场景

## 附件大小限制

### parseMessageWithAttachments maxBytes

**位置**：`src/gateway/server-methods/agent.ts`

**当前值**：`5000000` 字节 (5 MB)

**用途**：

- 限制通过 agent 方法上传的附件总大小
- 包括图片、文档等所有附件类型

## 建议

### 何时调整限制

**增加限制的场景**：

1. 用户经常执行输出较长的命令（如 `ls -la`、`ps aux`、`docker ps`）
2. 需要完整的命令输出用于调试
3. Token 消耗不是主要关注点

**减少限制的场景**：

1. 需要优化 token 消耗
2. 命令输出通常很长但只需要末尾部分
3. 网络带宽受限

### 最佳实践

1. **监控实际使用**：
   - 记录被截断的命令输出长度
   - 分析用户最常用的命令类型
   - 根据实际需求调整限制

2. **分层限制**：
   - 考虑为不同类型的命令设置不同限制
   - 例如：`ls` 命令可以有更大的限制，而 `cat` 命令可以有更小的限制

3. **用户可配置**：
   - 未来可以考虑将这些限制作为配置项
   - 允许用户根据自己的需求调整

## 相关文件

- `src/agents/bash-tools.exec-runtime.ts` - 主要限制定义
- `src/agents/bash-tools.exec-host-gateway.ts` - Gateway 执行逻辑
- `src/agents/bash-tools.exec-host-node.ts` - Node 执行逻辑
- `src/agents/bash-process-registry.ts` - 进程管理和输出处理
- `src/gateway/server-methods/agent.ts` - Agent 方法处理

## 更新日志

| 日期       | 变更                                     | 原因                                      |
| ---------- | ---------------------------------------- | ----------------------------------------- |
| 2026-03-28 | `DEFAULT_NOTIFY_TAIL_CHARS`: 400 → 2000  | `ls -la` 等命令输出被过度截断             |
| 2026-03-28 | `DEFAULT_NOTIFY_TAIL_CHARS`: 2000 → 8000 | 2000 仍然偏小，增加到 8000 以覆盖更多场景 |
