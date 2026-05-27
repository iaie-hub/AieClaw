import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { fetchRegistryConfig, saveRegistryConfig } from "../gateway/clawhub-api.js";
import type { RegistryConfig } from "../gateway/clawhub-api.js";
import type { GatewayBrowserClient } from "../lib/gateway.js";
import type { AgentInfo } from "../store/app-store.js";
import {
  validateApiKey,
  validateNatsUrl,
  validateAgentId,
  validateAgentName,
} from "../utils/registry-validators.js";

/**
 * AgentRegistry 设置页面配置区域组件。
 * - API Key 输入框（密码类型 + 显示/隐藏切换）、失焦时格式验证
 * - NATS 配置表单: URL、Token、Agent ID、Agent Name、Bound Agent ID
 * - 保存按钮: 调用 saveRegistryConfig，显示成功/失败提示
 * - 加载时回填已保存配置（API Key 掩码显示）
 * - Admin 角色限制: 非 Admin 隐藏 NATS 配置编辑区域
 */
@customElement("settings-registry")
export class SettingsRegistry extends LitElement {
  /** Gateway client instance passed from parent */
  @property({ attribute: false }) client!: GatewayBrowserClient;

  /** Current user role */
  @property({ type: String }) role: string = "viewer";

  /** Local agents list for Bound Agent ID dropdown */
  @property({ attribute: false }) localAgents: AgentInfo[] = [];

  // ── Form state ──────────────────────────────────────────────────────────────

  @state() private _apiKey = "";
  @state() private _apiKeyVisible = false;
  @state() private _apiKeyError = "";

  @state() private _natsUrl = "";
  @state() private _natsUrlError = "";

  @state() private _natsToken = "";

  @state() private _agentId = "";
  @state() private _agentIdError = "";

  @state() private _agentName = "";
  @state() private _agentNameError = "";

  @state() private _boundAgentId = "";

  @state() private _activeTab: "register" = "register";

  // ── UI state ────────────────────────────────────────────────────────────────

  @state() private _saving = false;
  @state() private _loading = true;
  @state() private _toastMsg = "";
  @state() private _toastError = false;
  private _toastTimer: ReturnType<typeof setTimeout> | undefined;

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      height: 100%;
      background: white;
      overflow: hidden;
    }

    .header-area {
      flex-shrink: 0;
      padding: 24px 32px 0;
      background: white;
      border-bottom: 1px solid #e8edf5;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .header-text {
      flex: 1;
    }

    .page-title {
      font-size: 24px;
      font-weight: 600;
      color: #1e293b;
      margin: 0;
    }

    .subtitle {
      font-size: 14px;
      color: #64748b;
      margin: 6px 0 0;
    }

    .tabs {
      display: flex;
      gap: 32px;
      margin-top: 8px;
    }

    .tab-item {
      padding: 0 4px 12px;
      font-size: 14px;
      font-weight: 600;
      color: #64748b;
      cursor: pointer;
      position: relative;
    }

    .tab-item:hover {
      color: #1e293b;
    }

    .tab-item.active {
      color: #3b82f6;
    }

    .tab-item.active::after {
      content: "";
      position: absolute;
      bottom: -1px;
      left: 0;
      right: 0;
      height: 2px;
      background: #3b82f6;
      border-radius: 2px 2px 0 0;
      z-index: 1;
    }

    .content-area {
      flex: 1;
      padding: 32px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      align-items: flex-start;
    }

    .settings-container {
      width: 100%;
      max-width: 600px;
      box-sizing: border-box;
    }

    .section-title {
      font-size: 16px;
      font-weight: 600;
      color: #1e293b;
      margin: 0 0 20px;
    }

    .form-group {
      margin-bottom: 20px;
    }

    .form-label {
      display: block;
      font-size: 13px;
      font-weight: 500;
      color: #475569;
      margin-bottom: 6px;
    }

    .input-wrapper {
      position: relative;
      display: flex;
      align-items: center;
    }

    .form-input {
      width: 100%;
      padding: 10px 14px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      font-size: 14px;
      color: #1e293b;
      outline: none;
      transition: all 0.2s;
      box-sizing: border-box;
      background-color: #f8fafc;
    }

    .form-input:focus {
      background-color: #ffffff;
      border-color: #3b82f6;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
    }

    .form-input.has-error {
      border-color: #ef4444;
      background-color: #fffafb;
    }

    .form-input.has-error:focus {
      box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.15);
    }

    .form-input.with-toggle {
      padding-right: 44px;
    }

    .toggle-visibility {
      position: absolute;
      right: 8px;
      top: 50%;
      transform: translateY(-50%);
      background: none;
      border: none;
      cursor: pointer;
      padding: 6px 10px;
      border-radius: 6px;
      color: #64748b;
      font-size: 12px;
      font-weight: 500;
      transition: all 0.2s;
    }

    .toggle-visibility:hover {
      color: #1e293b;
      background-color: #e2e8f0;
    }

    .form-select {
      width: 100%;
      padding: 10px 14px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      font-size: 14px;
      color: #1e293b;
      outline: none;
      background: #f8fafc;
      cursor: pointer;
      transition: all 0.2s;
      box-sizing: border-box;
    }

    .form-select:focus {
      background-color: #ffffff;
      border-color: #3b82f6;
      box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);
    }

    .field-error {
      font-size: 12px;
      color: #ef4444;
      margin-top: 6px;
      font-weight: 500;
    }

    .nats-section {
      margin-top: 32px;
      padding-top: 28px;
      border-top: 1px solid #e8edf5;
    }

    .save-row {
      margin-top: 32px;
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .btn-save {
      padding: 10px 24px;
      background: linear-gradient(135deg, #3b82f6 0%, #6366f1 100%);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
      box-shadow: 0 2px 4px 0 rgba(59, 130, 246, 0.1);
    }

    .btn-save:hover:not(:disabled) {
      opacity: 0.95;
      box-shadow: 0 4px 6px 0 rgba(59, 130, 246, 0.15);
    }

    .btn-save:active:not(:disabled) {
      transform: scale(0.98);
    }

    .btn-save:disabled {
      opacity: 0.5;
      cursor: not-allowed;
      box-shadow: none;
    }

    .toast {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 8px 14px;
      border-radius: 8px;
      font-size: 13px;
      font-weight: 500;
      animation: fadeIn 0.2s ease;
    }

    .toast.success {
      background: #dcfce7;
      color: #166534;
      border: 1px solid #bbf7d0;
    }

    .toast.error {
      background: #fee2e2;
      color: #991b1b;
      border: 1px solid #fecaca;
    }

    @keyframes fadeIn {
      from {
        opacity: 0;
        transform: translateY(-4px);
      }
      to {
        opacity: 1;
        transform: translateY(0);
      }
    }

    .loading-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 60px;
      width: 100%;
      max-width: 600px;
      color: #94a3b8;
      font-size: 14px;
    }

    .spinner {
      width: 28px;
      height: 28px;
      border: 3px solid #e2e8f0;
      border-top-color: #3b82f6;
      border-radius: 50%;
      animation: spin 0.8s linear infinite;
      margin-bottom: 12px;
    }

    @keyframes spin {
      to {
        transform: rotate(360deg);
      }
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    void this._loadConfig();
  }

  private async _loadConfig() {
    this._loading = true;
    try {
      const config = await fetchRegistryConfig(this.client);
      this._apiKey = config.apiKey ?? "";
      this._natsUrl = config.natsUrl ?? "";
      this._natsToken = config.natsToken ?? "";
      this._agentId = config.agentId ?? "";
      this._agentName = config.agentName ?? "";
      this._boundAgentId = config.boundAgentId ?? "";
    } catch {
      // Config load failed — leave fields empty, user can fill in
    } finally {
      this._loading = false;
    }
  }

  // ── Validation handlers ─────────────────────────────────────────────────────

  private _onApiKeyBlur = () => {
    if (this._apiKey.trim() === "") {
      this._apiKeyError = "";
      return;
    }
    const result = validateApiKey(this._apiKey);
    this._apiKeyError = result.valid ? "" : (result.error ?? "");
  };

  private _onNatsUrlBlur = () => {
    if (this._natsUrl.trim() === "") {
      this._natsUrlError = "";
      return;
    }
    const result = validateNatsUrl(this._natsUrl);
    this._natsUrlError = result.valid ? "" : (result.error ?? "");
  };

  private _onAgentIdBlur = () => {
    // Auto-generate default if empty on first config
    if (this._agentId.trim() === "") {
      this._agentId = `Agent-${crypto.randomUUID()}`;
      this._agentIdError = "";
      return;
    }
    const result = validateAgentId(this._agentId);
    this._agentIdError = result.valid ? "" : (result.error ?? "");
  };

  private _onAgentNameBlur = () => {
    if (this._agentName.trim() === "") {
      this._agentNameError = "";
      return;
    }
    const result = validateAgentName(this._agentName);
    this._agentNameError = result.valid ? "" : (result.error ?? "");
  };

  // ── Save handler ────────────────────────────────────────────────────────────

  private _hasValidationErrors(): boolean {
    // Re-validate all non-empty fields
    if (this._apiKey.trim()) {
      const r = validateApiKey(this._apiKey);
      if (!r.valid) {
        this._apiKeyError = r.error ?? "";
        return true;
      }
    }
    if (this._natsUrl.trim()) {
      const r = validateNatsUrl(this._natsUrl);
      if (!r.valid) {
        this._natsUrlError = r.error ?? "";
        return true;
      }
    }
    if (this._agentId.trim()) {
      const r = validateAgentId(this._agentId);
      if (!r.valid) {
        this._agentIdError = r.error ?? "";
        return true;
      }
    }
    if (this._agentName.trim()) {
      const r = validateAgentName(this._agentName);
      if (!r.valid) {
        this._agentNameError = r.error ?? "";
        return true;
      }
    }
    return false;
  }

  private _handleSave = async () => {
    if (this._hasValidationErrors()) {
      return;
    }

    this._saving = true;
    this._clearToast();

    try {
      const config: Partial<RegistryConfig> = {
        apiKey: this._apiKey || null,
        natsUrl: this._natsUrl || null,
        natsToken: this._natsToken || null,
        agentId: this._agentId || null,
        agentName: this._agentName || null,
        boundAgentId: this._boundAgentId || null,
      };

      const result = await saveRegistryConfig(this.client, config);

      if (result.ok) {
        this._showToast("配置保存成功", false);
      } else {
        this._showToast(result.error ?? "保存失败", true);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "保存失败，请稍后重试";
      this._showToast(msg, true);
    } finally {
      this._saving = false;
    }
  };

  // ── Toast helpers ───────────────────────────────────────────────────────────

  private _showToast(msg: string, isError: boolean) {
    this._toastMsg = msg;
    this._toastError = isError;
    if (this._toastTimer) {
      clearTimeout(this._toastTimer);
    }
    this._toastTimer = setTimeout(() => {
      this._toastMsg = "";
    }, 4000);
  }

  private _clearToast() {
    this._toastMsg = "";
    if (this._toastTimer) {
      clearTimeout(this._toastTimer);
      this._toastTimer = undefined;
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this._toastTimer) {
      clearTimeout(this._toastTimer);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  render() {
    if (this._loading) {
      return html`
        <div class="header-area">
          <div class="header-text">
            <h1 class="page-title">系统设置</h1>
            <p class="subtitle">管理 AgentRegistry 注册中心和 NATS 连接配置</p>
          </div>
          <div class="tabs">
            <div
              class="tab-item ${this._activeTab === "register" ? "active" : ""}"
              @click=${() => (this._activeTab = "register")}
            >
              Register
            </div>
          </div>
        </div>
        <div class="content-area">
          <div class="loading-state">
            <div class="spinner"></div>
            <div>加载配置中…</div>
          </div>
        </div>
      `;
    }

    return html`
      <div class="header-area">
        <div class="header-text">
          <h1 class="page-title">系统设置</h1>
          <p class="subtitle">管理 AgentRegistry 注册中心和 NATS 连接配置</p>
        </div>
        <div class="tabs">
          <div
            class="tab-item ${this._activeTab === "register" ? "active" : ""}"
            @click=${() => (this._activeTab = "register")}
          >
            Register
          </div>
        </div>
      </div>

      <div class="content-area">
        <div class="settings-container">
          <h2 class="section-title">AgentRegistry 配置</h2>

          <!-- API Key -->
          <div class="form-group">
            <label class="form-label">API Key</label>
            <div class="input-wrapper">
              <input
                class="form-input with-toggle ${this._apiKeyError ? "has-error" : ""}"
                type="${this._apiKeyVisible ? "text" : "password"}"
                placeholder="api-ar-..."
                .value=${this._apiKey}
                @input=${(e: Event) => {
                  this._apiKey = (e.target as HTMLInputElement).value;
                  this._apiKeyError = "";
                }}
                @blur=${this._onApiKeyBlur}
                autocomplete="off"
              />
              <button
                class="toggle-visibility"
                type="button"
                @click=${() => {
                  this._apiKeyVisible = !this._apiKeyVisible;
                }}
                title="${this._apiKeyVisible ? "隐藏" : "显示"}"
                aria-label="${this._apiKeyVisible ? "隐藏 API Key" : "显示 API Key"}"
              >
                ${this._apiKeyVisible ? "隐藏" : "显示"}
              </button>
            </div>
            ${this._apiKeyError ? html`<div class="field-error">${this._apiKeyError}</div>` : ""}
          </div>

          <!-- NATS Config (Admin only) -->
          ${this.role === "admin" ? this._renderNatsSection() : ""}

          <!-- Save -->
          <div class="save-row">
            <button class="btn-save" ?disabled=${this._saving} @click=${this._handleSave}>
              ${this._saving ? "保存中…" : "保存配置"}
            </button>
            ${this._toastMsg
              ? html`<span class="toast ${this._toastError ? "error" : "success"}"
                  >${this._toastMsg}</span
                >`
              : ""}
          </div>
        </div>
      </div>
    `;
  }

  private _renderNatsSection() {
    return html`
      <div class="nats-section">
        <h3 class="section-title">NATS 配置</h3>

        <!-- NATS URL -->
        <div class="form-group">
          <label class="form-label">NATS URL</label>
          <input
            class="form-input ${this._natsUrlError ? "has-error" : ""}"
            type="text"
            placeholder="nats://host:4222"
            .value=${this._natsUrl}
            @input=${(e: Event) => {
              this._natsUrl = (e.target as HTMLInputElement).value;
              this._natsUrlError = "";
            }}
            @blur=${this._onNatsUrlBlur}
          />
          ${this._natsUrlError ? html`<div class="field-error">${this._natsUrlError}</div>` : ""}
        </div>

        <!-- NATS Token -->
        <div class="form-group">
          <label class="form-label">NATS Token</label>
          <input
            class="form-input"
            type="password"
            placeholder="NATS 认证 Token"
            .value=${this._natsToken}
            @input=${(e: Event) => {
              this._natsToken = (e.target as HTMLInputElement).value;
            }}
            autocomplete="off"
          />
        </div>

        <!-- Agent ID -->
        <div class="form-group">
          <label class="form-label">Agent ID</label>
          <input
            class="form-input ${this._agentIdError ? "has-error" : ""}"
            type="text"
            placeholder="Agent-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
            .value=${this._agentId}
            @input=${(e: Event) => {
              this._agentId = (e.target as HTMLInputElement).value;
              this._agentIdError = "";
            }}
            @blur=${this._onAgentIdBlur}
          />
          ${this._agentIdError ? html`<div class="field-error">${this._agentIdError}</div>` : ""}
        </div>

        <!-- Agent Name -->
        <div class="form-group">
          <label class="form-label">Agent Name</label>
          <input
            class="form-input ${this._agentNameError ? "has-error" : ""}"
            type="text"
            placeholder="Agent 显示名称"
            .value=${this._agentName}
            @input=${(e: Event) => {
              this._agentName = (e.target as HTMLInputElement).value;
              this._agentNameError = "";
            }}
            @blur=${this._onAgentNameBlur}
          />
          ${this._agentNameError
            ? html`<div class="field-error">${this._agentNameError}</div>`
            : ""}
        </div>

        <!-- Bound Agent ID (Dropdown) -->
        <div class="form-group">
          <label class="form-label">Bound Agent ID</label>
          <select
            class="form-select"
            .value=${this._boundAgentId}
            @change=${(e: Event) => {
              this._boundAgentId = (e.target as HTMLSelectElement).value;
            }}
          >
            <option value="">-- 选择本地 Agent --</option>
            ${this.localAgents.map(
              (agent) => html`
                <option value=${agent.id} ?selected=${this._boundAgentId === agent.id}>
                  ${agent.name || agent.id}
                </option>
              `,
            )}
          </select>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "settings-registry": SettingsRegistry;
  }
}
