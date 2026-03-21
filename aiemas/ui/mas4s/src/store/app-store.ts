import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { ApprovalRequest } from "../types/approval-types.js";
import type { ChatMessage } from "../types/chat-types.js";
import type { MasSession } from "../types/session-types.js";

export type GlobalRole = "admin" | "member" | "viewer";

export interface CurrentUser {
  userId: string;
  username: string;
  displayName: string;
  role: GlobalRole;
  tenantId: string;
}

/** 子 Agent 启动确认项（第三期，Prompt Engineering 方案） */
export interface PendingSpawnConfirm {
  sessionKey: string;
  messageId: string;
  agentName: string;
  task: string;
}

export class AppStore {
  private static _instance: AppStore | null = null;

  /** 全局单例 */
  static get instance(): AppStore {
    return (AppStore._instance ??= new AppStore());
  }

  // ── 当前用户 ──────────────────────────────────────
  currentUser: CurrentUser | null = null;

  setCurrentUser(user: CurrentUser): void {
    this.currentUser = user;
    this.notify();
  }

  clearCurrentUser(): void {
    this.currentUser = null;
    this.notify();
  }

  logout(): void {
    localStorage.removeItem("mas4s_auth_token");
    this.currentUser = null;
    this.notify();
  }

  // ── 会话列表 ──────────────────────────────────────
  sessions: MasSession[] = [];
  activeSessionId: string | null = null;

  get activeSession(): MasSession | undefined {
    return this.sessions.find((s) => s.key === this.activeSessionId);
  }

  // ── 消息缓存（sessionKey → 消息数组） ────────────
  messagesBySession: Map<string, ChatMessage[]> = new Map();

  // ── 审批队列（跨会话聚合） ────────────────────────
  pendingApprovals: ApprovalRequest[] = [];

  // ── 子 Agent 启动确认队列（第三期） ───────────────
  pendingSpawnConfirms: PendingSpawnConfirm[] = [];

  // ── 用户在线状态（实时更新） ──────────────────────
  // key: userId, value: isOnline
  userPresenceOverrides: Map<string, boolean> = new Map();

  updateUserPresence(userId: string, isOnline: boolean): void {
    this.userPresenceOverrides.set(userId, isOnline);
    this.notify();
  }

  // ── 响应式通知 ────────────────────────────────────
  private _hosts: Set<ReactiveControllerHost> = new Set();

  addHost(host: ReactiveControllerHost): void {
    this._hosts.add(host);
  }

  removeHost(host: ReactiveControllerHost): void {
    this._hosts.delete(host);
  }

  /** 通知所有已注册 host 重新渲染 */
  notify(): void {
    for (const host of this._hosts) {
      host.requestUpdate();
    }
  }

  // ── 会话操作 ──────────────────────────────────────

  setSessions(sessions: MasSession[]): void {
    this.sessions = sessions;
    this.notify();
  }

  setActiveSession(key: string): void {
    this.activeSessionId = key;
    this.notify();
  }

  addSession(session: MasSession): void {
    this.sessions = [...this.sessions, session];
    this.notify();
  }

  removeSession(sessionKey: string): void {
    this.sessions = this.sessions.filter((s) => s.key !== sessionKey);
    if (this.activeSessionId === sessionKey) {
      this.activeSessionId = null;
    }
    this.notify();
  }

  updateSessionLabel(sessionKey: string, label: string): void {
    this.sessions = this.sessions.map((s) => (s.key === sessionKey ? { ...s, label } : s));
    this.notify();
  }

  // ── 消息操作 ──────────────────────────────────────

  appendMessage(sessionKey: string, msg: ChatMessage): void {
    const msgs = this.messagesBySession.get(sessionKey) ?? [];
    this.messagesBySession.set(sessionKey, [...msgs, msg]);
    this.notify();
  }

  updateLastMessage(sessionKey: string, msg: ChatMessage): void {
    const msgs = this.messagesBySession.get(sessionKey) ?? [];
    if (msgs.length === 0) {
      this.appendMessage(sessionKey, msg);
      return;
    }
    const updated = [...msgs];
    updated[updated.length - 1] = msg;
    this.messagesBySession.set(sessionKey, updated);
    this.notify();
  }

  clearMessages(sessionKey: string): void {
    this.messagesBySession.set(sessionKey, []);
    this.notify();
  }

  // ── 审批操作 ──────────────────────────────────────

  addApproval(req: ApprovalRequest): void {
    this.pendingApprovals = [...this.pendingApprovals, req];
    this.notify();
  }

  resolveApproval(id: string): void {
    this.pendingApprovals = this.pendingApprovals.filter((a) => a.id !== id);
    this.notify();
  }

  // ── 子 Agent 确认操作 ─────────────────────────────

  addSpawnConfirm(item: PendingSpawnConfirm): void {
    this.pendingSpawnConfirms = [...this.pendingSpawnConfirms, item];
    this.notify();
  }

  removeSpawnConfirm(messageId: string): void {
    this.pendingSpawnConfirms = this.pendingSpawnConfirms.filter((c) => c.messageId !== messageId);
    this.notify();
  }
}

/**
 * ReactiveController 适配器，供 LitElement 使用。
 *
 * 用法：
 *   private _store = new AppStoreController(this);
 *   // 在 render() 中访问 this._store.store.xxx
 */
export class AppStoreController implements ReactiveController {
  readonly store = AppStore.instance;

  constructor(private host: ReactiveControllerHost) {
    host.addController(this);
  }

  hostConnected(): void {
    this.store.addHost(this.host);
  }

  hostDisconnected(): void {
    this.store.removeHost(this.host);
  }
}
