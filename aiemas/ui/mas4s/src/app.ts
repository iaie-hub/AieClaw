import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { getClient, resetClient } from "./gateway/client.js";
import { registerEventHandlers } from "./gateway/event-handler.js";
import { createSession, renameSession } from "./gateway/session-manager.js";
import { AppStore, AppStoreController } from "./store/app-store.js";
import { buildGroupMessage, buildChatSendParams } from "./utils/message-format.js";
// 组件注册（副作用导入）
import "./components/primary-sidebar.js";
import "./components/session-sidebar.js";
import "./components/main-workspace.js";
import "./components/invite-dialog.js";
import "./views/login-view.js";
import "./views/user-list-view.js";

type DialogState = { kind: "none" } | { kind: "invite" };

type NavItem = "workspace" | "usage" | "agents" | "skills" | "cron" | "users" | "settings";

/**
 * mas4s 根组件。三栏布局：primary-sidebar + session-sidebar + main-workspace。
 * 负责 gateway 初始化、事件路由、弹窗状态管理。
 */
@customElement("mas4s-app")
export class Mas4sApp extends LitElement {
  private _ctrl = new AppStoreController(this);

  @state() private _activeNav: NavItem = "workspace";
  @state() private _dialog: DialogState = { kind: "none" };
  @state() private _connected = false;
  @state() private _connectError = "";
  @state() private _masAuthState: "checking" | "init" | "login" | "authenticated" = "checking";

  /** Token refresh timer handle (5-minute interval) */
  private _refreshTimer: ReturnType<typeof setInterval> | null = null;

  static styles = css`
    :host {
      display: flex;
      height: 100vh;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f8fafc;
    }

    .workspace-wrap {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }
  `;

  connectedCallback() {
    console.debug(
      "[mas4s:app] connectedCallback → registering event handlers, checking system status",
    );
    super.connectedCallback();
    registerEventHandlers();
    void this._checkSystemStatus();
  }

  private async _checkSystemStatus() {
    const url = localStorage.getItem("mas4s_ws_url") || "ws://localhost:18789";
    const token = localStorage.getItem("mas4s_ws_token") || undefined;
    console.debug("[mas4s:app] _checkSystemStatus → url=%s", url);
    try {
      const client = getClient({ url, token });
      await client.waitConnected();
      const res = await client.request<{ initialized: boolean }>("system.status");
      console.debug("[mas4s:app] _checkSystemStatus ← system.status res=%o", res);
      if (!res.initialized) {
        this._masAuthState = "init";
        resetClient(); // close the status-check connection; no WS needed until login
      } else if (localStorage.getItem("mas4s_auth_token")) {
        this._masAuthState = "authenticated";
        this._doConnect();
        this._startRefreshTimer();
      } else {
        this._masAuthState = "login";
        resetClient(); // close the status-check connection; no WS needed until login
      }
      console.debug("[mas4s:app] _checkSystemStatus ← masAuthState=%s", this._masAuthState);
    } catch (err) {
      console.warn("[mas4s:app] _checkSystemStatus ← error, falling back to login:", err);
      this._connectError = err instanceof Error ? err.message : String(err);
      this._masAuthState = "login";
      resetClient();
    }
  }

  private _doConnect = () => {
    const url = localStorage.getItem("mas4s_ws_url") || "ws://localhost:18789";
    const token = localStorage.getItem("mas4s_ws_token") || undefined;
    console.debug("[mas4s:app] _doConnect → url=%s", url);
    this._connectError = "";

    // Append masToken as URL query param so the gateway bridge can extract it
    // from the HTTP upgrade request (auth.masToken in connect frame is not used).
    const masAuthToken = localStorage.getItem("mas4s_auth_token");
    let wsUrl = url;
    if (masAuthToken) {
      const sep = wsUrl.includes("?") ? "&" : "?";
      wsUrl = `${wsUrl}${sep}masToken=${encodeURIComponent(masAuthToken)}`;
    }

    resetClient();
    getClient({
      url: wsUrl,
      token,
      onHello: () => {
        console.debug("[mas4s:app] _doConnect ← onHello: connected=true");
        this._connected = true;
      },
      onClose: (info) => {
        console.debug(
          "[mas4s:app] _doConnect ← onClose: code=%s reason=%s",
          info.code,
          info.reason,
        );
        const wasConnected = this._connected;
        this._connected = false;

        if (
          info.reason &&
          (info.reason.includes("TOKEN_EXPIRED") || info.reason.includes("MAS_AUTH_FAILED"))
        ) {
          console.warn(
            "[mas4s:app] _doConnect ← auth error (%s), redirecting to login",
            info.reason,
          );
          this._stopRefreshTimer();
          localStorage.removeItem("mas4s_auth_token");
          this._masAuthState = "login";
          resetClient();
          return;
        }

        this._connectError = `连接断开 (${info.code}): ${info.reason || "目标地址拒绝连接或无效"}`;
        if (!wasConnected) {
          resetClient();
        }
      },
    });
    console.debug("[mas4s:app] _doConnect → client created, awaiting hello");
  };

  private _onLoginSuccess = () => {
    console.debug("[mas4s:app] _onLoginSuccess → masAuthState=authenticated, initiating connect");
    this._masAuthState = "authenticated";
    this._doConnect();
    this._startRefreshTimer();
    console.debug("[mas4s:app] _onLoginSuccess ← done");
  };

  private _onLogout = () => {
    console.debug("[mas4s:app] _onLogout → clearing session state");
    this._stopRefreshTimer();
    // Notify backend to mark user offline BEFORE closing the connection
    try {
      const client = getClient();
      void client.request("user.logout", {}).catch((err) => {
        console.warn("[mas4s:app] _onLogout ← user.logout request failed:", err);
      });
    } catch {
      // client may already be disconnected
    }
    AppStore.instance.logout();
    // Small delay to let the logout request fly before closing the socket
    setTimeout(() => resetClient(), 100);
    this._connected = false;
    this._masAuthState = "login";
    console.debug("[mas4s:app] _onLogout ← masAuthState=login");
  };

  /** Start 5-minute auto token refresh to maintain online presence */
  private _startRefreshTimer() {
    this._stopRefreshTimer();
    this._refreshTimer = setInterval(
      async () => {
        try {
          const client = getClient();
          const token = localStorage.getItem("mas4s_auth_token");
          if (!token) {
            return;
          }
          const res = await client.request<{ ok: boolean; token?: string }>("auth.refresh", {
            token,
          });
          if (res.ok && res.token) {
            localStorage.setItem("mas4s_auth_token", res.token);
          }
        } catch (err) {
          console.warn("[mas4s:app] auto-refresh failed:", err);
        }
      },
      5 * 60 * 1000,
    ); // 5 minutes
  }

  /** Stop the auto-refresh timer */
  private _stopRefreshTimer() {
    if (this._refreshTimer !== null) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
  }

  // ── 会话操作 ──────────────────────────────────────

  private _onSessionCreate = async (e: CustomEvent<{ label: string }>) => {
    console.debug("[mas4s:app] _onSessionCreate → label=%s", e.detail.label);
    const client = getClient();
    try {
      const session = await createSession(client, { label: e.detail.label });
      console.debug("[mas4s:app] _onSessionCreate ← session created: key=%s", session.key);
      this._ctrl.store.addSession(session);
      this._ctrl.store.setActiveSession(session.key);
    } catch (err) {
      console.error("[mas4s] createSession failed:", err);
    }
  };

  private _onSessionRename = async (e: CustomEvent<{ sessionKey: string; label: string }>) => {
    const { sessionKey, label } = e.detail;
    console.debug("[mas4s:app] _onSessionRename → sessionKey=%s label=%s", sessionKey, label);
    const client = getClient();
    try {
      await renameSession(client, sessionKey, label);
      this._ctrl.store.updateSessionLabel(sessionKey, label);
      console.debug("[mas4s:app] _onSessionRename ← ok");
    } catch (err) {
      console.error("[mas4s] renameSession failed:", err);
    }
  };

  private _onSessionSelect = (e: CustomEvent<{ sessionKey: string }>) => {
    console.debug("[mas4s:app] _onSessionSelect → sessionKey=%s", e.detail.sessionKey);
    this._ctrl.store.setActiveSession(e.detail.sessionKey);
    console.debug("[mas4s:app] _onSessionSelect ← activeSession set");
  };

  private _onNavChange = (e: CustomEvent<{ nav: NavItem }>) => {
    console.debug("[mas4s:app] _onNavChange → nav=%s", e.detail.nav);
    this._activeNav = e.detail.nav;
    console.debug("[mas4s:app] _onNavChange ← activeNav=%s", this._activeNav);
  };

  // ── 消息发送 ──────────────────────────────────────

  private _onSendMessage = async (e: CustomEvent<{ text: string }>) => {
    const store = this._ctrl.store;
    const session = store.activeSession;
    console.debug(
      "[mas4s:app] _onSendMessage → sessionKey=%s text.length=%d",
      session?.key,
      e.detail.text.length,
    );
    if (!session) {
      console.warn("[mas4s:app] _onSendMessage ← no active session, aborting");
      return;
    }

    const client = getClient();
    const displayName = this._ctrl.store.currentUser?.displayName ?? "我";
    const message = buildGroupMessage(displayName, e.detail.text);
    try {
      await client.request("chat.send", buildChatSendParams({ sessionKey: session.key, message }));
      console.debug("[mas4s:app] _onSendMessage ← chat.send ok");
    } catch (err) {
      console.error("[mas4s] chat.send failed:", err);
    }
  };

  // ── 审批操作 ──────────────────────────────────────

  private _onResolveApproval = async (e: CustomEvent<{ id: string; decision: string }>) => {
    console.debug(
      "[mas4s:app] _onResolveApproval → id=%s decision=%s",
      e.detail.id,
      e.detail.decision,
    );
    const client = getClient();
    try {
      await client.request("exec.approval.resolve", {
        id: e.detail.id,
        decision: e.detail.decision,
      });
      console.debug("[mas4s:app] _onResolveApproval ← exec.approval.resolve ok");
    } catch (err) {
      console.error("[mas4s] exec.approval.resolve failed:", err);
    }
  };

  // ── 邀请弹窗 ──────────────────────────────────────

  private _onInviteOpen = () => {
    console.debug("[mas4s:app] _onInviteOpen → opening invite dialog");
    this._dialog = { kind: "invite" };
    console.debug("[mas4s:app] _onInviteOpen ← dialog=invite");
  };

  private _onDialogClose = () => {
    console.debug("[mas4s:app] _onDialogClose → closing dialog");
    this._dialog = { kind: "none" };
    console.debug("[mas4s:app] _onDialogClose ← dialog=none");
  };

  // ── 渲染 ──────────────────────────────────────────

  /**
   * login-view 网关配置区测试连接成功后派发此事件，携带 initialized 状态。
   * 直接跳到对应状态，无需重复调用 _checkSystemStatus。
   */
  private _onGatewayConnect = (e: Event) => {
    const { initialized } = (e as CustomEvent<{ initialized: boolean }>).detail;
    this._connectError = "";
    if (!initialized) {
      this._masAuthState = "init";
    } else if (localStorage.getItem("mas4s_auth_token")) {
      this._masAuthState = "authenticated";
      this._doConnect();
    } else {
      this._masAuthState = "login";
    }
  };

  private _renderDialog() {
    const store = this._ctrl.store;
    const d = this._dialog;

    if (d.kind === "invite" && store.activeSession) {
      return html`
        <invite-dialog
          .session=${store.activeSession}
          @close=${this._onDialogClose}
        ></invite-dialog>
      `;
    }

    return html``;
  }

  render() {
    if (this._masAuthState === "checking") {
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

    if (this._masAuthState === "init") {
      return html`<mas4s-login-view mode="init" .connectError=${this._connectError} @login-success=${this._onLoginSuccess} @gateway-connect=${this._onGatewayConnect}></mas4s-login-view>`;
    }

    if (this._masAuthState === "login") {
      return html`<mas4s-login-view mode="login" .connectError=${this._connectError} @login-success=${this._onLoginSuccess} @gateway-connect=${this._onGatewayConnect}></mas4s-login-view>`;
    }

    if (!this._connected) {
      return html`<mas4s-login-view mode="login" .connectError=${this._connectError} @login-success=${this._onLoginSuccess} @gateway-connect=${this._onGatewayConnect}></mas4s-login-view>`;
    }

    const store = this._ctrl.store;
    return html`
      <primary-sidebar
        .activeNav=${this._activeNav}
        @nav-change=${this._onNavChange}
      ></primary-sidebar>

      ${
        this._activeNav === "workspace"
          ? html`
            <session-sidebar
              .sessions=${store.sessions}
              .activeSessionKey=${store.activeSessionId ?? ""}
              @session-select=${this._onSessionSelect}
              @session-create=${this._onSessionCreate}
              @session-rename=${this._onSessionRename}
            ></session-sidebar>
          `
          : ""
      }

      <div class="workspace-wrap">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:6px 12px;background:#fff;border-bottom:1px solid #e2e8f0;">
          <span style="font-size:13px;color:#94a3b8;padding-left:4px;">
            ${store.currentUser ? `${store.currentUser.displayName} · ${{ admin: "管理员", member: "成员", viewer: "观察者" }[store.currentUser.role] ?? store.currentUser.role}` : ""}
          </span>
          <button
            @click=${this._onLogout}
            style="padding:5px 12px;background:transparent;border:1px solid #e2e8f0;border-radius:6px;cursor:pointer;font-size:13px;color:#64748b;"
          >退出登录</button>
        </div>
        ${
          this._activeNav === "users"
            ? html`
                <user-list-view style="flex: 1; overflow: hidden"></user-list-view>
              `
            : html`
              <main-workspace
                .activeNav=${this._activeNav}
                .session=${store.activeSession ?? null}
                .messages=${store.activeSessionId ? (store.messagesBySession.get(store.activeSessionId) ?? []) : []}
                .pendingApprovals=${store.pendingApprovals}
                @send-message=${this._onSendMessage}
                @resolve-approval=${this._onResolveApproval}
                @invite-open=${this._onInviteOpen}
              ></main-workspace>
            `
        }
      </div>

      ${this._renderDialog()}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "mas4s-app": Mas4sApp;
  }
}
