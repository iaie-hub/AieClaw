import { LitElement, html, css } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { fetchNatsSettings, saveNatsSettings } from "../gateway/clawhub-api.js";
import type { GatewayBrowserClient } from "../lib/gateway.js";
import type { AgentInfo } from "../store/app-store.js";
import {
  validateNatsUrl,
  validateAgentId,
  validateAgentName,
} from "../utils/registry-validators.js";

const EYE_ICON = html`
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
    <circle cx="12" cy="12" r="3"></circle>
  </svg>
`;

const EYE_OFF_ICON = html`
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
  >
    <path
      d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"
    ></path>
    <line x1="1" y1="1" x2="23" y2="23"></line>
  </svg>
`;

/**
 * NATS 配置设置页面配置区域组件（NATS 页签内容）。
 */
@customElement("settings-nats")
export class SettingsNats extends LitElement {
  /** Gateway client instance passed from parent settings-view */
  @property({ attribute: false }) client!: GatewayBrowserClient;

  /** Current user role */
  @property({ type: String }) role: string = "viewer";

  /** Local agents list for Bound Agent ID dropdown */
  @property({ attribute: false }) localAgents: AgentInfo[] = [];

  // ── Form state ──────────────────────────────────────────────────────────────

  @state() private _natsUrl = "";
  @state() private _natsUrlError = "";

  @state() private _natsToken = "";
  @state() private _natsTokenVisible = false;

  @state() private _agentId = "";
  @state() private _agentIdError = "";

  @state() private _agentName = "";
  @state() private _agentNameError = "";

  @state() private _boundAgentId = "";

  // ── UI state ────────────────────────────────────────────────────────────────

  @state() private _saving = false;
  @state() private _loading = true;
  @state() private _toastMsg = "";
  @state() private _toastError = false;
  private _toastTimer: ReturnType<typeof setTimeout> | undefined;

  static styles = css`
    :host {
      display: block;
      width: 100%;
      padding: 32px;
      box-sizing: border-box;
    }

    .settings-container {
      width: 100%;
      max-width: 600px;
      box-sizing: border-box;
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
      padding: 6px;
      border-radius: 6px;
      color: #64748b;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      transition: all 0.2s;
    }

    .toggle-visibility:hover {
      color: #1e293b;
      background-color: #f1f5f9;
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
      const config = await fetchNatsSettings(this.client);
      this._natsUrl = config.natsUrl ?? "";
      this._natsToken = config.natsToken ?? "";
      this._agentId = config.agentId ?? "";
      this._agentName = config.agentName ?? "";
      this._boundAgentId = config.boundAgentId ?? "";
    } catch {
      // Config load failed — leave fields empty
    } finally {
      this._loading = false;
    }
  }

  // ── Validation handlers ─────────────────────────────────────────────────────

  private _onNatsUrlBlur = () => {
    if (this._natsUrl.trim() === "") {
      this._natsUrlError = "";
      return;
    }
    const result = validateNatsUrl(this._natsUrl);
    this._natsUrlError = result.valid ? "" : (result.error ?? "");
  };

  private _onAgentIdBlur = () => {
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
      const config = {
        natsUrl: this._natsUrl || null,
        natsToken: this._natsToken || null,
        agentId: this._agentId || null,
        agentName: this._agentName || null,
        boundAgentId: this._boundAgentId || null,
      };

      const result = await saveNatsSettings(this.client, config);

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
        <div class="loading-state">
          <div class="spinner"></div>
          <div>加载配置中…</div>
        </div>
      `;
    }

    return html`
      <div class="settings-container">
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
          <div class="input-wrapper">
            <input
              class="form-input with-toggle"
              type="${this._natsTokenVisible ? "text" : "password"}"
              placeholder="NATS 认证 Token"
              .value=${this._natsToken}
              @input=${(e: Event) => {
                this._natsToken = (e.target as HTMLInputElement).value;
              }}
              autocomplete="off"
            />
            <button
              class="toggle-visibility"
              type="button"
              @click=${() => {
                this._natsTokenVisible = !this._natsTokenVisible;
              }}
              title="${this._natsTokenVisible ? "隐藏" : "显示"}"
              aria-label="${this._natsTokenVisible ? "隐藏 NATS Token" : "显示 NATS Token"}"
            >
              ${this._natsTokenVisible ? EYE_OFF_ICON : EYE_ICON}
            </button>
          </div>
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
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "settings-nats": SettingsNats;
  }
}
