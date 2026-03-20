import { LitElement, html, css } from "lit";
import { customElement, state, property } from "lit/decorators.js";
import { getClient } from "../gateway/client.js";
import { AppStore } from "../store/app-store.js";

type LoginMode = "login" | "init" | "register";

/**
 * 登录/注册/初始化视图。
 * - mode="login"：普通登录表单
 * - mode="init"：首次初始化，用户名锁定为 "admin"
 * - mode="register"：自注册表单
 */
@customElement("mas4s-login-view")
export class LoginView extends LitElement {
  @property({ type: String }) mode: LoginMode = "login";

  @state() private _username = "";
  @state() private _password = "";
  @state() private _displayName = "";
  @state() private _error = "";
  @state() private _loading = false;
  @state() private _rateLimitCountdown = 0;
  @state() private _pendingApproval = false;

  private _countdownTimer: ReturnType<typeof setInterval> | null = null;

  static styles = css`
    :host {
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      background: #f8fafc;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }

    .card {
      background: white;
      border-radius: 12px;
      padding: 32px;
      width: 360px;
      box-shadow: 0 4px 24px rgba(0, 0, 0, 0.08);
    }

    h2 {
      margin: 0 0 24px;
      font-size: 20px;
      font-weight: 700;
      color: #0f172a;
      text-align: center;
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: 6px;
      margin-bottom: 16px;
    }

    label {
      font-size: 13px;
      color: #475569;
      font-weight: 500;
    }

    input {
      padding: 10px 12px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      font-size: 14px;
      outline: none;
      transition: border-color 0.15s;
    }

    input:focus {
      border-color: #3b82f6;
    }

    input:disabled {
      background: #f1f5f9;
      color: #94a3b8;
      cursor: not-allowed;
    }

    .btn-primary {
      width: 100%;
      padding: 11px;
      background: #dc2626;
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 15px;
      font-weight: 500;
      cursor: pointer;
      margin-top: 8px;
      transition: background 0.15s;
    }

    .btn-primary:hover:not(:disabled) {
      background: #b91c1c;
    }

    .btn-primary:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .error {
      margin-top: 12px;
      padding: 10px 12px;
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 6px;
      color: #dc2626;
      font-size: 13px;
    }

    .success {
      margin-top: 12px;
      padding: 10px 12px;
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-radius: 6px;
      color: #16a34a;
      font-size: 13px;
    }

    .link-row {
      margin-top: 16px;
      text-align: center;
      font-size: 13px;
      color: #64748b;
    }

    .link {
      color: #3b82f6;
      cursor: pointer;
      text-decoration: underline;
      background: none;
      border: none;
      font-size: 13px;
      padding: 0;
    }

    .link:hover {
      color: #2563eb;
    }
  `;

  disconnectedCallback() {
    super.disconnectedCallback();
    this._clearCountdown();
  }

  private _clearCountdown() {
    if (this._countdownTimer !== null) {
      clearInterval(this._countdownTimer);
      this._countdownTimer = null;
    }
  }

  private _startCountdown(ms: number) {
    this._clearCountdown();
    this._rateLimitCountdown = Math.ceil(ms / 1000);
    this._countdownTimer = setInterval(() => {
      this._rateLimitCountdown -= 1;
      if (this._rateLimitCountdown <= 0) {
        this._clearCountdown();
        this._error = "";
      }
    }, 1000);
  }

  private _handleError(err: unknown) {
    const code =
      err instanceof Error ? ((err as Error & { code?: string }).code ?? err.message) : String(err);

    if (code === "RATE_LIMITED") {
      const retryAfterMs = (err as Error & { retryAfterMs?: number }).retryAfterMs ?? 60000;
      this._startCountdown(retryAfterMs);
      this._error = `登录尝试过于频繁，请等待 ${Math.ceil(retryAfterMs / 1000)} 秒后重试`;
    } else if (code === "WEAK_PASSWORD") {
      this._error = "密码强度不足，请使用至少 8 位字符";
    } else if (code === "ACCOUNT_PENDING_APPROVAL") {
      this._error = "等待审批";
    } else if (code === "ACCOUNT_REJECTED") {
      this._error = "已被拒绝，请联系管理员";
    } else if (code === "AUTH_FAILED") {
      this._error = "用户名或密码错误";
    } else {
      this._error = code || "操作失败，请重试";
    }
  }

  private _onLogin = async () => {
    this._error = "";
    this._loading = true;
    try {
      const client = getClient();
      const res = (await client.request("auth.login", {
        username: this._username,
        password: this._password,
      })) as {
        ok: boolean;
        token?: string;
        user?: {
          userId: string;
          username: string;
          displayName: string;
          role: string;
          tenantId: string;
        };
        error?: string;
        retryAfterMs?: number;
      };

      if (!res.ok) {
        const fakeErr = Object.assign(new Error(res.error ?? "AUTH_FAILED"), {
          code: res.error,
          retryAfterMs: res.retryAfterMs,
        });
        this._handleError(fakeErr);
        return;
      }

      const { token, user } = res;
      if (!token || !user) {
        this._error = "服务器响应异常";
        return;
      }

      localStorage.setItem("mas4s_auth_token", token);
      AppStore.instance.setCurrentUser({
        userId: user.userId,
        username: user.username,
        displayName: user.displayName,
        role: user.role as "admin" | "member" | "viewer",
        tenantId: user.tenantId,
      });

      this.dispatchEvent(
        new CustomEvent("login-success", {
          detail: { token, user },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (err) {
      this._handleError(err);
    } finally {
      this._loading = false;
    }
  };

  private _onRegisterOrInit = async () => {
    this._error = "";
    this._loading = true;
    const isInit = this.mode === "init";
    const username = isInit ? "admin" : this._username;

    try {
      const client = getClient();
      const res = (await client.request("user.register", {
        username,
        password: this._password,
        displayName: this._displayName,
      })) as {
        ok: boolean;
        user?: {
          userId: string;
          username: string;
          displayName: string;
          role: string;
          tenantId: string;
        };
        error?: string;
      };

      if (!res.ok) {
        const fakeErr = Object.assign(new Error(res.error ?? "操作失败"), {
          code: res.error,
        });
        this._handleError(fakeErr);
        return;
      }

      if (isInit) {
        // 初始化成功后自动登录
        await this._autoLogin(username, this._password);
      } else {
        // 自注册成功，等待审批
        this._pendingApproval = true;
        this.mode = "login";
        this._username = username;
        this._password = "";
        this._displayName = "";
      }
    } catch (err) {
      this._handleError(err);
    } finally {
      this._loading = false;
    }
  };

  private async _autoLogin(username: string, password: string) {
    const client = getClient();
    const res = (await client.request("auth.login", { username, password })) as {
      ok: boolean;
      token?: string;
      user?: {
        userId: string;
        username: string;
        displayName: string;
        role: string;
        tenantId: string;
      };
      error?: string;
    };

    if (!res.ok || !res.token || !res.user) {
      this._error = "初始化成功，请手动登录";
      return;
    }

    localStorage.setItem("mas4s_auth_token", res.token);
    AppStore.instance.setCurrentUser({
      userId: res.user.userId,
      username: res.user.username,
      displayName: res.user.displayName,
      role: res.user.role as "admin" | "member" | "viewer",
      tenantId: res.user.tenantId,
    });

    this.dispatchEvent(
      new CustomEvent("login-success", {
        detail: { token: res.token, user: res.user },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private _switchToRegister = () => {
    this.mode = "register";
    this._error = "";
    this._pendingApproval = false;
  };

  private _switchToLogin = () => {
    this.mode = "login";
    this._error = "";
  };

  private _renderLoginForm() {
    return html`
      <h2>登录</h2>
      ${
        this._pendingApproval
          ? html`
              <div class="success">注册成功，请等待管理员审批后登录</div>
            `
          : ""
      }
      <div class="field">
        <label>用户名</label>
        <input
          type="text"
          .value=${this._username}
          @input=${(e: Event) => (this._username = (e.target as HTMLInputElement).value)}
          @keydown=${(e: KeyboardEvent) => e.key === "Enter" && this._onLogin()}
          placeholder="请输入用户名"
        />
      </div>
      <div class="field">
        <label>密码</label>
        <input
          type="password"
          .value=${this._password}
          @input=${(e: Event) => (this._password = (e.target as HTMLInputElement).value)}
          @keydown=${(e: KeyboardEvent) => e.key === "Enter" && this._onLogin()}
          placeholder="请输入密码"
        />
      </div>
      <button
        class="btn-primary"
        @click=${this._onLogin}
        ?disabled=${this._loading || this._rateLimitCountdown > 0}
      >
        ${this._loading ? "登录中…" : this._rateLimitCountdown > 0 ? `请等待 ${this._rateLimitCountdown}s` : "登录"}
      </button>
      ${this._error ? html`<div class="error">${this._error}</div>` : ""}
      <div class="link-row">
        没有账号？<button class="link" @click=${this._switchToRegister}>注册新账号</button>
      </div>
    `;
  }

  private _renderInitForm() {
    return html`
      <h2>初始化系统</h2>
      <div class="field">
        <label>用户名</label>
        <input type="text" value="admin" disabled />
      </div>
      <div class="field">
        <label>显示名称</label>
        <input
          type="text"
          .value=${this._displayName}
          @input=${(e: Event) => (this._displayName = (e.target as HTMLInputElement).value)}
          placeholder="请输入显示名称"
        />
      </div>
      <div class="field">
        <label>密码</label>
        <input
          type="password"
          .value=${this._password}
          @input=${(e: Event) => (this._password = (e.target as HTMLInputElement).value)}
          @keydown=${(e: KeyboardEvent) => e.key === "Enter" && this._onRegisterOrInit()}
          placeholder="请设置密码（至少 8 位）"
        />
      </div>
      <button
        class="btn-primary"
        @click=${this._onRegisterOrInit}
        ?disabled=${this._loading}
      >
        ${this._loading ? "初始化中…" : "初始化系统"}
      </button>
      ${this._error ? html`<div class="error">${this._error}</div>` : ""}
    `;
  }

  private _renderRegisterForm() {
    return html`
      <h2>注册新账号</h2>
      <div class="field">
        <label>用户名</label>
        <input
          type="text"
          .value=${this._username}
          @input=${(e: Event) => (this._username = (e.target as HTMLInputElement).value)}
          placeholder="请输入用户名"
        />
      </div>
      <div class="field">
        <label>显示名称</label>
        <input
          type="text"
          .value=${this._displayName}
          @input=${(e: Event) => (this._displayName = (e.target as HTMLInputElement).value)}
          placeholder="请输入显示名称"
        />
      </div>
      <div class="field">
        <label>密码</label>
        <input
          type="password"
          .value=${this._password}
          @input=${(e: Event) => (this._password = (e.target as HTMLInputElement).value)}
          @keydown=${(e: KeyboardEvent) => e.key === "Enter" && this._onRegisterOrInit()}
          placeholder="请设置密码（至少 8 位）"
        />
      </div>
      <button
        class="btn-primary"
        @click=${this._onRegisterOrInit}
        ?disabled=${this._loading}
      >
        ${this._loading ? "注册中…" : "注册"}
      </button>
      ${this._error ? html`<div class="error">${this._error}</div>` : ""}
      <div class="link-row">
        <button class="link" @click=${this._switchToLogin}>返回登录</button>
      </div>
    `;
  }

  render() {
    return html`
      <div class="card">
        ${
          this.mode === "init"
            ? this._renderInitForm()
            : this.mode === "register"
              ? this._renderRegisterForm()
              : this._renderLoginForm()
        }
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "mas4s-login-view": LoginView;
  }
}
