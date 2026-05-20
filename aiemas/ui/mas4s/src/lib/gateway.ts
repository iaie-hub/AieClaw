/**
 * 自包含的 GatewayBrowserClient（mas4s 专用简化版）。
 *
 * 相比 openclaw ui/gateway.ts 的简化：
 * - 去掉 device-auth / device-identity（mas4s 是本地内部工具，不需要设备配对）
 * - 保留完整的 WebSocket 连接、重连、请求/响应、事件分发逻辑
 * - 保留 token/password 认证
 * - 正确处理 connect.challenge nonce（收到后立即发送 connect，不等 750ms 定时器）
 */

// ── 类型 ──────────────────────────────────────────────────────────────────────

export type GatewayEventFrame = {
  type: "event";
  event: string;
  payload?: unknown;
  seq?: number;
  stateVersion?: { presence: number; health: number };
};

export type GatewayResponseFrame = {
  type: "res";
  id: string;
  ok: boolean;
  payload?: unknown;
  error?: { code: string; message: string; details?: unknown };
};

export type GatewayErrorInfo = {
  code: string;
  message: string;
  details?: unknown;
};

export class GatewayRequestError extends Error {
  readonly gatewayCode: string;
  readonly details?: unknown;

  constructor(error: GatewayErrorInfo) {
    super(error.message);
    this.name = "GatewayRequestError";
    this.gatewayCode = error.code;
    this.details = error.details;
  }
}

export type GatewayHelloOk = {
  type: "hello-ok";
  protocol: number;
  server?: { version?: string; connId?: string };
  features?: { methods?: string[]; events?: string[] };
  snapshot?: unknown;
  auth?: {
    deviceToken?: string;
    role?: string;
    scopes?: string[];
    issuedAtMs?: number;
  };
  policy?: { tickIntervalMs?: number };
};

export type GatewayBrowserClientOptions = {
  url: string;
  token?: string;
  password?: string;
  clientVersion?: string;
  instanceId?: string;
  onHello?: (hello: GatewayHelloOk) => void;
  onEvent?: (evt: GatewayEventFrame) => void;
  onClose?: (info: { code: number; reason: string; error?: GatewayErrorInfo }) => void;
  onGap?: (info: { expected: number; received: number }) => void;
};

// ── 内部工具 ──────────────────────────────────────────────────────────────────

export function isNonRecoverableAuthError(error: GatewayErrorInfo | undefined): boolean {
  if (!error) {
    return false;
  }
  return (
    error.code === "UNAUTHORIZED" || error.code === "FORBIDDEN" || error.code === "INVALID_REQUEST"
  );
}

function generateUUID(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
};

// 4008 = application-defined close code
const CONNECT_FAILED_CLOSE_CODE = 4008;

// ── GatewayBrowserClient ──────────────────────────────────────────────────────

/** gateway 停止后最多重试次数（超过后停止重连，通过 onClose 通知上层） */
const MAX_RECONNECT_ATTEMPTS = 5;

export class GatewayBrowserClient {
  private ws: WebSocket | null = null;
  private pending = new Map<string, Pending>();
  private closed = false;
  private lastSeq: number | null = null;
  private connectSent = false;
  private connectTimer: number | null = null;
  private backoffMs = 800;
  private reconnectAttempts = 0;
  private pendingConnectError: GatewayErrorInfo | undefined;
  private _readyResolvers: Array<() => void> = [];
  private _helloReceived = false;

  constructor(private opts: GatewayBrowserClientOptions) {}

  start() {
    this.closed = false;
    this.reconnectAttempts = 0;
    this.connect();
  }

  stop() {
    this.closed = true;
    this.clearConnectTimer();
    this.ws?.close();
    this.ws = null;
    this.pendingConnectError = undefined;
    this.flushPending(new Error("gateway client stopped"));
  }

  get connected() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  private connect() {
    if (this.closed) {
      return;
    }
    this.ws = new WebSocket(this.opts.url);
    this.ws.addEventListener("open", () => this.queueConnect());
    this.ws.addEventListener("message", (ev) => this.handleMessage(String(ev.data ?? "")));
    this.ws.addEventListener("close", (ev) => {
      const reason = ev.reason ?? "";
      const connectError = this.pendingConnectError;
      this.pendingConnectError = undefined;
      this.ws = null;
      this.flushPending(new Error(`gateway closed (${ev.code}): ${reason}`));
      this.opts.onClose?.({ code: ev.code, reason, error: connectError });
      if (!isNonRecoverableAuthError(connectError)) {
        this.scheduleReconnect();
      }
    });
    this.ws.addEventListener("error", () => {
      // ignored; close handler will fire
    });
  }

  private scheduleReconnect() {
    if (this.closed) {
      return;
    }
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      this.opts.onClose?.({
        code: 0,
        reason: "max reconnect attempts reached",
        error: { code: "UNAVAILABLE", message: "gateway unreachable after max retries" },
      });
      return;
    }
    this.reconnectAttempts += 1;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 1.7, 15_000);
    window.setTimeout(() => this.connect(), delay);
  }

  private flushPending(err: Error) {
    for (const [, p] of this.pending) {
      p.reject(err);
    }
    this.pending.clear();
  }

  private clearConnectTimer() {
    if (this.connectTimer !== null) {
      window.clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
  }

  /**
   * Called on WebSocket open. Resets handshake state and starts a 750ms fallback
   * timer. If the server sends connect.challenge before the timer fires,
   * sendConnect() is called immediately (cancelling the timer). Otherwise the
   * timer fires sendConnect() as a fallback.
   */
  private queueConnect() {
    this.connectSent = false;
    this._helloReceived = false;
    this.clearConnectTimer();
    this.connectTimer = window.setTimeout(() => {
      this.connectTimer = null;
      void this.sendConnect();
    }, 750);
  }

  private async sendConnect() {
    if (this.connectSent) {
      return;
    }
    this.connectSent = true;
    this.clearConnectTimer();

    const params = {
      minProtocol: 4,
      maxProtocol: 4,
      client: {
        id: "webchat-ui",
        version: this.opts.clientVersion ?? "mas4s-ui",
        platform: "web",
        mode: "ui",
        instanceId: this.opts.instanceId,
      },
      role: "operator",
      scopes: ["operator.admin", "operator.read", "operator.write", "operator.approvals"],
      caps: ["tool-events"],
      auth:
        this.opts.token || this.opts.password
          ? { token: this.opts.token, password: this.opts.password }
          : undefined,
      userAgent: navigator.userAgent,
      locale: navigator.language,
    };

    void this.request<GatewayHelloOk>("connect", params)
      .then((hello) => {
        this.backoffMs = 800;
        this.reconnectAttempts = 0;
        this._helloReceived = true;
        const resolvers = this._readyResolvers.splice(0);
        for (const r of resolvers) {
          r();
        }
        this.opts.onHello?.(hello);
      })
      .catch((err: unknown) => {
        if (err instanceof GatewayRequestError) {
          this.pendingConnectError = {
            code: err.gatewayCode,
            message: err.message,
            details: err.details,
          };
        } else {
          this.pendingConnectError = undefined;
        }
        this.ws?.close(CONNECT_FAILED_CLOSE_CODE, "connect failed");
      });
  }

  private handleMessage(raw: string) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    console.debug("[gateway:ws:recv]", parsed);

    const frame = parsed as { type?: unknown };

    if (frame.type === "event") {
      const evt = parsed as GatewayEventFrame;

      // Handle connect.challenge: immediately send connect
      // instead of waiting for the 750ms fallback timer.
      if (evt.event === "connect.challenge") {
        const payload = evt.payload as { nonce?: unknown } | undefined;
        const nonce = payload && typeof payload.nonce === "string" ? payload.nonce : null;
        if (nonce) {
          void this.sendConnect();
        }
        return;
      }

      const seq = typeof evt.seq === "number" ? evt.seq : null;
      if (seq !== null) {
        if (this.lastSeq !== null && seq > this.lastSeq + 1) {
          this.opts.onGap?.({ expected: this.lastSeq + 1, received: seq });
        }
        this.lastSeq = seq;
      }
      try {
        this.opts.onEvent?.(evt);
      } catch (err) {
        console.error("[gateway] event handler error:", err);
      }
      return;
    }

    if (frame.type === "res") {
      const res = parsed as GatewayResponseFrame;
      const pending = this.pending.get(res.id);
      if (!pending) {
        return;
      }
      this.pending.delete(res.id);
      if (res.ok) {
        pending.resolve(res.payload);
      } else {
        pending.reject(
          new GatewayRequestError({
            code: res.error?.code ?? "UNAVAILABLE",
            message: res.error?.message ?? "request failed",
            details: res.error?.details,
          }),
        );
      }
    }
  }

  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("gateway not connected"));
    }
    const id = generateUUID();
    const frame = { type: "req", id, method, params };
    const p = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: (v) => resolve(v as T), reject });
    });
    console.debug("[gateway:ws:send]", frame);
    this.ws.send(JSON.stringify(frame));
    return p;
  }

  /**
   * 等待 gateway 握手完成（hello-ok 收到后）才可发业务请求。
   * 若已握手则立即 resolve；否则等待 hello-ok 回调触发。
   * timeoutMs 超时后 reject。
   */
  waitConnected(timeoutMs = 10_000): Promise<void> {
    if (this._helloReceived) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        const idx = this._readyResolvers.indexOf(resolve);
        if (idx !== -1) {
          this._readyResolvers.splice(idx, 1);
        }
        reject(new Error("gateway connect timeout"));
      }, timeoutMs);
      this._readyResolvers.push(() => {
        window.clearTimeout(timer);
        resolve();
      });
    });
  }
}
