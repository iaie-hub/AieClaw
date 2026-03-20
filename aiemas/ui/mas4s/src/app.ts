import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { getClient, resetClient } from "./gateway/client.js";
import { registerEventHandlers } from "./gateway/event-handler.js";
import { joinSessionFromInvite, parseInviteFromUrl } from "./gateway/session-invite.js";
import { createSession } from "./gateway/session-manager.js";
import { AppStoreController } from "./store/app-store.js";
import type { MasSession } from "./types/session-types.js";
import { buildGroupMessage, buildChatSendParams } from "./utils/message-format.js";
// 组件注册（副作用导入）
import "./components/primary-sidebar.js";
import "./components/session-sidebar.js";
import "./components/main-workspace.js";
import "./components/invite-dialog.js";
import "./components/join-session-dialog.js";
import "./components/join-confirm-dialog.js";

type DialogState =
  | { kind: "none" }
  | { kind: "invite" }
  | { kind: "join-input" }
  | {
      kind: "join-confirm";
      sessionKey: string;
      session: MasSession | null;
      loading: boolean;
      error: string;
    };

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

  static styles = css`
    :host {
      display: flex;
      height: 100vh;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f8fafc;
    }

    .session-sidebar-wrap {
      display: contents;
    }

    .workspace-wrap {
      flex: 1;
      min-width: 0;
      display: flex;
      flex-direction: column;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    registerEventHandlers();

    if (this._gatewayUrl) {
      this._doConnect();
    }

    // 检测 URL 中的 ?join= 参数
    const inviteKey = parseInviteFromUrl();
    if (inviteKey) {
      void this._startJoinConfirm(inviteKey);
    }
  }

  private _doConnect = () => {
    this._connectError = "";
    localStorage.setItem("mas4s_ws_url", this._gatewayUrl);
    // Don't save empty string to local storage if user inputs space or clears it, wait, it's fine.
    localStorage.setItem("mas4s_ws_token", this._gatewayToken);

    resetClient();
    getClient({
      url: this._gatewayUrl,
      token: this._gatewayToken || undefined,
      onHello: () => {
        this._connected = true;
      },
      onClose: (info) => {
        const wasConnected = this._connected;
        this._connected = false;
        this._connectError = `连接断开 (${info.code}): ${info.reason || "目标地址拒绝连接或无效"}`;

        // 如果从未建立过成功连接（即刚点连接就遭遇了底层的 Transport Failed 或者无效地址断开），
        // 那么就直接销毁当前 client，停止背后的无限退避重试，让用户在界面上手动重新发起。
        if (!wasConnected) {
          resetClient();
        }
      },
    });
  };

  // ── 会话操作 ──────────────────────────────────────

  private _onSessionCreate = async (e: CustomEvent<{ label: string }>) => {
    const client = getClient();
    try {
      const session = await createSession(client, { label: e.detail.label });
      this._ctrl.store.addSession(session);
      this._ctrl.store.setActiveSession(session.key);
    } catch (err) {
      console.error("[mas4s] createSession failed:", err);
    }
  };

  private _onSessionJoinInput = () => {
    this._dialog = { kind: "join-input" };
  };

  private _onJoinFromInput = async (e: CustomEvent<{ sessionKey: string }>) => {
    const { sessionKey } = e.detail;
    this._dialog = { kind: "none" };
    await this._doJoin(sessionKey);
  };

  private async _startJoinConfirm(sessionKey: string) {
    this._dialog = { kind: "join-confirm", sessionKey, session: null, loading: true, error: "" };
    // 预加载会话信息
    try {
      const client = getClient();
      const session = await joinSessionFromInvite(client, sessionKey);
      this._dialog = { kind: "join-confirm", sessionKey, session, loading: false, error: "" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "获取会话信息失败";
      this._dialog = {
        kind: "join-confirm",
        sessionKey,
        session: null,
        loading: false,
        error: msg,
      };
    }
  }

  private _onJoinConfirm = async (e: CustomEvent<{ sessionKey: string }>) => {
    const { sessionKey } = e.detail;
    this._dialog = { kind: "none" };
    // 清除 URL 中的 ?join= 参数，避免刷新后重复弹窗
    const url = new URL(window.location.href);
    url.searchParams.delete("join");
    window.history.replaceState(null, "", url.toString());
    await this._doJoin(sessionKey);
  };

  private async _doJoin(sessionKey: string) {
    const client = getClient();
    try {
      const session = await joinSessionFromInvite(client, sessionKey);
      this._ctrl.store.addSession(session);
      this._ctrl.store.setActiveSession(session.key);
    } catch (err) {
      console.error("[mas4s] joinSession failed:", err);
    }
  }

  private _onSessionSelect = (e: CustomEvent<{ sessionKey: string }>) => {
    this._ctrl.store.setActiveSession(e.detail.sessionKey);
  };

  private _onNavChange = (e: CustomEvent<{ nav: NavItem }>) => {
    this._activeNav = e.detail.nav;
  };

  // ── 消息发送 ──────────────────────────────────────

  private _onSendMessage = async (e: CustomEvent<{ text: string }>) => {
    const store = this._ctrl.store;
    const session = store.activeSession;
    if (!session) {
      return;
    }

    const client = getClient();
    // 用户名暂用 "我"，第二期接入身份信息
    const message = buildGroupMessage("我", e.detail.text);
    try {
      await client.request(
        "chat.send",
        buildChatSendParams({
          sessionKey: session.key,
          message,
        }),
      );
    } catch (err) {
      console.error("[mas4s] chat.send failed:", err);
    }
  };

  // ── 审批操作 ──────────────────────────────────────

  private _onResolveApproval = async (e: CustomEvent<{ id: string; decision: string }>) => {
    const client = getClient();
    try {
      await client.request("exec.approval.resolve", {
        id: e.detail.id,
        decision: e.detail.decision,
      });
    } catch (err) {
      console.error("[mas4s] exec.approval.resolve failed:", err);
    }
  };

  // ── 邀请弹窗 ──────────────────────────────────────

  private _onInviteOpen = () => {
    this._dialog = { kind: "invite" };
  };

  private _onDialogClose = () => {
    this._dialog = { kind: "none" };
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

    if (d.kind === "join-input") {
      return html`
        <join-session-dialog
          @join=${this._onJoinFromInput}
          @close=${this._onDialogClose}
        ></join-session-dialog>
      `;
    }

    if (d.kind === "join-confirm") {
      return html`
        <join-confirm-dialog
          .session=${d.session}
          .loading=${d.loading}
          .error=${d.error}
          .sessionKey=${d.sessionKey}
          @confirm=${this._onJoinConfirm}
          @cancel=${this._onDialogClose}
        ></join-confirm-dialog>
      `;
    }

    return html``;
  }

  render() {
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
              @session-join=${this._onSessionJoinInput}
            ></session-sidebar>
          `
          : ""
      }

      <div class="workspace-wrap">
        <main-workspace
          .activeNav=${this._activeNav}
          .session=${store.activeSession ?? null}
          .messages=${
            store.activeSessionId ? (store.messagesBySession.get(store.activeSessionId) ?? []) : []
          }
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
