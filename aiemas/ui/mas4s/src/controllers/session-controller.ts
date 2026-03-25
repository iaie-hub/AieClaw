import { getClient } from "../gateway/client.js";
import { archiveSession, unarchiveSession } from "../gateway/session-archive.js";
import { inviteUser, listSessionMembers, removeMember } from "../gateway/session-invite.js";
import {
  createSession,
  deleteSession,
  fetchSessionHistory,
  fetchSessionHistoryRange,
  fetchSessions,
  renameSession,
} from "../gateway/session-manager.js";
import type { AppStore } from "../store/app-store.js";

/**
 * 会话管理控制器。
 * 封装 session-create / session-rename / session-select / session-refresh 事件处理，
 * 保持 app.ts 只负责连接、认证和渲染。
 */
export class SessionController {
  constructor(private readonly store: AppStore) {}

  onSessionCreate = async (
    e: CustomEvent<{ label: string; reasoningLevel?: "stream" | "on" | "off" }>,
  ) => {
    console.debug(
      "[mas4s:session] create → label=%s reasoningLevel=%s",
      e.detail.label,
      e.detail.reasoningLevel,
    );
    const client = getClient();
    try {
      const session = await createSession(client, {
        label: e.detail.label,
        reasoningLevel: e.detail.reasoningLevel,
      });
      // 创建成功后刷新完整会话列表，确保 label 等字段与 gateway 存储一致
      const sessions = await fetchSessions(client);
      this.store.setSessions(sessions);
      this.store.setActiveSession(session.key);
      console.debug("[mas4s:session] create ← key=%s sessions=%d", session.key, sessions.length);
    } catch (err) {
      console.error("[mas4s:session] createSession failed:", err);
    }
  };

  onSessionRefresh = async (e?: Event) => {
    // 通知 session-sidebar 复位刷新按钮旋转状态
    const sidebar =
      (e?.target as HTMLElement | undefined)?.closest?.("session-sidebar") ??
      document.querySelector("session-sidebar");
    console.debug("[mas4s:session] refresh →");
    const client = getClient();
    try {
      const sessions = await fetchSessions(client);
      this.store.setSessions(sessions);
      console.debug("[mas4s:session] refresh ← count=%d", sessions.length);
    } catch (err) {
      console.error("[mas4s:session] refresh failed:", err);
    } finally {
      (sidebar as (HTMLElement & { refreshDone?: () => void }) | null)?.refreshDone?.();
    }
  };

  onSessionRename = async (
    e: CustomEvent<{ sessionKey: string; label: string; reasoningLevel?: "stream" | "on" | "off" }>,
  ) => {
    const { sessionKey, label, reasoningLevel } = e.detail;
    console.debug(
      "[mas4s:session] rename → sessionKey=%s label=%s reasoningLevel=%s",
      sessionKey,
      label,
      reasoningLevel,
    );
    const client = getClient();
    try {
      await renameSession(client, sessionKey, label, reasoningLevel);
      this.store.updateSessionLabel(sessionKey, label);
      console.debug("[mas4s:session] rename ← ok");
    } catch (err) {
      console.error("[mas4s:session] renameSession failed:", err);
    }
  };

  onSessionDelete = async (e: CustomEvent<{ sessionKey: string }>) => {
    const { sessionKey } = e.detail;
    console.debug("[mas4s:session] delete → sessionKey=%s", sessionKey);
    const client = getClient();
    try {
      await deleteSession(client, sessionKey);
      this.store.removeSession(sessionKey);
      console.debug("[mas4s:session] delete ← ok");
    } catch (err) {
      console.error("[mas4s:session] deleteSession failed:", err);
    }
  };

  onSessionSelect = (e: CustomEvent<{ sessionKey: string }>) => {
    const { sessionKey } = e.detail;
    console.debug("[mas4s:session] select → sessionKey=%s", sessionKey);
    this.store.setActiveSession(sessionKey);

    // Always re-fetch history on selection (clear previous cache first)
    this.store.clearMessages(sessionKey);
    const client = getClient();
    void fetchSessionHistoryRange(client, sessionKey, { page: 1, pageSize: 100 })
      .then((result) => {
        this.store.messagesBySession.set(sessionKey, result.messages);
        this.store.setHistoryMeta(sessionKey, {
          truncated: result.truncated,
          hasSummary: result.hasSummary,
          page: result.page,
          totalPages: result.totalPages,
          sessionStats: result.sessionStats,
        });
        console.debug(
          "[mas4s:session] select ← history re-loaded (range): count=%d page=%d/%d",
          result.messages.length,
          result.page,
          result.totalPages,
        );
      })
      .catch((err) => {
        console.warn(
          "[mas4s:session] select ← fetchSessionHistoryRange failed, falling back:",
          err,
        );
        // Fallback to chat.history
        void fetchSessionHistory(client, sessionKey)
          .then((messages) => {
            this.store.messagesBySession.set(sessionKey, messages);
            this.store.setHistoryMeta(sessionKey, {
              truncated: false,
              hasSummary: false,
              page: 1,
              totalPages: 1,
              sessionStats: { firstMsgAt: null, lastMsgAt: null, totalMsgCount: 0 },
            });
            this.store.notify();
            console.debug(
              "[mas4s:session] select ← history re-loaded (fallback): count=%d",
              messages.length,
            );
          })
          .catch((fallbackErr) => {
            console.warn(
              "[mas4s:session] select ← fetchSessionHistory fallback failed:",
              fallbackErr,
            );
          });
      });
  };

  /**
   * 向上翻页：加载比当前已有消息更早的一页历史。
   * 由 chat-view 在用户滚动到顶部时触发。
   * 策略：后端按 DESC 分页，page=1 是最新一页，page=N 是最旧一页。
   * 当前已加载的是 page=1（最新），向上翻页请求 page=2，依此类推。
   * 新消息前插到列表头部，滚动锚点由 chat-view 负责保持。
   */
  onLoadMoreHistory = (e: CustomEvent<{ sessionKey: string }>) => {
    const { sessionKey } = e.detail;
    const meta = this.store.getHistoryMeta(sessionKey);

    // 已经是最旧一页，无需继续
    if (meta.page >= meta.totalPages) {
      return;
    }

    const nextPage = meta.page + 1;
    const client = getClient();
    void fetchSessionHistoryRange(client, sessionKey, { page: nextPage, pageSize: 100 })
      .then((result) => {
        // prependMessages 不触发 notify，由下面统一触发
        this.store.prependMessages(sessionKey, result.messages);
        this.store.setHistoryMeta(sessionKey, {
          truncated: result.truncated,
          hasSummary: result.hasSummary,
          page: result.page,
          totalPages: result.totalPages,
          sessionStats: result.sessionStats,
        });
        // setHistoryMeta 内部已调用 notify()，无需再次调用
        console.debug(
          "[mas4s:session] loadMore ← prepended count=%d page=%d/%d",
          result.messages.length,
          result.page,
          result.totalPages,
        );
      })
      .catch((err) => {
        console.warn("[mas4s:session] loadMoreHistory failed:", err);
      });
  };

  onSessionArchive = async (e: CustomEvent<{ sessionKey: string }>) => {
    const { sessionKey } = e.detail;
    const client = getClient();
    try {
      await archiveSession(client, sessionKey);
      // 后端会推送 session.archived 事件，event-handler 会更新 store
    } catch (err) {
      console.error("[mas4s:session] archiveSession failed:", err);
    }
  };

  onSessionUnarchive = async (e: CustomEvent<{ sessionKey: string }>) => {
    const { sessionKey } = e.detail;
    const client = getClient();
    try {
      await unarchiveSession(client, sessionKey);
      // 后端会推送 session.unarchived 事件
    } catch (err) {
      console.error("[mas4s:session] unarchiveSession failed:", err);
    }
  };

  onSessionMembersFetch = async (e: CustomEvent<{ sessionKey: string }>) => {
    const { sessionKey } = e.detail;
    const client = getClient();
    try {
      const members = await listSessionMembers(client, sessionKey);
      this.store.updateSessionParticipants(sessionKey, members);
    } catch (err) {
      console.error("[mas4s:session] listSessionMembers failed:", err);
    }
  };

  onUserInvite = async (e: CustomEvent<{ sessionKey: string; userId: string }>) => {
    const { sessionKey, userId } = e.detail;
    const client = getClient();
    try {
      await inviteUser(client, sessionKey, userId);
      // 邀请成功后刷新成员列表
      const members = await listSessionMembers(client, sessionKey);
      this.store.updateSessionParticipants(sessionKey, members);
    } catch (err) {
      console.error("[mas4s:session] inviteUser failed:", err);
    }
  };

  onMemberRemove = async (e: CustomEvent<{ sessionKey: string; userId: string }>) => {
    const { sessionKey, userId } = e.detail;
    const client = getClient();
    try {
      await removeMember(client, sessionKey, userId);
      // 移除成功后刷新成员列表
      const members = await listSessionMembers(client, sessionKey);
      this.store.updateSessionParticipants(sessionKey, members);
    } catch (err) {
      console.error("[mas4s:session] removeMember failed:", err);
    }
  };
}
