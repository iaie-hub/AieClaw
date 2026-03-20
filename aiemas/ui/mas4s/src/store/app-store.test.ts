import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ApprovalRequest } from "../types/approval-types.js";
import type { ChatMessage } from "../types/chat-types.js";
import type { MasSession } from "../types/session-types.js";
import { AppStore } from "./app-store.js";

// 重置单例，确保每个测试独立
function resetSingleton() {
  // @ts-expect-error 访问私有字段以重置单例
  AppStore._instance = null;
}

function makeSession(key: string): MasSession {
  return {
    key,
    kind: "group",
    updatedAt: null,
    masType: "initiated",
    hasNotification: false,
    notificationCount: 0,
    participants: [],
  };
}

function makeMessage(id: string): ChatMessage {
  return {
    id,
    role: "user",
    content: [{ type: "text", text: "hello" }],
    timestamp: Date.now(),
    senderLabel: null,
  };
}

function makeApproval(id: string): ApprovalRequest {
  return {
    id,
    request: {
      command: "ls",
      cwd: null,
      nodeId: null,
      host: null,
      security: null,
      ask: null,
      agentId: null,
      resolvedPath: null,
      sessionKey: null,
      turnSourceChannel: null,
      turnSourceTo: null,
      turnSourceAccountId: null,
      turnSourceThreadId: null,
    },
    createdAtMs: Date.now(),
    expiresAtMs: Date.now() + 60_000,
  };
}

describe("AppStore 单例（属性 9）", () => {
  beforeEach(resetSingleton);

  it("多次 instance 调用返回同一引用", () => {
    const a = AppStore.instance;
    const b = AppStore.instance;
    const c = AppStore.instance;
    expect(a).toBe(b);
    expect(b).toBe(c);
  });
});

describe("审批队列增长（属性 7）", () => {
  beforeEach(resetSingleton);

  it("addApproval 后 pendingApprovals 长度 +1", () => {
    const store = AppStore.instance;
    expect(store.pendingApprovals).toHaveLength(0);
    store.addApproval(makeApproval("a1"));
    expect(store.pendingApprovals).toHaveLength(1);
    store.addApproval(makeApproval("a2"));
    expect(store.pendingApprovals).toHaveLength(2);
  });

  it("addApproval 后队列包含该请求", () => {
    const store = AppStore.instance;
    const req = makeApproval("req-1");
    store.addApproval(req);
    expect(store.pendingApprovals).toContainEqual(req);
  });
});

describe("审批队列移除（属性 8）", () => {
  beforeEach(resetSingleton);

  it("resolveApproval 后队列不含该 id", () => {
    const store = AppStore.instance;
    store.addApproval(makeApproval("a1"));
    store.addApproval(makeApproval("a2"));
    store.resolveApproval("a1");
    expect(store.pendingApprovals.find((a) => a.id === "a1")).toBeUndefined();
    expect(store.pendingApprovals).toHaveLength(1);
  });

  it("resolveApproval 不存在的 id 不报错", () => {
    const store = AppStore.instance;
    expect(() => store.resolveApproval("nonexistent")).not.toThrow();
  });
});

describe("响应式通知（属性 10）", () => {
  beforeEach(resetSingleton);

  it("状态变更后所有已注册 host 的 requestUpdate 被调用", () => {
    const store = AppStore.instance;
    const host1 = {
      requestUpdate: vi.fn(),
      addController: vi.fn(),
      removeController: vi.fn(),
      updateComplete: Promise.resolve(true),
    };
    const host2 = {
      requestUpdate: vi.fn(),
      addController: vi.fn(),
      removeController: vi.fn(),
      updateComplete: Promise.resolve(true),
    };
    store.addHost(host1);
    store.addHost(host2);

    store.addApproval(makeApproval("x"));
    expect(host1.requestUpdate).toHaveBeenCalledTimes(1);
    expect(host2.requestUpdate).toHaveBeenCalledTimes(1);

    store.setSessions([makeSession("s1")]);
    expect(host1.requestUpdate).toHaveBeenCalledTimes(2);
    expect(host2.requestUpdate).toHaveBeenCalledTimes(2);
  });

  it("removeHost 后不再收到通知", () => {
    const store = AppStore.instance;
    const host = {
      requestUpdate: vi.fn(),
      addController: vi.fn(),
      removeController: vi.fn(),
      updateComplete: Promise.resolve(true),
    };
    store.addHost(host);
    store.removeHost(host);
    store.addApproval(makeApproval("y"));
    expect(host.requestUpdate).not.toHaveBeenCalled();
  });
});

describe("消息追加（属性 6）", () => {
  beforeEach(resetSingleton);

  it("appendMessage 后消息数组末尾含新消息", () => {
    const store = AppStore.instance;
    const msg = makeMessage("m1");
    store.appendMessage("session-1", msg);
    const msgs = store.messagesBySession.get("session-1");
    expect(msgs).toHaveLength(1);
    expect(msgs?.[0]).toEqual(msg);
  });

  it("多次 appendMessage 保持顺序", () => {
    const store = AppStore.instance;
    store.appendMessage("s", makeMessage("m1"));
    store.appendMessage("s", makeMessage("m2"));
    store.appendMessage("s", makeMessage("m3"));
    const msgs = store.messagesBySession.get("s");
    expect(msgs?.map((m) => m.id)).toEqual(["m1", "m2", "m3"]);
  });

  it("clearMessages 清空对应 sessionKey 的消息", () => {
    const store = AppStore.instance;
    store.appendMessage("s", makeMessage("m1"));
    store.clearMessages("s");
    expect(store.messagesBySession.get("s")).toHaveLength(0);
  });
});

describe("setActiveSession", () => {
  beforeEach(resetSingleton);

  it("更新 activeSessionId", () => {
    const store = AppStore.instance;
    store.setActiveSession("key-1");
    expect(store.activeSessionId).toBe("key-1");
  });

  it("activeSession 返回对应会话", () => {
    const store = AppStore.instance;
    const session = makeSession("key-1");
    store.setSessions([session]);
    store.setActiveSession("key-1");
    expect(store.activeSession).toEqual(session);
  });
});
