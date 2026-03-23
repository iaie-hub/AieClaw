import { getClient } from "../gateway/client.js";
import {
  createSession,
  deleteSession,
  fetchSessionHistory,
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

    // 若该会话尚无缓存消息，则通过 WebSocket chat.history 拉取历史
    if (!this.store.messagesBySession.has(sessionKey)) {
      const client = getClient();
      void fetchSessionHistory(client, sessionKey)
        .then((messages) => {
          if (!this.store.messagesBySession.has(sessionKey)) {
            this.store.messagesBySession.set(sessionKey, messages);
            this.store.notify();
          }
          console.debug("[mas4s:session] select ← history loaded: count=%d", messages.length);
        })
        .catch((err) => {
          console.warn("[mas4s:session] select ← fetchSessionHistory failed:", err);
        });
    }
  };
}
