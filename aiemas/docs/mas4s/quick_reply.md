# 快捷回复按钮方案

> 当 agent 回复末尾为疑问句时，在气泡下方自动渲染快捷回复按钮，用户点击即发送，无需手动输入。

---

## 一、问题背景

agent 在完成阶段性任务后（如 Step 1 检索完成），会输出"是否继续？"类确认请求。
用户需要手动输入"继续"才能推进流程，体验割裂。

目标：将确认交互从文本输入升级为一键点击按钮。

---

## 二、设计决策

| 方案                                              | 说明                                      | 结论        |
| ------------------------------------------------- | ----------------------------------------- | ----------- |
| 后端输出特殊标记（如 `<!--actions:继续,停止-->`） | 需要 agent 稳定输出格式，依赖 prompt 约束 | ❌ 不可靠   |
| 前端解析疑问句，自动推断按钮                      | 纯前端，零后端改动，基于标点检测          | ✅ 采用     |
| 通用 suggestion chip 组件                         | 过度设计，当前场景不需要                  | ❌ 暂不引入 |

**核心原则**：零后端改动，纯前端实现，只对最新一条 agent 消息生效。

---

## 三、实现架构

```
agent 回复末尾带问号（？/ ?）
  │
  ▼
msg-agent._renderQuickReplies()
  │  检测 isLatest=true 且最后一条 text item 末尾为问号
  │  调用 inferQuickReplies(text) 推断按钮选项
  ▼
渲染绿色圆角按钮行
  │
  ▼  用户点击
dispatch CustomEvent("quick-reply", { detail: { text } })
  │  bubbles: true, composed: true
  ▼
chat-view._onQuickReply(e)
  │
  ▼
dispatch CustomEvent("send-message", { detail: { sessionKey, text } })
  │
  ▼
MessageController.onSendMessage
  │
  ▼
client.request("chat.send", ...)  →  Gateway
```

---

## 四、涉及文件

| 文件                                        | 变更类型 | 说明                                           |
| ------------------------------------------- | -------- | ---------------------------------------------- |
| `aiemas/ui/mas4s/src/views/msg-agent.ts`    | 修改     | 新增 `isLatest` prop、疑问句检测、快捷回复渲染 |
| `aiemas/ui/mas4s/src/views/message-list.ts` | 修改     | 计算最后一条 agent 消息 id，传入 `isLatest`    |
| `aiemas/ui/mas4s/src/views/chat-view.ts`    | 修改     | 监听 `quick-reply` 事件，转发为 `send-message` |

---

## 五、关键实现

### 5.1 疑问句检测（msg-agent.ts）

```typescript
function endsWithQuestion(text: string): boolean {
  const trimmed = text.trimEnd();
  return trimmed.endsWith("?") || trimmed.endsWith("？");
}
```

### 5.2 按钮选项推断（msg-agent.ts）

根据问句内容关键词自动选择按钮组合：

```typescript
function inferQuickReplies(text: string): string[] {
  const t = text.toLowerCase();
  if (t.includes("跳过") || t.includes("skip")) {
    return ["继续", "跳过", "停止"];
  }
  if (t.includes("分析") || t.includes("analyz") || t.includes("deep")) {
    return ["继续分析", "跳过分析", "停止"];
  }
  return ["继续", "停止"];
}
```

| 问句关键词                   | 按钮组合                   |
| ---------------------------- | -------------------------- |
| 含"跳过" / "skip"            | 继续 / 跳过 / 停止         |
| 含"分析" / "analyz" / "deep" | 继续分析 / 跳过分析 / 停止 |
| 其他                         | 继续 / 停止                |

### 5.3 渲染逻辑（msg-agent.ts）

```typescript
private _renderQuickReplies() {
  if (!this.isLatest) return nothing;
  const textItems = this.message.content.filter((c) => c.type === "text" && c.text?.trim());
  const lastText = textItems[textItems.length - 1]?.text ?? "";
  if (!endsWithQuestion(lastText)) return nothing;
  const replies = inferQuickReplies(lastText);
  return html`
    <div class="quick-replies">
      ${replies.map(
        (r) => html`
          <button class="quick-reply-btn" @click=${() => this._onQuickReply(r)}>${r}</button>
        `,
      )}
    </div>
  `;
}
```

### 5.4 isLatest 计算（message-list.ts）

每次 `render()` 时找到最后一条可见 assistant 消息（排除被审批卡片替代的消息）：

```typescript
const lastAgentMsg = [...this.messages]
  .reverse()
  .find((m) => m.role === "assistant" && !(m.id && this._cachedApprovalTriggeredMsgIds.has(m.id)));
const lastAgentId = lastAgentMsg?.id;

return html`${this.messages.map((msg) =>
  this._renderMessage(msg, !!(lastAgentId && msg.id === lastAgentId)),
)}`;
```

### 5.5 事件转发（chat-view.ts）

```typescript
private _onQuickReply = (e: CustomEvent<{ text: string }>) => {
  if (!this.session || this._isArchived) return;
  this.dispatchEvent(
    new CustomEvent("send-message", {
      detail: { sessionKey: this.session.key, text: e.detail.text },
      bubbles: true,
      composed: true,
    }),
  );
};
```

注册/注销与 `summary-click` 同步管理：

```typescript
override connectedCallback() {
  super.connectedCallback();
  this.addEventListener("quick-reply", this._onQuickReply as EventListener);
}
override disconnectedCallback() {
  super.disconnectedCallback();
  this.removeEventListener("quick-reply", this._onQuickReply as EventListener);
}
```

---

## 六、样式规范

按钮风格与 agent 气泡配色保持一致（绿色系）：

```css
.quick-replies {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}

.quick-reply-btn {
  padding: 6px 16px;
  border-radius: 20px;
  border: 1.5px solid #10b981;
  background: #ffffff;
  color: #059669;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.quick-reply-btn:hover {
  background: #ecfdf5;
  border-color: #059669;
  transform: translateY(-1px);
  box-shadow: 0 3px 8px rgba(16, 185, 129, 0.2);
}
```

---

## 七、行为约束

- 按钮**只在最新一条 agent 消息**下方显示（`isLatest=true`），历史消息不显示。
- agent 运行中（`isChatting=true`）时按钮仍可点击，点击后 `MessageController` 会先中止当前运行再发送新消息（已有逻辑）。
- 会话归档（`_isArchived=true`）时按钮点击无效。
- 按钮点击后不清空输入框（输入框本来就是空的），不影响用户正在输入的内容。

---

## 八、扩展方向

- **agent 主动声明按钮**：在 SOUL.md 中约定 agent 输出 `<!--actions: 继续, 跳过-->` 标记，前端解析后渲染精确按钮，替代关键词推断。
- **按钮消失时机**：用户发送任意消息后，旧的快捷回复按钮自动消失（已通过 `isLatest` 机制实现）。
- **多语言支持**：`inferQuickReplies` 可扩展英文关键词匹配，当前已包含 `skip` / `analyz` / `deep`。
