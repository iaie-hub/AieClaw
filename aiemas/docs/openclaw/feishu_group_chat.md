# 飞书 Channel 群聊及多用户消息标识分析

本文档主要分析 OpenClaw 中的 `feishu` channel 如何接入和处理群聊消息，同时如何区分同一群聊中不同用户的发言。

## 1. 消息入口与事件接收

飞书的消息通过 webhook 推送，其核心入口位于 `extensions/feishu/src/monitor.account.ts` 文件中。

1. **注册 Webhook 处理函数**：
   在 `registerEventHandlers` 中，监听了 `im.message.receive_v1` 事件。
2. **防抖和去重 (Debounce & Dedup)**：
   每次收到消息，会首先经过一个 `inboundDebouncer`（防止消息乱序或服务端重试导致重复）。它会将属于同一个用户、同一个群聊（或者 thread）的连续输入文本在一定时间窗口内聚合成一条消息。
3. **分发处理**：
   防抖队列输出后，会调用 `dispatchFeishuMessage`，最终执行 `extensions/feishu/src/bot.ts` 文件中的 `handleFeishuMessage` 核心逻辑。

## 2. 群聊会话的创建与标识

系统并非一刀切地把整个群聊当成一个会话，而是通过 `groupSessionScope`（群会话作用域）进行精细化控制。

在 `extensions/feishu/src/bot.ts` 的 `handleFeishuMessage` 中：

1. **识别群聊**：
   ```typescript
   let ctx = parseFeishuMessageEvent(event, botOpenId, botName);
   const isGroup = ctx.chatType === "group";
   ```
2. **解析群组会话模式**：
   调用 `resolveFeishuGroupSession` (`bot-content.ts`) 来决定当前的会话 ID (`peerId`)。
   飞书插件支持多种 `groupSessionScope` 配置：
   - `"group"`: 整个群聊共享一个上下文（这是默认行为）。
   - `"group_sender"`: 群聊中每个用户拥有自己独立的上下文，互不影响。`peerId = {chatId}:sender:{senderOpenId}`。
   - `"group_topic"`: 基于话题（Thread）隔离上下文。`peerId = {chatId}:topic:{topicId}`。
   - `"group_topic_sender"`: 基于话题且单用户隔离上下文。

   随后，这个 `peerId` 会被用作路由系统的 `conversationId`，将其映射到一个特定的 Agent Session Key。

## 3. 如何区分群聊中不同用户的消息

当 `groupSessionScope` 设为 `"group"` 时，所有群成员与 Bot 的对话都在同一个上下文中。为了让大语言模型（LLM）能识别具体是谁在说话，系统在投递给大模型之前的 "构建消息 Body" 阶段加入了标识：

1. **提取发送者名称和 ID**：
   每次收到消息时，会尝试获取用户的 `senderName`。此外，底层使用 `ctx.senderOpenId` 唯一确定一个飞书用户。
2. **向消息文本注入说话人前缀**：
   在 `buildFeishuAgentBody` 函数中，专门处理了消息的拼接方式：
   ```typescript
   const speaker = ctx.senderName ?? ctx.senderOpenId;
   messageBody = `${speaker}: ${messageBody}`;
   ```
   **效果**：`"Alice: 你好啊"` 或者 `"Bob: 帮我写一段代码"`。LLM 通过前缀感知这是不同人的陈述。
3. **Envelope 层面的标识**：
   除了用户正文的前缀，传输给 Agent 内部路由系统的 `Envelope` 信息中，也会把 `from` 字段特殊化处理：

   ```typescript
   const envelopeFrom = isGroup ? `${ctx.chatId}:${ctx.senderOpenId}` : ctx.senderOpenId;

   const body = core.channel.reply.formatAgentEnvelope({
     channel: "Feishu",
     from: envelopeFrom, // e.g. "oc_12345:ou_abcde"
     timestamp: new Date(),
     envelope: envelopeOptions,
     body: messageBody,
   });
   ```

   历史记录合并时，之前的消息也会保持原先的 `${ctx.chatId}:${entry.sender}` 的身份标签。这样，整个对话长历史在供给 LLM 时，都具有清晰的发言人结构。

## 4. 总结

1. **链路**：`monitor.account.ts` (`im.message.receive_v1`) -> 去重/防抖聚合 -> `bot.ts` (`handleFeishuMessage`) -> 生成 Agent 对话记录。
2. **会话生成**：根据 `feishuCfg.groupSessionScope`，将会话 ID 映射成群 ID、带用户后缀的组合 ID 或 Thread ID。
3. **用户区分**：通过在群聊消息正文前自动拼装 `发送者昵称/ID:` ，以及注入带用户信息的 Envelope `from` 属性来使 LLM 理解这是一个多人群聊场景。
