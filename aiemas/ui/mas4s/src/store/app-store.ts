import type { ReactiveController, ReactiveControllerHost } from "lit";
import type { ApprovalRequest, ApprovalResolved } from "../types/approval-types.js";
import type { ChatMessage } from "../types/chat-types.js";
import type { MasSession, MasParticipant } from "../types/session-types.js";
import type { SkillStatusReport } from "../types/skills-types.js";

export type GlobalRole = "admin" | "member" | "viewer";

export interface CurrentUser {
  userId: string;
  username: string;
  displayName: string;
  role: GlobalRole;
  tenantId: string;
}

export interface AgentInfo {
  id: string;
  name?: string;
  description?: string;
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

/** Agent 拓扑边（父 → 子关系） */
export interface TopologyEdge {
  from: string; // parent Agent ID
  to: string; // child Agent ID
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

  // ── 可用 Agent 列表 ──────────────────────────────
  agents: AgentInfo[] = [];

  setAgents(agents: AgentInfo[]): void {
    this.agents = agents;
    this.notify();
  }

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
    this.activeSessionUuid = null;
    this.notify();
  }

  // ── 会话列表 ──────────────────────────────────────
  sessions: MasSession[] = [];
  activeSessionUuid: string | null = null;

  get activeSession(): MasSession | undefined {
    return this.sessions.find((s) => s.sessionUuid === this.activeSessionUuid);
  }

  /** 获取当前活跃会话的网关 sessionKey */
  get activeSessionKey(): string | undefined {
    return this.activeSession?.key;
  }

  // ── 消息缓存（sessionUuid → 消息数组） ────────────
  messagesBySession: Map<string, ChatMessage[]> = new Map();

  // ── 多 Agent 消息缓存（sessionUuid → agentId → 消息数组） ──
  messagesByAgent: Map<string, Map<string, ChatMessage[]>> = new Map();

  // ── 拓扑缓存（rootAgentId → edges） ──────────────
  topologyByAgent: Map<string, TopologyEdge[]> = new Map();

  // ── 视图模式（sessionUuid → "single" | "multi"） ──
  viewModeBySession: Map<string, "single" | "multi"> = new Map();

  // ── Secondary_Panel 活跃 Tab（sessionUuid → agentId） ──
  activeSubAgentTab: Map<string, string> = new Map();

  // ── Sub_Agent 未读指示器（sessionUuid → Set<agentId>） ──
  unreadByAgent: Map<string, Set<string>> = new Map();

  // ── Sub_Agent 活跃状态（sessionUuid → Set<agentId>，正在 streaming 的子 Agent） ──
  activeAgentsBySession: Map<string, Set<string>> = new Map();

  // ── 历史消息元数据（sessionUuid → { truncated, hasSummary, page, totalPages, sessionStats }） ──
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
    sessionUuid: string,
    meta: {
      truncated: boolean;
      hasSummary: boolean;
      page: number;
      totalPages: number;
      sessionStats: { firstMsgAt: number | null; lastMsgAt: number | null; totalMsgCount: number };
    },
  ): void {
    this.historyMetaBySession.set(sessionUuid, meta);
    this.notify();
  }

  getHistoryMeta(sessionUuid: string): {
    truncated: boolean;
    hasSummary: boolean;
    page: number;
    totalPages: number;
    sessionStats: { firstMsgAt: number | null; lastMsgAt: number | null; totalMsgCount: number };
  } {
    return (
      this.historyMetaBySession.get(sessionUuid) ?? {
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

  // ── 聊天状态跟踪 ──────────────────────────────────
  /** sessionUuid -> whether agent is running */
  isChattingBySession: Map<string, boolean> = new Map();
  /** sessionUuid -> current active runId (for abort) */
  activeRunIdBySession: Map<string, string> = new Map();

  setIsChatting(sessionUuid: string, isChatting: boolean, runId?: string): void {
    this.isChattingBySession.set(sessionUuid, isChatting);
    if (runId) {
      this.activeRunIdBySession.set(sessionUuid, runId);
    } else if (!isChatting) {
      this.activeRunIdBySession.delete(sessionUuid);
    }
    this.notify();
  }

  // ── Skills 状态管理 ───────────────────────────────
  skillsReport: SkillStatusReport | null = null;
  skillsLoading: boolean = false;
  skillsError: string | null = null;

  setSkillsReport(report: SkillStatusReport): void {
    this.skillsReport = report;
    this.skillsError = null;
    this.notify();
  }

  setSkillsLoading(loading: boolean): void {
    this.skillsLoading = loading;
    this.notify();
  }

  setSkillsError(error: string): void {
    this.skillsError = error;
    this.skillsLoading = false;
    this.notify();
  }

  // ── SOP 状态管理 ──────────────────────────────────
  /** sessionUuid → SOP step states */
  sopStepsBySession: Map<
    string,
    {
      steps: Array<{
        skill: string;
        label: string;
        icon?: string;
        status: string;
        startedAt?: number;
        completedAt?: number;
        elapsed?: number;
      }>;
      sopLabel: string;
      currentStepIndex: number;
      completedAt?: number;
    }
  > = new Map();
  /** sessionUuid → active skill progress */
  activeProgressBySession: Map<
    string,
    {
      skill: string;
      total: number;
      completed: number;
      currentItem?: { index: number; label: string; pct: number; message?: string };
    }
  > = new Map();
  /** sessionUuid → progress log entries */
  progressLogsBySession: Map<
    string,
    Array<{ ts: number; skill: string; message: string; level: string }>
  > = new Map();

  updateSOPState(sessionUuid: string, data: Record<string, unknown>): void {
    const steps = data["steps"] as Array<{
      skill: string;
      label: string;
      icon?: string;
      status: string;
      startedAt?: number;
      completedAt?: number;
      elapsed?: number;
    }>;
    const sopLabel = (data["sopLabel"] as string) ?? "";
    const currentStepIndex = (data["currentStepIndex"] as number) ?? -1;
    const completedAt = typeof data["completedAt"] === "number" ? data["completedAt"] : undefined;
    if (Array.isArray(steps)) {
      this.sopStepsBySession.set(sessionUuid, { steps, sopLabel, currentStepIndex, completedAt });

      // 清理已不再运行的技能进度
      const active = this.activeProgressBySession.get(sessionUuid);
      if (active) {
        const currentStep = steps[currentStepIndex];
        if (
          !currentStep ||
          currentStep.skill !== active.skill ||
          currentStep.status !== "running"
        ) {
          this.activeProgressBySession.delete(sessionUuid);
        }
      }
    }
    this.notify();
  }

  updateSkillProgress(sessionUuid: string, data: Record<string, unknown>): void {
    const skill = data["skill"] as string;
    const progress = data["progress"] as Record<string, unknown>;
    if (!skill || !progress) {
      return;
    }

    const type = progress["type"] as string;

    if (type === "start") {
      this.activeProgressBySession.set(sessionUuid, {
        skill,
        total: (progress["total"] as number) ?? 0,
        completed: 0,
      });
    } else if (type === "item") {
      const existing = this.activeProgressBySession.get(sessionUuid);
      // Relaxed check: allow update if either it's the same skill,
      // or if we have no active progress, or if the current active
      // progress is a management tool like 'process'.
      const isSkillMatch = !existing || existing.skill === skill || existing.skill === "process";

      if (isSkillMatch) {
        const pct = (progress["pct"] as number) ?? 0;
        const total = (progress["total"] as number) ?? existing?.total ?? 0;
        const completed =
          pct >= 100
            ? ((progress["index"] as number) ?? (existing?.completed ?? 0) + 1)
            : (existing?.completed ?? 0);

        const currentItem =
          pct >= 100
            ? undefined
            : {
                index: (progress["index"] as number) ?? 0,
                label: (progress["label"] as string) ?? "",
                pct,
                message: (progress["message"] as string) ?? undefined,
              };
        this.activeProgressBySession.set(sessionUuid, {
          skill,
          total,
          completed,
          currentItem,
        });
      }
    } else if (type === "done") {
      this.activeProgressBySession.delete(sessionUuid);
      // Optimistically mark the SOP step as completed
      const sessionSOP = this.sopStepsBySession.get(sessionUuid);
      if (sessionSOP) {
        const stepIdx = sessionSOP.steps.findIndex((s) => s.skill === skill);
        if (stepIdx >= 0 && sessionSOP.steps[stepIdx].status === "running") {
          sessionSOP.steps[stepIdx].status = "completed";
          this.sopStepsBySession.set(sessionUuid, { ...sessionSOP });
        }
      }
    }

    if (type === "log" || (type === "item" && progress["message"])) {
      const logs = this.progressLogsBySession.get(sessionUuid) ?? [];
      const message = ((progress["message"] as string) ?? "").trim();
      if (message) {
        logs.push({
          ts: (progress["ts"] as number) ?? Date.now(),
          skill,
          message,
          level: (progress["level"] as string) ?? "info",
        });
        // Keep last 500 entries
        if (logs.length > 500) {
          logs.splice(0, logs.length - 500);
        }
        this.progressLogsBySession.set(sessionUuid, [...logs]);
      }
    }

    this.notify();
  }

  clearSOPState(sessionUuid: string): void {
    this.sopStepsBySession.delete(sessionUuid);
    this.activeProgressBySession.delete(sessionUuid);
    this.progressLogsBySession.delete(sessionUuid);
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

  setActiveSession(uuid: string): void {
    this.activeSessionUuid = uuid;
    this.notify();
  }

  addSession(session: MasSession): void {
    this.sessions = [...this.sessions, session];
    this.notify();
  }

  removeSession(sessionUuid: string): void {
    this.sessions = this.sessions.filter(
      (s) => s.sessionUuid !== sessionUuid && s.key.split(":").pop() !== sessionUuid,
    );
    if (this.activeSessionUuid === sessionUuid) {
      this.activeSessionUuid = null;
    }
    this.notify();
  }

  updateSessionLabel(sessionKey: string, label: string): void {
    this.sessions = this.sessions.map((s) => (s.key === sessionKey ? { ...s, label } : s));
    this.notify();
  }

  /** 用 aiemas DB 的持久化值修补 label（仅在 gateway 返回值为空时使用） */
  patchSessionLabelFromDb(sessionKey: string, patch: { label?: string | null }): void {
    this.sessions = this.sessions.map((s) => {
      if (s.key !== sessionKey) {
        return s;
      }
      // Only apply if current label is still missing
      if (s.label) {
        return s;
      }
      const resolved = patch.label ?? undefined;
      return resolved ? { ...s, label: resolved } : s;
    });
    this.notify();
  }

  updateSessionArchived(sessionKey: string, archivedAt: number | null): void {
    this.sessions = this.sessions.map((s) => (s.key === sessionKey ? { ...s, archivedAt } : s));
    this.notify();
  }

  updateSessionParticipants(sessionUuid: string, participants: MasParticipant[]): void {
    this.sessions = this.sessions.map((s) =>
      s.sessionUuid === sessionUuid ? { ...s, participants } : s,
    );
    this.notify();
  }

  // ── 摘要操作（已迁移至 SummaryStore，此处仅保留 notify 触发响应式更新） ──

  /** 通知所有组件重新读取 SummaryStore 缓存 */
  notifySummaryUpdated(): void {
    this.notify();
  }

  // ── 消息操作 ──────────────────────────────────────

  appendMessage(sessionUuid: string, msg: ChatMessage): void {
    const msgs = this.messagesBySession.get(sessionUuid) ?? [];
    msgs.push(msg);
    if (msgs.length > 500) {
      msgs.splice(0, msgs.length - 500);
    }
    this.messagesBySession.set(sessionUuid, [...msgs]);
    this.notify();
  }

  updateLastMessage(sessionUuid: string, msg: ChatMessage): void {
    const msgs = this.messagesBySession.get(sessionUuid) ?? [];
    if (msgs.length === 0) {
      this.appendMessage(sessionUuid, msg);
      return;
    }
    const updated = [...msgs];
    updated[updated.length - 1] = msg;
    this.messagesBySession.set(sessionUuid, updated);
    this.notify();
  }

  clearMessages(sessionUuid: string): void {
    this.messagesBySession.set(sessionUuid, []);
    // 同步清除 messagesByAgent，避免重新加载历史时与旧数据重复
    this.messagesByAgent.delete(sessionUuid);
    this.notify();
  }

  // ── 多 Agent 消息操作 ─────────────────────────────

  /** 追加消息到 messagesByAgent[sessionUuid][agentId]，自动创建 Map */
  appendAgentMessage(sessionUuid: string, agentId: string, msg: ChatMessage): void {
    let agentMap = this.messagesByAgent.get(sessionUuid);
    if (!agentMap) {
      agentMap = new Map();
      this.messagesByAgent.set(sessionUuid, agentMap);
    }
    const msgs = agentMap.get(agentId) ?? [];
    // 去重：如果末尾消息 id 相同，跳过（防止 agent + session.tool 双路径重复追加）
    if (msg.id && msgs.length > 0 && msgs[msgs.length - 1].id === msg.id) {
      return;
    }
    msgs.push(msg);
    if (msgs.length > 500) {
      msgs.splice(0, msgs.length - 500);
    }
    agentMap.set(agentId, [...msgs]);
    this.notify();
  }

  /** 获取指定 Agent 在指定会话中的消息列表 */
  getAgentMessages(sessionUuid: string, agentId: string): ChatMessage[] {
    return this.messagesByAgent.get(sessionUuid)?.get(agentId) ?? [];
  }

  /** 替换 messagesByAgent[sessionUuid][agentId] 中的最后一条消息 */
  updateAgentLastMessage(sessionUuid: string, agentId: string, msg: ChatMessage): void {
    let agentMap = this.messagesByAgent.get(sessionUuid);
    if (!agentMap) {
      agentMap = new Map();
      this.messagesByAgent.set(sessionUuid, agentMap);
    }
    const msgs = agentMap.get(agentId) ?? [];
    if (msgs.length === 0) {
      agentMap.set(agentId, [msg]);
    } else {
      const updated = [...msgs];
      updated[updated.length - 1] = msg;
      agentMap.set(agentId, updated);
    }
    this.notify();
  }

  /** 获取指定会话的所有 Agent 消息（内层 Map），不存在时返回空 Map */
  getSubAgentMessages(sessionUuid: string): Map<string, ChatMessage[]> {
    const inner = this.messagesByAgent.get(sessionUuid);
    // 返回新 Map 引用，确保 Lit 属性变更检测能感知内部数据变化
    return inner ? new Map(inner) : new Map();
  }

  /** 从拓扑 edges 中提取当前会话 Root_Agent 的 Sub_Agent 列表 */
  getSubAgentList(sessionUuid: string): string[] {
    const session = this.sessions.find((s) => s.sessionUuid === sessionUuid);
    if (!session) {
      return [];
    }
    // 从 sessionKey 中提取 rootAgentId
    const parts = session.key.split(":");
    const rootAgentId = parts.length >= 2 && parts[0] === "agent" ? parts[1] : "";
    if (!rootAgentId) {
      return [];
    }
    const edges = this.topologyByAgent.get(rootAgentId);
    if (!edges) {
      return [];
    }
    // 收集所有 "to" 节点（子 Agent），去重
    const subAgentSet = new Set<string>();
    for (const edge of edges) {
      subAgentSet.add(edge.to);
    }
    return [...subAgentSet];
  }

  // ── 拓扑缓存操作 ─────────────────────────────────

  /** 缓存拓扑数据 */
  setTopology(rootAgentId: string, edges: TopologyEdge[]): void {
    this.topologyByAgent.set(rootAgentId, edges);
    this.notify();
  }

  /** 获取缓存的拓扑数据 */
  getTopology(rootAgentId: string): TopologyEdge[] | undefined {
    return this.topologyByAgent.get(rootAgentId);
  }

  // ── 视图模式操作 ─────────────────────────────────

  /** 设置会话的视图模式 */
  setViewMode(sessionUuid: string, mode: "single" | "multi"): void {
    this.viewModeBySession.set(sessionUuid, mode);
    this.notify();
  }

  /** 获取会话的视图模式，默认 "single" */
  getViewMode(sessionUuid: string): "single" | "multi" {
    return this.viewModeBySession.get(sessionUuid) ?? "single";
  }

  // ── Sub_Agent Tab 操作 ────────────────────────────

  /** 设置 Secondary_Panel 活跃 Tab */
  setActiveSubAgentTab(sessionUuid: string, agentId: string): void {
    this.activeSubAgentTab.set(sessionUuid, agentId);
    this.notify();
  }

  // ── 未读指示器操作 ────────────────────────────────

  /** 标记 Sub_Agent 有未读消息 */
  markAgentUnread(sessionUuid: string, agentId: string): void {
    let unreadSet = this.unreadByAgent.get(sessionUuid);
    if (!unreadSet) {
      unreadSet = new Set();
    }
    unreadSet.add(agentId);
    // 创建新 Set 引用，确保 Lit 属性变更检测能感知变化
    this.unreadByAgent.set(sessionUuid, new Set(unreadSet));
    this.notify();
  }

  /** 清除 Sub_Agent 的未读标记 */
  clearAgentUnread(sessionUuid: string, agentId: string): void {
    const unreadSet = this.unreadByAgent.get(sessionUuid);
    if (unreadSet) {
      unreadSet.delete(agentId);
      this.unreadByAgent.set(sessionUuid, new Set(unreadSet));
      this.notify();
    }
  }

  /** 标记 Sub_Agent 为活跃（正在 streaming） */
  markAgentActive(sessionUuid: string, agentId: string): void {
    let activeSet = this.activeAgentsBySession.get(sessionUuid);
    if (!activeSet) {
      activeSet = new Set();
    }
    if (!activeSet.has(agentId)) {
      activeSet.add(agentId);
      // 创建新 Set 引用，确保 Lit 属性变更检测能感知变化
      this.activeAgentsBySession.set(sessionUuid, new Set(activeSet));
      this.notify();
    }
  }

  /** 清除 Sub_Agent 的活跃状态 */
  clearAgentActive(sessionUuid: string, agentId: string): void {
    const activeSet = this.activeAgentsBySession.get(sessionUuid);
    if (activeSet?.has(agentId)) {
      activeSet.delete(agentId);
      this.activeAgentsBySession.set(sessionUuid, new Set(activeSet));
      this.notify();
    }
  }

  /**
   * 将旧消息前插到现有消息列表头部（用于向上翻页加载更早的历史）。
   * 不触发 notify()，由调用方在锚点恢复后统一触发，避免页面闪烁。
   */
  prependMessages(sessionUuid: string, older: ChatMessage[]): void {
    if (older.length === 0) {
      return;
    }
    const current = this.messagesBySession.get(sessionUuid) ?? [];
    this.messagesBySession.set(sessionUuid, [...older, ...current]);
    // Intentionally no notify() here — caller must call notify() after
    // restoring the scroll anchor to prevent visible layout jump.
  }

  // ── 工具流操作 ────────────────────────────────────

  upsertToolStream(entry: ToolStreamEntry, sessionUuid: string): void {
    this.toolStreamById.set(entry.toolCallId, entry);
    if (!this.toolStreamOrder.includes(entry.toolCallId)) {
      this.toolStreamOrder.push(entry.toolCallId);
    }
    // 将工具执行状态同步为消息追加到对应会话
    this._syncToolStreamMessage(entry, sessionUuid);
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

  private _syncToolStreamMessage(entry: ToolStreamEntry, sessionUuid: string): void {
    const { toolCallId, name, args, output, startedAt } = entry;
    // Note: entry.sessionKey is stored for reference, but we cache by uuid
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
    // Update messagesBySession
    const msgs = this.messagesBySession.get(sessionUuid) ?? [];
    const existingIdx = msgs.findIndex((m) => m.id === msg.id);
    if (existingIdx >= 0) {
      const updated = [...msgs];
      updated[existingIdx] = msg;
      this.messagesBySession.set(sessionUuid, updated);
    } else {
      this.messagesBySession.set(sessionUuid, [...msgs, msg]);
    }

    // Update messagesByAgent
    if (entry.sessionKey) {
      const parts = entry.sessionKey.split(":");
      const agentId = parts.length >= 2 && parts[0] === "agent" ? parts[1] : "Agent";

      let agentMap = this.messagesByAgent.get(sessionUuid);
      if (!agentMap) {
        agentMap = new Map();
        this.messagesByAgent.set(sessionUuid, agentMap);
      }
      const agentMsgs = agentMap.get(agentId) ?? [];
      const agentExistingIdx = agentMsgs.findIndex((m) => m.id === msg.id);
      if (agentExistingIdx >= 0) {
        const updated = [...agentMsgs];
        updated[agentExistingIdx] = msg;
        agentMap.set(agentId, updated);
      } else {
        agentMap.set(agentId, [...agentMsgs, msg]);
      }
    }
  }

  // ── 审批操作 ──────────────────────────────────────

  addApproval(req: ApprovalRequest): void {
    // 避免重复添加同一审核请求
    if (this.pendingApprovals.some((a) => a.id === req.id)) {
      return;
    }
    this.pendingApprovals = [...this.pendingApprovals, req];
    // 向审核请求所属的 session 插入 pending 消息，而非当前活跃 session
    // 避免跨 session 污染（审核请求可能来自非当前活跃 session）
    const targetSessionKey = req.request.sessionKey;
    const targetSessionUuid = targetSessionKey
      ? targetSessionKey.split(":").pop()!
      : this.activeSessionUuid;

    if (targetSessionUuid) {
      const pendingMsg: ChatMessage = {
        id: req.id,
        role: "assistant",
        subType: "pending",
        content: [],
        timestamp: req.createdAtMs,
      };
      const msgs = this.messagesBySession.get(targetSessionUuid) ?? [];
      // 避免重复插入
      if (!msgs.some((m) => m.id === req.id)) {
        this.messagesBySession.set(targetSessionUuid, [...msgs, pendingMsg]);
      }

      // Sync to messagesByAgent
      if (targetSessionKey) {
        const parts = targetSessionKey.split(":");
        const agentId = parts.length >= 2 && parts[0] === "agent" ? parts[1] : "Agent";
        let agentMap = this.messagesByAgent.get(targetSessionUuid);
        if (!agentMap) {
          agentMap = new Map();
          this.messagesByAgent.set(targetSessionUuid, agentMap);
        }
        const agentMsgs = agentMap.get(agentId) ?? [];
        if (!agentMsgs.some((m) => m.id === req.id)) {
          agentMap.set(agentId, [...agentMsgs, pendingMsg]);
        }
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
      const sessionKey = approval.request.sessionKey;
      const sessionUuid = sessionKey ? sessionKey.split(":").pop()! : this.activeSessionUuid;

      if (sessionUuid) {
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
        const msgs = this.messagesBySession.get(sessionUuid) ?? [];
        // 避免重复插入（乐观 + gateway 广播各触发一次）
        if (!msgs.some((m) => m.id === actionMsg.id)) {
          this.messagesBySession.set(sessionUuid, [...msgs, actionMsg]);
        }

        // Sync to messagesByAgent
        if (sessionKey) {
          const parts = sessionKey.split(":");
          const agentId = parts.length >= 2 && parts[0] === "agent" ? parts[1] : "Agent";
          let agentMap = this.messagesByAgent.get(sessionUuid);
          if (!agentMap) {
            agentMap = new Map();
            this.messagesByAgent.set(sessionUuid, agentMap);
          }
          const agentMsgs = agentMap.get(agentId) ?? [];
          if (!agentMsgs.some((m) => m.id === actionMsg.id)) {
            agentMap.set(agentId, [...agentMsgs, actionMsg]);
          }
        } else {
          // 已存在时用 gateway 广播的完整数据（含 resolvedBy）覆盖
          this.messagesBySession.set(
            sessionUuid,
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
