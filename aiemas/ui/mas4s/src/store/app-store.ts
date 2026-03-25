import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { ApprovalRequest } from "../types/approval-types.js";
import type { ChatMessage } from "../types/chat-types.js";
import type { MasSession, MasParticipant } from "../types/session-types.js";

export type GlobalRole = "admin" | "member" | "viewer";

export interface CurrentUser {
  userId: string;
  username: string;
  displayName: string;
  role: GlobalRole;
  tenantId: string;
}

/** 工具执行流条目 */
export interface ToolStreamEntry {
  toolCallId: string;
  runId: string;
  sessionKey: string;
  name: string;
  args?: unknown;
  output?: string;
  startedAt: number;
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

  // ── 历史消息元数据（sessionKey → { truncated, hasSummary }） ──
  historyMetaBySession: Map<string, { truncated: boolean; hasSummary: boolean }> = new Map();

  setHistoryMeta(sessionKey: string, meta: { truncated: boolean; hasSummary: boolean }): void {
    this.historyMetaBySession.set(sessionKey, meta);
    this.notify();
  }

  getHistoryMeta(sessionKey: string): { truncated: boolean; hasSummary: boolean } {
    return this.historyMetaBySession.get(sessionKey) ?? { truncated: false, hasSummary: false };
  }

  // ── 工具流缓存（toolCallId → 工具执行状态） ──────
  // key: toolCallId, value: { name, args, output, sessionKey, runId }
  toolStreamById: Map<string, ToolStreamEntry> = new Map();
  toolStreamOrder: string[] = [];

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

  /** 用 aiemas DB 的持久化值修补 label（仅在 gateway 返回值为空时使用） */
  patchSessionLabelFromDb(
    sessionKey: string,
    patch: { label?: string | null; displayName?: string | null },
  ): void {
    this.sessions = this.sessions.map((s) => {
      if (s.key !== sessionKey) {
        return s;
      }
      // Only apply if current label is still missing
      if (s.label) {
        return s;
      }
      const resolved = patch.label ?? patch.displayName ?? undefined;
      return resolved ? { ...s, label: resolved } : s;
    });
    this.notify();
  }

  updateSessionArchived(sessionKey: string, archivedAt: number | null): void {
    this.sessions = this.sessions.map((s) => (s.key === sessionKey ? { ...s, archivedAt } : s));
    this.notify();
  }

  updateSessionParticipants(sessionKey: string, participants: MasParticipant[]): void {
    this.sessions = this.sessions.map((s) => (s.key === sessionKey ? { ...s, participants } : s));
    this.notify();
  }

  // ── 摘要操作（已迁移至 SummaryStore，此处仅保留 notify 触发响应式更新） ──

  /** 通知所有组件重新读取 SummaryStore 缓存 */
  notifySummaryUpdated(): void {
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

  // ── 工具流操作 ────────────────────────────────────

  upsertToolStream(entry: ToolStreamEntry): void {
    this.toolStreamById.set(entry.toolCallId, entry);
    if (!this.toolStreamOrder.includes(entry.toolCallId)) {
      this.toolStreamOrder.push(entry.toolCallId);
    }
    // 将工具执行状态同步为消息追加到对应会话
    this._syncToolStreamMessage(entry);
    this.notify();
  }

  resetToolStream(sessionKey?: string): void {
    if (sessionKey) {
      // 只清除指定会话的工具流
      for (const id of this.toolStreamOrder) {
        const entry = this.toolStreamById.get(id);
        if (entry?.sessionKey === sessionKey) {
          this.toolStreamById.delete(id);
          this.toolStreamOrder = this.toolStreamOrder.filter((x) => x !== id);
        }
      }
    } else {
      this.toolStreamById.clear();
      this.toolStreamOrder = [];
    }
    this.notify();
  }

  private _syncToolStreamMessage(entry: ToolStreamEntry): void {
    const { sessionKey, toolCallId, name, args, output, startedAt } = entry;
    const content: ChatMessage["content"] = [{ type: "tool_call", name, args }];
    if (output) {
      content.push({ type: "tool_result", name, text: output });
    }
    const msg: ChatMessage = {
      role: "assistant",
      content,
      timestamp: startedAt,
      id: `tool:${toolCallId}`,
      senderLabel: null,
    };
    const msgs = this.messagesBySession.get(sessionKey) ?? [];
    const existingIdx = msgs.findIndex((m) => m.id === msg.id);
    if (existingIdx >= 0) {
      const updated = [...msgs];
      updated[existingIdx] = msg;
      this.messagesBySession.set(sessionKey, updated);
    } else {
      this.messagesBySession.set(sessionKey, [...msgs, msg]);
    }
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
