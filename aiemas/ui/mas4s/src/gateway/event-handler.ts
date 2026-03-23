import type { GatewayEventFrame } from "../lib/gateway.js";
import { normalizeMessage } from "../lib/message-normalizer.js";
import { AppStore } from "../store/app-store.js";
import type { ApprovalRequest } from "../types/approval-types.js";
import type { ChatMessage } from "../types/chat-types.js";
import type { MasSession } from "../types/session-types.js";
import { parseSenderPrefix } from "../utils/message-format.js";
import { addEventHandler } from "./client.js";

const TOOL_OUTPUT_CHAR_LIMIT = 120_000;

/** 每个 runId 的 thinking 文本累积缓存（流式 delta 拼接） */
const _thinkingByRun: Map<string, string> = new Map();

function formatToolOutput(value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "string") {
    return value.length > TOOL_OUTPUT_CHAR_LIMIT
      ? value.slice(0, TOOL_OUTPUT_CHAR_LIMIT) + "\n…(truncated)"
      : value;
  }
  // object: try to extract text content first
  const rec = value as Record<string, unknown>;
  if (typeof rec.text === "string") {
    return formatToolOutput(rec.text);
  }
  if (Array.isArray(rec.content)) {
    const parts = rec.content
      .map((item) => {
        const x = item as Record<string, unknown>;
        return x.type === "text" && typeof x.text === "string" ? x.text : null;
      })
      .filter((s): s is string => s !== null);
    if (parts.length > 0) {
      return formatToolOutput(parts.join("\n"));
    }
  }
  try {
    const json = JSON.stringify(value, null, 2);
    return json.length > TOOL_OUTPUT_CHAR_LIMIT
      ? json.slice(0, TOOL_OUTPUT_CHAR_LIMIT) + "\n…(truncated)"
      : json;
  } catch {
    return Object.prototype.toString.call(value);
  }
}

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
  const { runId, sessionKey, state, message } = payload as {
    runId?: string;
    sessionKey: string;
    state: "delta" | "final" | "clear";
    message?: unknown;
  };

  if (state === "clear") {
    store.clearMessages(sessionKey);
    store.resetToolStream(sessionKey);
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
    // 用 runId 作为流式消息的稳定 id，供去重匹配
    id: normalized.id ?? runId,
    senderLabel: senderLabel ?? normalized.senderLabel,
    content: firstText
      ? [{ type: "text" as const, text: cleanText }, ...normalized.content.slice(1)]
      : normalized.content,
    subType: senderLabel ? ("colleague" as const) : undefined,
  };

  // assistant delta 由 event:"agent" stream:"assistant" 负责流式渲染，
  // 此处跳过，避免与 agent 事件重复追加。
  // user 消息和 final 状态（最终确认）仍由此处处理。
  if (normalized.role === "assistant" && state === "delta") {
    return;
  }

  // run 结束，清理 thinking 缓存
  if (state === "final" && runId) {
    _thinkingByRun.delete(runId);
  }

  updateChatStream(store, sessionKey, chatMsg, state === "final");
}

function handleAgentEvent(store: AppStore, payload: unknown): void {
  const { runId, sessionKey, stream, data } = payload as {
    runId?: string;
    sessionKey?: string;
    stream?: string;
    data?: {
      text?: string;
      delta?: string;
      name?: string;
      args?: unknown;
      result?: string;
      toolCallId?: string;
      phase?: string;
      partialResult?: string;
    };
  };

  if (!sessionKey) {
    return;
  }

  if (stream === "assistant" && data?.text !== undefined && runId) {
    // 用 runId 作为稳定 id，流式更新 assistant 消息气泡
    const thinkingText = _thinkingByRun.get(runId);
    const content: ChatMessage["content"] = [];
    if (thinkingText) {
      content.push({ type: "thinking", thinking: thinkingText });
    }
    content.push({ type: "text", text: data.text });
    const streamMsg: ChatMessage = {
      role: "assistant",
      content,
      timestamp: Date.now(),
      id: runId,
      senderLabel: null,
    };
    updateChatStream(store, sessionKey, streamMsg, false);
    return;
  }

  // tool 流：phase=start/update/result，对标原 ui/app-tool-stream.ts handleAgentEvent
  if (stream === "tool" && data?.toolCallId && runId) {
    const toolCallId = data.toolCallId;
    const name = data.name ?? "tool";
    const phase = data.phase ?? "";

    const existing = store.toolStreamById.get(toolCallId);
    const output =
      phase === "update"
        ? formatToolOutput(data.partialResult)
        : phase === "result"
          ? formatToolOutput(data.result)
          : existing?.output;

    store.upsertToolStream({
      toolCallId,
      runId,
      sessionKey,
      name,
      args: phase === "start" ? data.args : existing?.args,
      output: output ?? undefined,
      startedAt: existing?.startedAt ?? Date.now(),
    });
    return;
  }

  if (stream === "thinking" && data?.delta && runId) {
    // 累积 thinking delta，下次 assistant 流更新时一起带入 content
    const prev = _thinkingByRun.get(runId) ?? "";
    _thinkingByRun.set(runId, prev + data.delta);
    return;
  }
}

/**
 * 流式消息更新策略：
 * - 若最后一条 assistant 消息 id 相同则更新内容（无论 delta 还是 final）
 * - 否则追加新消息
 */
export function updateChatStream(
  store: AppStore,
  sessionKey: string,
  msg: ChatMessage,
  _isFinal: boolean,
): void {
  const msgs = store.messagesBySession.get(sessionKey) ?? [];
  const last = msgs[msgs.length - 1];

  if (last?.role === "assistant" && last.id && last.id === msg.id) {
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
