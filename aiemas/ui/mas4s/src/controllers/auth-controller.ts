import { getClient, resetClient } from "../gateway/client.js";
import { restoreSessionRunState } from "../gateway/run-state-recovery.js";
import { fetchSessions } from "../gateway/session-manager.js";
import type { AppStore, CurrentUser } from "../store/app-store.js";

export type MasAuthState = "checking" | "init" | "login" | "authenticated";

/**
 * AuthController 通过此接口通知宿主更新渲染状态，
 * 避免控制器直接依赖 LitElement。
 */
export interface AuthStateCallback {
  setAuthState(state: MasAuthState): void;
  setConnected(connected: boolean): void;
  setConnectError(error: string): void;
}

/**
 * 连接与认证控制器。
 * 封装 gateway WebSocket 连接、system.status 检查、
 * 登录成功/登出、token 自动刷新等逻辑。
 */
export class AuthController {
  private _refreshTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly store: AppStore,
    private readonly cb: AuthStateCallback,
  ) {}

  // ── 启动检查 ──────────────────────────────────────

  async checkSystemStatus(): Promise<void> {
    const url = localStorage.getItem("mas4s_ws_url") || "ws://localhost:18789";
    const token = localStorage.getItem("mas4s_ws_token") || undefined;
    console.debug("[mas4s:auth] checkSystemStatus → url=%s", url);
    try {
      const client = getClient({ url, token });
      await client.waitConnected();
      const res = await client.request<{ initialized: boolean }>("system.status");
      console.debug("[mas4s:auth] checkSystemStatus ← res=%o", res);
      if (!res.initialized) {
        this.cb.setAuthState("init");
        resetClient();
      } else if (localStorage.getItem("mas4s_auth_token")) {
        const masToken = localStorage.getItem("mas4s_auth_token")!;
        try {
          // Attempt to verify and restore currentUser
          const verifyRes = await client.request<{ ok: boolean; user?: CurrentUser }>(
            "auth.verify",
            {
              token: masToken,
            },
          );
          if (verifyRes.ok && verifyRes.user) {
            console.debug("[mas4s:auth] checkSystemStatus → restoring currentUser from token");
            this.store.setCurrentUser(verifyRes.user);
            this.cb.setAuthState("authenticated");
            this.doConnect();
            this.startRefreshTimer();
          } else {
            console.warn(
              "[mas4s:auth] checkSystemStatus → token verification failed, redirecting to login",
            );
            localStorage.removeItem("mas4s_auth_token");
            this.cb.setAuthState("login");
            resetClient();
          }
        } catch (err) {
          console.warn("[mas4s:auth] checkSystemStatus → auth.verify failed:", err);
          localStorage.removeItem("mas4s_auth_token");
          this.cb.setAuthState("login");
          resetClient();
        }
      } else {
        this.cb.setAuthState("login");
        resetClient();
      }
    } catch (err) {
      console.warn("[mas4s:auth] checkSystemStatus ← error, falling back to login:", err);
      this.cb.setConnectError(err instanceof Error ? err.message : String(err));
      this.cb.setAuthState("login");
      resetClient();
    }
  }

  // ── WebSocket 连接 ────────────────────────────────

  doConnect(): void {
    const url = localStorage.getItem("mas4s_ws_url") || "ws://localhost:18789";
    const token = localStorage.getItem("mas4s_ws_token") || undefined;
    console.debug("[mas4s:auth] doConnect → url=%s", url);
    this.cb.setConnectError("");

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
        console.debug("[mas4s:auth] doConnect ← onHello: connected=true");
        const isReconnect = this._everConnected;
        this._wasConnected = true;
        this._everConnected = true;
        this.cb.setConnected(true);
        // Subscribe to session tool events so Secondary_Panel can display
        // sub-agent tool calls and results in real-time.
        void getClient()
          .request("sessions.subscribe", {})
          .then(() => {
            console.debug("[mas4s:auth] doConnect ← sessions.subscribe ok");
          })
          .catch((err) => {
            console.warn("[mas4s:auth] doConnect ← sessions.subscribe failed:", err);
          });
        // 连接成功后立即拉取历史会话，恢复 gateway 重启前的会话列表
        void fetchSessions(getClient())
          .then((sessions) => {
            this.store.setSessions(sessions);
            console.debug("[mas4s:auth] doConnect ← sessions loaded: count=%d", sessions.length);
            // On reconnect, restore SOP run state for the currently active session
            if (isReconnect) {
              const activeKey = this.store.activeSessionKey;
              const activeUuid = this.store.activeSessionUuid;
              if (activeKey && activeUuid) {
                void restoreSessionRunState(getClient(), this.store, activeKey, activeUuid);
              }
            }
          })
          .catch((err) => {
            console.warn("[mas4s:auth] doConnect ← fetchSessions failed:", err);
          });
        // 同时拉取可用 Agent 列表
        void getClient()
          .request<{ agents: { id: string; name?: string; description?: string }[] }>(
            "agents.list",
            {},
          )
          .then((res) => {
            this.store.setAgents(res.agents || []);
            console.debug("[mas4s:auth] doConnect ← agents loaded: count=%d", res.agents?.length);
          })
          .catch((err) => {
            console.warn("[mas4s:auth] doConnect ← agents.list failed:", err);
          });
      },
      onClose: (info) => {
        console.debug(
          "[mas4s:auth] doConnect ← onClose: code=%s reason=%s",
          info.code,
          info.reason,
        );
        const wasConnected = this._wasConnected;
        this.cb.setConnected(false);
        this._wasConnected = false;

        // Suppress stale error from the async close event fired after onLogout
        if (this._loggingOut) {
          this._loggingOut = false;
          return;
        }

        if (
          info.reason &&
          (info.reason.includes("TOKEN_EXPIRED") || info.reason.includes("MAS_AUTH_FAILED"))
        ) {
          console.warn(
            "[mas4s:auth] doConnect ← auth error (%s), redirecting to login",
            info.reason,
          );
          this.stopRefreshTimer();
          localStorage.removeItem("mas4s_auth_token");
          this.cb.setAuthState("login");
          resetClient();
          return;
        }

        this.cb.setConnectError(
          `连接断开 (${info.code}): ${info.reason || "目标地址拒绝连接或无效"}`,
        );
        if (!wasConnected) {
          resetClient();
        }
      },
    });
    console.debug("[mas4s:auth] doConnect → client created, awaiting hello");
  }

  // onHello 触发前需要跟踪"是否曾经连接成功"，用于 onClose 判断
  private _wasConnected = false;
  // Tracks whether we have ever successfully connected in this session.
  // Unlike _wasConnected, this is never reset on close — used to detect reconnects.
  private _everConnected = false;
  // Set during logout to suppress stale connectError from the async close event
  private _loggingOut = false;

  // ── 登录 / 登出 ───────────────────────────────────

  onLoginSuccess(): void {
    console.debug("[mas4s:auth] onLoginSuccess → authenticated");
    this.cb.setAuthState("authenticated");
    this.doConnect();
    this.startRefreshTimer();
  }

  onLogout(): void {
    console.debug("[mas4s:auth] onLogout → clearing state");
    this.stopRefreshTimer();
    // Clear auth token BEFORE closing the connection so no reconnect path
    // (scheduleReconnect, onGatewayConnect, checkSystemStatus) can re-enter
    // "authenticated" with a stale token.
    localStorage.removeItem("mas4s_auth_token");
    this.store.logout();
    this.store.setSessions([]);
    // Flag to suppress the stale connectError from the async close event
    this._loggingOut = true;
    // Reset _everConnected so the next login is treated as a fresh connection
    this._everConnected = false;
    // Close the WebSocket immediately. The server-side onClientDisconnected
    // handler will mark the user offline, so a separate user.logout request
    // is unnecessary and avoids the race window where the still-alive
    // client could auto-reconnect with a stale masToken URL.
    resetClient();
    this.cb.setConnected(false);
    this.cb.setConnectError("");
    this.cb.setAuthState("login");
  }

  // ── gateway-connect 事件（login-view 测试连接后派发） ──

  onGatewayConnect(initialized: boolean): void {
    this.cb.setConnectError("");
    if (!initialized) {
      this.cb.setAuthState("init");
    } else if (localStorage.getItem("mas4s_auth_token")) {
      if (!this.store.currentUser) {
        console.warn(
          "[mas4s:auth] onGatewayConnect → token present but currentUser lost, redirecting to login",
        );
        localStorage.removeItem("mas4s_auth_token");
        this.cb.setAuthState("login");
      } else {
        this.cb.setAuthState("authenticated");
        this.doConnect();
      }
    } else {
      this.cb.setAuthState("login");
    }
  }

  // ── Token 自动刷新（5 分钟） ──────────────────────

  startRefreshTimer(): void {
    this.stopRefreshTimer();
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
          console.warn("[mas4s:auth] auto-refresh failed:", err);
        }
      },
      5 * 60 * 1000,
    );
  }

  stopRefreshTimer(): void {
    if (this._refreshTimer !== null) {
      clearInterval(this._refreshTimer);
      this._refreshTimer = null;
    }
  }
}
