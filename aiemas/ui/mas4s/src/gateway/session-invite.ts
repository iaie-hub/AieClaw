import type { GatewayBrowserClient } from "../lib/gateway.js";
import type { GatewaySessionRow } from "../lib/types.js";
import type { MasParticipant, MasSession } from "../types/session-types.js";

/**
 * 生成会话分享链接（纯前端，不调用 gateway）。
 * 将 sessionKey Base64 编码后附加到当前页面 URL 的 ?join= 参数。
 *
 * 示例：https://mas4s.local/?join=YWdlbnQ6ZGVmYXVsdDpncm91cDptYXMtYWJjZDEyMzQ=
 */
export function buildInviteUrl(sessionKey: string): string {
  const base = `${window.location.origin}${window.location.pathname}`;
  const encoded = btoa(sessionKey);
  return `${base}?join=${encodeURIComponent(encoded)}`;
}

/**
 * 从当前 URL 解析 ?join= 参数，返回 sessionKey。
 * 若无该参数或解码失败则返回 null。
 */
export function parseInviteFromUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  const encoded = params.get("join");
  if (!encoded) {
    return null;
  }
  try {
    return atob(decodeURIComponent(encoded));
  } catch {
    return null;
  }
}

/**
 * 从用户粘贴的文本中提取 sessionKey。
 * 支持两种输入格式：
 *   1. 完整分享链接：https://...?join=<encoded>
 *   2. 原始 sessionKey：agent:default:group:mas-xxxxxxxx
 */
export function parseInviteInput(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) {
    return null;
  }

  // 尝试解析为 URL
  try {
    const url = new URL(trimmed);
    const encoded = url.searchParams.get("join");
    if (encoded) {
      return atob(decodeURIComponent(encoded));
    }
  } catch {
    // 不是合法 URL，继续尝试直接作为 sessionKey
  }

  // 直接作为 sessionKey（格式：agent:*:group:*）
  if (/^agent:[^:]+:group:[^:]+$/.test(trimmed)) {
    return trimmed;
  }

  return null;
}

/**
 * 加入已有会话（invite 入口专用）：
 * 1. sessions.resolve 验证 sessionKey 存在
 * 2. sessions.list 获取完整 row（含 label/status）
 * 3. 返回 masType="participated" 的 MasSession
 */
export async function joinSessionFromInvite(
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

interface RawMember {
  userId: string;
  displayName?: string;
  role: string;
}

/**
 * 获取会话成员列表。
 */
export async function listSessionMembers(
  client: GatewayBrowserClient,
  sessionKey: string,
): Promise<MasParticipant[]> {
  const result = await client.request<{ members: RawMember[] }>("session.members", {
    sessionKey,
  });
  const rawMembers = result.members || [];
  return rawMembers.map((m) => ({
    id: m.userId,
    name: m.displayName || m.userId,
    isInitiator: m.role === "owner",
  }));
}

/**
 * 邀请用户加入会话。
 */
export async function inviteUser(
  client: GatewayBrowserClient,
  sessionKey: string,
  targetUserId: string,
): Promise<void> {
  await client.request("session.invite", { sessionKey, targetUserId });
}

/**
 * 从会话中移除成员。
 */
export async function removeMember(
  client: GatewayBrowserClient,
  sessionKey: string,
  targetUserId: string,
): Promise<void> {
  await client.request("session.removeMember", { sessionKey, targetUserId });
}
