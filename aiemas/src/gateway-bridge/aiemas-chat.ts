import {
  str,
  buildConnectedUsers,
  type GatewayClient,
  type GatewayContext,
} from "./aiemas-utils.js";
import { MasAuthContext, NULL_MAS_AUTH } from "./context.js";
import type { Mas4sGatewayPlugin } from "./mas4s-gateway-plugin.js";

export interface ChatContext {
  plugin: Mas4sGatewayPlugin;
  getMasAuth: (client: GatewayClient) => MasAuthContext | null;
  getActiveClients: () => Set<GatewayClient>;
  sopTracker: {
    recordChatEvent: (params: {
      sessionKey: string;
      event: string;
      payload: unknown;
      ts: number;
    }) => void;
  };
  broadcastToAll: (event: string, payload: unknown) => void;
}

export function registerChatHandlers(
  extraHandlers: Record<string, unknown>,
  chatHandlers: Record<string, unknown>,
  ctx: ChatContext,
) {
  const { plugin, sopTracker, broadcastToAll } = ctx;

  // ── chat.send ──
  const coreChatSend = chatHandlers["chat.send"] as ((opts: unknown) => Promise<void>) | undefined;
  if (coreChatSend) {
    chatHandlers["chat.send"] = async (opts: {
      params: Record<string, unknown>;
      client: GatewayClient;
      context: GatewayContext;
      respond: (ok: boolean, payload?: unknown, error?: unknown, meta?: unknown) => void;
    }) => {
      const { params, respond } = opts;
      if (process.env.OPENCLAW_MAS4S_DEBUG === "1") {
        console.log(
          `[aiemas:chat.send] bridge wrapper entered, sessionKey=${String(params["sessionKey"])}`,
        );
      }

      // Proxy respond to capture results and ensure transparency
      const wrappedRespond: typeof respond = (ok, payload, error, meta) => {
        if (process.env.OPENCLAW_MAS4S_DEBUG === "1") {
          console.log(
            `[aiemas:chat.send] bridge respond ok=${ok} payloadKeys=${Object.keys(payload || {}).join(",")}`,
          );
        }
        respond(ok, payload, error, meta);
      };

      try {
        await coreChatSend({ ...opts, respond: wrappedRespond });
      } finally {
        // Post-send side effects (SOP tracking, etc.)
        try {
          const sessionKey = str(params["sessionKey"] ?? params["key"]);
          const text = str(params["text"]);
          if (sessionKey && text) {
            sopTracker.recordChatEvent({
              sessionKey,
              event: "chat",
              payload: { state: "user", text, ts: Date.now() },
              ts: Date.now(),
            });
          }
        } catch (err) {
          console.warn(`mas4s chat.send hook side-effects failed: ${String(err)}`);
        }
      }
    };

    // CRITICAL: Explicitly add to extraHandlers so it overrides coreGatewayHandlers in server-methods.ts
    extraHandlers["chat.send"] = chatHandlers["chat.send"];
  }

  // ── chat.on-agent-reply (Internal Hook) ──
  extraHandlers["chat.on-agent-reply"] = async (payload: unknown) => {
    if (typeof payload === "object" && payload !== null) {
      const p = payload as Record<string, unknown>;
      const sessionKey = str(p["sessionKey"]);
      const replyText = str(p["text"]);
      if (sessionKey && replyText) {
        sopTracker.recordChatEvent({
          sessionKey,
          event: "chat",
          payload: { state: "agent", text: replyText, ts: Date.now() },
          ts: Date.now(),
        });
        broadcastToAll("chat.agent-reply", { sessionKey, text: replyText, ts: Date.now() });
      }
    }
  };

  // ── session.summary.generate ──
  extraHandlers["session.summary.generate"] = async (opts: {
    params: Record<string, unknown>;
    respond: (ok: boolean, payload?: unknown, error?: unknown, meta?: unknown) => void;
    context: GatewayContext;
    client: GatewayClient;
  }) => {
    const { params, respond, client } = opts;
    const sessionKey = str(params["sessionKey"] ?? params["key"] ?? params["session"]);
    if (!sessionKey) {
      return respond(false, null, { code: "INVALID_PARAMS", message: "Missing sessionKey" });
    }

    const masAuth = ctx.getMasAuth(client) ?? NULL_MAS_AUTH;
    if (!masAuth.userId) {
      return respond(false, null, { code: "UNAUTHORIZED", message: "MAS authentication required" });
    }

    const result = await plugin.bridge.generateSummary({
      sessionKey,
      callerUserId: masAuth.userId,
      fetchHistory: async () => {
        // Dispatch to core to fetch history
        // NOTE: This usually requires a gatewayDispatch or similar.
        // For now, we assume bridge can handle it if we provide a shim.
        return [];
      },
    });

    if (result.ok) {
      respond(true, result);
      if (result.persisted) {
        const activeClients = ctx.getActiveClients();
        plugin.bridge.pushSummaryUpdated(
          sessionKey,
          { sessionKey, generatedAt: result.generatedAt },
          buildConnectedUsers(activeClients, ctx.getMasAuth),
          (connId, event, data) => {
            const c = Array.from(activeClients).find((cl) => cl.connId === connId);
            if (c?.socket) {
              c.socket.send(JSON.stringify({ type: "event", event, data }));
            }
          },
        );
      }
    } else {
      respond(false, null, { code: result.code, message: result.message });
    }
  };
}

export function filterBroadcast(
  event: string,
  payload: unknown,
  clients: GatewayClient[],
  ctx: ChatContext,
): Set<string> {
  const { plugin, getMasAuth } = ctx;
  const connectedUsers = new Map<string, MasAuthContext>();
  for (const client of clients) {
    if (client.connId) {
      const auth = getMasAuth(client);
      if (auth) {
        connectedUsers.set(client.connId, auth);
      }
    }
  }

  // ── 路径 C：旁路捕获 exec.approval 事件写入 session_messages ──────────
  if (event === "exec.approval.requested" || event === "exec.approval.resolved") {
    try {
      const p = payload as Record<string, unknown>;
      const request = p["request"] as Record<string, unknown> | undefined;
      const sessionKey = typeof request?.["sessionKey"] === "string" ? request["sessionKey"] : "";
      if (sessionKey) {
        const type = event === "exec.approval.requested" ? "requested" : "resolved";
        const ts =
          typeof p["createdAtMs"] === "number"
            ? p["createdAtMs"]
            : typeof p["ts"] === "number"
              ? p["ts"]
              : Date.now();
        plugin.transcriptStore.recordApprovalEvent({
          sessionKey,
          type,
          payload,
          timestamp: ts,
        });
      }
    } catch (err) {
      console.warn(`[aiemas:filterBroadcast] approval capture failed: ${String(err)}`);
    }
  }

  const targets = plugin.bridge.filterBroadcastTargets(event, payload, connectedUsers);
  if (!targets) {
    // null targets means broadcast to all
    return new Set(
      Array.from(clients)
        .map((c) => c.connId)
        .filter((id): id is string => !!id),
    );
  }

  // Map userIds back to connIds
  const targetConnIds = new Set<string>();
  for (const client of clients) {
    if (client.connId) {
      const auth = connectedUsers.get(client.connId);
      if (auth?.userId && targets.has(auth.userId)) {
        targetConnIds.add(client.connId);
      }
    }
  }
  return targetConnIds;
}
