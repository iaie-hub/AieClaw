import { getClient } from "../gateway/client.js";
import { AppStore } from "../store/app-store.js";
import { buildChatSendParams } from "../utils/message-format.js";

/**
 * 消息发送与审批控制器。
 * 封装 send-message / resolve-approval 事件处理，
 * 保持 app.ts 只负责连接、认证和渲染。
 */
export class MessageController {
  constructor(private readonly store: AppStore) {}

  onSendMessage = async (e: CustomEvent<{ text: string }>) => {
    const session = this.store.activeSession;
    console.debug(
      "[mas4s:message] send → sessionKey=%s text.length=%d",
      session?.key,
      e.detail.text.length,
    );
    if (!session) {
      console.warn("[mas4s:message] send ← no active session, aborting");
      return;
    }

    const displayName = this.store.currentUser?.displayName ?? "我";
    const rawText = e.detail.text;
    const clientRunId = crypto.randomUUID();

    // 乐观追加用户消息，立即显示在聊天列表中
    this.store.appendMessage(session.sessionUuid!, {
      role: "user",
      content: [{ type: "text", text: rawText }],
      timestamp: Date.now(),
      id: clientRunId,
      senderLabel: displayName,
      subType: undefined,
    });

    // 开始聊天状态跟踪
    this.store.setIsChatting(session.sessionUuid!, true, clientRunId);

    const client = getClient();
    try {
      await client.request(
        "chat.send",
        buildChatSendParams({
          sessionKey: session.key,
          message: rawText,
          clientRunId: clientRunId, // Pass clientRunId to params
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
      console.error("[mas4s:message] exec.approval.resolve failed:", err);
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
