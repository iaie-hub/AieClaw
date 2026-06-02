# OpenClaw 图片聊天分析：image 工具双次调用问题

## 背景

在会话 `image-1` 中，用户发送 "分析图片中是否存在打架" 并附带一张图片。Agent 调用了两次 `image` 工具，第一次失败，第二次成功。本文档分析完整的图片处理流程、两次调用参数不同的原因，并提出禁止图片上传到 OpenAI 的方案。

---

## 完整流程时间线

| 时间 (UTC+8) | 事件 |
|---|---|
| 22:14:41 | 用户通过控制 UI 发送消息 + 图片附件 |
| 22:14:42 | Gateway 收到 `chat.send`，加载 session |
| 22:14:44 | 注册 abort controller，respond started |
| 22:15:04 | 工具注入完成（含 image-tool），准备 agent session |
| 22:15:05 | stream-ready，开始 agent 推理（图片已作为 input_image 上传到 OpenAI） |
| 22:15:14 | **第一次 image 工具调用**（URL 方式）→ SSRF 拦截，失败 |
| 22:15:15 | 工具返回错误：`Blocked: resolves to private/internal/special-use IP address` |
| 22:15:22 | **第二次 image 工具调用**（attachment:0 方式）→ 也失败 |
| 22:15:22 | 工具返回错误：`Unsupported image reference: attachment:0` |
| 22:15:28 | Agent 放弃工具调用，**直接用自身 vision 能力**分析图片并输出结果 |

> **关键发现**：两次 image 工具调用都失败了。最终分析结果来自模型自身的 vision 能力（因为图片已作为 `input_image` data URL 上传到 OpenAI）。这意味着图片数据确实泄露到了 OpenAI。

---

## 图片上传与处理流程

### 1. 用户上传图片 → Gateway 接收

用户通过控制 UI（WebSocket）发送 `chat.send` 请求：

```json
{
  "method": "chat.send",
  "params": {
    "sessionKey": "agent:main:group:4bd768a4-...",
    "message": "分析图片中是否存在打架",
    "attachments": [{
      "type": "image",
      "mimeType": "image/png",
      "content": "iVBORw0KGgoAAAANSUhEUg..."
    }]
  }
}
```

### 2. Gateway 处理附件

`src/gateway/chat-attachments.ts` 中的 `parseMessageWithAttachments()` 负责处理：

1. **Base64 解码验证** — 检查有效性、MIME 嗅探
2. **大小判断** — 小于 2MB 的图片作为 inline image 保留；大于 2MB 的 offload 到磁盘
3. **保存到 media store** — `saveMediaBuffer()` 将图片持久化
4. **构建 UserTurnInput** — 将 media 信息附加到 agent session 的 transcript

### 3. 图片注入到 OpenAI API 请求（改动前的行为 — 问题根源）

`src/agents/openai-transport-stream.ts` 将图片转换为 OpenAI Responses API 格式：

```typescript
{
  type: "input_image",
  detail: "auto",
  image_url: `data:${item.mimeType};base64,${item.data}`
}
```

**问题**：图片以 data URL 形式上传到 OpenAI，OpenAI 内部存储后生成 `files.oaiusercontent.com` URL，模型在调用工具时使用该 URL，但该 URL 被 SSRF 策略拦截。

---

## 两次调用参数差异分析

### 第一次调用 — URL 方式（失败）

```json
{
  "prompt": "分析这张图片中是否存在打架或暴力行为，详细描述画面中人物的动作和互动",
  "image": "https://files.oaiusercontent.com/file-K7Xq8Y3Zq9W5vN2mL4pR6tH1?se=..."
}
```

**URL 来源**：OpenAI Responses API 在处理 `input_image` (data URL) 时，在模型内部上下文中生成的文件引用。

**失败原因**：SSRF 防护策略拦截 — `files.oaiusercontent.com` 解析到私有/内部 IP 地址。

**错误信息**：
```
Failed to fetch media from https://files.oaiusercontent.com/...: Blocked: resolves to private/internal/special-use IP address
```

### 第二次调用 — attachment 引用方式（也失败）

```json
{
  "image": "attachment:0",
  "prompt": "分析这张图片中是否存在打架或暴力行为，详细描述画面中人物的动作和互动"
}
```

**失败原因**：`attachment:0` 不是 OpenClaw image tool 支持的引用格式。image tool 通过 `classifyMediaReferenceSource()` 判断后返回 `hasUnsupportedScheme: true`。

**错误信息**：
```
Unsupported image reference: attachment:0. Use a file path, a file:// URL, a data: URL, or an http(s) URL.
```

### 最终结果 — 模型直接用 vision 能力分析

两次工具调用都失败后，模型放弃使用 image 工具，直接利用自身的 vision 能力（因为图片已经作为 `input_image` block 上传到了 OpenAI）分析图片内容，输出了详细的分析结果。

**这证实了图片数据确实被上传到了 OpenAI 的 API。**

---

## 已实施方案：`forceOffload` 配置项

### 方案概述

利用 OpenClaw 已有的 **text-only model image offload** 机制：当 `forceOffload: true` 时，系统强制将图片 offload 到本地 media store，并在消息文本中插入 `[media attached: media://inbound/<uuid>]` 标记。Agent 通过 `image` 工具使用该本地路径分析图片，图片数据永远不会发送到 OpenAI。

### 代码改动

#### 1. Schema 定义 — `src/config/zod-schema.core.ts`

在 `ToolsMediaUnderstandingSchema` 中添加 `forceOffload` 字段：

```typescript
const ToolsMediaUnderstandingSchema = z
  .object({
    enabled: z.boolean().optional(),
    forceOffload: z.boolean().optional(),  // ← 新增
    scope: MediaUnderstandingScopeSchema,
    // ... 其余字段不变
  })
  .strict()
  .optional();
```

#### 2. 类型定义 — `src/config/types.tools.ts`

在 `MediaUnderstandingConfig` 类型中添加：

```typescript
export type MediaUnderstandingConfig = MediaProviderRequestConfig & {
  enabled?: boolean;
  /**
   * Force image attachments to be offloaded to local media store instead of
   * being sent inline to the primary model provider. When true, images are
   * never uploaded as input_image blocks; the agent uses the image tool with
   * local media:// references instead. Default: false.
   */
  forceOffload?: boolean;
  // ... 其余字段不变
};
```

#### 3. 运行时逻辑 — `src/gateway/server-methods/chat.ts`

在 `prepare_attachments` 阶段修改 `supportsImages` 判断：

```typescript
const forceImageOffload = cfg.tools?.media?.image?.forceOffload === true;
const supportsImages = forceImageOffload
  ? false
  : supportsSessionModelImages || explicitOriginSupportsInlineImages;
const routeImageOffloadsAsMediaPaths = !supportsImages;
```

### 配置方式

```yaml
# openclaw.yaml
tools:
  media:
    image:
      forceOffload: true   # 强制图片走本地 offload，不上传到模型 provider
      enabled: true        # 启用图片理解
agents:
  defaults:
    imageModel:
      primary: "openai/gpt-4o"  # 图片分析使用的视觉模型（可配置为本地模型）
```

### 数据流对比

#### 改动前（图片上传到 OpenAI — 当前行为）

```
用户图片 → Gateway 保存到 media store
         → 转为 data URL 作为 input_image 发送给 OpenAI API ← 隐私泄露点
         → OpenAI 存储，生成 files.oaiusercontent.com URL
         → 模型用自身 vision 能力看到图片
         → 模型尝试调用 image tool（URL 方式）→ SSRF 拦截，失败
         → 模型重试 image tool（attachment:0）→ 格式不支持，失败
         → 模型放弃工具，直接用 vision 输出分析结果
         → 图片已泄露到 OpenAI，两次工具调用浪费
```

#### 改动后（图片不上传到 OpenAI）

```
用户图片 → Gateway 保存到本地 media store
         → 消息文本插入 [media attached: media://inbound/<uuid>]
         → 纯文本消息发送给 OpenAI API ← 无隐私泄露
         → media-understanding 管线用 imageModel 描述图片
         → 描述文本注入 agent 上下文
         → Agent 如需深入分析，调用 image tool(media://inbound/<uuid>)
         → image tool 从本地加载图片 → 发给 imageModel → 返回结果
         → 一次成功，无重试
```

### 优势

1. **隐私保护** — 图片数据不会发送到 OpenAI 主模型 API
2. **消除 SSRF 问题** — 不再有 `files.oaiusercontent.com` URL 的问题
3. **减少延迟** — 避免了第一次失败 + 重试的开销
4. **降低成本** — 图片不计入主模型的 token 消耗（vision token 很贵）
5. **利用已有机制** — OpenClaw 已有完整的 text-only image offload 管线
6. **可选本地模型** — `imageModel` 可配置为本地部署的视觉模型，实现完全隔离

---

## 涉及的关键代码路径

| 文件 | 职责 |
|------|------|
| `src/config/zod-schema.core.ts` | Schema 校验 — 允许 `forceOffload` 字段 |
| `src/config/types.tools.ts` | TypeScript 类型定义 |
| `src/gateway/server-methods/chat.ts:2934` | 运行时判断 — `forceOffload` 时强制 offload |
| `src/gateway/chat-attachments.ts:251` | `shouldForceImageOffload` → 强制 offload 到磁盘 |
| `src/agents/openai-transport-stream.ts:1099` | `input_image` 过滤 → 模型不支持图片时不发送 |
| `src/agents/embedded-agent-runner/run/images.ts:537` | `detectAndLoadPromptImages` → 跳过图片注入 |
| `src/agents/tools/image-tool.ts:746` | image tool → 从本地加载图片分析 |
| `src/media-understanding/apply.ts` | media-understanding 管线 → 自动描述 offloaded 图片 |

---

## 附录：已有的 text-only offload 机制详解

OpenClaw 已经为 text-only 模型实现了完整的图片处理管线：

1. **Gateway 层**：`routeImageOffloadsAsMediaPaths = true` 时
   - 图片被 `saveMediaBuffer()` 保存到 `~/.openclaw/media/inbound/<uuid>.png`
   - 消息文本追加 `[media attached: media://inbound/<uuid>]`
   - `prestageMediaPathOffloads()` 将路径放入 `ctx.MediaPaths`

2. **Media-understanding 管线**：
   - 检测到 `ctx.MediaPaths` 中有图片
   - 使用 `agents.defaults.imageModel` 配置的视觉模型描述图片
   - 将描述文本注入到 agent 的上下文中

3. **Agent 层**：
   - Agent 看到消息中的 `[media attached: media://inbound/<uuid>]` 标记
   - 如果需要更详细的分析，调用 `image` 工具，参数为 `media://inbound/<uuid>`
   - image tool 通过 `resolveMediaReferenceLocalPath()` 解析为本地文件路径
   - 从本地加载图片，发送给 imageModel 进行分析

`forceOffload: true` 让 vision-capable 模型也走这条已经稳定运行的路径。
