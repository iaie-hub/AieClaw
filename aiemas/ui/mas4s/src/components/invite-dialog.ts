import { LitElement, html, css, nothing } from "lit";
import { customElement, property, state } from "lit/decorators.js";
import { getClient } from "../gateway/client.js";
import { AppStore } from "../store/app-store.js";
import type { MasSession, MasParticipant } from "../types/session-types.js";
import type { UserRecord } from "../views/user-list-view.js";

/**
 * 邀请与成员管理弹窗。
 * 显示当前成员列表（支持移除）以及用户搜索邀请功能。
 */
@customElement("invite-dialog")
export class InviteDialog extends LitElement {
  @property({ attribute: false }) session!: MasSession;

  @state() private _allUsers: UserRecord[] = [];
  @state() private _searchQuery = "";

  static styles = css`
    :host {
      display: block;
    }

    .overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.4);
      backdrop-filter: blur(4px);
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .dialog-card {
      background: white;
      border-radius: 20px;
      padding: 32px;
      width: 520px;
      max-width: 95vw;
      max-height: 85vh;
      box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    h3 {
      margin: 0 0 24px;
      font-size: 20px;
      font-weight: 700;
      color: #0f172a;
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .section-title {
      font-size: 13px;
      font-weight: 600;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.025em;
      margin: 20px 0 12px;
    }

    /* ── 列表区域 ── */
    .scroll-area {
      flex: 1;
      overflow-y: auto;
      margin-bottom: 24px;
      padding-right: 4px;
    }

    .scroll-area::-webkit-scrollbar {
      width: 6px;
    }
    .scroll-area::-webkit-scrollbar-thumb {
      background: #cbd5e1;
      border-radius: 3px;
    }

    .member-item,
    .search-item {
      display: flex;
      align-items: center;
      padding: 10px 12px;
      border-radius: 12px;
      transition: background 0.2s;
    }

    .member-item:hover,
    .search-item:hover {
      background: #f1f5f9;
    }

    .avatar {
      width: 32px;
      height: 32px;
      border-radius: 50%;
      background: #e2e8f0;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 12px;
      font-weight: 600;
      color: #475569;
      margin-right: 12px;
    }

    .user-info {
      flex: 1;
      min-width: 0;
    }

    .user-name {
      font-size: 14px;
      font-weight: 500;
      color: #1e293b;
    }

    .user-handle {
      font-size: 12px;
      color: #94a3b8;
    }

    .action-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 8px;
      font-size: 12px;
      font-weight: 500;
      cursor: pointer;
      border: 1px solid #e2e8f0;
      background: white;
      transition: all 0.2s;
    }

    .action-btn.invite {
      color: #3b82f6;
      border-color: #bfdbfe;
    }

    .action-btn.invite:hover {
      background: #eff6ff;
    }

    .action-btn.remove {
      color: #ef4444;
      border-color: #fecaca;
    }

    .action-btn.remove:hover {
      background: #fef2f2;
    }

    .owner-badge {
      font-size: 11px;
      color: #f59e0b;
      background: #fef3c7;
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 600;
    }

    /* ── 搜索框 ── */
    .search-box {
      margin-bottom: 12px;
      position: relative;
    }

    .search-input {
      width: 100%;
      padding: 10px 14px 10px 36px;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      font-size: 13px;
      outline: none;
      box-sizing: border-box;
      transition: border-color 0.2s;
    }

    .search-input:focus {
      border-color: #3b82f6;
    }

    .search-icon {
      position: absolute;
      left: 12px;
      top: 50%;
      transform: translateY(-50%);
      color: #94a3b8;
    }

    .close-footer {
      padding-top: 16px;
      border-top: 1px solid #f1f5f9;
    }

    .close-btn {
      width: 100%;
      padding: 12px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      font-size: 14px;
      font-weight: 600;
      color: #64748b;
      cursor: pointer;
      transition: all 0.2s;
    }

    .close-btn:hover {
      background: #f1f5f9;
      color: #475569;
    }
  `;

  async connectedCallback() {
    super.connectedCallback();
    this._fetchMembers();
    await this._loadUsers();
  }

  private _fetchMembers() {
    this.dispatchEvent(
      new CustomEvent("members-fetch", {
        detail: { sessionKey: this.session.key },
        bubbles: true,
        composed: true,
      }),
    );
  }

  private async _loadUsers() {
    try {
      const client = getClient();
      const tenantId = AppStore.instance.currentUser?.tenantId || "";
      if (!tenantId) {
        console.warn("[mas4s:invite] No tenantId found for user.list");
        return;
      }
      const res = await client.request<UserRecord[]>("user.list", { tenantId });
      this._allUsers = Array.isArray(res) ? res : [];
    } catch (err) {
      console.error("[mas4s:invite] failed to load users:", err);
    }
  }

  private _onSearchInput = (e: InputEvent) => {
    this._searchQuery = (e.target as HTMLInputElement).value;
  };

  private _onInvite = (userId: string) => {
    this.dispatchEvent(
      new CustomEvent("user-invite", {
        detail: { sessionKey: this.session.key, userId },
        bubbles: true,
        composed: true,
      }),
    );
  };

  private _onRemove = (userId: string) => {
    if (!confirm("确定要移除该成员吗？")) {
      return;
    }
    this.dispatchEvent(
      new CustomEvent("member-remove", {
        detail: { sessionKey: this.session.key, userId },
        bubbles: true,
        composed: true,
      }),
    );
  };

  private _onClose = () => {
    this.dispatchEvent(new CustomEvent("close", { bubbles: true }));
  };

  private _onOverlayClick = (e: Event) => {
    if (e.target === e.currentTarget) {
      this._onClose();
    }
  };

  private _renderMember(p: MasParticipant) {
    const isInitiator = this.session.masType === "initiated";
    const iconRemove = html`
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <line x1="18" y1="6" x2="6" y2="18"></line>
        <line x1="6" y1="6" x2="18" y2="18"></line>
      </svg>
    `;

    return html`
      <div class="member-item">
        <div class="avatar">${(p.name || "?").charAt(0).toUpperCase()}</div>
        <div class="user-info">
          <div class="user-name">
            ${p.name} 
            ${
              p.isInitiator
                ? html`
                    <span class="owner-badge">所有者</span>
                  `
                : nothing
            }
          </div>
          <div class="user-handle">${p.id}</div>
        </div>
        ${
          isInitiator && !p.isInitiator
            ? html`
              <button class="action-btn remove" @click=${() => this._onRemove(p.id)}>
                ${iconRemove} 移除
              </button>
            `
            : nothing
        }
      </div>
    `;
  }

  private _renderSearchResult(u: UserRecord) {
    const isAlreadyMember = this.session.participants?.some((p) => p.id === u.userId);
    if (isAlreadyMember) {
      return nothing;
    }

    const iconInvite = html`
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
        <circle cx="9" cy="7" r="4"></circle>
        <line x1="19" y1="8" x2="19" y2="14"></line>
        <line x1="22" y1="11" x2="16" y2="11"></line>
      </svg>
    `;

    return html`
      <div class="search-item">
        <div class="avatar">${u.displayName.charAt(0).toUpperCase()}</div>
        <div class="user-info">
          <div class="user-name">${u.displayName}</div>
          <div class="user-handle">@${u.username}</div>
        </div>
        <button class="action-btn invite" @click=${() => this._onInvite(u.userId)}>
          ${iconInvite} 邀请
        </button>
      </div>
    `;
  }

  render() {
    const query = this._searchQuery.toLowerCase().trim();
    // Show all users if no query, or filter if there is one.
    // Excluding those already in the session.
    const filteredUsers = this._allUsers
      .filter((u) => {
        const isAlreadyMember = this.session.participants?.some((p) => p.id === u.userId);
        if (isAlreadyMember) {
          return false;
        }
        if (!query) {
          return true;
        }
        return (
          u.username.toLowerCase().includes(query) || u.displayName.toLowerCase().includes(query)
        );
      })
      .slice(0, 50); // Show more users now that it's persistent

    const iconUsers = html`
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
        <circle cx="9" cy="7" r="4"></circle>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
      </svg>
    `;
    const iconSearch = html`
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <circle cx="11" cy="11" r="8"></circle>
        <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
      </svg>
    `;

    return html`
      <div class="overlay" @click=${this._onOverlayClick}>
        <div class="dialog-card">
          <h3>${iconUsers} 协作管理</h3>
          
          <div class="scroll-area">
            <div class="section-title">会话成员 (${this.session.participants?.length || 0})</div>
            <div class="member-list">
              ${this.session.participants?.map((p) => this._renderMember(p))}
            </div>

            <div class="section-title">邀请新成员</div>
            <div class="search-box">
              <span class="search-icon">${iconSearch}</span>
              <input 
                class="search-input" 
                placeholder="搜索用户名或显示名称..." 
                .value=${this._searchQuery}
                @input=${this._onSearchInput}
              />
            </div>
            <div class="search-results">
              ${filteredUsers.map((u) => this._renderSearchResult(u))}
              ${filteredUsers.length === 0 ? html`<div style="padding:10px;color:#94a3b8;font-size:12px;text-align:center">${query ? "未找到匹配的用户" : "暂无可邀请的用户"}</div>` : nothing}
            </div>
          </div>

          <div class="close-footer">
            <button class="close-btn" @click=${this._onClose}>完成</button>
          </div>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "invite-dialog": InviteDialog;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "invite-dialog": InviteDialog;
  }
}
