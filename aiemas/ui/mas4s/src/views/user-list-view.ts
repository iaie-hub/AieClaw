import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { getClient } from "../gateway/client.js";
import { AppStore, AppStoreController } from "../store/app-store.js";
import "../components/main-header.js";

export type UserStatus = "pending" | "approved" | "rejected";

export interface UserRecord {
  userId: string;
  username: string;
  displayName: string;
  role: "admin" | "member" | "viewer";
  tenantId: string;
  status?: UserStatus;
  isOnline?: boolean;
  lastSeenAt?: number;
  lastLoginAt?: number;
  lastOfflineAt?: number;
  createdAt: number;
}

/**
 * 用户列表视图。
 * - 显示当前租户下所有用户及其状态
 * - 点击用户显示详情面板
 * - admin 角色可审批/拒绝 pending 用户
 */
@customElement("user-list-view")
export class UserListView extends LitElement {
  private _ctrl = new AppStoreController(this);

  @state() private _users: UserRecord[] = [];
  @state() private _loading = false;
  @state() private _error = "";
  @state() private _selectedUser: UserRecord | null = null;
  @state() private _actionLoading = "";

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      overflow: hidden;
      background: #f8fafc;
    }

    .container {
      display: flex;
      flex: 1;
      overflow: hidden;
    }

    /* ── 用户列表面板 ── */
    .list-panel {
      width: 340px;
      min-width: 280px;
      display: flex;
      flex-direction: column;
      background: #fff;
      border-right: 1px solid #e2e8f0;
      overflow: hidden;
    }

    .panel-header {
      padding: 20px 20px 12px;
      border-bottom: 1px solid #f1f5f9;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .panel-title {
      font-size: 15px;
      font-weight: 600;
      color: #1e293b;
    }

    .refresh-btn {
      padding: 4px 10px;
      background: transparent;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      cursor: pointer;
      font-size: 12px;
      color: #64748b;
      transition: all 0.2s;
    }

    .refresh-btn:hover {
      background: #f8fafc;
      border-color: #cbd5e1;
    }

    .user-list {
      flex: 1;
      overflow-y: auto;
      padding: 8px 0;
    }

    .user-item {
      display: flex;
      align-items: center;
      padding: 10px 16px;
      cursor: pointer;
      transition: background 0.15s;
      border-left: 3px solid transparent;
    }

    .user-item:hover {
      background: #f8fafc;
    }

    .user-item.selected {
      background: #eff6ff;
      border-left-color: #3b82f6;
    }

    .avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 14px;
      font-weight: 600;
      color: #fff;
      flex-shrink: 0;
      margin-right: 10px;
    }

    .avatar.admin {
      background: linear-gradient(135deg, #f59e0b, #d97706);
    }
    .avatar.member {
      background: linear-gradient(135deg, #3b82f6, #6366f1);
    }
    .avatar.viewer {
      background: linear-gradient(135deg, #94a3b8, #64748b);
    }

    .user-info {
      flex: 1;
      min-width: 0;
    }

    .user-name {
      font-size: 13px;
      font-weight: 500;
      color: #1e293b;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .user-meta {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 2px;
    }

    .role-badge {
      font-size: 10px;
      padding: 1px 6px;
      border-radius: 10px;
      font-weight: 500;
    }

    .role-badge.admin {
      background: #fef3c7;
      color: #92400e;
    }
    .role-badge.member {
      background: #dbeafe;
      color: #1e40af;
    }
    .role-badge.viewer {
      background: #f1f5f9;
      color: #475569;
    }

    .status-dot {
      width: 7px;
      height: 7px;
      border-radius: 50%;
      flex-shrink: 0;
    }

    .status-dot.approved {
      background: #22c55e;
    }
    .status-dot.pending {
      background: #f59e0b;
    }
    .status-dot.rejected {
      background: #ef4444;
    }

    .status-label {
      font-size: 11px;
      color: #94a3b8;
    }

    /* ── 在线状态指示器 ── */
    .presence-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      flex-shrink: 0;
      border: 1.5px solid #fff;
      box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.08);
    }

    .presence-dot.online {
      background: #22c55e;
    }
    .presence-dot.offline {
      background: #cbd5e1;
    }

    /* ── 详情面板 ── */
    .detail-panel {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .detail-empty {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #94a3b8;
      font-size: 14px;
    }

    .detail-content {
      flex: 1;
      overflow-y: auto;
      padding: 28px 32px;
    }

    .detail-avatar {
      width: 64px;
      height: 64px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 24px;
      font-weight: 700;
      color: #fff;
      margin-bottom: 16px;
    }

    .detail-display-name {
      font-size: 20px;
      font-weight: 600;
      color: #1e293b;
      margin-bottom: 4px;
    }

    .detail-username {
      font-size: 13px;
      color: #64748b;
      margin-bottom: 20px;
    }

    .detail-fields {
      display: flex;
      flex-direction: column;
      gap: 12px;
      margin-bottom: 28px;
    }

    .field-row {
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .field-label {
      width: 72px;
      font-size: 12px;
      color: #94a3b8;
      flex-shrink: 0;
    }

    .field-value {
      font-size: 13px;
      color: #334155;
    }

    .status-chip {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      padding: 3px 10px;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 500;
    }

    .status-chip.approved {
      background: #dcfce7;
      color: #166534;
    }
    .status-chip.pending {
      background: #fef9c3;
      color: #854d0e;
    }
    .status-chip.rejected {
      background: #fee2e2;
      color: #991b1b;
    }

    /* ── 审批操作区 ── */
    .approval-section {
      padding: 20px 24px;
      background: #fffbeb;
      border: 1px solid #fde68a;
      border-radius: 10px;
      margin-bottom: 16px;
    }

    .approval-title {
      font-size: 13px;
      font-weight: 600;
      color: #92400e;
      margin-bottom: 12px;
    }

    .approval-actions {
      display: flex;
      gap: 10px;
    }

    .btn {
      padding: 7px 18px;
      border-radius: 7px;
      font-size: 13px;
      font-weight: 500;
      cursor: pointer;
      border: none;
      transition: all 0.2s;
    }

    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .btn-approve {
      background: #22c55e;
      color: #fff;
    }

    .btn-approve:hover:not(:disabled) {
      background: #16a34a;
    }

    .btn-reject {
      background: transparent;
      color: #ef4444;
      border: 1px solid #fca5a5;
    }

    .btn-reject:hover:not(:disabled) {
      background: #fee2e2;
    }

    /* ── 状态/错误 ── */
    .loading-wrap,
    .error-wrap {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      color: #94a3b8;
      font-size: 14px;
    }

    .error-wrap {
      color: #ef4444;
    }

    .action-feedback {
      font-size: 12px;
      color: #22c55e;
      margin-top: 8px;
    }
  `;

  connectedCallback() {
    super.connectedCallback();
    void this._loadUsers();
  }

  private async _loadUsers() {
    this._loading = true;
    this._error = "";
    try {
      const client = getClient();
      const store = AppStore.instance;
      const tenantId = store.currentUser?.tenantId ?? "";
      const res = await client.request<UserRecord[]>("user.list", { tenantId });
      // res may be the array directly or wrapped
      this._users = Array.isArray(res) ? res : [];
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    } finally {
      this._loading = false;
    }
  }

  private _selectUser(user: UserRecord) {
    this._selectedUser = this._selectedUser?.userId === user.userId ? null : user;
  }

  private async _approve(userId: string) {
    this._actionLoading = userId + ":approve";
    try {
      const client = getClient();
      await client.request("user.approve", { targetUserId: userId });
      // Update local state
      this._users = this._users.map((u) =>
        u.userId === userId ? { ...u, status: "approved" as UserStatus } : u,
      );
      if (this._selectedUser?.userId === userId) {
        this._selectedUser = { ...this._selectedUser, status: "approved" };
      }
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    } finally {
      this._actionLoading = "";
    }
  }

  private async _reject(userId: string) {
    this._actionLoading = userId + ":reject";
    try {
      const client = getClient();
      await client.request("user.reject", { targetUserId: userId });
      this._users = this._users.map((u) =>
        u.userId === userId ? { ...u, status: "rejected" as UserStatus } : u,
      );
      if (this._selectedUser?.userId === userId) {
        this._selectedUser = { ...this._selectedUser, status: "rejected" };
      }
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    } finally {
      this._actionLoading = "";
    }
  }

  private _statusLabel(status?: UserStatus): string {
    if (!status) {
      return "";
    }
    return { approved: "已通过", pending: "待审批", rejected: "已拒绝" }[status] ?? status;
  }

  private _roleLabel(role: string): string {
    return { admin: "管理员", member: "成员", viewer: "观察者" }[role] ?? role;
  }

  private _avatarLetter(user: UserRecord): string {
    return (user.displayName || user.username).charAt(0).toUpperCase();
  }

  private _renderUserItem(user: UserRecord) {
    const isSelected = this._selectedUser?.userId === user.userId;
    const isAdmin = this._ctrl.store.currentUser?.role === "admin";
    // Merge real-time presence override from store (user.presence events)
    const overrides = this._ctrl.store.userPresenceOverrides;
    const isOnline = overrides.has(user.userId) ? overrides.get(user.userId) : user.isOnline;
    return html`
      <div
        class="user-item ${isSelected ? "selected" : ""}"
        @click=${() => this._selectUser(user)}
        role="button"
        tabindex="0"
        @keydown=${(e: KeyboardEvent) => e.key === "Enter" && !e.isComposing && this._selectUser(user)}
        aria-label="查看用户 ${user.displayName}"
      >
        <div class="avatar ${user.role}">${this._avatarLetter(user)}</div>
        <div class="user-info">
          <div class="user-name">${user.displayName}</div>
          <div class="user-meta">
            <span class="presence-dot ${isOnline ? "online" : "offline"}" title="${isOnline ? "在线" : "离线"}"></span>
            <span class="role-badge ${user.role}">${this._roleLabel(user.role)}</span>
            ${
              isAdmin && user.status
                ? html`
                  <span class="status-dot ${user.status}"></span>
                  <span class="status-label">${this._statusLabel(user.status)}</span>
                `
                : ""
            }
          </div>
        </div>
      </div>
    `;
  }

  private _renderDetail() {
    const user = this._selectedUser;
    if (!user) {
      return html`
        <div class="detail-empty">点击左侧用户查看详情</div>
      `;
    }

    const isAdmin = this._ctrl.store.currentUser?.role === "admin";
    const isPending = user.status === "pending";
    const isApproving = this._actionLoading === user.userId + ":approve";
    const isRejecting = this._actionLoading === user.userId + ":reject";
    // Merge real-time presence override from store
    const overrides = this._ctrl.store.userPresenceOverrides;
    const isOnline = overrides.has(user.userId) ? overrides.get(user.userId) : user.isOnline;

    return html`
      <div class="detail-content">
        <div class="detail-avatar ${user.role}">${this._avatarLetter(user)}</div>
        <div class="detail-display-name">${user.displayName}</div>
        <div class="detail-username">@${user.username}</div>

        <div class="detail-fields">
          <div class="field-row">
            <span class="field-label">角色</span>
            <span class="role-badge ${user.role} field-value">${this._roleLabel(user.role)}</span>
          </div>
          <div class="field-row">
            <span class="field-label">在线状态</span>
            <span class="field-value" style="display:flex;align-items:center;gap:6px;">
              <span class="presence-dot ${isOnline ? "online" : "offline"}"></span>
              ${isOnline ? "在线" : "离线"}
            </span>
          </div>
          ${
            isAdmin && user.status
              ? html`
                <div class="field-row">
                  <span class="field-label">审核状态</span>
                  <span class="status-chip ${user.status}">
                    <span class="status-dot ${user.status}"></span>
                    ${this._statusLabel(user.status)}
                  </span>
                </div>
              `
              : ""
          }
          ${
            user.lastLoginAt
              ? html`
                <div class="field-row">
                  <span class="field-label">上次登录</span>
                  <span class="field-value">${new Date(user.lastLoginAt).toLocaleString("zh-CN")}</span>
                </div>
              `
              : ""
          }
          ${
            !isOnline && user.lastOfflineAt
              ? html`
                <div class="field-row">
                  <span class="field-label">上次离线</span>
                  <span class="field-value">${new Date(user.lastOfflineAt).toLocaleString("zh-CN")}</span>
                </div>
              `
              : ""
          }
          <div class="field-row">
            <span class="field-label">注册时间</span>
            <span class="field-value">${new Date(user.createdAt).toLocaleString("zh-CN")}</span>
          </div>
          <div class="field-row">
            <span class="field-label">用户 ID</span>
            <span class="field-value" style="font-family:monospace;font-size:11px;color:#94a3b8">${user.userId}</span>
          </div>
        </div>

        ${
          isAdmin && isPending
            ? html`
              <div class="approval-section">
                <div class="approval-title">⏳ 该用户正在等待注册审批</div>
                <div class="approval-actions">
                  <button
                    class="btn btn-approve"
                    ?disabled=${isApproving || isRejecting}
                    @click=${() => this._approve(user.userId)}
                  >${isApproving ? "处理中…" : "✓ 通过"}</button>
                  <button
                    class="btn btn-reject"
                    ?disabled=${isApproving || isRejecting}
                    @click=${() => this._reject(user.userId)}
                  >${isRejecting ? "处理中…" : "✗ 拒绝"}</button>
                </div>
              </div>
            `
            : ""
        }
      </div>
    `;
  }

  render() {
    if (this._loading) {
      return html`
        <div class="loading-wrap">加载用户列表中…</div>
      `;
    }
    if (this._error) {
      return html`
        <div class="error-wrap">
          加载失败：${this._error}
          <button class="refresh-btn" style="margin-left:12px" @click=${() => this._loadUsers()}>重试</button>
        </div>
      `;
    }

    return html`
      <main-header 
        title="用户管理" 
        .approvalCount=${this._ctrl.store.pendingApprovals.length}
      ></main-header>
      <div class="container">
        <div class="list-panel">
          <div class="panel-header">
            <span class="panel-title">用户列表（${this._users.length}）</span>
            <button class="refresh-btn" @click=${() => this._loadUsers()}>刷新</button>
          </div>
          <div class="user-list" role="list">
            ${this._users.map((u) => this._renderUserItem(u))}
          </div>
        </div>
        <div class="detail-panel">
          ${this._renderDetail()}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "user-list-view": UserListView;
  }
}
