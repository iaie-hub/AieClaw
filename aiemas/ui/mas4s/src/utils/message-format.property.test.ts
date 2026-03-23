import * as fc from "fast-check";
/**
 * Property 17: 消息发送者名替换
 * 验证: 需求 9.5
 *
 * 对任意 displayName，buildGroupMessage(displayName, text) 产生的消息
 * 经 parseSenderPrefix 解析后，senderLabel 应与 displayName 一致。
 */
import { describe, it, expect } from "vitest";
import { parseSenderPrefix } from "./message-format.js";

function buildGroupMessage(name: string, text: string) {
  return `${name}: ${text}`;
}

describe("Property 17: message sender name replacement", () => {
  // senderName: 1-40 word chars + spaces, no colon or newline
  const arbSenderName = fc.stringMatching(/^[^\n:]{1,40}$/);
  // text: non-empty, no leading whitespace (parseSenderPrefix trims after ": ")
  const arbText = fc.stringMatching(/^.{1,100}$/s);

  it("buildGroupMessage prefix round-trips through parseSenderPrefix", () => {
    fc.assert(
      fc.property(arbSenderName, arbText, (senderName, text) => {
        const msg = buildGroupMessage(senderName, text);
        const { senderLabel } = parseSenderPrefix(msg);
        expect(senderLabel).toBe(senderName.trim());
      }),
    );
  });

  it("buildGroupMessage output starts with senderName followed by colon", () => {
    fc.assert(
      fc.property(arbSenderName, arbText, (senderName, text) => {
        const msg = buildGroupMessage(senderName, text);
        expect(msg.startsWith(`${senderName}: `)).toBe(true);
      }),
    );
  });
});
