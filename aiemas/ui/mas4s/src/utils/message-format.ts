/**
 * 多人会话消息格式化工具。
 *
 * 约定：多人会话中，发送者名以 "Name: " 前缀注入到消息体，
 * 接收方通过 parseSenderPrefix 解析还原。
 */

/**
 * 构造多人会话消息体（注入发送者前缀）。
 * 约定：message = "Alice: 实际内容"
 */
export function buildGroupMessage(senderName: string, text: string): string {
  return `${senderName}: ${text}`;
}

/**
 * 解析消息前缀，提取发送者名和正文。
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
