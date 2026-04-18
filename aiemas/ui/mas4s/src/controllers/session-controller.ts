import { fetchTopology } from "../gateway/agents-api.js";
import { getClient } from "../gateway/client.js";
import { restoreSessionRunState } from "../gateway/run-state-recovery.js";
import { archiveSession, unarchiveSession } from "../gateway/session-archive.js";
import { inviteUser, listSessionMembers, removeMember } from "../gateway/session-invite.js";
import {
  createSession,
  deleteSession,
  fetchSessionHistory,
  fetchSessionHistoryRange,
  fetchSessions,
  renameSession,
  updateSessionAgent,
} from "../gateway/session-manager.js";
import type { AppStore, TopologyEdge } from "../store/app-store.js";
import { extractAgentNameFromKey } from "../utils/session-utils.js";

/**
 * 判断消息是否为审批相关消息（需要在根 Agent 主面板中显示）。
 * 包括实时审批（subType=pending）和历史审批（role=approval）。
 */
function isApprovalMessage(msg: { role?: string; subType?: string }): boolean {
  return msg.subType === "pending" || msg.role === "approval";
}

/**
 * 将历史消息按 agentId 路由到 messagesByAgent，
 * 同时将子 Agent 的审批消息也追加到根 Agent 的 messagesByAgent，
 * 确保根 Agent 主面板能显示子 Agent 的审批卡片。
 */
function routeHistoryToAgentMessages(
  store: AppStore,
  uuid: string,
  messages: Array<
    { sessionKey?: string | null; role?: string; subType?: string } & Record<string, unknown>
  >,
  rootAgentId: string,
): void {
  for (const msg of messages) {
    if (msg.sessionKey) {
      const agentId = extractAgentNameFromKey(msg.sessionKey);
      store.appendAgentMessage(
        uuid,
        agentId,
        msg as Parameters<typeof store.appendAgentMessage>[2],
      );
      // 子 Agent 的审批消息也追加到根 Agent 的 messagesByAgent，
      // 确保根 Agent 主面板能显示子 Agent 的审批卡片。
      if (agentId !== rootAgentId && isApprovalMessage(msg)) {
        store.appendAgentMessage(
          uuid,
          rootAgentId,
          msg as Parameters<typeof store.appendAgentMessage>[2],
        );
      }
    }
  }
}

/**
 * 会话管理控制器。
 * 封装 session-create / session-rename / session-select / session-refresh 事件处理，
 * 保持 app.ts 只负责连接、认证和渲染。
 */
export class SessionController {
  constructor(private readonly store: AppStore) {}

  onSessionCreate = async (
    e: CustomEvent<{
      label: string;
      agentId?: string;
      reasoningLevel?: "stream" | "on" | "off";
    }>,
  ) => {
    console.debug(
      "[mas4s:session] create → label=%s agentId=%s reasoningLevel=%s",
      e.detail.label,
      e.detail.agentId,
      e.detail.reasoningLevel,
    );
    const client = getClient();
    try {
      const session = await createSession(client, {
        label: e.detail.label,
        agentId: e.detail.agentId,
        reasoningLevel: e.detail.reasoningLevel,
      });
      // 创建成功后刷新完整会话列表，确保 label 等字段与 gateway 存储一致
      const sessions = await fetchSessions(client);
      this.store.setSessions(sessions);
      // The locally-constructed MasSession lacks sessionUuid; derive the UUID
      // from the key so the store can resolve the active session correctly.
      const uuid = session.key.split(":").pop()!;
      this.store.setActiveSession(uuid);
      this._loadSessionState(session.key, uuid);
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

  onSessionHistoryRefresh = async (e: CustomEvent<{ sessionKey: string }>) => {
    const { sessionKey } = e.detail;
    const uuid = sessionKey.split(":").pop()!;
    // 确保该会话变为活跃状态
    this.store.setActiveSession(uuid);

    // 清除并重新加载
    this.store.clearMessages(uuid);
    const client = getClient();
    try {
      const result = await fetchSessionHistoryRange(client, sessionKey, { page: 1, pageSize: 200 });
      // messagesBySession 仅存储根 Agent 消息（Primary_Panel 数据源），与 _loadSessionState 一致
      const rootAgentId = extractAgentNameFromKey(sessionKey);
      const rootMsgs = result.messages.filter((msg) => {
        if (!msg.sessionKey) {
          return true;
        } // 无 sessionKey 的消息保留（兼容）
        return extractAgentNameFromKey(msg.sessionKey) === rootAgentId;
      });
      this.store.messagesBySession.set(uuid, rootMsgs);
      this.store.setHistoryMeta(uuid, {
        truncated: result.truncated,
        hasSummary: result.hasSummary,
        page: result.page,
        totalPages: result.totalPages,
        sessionStats: result.sessionStats,
      });
      // 将历史消息按 sessionKey 路由到 messagesByAgent（所有 Agent）
      routeHistoryToAgentMessages(this.store, uuid, result.messages, rootAgentId);
      // 历史消息加载后，自动选中第一个有消息的子 Agent Tab（与实时消息路由对齐）
      this._initActiveSubAgentTab(uuid, rootAgentId);
      console.debug(
        "[mas4s:session] history-refresh ← re-loaded: count=%d (root=%d)",
        result.messages.length,
        rootMsgs.length,
      );
      // Restore SOP run state after history is ready
      void restoreSessionRunState(client, this.store, sessionKey, uuid);
    } catch (err) {
      console.error("[mas4s:session] history-refresh failed:", err);
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
      this.store.removeSession(sessionKey.split(":").pop()!);
      console.debug("[mas4s:session] delete ← ok");
    } catch (err) {
      console.error("[mas4s:session] deleteSession failed:", err);
    }
  };

  private _loadSessionState(sessionKey: string, uuid: string) {
    // Always re-fetch history on selection (clear previous cache first)
    this.store.clearMessages(uuid);
    const client = getClient();

    // ── 拓扑获取：决定视图模式 ──
    // 始终从后端重新获取拓扑，确保拓扑变更（增删子 Agent）后 UI 同步更新。
    // 若有缓存则先用缓存渲染（避免闪烁），后端返回后再覆盖。
    const rootAgentId = extractAgentNameFromKey(sessionKey);
    const cachedTopology = this.store.getTopology(rootAgentId);
    if (cachedTopology !== undefined) {
      const mode = cachedTopology.length > 0 ? "multi" : "single";
      this.store.setViewMode(uuid, mode);
    }
    void fetchTopology(client, rootAgentId)
      .then((result) => {
        const edges = (result as { topology?: { edges?: TopologyEdge[] } })?.topology?.edges ?? [];
        this.store.setTopology(rootAgentId, edges);
        this.store.setViewMode(uuid, edges.length > 0 ? "multi" : "single");
      })
      .catch((err) => {
        console.error("[mas4s:session] fetchTopology failed:", err);
        if (cachedTopology === undefined) {
          this.store.setViewMode(uuid, "single");
        }
      });

    void fetchSessionHistoryRange(client, sessionKey, { page: 1, pageSize: 200 })
      .then((result) => {
        // messagesBySession 仅存储根 Agent 消息（Primary_Panel 数据源）
        const rootMsgs = result.messages.filter((msg) => {
          if (!msg.sessionKey) {
            return true;
          } // 无 sessionKey 的消息保留（兼容）
          return extractAgentNameFromKey(msg.sessionKey) === rootAgentId;
        });
        this.store.messagesBySession.set(uuid, rootMsgs);
        this.store.setHistoryMeta(uuid, {
          truncated: result.truncated,
          hasSummary: result.hasSummary,
          page: result.page,
          totalPages: result.totalPages,
          sessionStats: result.sessionStats,
        });
        // 将历史消息按 sessionKey 路由到 messagesByAgent（所有 Agent）
        routeHistoryToAgentMessages(this.store, uuid, result.messages, rootAgentId);
        // 历史消息加载后，自动选中第一个有消息的子 Agent Tab（与实时消息路由对齐）
        this._initActiveSubAgentTab(uuid, rootAgentId);
        console.debug(
          "[mas4s:session] select ← history re-loaded (range): count=%d page=%d/%d",
          result.messages.length,
          result.page,
          result.totalPages,
        );
        // Restore SOP run state after history is ready
        void restoreSessionRunState(client, this.store, sessionKey, uuid);
      })
      .catch((err) => {
        console.warn(
          "[mas4s:session] select ← fetchSessionHistoryRange failed, falling back:",
          err,
        );
        // Fallback to chat.history
        void fetchSessionHistory(client, sessionKey)
          .then((messages) => {
            // messagesBySession 仅存储根 Agent 消息
            const rootMsgs = messages.filter((msg) => {
              if (!msg.sessionKey) {
                return true;
              }
              return extractAgentNameFromKey(msg.sessionKey) === rootAgentId;
            });
            this.store.messagesBySession.set(uuid, rootMsgs);
            this.store.setHistoryMeta(uuid, {
              truncated: false,
              hasSummary: false,
              page: 1,
              totalPages: 1,
              sessionStats: { firstMsgAt: null, lastMsgAt: null, totalMsgCount: 0 },
            });
            // 将历史消息按 sessionKey 路由到 messagesByAgent（所有 Agent）
            routeHistoryToAgentMessages(this.store, uuid, messages, rootAgentId);
            // 历史消息加载后，自动选中第一个有消息的子 Agent Tab（与实时消息路由对齐）
            this._initActiveSubAgentTab(uuid, rootAgentId);
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
  }

  onSessionSelect = (e: CustomEvent<{ sessionKey: string }>) => {
    const { sessionKey } = e.detail;
    const uuid = sessionKey.split(":").pop()!;
    console.debug("[mas4s:session] select → sessionKey=%s (uuid=%s)", sessionKey, uuid);
    this.store.setActiveSession(uuid);
    this._loadSessionState(sessionKey, uuid);
  };

  /**
   * 自动选中第一个会话并加载历史消息。
   * 用于登录后首次连接时自动恢复会话视图。
   */
  autoSelectFirstSession(): void {
    const sessions = this.store.sessions;
    if (sessions.length === 0) {
      return;
    }
    // 按 updatedAt 降序取最新的会话
    const sorted = [...sessions].toSorted((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const first = sorted[0];
    const uuid = first.sessionUuid ?? first.key.split(":").pop()!;
    console.debug("[mas4s:session] autoSelect → sessionKey=%s (uuid=%s)", first.key, uuid);
    this.store.setActiveSession(uuid);
    this._loadSessionState(first.key, uuid);
  }

  /**
   * 历史消息加载后，自动选中第一个有消息的子 Agent 作为活跃 Tab。
   * 与实时消息路由中 handleAgentEvent 的 setActiveSubAgentTab 对齐。
   */
  private _initActiveSubAgentTab(sessionUuid: string, rootAgentId: string): void {
    // 如果已有活跃 tab（例如实时消息已设置过），不覆盖
    if (this.store.activeSubAgentTab.get(sessionUuid)) {
      return;
    }
    const agentMap = this.store.messagesByAgent.get(sessionUuid);
    if (!agentMap) {
      return;
    }
    // 从 messagesByAgent 中找到第一个非 rootAgent 且有消息的 agentId
    for (const [agentId, msgs] of agentMap) {
      if (agentId !== rootAgentId && msgs.length > 0) {
        this.store.setActiveSubAgentTab(sessionUuid, agentId);
        return;
      }
    }
  }

  /**
   * 向上翻页：加载比当前已有消息更早的一页历史。
   * 由 chat-view 在用户滚动到顶部时触发。
   * 策略：后端按 DESC 分页，page=1 是最新一页，page=N 是最旧一页。
   * 当前已加载的是 page=1（最新），向上翻页请求 page=2，依此类推。
   * 新消息前插到列表头部，滚动锚点由 chat-view 负责保持。
   */
  onLoadMoreHistory = (e: CustomEvent<{ sessionKey: string }>) => {
    const { sessionKey } = e.detail;
    const uuid = sessionKey.split(":").pop()!;
    const meta = this.store.getHistoryMeta(uuid);

    // 已经是最旧一页，无需继续
    if (meta.page >= meta.totalPages) {
      return;
    }

    const nextPage = meta.page + 1;
    const rootAgentId = extractAgentNameFromKey(sessionKey);
    const client = getClient();
    void fetchSessionHistoryRange(client, sessionKey, { page: nextPage, pageSize: 200 })
      .then((result) => {
        // messagesBySession 仅前插根 Agent 消息
        const rootMsgs = result.messages.filter((msg) => {
          if (!msg.sessionKey) {
            return true;
          }
          return extractAgentNameFromKey(msg.sessionKey) === rootAgentId;
        });
        // prependMessages 不触发 notify，由下面统一触发
        this.store.prependMessages(uuid, rootMsgs);
        // 将所有历史消息按 agentId 路由到 messagesByAgent
        routeHistoryToAgentMessages(this.store, uuid, result.messages, rootAgentId);
        // 翻页加载后也尝试初始化子 Agent Tab（首次加载可能未触发）
        this._initActiveSubAgentTab(uuid, rootAgentId);
        this.store.setHistoryMeta(uuid, {
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
    const uuid = sessionKey.split(":").pop()!;
    try {
      const members = await listSessionMembers(client, sessionKey);
      this.store.updateSessionParticipants(uuid, members);
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
      const uuid = sessionKey.split(":").pop()!;
      const members = await listSessionMembers(client, sessionKey);
      this.store.updateSessionParticipants(uuid, members);
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
      const uuid = sessionKey.split(":").pop()!;
      const members = await listSessionMembers(client, sessionKey);
      this.store.updateSessionParticipants(uuid, members);
    } catch (err) {
      console.error("[mas4s:session] removeMember failed:", err);
    }
  };

  onSessionAgentUpdate = async (e: CustomEvent<{ sessionKey: string; agentId: string }>) => {
    const { sessionKey, agentId } = e.detail;
    console.debug("[mas4s:session] agent-update → sessionKey=%s agentId=%s", sessionKey, agentId);
    const client = getClient();
    try {
      await updateSessionAgent(client, sessionKey, agentId);
      // 更新成功后刷新会话列表以获取新的 key
      const sessions = await fetchSessions(client);
      this.store.setSessions(sessions);
      // 找到新的 key 并设为活跃
      const uuid = sessionKey.split(":").pop()!;
      const updated = sessions.find((s) => s.sessionUuid === uuid);
      if (updated) {
        this.store.setActiveSession(updated.sessionUuid!);
        // 重要：由于 sessionKey 变更，为了获取最新的 label 等，可选刷新
        // 但由于 UUID 不变，历史消息缓存是稳定的，不需要重新 loadMoreHistory。
      }
      console.debug("[mas4s:session] agent-update ← ok");
    } catch (err) {
      console.error("[mas4s:session] updateSessionAgent failed:", err);
    }
  };
}
