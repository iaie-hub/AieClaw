# 图片聊天历史：完整链路分析

> 分析图片从用户输入到实时渲染、消息持久化、历史查询返回的完整数据流，定位图片在历史消息中丢失的根因。

## 1. 图片输入与实时渲染链路（✅ 正常工作）

```
用户粘贴/拖拽/选择图片
      │
      ▼
chat-input.ts → ChatInput._onPaste / _onDrop / _onFileSelect
      │  过滤 file.type.startsWith("image/")
      ▼
chat-input.ts → ChatInput._addFile(file)
      │  FileReader.readAsDataURL(file) → dataUrl (base64)
      │  _attachments.push({ id, type: mimeType, name, dataUrl, file })
      ▼
chat-input.ts → ChatInput._onSend()
      │  dispatch CustomEvent("send-message", { detail: { sessionKey, text, attachments } })
      ▼
message-controller.ts → MessageController.onSendMessage(e)
      │
      ├── 乐观渲染（立即显示）：
      │   content.push({ type: "image", args: { url: att.dataUrl } })
      │   → store.appendMessage(sessionUuid, msg)
      │   → msg-user.ts 渲染 <img src="data:image/png;base64,..."> ✅
      │
      └── 发送 gateway：
          apiAttachments = attachments.map(att → {
            type: "image",
            mimeType: match[1],     // 从 dataUrl 正则提取
            content: match[2],      // base64 数据部分
          })
          → client.request("chat.send", { sessionKey, message, clientRunId, attachments })
```

**关键文件：**

- `aiemas/ui/mas4s/src/views/chat-input.ts` — `_addFile`, `_onSend`
- `aiemas/ui/mas4s/src/controllers/message-controller.ts` — `onSendMessage`
- `aiemas/ui/mas4s/src/lib/chat-types.ts` — `ChatAttachment`, `MessageContentItem`
- `aiemas/ui/mas4s/src/views/msg-user.ts` — `render`（已支持 `type: "image"` 渲染）

---

## 2. Gateway 图片持久化链路（✅ 图片已保存到文件系统）

```
chat.send RPC 到达 gateway
      │
      ▼
src/gateway/server-methods/chat.ts → persistChatSendImages()
      │  遍历 images[]，每张图片：
      │    Buffer.from(img.data, "base64") → saveMediaBuffer(buffer, mimeType, "inbound")
      ▼
src/media/store.ts → saveMediaBuffer(buffer, contentType, subdir="inbound")
      │  dir = resolveMediaDir() + "/inbound"   // ~/.openclaw/media/inbound/
      │  id = buildSavedMediaId({ baseId: uuid, ext, originalFilename })
      │  writeSavedMediaBuffer({ dir, id, buffer })
      │  返回 SavedMedia { id, path: dir/id, size, contentType }
      │
      │  示例路径: ~/.openclaw/media/inbound/a1b2c3d4-e5f6-...-abcd.png
      ▼
src/gateway/server-methods/chat.ts → buildChatSendTranscriptMessage()
      │  调用 resolveChatSendTranscriptMediaFields(savedImages)
      │  返回 transcript 消息:
      │  {
      │    role: "user",
      │    content: "用户文本",
      │    timestamp: ...,
      │    MediaPath: "/full/path/to/image.png",        // 第一张图片路径
      │    MediaPaths: ["/path/1.png", "/path/2.png"],  // 所有图片路径
      │    MediaType: "image/png",                       // 第一张 MIME
      │    MediaTypes: ["image/png", "image/jpeg"],      // 所有 MIME
      │  }
      ▼
写入 JSONL transcript → 触发 onSessionTranscriptUpdate 事件
```

**关键文件：**

- `src/gateway/server-methods/chat.ts` — `persistChatSendImages`, `buildChatSendTranscriptMessage`, `resolveChatSendTranscriptMediaFields`
- `src/media/store.ts` — `saveMediaBuffer`, `resolveMediaDir`, `buildSavedMediaId`, `writeSavedMediaBuffer`

---

## 3. 消息持久化链路（❌ 图片信息在此丢失）

```
onSessionTranscriptUpdate 事件
      │
      ▼
session-transcript-store.ts → SessionTranscriptStore.handleUpdate(update)
      │
      │  msg = update.message
      │  content = extractContent(msg["content"])  ← ❌ 只处理 content 字段
      │                                               msg["MediaPaths"] 被完全忽略
      │                                               msg["MediaTypes"] 被完全忽略
      ▼
session-transcript-store.ts → extractContent(raw)
      │  typeof raw === "string" → 直接返回文本
      │  Array.isArray(raw) → 遍历 block：
      │    type="text"      → "[text] ..."
      │    type="thinking"  → "[thinking] ..."
      │    type="toolCall"  → "[tool_use:name] {}"
      │    type="tool_use"  → "[tool_use:name] {}"
      │    type="tool_result" → 递归提取
      │    其他类型          → "" (空字符串，被 filter(Boolean) 丢弃)
      │                        ← ❌ 无 image 类型处理
      ▼
pushToBuffer({ role, content, timestamp, ... })
      │  content 只有纯文本，无图片信息
      ▼
flush() → persistBatch() → INSERT INTO session_messages
      │  session_messages.content = "用户文本"  ← ❌ 图片路径丢失
```

**根因：**

- `extractContent` 只处理 `msg["content"]` 字段中的文本类 block
- gateway transcript 消息的图片信息存储在 `msg["MediaPaths"]` / `msg["MediaTypes"]` 顶层字段中，不在 `content` 内
- `handleUpdate` 从未读取这两个字段

**关键文件：**

- `aiemas/src/session-history/session-transcript-store.ts` — `handleUpdate`, `extractContent`, `pushToBuffer`, `flush`, `persistBatch`

---

## 4. 历史查询链路（❌ 无图片可返回）

```
前端请求历史消息
      │
      ▼
session-manager.ts → fetchSessionHistoryRange(client, sessionKey, opts)
      │  client.request("session.history.range", { sessionKey, pageSize, ... })
      ▼
handlers-session.ts → handlers["session.history.range"]
      │  权限检查 → bridge.checkSessionAccess
      │  取缓冲快照 → transcriptStore.getBuffered(sessionKey, from, to, sessionId)
      │  extractUuidFromKey(sessionKey) → sessionUuid
      ▼
session-history-query.ts → queryHistoryRange(messageDb, params)
      │  SQL: SELECT * FROM session_messages WHERE sessionUuid=? AND timestamp BETWEEN ...
      │  合并 buffer 消息 → dedupeById → 排序 → 分页
      │  enriched: 为 user 消息附加 senderLabel (resolveDisplayName)
      │  返回 { messages: StoredMessageWithSender[], total, page, ... }
      │
      │  messages[].content = "用户文本"  ← ❌ 无图片信息
      ▼
handlers-session.ts → respond(true, result, undefined)
      ▼
前端收到响应
      │
      ▼
session-manager.ts → fetchSessionHistoryRange 回调
      │  result.messages.flatMap(raw → splitHistoryMessage(normalizeMessage(raw)))
      ▼
message-normalizer.ts → normalizeMessage(message)
      │  m.content = "用户文本" (string)
      │  逐行解析：
      │    [thinking] → { type: "thinking" }
      │    [text]     → { type: "text" }
      │    [tool_use:name] → { type: "tool_call" }
      │    [tool_result]   → { type: "tool_result" }
      │    [approval:requested] → { type: "approval_requested" }
      │    [approval:resolved]  → { type: "approval_resolved" }
      │    其他行 → 收集为 textLines
      │    ← ❌ 无 [image:...] 解析
      ▼
msg-user.ts → render()
      │  content.filter(c => c.type === "image" || c.type === "image_url")
      │  → 空数组，无图片渲染  ← ❌
```

**关键文件：**

- `aiemas/ui/mas4s/src/gateway/session-manager.ts` — `fetchSessionHistoryRange`, `splitHistoryMessage`
- `aiemas/src/gateway-bridge/handlers-session.ts` — `handlers["session.history.range"]`
- `aiemas/src/session-history/session-history-query.ts` — `queryHistoryRange`, `rowToStoredMessage`
- `aiemas/ui/mas4s/src/lib/message-normalizer.ts` — `normalizeMessage`
- `aiemas/ui/mas4s/src/views/msg-user.ts` — `render`

---

## 5. 数据库 schema 参考

```
session_messages 表 (mas4s.message.db)
  id, sessionUuid, sessionKey, sessionId, userId, tenantId,
  role, content, timestamp, seq, archivedDate,
  toolCallId, toolName, parentSessionUuid, sourceAgentId
```

- `content` 列为 TEXT，存储序列化后的消息内容（行前缀格式）
- 无专门的图片/媒体列

**关键文件：**

- `aiemas/src/store/database.ts` — `ensureMessageSchema`

---

## 6. 修复方案概要（方案 A：文件系统引用 + 查询时内联）— ✅ 已实施

### 写入时（handleUpdate）

在 `extractContent` 之后，从 `msg["MediaPaths"]` + `msg["MediaTypes"]` 提取图片元数据，序列化为 `[image:<mimeType>] <absolutePath>` 行追加到 content。

存储示例：`[text] 帮我分析这张图\n[image:image/png] /Users/admin/.openclaw/media/inbound/a1b2c3d4.png`

**改动文件：** `aiemas/src/session-history/session-transcript-store.ts` — `handleUpdate`

### 查询时（session.history.range handler）

`queryHistoryRange` 返回后，扫描每条消息的 content，检测 `[image:...]` 行，读取文件 → base64 → 替换路径为 `data:<mimeType>;base64,...`。

**改动文件：**

- `aiemas/src/session-history/session-history-query.ts` — 新增 `inlineImageContent`
- `aiemas/src/gateway-bridge/handlers-session.ts` — `handlers["session.history.range"]` 中调用

### 前端解析

`normalizeMessage` 新增 `[image:<mimeType>]` 行前缀解析 → `{ type: "image", args: { url: dataUrl } }`。

**改动文件：** `aiemas/ui/mas4s/src/lib/message-normalizer.ts` — `normalizeMessage`

### 前端渲染

`msg-user.ts` 已支持 `type: "image"` 渲染，无需改动。
