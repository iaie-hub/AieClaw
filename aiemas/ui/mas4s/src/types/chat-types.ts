import type { NormalizedMessage, MessageContentItem } from "../lib/chat-types.js";

/**
 * mas4s 聊天消息 = NormalizedMessage + mas4s 专属扩展字段。
 * 仅在 mas4s 前端内部使用，不传给 gateway。
 */
export interface ChatMessage extends NormalizedMessage {
  /**
   * mas4s 多人会话子类型（纯前端字段）：
   *   "colleague" — 其他人类参与者发送的消息（由 parseSenderPrefix 解析得到）
   *   "pending"   — 审批挂起消息（role="approval"）
   *   undefined   — 普通 user/assistant 消息
   */
  subType?: "colleague" | "pending";
}

export type { MessageContentItem };
