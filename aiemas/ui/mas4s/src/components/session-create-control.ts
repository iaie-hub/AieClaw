import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import type { AgentInfo } from "../store/app-store.js";
import "./session-name-dialog.js";

@customElement("session-create-control")
export class SessionCreateControl extends LitElement {
  @property({ attribute: false }) agents: AgentInfo[] = [];

  @state() private _showDialog = false;

  static styles = css`
    .add-btn {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      background: #eff6ff;
      border: 1px solid #dbeafe;
      color: #2563eb;
      font-size: 18px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      transition: all 0.2s;
    }

    .add-btn:hover {
      background: #dbeafe;
      border-color: #bfdbfe;
    }
  `;

  private _onOpenDialog = () => {
    this._showDialog = true;
  };

  private _onConfirmCreate = (
    e: CustomEvent<{ label: string; agentId?: string; reasoningLevel: string }>,
  ) => {
    this.dispatchEvent(
      new CustomEvent("session-create", {
        detail: e.detail,
        bubbles: true,
        composed: true,
      }),
    );
    this._showDialog = false;
  };

  render() {
    return html`
      <button
        class="add-btn"
        @click=${this._onOpenDialog}
        aria-label="发起新会话"
        title="发起新会话"
      >
        +
      </button>

      ${this._showDialog
        ? html`
            <session-name-dialog
              mode="create"
              .agents=${this.agents}
              @confirm=${this._onConfirmCreate}
              @cancel=${() => (this._showDialog = false)}
            ></session-name-dialog>
          `
        : nothing}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "session-create-control": SessionCreateControl;
  }
}
