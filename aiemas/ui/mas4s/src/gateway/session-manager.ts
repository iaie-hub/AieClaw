import type { GatewayBrowserClient } from "../lib/gateway.js";
import type { GatewaySessionRow } from "../lib/types.js";
import type { MasSession } from "../types/session-types.js";

/**
 * 发起新会话：在 gateway 创建 group session，返回 masType="initiated" 的 MasSession。
 *
 * sessionKey 格式约定：含 ":group:" 的 key，gateway 自动将 kind 派生为 "group"。
 * 格式：`agent:{agentId}:group:mas-{uuid8}`
 * 不传 kind 字段（sessions.patch schema 不接受）。
 */
export async function createSession(
  client: GatewayBrowserClient,
  opts: {
    label: string;
    agentId?: string;
    participants?: string[];
  },
): Promise<MasSession> {
  const uuid = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const agentId = opts.agentId ?? "default";
  const key = `agent:${agentId}:group:mas-${uuid}`;

  const result = await client.request<{ key?: string; sessionId?: string }>("sessions.create", {
    key,
    label: opts.label,
  });

  return {
    key: result.key ?? key,
    kind: "group",
    label: opts.label,
    updatedAt: Date.now(),
    status: "running",
    masType: "initiated",
    hasNotification: false,
    notificationCount: 0,
    participants: (opts.participants ?? []).map((name, i) => ({
      id: `p-${i}`,
      name,
      isInitiator: i === 0,
    })),
  } as MasSession;
}

/**
 * 重命名会话：调用 sessions.patch 更新 label。
 */
export async function renameSession(
  client: GatewayBrowserClient,
  sessionKey: string,
  label: string,
): Promise<void> {
  await client.request("sessions.patch", { key: sessionKey, label });
}

/**
 * 加入已有会话：通过 sessions.resolve 验证 sessionKey 存在，
 * 再通过 sessions.list 获取完整 row，返回 masType="participated" 的 MasSession。
 */
export async function joinSession(
  client: GatewayBrowserClient,
  sessionKey: string,
): Promise<MasSession> {
  const resolved = await client.request<{ ok: boolean; key: string }>("sessions.resolve", {
    key: sessionKey,
  });

  if (!resolved.ok) {
    throw new Error(`会话不存在或已过期：${sessionKey}`);
  }

  const canonicalKey = resolved.key;

  // 通过 sessions.list 获取完整 row（含 label/status 等）
  const listResult = await client.request<{ sessions: GatewaySessionRow[] }>("sessions.list", {});
  const row = listResult.sessions.find((s) => s.key === canonicalKey);

  return {
    ...(row ?? { key: canonicalKey, kind: "group" as const, updatedAt: null }),
    masType: "participated",
    hasNotification: false,
    notificationCount: 0,
    participants: [],
  } as MasSession;
}
