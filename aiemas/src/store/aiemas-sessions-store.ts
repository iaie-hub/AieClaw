import type { DatabaseSync } from "node:sqlite";

/**
 * 根 Agent session 记录
 */
export interface RootSessionRecord {
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
  createdAt: number;
}

/**
 * 创建 AIEMAS Session Store
 * 负责 aiemas_sessions 表的读写操作
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
      db.prepare(
        `INSERT INTO aiemas_sessions 
         (sessionKey, sessionId, agentId, sessionUuid, label, userId, tenantId, descendantSessions, createdAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        params.sessionKey,
        params.sessionId,
        params.agentId,
        params.sessionUuid,
        params.label ?? null,
        params.userId,
        params.tenantId,
        JSON.stringify(params.descendantSessions),
        Date.now(),
      );
    },

    /**
     * 加载根 Agent session 记录
     */
    loadRootSession(sessionKey: string): RootSessionRecord | undefined {
      const row = db
        .prepare("SELECT * FROM aiemas_sessions WHERE sessionKey = ?")
        .get(sessionKey) as
        | {
            sessionKey: string;
            sessionId: string;
            agentId: string;
            sessionUuid: string;
            label: string | null;
            userId: string;
            tenantId: string;
            descendantSessions: string;
            createdAt: number;
          }
        | undefined;

      if (!row) {
        return undefined;
      }

      return {
        sessionKey: row.sessionKey,
        sessionId: row.sessionId,
        agentId: row.agentId,
        sessionUuid: row.sessionUuid,
        label: row.label ?? undefined,
        userId: row.userId,
        tenantId: row.tenantId,
        descendantSessions: JSON.parse(row.descendantSessions) as Array<{
          agentId: string;
          sessionKey: string;
          sessionId: string;
        }>,
        createdAt: row.createdAt,
      };
    },

    /**
     * 查询根 Agent session 列表
     */
    listRootSessions(): RootSessionRecord[] {
      const rows = db
        .prepare("SELECT * FROM aiemas_sessions ORDER BY createdAt DESC")
        .all() as Array<{
        sessionKey: string;
        sessionId: string;
        agentId: string;
        sessionUuid: string;
        label: string | null;
        userId: string;
        tenantId: string;
        descendantSessions: string;
        createdAt: number;
      }>;

      return rows.map((row) => ({
        sessionKey: row.sessionKey,
        sessionId: row.sessionId,
        agentId: row.agentId,
        sessionUuid: row.sessionUuid,
        label: row.label ?? undefined,
        userId: row.userId,
        tenantId: row.tenantId,
        descendantSessions: JSON.parse(row.descendantSessions) as Array<{
          agentId: string;
          sessionKey: string;
          sessionId: string;
        }>,
        createdAt: row.createdAt,
      }));
    },

    /**
     * 删除根 Agent session 记录
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
  };
}
