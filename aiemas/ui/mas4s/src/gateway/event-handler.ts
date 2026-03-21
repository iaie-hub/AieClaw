import type { GatewayEventFrame } from "../lib/gateway.js";
import { normalizeMessage } from "../lib/message-normalizer.js";
import { AppStore } from "../store/app-store.js";
import type { ApprovalRequest } from "../types/approval-types.js";
import type { ChatMessage } from "../types/chat-types.js";
import type { MasSession } from "../types/session-types.js";
import { parseSenderPrefix } from "../utils/message-format.js";
import { addEventHandler } from "./client.js";

/**
 * 注册所有 WebSocket 事件处理器。
 * 必须在 getClient() 之前调用，处理器通过 addEventHandler 注册到构造时的 onEvent 回调。
 * 第一期处理：chat、agent（thinking delta 记录）、exec.approval.*
 */
export function registerEventHandlers(): void {
  const store = AppStore.instance;

  addEventHandler((evt: GatewayEventFrame) => {
    switch (evt.event) {
      case "chat":
        handleChatEvent(store, evt.payload);
        break;
      case "agent":
        handleAgentEvent(store, evt.payload);
        break;
      case "exec.approval.requested":
        store.addApproval(evt.payload as ApprovalRequest);
        break;
      case "exec.approval.resolved": {
        const { id } = evt.payload as { id: string };
        store.resolveApproval(id);
        break;
      }
      case "session.joined": {
        const {
          sessionKey,
          label,
          invitedBy: _invitedBy,
          joinedAt: _joinedAt,
        } = evt.payload as {
          sessionKey: string;
          label: string;
          invitedBy: string;
          joinedAt: number;
        };
        const newSession: MasSession = {
          key: sessionKey,
          label,
          kind: "group",
          updatedAt: null,
          masType: "participated",
          hasNotification: true,
          notificationCount: 1,
          participants: [],
        };
        store.addSession(newSession);
        console.info(`您已被邀请加入会话 ${label}`);
        break;
      }
      case "session.removed": {
        const { sessionKey } = evt.payload as { sessionKey: string; removedBy: string };
        store.removeSession(sessionKey);
        console.info("您已被移出会话");
        break;
      }
      case "user.presence": {
        const { userId, isOnline } = evt.payload as {
          userId: string;
          tenantId: string;
          isOnline: boolean;
        };
        store.updateUserPresence(userId, isOnline);
        break;
      }
    }
  });
}

function handleChatEvent(store: AppStore, payload: unknown): void {
  const { sessionKey, state, message } = payload as {
    sessionKey: string;
    state: "delta" | "final" | "clear";
    message?: unknown;
  };

  if (state === "clear") {
    store.clearMessages(sessionKey);
    return;
  }

  if (!message) {
    return;
  }

  const normalized = normalizeMessage(message);
  const firstText =
    normalized.content[0]?.type === "text" ? (normalized.content[0].text ?? "") : "";
  const { senderLabel, cleanText } = parseSenderPrefix(firstText);

  const chatMsg: ChatMessage = {
    ...normalized,
    senderLabel: senderLabel ?? normalized.senderLabel,
    content: firstText
      ? [{ type: "text" as const, text: cleanText }, ...normalized.content.slice(1)]
      : normalized.content,
    subType: senderLabel ? ("colleague" as const) : undefined,
  };

  updateChatStream(store, sessionKey, chatMsg, state === "final");
}

function handleAgentEvent(store: AppStore, payload: unknown): void {
  // 第一期：仅记录 thinking delta，第二期实现 reasoning-block 渲染
  const { sessionKey, stream, delta } = payload as {
    sessionKey?: string;
    stream?: string;
    delta?: string;
  };
  if (!sessionKey || stream !== "thinking" || !delta) {
    return;
  }
  // TODO: 第二期 — 追加到 AppStore 的推理缓存
  void store;
}

/**
 * 流式消息更新策略：
 * - delta：若最后一条消息 id 相同则更新内容，否则追加新消息
 * - final：同上，但标记为最终版本
 */
export function updateChatStream(
  store: AppStore,
  sessionKey: string,
  msg: ChatMessage,
  isFinal: boolean,
): void {
  const msgs = store.messagesBySession.get(sessionKey) ?? [];
  const last = msgs[msgs.length - 1];

  if (!isFinal && last?.role === "assistant" && last.id && last.id === msg.id) {
    store.updateLastMessage(sessionKey, { ...last, content: msg.content });
  } else {
    store.appendMessage(sessionKey, msg);
  }
}

/**
 * 解析 Agent 发送的子 Agent 启动确认标记（第三期）。
 */
export function tryParseSpawnConfirm(text: string): {
  agentName: string;
  task: string;
  raw: string;
} | null {
  const match = /\[SPAWN_CONFIRM\]\s*(.+)/s.exec(text);
  if (!match) {
    return null;
  }

  const body = match[1].trim();
  const nameMatch = /子\s*Agent[：:]\s*([^，,]+)/.exec(body);
  const taskMatch = /任务[：:]\s*(.+?)(?:，|,|$)/.exec(body);

  return {
    agentName: nameMatch?.[1]?.trim() ?? "未知",
    task: taskMatch?.[1]?.trim() ?? body,
    raw: body,
  };
}
