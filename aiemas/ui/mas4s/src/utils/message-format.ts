/**
 * 多人会话消息格式化工具。
 *
 * 发送者身份通过 WS 连接元数据（masToken → displayName → client.connect.client.displayName）
 * 传递给 gateway，由 chat.send 构建 MsgContext.SenderName。
 * message 字段只传纯文本，不再拼 "Name: " 前缀。
 */

/**
 * 解析消息前缀，提取发送者名和正文。
 * 兼容旧格式（历史消息可能含前缀），新消息不再生成前缀。
 * 若无前缀则 senderLabel 为 null。
 *
 * 格式："{发送者名（1-40字符，不含冒号/换行）}: {正文}"
 */
export function parseSenderPrefix(text: string): {
  senderLabel: string | null;
  cleanText: string;
} {
  // 发送者名：1-40 字符，不含冒号和换行；正文：任意内容（含换行）
  const match = /^([^:\n]{1,40}):\s(.+)$/s.exec(text);
  if (!match) {
    return { senderLabel: null, cleanText: text };
  }
  return { senderLabel: match[1].trim(), cleanText: match[2] };
}

/**
 * 构造 chat.send 请求 envelope。
 * message 只传纯文本，发送者身份由连接上下文携带。
 */
export function buildChatSendParams(opts: {
  sessionKey: string;
  message: string;
  idempotencyKey?: string;
}): Record<string, unknown> {
  return {
    sessionKey: opts.sessionKey,
    message: opts.message,
    idempotencyKey: opts.idempotencyKey ?? crypto.randomUUID(),
  };
}
