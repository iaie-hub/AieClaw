import { describe, it, expect } from "vitest";
import {
  validateApiKey,
  validateNatsUrl,
  validateAgentId,
  validateAgentName,
} from "./registry-validators.js";

describe("validateApiKey", () => {
  it("valid key with correct prefix and length 64", () => {
    const key = "api-ar-" + "a".repeat(57); // 7 + 57 = 64
    expect(validateApiKey(key)).toEqual({ valid: true });
  });

  it("rejects key without correct prefix", () => {
    const key = "wrong-" + "a".repeat(58); // 64 chars but wrong prefix
    const result = validateApiKey(key);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("rejects key with correct prefix but wrong length", () => {
    const key = "api-ar-" + "a".repeat(10); // too short
    const result = validateApiKey(key);
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("rejects empty string", () => {
    const result = validateApiKey("");
    expect(result.valid).toBe(false);
  });

  it("rejects key that is too long", () => {
    const key = "api-ar-" + "a".repeat(100);
    const result = validateApiKey(key);
    expect(result.valid).toBe(false);
  });
});

describe("validateNatsUrl", () => {
  it("valid nats url", () => {
    expect(validateNatsUrl("nats://localhost:4222")).toEqual({ valid: true });
  });

  it("valid nats url with IP", () => {
    expect(validateNatsUrl("nats://192.168.1.1:4222")).toEqual({ valid: true });
  });

  it("valid nats url with domain", () => {
    expect(validateNatsUrl("nats://nats.example.com:4222")).toEqual({ valid: true });
  });

  it("rejects url without nats:// prefix", () => {
    const result = validateNatsUrl("http://localhost:4222");
    expect(result.valid).toBe(false);
  });

  it("rejects url without port", () => {
    const result = validateNatsUrl("nats://localhost");
    expect(result.valid).toBe(false);
  });

  it("rejects url with port 0", () => {
    const result = validateNatsUrl("nats://localhost:0");
    expect(result.valid).toBe(false);
  });

  it("rejects url with port > 65535", () => {
    const result = validateNatsUrl("nats://localhost:65536");
    expect(result.valid).toBe(false);
  });

  it("rejects url exceeding 256 characters", () => {
    const longHost = "a".repeat(250);
    const result = validateNatsUrl(`nats://${longHost}:4222`);
    expect(result.valid).toBe(false);
  });

  it("rejects empty string", () => {
    const result = validateNatsUrl("");
    expect(result.valid).toBe(false);
  });

  it("valid with port 1", () => {
    expect(validateNatsUrl("nats://host:1")).toEqual({ valid: true });
  });

  it("valid with port 65535", () => {
    expect(validateNatsUrl("nats://host:65535")).toEqual({ valid: true });
  });
});

describe("validateAgentId", () => {
  it("valid alphanumeric id", () => {
    expect(validateAgentId("agent-01_test")).toEqual({ valid: true });
  });

  it("valid single character", () => {
    expect(validateAgentId("a")).toEqual({ valid: true });
  });

  it("valid 64 character id", () => {
    expect(validateAgentId("a".repeat(64))).toEqual({ valid: true });
  });

  it("rejects empty string", () => {
    const result = validateAgentId("");
    expect(result.valid).toBe(false);
  });

  it("rejects id longer than 64 characters", () => {
    const result = validateAgentId("a".repeat(65));
    expect(result.valid).toBe(false);
  });

  it("rejects id with spaces", () => {
    const result = validateAgentId("agent 01");
    expect(result.valid).toBe(false);
  });

  it("rejects id with special characters", () => {
    const result = validateAgentId("agent@01");
    expect(result.valid).toBe(false);
  });
});

describe("validateAgentName", () => {
  it("valid name", () => {
    expect(validateAgentName("My Agent")).toEqual({ valid: true });
  });

  it("valid single character name", () => {
    expect(validateAgentName("A")).toEqual({ valid: true });
  });

  it("valid 128 character name", () => {
    expect(validateAgentName("a".repeat(128))).toEqual({ valid: true });
  });

  it("rejects empty string", () => {
    const result = validateAgentName("");
    expect(result.valid).toBe(false);
  });

  it("rejects name longer than 128 characters", () => {
    const result = validateAgentName("a".repeat(129));
    expect(result.valid).toBe(false);
  });

  it("allows special characters and unicode", () => {
    expect(validateAgentName("我的智能体 🤖")).toEqual({ valid: true });
  });
});
