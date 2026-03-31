import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { AgentInfo } from "../store/app-store.js";

interface ConfirmDetail {
  label: string;
  agentId?: string;
  reasoningLevel: "stream" | "on" | "off";
}

@customElement("session-name-dialog")
export class SessionNameDialog extends LitElement {
  @property({ type: String }) mode: "create" | "rename" = "create";
  @property({ type: String }) initialValue = "";
  @property({ type: String }) initialAgentId?: string;
  @property({ type: String }) initialReasoningLevel: "stream" | "on" | "off" = "stream";
  @property({ attribute: false }) agents: AgentInfo[] = [];

  @state() private _value = "";
  @state() private _agentId?: string;
  @state() private _reasoningLevel: "stream" | "on" | "off" = "stream";

  static styles = css`
    .name-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.25);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
    }

    .name-dialog {
      background: white;
      border-radius: 12px;
      padding: 20px 24px;
      width: 320px;
      box-shadow: 0 8px 32px rgba(0, 0, 0, 0.15);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .name-dialog h3 {
      margin: 0;
      font-size: 15px;
      font-weight: 600;
      color: #1e293b;
    }

    .name-dialog input {
      width: 100%;
      padding: 8px 10px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      font-size: 14px;
      outline: none;
      box-sizing: border-box;
      transition: border-color 0.15s;
    }

    .name-dialog input:focus {
      border-color: #3b82f6;
    }

    .name-dialog-actions {
      display: flex;
      gap: 8px;
      justify-content: flex-end;
      margin-top: 4px;
    }

    .name-dialog-actions button {
      padding: 6px 16px;
      border-radius: 8px;
      font-size: 13px;
      cursor: pointer;
      border: 1px solid #e2e8f0;
      background: white;
      color: #64748b;
      transition: all 0.15s;
    }

    .name-dialog-actions button.primary {
      background: #3b82f6;
      color: white;
      border-color: #3b82f6;
    }

    .name-dialog-actions button:hover {
      opacity: 0.85;
    }

    .reasoning-toggle {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 13px;
      color: #475569;
      margin-top: 4px;
    }

    .reasoning-toggle span {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .reasoning-toggle small {
      font-size: 11px;
      color: #94a3b8;
    }

    .toggle-switch {
      position: relative;
      width: 36px;
      height: 20px;
      flex-shrink: 0;
    }

    .toggle-switch input {
      opacity: 0;
      width: 0;
      height: 0;
      position: absolute;
    }

    .toggle-track {
      position: absolute;
      inset: 0;
      background: #cbd5e1;
      border-radius: 10px;
      cursor: pointer;
      transition: background 0.2s;
    }

    .toggle-track::after {
      content: "";
      position: absolute;
      top: 3px;
      left: 3px;
      width: 14px;
      height: 14px;
      background: white;
      border-radius: 50%;
      transition: transform 0.2s;
    }

    .toggle-switch input:checked + .toggle-track {
      background: #3b82f6;
    }

    .toggle-switch input:checked + .toggle-track::after {
      transform: translateX(16px);
    }

    /* Agent 选择列表 */
    .agent-selector {
      margin-top: 4px;
    }

    .agent-selector-label {
      font-size: 11px;
      font-weight: 600;
      color: #94a3b8;
      margin-bottom: 6px;
      display: block;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .agent-options {
      display: flex;
      flex-direction: column;
      gap: 4px;
      max-height: 160px;
      overflow-y: auto;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      padding: 4px;
      background: #f8fafc;
    }

    .agent-option {
      padding: 6px 10px;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      transition: all 0.15s;
      border: 1px solid transparent;
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .agent-option:hover {
      background: #f1f5f9;
    }

    .agent-option.active {
      background: #ecfeff;
      border-color: #0891b2;
      color: #0e7490;
    }

    .agent-option-name {
      font-weight: 600;
    }

    .agent-option-desc {
      font-size: 11px;
      color: #64748b;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    this._value = this.initialValue;
    this._agentId = this.initialAgentId;
    this._reasoningLevel = this.initialReasoningLevel;

    // Default agentId if not set and creating
    if (this.mode === "create" && !this._agentId && this.agents.length > 0) {
      this._agentId = this.agents[0].id;
    }
  }

  private _onInput = (e: Event) => {
    const input = e.target as HTMLInputElement;
    this._value = input.value;
  };

  private _onAgentSelect = (agentId: string) => {
    this._agentId = agentId;
  };

  private _onKeydown = (e: KeyboardEvent) => {
    if (e.key === "Enter" && !e.isComposing) {
      this._confirm();
    }
    if (e.key === "Escape") {
      this._cancel();
    }
  };

  private _confirm = () => {
    const label = this._value.trim();
    if (!label) {
      return;
    }

    this.dispatchEvent(
      new CustomEvent<ConfirmDetail>("confirm", {
        detail: {
          label,
          agentId: this._agentId,
          reasoningLevel: this._reasoningLevel,
        },
      }),
    );
  };

  private _cancel = () => {
    this.dispatchEvent(new CustomEvent("cancel"));
  };

  render() {
    const isCreate = this.mode === "create";
    const title = isCreate ? "新建会话" : "重命名会话";
    const streamEnabled = this._reasoningLevel === "stream";

    return html`
      <div class="name-overlay" @click=${this._cancel}>
        <div class="name-dialog" @click=${(e: Event) => e.stopPropagation()}>
          <h3>${title}</h3>
          <input
            type="text"
            .value=${this._value}
            placeholder=${isCreate ? "输入会话名称" : "重命名为..."}
            @input=${this._onInput}
            @keydown=${this._onKeydown}
            autofocus
          />

          ${isCreate
            ? html`
                <div class="agent-selector">
                  <span class="agent-selector-label">选择执行 Agent</span>
                  <div class="agent-options">
                    ${this.agents.length === 0
                      ? html`<div class="agent-option">未发现可用 Agent</div>`
                      : this.agents.map(
                          (a) => html`
                            <div
                              class="agent-option ${a.id === this._agentId ? "active" : ""}"
                              @click=${() => this._onAgentSelect(a.id)}
                            >
                              <div class="agent-option-name">${a.name || a.id}</div>
                              ${a.description
                                ? html`<div class="agent-option-desc">${a.description}</div>`
                                : ""}
                            </div>
                          `,
                        )}
                  </div>
                </div>
              `
            : nothing}

          <div class="reasoning-toggle">
            <span>
              启用思考过程
              <small>开启后 AI 会实时输出推理内容</small>
            </span>
            <label class="toggle-switch">
              <input
                type="checkbox"
                .checked=${streamEnabled}
                @change=${(e: Event) => {
                  this._reasoningLevel = (e.target as HTMLInputElement).checked ? "stream" : "off";
                }}
              />
              <span class="toggle-track"></span>
            </label>
          </div>
          <div class="name-dialog-actions">
            <button @click=${this._cancel}>取消</button>
            <button class="primary" @click=${this._confirm}>确认</button>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "session-name-dialog": SessionNameDialog;
  }
}
