import { GatewayBrowserClient } from "../lib/gateway.js";
import type {
  GatewayBrowserClientOptions,
  GatewayEventFrame,
  GatewayHelloOk,
} from "../lib/gateway.js";

let _client: GatewayBrowserClient | null = null;
// 事件处理器列表，在 client 创建前注册的处理器会在创建时传入
const _pendingHandlers: Array<(evt: GatewayEventFrame) => void> = [];

/**
 * 获取 GatewayBrowserClient 单例。
 * 首次调用时创建并启动连接，onEvent 通过构造函数 opts 传入。
 */
export function getClient(opts?: Partial<GatewayBrowserClientOptions>): GatewayBrowserClient {
  if (_client) {
    return _client;
  }

  const url = opts?.url ?? resolveGatewayUrl();
  // Gateway token (OPENCLAW_GATEWAY_TOKEN) is needed for the connect handshake.
  // If not explicitly provided, fall back to the stored gateway token.
  // Note: mas4s_auth_token is the user JWT (passed separately as masToken in connect params),
  // not the gateway token — do NOT use it here as the gateway token.
  const gatewayToken = opts?.token ?? localStorage.getItem("mas4s_ws_token") ?? undefined;
  _client = new GatewayBrowserClient({
    url,
    ...opts,
    token: gatewayToken,
    onEvent: (evt: GatewayEventFrame) => {
      // 调用所有已注册的事件处理器
      for (const handler of _pendingHandlers) {
        handler(evt);
      }
      opts?.onEvent?.(evt);
    },
  });
  _client.start();
  return _client;
}

/**
 * 注册事件处理器。若 client 尚未创建，处理器会在创建时自动绑定。
 * 若 client 已创建，此函数无效（onEvent 已在构造时固定）。
 * 应在 getClient() 之前调用。
 */
export function addEventHandler(handler: (evt: GatewayEventFrame) => void): void {
  _pendingHandlers.push(handler);
}

/** 重置客户端（断开连接，保留已注册的事件处理器以便重连） */
export function resetClient(): void {
  _client?.stop();
  _client = null;
  // 不清空 _pendingHandlers — registerEventHandlers 仅在 connectedCallback 调用一次，
  // 重连时需要保留已注册的处理器
}

/**
 * 从 localStorage 或当前页面 URL 推断 gateway WebSocket 地址。
 * 优先使用 localStorage 中保存的 mas4s_ws_url，其次根据当前页面 URL 推断。
 */
function resolveGatewayUrl(baseUrl?: string): string {
  if (baseUrl) {
    return baseUrl;
  }
  const stored = localStorage.getItem("mas4s_ws_url");
  if (stored) {
    return stored;
  }
  const loc = window.location;
  const proto = loc.protocol === "https:" ? "wss:" : "ws:";
  if (loc.hostname === "localhost" || loc.hostname === "127.0.0.1") {
    return `${proto}//${loc.hostname}:18789/ws`;
  }
  return `${proto}//${loc.host}/ws`;
}

export type { GatewayHelloOk, GatewayEventFrame };
