import { describe, it, expect, vi } from "vitest";
import type { GatewayBrowserClient } from "../lib/gateway.js";
import { createSession, joinSession } from "./session-manager.js";

function makeClient(overrides: Partial<Record<string, unknown>> = {}): GatewayBrowserClient {
  return {
    request: vi.fn(),
    ...overrides,
  } as unknown as GatewayBrowserClient;
}

describe("createSession（属性 1：sessionKey 格式）", () => {
  it("生成的 key 包含 :group:", async () => {
    const client = makeClient({
      request: vi.fn().mockResolvedValue({ key: undefined, sessionId: "sid-1" }),
    });
    const session = await createSession(client, { label: "测试会话" });
    expect(session.key).toMatch(/:group:/);
  });

  it("key 符合 agent:{agentId}:group:mas-{uuid} 格式", async () => {
    const client = makeClient({
      request: vi.fn().mockResolvedValue({ key: undefined }),
    });
    const session = await createSession(client, {
      label: "测试",
      agentId: "myagent",
    });
    expect(session.key).toMatch(/^agent:myagent:group:mas-[0-9a-f]+$/);
  });

  it("masType 为 initiated", async () => {
    const client = makeClient({
      request: vi.fn().mockResolvedValue({ key: "agent:default:group:mas-abc12345" }),
    });
    const session = await createSession(client, { label: "会话" });
    expect(session.masType).toBe("initiated");
  });

  it("使用 gateway 返回的 key（若有）", async () => {
    const returnedKey = "agent:default:group:mas-returned";
    const client = makeClient({
      request: vi.fn().mockResolvedValue({ key: returnedKey }),
    });
    const session = await createSession(client, { label: "会话" });
    expect(session.key).toBe(returnedKey);
  });
});

describe("joinSession（属性 2：masType）", () => {
  it("返回的 masType 为 participated", async () => {
    const client = makeClient({
      request: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, key: "agent:default:group:mas-abc" })
        .mockResolvedValueOnce({ sessions: [] }),
    });
    const session = await joinSession(client, "agent:default:group:mas-abc");
    expect(session.masType).toBe("participated");
  });

  it("sessions.resolve 返回 ok:false 时抛出错误", async () => {
    const client = makeClient({
      request: vi.fn().mockResolvedValue({ ok: false, key: "" }),
    });
    await expect(joinSession(client, "agent:default:group:mas-notfound")).rejects.toThrow(
      "agent:default:group:mas-notfound",
    );
  });

  it("从 sessions.list 获取完整 row", async () => {
    const fullRow = {
      key: "agent:default:group:mas-abc",
      kind: "group",
      label: "完整会话标签",
      updatedAt: 12345,
      status: "running",
    };
    const client = makeClient({
      request: vi
        .fn()
        .mockResolvedValueOnce({ ok: true, key: "agent:default:group:mas-abc" })
        .mockResolvedValueOnce({ sessions: [fullRow] }),
    });
    const session = await joinSession(client, "agent:default:group:mas-abc");
    expect(session.label).toBe("完整会话标签");
    expect(session.status).toBe("running");
  });
});
