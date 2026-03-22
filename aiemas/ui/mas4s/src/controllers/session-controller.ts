import { getClient } from "../gateway/client.js";
import { createSession, renameSession } from "../gateway/session-manager.js";
import type { AppStore } from "../store/app-store.js";

/**
 * 会话管理控制器。
 * 封装 session-create / session-rename / session-select 事件处理，
 * 保持 app.ts 只负责连接、认证和渲染。
 */
export class SessionController {
  constructor(private readonly store: AppStore) {}

  onSessionCreate = async (e: CustomEvent<{ label: string }>) => {
    console.debug("[mas4s:session] create → label=%s", e.detail.label);
    const client = getClient();
    try {
      const session = await createSession(client, { label: e.detail.label });
      this.store.addSession(session);
      this.store.setActiveSession(session.key);
      console.debug("[mas4s:session] create ← key=%s", session.key);
    } catch (err) {
      console.error("[mas4s:session] createSession failed:", err);
    }
  };

  onSessionRename = async (e: CustomEvent<{ sessionKey: string; label: string }>) => {
    const { sessionKey, label } = e.detail;
    console.debug("[mas4s:session] rename → sessionKey=%s label=%s", sessionKey, label);
    const client = getClient();
    try {
      await renameSession(client, sessionKey, label);
      this.store.updateSessionLabel(sessionKey, label);
      console.debug("[mas4s:session] rename ← ok");
    } catch (err) {
      console.error("[mas4s:session] renameSession failed:", err);
    }
  };

  onSessionSelect = (e: CustomEvent<{ sessionKey: string }>) => {
    console.debug("[mas4s:session] select → sessionKey=%s", e.detail.sessionKey);
    this.store.setActiveSession(e.detail.sessionKey);
  };
}
