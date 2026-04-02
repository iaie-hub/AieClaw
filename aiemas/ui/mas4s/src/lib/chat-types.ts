/**
 * 从 openclaw ui/types/chat-types.ts 内化的聊天消息类型。
 */

/** Content item types in a normalized message */
export type MessageContentItem = {
  type:
    | "text"
    | "tool_call"
    | "tool_result"
    | "thinking"
    | "approval_requested"
    | "approval_resolved"
    | "sop_state"
    | "skill_progress";
  text?: string;
  thinking?: string;
  name?: string;
  args?: unknown;
  isError?: boolean;
};

/** Normalized message structure for rendering */
export type NormalizedMessage = {
  role: string;
  content: MessageContentItem[];
  timestamp: number;
  id?: string;
  sessionKey?: string;
  senderLabel?: string | null;
  toolCallId?: string;
  toolName?: string;
  isError?: boolean;
};
