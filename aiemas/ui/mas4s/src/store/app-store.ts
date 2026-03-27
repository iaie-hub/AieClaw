import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { ApprovalRequest, ApprovalResolved } from "../types/approval-types.js";
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

  // ── 历史消息元数据（sessionKey → { truncated, hasSummary, page, totalPages, sessionStats }） ──
  historyMetaBySession: Map<
    string,
    {
      truncated: boolean;
      hasSummary: boolean;
      page: number;
      totalPages: number;
      sessionStats: { firstMsgAt: number | null; lastMsgAt: number | null; totalMsgCount: number };
    }
  > = new Map();

  setHistoryMeta(
    sessionKey: string,
    meta: {
      truncated: boolean;
      hasSummary: boolean;
      page: number;
      totalPages: number;
      sessionStats: { firstMsgAt: number | null; lastMsgAt: number | null; totalMsgCount: number };
    },
  ): void {
    this.historyMetaBySession.set(sessionKey, meta);
    this.notify();
  }

  getHistoryMeta(sessionKey: string): {
    truncated: boolean;
    hasSummary: boolean;
    page: number;
    totalPages: number;
    sessionStats: { firstMsgAt: number | null; lastMsgAt: number | null; totalMsgCount: number };
  } {
    return (
      this.historyMetaBySession.get(sessionKey) ?? {
        truncated: false,
        hasSummary: false,
        page: 1,
        totalPages: 1,
        sessionStats: { firstMsgAt: null, lastMsgAt: null, totalMsgCount: 0 },
      }
    );
  }

  // ── 工具流缓存（toolCallId → 工具执行状态） ──────
  // key: toolCallId, value: { name, args, output, sessionKey, runId }
  toolStreamById: Map<string, ToolStreamEntry> = new Map();
  toolStreamOrder: string[] = [];

  // ── 审批队列（跨会话聚合） ────────────────────────
  pendingApprovals: ApprovalRequest[] = [];

  // ── 已决策审批（保留用于消息流渲染） ──────────────
  resolvedApprovals: Map<string, { approval: ApprovalRequest; resolved: ApprovalResolved }> =
    new Map();

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

  /**
   * 将旧消息前插到现有消息列表头部（用于向上翻页加载更早的历史）。
   * 不触发 notify()，由调用方在锚点恢复后统一触发，避免页面闪烁。
   */
  prependMessages(sessionKey: string, older: ChatMessage[]): void {
    if (older.length === 0) {
      return;
    }
    const current = this.messagesBySession.get(sessionKey) ?? [];
    this.messagesBySession.set(sessionKey, [...older, ...current]);
    // Intentionally no notify() here — caller must call notify() after
    // restoring the scroll anchor to prevent visible layout jump.
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
    // 向当前活跃 session 插入一条 pending 消息，使审核卡片内联显示在消息流中
    if (this.activeSessionId) {
      const pendingMsg: ChatMessage = {
        id: req.id,
        role: "assistant",
        subType: "pending",
        content: [],
        timestamp: req.createdAtMs,
      };
      const msgs = this.messagesBySession.get(this.activeSessionId) ?? [];
      // 避免重复插入
      if (!msgs.some((m) => m.id === req.id)) {
        this.messagesBySession.set(this.activeSessionId, [...msgs, pendingMsg]);
      }
    }
    this.notify();
  }

  resolveApproval(id: string, resolved?: ApprovalResolved): void {
    const found = this.pendingApprovals.find((a) => a.id === id);
    const resolvedData: ApprovalResolved = resolved ?? {
      id,
      decision: "allow-once",
      ts: Date.now(),
    };

    let approvalRecord: { approval: ApprovalRequest; resolved: ApprovalResolved } | undefined;

    if (found) {
      approvalRecord = { approval: found, resolved: resolvedData };
      this.resolvedApprovals.set(id, approvalRecord);
    } else if (!this.resolvedApprovals.has(id)) {
      // gateway 广播到达时 pending 可能已被乐观移除，用 resolved payload 中的 request 构造
      if (resolvedData.request) {
        const syntheticApproval: ApprovalRequest = {
          id,
          request: resolvedData.request,
          createdAtMs: resolvedData.ts,
          expiresAtMs: resolvedData.ts,
        };
        approvalRecord = { approval: syntheticApproval, resolved: resolvedData };
        this.resolvedApprovals.set(id, approvalRecord);
      }
    } else {
      // 已有乐观记录，用 gateway 广播的完整数据覆盖 resolved 部分
      const existing = this.resolvedApprovals.get(id)!;
      approvalRecord = { approval: existing.approval, resolved: resolvedData };
      this.resolvedApprovals.set(id, approvalRecord);
    }

    this.pendingApprovals = this.pendingApprovals.filter((a) => a.id !== id);

    // 向对应 session 追加一条用户操作消息，显示在审核卡片下方
    if (approvalRecord) {
      const { approval, resolved: r } = approvalRecord;
      const sessionKey = approval.request.sessionKey ?? this.activeSessionId;
      if (sessionKey) {
        const decisionText =
          r.decision === "deny" ? "拒绝" : r.decision === "allow-always" ? "始终允许" : "允许一次";
        const command = approval.request.commandPreview ?? approval.request.command;
        const actionMsg: ChatMessage = {
          id: `approval-action-${id}`,
          role: "user",
          subType: undefined,
          content: [{ type: "text", text: `${decisionText}：${command}` }],
          timestamp: r.ts,
          senderLabel: r.resolvedBy ?? undefined,
        };
        const msgs = this.messagesBySession.get(sessionKey) ?? [];
        // 避免重复插入（乐观 + gateway 广播各触发一次）
        if (!msgs.some((m) => m.id === actionMsg.id)) {
          this.messagesBySession.set(sessionKey, [...msgs, actionMsg]);
        } else {
          // 已存在时用 gateway 广播的完整数据（含 resolvedBy）覆盖
          this.messagesBySession.set(
            sessionKey,
            msgs.map((m) => (m.id === actionMsg.id ? actionMsg : m)),
          );
        }
      }
    }

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
