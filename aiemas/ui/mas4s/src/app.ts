import "katex/dist/katex.min.css";
import { LitElement, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { AuthController, type MasAuthState } from "./controllers/auth-controller.js";
import { MessageController } from "./controllers/message-controller.js";
import { SessionController } from "./controllers/session-controller.js";
import {
  UIStateController,
  type NavItem,
  type DialogKind,
} from "./controllers/ui-state-controller.js";
import { registerEventHandlers } from "./gateway/event-handler.js";
import { AppStore, AppStoreController } from "./store/app-store.js";
import { renderChecking, renderLogin, renderMain } from "./views/app-shell.js";
// 组件注册（副作用导入）
import "./components/primary-sidebar.js";
import "./components/session-sidebar.js";
import "./components/main-workspace.js";
import "./components/invite-dialog.js";
import "./views/login-view.js";
import "./views/user-list-view.js";
import "./views/skills-manager.js";

/**
 * mas4s 根组件。三栏布局：primary-sidebar + session-sidebar + main-workspace。
 * 仅负责状态持有与渲染路由，业务逻辑全部委托给各控制器。
 */
@customElement("mas4s-app")
export class Mas4sApp extends LitElement {
  private _ctrl = new AppStoreController(this);
  private _auth = new AuthController(AppStore.instance, {
    setAuthState: (s) => {
      this._masAuthState = s;
    },
    setConnected: (v) => {
      this._connected = v;
    },
    setConnectError: (e) => {
      this._connectError = e;
    },
  });
  private _session = new SessionController(AppStore.instance);
  private _message = new MessageController(AppStore.instance);
  private _ui = new UIStateController({
    setNav: (nav) => {
      this._activeNav = nav;
    },
    setDialog: (kind) => {
      this._dialog = kind;
    },
    onWorkspaceEnter: () => {
      void this._session.onSessionRefresh();
    },
  });

  @state() private _masAuthState: MasAuthState = "checking";
  @state() private _connected = false;
  @state() private _connectError = "";
  @state() private _activeNav: NavItem = "workspace";
  @state() private _dialog: DialogKind = "none";

  static styles = css`
    :host {
      display: flex;
      height: 100vh;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #f8fafc;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    registerEventHandlers();
    void this._auth.checkSystemStatus();
  }

  render() {
    if (this._masAuthState === "checking") {
      return renderChecking();
    }

    if (this._masAuthState === "init") {
      return renderLogin("init", this._connectError, {
        onLoginSuccess: () => this._auth.onLoginSuccess(),
        onGatewayConnect: (e) => {
          const { initialized } = (e as CustomEvent<{ initialized: boolean }>).detail;
          this._auth.onGatewayConnect(initialized);
        },
      });
    }

    if (this._masAuthState === "login") {
      return renderLogin("login", this._connectError, {
        onLoginSuccess: () => this._auth.onLoginSuccess(),
        onGatewayConnect: (e) => {
          const { initialized } = (e as CustomEvent<{ initialized: boolean }>).detail;
          this._auth.onGatewayConnect(initialized);
        },
      });
    }

    // When disconnected, show login view so user can re-authenticate or check gateway status
    if (!this._connected && this._masAuthState === "authenticated") {
      return renderLogin("login", this._connectError, {
        onLoginSuccess: () => this._auth.onLoginSuccess(),
        onGatewayConnect: (e: Event) => {
          const { initialized } = (e as CustomEvent<{ initialized: boolean }>).detail;
          this._auth.onGatewayConnect(initialized);
        },
      });
    }

    return renderMain(this._ctrl.store, this._activeNav, this._dialog, {
      onLoginSuccess: () => this._auth.onLoginSuccess(),
      onGatewayConnect: (e) => {
        const { initialized } = (e as CustomEvent<{ initialized: boolean }>).detail;
        this._auth.onGatewayConnect(initialized);
      },
      onLogout: () => this._auth.onLogout(),
      onNavChange: (e) => this._ui.onNavChange(e),
      onSessionSelect: (e) => this._session.onSessionSelect(e),
      onSessionCreate: (e) => this._session.onSessionCreate(e),
      onSessionRename: (e) => this._session.onSessionRename(e),
      onSessionDelete: (e) => this._session.onSessionDelete(e),
      onSessionRefresh: (e: Event) => void this._session.onSessionRefresh(e),
      onSessionHistoryRefresh: (e: CustomEvent<{ sessionKey: string }>) =>
        this._session.onSessionHistoryRefresh(e),
      onSessionArchive: (e: CustomEvent<{ sessionKey: string }>) =>
        this._session.onSessionArchive(e),
      onSessionUnarchive: (e: CustomEvent<{ sessionKey: string }>) =>
        this._session.onSessionUnarchive(e),
      onSessionMembersFetch: (e: CustomEvent<{ sessionKey: string }>) =>
        this._session.onSessionMembersFetch(e),
      onUserInvite: (e: CustomEvent<{ sessionKey: string; userId: string }>) =>
        this._session.onUserInvite(e),
      onMemberRemove: (e: CustomEvent<{ sessionKey: string; userId: string }>) =>
        this._session.onMemberRemove(e),
      onSessionAgentUpdate: (e: CustomEvent<{ sessionKey: string; agentId: string }>) =>
        this._session.onSessionAgentUpdate(e),
      onSendMessage: (e) => this._message.onSendMessage(e),

      onResolveApproval: (e) => this._message.onResolveApproval(e),
      onInviteOpen: () => this._ui.onInviteOpen(),
      onDialogClose: () => this._ui.onDialogClose(),
      onLoadMoreHistory: (e) => this._session.onLoadMoreHistory(e),
    });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "mas4s-app": Mas4sApp;
  }
}
