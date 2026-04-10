/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach } from "vitest";
import { buildInviteUrl, parseInviteInput, parseInviteFromUrl } from "./session-invite.js";

// jsdom 环境下模拟 window.location
function setLocation(url: string) {
  Object.defineProperty(window, "location", {
    value: new URL(url),
    writable: true,
    configurable: true,
  });
}

describe("buildInviteUrl", () => {
  beforeEach(() => {
    setLocation("https://mas4s.local/");
  });

  it("生成包含 ?join= 参数的 URL", () => {
    const url = buildInviteUrl("agent:default:group:mas-abc12345");
    expect(url).toContain("?join=");
  });

  it("Base64 解码后等于原始 sessionKey", () => {
    const key = "agent:default:group:mas-abc12345";
    const url = buildInviteUrl(key);
    const encoded = new URL(url).searchParams.get("join")!;
    expect(atob(decodeURIComponent(encoded))).toBe(key);
  });

  it("round-trip：buildInviteUrl → parseInviteInput", () => {
    const key = "agent:myagent:group:mas-xyz99999";
    const url = buildInviteUrl(key);
    expect(parseInviteInput(url)).toBe(key);
  });
});

describe("parseInviteInput", () => {
  it("解析完整 URL", () => {
    const key = "agent:default:group:mas-abc12345";
    const encoded = encodeURIComponent(btoa(key));
    const url = `https://mas4s.local/?join=${encoded}`;
    expect(parseInviteInput(url)).toBe(key);
  });

  it("解析裸 sessionKey", () => {
    const key = "agent:default:group:mas-abc12345";
    expect(parseInviteInput(key)).toBe(key);
  });

  it("空字符串返回 null", () => {
    expect(parseInviteInput("")).toBeNull();
    expect(parseInviteInput("   ")).toBeNull();
  });

  it("无效输入返回 null", () => {
    expect(parseInviteInput("not-a-valid-key")).toBeNull();
    expect(parseInviteInput("https://example.com/no-join-param")).toBeNull();
  });

  it("URL 无 join 参数返回 null", () => {
    expect(parseInviteInput("https://mas4s.local/?other=value")).toBeNull();
  });
});

describe("parseInviteFromUrl", () => {
  it("无 ?join= 参数时返回 null", () => {
    setLocation("https://mas4s.local/");
    expect(parseInviteFromUrl()).toBeNull();
  });

  it("有 ?join= 参数时返回 sessionKey", () => {
    const key = "agent:default:group:mas-abc12345";
    const encoded = encodeURIComponent(btoa(key));
    setLocation(`https://mas4s.local/?join=${encoded}`);
    expect(parseInviteFromUrl()).toBe(key);
  });

  it("Base64 解码失败时返回 null", () => {
    setLocation("https://mas4s.local/?join=!!!invalid!!!");
    expect(parseInviteFromUrl()).toBeNull();
  });
});
