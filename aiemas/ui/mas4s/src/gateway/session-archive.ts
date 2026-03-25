import type { GatewayBrowserClient } from "../lib/gateway.js";
import type { SessionSummary } from "../types/session-types.js";

/**
 * 归档会话（仅 Session_Owner 可调用）。
 * 归档后会话不可继续发送消息；后端会自动触发摘要生成。
 */
export async function archiveSession(
  client: GatewayBrowserClient,
  sessionKey: string,
): Promise<void> {
  await client.request("session.archive", { sessionKey });
}

/**
 * 启用已归档会话（仅 Session_Owner 可调用）。
 * 启用后会话恢复为活跃状态，可继续发送消息。
 */
export async function unarchiveSession(
  client: GatewayBrowserClient,
  sessionKey: string,
): Promise<void> {
  await client.request("session.unarchive", { sessionKey });
}

/**
 * 生成会话摘要。
 * - 未归档会话：所有 Session_Member 可调用，摘要仅返回不持久化
 * - 已归档会话：仅 Session_Owner 可调用，摘要持久化并推送事件
 */
export async function generateSummary(
  client: GatewayBrowserClient,
  sessionKey: string,
): Promise<SessionSummary> {
  const result = await client.request<{
    textSummary: string | null;
    toolSummary: string | null;
    generatedAt: number;
    persisted: boolean;
  }>("session.summary.generate", { sessionKey });

  return {
    sessionKey,
    textSummary: result.textSummary,
    toolSummary: result.toolSummary,
    generatedAt: result.generatedAt,
    generatedBy: "", // 由后端管理，前端生成调用时不需要
  };
}

/**
 * 获取已持久化的会话摘要。
 * 所有 Session_Member 可调用；若尚无持久化摘要则返回 null。
 */
export async function getSummary(
  client: GatewayBrowserClient,
  sessionKey: string,
): Promise<SessionSummary | null> {
  const result = await client.request<{ summary: SessionSummary | null }>("session.summary.get", {
    sessionKey,
  });
  return result.summary;
}
