import { randomUUID } from "node:crypto";
import type { TopologyCache } from "../cache/topology-cache.js";
import type { TopologyTree } from "../models.js";
import { createAiemasSessionsStore } from "../store/aiemas-sessions-store.js";
import { constructKeyFromUuid } from "../utils/session-utils.js";
import { str, sendToConnId, buildConnectedUsers, type GatewayClient } from "./aiemas-utils.js";
import { GatewayAuthBridge } from "./bridge.js";
import { MasAuthContext, NULL_MAS_AUTH } from "./context.js";
import type { Mas4sGatewayPlugin } from "./mas4s-gateway-plugin.js";
import { extractDescendantAgentIds } from "./topology-utils.js";

export interface SessionContext {
  plugin: Mas4sGatewayPlugin;
  getMasAuth: (client: GatewayClient) => MasAuthContext | null;
  getActiveClients: () => Set<GatewayClient>;
  loadSessionRow: (sessionKey: string) => Record<string, unknown> | null;
  extractUuid: (sessionKey: string) => string;
  log: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
}

function buildDescendantSessionKey(agentId: string, sessionUuid: string): string | undefined {
  if (!sessionUuid) {
    return undefined;
  }
  return constructKeyFromUuid(agentId, sessionUuid);
}

/**
 * 级联创建 session
 *
 * 流程：
 * 1. 检查兼容模式：如果 userId 为 null，仅为该 Agent 创建 session
 * 2. 查询拓扑关系：检查 agentId 是否为 rootAgentId
 * 3. 如果不是 rootAgentId，仅为该 Agent 创建 session
 * 4. 如果是 rootAgentId 且有后代 Agent，为根 Agent 和所有后代 Agent 创建 session
 * 5. 持久化根 Agent 记录到 aiemas_sessions 表
 * 6. 记录所有权
 */
export async function cascadeCreate(params: {
  agentId: string;
  userId: string | null;
  tenantId: string;
  label?: string;
  topologyCache: TopologyCache;
  gatewayDispatch:
    | ((method: string, params: Record<string, unknown>, client: unknown) => Promise<unknown>)
    | null;
  db: import("node:sqlite").DatabaseSync;
  bridge: unknown; // GatewayAuthBridge
}): Promise<{ sessionKey: string; sessionId: string }> {
  const { agentId, userId, tenantId, label, topologyCache, gatewayDispatch, db, bridge } = params;

  const sessionUuid = randomUUID();
  const suggestedKey = constructKeyFromUuid(agentId, sessionUuid);

  // 步骤 1：检查兼容模式
  if (userId === null) {
    // 兼容模式：仅为该 Agent 创建 session，不执行级联操作
    if (!gatewayDispatch) {
      throw new Error("gatewayDispatch not available");
    }
    const result = (await gatewayDispatch(
      "sessions.create",
      { agentId, label, key: suggestedKey },
      null,
    )) as {
      key: string;
      sessionId: string;
    };
    return { sessionKey: result.key, sessionId: result.sessionId };
  }

  // 步骤 2：查询拓扑关系
  const topology = topologyCache.getTopology(agentId);

  // 步骤 3：提取后代 Agent ID 列表（如果非 rootAgentId，则为空列表）
  const descendantAgentIds = topology ? extractDescendantAgentIds(topology.edges, agentId) : [];

  if (!gatewayDispatch) {
    throw new Error("gatewayDispatch not available");
  }

  // 为根 Agent 创建 session
  const rootResult = (await gatewayDispatch(
    "sessions.create",
    { agentId, label, key: suggestedKey },
    null,
  )) as {
    key: string;
    sessionId: string;
  };
  const rootSessionKey = rootResult.key;
  const rootSessionId = rootResult.sessionId;
  // Use the sessionUuid already generated

  // 为后代 Agent 创建 session
  const descendantSessions: Array<{
    agentId: string;
    sessionKey: string;
    sessionId: string;
  }> = [];

  for (const descendantAgentId of descendantAgentIds) {
    try {
      const descendantKey = buildDescendantSessionKey(descendantAgentId, sessionUuid);
      const descendantResult = (await gatewayDispatch(
        "sessions.create",
        { agentId: descendantAgentId, ...(descendantKey ? { key: descendantKey } : {}) },
        null,
      )) as {
        key: string;
        id: string;
      };
      const descendantSessionKey = descendantResult.key;
      const descendantSessionId = descendantResult.id;

      // 记录后代 Agent session 所有权
      try {
        (bridge as GatewayAuthBridge).onSessionCreated(descendantSessionKey, "", {
          userId,
          tenantId,
          masRole: null,
        });
      } catch (err) {
        console.warn(
          `[mas4s:cascadeCreate] Failed to record descendant session ownership for ${descendantAgentId}: ${String(err)}`,
        );
      }

      descendantSessions.push({
        agentId: descendantAgentId,
        sessionKey: descendantSessionKey,
        sessionId: descendantSessionId,
      });
    } catch (err) {
      console.warn(
        `[mas4s:cascadeCreate] Failed to create descendant session for ${descendantAgentId}: ${String(err)}`,
      );
      // 继续处理其余后代 Agent
    }
  }

  // 步骤 5：持久化根 Agent 记录
  const store = createAiemasSessionsStore(db);
  store.saveRootSession({
    sessionKey: rootSessionKey,
    sessionId: rootSessionId,
    agentId,
    sessionUuid,
    label,
    userId,
    tenantId,
    descendantSessions,
  });

  // 步骤 6：记录根 Agent 所有权
  try {
    (bridge as GatewayAuthBridge).onSessionCreated(rootSessionKey, label ?? "", {
      userId,
      tenantId,
      masRole: null,
    });
  } catch (err) {
    console.warn(`[mas4s:cascadeCreate] Failed to record root session ownership: ${String(err)}`);
  }

  return { sessionKey: rootSessionKey, sessionId: rootSessionId };
}

// ── Session_Cascade_Service factory ──────────────────────────────────────────

/**
 * Dependencies injected into the Session_Cascade_Service.
 * Using a factory pattern for testability and clean dependency injection.
 */
export interface SessionCascadeServiceDeps {
  db: import("node:sqlite").DatabaseSync;
  /** Dispatch a Gateway RPC call and return the response payload */
  callGateway: (method: string, params: Record<string, unknown>) => Promise<unknown>;
  topologyCache: TopologyCache;
  /** Record session ownership and membership for a newly created session */
  recordSessionCreated: (sessionKey: string, userId: string, tenantId: string) => void;
  /** Delete session ownership and membership records for a deleted session */
  deleteSessionRecords: (sessionKey: string) => void;
  /** Load a full GatewaySessionRow for a session key */
  loadGatewaySessionRow: (sessionKey: string) => unknown;
}

/**
 * Public interface of the Session_Cascade_Service.
 */
export interface SessionCascadeService {
  /** 级联创建 session（根 Agent + 所有后代 Agent） */
  cascadeCreate(params: {
    agentId: string;
    userId: string | null;
    tenantId: string;
    label?: string;
  }): Promise<{ sessionKey: string; sessionId: string; sessionUuid: string }>;

  /** 级联删除 session（根 Agent + 所有后代 Agent）— 后续任务实现 */
  cascadeDelete(params: { sessionKey: string }): Promise<void>;

  /** 查询根 Agent session 列表（返回与 sessions.list 兼容的结构） */
  listRootSessions(): Promise<{
    ts: number;
    count: number;
    sessions: unknown[];
  }>;

  /** 拓扑变更时增量同步 session — 后续任务实现 */
  syncTopologyChanges(params: {
    rootAgentId: string;
    oldTopology: TopologyTree | undefined;
    newTopology: TopologyTree;
    tenantId: string;
  }): Promise<void>;
}

/**
 * 创建 Session_Cascade_Service 实例。
 *
 * 工厂函数接受所有外部依赖，便于单元测试时注入 mock。
 *
 * @param deps - 注入的依赖项
 * @returns SessionCascadeService 实例
 */
export function createSessionCascadeService(
  deps: SessionCascadeServiceDeps,
): SessionCascadeService {
  const { db, callGateway, topologyCache, recordSessionCreated, deleteSessionRecords } = deps;
  const store = createAiemasSessionsStore(db);

  return {
    /**
     * 级联创建 session。
     *
     * 步骤：
     * 1. 兼容模式检查（userId === null → 仅创建根 Agent session）
     * 2. 查询拓扑关系（非 rootAgentId → 仅创建该 Agent session）
     * 3. 提取后代 Agent ID 列表
     * 4. 为根 Agent 创建 session
     * 5. 为每个后代 Agent 创建 session（失败时记录警告并继续）
     * 6. 持久化根 Agent 记录到 aiemas_sessions 表
     * 7. 记录根 Agent 所有权
     */
    async cascadeCreate(params: {
      agentId: string;
      userId: string | null;
      tenantId: string;
      label?: string;
    }): Promise<{ sessionKey: string; sessionId: string; sessionUuid: string }> {
      const { agentId, userId, tenantId, label } = params;

      const sessionUuid = randomUUID();
      const suggestedRootKey = constructKeyFromUuid(agentId, sessionUuid);

      // 步骤 1：兼容模式 — userId 为 null 时跳过级联，仅创建根 Agent session
      if (userId === null) {
        const result = (await callGateway("sessions.create", {
          agentId,
          label,
          key: suggestedRootKey,
        })) as {
          key: string;
          sessionId: string;
        };
        return { sessionKey: result.key, sessionId: result.sessionId, sessionUuid };
      }

      // 步骤 2：查询拓扑关系，判断是否为 rootAgentId
      const topology = topologyCache.getTopology(agentId);

      // 步骤 3：如果 Agent 不在拓扑根节点，则其后代 Agent 列表为空
      const descendantAgentIds = topology ? extractDescendantAgentIds(topology.edges, agentId) : [];

      // 步骤 4：为根 Agent 创建 session
      const rootResult = (await callGateway("sessions.create", {
        agentId,
        label,
        key: suggestedRootKey,
      })) as {
        key: string;
        sessionId: string;
      };
      const rootSessionKey = rootResult.key;
      const rootSessionId = rootResult.sessionId;
      // Use the sessionUuid already generated

      console.log(`[mas4s] aiemas.sessions.create ← ok, sessionKey=${rootSessionKey}`);

      // 步骤 5：为每个后代 Agent 创建 session，失败时记录警告并继续
      const descendantSessions: Array<{
        agentId: string;
        sessionKey: string;
        sessionId: string;
      }> = [];

      for (const descendantAgentId of descendantAgentIds) {
        try {
          const descendantKey = buildDescendantSessionKey(descendantAgentId, sessionUuid);
          const descendantResult = (await callGateway("sessions.create", {
            agentId: descendantAgentId,
            ...(descendantKey ? { key: descendantKey } : {}),
          })) as { key: string; sessionId: string };

          const descendantSessionKey = descendantResult.key;
          const descendantSessionId = descendantResult.sessionId;

          // 记录后代 Agent session 所有权（与根 Agent 共享 userId/tenantId）
          try {
            recordSessionCreated(descendantSessionKey, userId, tenantId);
          } catch (ownershipErr) {
            console.warn(
              `[mas4s:cascadeCreate] Failed to record ownership for descendant ${descendantAgentId}: ${String(ownershipErr)}`,
            );
          }

          descendantSessions.push({
            agentId: descendantAgentId,
            sessionKey: descendantSessionKey,
            sessionId: descendantSessionId,
          });
        } catch (err) {
          // 后代 Agent session 创建失败：记录警告并继续处理其余后代 Agent
          console.warn(
            `[mas4s:cascadeCreate] Failed to create session for descendant ${descendantAgentId}: ${String(err)}`,
          );
        }
      }

      // 步骤 6：持久化根 Agent 记录到 aiemas_sessions 表
      store.saveRootSession({
        sessionKey: rootSessionKey,
        sessionId: rootSessionId,
        agentId,
        sessionUuid,
        label,
        userId,
        tenantId,
        descendantSessions,
      });

      // 步骤 7：记录根 Agent 所有权
      try {
        recordSessionCreated(rootSessionKey, userId, tenantId);
      } catch (ownershipErr) {
        console.warn(
          `[mas4s:cascadeCreate] Failed to record root session ownership: ${String(ownershipErr)}`,
        );
      }

      console.log(`[mas4s] aiemas.sessions.create ← ok, sessionKey=${rootSessionKey}`);
      return { sessionKey: rootSessionKey, sessionId: rootSessionId, sessionUuid };
    },

    // ── 后续任务实现的方法（stubs）────────────────────────────────────────

    async cascadeDelete(params: { sessionKey: string }): Promise<void> {
      const { sessionKey } = params;

      // 步骤 1：加载根 Agent 记录
      const record = store.loadRootSession(sessionKey);
      if (record === undefined) {
        // 无记录：仅删除该 session 本身（兼容模式或非级联 session）
        await callGateway("sessions.delete", { key: sessionKey });
        return;
      }

      // 步骤 2：检查兼容模式（userId 为 null 时跳过级联）
      if (record.userId === null) {
        await callGateway("sessions.delete", { key: sessionKey });
        return;
      }

      // 步骤 3：删除后代 Agent session（失败时记录警告并继续）
      for (const descendantSession of record.descendantSessions) {
        try {
          await callGateway("sessions.delete", { key: descendantSession.sessionKey });
          deleteSessionRecords(descendantSession.sessionKey);
        } catch (err) {
          console.warn(
            `[mas4s:cascadeDelete] Failed to delete descendant session for ${descendantSession.agentId}: ${String(err)}`,
          );
          // 继续处理其余后代 Agent
        }
      }

      // 步骤 4：删除根 Agent session
      await callGateway("sessions.delete", { key: sessionKey });

      // 步骤 5：清理记录
      deleteSessionRecords(sessionKey);
      store.deleteRootSession(sessionKey);
    },

    async listRootSessions(): Promise<{
      ts: number;
      count: number;
      sessions: unknown[];
    }> {
      const records = store.listRootSessions();
      const sessions = records
        .map((r) => {
          try {
            const row = deps.loadGatewaySessionRow(r.sessionKey);
            if (row) {
              const rowRef = row as Record<string, unknown>;
              rowRef["sessionUuid"] = r.sessionUuid;
              if (r.label !== undefined) {
                rowRef["label"] = r.label;
              } else {
                delete rowRef["label"];
              }
            }
            return row;
          } catch (err) {
            console.warn(
              `[mas4s:listRootSessions] Failed to load row for ${r.sessionKey}: ${String(err)}`,
            );
            return null;
          }
        })
        .filter((s) => s !== null);

      return {
        ts: Date.now(),
        count: sessions.length,
        sessions,
      };
    },

    async syncTopologyChanges(params: {
      rootAgentId: string;
      oldTopology: TopologyTree | undefined;
      newTopology: TopologyTree;
      tenantId: string;
    }): Promise<void> {
      const { rootAgentId, oldTopology, newTopology, tenantId } = params;

      // 步骤 1：计算拓扑差异
      const oldDescendantIds = extractDescendantAgentIds(oldTopology?.edges ?? [], rootAgentId);
      const newDescendantIds = extractDescendantAgentIds(newTopology.edges, rootAgentId);

      const addedAgentIds = newDescendantIds.filter((id) => !oldDescendantIds.includes(id));
      const removedAgentIds = oldDescendantIds.filter((id) => !newDescendantIds.includes(id));

      console.log(
        `[mas4s:syncTopology] rootAgentId=${rootAgentId}, tenantId=${tenantId}, oldDescendants=${JSON.stringify(oldDescendantIds)}, newDescendants=${JSON.stringify(newDescendantIds)}, added=${JSON.stringify(addedAgentIds)}, removed=${JSON.stringify(removedAgentIds)}`,
      );

      // 步骤 2：查询活跃 session 记录（过滤出属于该 rootAgentId 的记录）
      const allSessions = store.listRootSessions();
      // 使用可变副本，因为后续会修改 descendantSessions
      const activeSessions = allSessions
        .filter((s) => s.agentId === rootAgentId)
        .map((s) => ({ ...s, descendantSessions: [...s.descendantSessions] }));

      console.log(
        `[mas4s:syncTopology] Found ${activeSessions.length} active sessions to sync for ${rootAgentId}`,
      );

      // 步骤 3：如果没有活跃 session，直接返回（跳过增量同步）
      if (activeSessions.length === 0) {
        return;
      }

      // 步骤 4：为新增后代 Agent 创建 session
      for (const activeSession of activeSessions) {
        for (const addedAgentId of addedAgentIds) {
          // 检查是否已经存在该后代 agent 的 session
          const exists = activeSession.descendantSessions.some((s) => s.agentId === addedAgentId);
          if (exists) {
            console.log(
              `[mas4s:syncTopology] Descendant session for ${addedAgentId} already exists in root session ${activeSession.sessionKey}, skipping.`,
            );
            continue;
          }

          try {
            console.log(
              `[mas4s:syncTopology] Creating descendant session for agentId=${addedAgentId} in root session ${activeSession.sessionUuid}`,
            );
            const descendantKey = buildDescendantSessionKey(
              addedAgentId,
              activeSession.sessionUuid,
            );
            const descendantResult = (await callGateway("sessions.create", {
              agentId: addedAgentId,
              ...(descendantKey ? { key: descendantKey } : {}),
            })) as { key: string; id: string };

            // 记录后代 Agent session 所有权
            try {
              recordSessionCreated(descendantResult.key, activeSession.userId, tenantId);
            } catch (ownershipErr) {
              console.warn(
                `[mas4s:syncTopologyChanges] Failed to record ownership for added agent ${addedAgentId}: ${String(ownershipErr)}`,
              );
            }

            activeSession.descendantSessions.push({
              agentId: addedAgentId,
              sessionKey: descendantResult.key,
              sessionId: descendantResult.id,
            });
          } catch (err) {
            console.warn(
              `[mas4s:syncTopologyChanges] Failed to create session for added agent ${addedAgentId}: ${String(err)}`,
            );
            // 继续处理其余新增 Agent
          }
        }
      }

      // 步骤 5：为移除后代 Agent 删除 session
      for (const activeSession of activeSessions) {
        for (const removedAgentId of removedAgentIds) {
          const descendantSession = activeSession.descendantSessions.find(
            (s) => s.agentId === removedAgentId,
          );
          if (descendantSession !== undefined) {
            try {
              console.log(
                `[mas4s:syncTopology] Deleting descendant session agentId=${removedAgentId}, key=${descendantSession.sessionKey}`,
              );
              await callGateway("sessions.delete", { key: descendantSession.sessionKey });
              try {
                deleteSessionRecords(descendantSession.sessionKey);
              } catch (cleanupErr) {
                console.warn(
                  `[mas4s:syncTopologyChanges] Failed to delete session records for removed agent ${removedAgentId}: ${String(cleanupErr)}`,
                );
              }
              activeSession.descendantSessions = activeSession.descendantSessions.filter(
                (s) => s.agentId !== removedAgentId,
              );
            } catch (err) {
              console.warn(
                `[mas4s:syncTopologyChanges] Failed to delete session for removed agent ${removedAgentId}: ${String(err)}`,
              );
              // 继续处理其余移除 Agent
            }
          } else {
            console.log(
              `[mas4s:syncTopology] removedAgentId=${removedAgentId} has no session entry in ${activeSession.sessionKey}`,
            );
          }
        }
      }

      // 步骤 6：更新持久化记录
      for (const activeSession of activeSessions) {
        console.log(
          `[mas4s:syncTopology] Updating store for root session ${activeSession.sessionKey}, descendant count: ${activeSession.descendantSessions.length}`,
        );
        store.updateDescendantSessions({
          sessionKey: activeSession.sessionKey,
          descendantSessions: activeSession.descendantSessions,
        });
      }
    },
  };
}

export function registerSessionHandlers(
  extraHandlers: Record<string, unknown>,
  sessionsHandlers: Record<string, unknown>,
  ctx: SessionContext,
) {
  const { plugin, getMasAuth, getActiveClients, loadSessionRow, extractUuid, log } = ctx;

  // ── session.invite ──
  const origInvite = extraHandlers["session.invite"] as
    | ((opts: unknown) => Promise<void>)
    | undefined;
  if (origInvite) {
    extraHandlers["session.invite"] = async (opts: {
      params: Record<string, unknown>;
      client: GatewayClient;
      respond: (ok: boolean, payload?: unknown, error?: unknown, meta?: unknown) => void;
    }) => {
      const targetUserId = str(opts.params["targetUserId"]);
      const sessionKey = str(opts.params["sessionKey"]);
      let inviteOk = false;
      let invitePayload: Record<string, unknown> | undefined;

      await origInvite({
        ...opts,
        respond: (ok: boolean, payload: unknown, error: unknown, meta: unknown) => {
          inviteOk = ok;
          if (ok && typeof payload === "object" && payload !== null) {
            invitePayload = payload as Record<string, unknown>;
          }
          opts.respond(ok, payload, error, meta);
        },
      });

      if (inviteOk && targetUserId && sessionKey) {
        try {
          const activeClients = getActiveClients();
          const connectedUsers = buildConnectedUsers(activeClients, getMasAuth);
          const callerAuth = getMasAuth(opts.client) ?? NULL_MAS_AUTH;
          const member = invitePayload?.["member"] as Record<string, unknown> | undefined;

          const sessionRow = loadSessionRow(sessionKey);
          const sessionLabel =
            str(sessionRow?.["label"] ?? sessionRow?.["displayName"] ?? sessionKey) ?? sessionKey;

          plugin.bridge.pushSessionJoined(
            targetUserId,
            {
              sessionKey,
              label: sessionLabel,
              invitedBy: callerAuth.userId ?? "",
              joinedAt: member ? Number(member["joinedAt"] ?? Date.now()) : Date.now(),
            },
            connectedUsers,
            (connId, event, data) => sendToConnId(connId, activeClients, event, data),
          );
        } catch (err) {
          log.warn(`mas4s pushSessionJoined failed: ${String(err)}`);
        }
      }
    };
  }

  // ── session.removeMember ──
  const origRemoveMember = extraHandlers["session.removeMember"] as
    | ((opts: unknown) => Promise<void>)
    | undefined;
  if (origRemoveMember) {
    extraHandlers["session.removeMember"] = async (opts: {
      params: Record<string, unknown>;
      client: GatewayClient;
      respond: (ok: boolean, payload?: unknown, error?: unknown, meta?: unknown) => void;
    }) => {
      const targetUserId = str(opts.params["targetUserId"]);
      const sessionKey = str(opts.params["sessionKey"]);
      let removeOk = false;

      await origRemoveMember({
        ...opts,
        respond: (ok: boolean, payload: unknown, error: unknown, meta: unknown) => {
          removeOk = ok;
          opts.respond(ok, payload, error, meta);
        },
      });

      if (removeOk && targetUserId && sessionKey) {
        try {
          const activeClients = getActiveClients();
          const connectedUsers = buildConnectedUsers(activeClients, getMasAuth);
          const callerAuth = getMasAuth(opts.client) ?? NULL_MAS_AUTH;
          plugin.bridge.pushSessionRemoved(
            targetUserId,
            { sessionKey, removedBy: callerAuth.userId ?? "" },
            connectedUsers,
            (connId, event, data) => sendToConnId(connId, activeClients, event, data),
          );
        } catch (err) {
          log.warn(`mas4s pushSessionRemoved failed: ${String(err)}`);
        }
      }
    };
  }

  // ── session.archive ──
  const origArchive = extraHandlers["session.archive"] as
    | ((opts: unknown) => Promise<void>)
    | undefined;
  if (origArchive) {
    extraHandlers["session.archive"] = async (opts: {
      params: Record<string, unknown>;
      client: GatewayClient;
      respond: (ok: boolean, payload?: unknown, error?: unknown, meta?: unknown) => void;
    }) => {
      const sessionKey = str(opts.params["sessionKey"]);
      let archiveOk = false;
      let archivePayload: Record<string, unknown> | undefined;

      await origArchive({
        ...opts,
        respond: (ok: boolean, payload: unknown, error: unknown, meta: unknown) => {
          archiveOk = ok;
          if (ok && typeof payload === "object" && payload !== null) {
            archivePayload = payload as Record<string, unknown>;
          }
          opts.respond(ok, payload, error, meta);
        },
      });

      if (archiveOk && sessionKey && archivePayload) {
        try {
          const activeClients = getActiveClients();
          const connectedUsers = buildConnectedUsers(activeClients, getMasAuth);
          const callerAuth = getMasAuth(opts.client) ?? NULL_MAS_AUTH;
          plugin.bridge.pushSessionArchived(
            sessionKey,
            {
              sessionKey,
              archivedAt: Number(archivePayload["archivedAt"] ?? Date.now()),
              archivedBy: callerAuth.userId ?? "",
            },
            connectedUsers,
            (connId, event, data) => sendToConnId(connId, activeClients, event, data),
          );
        } catch (err) {
          log.warn(`mas4s pushSessionArchived failed: ${String(err)}`);
        }
      }
    };
  }

  // ── session.unarchive ──
  const origUnarchive = extraHandlers["session.unarchive"] as
    | ((opts: unknown) => Promise<void>)
    | undefined;
  if (origUnarchive) {
    extraHandlers["session.unarchive"] = async (opts: {
      params: Record<string, unknown>;
      client: GatewayClient;
      respond: (ok: boolean, payload?: unknown, error?: unknown, meta?: unknown) => void;
    }) => {
      const sessionKey = str(opts.params["sessionKey"]);
      let unarchiveOk = false;

      await origUnarchive({
        ...opts,
        respond: (ok: boolean, payload: unknown, error: unknown, meta: unknown) => {
          unarchiveOk = ok;
          opts.respond(ok, payload, error, meta);
        },
      });

      if (unarchiveOk && sessionKey) {
        try {
          const activeClients = getActiveClients();
          const connectedUsers = buildConnectedUsers(activeClients, getMasAuth);
          const callerAuth = getMasAuth(opts.client) ?? NULL_MAS_AUTH;
          plugin.bridge.pushSessionUnarchived(
            sessionKey,
            { sessionKey, unarchivedBy: callerAuth.userId ?? "" },
            connectedUsers,
            (connId, event, data) => sendToConnId(connId, activeClients, event, data),
          );
        } catch (err) {
          log.warn(`mas4s pushSessionUnarchived failed: ${String(err)}`);
        }
      }
    };
  }

  // ── session.summary.generate ──
  const origSummaryGenerate = extraHandlers["session.summary.generate"] as
    | ((opts: unknown) => Promise<void>)
    | undefined;
  if (origSummaryGenerate) {
    extraHandlers["session.summary.generate"] = async (opts: {
      params: Record<string, unknown>;
      client: GatewayClient;
      respond: (ok: boolean, payload?: unknown, error?: unknown, meta?: unknown) => void;
    }) => {
      const sessionKey = str(opts.params["sessionKey"]);
      let generateOk = false;
      let generatePayload: Record<string, unknown> | undefined;

      await origSummaryGenerate({
        ...opts,
        respond: (ok: boolean, payload: unknown, error: unknown, meta: unknown) => {
          generateOk = ok;
          if (ok && typeof payload === "object" && payload !== null) {
            generatePayload = payload as Record<string, unknown>;
          }
          opts.respond(ok, payload, error, meta);
        },
      });

      if (generateOk && sessionKey && generatePayload?.["persisted"] === true) {
        try {
          const activeClients = getActiveClients();
          const connectedUsers = buildConnectedUsers(activeClients, getMasAuth);
          plugin.bridge.pushSummaryUpdated(
            sessionKey,
            {
              sessionKey,
              generatedAt: Number(generatePayload["generatedAt"] ?? Date.now()),
            },
            connectedUsers,
            (connId: string, event: string, data: unknown) =>
              sendToConnId(connId, activeClients, event, data),
          );
        } catch (err) {
          log.warn(`mas4s pushSummaryUpdated failed: ${String(err)}`);
        }
      }
    };
  }

  // ── sessions.delete ──
  const coreSessionsDelete = sessionsHandlers["sessions.delete"] as
    | ((opts: unknown) => Promise<void>)
    | undefined;
  if (coreSessionsDelete) {
    extraHandlers["sessions.delete"] = async (opts: {
      params: Record<string, unknown>;
      client: GatewayClient;
      respond: (ok: boolean, payload?: unknown, error?: unknown, meta?: unknown) => void;
    }) => {
      const sessionKey = str(opts.params["key"]);
      let deleteOk = false;

      await coreSessionsDelete({
        ...opts,
        respond: (ok: boolean, payload: unknown, error: unknown, meta: unknown) => {
          deleteOk = ok;
          opts.respond(ok, payload, error, meta);
        },
      });

      if (deleteOk && sessionKey) {
        try {
          plugin.bridge.onSessionDeleted(sessionKey);
        } catch (err) {
          log.warn(`mas4s onSessionDeleted failed for session=${sessionKey}: ${String(err)}`);
        }
        try {
          const uuid = extractUuid(sessionKey);
          plugin.clearRunState(uuid);
        } catch (err) {
          log.warn(`mas4s clearRunState (delete) failed for session=${sessionKey}: ${String(err)}`);
        }
      }
    };
  }

  // ── sessions.resolve ──
  const coreSessionsResolve = sessionsHandlers["sessions.resolve"] as
    | ((opts: unknown) => Promise<void>)
    | undefined;
  if (coreSessionsResolve) {
    extraHandlers["sessions.resolve"] = async (opts: {
      params: Record<string, unknown>;
      client: GatewayClient;
      respond: (ok: boolean, payload?: unknown, error?: unknown, meta?: unknown) => void;
    }) => {
      const masAuth = getMasAuth(opts.client) ?? NULL_MAS_AUTH;

      // Compat mode: no userId, skip membership check
      if (masAuth.userId === null) {
        await coreSessionsResolve(opts);
        return;
      }

      let resolvedKey: string | undefined;
      let resolveOk = false;

      // Run the core handler, capturing the resolved key from the response
      await coreSessionsResolve({
        ...opts,
        respond: (ok: boolean, payload: unknown, error: unknown, meta: unknown) => {
          if (ok && typeof payload === "object" && payload !== null) {
            const key = (payload as Record<string, unknown>)["key"];
            if (typeof key === "string") {
              resolvedKey = key;
              resolveOk = true;
            }
          }
          if (!ok) {
            // Pass through errors (session not found etc.) unchanged
            opts.respond(ok, payload, error, meta);
          }
        },
      });

      if (!resolveOk || !resolvedKey) {
        // Core handler already responded with an error above
        return;
      }

      // Now check membership for the resolved key
      const accessResult = plugin.bridge.checkSessionAccess(resolvedKey, masAuth);
      if (!accessResult.allowed) {
        opts.respond(false, undefined, {
          code: accessResult.code,
          message: accessResult.message,
        });
        return;
      }

      opts.respond(true, { ok: true, key: resolvedKey }, undefined);
    };
  }

  // ── session.run.state ──
  const origRunState = extraHandlers["session.run.state"] as
    | ((opts: unknown) => Promise<void>)
    | undefined;
  if (origRunState) {
    extraHandlers["session.run.state"] = async (opts: {
      params: Record<string, unknown>;
      client: GatewayClient;
      respond: (ok: boolean, payload?: unknown, error?: unknown, meta?: unknown) => void;
    }) => {
      let runStateOk = false;
      let runStatePayload: Record<string, unknown> | undefined;

      await origRunState({
        ...opts,
        respond: (ok: boolean, payload: unknown, error: unknown, meta: unknown) => {
          runStateOk = ok;
          if (ok && typeof payload === "object" && payload !== null) {
            runStatePayload = payload as Record<string, unknown>;
          }
          // Don't forward yet — we'll re-respond below with enriched data
          if (!ok) {
            opts.respond(ok, payload, error, meta);
          }
        },
      });

      if (!runStateOk || !runStatePayload) {
        return;
      }

      // Enrichment logic is currently in mas4s-integration.ts via SOPTracker.
      // We'll pass the enriched payload back.
      // The actual enrichment will be done in the wrapper calling this.
      opts.respond(true, runStatePayload, undefined);
    };
  }
}

export function onSessionCreated(
  sessionKey: string,
  label: string,
  client: GatewayClient,
  ctx: SessionContext,
) {
  const { plugin, getMasAuth, log } = ctx;
  try {
    const masAuth = getMasAuth(client) ?? NULL_MAS_AUTH;
    plugin.bridge.onSessionCreated(sessionKey, label, masAuth);
  } catch (err) {
    log.warn(`mas4s onSessionCreated failed for session=${sessionKey}: ${String(err)}`);
  }
}

export function filterSessionsList(
  sessions: unknown[],
  client: GatewayClient,
  ctx: SessionContext,
) {
  const { plugin, getMasAuth, log } = ctx;
  try {
    const masAuth = getMasAuth(client) ?? NULL_MAS_AUTH;
    return plugin.bridge.filterSessionsForUser(sessions, masAuth);
  } catch (err) {
    log.warn(`mas4s filterSessionsList failed: ${String(err)}`);
    return sessions;
  }
}
