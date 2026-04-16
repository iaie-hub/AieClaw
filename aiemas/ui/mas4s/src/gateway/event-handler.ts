import type { GatewayEventFrame } from "../lib/gateway.js";
import { normalizeMessage } from "../lib/message-normalizer.js";
import { AppStore } from "../store/app-store.js";
import type { ApprovalRequest, ApprovalResolved } from "../types/approval-types.js";
import type { ChatMessage } from "../types/chat-types.js";
import type { MasSession } from "../types/session-types.js";
import { parseSenderPrefix } from "../utils/message-format.js";
import { extractUuidFromKey, extractAgentNameFromKey } from "../utils/session-utils.js";
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
const debugLog = (...args: unknown[]) => {
  if (import.meta.env.VITE_DEBUG_MAS4S_EVENTS === "true") {
    console.log(...args);
  }
};

export function registerEventHandlers(): void {
  const store = AppStore.instance;

  addEventHandler((evt: GatewayEventFrame) => {
    debugLog(`[mas4s:event-handler] event=${evt.event}`, evt.payload);
    switch (evt.event) {
      case "chat":
        handleChatEvent(store, evt.payload);
        break;
      case "agent":
        handleAgentEvent(store, evt.payload);
        break;
      case "session.tool":
        // 协作者通过 session.tool 接收工具调用事件（run 发起者通过 agent 事件接收）
        // 复用 handleAgentEvent 的工具流处理逻辑
        handleAgentEvent(store, evt.payload);
        break;
      case "exec.approval.requested":
        store.addApproval(evt.payload as ApprovalRequest);
        break;
      case "exec.approval.resolved": {
        const resolved = evt.payload as ApprovalResolved;
        store.resolveApproval(resolved.id, resolved);
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
        store.removeSession(extractUuidFromKey(sessionKey));
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
      case "session.archived": {
        const { sessionKey, archivedAt } = evt.payload as {
          sessionKey: string;
          archivedAt: number;
          archivedBy: string;
        };
        store.updateSessionArchived(sessionKey, archivedAt);
        console.info("会话已归档，无法继续发送消息");
        break;
      }
      case "session.unarchived": {
        const { sessionKey } = evt.payload as {
          sessionKey: string;
          unarchivedBy: string;
        };
        store.updateSessionArchived(sessionKey, null);
        break;
      }
      case "sessions.changed": {
        // When a session is patched or reset, re-sync label from aiemas DB
        // in case the gateway's sessions.json lost the label.
        const { sessionKey: changedKey, reason: changedReason } = evt.payload as {
          sessionKey?: string;
          reason?: string;
        };
        if (
          changedKey &&
          (changedReason === "patch" || changedReason === "new" || changedReason === "reset")
        ) {
          void (async () => {
            try {
              const { getClient } = await import("./client.js");
              const { fetchSessionLabel } = await import("./session-manager.js");
              const entry = await fetchSessionLabel(getClient(), changedKey);
              if (entry) {
                store.patchSessionLabelFromDb(changedKey, {
                  label: entry.label,
                });
              }
            } catch {
              // Non-critical: label sync failure should not surface as an error
            }
          })();
        }
        break;
      }
      case "session.summary.updated": {
        const { sessionKey: summarySessionKey } = evt.payload as {
          sessionKey: string;
          generatedAt: number;
        };
        // 需求4.12：拉取最新持久化摘要写入 SummaryStore，触发 SummaryDialog 刷新
        void (async () => {
          try {
            const { getClient } = await import("./client.js");
            const { getSummary } = await import("./session-archive.js");
            const { SummaryStore } = await import("../store/summary-store.js");
            const result = await getSummary(getClient(), summarySessionKey);
            if (result) {
              SummaryStore.instance.set(summarySessionKey, result);
            }
          } catch {
            // 拉取失败时静默忽略，不影响其他功能
          } finally {
            store.notify();
          }
        })();
        break;
      }
      // ── SOP / Skill progress events ─────────────────────────────────────
      case "sop.state": {
        const data = evt.payload as Record<string, unknown>;
        const sessionKey = data["sessionKey"] as string;
        if (sessionKey) {
          const sessionUuid = extractUuidFromKey(sessionKey);
          store.updateSOPState(sessionUuid, data);
        }
        break;
      }
      case "skill.progress": {
        const data = evt.payload as Record<string, unknown>;
        const sessionKey = data["sessionKey"] as string;
        if (sessionKey) {
          const sessionUuid = extractUuidFromKey(sessionKey);
          store.updateSkillProgress(sessionUuid, data);
        }
        break;
      }
    }
  });
}

/**
 * 从 sessionKey 中解析消息目标：sessionUuid、agentId、是否为 Root_Agent。
 * 用于 handleChatEvent 和 handleAgentEvent 的统一路由判定。
 */
export function resolveMessageTarget(
  store: AppStore,
  sessionKey: string,
): {
  sessionUuid: string;
  agentId: string;
  isRootAgent: boolean;
} {
  const sessionUuid = extractUuidFromKey(sessionKey);
  const agentId = extractAgentNameFromKey(sessionKey);

  // 优先从 sessions 列表中查找该 sessionUuid 对应的 session，
  // 确保即使 activeSession 指向其他会话也能正确判断 rootAgentId。
  const matchedSession = store.sessions.find(
    (s) => s.sessionUuid === sessionUuid || extractUuidFromKey(s.key) === sessionUuid,
  );
  const rootAgentId = matchedSession
    ? extractAgentNameFromKey(matchedSession.key)
    : store.activeSession
      ? extractAgentNameFromKey(store.activeSession.key)
      : agentId;
  const isRootAgent = agentId === rootAgentId;
  return { sessionUuid, agentId, isRootAgent };
}

function handleChatEvent(store: AppStore, payload: unknown): void {
  const { runId, sessionKey, state, message } = payload as {
    runId?: string;
    sessionKey: string;
    state: "delta" | "final" | "clear";
    message?: unknown;
  };

  const { sessionUuid, agentId, isRootAgent } = resolveMessageTarget(store, sessionKey);

  if (state === "clear") {
    store.clearMessages(sessionUuid);
    store.resetToolStream(sessionUuid);
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
    sessionKey, // 需求 9.1：所有 ChatMessage 携带 sessionKey
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
    store.setIsChatting(sessionUuid, false);

    // 子 Agent run 结束，清除活跃状态
    if (!isRootAgent) {
      store.clearAgentActive(sessionUuid, agentId);
    }

    // ── 碎片修复：Root_Agent run 结束后用 History_Range_API 替换 streaming 碎片 ──
    if (isRootAgent && runId) {
      void (async () => {
        try {
          const { getClient } = await import("./client.js");
          const { fetchSessionHistoryRange } = await import("./session-manager.js");
          const client = getClient();
          const result = await fetchSessionHistoryRange(client, sessionKey);
          const completeMessages = result.messages;

          // 保留 user 和 approval(pending) 消息，用完整消息替换 assistant + tool 碎片
          const currentMsgs = store.messagesBySession.get(sessionUuid) ?? [];
          const preserved = currentMsgs.filter((m) => m.role === "user" || m.subType === "pending");

          // 合并：保留的消息 + API 返回的完整消息（过滤掉 user、pending，且仅保留根 Agent 消息）
          const rootAgentId = extractAgentNameFromKey(sessionKey);
          const apiNonUserMsgs = completeMessages.filter((m) => {
            if (m.role === "user" || m.subType === "pending") {
              return false;
            }
            // 仅保留根 Agent 的消息，过滤子 Agent 消息
            if (m.sessionKey) {
              return extractAgentNameFromKey(m.sessionKey) === rootAgentId;
            }
            // 无 sessionKey 的消息：仅保留非 agent 角色的消息（兼容），
            // agent/assistant 角色的消息若无 sessionKey 则无法确定归属，跳过
            if (m.role === "assistant" || m.role === "Agent") {
              return false;
            }
            return true; // 其他角色（system 等）保留
          });

          // 按时间戳排序合并
          const merged = [...preserved, ...apiNonUserMsgs].toSorted(
            (a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0),
          );

          store.messagesBySession.set(sessionUuid, merged);
          // 同步更新 messagesByAgent 中根 Agent 的消息（Primary_Panel 数据源）
          const agentMap = store.messagesByAgent.get(sessionUuid);
          if (agentMap) {
            agentMap.set(rootAgentId, merged);
          }
          store.notify();
        } catch (err) {
          console.error("[mas4s:event-handler] fragment repair failed:", err);
          // 失败时保留现有消息不做替换
        }
      })();
    }
  } else if (state === "delta" && runId) {
    // 收到 delta 表示正在聊天，确保 UI 状态同步（即便不是由当前客户端发起的 run）
    if (!store.isChattingBySession.get(sessionUuid)) {
      store.setIsChatting(sessionUuid, true, runId);
    }
  }

  // 所有消息路由到 messagesByAgent（无论视图模式）
  updateAgentChatStream(store, sessionUuid, agentId, chatMsg, state === "final");

  // Root_Agent 消息同时写入 messagesBySession（向后兼容）
  if (isRootAgent) {
    updateChatStream(store, sessionUuid, chatMsg, state === "final");
  }
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

  const { sessionUuid, agentId, isRootAgent } = resolveMessageTarget(store, sessionKey);

  if (stream === "prompt" && data?.text !== undefined) {
    const normalized = normalizeMessage(data.text);
    const chatMsg: ChatMessage = {
      ...normalized,
      id: runId ?? normalized.id,
      sessionKey, // 需求 9.1
      timestamp: Date.now(),
      role: normalized.role,
      senderLabel: null,
      subType: normalized.subType as ChatMessage["subType"],
    };
    debugLog(
      `[mas4s:event-handler] Appending manual prompt message (role=${chatMsg.role})`,
      chatMsg,
    );
    // 路由到 messagesByAgent
    store.appendAgentMessage(sessionUuid, agentId, chatMsg);
    // Root_Agent 同时写入 messagesBySession（向后兼容）
    if (isRootAgent) {
      store.appendMessage(sessionUuid, chatMsg);
    }

    // Sub_Agent 收到 prompt 消息时标记活跃状态、自动切换 Tab 和未读标记
    if (!isRootAgent) {
      store.markAgentActive(sessionUuid, agentId);
      const currentTab = store.activeSubAgentTab.get(sessionUuid);
      store.setActiveSubAgentTab(sessionUuid, agentId);
      if (currentTab && currentTab !== agentId) {
        store.clearAgentUnread(sessionUuid, agentId);
      }
      if (currentTab && currentTab !== agentId) {
        store.markAgentUnread(sessionUuid, agentId);
      }
    }
    return;
  }

  // A2A input message: broadcast by aiemas_sessions_send via emitAgentEvent({ stream: "agent" }).
  // data.text carries the full message object ({ role, content, timestamp, senderLabel }),
  // data.role carries the explicit role ("agent"), data.senderLabel carries the source agent id.
  if (stream === "agent" && data?.text !== undefined) {
    const normalized = normalizeMessage(data.text);
    const dataRecord = data as Record<string, unknown>;
    const effectiveRole = typeof dataRecord.role === "string" ? dataRecord.role : normalized.role;
    const effectiveSenderLabel =
      typeof dataRecord.senderLabel === "string" ? dataRecord.senderLabel : null;
    const chatMsg: ChatMessage = {
      ...normalized,
      id: runId ?? `a2a-${Date.now()}`,
      sessionKey,
      timestamp: Date.now(),
      role: effectiveRole,
      senderLabel: effectiveSenderLabel ?? normalized.senderLabel,
      subType: undefined,
    };
    debugLog(
      `[mas4s:event-handler] Appending A2A agent input message (role=${chatMsg.role})`,
      chatMsg,
    );
    store.appendAgentMessage(sessionUuid, agentId, chatMsg);
    if (isRootAgent) {
      store.appendMessage(sessionUuid, chatMsg);
    }

    // Sub_Agent 收到 A2A 消息时标记活跃状态、自动切换 Tab 和未读标记
    if (!isRootAgent) {
      store.markAgentActive(sessionUuid, agentId);
      const currentTab = store.activeSubAgentTab.get(sessionUuid);
      store.setActiveSubAgentTab(sessionUuid, agentId);
      if (currentTab && currentTab !== agentId) {
        store.clearAgentUnread(sessionUuid, agentId);
      }
      if (currentTab && currentTab !== agentId) {
        store.markAgentUnread(sessionUuid, agentId);
      }
    }
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
      sessionKey, // 需求 9.1
      senderLabel: null,
    };

    // 路由到 messagesByAgent
    updateAgentChatStream(store, sessionUuid, agentId, streamMsg, false);
    // Root_Agent 同时写入 messagesBySession（向后兼容）
    if (isRootAgent) {
      updateChatStream(store, sessionUuid, streamMsg, false);
    }

    // Sub_Agent 自动切换 Tab、未读标记和活跃状态
    if (!isRootAgent) {
      store.markAgentActive(sessionUuid, agentId);
      const currentTab = store.activeSubAgentTab.get(sessionUuid);
      // 自动切换到正在 streaming 的 sub-agent
      store.setActiveSubAgentTab(sessionUuid, agentId);
      // 如果之前活跃的 tab 不是当前 agent，清除当前 agent 的未读（因为已切换过来）
      if (currentTab && currentTab !== agentId) {
        store.clearAgentUnread(sessionUuid, agentId);
      }
      // 如果当前 agent 不是活跃 tab，标记未读
      if (currentTab && currentTab !== agentId) {
        store.markAgentUnread(sessionUuid, agentId);
      }
    }
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

    // Root_Agent 的 toolStream 写入 messagesBySession（向后兼容）
    if (isRootAgent) {
      store.upsertToolStream(
        {
          toolCallId,
          runId,
          sessionKey,
          name,
          args: phase === "start" ? data.args : existing?.args,
          output: output ?? undefined,
          startedAt: existing?.startedAt ?? Date.now(),
        },
        sessionUuid,
      );
    }

    // When a tool execution finishes (phase="result"), append a dedicated toolResult message
    // to the chat flow so it is rendered by MsgToolResult/MsgToolCard.
    if (phase === "result" && data.result !== undefined) {
      const toolMsg: ChatMessage = {
        role: "toolResult",
        content: [{ type: "tool_result", text: formatToolOutput(data.result) }],
        timestamp: Date.now(),
        id: `${toolCallId}-result`,
        sessionKey, // 需求 9.1
        senderLabel: null,
        toolCallId,
        toolName: name,
        isError: !!(
          (data as { isError?: boolean }).isError ||
          (data.result &&
            typeof data.result === "object" &&
            ((data.result as Record<string, unknown>).status === "error" ||
              !!(data.result as Record<string, unknown>).error))
        ),
      };
      debugLog(`[mas4s:event-handler] Appending manual toolResult message for ${name}`, toolMsg);

      // 路由到 messagesByAgent
      store.appendAgentMessage(sessionUuid, agentId, toolMsg);
      // Root_Agent 同时写入 messagesBySession（向后兼容）
      if (isRootAgent) {
        store.appendMessage(sessionUuid, toolMsg);
      }
    }

    // Sub_Agent 自动切换 Tab、未读标记和活跃状态
    if (!isRootAgent) {
      store.markAgentActive(sessionUuid, agentId);
      const currentTab = store.activeSubAgentTab.get(sessionUuid);
      // 自动切换到正在 streaming 的 sub-agent
      store.setActiveSubAgentTab(sessionUuid, agentId);
      if (currentTab && currentTab !== agentId) {
        store.clearAgentUnread(sessionUuid, agentId);
      }
      if (currentTab && currentTab !== agentId) {
        store.markAgentUnread(sessionUuid, agentId);
      }
    }
    return;
  }

  if (stream === "thinking" && runId) {
    // 使用 data.text (全量累计文本) 更新思考缓存，并立即触发界面更新
    const thinkingText = data?.text ?? "";
    _thinkingByRun.set(runId, thinkingText);

    if (sessionKey) {
      const streamMsg: ChatMessage = {
        role: "assistant",
        content: [{ type: "thinking", thinking: thinkingText }],
        timestamp: Date.now(),
        id: runId,
        sessionKey, // 需求 9.1
        senderLabel: null,
      };
      // 路由到 messagesByAgent
      updateAgentChatStream(store, sessionUuid, agentId, streamMsg, false);
      // Root_Agent 同时写入 messagesBySession（向后兼容）
      if (isRootAgent) {
        updateChatStream(store, sessionUuid, streamMsg, false);
      }

      // Sub_Agent 思考过程中标记活跃状态、自动切换 Tab 和未读标记
      if (!isRootAgent) {
        store.markAgentActive(sessionUuid, agentId);
        const currentTab = store.activeSubAgentTab.get(sessionUuid);
        store.setActiveSubAgentTab(sessionUuid, agentId);
        if (currentTab && currentTab !== agentId) {
          store.clearAgentUnread(sessionUuid, agentId);
        }
        if (currentTab && currentTab !== agentId) {
          store.markAgentUnread(sessionUuid, agentId);
        }
      }
    }
    return;
  }
}

/**
 * 流式消息更新策略：
 * - 先按 id + role 全列表查找，找到则原地更新（避免 pending 卡片插入后末尾匹配失败）
 * - chat final 更新时保留已有的 thinking 内容，只更新 text 部分
 * - 找不到则追加新消息
 *
 * 注意：必须同时校验 role，避免用户消息与 agent 消息共用同一 runId 时
 * 发生 role 错误（content 被替换但 role 保留为 "user"）。
 */
export function updateChatStream(
  store: AppStore,
  sessionUuid: string,
  msg: ChatMessage,
  isFinal: boolean,
): void {
  const msgs = store.messagesBySession.get(sessionUuid) ?? [];

  // 只在最后一条消息 ID 匹配时执行原地更新，避免跨越工具调用或协作消息进行原地覆盖
  const last = msgs[msgs.length - 1];
  if (msg.id && last && last.id === msg.id && last.role === msg.role) {
    let mergedContent = msg.content;
    if (isFinal) {
      // chat final 只携带 text，需保留已有的 thinking 内容
      const existingThinking = last.content.filter((c) => c.type === "thinking");
      const incomingNonThinking = msg.content.filter((c) => c.type !== "thinking");
      if (existingThinking.length > 0 && incomingNonThinking.length > 0) {
        mergedContent = [...existingThinking, ...incomingNonThinking];
      }
    }
    store.updateLastMessage(sessionUuid, { ...last, content: mergedContent });
    return;
  }

  // 不存在匹配的末尾消息，则追加
  store.appendMessage(sessionUuid, msg);
}

/**
 * 按 Agent 维度的流式消息更新策略（镜像 updateChatStream，操作 messagesByAgent）：
 * - 在 messagesByAgent[sessionUuid][agentId] 中查找末尾消息进行原地更新
 * - chat final 更新时保留已有的 thinking 内容，只更新 text 部分
 * - 找不到则追加新消息
 * - 确保不同 Agent 的 streaming delta 互不干扰
 */
export function updateAgentChatStream(
  store: AppStore,
  sessionUuid: string,
  agentId: string,
  msg: ChatMessage,
  isFinal: boolean,
): void {
  const msgs = store.getAgentMessages(sessionUuid, agentId);
  const last = msgs[msgs.length - 1];
  if (msg.id && last && last.id === msg.id && last.role === msg.role) {
    let mergedContent = msg.content;
    if (isFinal) {
      const existingThinking = last.content.filter((c) => c.type === "thinking");
      const incomingNonThinking = msg.content.filter((c) => c.type !== "thinking");
      if (existingThinking.length > 0 && incomingNonThinking.length > 0) {
        mergedContent = [...existingThinking, ...incomingNonThinking];
      }
    }
    store.updateAgentLastMessage(sessionUuid, agentId, { ...last, content: mergedContent });
    return;
  }
  store.appendAgentMessage(sessionUuid, agentId, msg);
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
