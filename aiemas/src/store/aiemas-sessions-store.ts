import type { DatabaseSync } from "node:sqlite";
import { extractUuidFromKey } from "../utils/session-utils.js";

/**
 * 根 Agent session 记录
 */
export interface RootSessionRecord {
  sessionKey: string;
  sessionId: string;
  agentId: string;
  sessionUuid: string;
  label?: string;
  currentAgentId?: string;
  userId: string;
  tenantId: string;
  descendantSessions: Array<{
    agentId: string;
    sessionKey: string;
    sessionId: string;
  }>;
  createdAt: number;
  updatedAt: number;
}

/**
 * Session label entry (returned by label query methods).
 * Replaces the old SessionLabelEntry from session-label-store.
 */
export interface SessionLabelEntry {
  sessionUuid: string;
  label: string | null;
  currentAgentId: string | null;
  updatedAt: number;
}

/** Raw row shape from aiemas_sessions SELECT * */
interface RawRow {
  sessionUuid: string;
  sessionKey: string;
  sessionId: string;
  agentId: string;
  label: string | null;
  currentAgentId: string | null;
  userId: string;
  tenantId: string;
  descendantSessions: string;
  createdAt: number;
  updatedAt: number;
}

function rowToRecord(row: RawRow): RootSessionRecord {
  return {
    sessionKey: row.sessionKey,
    sessionId: row.sessionId,
    agentId: row.agentId,
    sessionUuid: row.sessionUuid,
    label: row.label ?? undefined,
    currentAgentId: row.currentAgentId ?? undefined,
    userId: row.userId,
    tenantId: row.tenantId,
    descendantSessions: JSON.parse(row.descendantSessions) as Array<{
      agentId: string;
      sessionKey: string;
      sessionId: string;
    }>,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * 创建 AIEMAS Session Store
 * 负责 aiemas_sessions 表的读写操作（含原 session_labels 功能）
 */
export function createAiemasSessionsStore(db: DatabaseSync) {
  return {
    /**
     * 保存根 Agent session 记录
     */
    saveRootSession(params: {
      sessionKey: string;
      sessionId: string;
      agentId: string;
      sessionUuid: string;
      label?: string;
      userId: string;
      tenantId: string;
      descendantSessions: Array<{
        agentId: string;
        sessionKey: string;
        sessionId: string;
      }>;
    }): void {
      const now = Date.now();
      db.prepare(
        `INSERT INTO aiemas_sessions
         (sessionUuid, sessionKey, sessionId, agentId, label, currentAgentId, userId, tenantId, descendantSessions, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        params.sessionUuid,
        params.sessionKey,
        params.sessionId,
        params.agentId,
        params.label ?? null,
        params.agentId,
        params.userId,
        params.tenantId,
        JSON.stringify(params.descendantSessions),
        now,
        now,
      );
    },

    /**
     * 加载根 Agent session 记录（按 sessionKey 查询）
     */
    loadRootSession(sessionKey: string): RootSessionRecord | undefined {
      const row = db
        .prepare("SELECT * FROM aiemas_sessions WHERE sessionKey = ?")
        .get(sessionKey) as RawRow | undefined;
      return row ? rowToRecord(row) : undefined;
    },

    /**
     * 查询根 Agent session 列表
     */
    listRootSessions(): RootSessionRecord[] {
      const rows = db
        .prepare("SELECT * FROM aiemas_sessions ORDER BY createdAt DESC")
        .all() as unknown as RawRow[];
      return rows.map(rowToRecord);
    },

    /**
     * 删除根 Agent session 记录（按 sessionKey）
     */
    deleteRootSession(sessionKey: string): void {
      db.prepare("DELETE FROM aiemas_sessions WHERE sessionKey = ?").run(sessionKey);
    },

    /**
     * 更新 descendantSessions 字段
     */
    updateDescendantSessions(params: {
      sessionKey: string;
      descendantSessions: Array<{
        agentId: string;
        sessionKey: string;
        sessionId: string;
      }>;
    }): void {
      db.prepare("UPDATE aiemas_sessions SET descendantSessions = ? WHERE sessionKey = ?").run(
        JSON.stringify(params.descendantSessions),
        params.sessionKey,
      );
    },

    // ── Label / currentAgentId 操作（原 session-label-store 功能）──

    /**
     * Upsert label/currentAgentId for a session.
     * If the session exists in aiemas_sessions, update in place.
     * Accepts sessionKey and handles UUID extraction internally.
     */
    upsertSessionLabel(
      sessionKey: string,
      patch: { label?: string | null; currentAgentId?: string | null },
    ): void {
      const uuid = extractUuidFromKey(sessionKey);
      const now = Date.now();

      const existing = db
        .prepare("SELECT label, currentAgentId FROM aiemas_sessions WHERE sessionUuid = ?")
        .get(uuid) as { label: string | null; currentAgentId: string | null } | undefined;

      if (!existing) {
        // No aiemas_sessions row yet — skip (label sync only applies to known sessions)
        return;
      }

      const nextLabel = patch.label !== undefined ? patch.label : existing.label;
      const nextAgentId =
        patch.currentAgentId !== undefined ? patch.currentAgentId : existing.currentAgentId;

      db.prepare(
        "UPDATE aiemas_sessions SET label = ?, currentAgentId = ?, updatedAt = ? WHERE sessionUuid = ?",
      ).run(nextLabel, nextAgentId, now, uuid);
    },

    /**
     * Get the persisted label entry for a sessionUuid or sessionKey.
     */
    getSessionLabel(identifier: string): SessionLabelEntry | null {
      const uuid = identifier.includes(":") ? extractUuidFromKey(identifier) : identifier;
      const row = db
        .prepare(
          "SELECT sessionUuid, label, currentAgentId, updatedAt FROM aiemas_sessions WHERE sessionUuid = ?",
        )
        .get(uuid) as
        | {
            sessionUuid: string;
            label: string | null;
            currentAgentId: string | null;
            updatedAt: number;
          }
        | undefined;
      return row ?? null;
    },

    /**
     * List all session label entries, ordered by most recently updated.
     */
    listSessionLabels(): SessionLabelEntry[] {
      return db
        .prepare(
          "SELECT sessionUuid, label, currentAgentId, updatedAt FROM aiemas_sessions ORDER BY updatedAt DESC",
        )
        .all() as unknown as SessionLabelEntry[];
    },

    /**
     * Delete the session record (accepts sessionUuid or sessionKey).
     */
    deleteSessionByUuid(identifier: string): void {
      const uuid = identifier.includes(":") ? extractUuidFromKey(identifier) : identifier;
      db.prepare("DELETE FROM aiemas_sessions WHERE sessionUuid = ?").run(uuid);
    },

    /**
     * Count sessions using a specific agentId as currentAgentId.
     */
    countByCurrentAgentId(agentId: string): number {
      const row = db
        .prepare("SELECT COUNT(*) AS count FROM aiemas_sessions WHERE currentAgentId = ?")
        .get(agentId) as { count: number };
      return row.count;
    },
  };
}
