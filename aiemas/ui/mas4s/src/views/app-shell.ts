import { html, type TemplateResult } from "lit";
import type { NavItem, DialogKind } from "../controllers/ui-state-controller.js";
import { getClient } from "../gateway/client.js";
import type { AppStore } from "../store/app-store.js";
import { extractAgentNameFromKey } from "../utils/session-utils.js";
import "./clawhub-view.js";
import "./setttings.js";

export interface AppShellHandlers {
  onLoginSuccess: () => void;
  onGatewayConnect: (e: Event) => void;
  onLogout: () => void;
  onNavChange: (e: CustomEvent<{ nav: NavItem }>) => void;
  onSessionSelect: (e: CustomEvent<{ sessionKey: string }>) => void;
  onSessionCreate: (
    e: CustomEvent<{ label: string; agentId?: string; reasoningLevel?: "stream" | "on" | "off" }>,
  ) => void;
  onSessionRename: (e: CustomEvent<{ sessionKey: string; label: string }>) => void;
  onSessionDelete: (e: CustomEvent<{ sessionKey: string }>) => void;
  onSessionRefresh: (e: Event) => void;
  onSessionHistoryRefresh: (e: CustomEvent<{ sessionKey: string }>) => void;
  onSessionArchive: (e: CustomEvent<{ sessionKey: string }>) => void;
  onSessionUnarchive: (e: CustomEvent<{ sessionKey: string }>) => void;
  onSessionMembersFetch: (e: CustomEvent<{ sessionKey: string }>) => void;
  onUserInvite: (e: CustomEvent<{ sessionKey: string; userId: string }>) => void;
  onMemberRemove: (e: CustomEvent<{ sessionKey: string; userId: string }>) => void;
  onSessionAgentUpdate: (e: CustomEvent<{ sessionKey: string; agentId: string }>) => void;
  onSendMessage: (e: CustomEvent<{ text: string }>) => void;
  onAbortChat: () => void;
  onResolveApproval: (e: CustomEvent<{ id: string; decision: string }>) => void;
  onInviteOpen: () => void;
  onDialogClose: () => void;
  onLoadMoreHistory: (e: CustomEvent<{ sessionKey: string }>) => void;
  onTabChange: (e: CustomEvent<{ agentId: string }>) => void;
  onDrawerSendMessage: (e: CustomEvent<{ agentId: string; text: string }>) => void;
}

/** 检查中占位 */
export function renderChecking(): TemplateResult {
  return html`
    <div
      style="
        display: flex;
        align-items: center;
        justify-content: center;
        width: 100%;
        height: 100vh;
        background: #f8fafc;
        color: #64748b;
        font-size: 15px;
      "
    >
      正在检查系统状态…
    </div>
  `;
}

/** 登录 / 初始化视图 */
export function renderLogin(
  mode: "init" | "login",
  connectError: string,
  h: Pick<AppShellHandlers, "onLoginSuccess" | "onGatewayConnect">,
): TemplateResult {
  return html`
    <mas4s-login-view
      mode=${mode}
      .connectError=${connectError}
      @login-success=${h.onLoginSuccess}
      @gateway-connect=${h.onGatewayConnect}
    ></mas4s-login-view>
  `;
}

/** 主应用布局 */
export function renderMain(
  store: AppStore,
  activeNav: NavItem,
  dialog: DialogKind,
  h: AppShellHandlers,
): TemplateResult {
  return html`
    <primary-sidebar
      .activeNav=${activeNav}
      @nav-change=${h.onNavChange}
      @logout=${h.onLogout}
    ></primary-sidebar>

    ${activeNav === "workspace"
      ? html`
          <session-sidebar
            .sessions=${store.sessions}
            .agents=${store.agents}
            .activeSessionKey=${store.activeSessionKey ?? ""}
            @session-select=${h.onSessionSelect}
            @session-create=${h.onSessionCreate}
            @session-rename=${h.onSessionRename}
            @session-delete=${h.onSessionDelete}
            @session-refresh=${h.onSessionRefresh}
            @session-history-refresh=${h.onSessionHistoryRefresh}
          ></session-sidebar>
        `
      : ""}

    <div style="flex:1;min-width:0;display:flex;flex-direction:column;">
      <!-- 内容区 -->
      ${activeNav === "users"
        ? html` <user-list-view style="flex: 1; overflow: hidden"></user-list-view> `
        : activeNav === "discussions"
          ? html` <discussion-panel style="flex: 1; overflow: hidden"></discussion-panel> `
          : activeNav === "clawhub"
            ? html` <clawhub-view style="flex: 1; overflow: hidden"></clawhub-view> `
            : activeNav === "settings"
              ? html`
                  <settings-view
                    style="flex: 1; overflow: hidden"
                    .client=${getClient()}
                    .role=${store.currentUser?.role ?? "viewer"}
                    .localAgents=${store.agents}
                  ></settings-view>
                `
              : html`
                  <main-workspace
                    .activeNav=${activeNav}
                    .session=${store.activeSession ?? null}
                    .messages=${(() => {
                      if (!store.activeSessionUuid || !store.activeSession) {
                        return [];
                      }
                      const rootAgentId = extractAgentNameFromKey(store.activeSession.key);
                      const agentMsgs = store.getAgentMessages(
                        store.activeSessionUuid,
                        rootAgentId,
                      );
                      // 优先使用 messagesByAgent 中的根 Agent 消息；
                      // 若为空则回退到 messagesBySession（兼容尚未路由的场景）
                      return agentMsgs.length > 0
                        ? agentMsgs
                        : (store.messagesBySession.get(store.activeSessionUuid) ?? []);
                    })()}
                    .pendingApprovals=${store.pendingApprovals}
                    .resolvedApprovals=${store.resolvedApprovals}
                    .isChatting=${store.activeSessionUuid
                      ? (store.isChattingBySession.get(store.activeSessionUuid) ?? false)
                      : false}
                    .hasSummary=${store.activeSessionUuid
                      ? store.getHistoryMeta(store.activeSessionUuid).hasSummary
                      : false}
                    .truncated=${store.activeSessionUuid
                      ? store.getHistoryMeta(store.activeSessionUuid).truncated
                      : false}
                    .hasMoreHistory=${(() => {
                      if (!store.activeSessionUuid) {
                        return false;
                      }
                      const meta = store.getHistoryMeta(store.activeSessionUuid);
                      // Use page < totalPages as the authoritative signal.
                      // totalMsgCount cannot be compared against loaded message count because
                      // splitHistoryMessage expands one raw message into multiple render bubbles,
                      // causing loaded > totalMsgCount even when earlier pages still exist.
                      return meta.page < meta.totalPages;
                    })()}
                    .sopSteps=${store.activeSessionUuid
                      ? (store.sopStepsBySession.get(store.activeSessionUuid)?.steps ?? [])
                      : []}
                    .sopLabel=${store.activeSessionUuid
                      ? (store.sopStepsBySession.get(store.activeSessionUuid)?.sopLabel ?? "")
                      : ""}
                    .sopIcon=${store.activeSessionUuid
                      ? (store.sopStepsBySession.get(store.activeSessionUuid)?.sopIcon ?? "")
                      : ""}
                    .activeProgress=${store.activeSessionUuid
                      ? (store.activeProgressBySession.get(store.activeSessionUuid) ?? null)
                      : null}
                    .progressLogs=${store.activeSessionUuid
                      ? (store.progressLogsBySession.get(store.activeSessionUuid) ?? [])
                      : []}
                    .currentStepIndex=${store.activeSessionUuid
                      ? (store.sopStepsBySession.get(store.activeSessionUuid)?.currentStepIndex ??
                        -1)
                      : -1}
                    .sopCompletedAt=${store.activeSessionUuid
                      ? store.sopStepsBySession.get(store.activeSessionUuid)?.completedAt
                      : undefined}
                    .viewMode=${store.activeSessionUuid
                      ? store.getViewMode(store.activeSessionUuid)
                      : "single"}
                    .subAgentMessages=${store.activeSessionUuid
                      ? store.getSubAgentMessages(store.activeSessionUuid)
                      : new Map()}
                    .subAgents=${store.activeSessionUuid
                      ? store.getSubAgentList(store.activeSessionUuid)
                      : []}
                    .agents=${store.agents}
                    .activeSubAgentTab=${store.activeSessionUuid
                      ? (store.activeSubAgentTab.get(store.activeSessionUuid) ?? "")
                      : ""}
                    .unreadAgents=${store.activeSessionUuid
                      ? (store.unreadByAgent.get(store.activeSessionUuid) ?? new Set())
                      : new Set()}
                    .activeAgents=${store.activeSessionUuid
                      ? (store.activeAgentsBySession.get(store.activeSessionUuid) ?? new Set())
                      : new Set()}
                    .completedAgents=${store.activeSessionUuid
                      ? (store.completedAgentsBySession.get(store.activeSessionUuid) ?? new Set())
                      : new Set()}
                    @send-message=${h.onSendMessage}
                    @abort-chat=${h.onAbortChat}
                    @resolve-approval=${h.onResolveApproval}
                    @invite-open=${h.onInviteOpen}
                    @session-archive=${h.onSessionArchive}
                    @session-unarchive=${h.onSessionUnarchive}
                    @session-agent-update=${h.onSessionAgentUpdate}
                    @load-more-history=${h.onLoadMoreHistory}
                    @tab-change=${h.onTabChange}
                    @drawer-send-message=${h.onDrawerSendMessage}
                  ></main-workspace>
                `}
    </div>

    <!-- 弹窗 -->
    ${dialog === "invite" && store.activeSession
      ? html`
          <invite-dialog
            .session=${store.activeSession}
            @close=${h.onDialogClose}
            @members-fetch=${h.onSessionMembersFetch}
            @user-invite=${h.onUserInvite}
            @member-remove=${h.onMemberRemove}
          ></invite-dialog>
        `
      : ""}
  `;
}
