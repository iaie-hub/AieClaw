import { describe, it, expect } from "vitest";
import { buildGroupMessage, parseSenderPrefix } from "./message-format.js";

describe("buildGroupMessage", () => {
  it("构造 'Name: text' 格式", () => {
    expect(buildGroupMessage("Alice", "你好")).toBe("Alice: 你好");
  });

  it("发送者名含中文", () => {
    expect(buildGroupMessage("张三", "内容")).toBe("张三: 内容");
  });

  it("正文含冒号", () => {
    expect(buildGroupMessage("Bob", "时间：10:00")).toBe("Bob: 时间：10:00");
  });
});

describe("parseSenderPrefix", () => {
  it("解析标准前缀", () => {
    const result = parseSenderPrefix("Alice: 你好");
    expect(result).toEqual({ senderLabel: "Alice", cleanText: "你好" });
  });

  it("无前缀返回 null senderLabel", () => {
    const result = parseSenderPrefix("普通消息内容");
    expect(result).toEqual({ senderLabel: null, cleanText: "普通消息内容" });
  });

  it("正文含换行", () => {
    const result = parseSenderPrefix("Bob: 第一行\n第二行");
    expect(result).toEqual({ senderLabel: "Bob", cleanText: "第一行\n第二行" });
  });

  it("发送者名含中文", () => {
    const result = parseSenderPrefix("张三: 内容");
    expect(result).toEqual({ senderLabel: "张三", cleanText: "内容" });
  });

  it("发送者名超过 40 字符时不解析", () => {
    const longName = "a".repeat(41);
    const result = parseSenderPrefix(`${longName}: 内容`);
    expect(result.senderLabel).toBeNull();
  });

  it("空字符串返回 null senderLabel", () => {
    const result = parseSenderPrefix("");
    expect(result).toEqual({ senderLabel: null, cleanText: "" });
  });
});

describe("round-trip 属性（属性 3）", () => {
  const cases: Array<[string, string]> = [
    ["Alice", "你好世界"],
    ["张三", "内容含冒号：test"],
    ["Bob", "多行\n内容\n测试"],
    ["User123", "hello world"],
    ["中文名字", "正文 with English"],
  ];

  for (const [name, text] of cases) {
    it(`round-trip: name="${name}"`, () => {
      const built = buildGroupMessage(name, text);
      const parsed = parseSenderPrefix(built);
      expect(parsed.senderLabel).toBe(name);
      expect(parsed.cleanText).toBe(text);
    });
  }
});

describe("无前缀消息解析（属性 4）", () => {
  const noPrefixCases = ["普通消息", "没有冒号的消息", "   空格开头", "12345", ""];

  for (const text of noPrefixCases) {
    it(`无前缀: "${text}"`, () => {
      const result = parseSenderPrefix(text);
      expect(result.senderLabel).toBeNull();
      expect(result.cleanText).toBe(text);
    });
  }
});
