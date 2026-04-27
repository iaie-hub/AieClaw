import { getClient } from "../gateway/client.js";
import type { ChatAttachment, MessageContentItem } from "../lib/chat-types.js";
import { GatewayRequestError } from "../lib/gateway.js";
import { AppStore } from "../store/app-store.js";
import type { ChatMessage } from "../types/chat-types.js";
import { buildChatSendParams } from "../utils/message-format.js";
import { extractAgentNameFromKey } from "../utils/session-utils.js";

/**
 * 消息发送与审批控制器。
 * 封装 send-message / resolve-approval 事件处理，
 * 保持 app.ts 只负责连接、认证和渲染。
 */
export class MessageController {
  constructor(private readonly store: AppStore) {}

  onSendMessage = async (e: CustomEvent<{ text: string; attachments?: ChatAttachment[] }>) => {
    const session = this.store.activeSession;
    const attachments = e.detail.attachments ?? [];
    console.debug(
      "[mas4s:message] send → sessionKey=%s text.length=%d attachments=%d",
      session?.key,
      e.detail.text.length,
      attachments.length,
    );
    if (!session) {
      console.warn("[mas4s:message] send ← no active session, aborting");
      return;
    }

    const displayName = this.store.currentUser?.displayName ?? "我";
    const rawText = e.detail.text;
    const clientRunId = crypto.randomUUID();

    // 需求：如果当前正在聊天，则先中止
    if (session.sessionUuid && this.store.isChattingBySession.get(session.sessionUuid)) {
      console.debug("[mas4s:message] send → interrupting active run before sending");
      await this.onAbortChat();
    }

    const content: MessageContentItem[] = [];
    if (rawText.trim()) {
      content.push({ type: "text", text: rawText });
    }

    // Add images to local content for immediate rendering
    for (const att of attachments) {
      if (att.dataUrl) {
        content.push({
          type: "image",
          args: { url: att.dataUrl },
        } as MessageContentItem);
      }
    }

    const msg: ChatMessage = {
      role: "user",
      content,
      timestamp: Date.now(),
      id: clientRunId,
      senderLabel: displayName,
      subType: undefined,
    };

    // 乐观追加用户消息，立即显示在聊天列表中
    this.store.appendMessage(session.sessionUuid!, msg);

    // 同步到当前会话根 Agent 的消息流中，确保 Multi-Agent UI 能够立刻显示乐观输入
    const rootAgentId = extractAgentNameFromKey(session.key);
    this.store.appendAgentMessage(session.sessionUuid!, rootAgentId, msg);

    // 开始聊天状态跟踪
    this.store.setIsChatting(session.sessionUuid!, true, clientRunId);

    const client = getClient();
    try {
      const apiAttachments = attachments
        .map((att) => {
          if (!att.dataUrl) {
            return null;
          }
          const match = /^data:([^;]+);base64,(.+)$/.exec(att.dataUrl);
          if (!match) {
            return null;
          }
          return {
            type: "image",
            mimeType: match[1],
            content: match[2],
          };
        })
        .filter((a) => a !== null);

      await client.request(
        "chat.send",
        buildChatSendParams({
          sessionKey: session.key,
          message: rawText,
          clientRunId: clientRunId,
          attachments: apiAttachments.length > 0 ? apiAttachments : undefined,
        }),
      );
      console.debug("[mas4s:message] send ← chat.send ok");
    } catch (err) {
      console.error("[mas4s:message] chat.send failed:", err);
    }
  };

  onResolveApproval = async (e: CustomEvent<{ id: string; decision: string }>) => {
    console.debug(
      "[mas4s:message] resolveApproval → id=%s decision=%s",
      e.detail.id,
      e.detail.decision,
    );
    // 乐观更新：立即将审批移入 resolved，避免等待 gateway 广播
    AppStore.instance.resolveApproval(e.detail.id, {
      id: e.detail.id,
      decision: e.detail.decision,
      ts: Date.now(),
    });
    const client = getClient();
    try {
      await client.request("exec.approval.resolve", {
        id: e.detail.id,
        decision: e.detail.decision,
      });
      console.debug("[mas4s:message] resolveApproval ← ok");
    } catch (err) {
      // 审批过期/已处理是正常竞态（乐观更新已生效），降级为 warn
      if (
        err instanceof GatewayRequestError &&
        (err.gatewayCode === "NOT_FOUND" || /unknown or expired/i.test(err.message))
      ) {
        console.warn(
          "[mas4s:message] approval already expired or resolved, optimistic update kept",
        );
      } else {
        console.error("[mas4s:message] exec.approval.resolve failed:", err);
      }
    }
  };

  /**
   * 子 Agent 抽屉消息发送。
   * 构造子 Agent 的 sessionKey 并通过 chat.send 发送，
   * 同时乐观追加到对应 Agent 的消息流中。
   */
  onSendSubAgentMessage = async (
    subSessionKey: string,
    agentId: string,
    sessionUuid: string,
    text: string,
  ) => {
    const displayName = this.store.currentUser?.displayName ?? "我";
    const clientRunId = crypto.randomUUID();

    const msg: ChatMessage = {
      role: "user",
      content: [{ type: "text", text }],
      timestamp: Date.now(),
      id: clientRunId,
      senderLabel: displayName,
      subType: undefined,
    };

    // 乐观追加到子 Agent 消息流
    this.store.appendAgentMessage(sessionUuid, agentId, msg);

    const client = getClient();
    try {
      await client.request(
        "chat.send",
        buildChatSendParams({
          sessionKey: subSessionKey,
          message: text,
          clientRunId,
        }),
      );
      console.debug("[mas4s:message] sub-agent send ← ok agentId=%s", agentId);
    } catch (err) {
      console.error("[mas4s:message] sub-agent chat.send failed:", err);
    }
  };

  onAbortChat = async () => {
    const session = this.store.activeSession;
    if (!session || !session.sessionUuid) {
      return;
    }
    const runId = this.store.activeRunIdBySession.get(session.sessionUuid);

    // 需求：中止聊天时，如果有待审核任务，直接拒绝
    const sessionKey = session.key;
    const pendingForSession = this.store.pendingApprovals.filter(
      (a) => a.request.sessionKey === sessionKey,
    );

    if (pendingForSession.length > 0) {
      console.debug(
        "[mas4s:message] abort → rejecting %d pending approvals",
        pendingForSession.length,
      );
      const client = getClient();
      for (const app of pendingForSession) {
        // 乐观更新
        this.store.resolveApproval(app.id, {
          id: app.id,
          decision: "deny",
          ts: Date.now(),
        });
        // 发回 gateway
        void client
          .request("exec.approval.resolve", { id: app.id, decision: "deny" })
          .catch((err) => {
            console.error("[mas4s:message] abort: auto-deny approval failed:", err);
          });
      }
    }

    if (!runId) {
      console.warn("[mas4s:message] abort ← no active runId for session");
      // Fallback: reset UI state even if no runId found
      this.store.setIsChatting(session.sessionUuid, false);
      return;
    }

    console.debug("[mas4s:message] abort → sessionKey=%s runId=%s", sessionKey, runId);
    const client = getClient();
    try {
      await client.request("chat.abort", {
        sessionKey,
        runId,
      });
      console.debug("[mas4s:message] abort ← chat.abort ok");
    } catch (err) {
      console.error("[mas4s:message] chat.abort failed:", err);
    } finally {
      // Reset local state regardless of result
      this.store.setIsChatting(session.sessionUuid, false);
    }
  };
}
