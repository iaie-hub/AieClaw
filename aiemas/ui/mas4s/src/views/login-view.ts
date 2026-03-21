import { LitElement, html, css } from "lit";
import { customElement, state, property } from "lit/decorators.js";
import { getClient, resetClient } from "../gateway/client.js";
import { AppStore } from "../store/app-store.js";

type LoginMode = "login" | "init" | "register";

/**
 * 登录/注册/初始化视图。
 * 卡片上半部分为业务表单（login / init / register），
 * 下半部分为网关配置区（默认折叠，有错误时自动展开）。
 * 提交前若网关配置有变化，自动更新 localStorage 并重置连接。
 */
@customElement("mas4s-login-view")
export class LoginView extends LitElement {
  @property({ type: String }) mode: LoginMode = "login";
  /** 父组件传入的网关连接错误（会自动展开网关配置区） */
  @property({ type: String }) connectError = "";

  // 网关配置字段 — 默认从 localStorage 加载
  @state() private _wsUrl = localStorage.getItem("mas4s_ws_url") || "ws://localhost:18789";
  @state() private _wsToken = localStorage.getItem("mas4s_ws_token") || "";
  @state() private _gwExpanded = false;

  // 业务表单字段
  @state() private _username = "";
  @state() private _password = "";
  @state() private _passwordConfirm = "";
  @state() private _displayName = "";
  @state() private _error = "";
  @state() private _loading = false;
  @state() private _rateLimitCountdown = 0;
  @state() private _gwTesting = false;
  @state() private _gwTestResult: { ok: boolean; msg: string } | null = null;
  @state() private _pendingApproval = false;
  @state() private _initSuccess = false;

  // Visibility toggles
  @state() private _showPassword = false;
  @state() private _showPasswordConfirm = false;
  @state() private _showWsToken = false;

  private _countdownTimer: ReturnType<typeof setInterval> | null = null;

  static styles = css`
    :host {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 100%;
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

    .input-wrap {
      position: relative;
      display: flex;
      align-items: center;
    }

    .input-wrap input {
      flex: 1;
      padding-right: 40px; /* Space for the toggle button */
      width: 100%;
    }

    .toggle-btn {
      position: absolute;
      right: 8px;
      background: none;
      border: none;
      padding: 4px;
      cursor: pointer;
      color: #94a3b8;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: color 0.15s;
    }

    .toggle-btn:hover {
      color: #64748b;
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

    /* 网关配置区 */
    .gw-section {
      margin-top: 24px;
      border-top: 1px solid #e2e8f0;
      padding-top: 12px;
    }

    .gw-toggle {
      display: flex;
      align-items: center;
      justify-content: space-between;
      cursor: pointer;
      user-select: none;
      font-size: 13px;
      color: #64748b;
      background: none;
      border: none;
      width: 100%;
      padding: 0;
      text-align: left;
    }

    .gw-toggle:hover {
      color: #334155;
    }

    .gw-toggle .arrow {
      font-size: 10px;
      transition: transform 0.15s;
    }

    .gw-toggle.open .arrow {
      transform: rotate(180deg);
    }

    .gw-body {
      margin-top: 12px;
    }

    .gw-body .field {
      margin-bottom: 12px;
    }

    .gw-body label {
      font-size: 12px;
      color: #64748b;
    }

    .gw-body input {
      font-size: 13px;
      padding: 8px 10px;
    }

    .gw-error {
      margin-top: 8px;
      padding: 8px 10px;
      background: #fef2f2;
      border: 1px solid #fecaca;
      border-radius: 6px;
      color: #dc2626;
      font-size: 12px;
    }

    .gw-success {
      margin-top: 8px;
      padding: 8px 10px;
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-radius: 6px;
      color: #16a34a;
      font-size: 12px;
    }

    .btn-test {
      width: 100%;
      margin-top: 10px;
      padding: 8px;
      background: #f8fafc;
      color: #3b82f6;
      border: 1px solid #bfdbfe;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      transition:
        background 0.15s,
        border-color 0.15s;
    }

    .btn-test:hover:not(:disabled) {
      background: #eff6ff;
      border-color: #93c5fd;
    }

    .btn-test:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }
  `;

  disconnectedCallback() {
    this._clearCountdown();
  }

  // ── 图标渲染 ──────────────────────────────────────

  private _renderEyeIcon() {
    return html`
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        stroke-width="1.5"
        stroke="currentColor"
        style="width: 18px; height: 18px"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M2.036 12.322a1.012 1.012 0 010-.644C3.399 8.049 7.21 5 12 5c4.792 0 8.601 3.049 9.964 6.678.045.133.045.278 0 .411C20.601 15.951 16.79 19 12 19c-4.792 0-8.601-3.049-9.964-6.678z"
        />
        <path stroke-linecap="round" stroke-linejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    `;
  }

  private _renderEyeSlashIcon() {
    return html`
      <svg
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        stroke-width="1.5"
        stroke="currentColor"
        style="width: 18px; height: 18px"
      >
        <path
          stroke-linecap="round"
          stroke-linejoin="round"
          d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.822 7.822L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88"
        />
      </svg>
    `;
  }

  // ── 倒计时 ────────────────────────────────────────

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

  // ── 错误处理 ──────────────────────────────────────

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

  // ── 网关配置同步 ──────────────────────────────────

  /**
   * 若网关配置与 localStorage 不同，更新并重置连接。
   * 返回可用的 client（已确保用最新配置创建）。
   */
  private async _ensureGatewayClient() {
    const storedUrl = localStorage.getItem("mas4s_ws_url");
    const storedToken = localStorage.getItem("mas4s_ws_token");
    if (this._wsUrl !== storedUrl || this._wsToken !== storedToken) {
      localStorage.setItem("mas4s_ws_url", this._wsUrl);
      localStorage.setItem("mas4s_ws_token", this._wsToken);
      resetClient();
    }
    const client = getClient({ url: this._wsUrl, token: this._wsToken || undefined });
    await client.waitConnected();
    return client;
  }

  // ── 网关连接测试 ──────────────────────────────────

  private _onTestGateway = async () => {
    this._gwTesting = true;
    this._gwTestResult = null;
    try {
      resetClient();
      const client = getClient({ url: this._wsUrl, token: this._wsToken || undefined });
      await client.waitConnected();
      const res = await client.request<{ initialized: boolean }>("system.status");
      // 保存配置
      localStorage.setItem("mas4s_ws_url", this._wsUrl);
      localStorage.setItem("mas4s_ws_token", this._wsToken);
      resetClient();
      // 通知父组件：连接成功，携带 initialized 状态，父组件直接跳转，无需再次 _checkSystemStatus
      this.dispatchEvent(
        new CustomEvent("gateway-connect", {
          detail: { url: this._wsUrl, token: this._wsToken, initialized: res.initialized },
          bubbles: true,
          composed: true,
        }),
      );
    } catch (err) {
      resetClient();
      this._gwTestResult = {
        ok: false,
        msg: err instanceof Error ? err.message : String(err),
      };
    } finally {
      this._gwTesting = false;
    }
  };

  // ── 登录 ──────────────────────────────────────────

  private _onLogin = async () => {
    this._error = "";
    this._loading = true;
    try {
      const client = await this._ensureGatewayClient();
      const res = await client.request<{
        ok: boolean;
        error?: string;
        retryAfterMs?: number;
        token?: string;
        user?: {
          userId: string;
          username: string;
          displayName: string;
          role: string;
          tenantId: string;
        };
      }>("auth.login", {
        username: this._username,
        password: this._password,
      });

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

  // ── 注册 / 初始化 ─────────────────────────────────

  private _onRegisterOrInit = async () => {
    this._error = "";
    if (this._password !== this._passwordConfirm) {
      this._error = "两次输入的密码不一致";
      return;
    }
    this._loading = true;
    const isInit = this.mode === "init";
    const username = isInit ? "admin" : this._username;

    try {
      const client = await this._ensureGatewayClient();
      await client.request("user.register", {
        username,
        password: this._password,
        displayName: this._displayName,
      });

      if (isInit) {
        this._initSuccess = true;
        this.mode = "login";
        this._username = username;
        this._password = "";
        this._passwordConfirm = "";
        this._displayName = "";
      } else {
        this._pendingApproval = true;
        this.mode = "login";
        this._username = username;
        this._password = "";
        this._passwordConfirm = "";
        this._displayName = "";
      }
    } catch (err) {
      this._handleError(err);
    } finally {
      this._loading = false;
    }
  };

  private _switchToRegister = () => {
    this.mode = "register";
    this._error = "";
    this._pendingApproval = false;
    this._initSuccess = false;
  };

  private _switchToLogin = () => {
    this.mode = "login";
    this._error = "";
    this._initSuccess = false;
  };

  // ── 渲染 ──────────────────────────────────────────

  /** 网关配置折叠区，始终渲染在卡片底部 */
  private _renderGatewaySection() {
    const gwErr = this.connectError;
    // 有外部错误时自动展开
    const expanded = this._gwExpanded || Boolean(gwErr);
    return html`
      <div class="gw-section">
        <button
          class="gw-toggle ${expanded ? "open" : ""}"
          @click=${() => (this._gwExpanded = !this._gwExpanded)}
        >
          <span>网关连接配置</span>
          <span class="arrow">▼</span>
        </button>
        ${
          expanded
            ? html`
              <div class="gw-body">
                <div class="field">
                  <label>WebSocket URL</label>
                  <input
                    type="text"
                    .value=${this._wsUrl}
                    @input=${(e: Event) => (this._wsUrl = (e.target as HTMLInputElement).value)}
                    placeholder="ws://localhost:18789"
                  />
                </div>
                <div class="field">
                  <label>网关令牌</label>
                  <div class="input-wrap">
                    <input
                      type=${this._showWsToken ? "text" : "password"}
                      .value=${this._wsToken}
                      @input=${(e: Event) => (this._wsToken = (e.target as HTMLInputElement).value)}
                      placeholder="OPENCLAW_GATEWAY_TOKEN"
                    />
                    <button
                      class="toggle-btn"
                      type="button"
                      @click=${() => (this._showWsToken = !this._showWsToken)}
                      title=${this._showWsToken ? "隐藏令牌" : "显示令牌"}
                    >
                      ${this._showWsToken ? this._renderEyeSlashIcon() : this._renderEyeIcon()}
                    </button>
                  </div>
                </div>
                <button
                  class="btn-test"
                  ?disabled=${this._gwTesting}
                  @click=${this._onTestGateway}
                >
                  ${this._gwTesting ? "测试中…" : "测试连接"}
                </button>
                ${
                  this._gwTestResult
                    ? this._gwTestResult.ok
                      ? html`<div class="gw-success">${this._gwTestResult.msg}</div>`
                      : html`<div class="gw-error">${this._gwTestResult.msg}</div>`
                    : ""
                }
                ${gwErr && !this._gwTestResult ? html`<div class="gw-error">${gwErr}</div>` : ""}
              </div>
            `
            : ""
        }
      </div>
    `;
  }

  private _renderLoginForm() {
    return html`
      <h2>登录</h2>
      ${
        this._pendingApproval
          ? html`
              <div class="success">注册成功，请等待管理员审批后登录</div>
            `
          : this._initSuccess
            ? html`
                <div class="success">初始化成功，请登录系统</div>
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
        <div class="input-wrap">
          <input
            type=${this._showPassword ? "text" : "password"}
            .value=${this._password}
            @input=${(e: Event) => (this._password = (e.target as HTMLInputElement).value)}
            @keydown=${(e: KeyboardEvent) => e.key === "Enter" && this._onLogin()}
            placeholder="请输入密码"
          />
          <button
            class="toggle-btn"
            type="button"
            @click=${() => (this._showPassword = !this._showPassword)}
            title=${this._showPassword ? "隐藏密码" : "显示密码"}
          >
            ${this._showPassword ? this._renderEyeSlashIcon() : this._renderEyeIcon()}
          </button>
        </div>
      </div>
      <button
        class="btn-primary"
        @click=${this._onLogin}
        ?disabled=${this._loading || this._rateLimitCountdown > 0}
      >
        ${
          this._loading
            ? "登录中…"
            : this._rateLimitCountdown > 0
              ? `请等待 ${this._rateLimitCountdown}s`
              : "登录"
        }
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
        <div class="input-wrap">
          <input
            type=${this._showPassword ? "text" : "password"}
            .value=${this._password}
            @input=${(e: Event) => (this._password = (e.target as HTMLInputElement).value)}
            @keydown=${(e: KeyboardEvent) => e.key === "Enter" && this._onRegisterOrInit()}
            placeholder="请设置密码（至少 8 位）"
          />
          <button
            class="toggle-btn"
            type="button"
            @click=${() => (this._showPassword = !this._showPassword)}
            title=${this._showPassword ? "隐藏密码" : "显示密码"}
          >
            ${this._showPassword ? this._renderEyeSlashIcon() : this._renderEyeIcon()}
          </button>
        </div>
      </div>
      <div class="field">
        <label>确认密码</label>
        <div class="input-wrap">
          <input
            type=${this._showPasswordConfirm ? "text" : "password"}
            .value=${this._passwordConfirm}
            @input=${(e: Event) => (this._passwordConfirm = (e.target as HTMLInputElement).value)}
            @keydown=${(e: KeyboardEvent) => e.key === "Enter" && this._onRegisterOrInit()}
            placeholder="请再次输入密码"
          />
          <button
            class="toggle-btn"
            type="button"
            @click=${() => (this._showPasswordConfirm = !this._showPasswordConfirm)}
            title=${this._showPasswordConfirm ? "隐藏密码" : "显示密码"}
          >
            ${this._showPasswordConfirm ? this._renderEyeSlashIcon() : this._renderEyeIcon()}
          </button>
        </div>
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
        <div class="input-wrap">
          <input
            type=${this._showPassword ? "text" : "password"}
            .value=${this._password}
            @input=${(e: Event) => (this._password = (e.target as HTMLInputElement).value)}
            @keydown=${(e: KeyboardEvent) => e.key === "Enter" && this._onRegisterOrInit()}
            placeholder="请设置密码（至少 8 位）"
          />
          <button
            class="toggle-btn"
            type="button"
            @click=${() => (this._showPassword = !this._showPassword)}
            title=${this._showPassword ? "隐藏密码" : "显示密码"}
          >
            ${this._showPassword ? this._renderEyeSlashIcon() : this._renderEyeIcon()}
          </button>
        </div>
      </div>
      <div class="field">
        <label>确认密码</label>
        <div class="input-wrap">
          <input
            type=${this._showPasswordConfirm ? "text" : "password"}
            .value=${this._passwordConfirm}
            @input=${(e: Event) => (this._passwordConfirm = (e.target as HTMLInputElement).value)}
            @keydown=${(e: KeyboardEvent) => e.key === "Enter" && this._onRegisterOrInit()}
            placeholder="请再次输入密码"
          />
          <button
            class="toggle-btn"
            type="button"
            @click=${() => (this._showPasswordConfirm = !this._showPasswordConfirm)}
            title=${this._showPasswordConfirm ? "隐藏密码" : "显示密码"}
          >
            ${this._showPasswordConfirm ? this._renderEyeSlashIcon() : this._renderEyeIcon()}
          </button>
        </div>
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
        ${this._renderGatewaySection()}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "mas4s-login-view": LoginView;
  }
}
