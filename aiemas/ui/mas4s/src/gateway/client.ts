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
  _client = new GatewayBrowserClient({
    url,
    ...opts,
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
 * 从当前页面 URL 推断 gateway WebSocket 地址。
 * 开发时默认连接 localhost:18789。
 * 若 localStorage 中存有 mas4s_auth_token，则附加 masToken 查询参数。
 */
function resolveGatewayUrl(baseUrl?: string): string {
  let url: string;
  if (baseUrl) {
    url = baseUrl;
  } else {
    const loc = window.location;
    const proto = loc.protocol === "https:" ? "wss:" : "ws:";
    if (loc.hostname === "localhost" || loc.hostname === "127.0.0.1") {
      url = `${proto}//${loc.hostname}:18789/ws`;
    } else {
      url = `${proto}//${loc.host}/ws`;
    }
  }

  // Inject masToken if available
  const masToken = localStorage.getItem("mas4s_auth_token");
  if (masToken) {
    const separator = url.includes("?") ? "&" : "?";
    url = `${url}${separator}masToken=${encodeURIComponent(masToken)}`;
  }

  return url;
}

export type { GatewayHelloOk, GatewayEventFrame };
