import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { getClient, resetClient } from "./gateway/client.js";
import { registerEventHandlers } from "./gateway/event-handler.js";
import { createSession } from "./gateway/session-manager.js";
import { AppStore, AppStoreController } from "./store/app-store.js";
import { buildGroupMessage, buildChatSendParams } from "./utils/message-format.js";
// 组件注册（副作用导入）
import "./components/primary-sidebar.js";
import "./components/session-sidebar.js";
import "./components/main-workspace.js";
import "./components/invite-dialog.js";
import "./views/login-view.js";

type DialogState = { kind: "none" } | { kind: "invite" };

type NavItem = "workspace" | "usage" | "agents" | "skills" | "cron" | "settings";

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
  @state() private _gatewayUrl = localStorage.getItem("mas4s_ws_url") || "ws://localhost:18789";
  @state() private _gatewayToken = localStorage.getItem("mas4s_ws_token") || "";
  @state() private _connectError = "";
  @state() private _masAuthState: "checking" | "init" | "login" | "authenticated" = "checking";

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
    console.debug("[mas4s:app] _checkSystemStatus → url=%s", this._gatewayUrl);
    try {
      const client = getClient({ url: this._gatewayUrl });
      const res = await client.request("system.status");
      console.debug("[mas4s:app] _checkSystemStatus ← system.status res=%o", res);
      if (!res.initialized) {
        this._masAuthState = "init";
      } else if (localStorage.getItem("mas4s_auth_token")) {
        this._masAuthState = "authenticated";
        this._doConnect();
      } else {
        this._masAuthState = "login";
      }
      console.debug("[mas4s:app] _checkSystemStatus ← masAuthState=%s", this._masAuthState);
    } catch (err) {
      console.warn("[mas4s:app] _checkSystemStatus ← error, falling back to login:", err);
      this._masAuthState = "login";
    }
  }

  private _doConnect = () => {
    console.debug("[mas4s:app] _doConnect → url=%s", this._gatewayUrl);
    this._connectError = "";
    localStorage.setItem("mas4s_ws_url", this._gatewayUrl);
    localStorage.setItem("mas4s_ws_token", this._gatewayToken);

    resetClient();
    getClient({
      url: this._gatewayUrl,
      token: this._gatewayToken || undefined,
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
    console.debug("[mas4s:app] _onLoginSuccess ← done");
  };

  private _onLogout = () => {
    console.debug("[mas4s:app] _onLogout → clearing session state");
    AppStore.instance.logout();
    resetClient();
    this._connected = false;
    this._masAuthState = "login";
    console.debug("[mas4s:app] _onLogout ← masAuthState=login");
  };

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

  private _renderLoginGate() {
    return html`
      <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;background:#f8fafc;">
        <h2 style="margin-bottom:24px;color:#0f172a;">OpenClaw 网关仅仪表盘</h2>
        <div style="display:flex;flex-direction:column;gap:16px;width:340px;background:white;padding:24px;border-radius:8px;box-shadow:0 4px 6px -1px rgb(0 0 0 / 0.1);">
          <label style="display:flex;flex-direction:column;gap:6px;font-size:14px;color:#475569;">
            WebSocket URL
            <input
              type="text"
              .value=${this._gatewayUrl}
              @input=${(e: Event) => (this._gatewayUrl = (e.target as HTMLInputElement).value)}
              style="padding:10px;border:1px solid #e2e8f0;border-radius:6px;font-size:14px;outline:none;"
            />
          </label>
          <label style="display:flex;flex-direction:column;gap:6px;font-size:14px;color:#475569;">
            网关令牌
            <input
              type="password"
              .value=${this._gatewayToken}
              @input=${(e: Event) => (this._gatewayToken = (e.target as HTMLInputElement).value)}
              @keydown=${(e: KeyboardEvent) => e.key === "Enter" && this._doConnect()}
              placeholder="OPENCLAW_GATEWAY_TOKEN (可选)"
              style="padding:10px;border:1px solid #e2e8f0;border-radius:6px;font-size:14px;outline:none;"
            />
          </label>
          <button
            @click=${this._doConnect}
            style="margin-top:8px;padding:10px;background:#dc2626;color:white;border:none;border-radius:6px;cursor:pointer;font-weight:500;font-size:15px;"
          >连 接</button>
          ${this._connectError ? html`<div style="color:#dc2626;font-size:13px;margin-top:8px;padding:8px;background:#fef2f2;border:1px solid #fecaca;border-radius:4px;">${this._connectError}</div>` : ""}
        </div>
      </div>
    `;
  }

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
      return html`<mas4s-login-view mode="init" @login-success=${this._onLoginSuccess}></mas4s-login-view>`;
    }

    if (this._masAuthState === "login") {
      return html`<mas4s-login-view mode="login" @login-success=${this._onLoginSuccess}></mas4s-login-view>`;
    }

    if (!this._connected) {
      return this._renderLoginGate();
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
            ></session-sidebar>
          `
          : ""
      }

      <div class="workspace-wrap">
        <div style="display:flex;justify-content:flex-end;padding:6px 12px;background:#fff;border-bottom:1px solid #e2e8f0;">
          <button
            @click=${this._onLogout}
            style="padding:5px 12px;background:transparent;border:1px solid #e2e8f0;border-radius:6px;cursor:pointer;font-size:13px;color:#64748b;"
          >退出登录</button>
        </div>
        <main-workspace
          .activeNav=${this._activeNav}
          .session=${store.activeSession ?? null}
          .messages=${store.activeSessionId ? (store.messagesBySession.get(store.activeSessionId) ?? []) : []}
          .pendingApprovals=${store.pendingApprovals}
          @send-message=${this._onSendMessage}
          @resolve-approval=${this._onResolveApproval}
          @invite-open=${this._onInviteOpen}
        ></main-workspace>
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
