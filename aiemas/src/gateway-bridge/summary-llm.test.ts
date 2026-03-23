/**
 * Unit tests for summary-llm.ts
 *
 * Feature: mas4s-session-collaboration
 * Validates: Requirements 4.2, 4.8
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  extractContentForSummary,
  generateSummaryWithLLM,
  type ChatHistoryMessage,
} from "./summary-llm.js";

// ── extractContentForSummary ─────────────────────────────────────────────────

describe("extractContentForSummary", () => {
  it("extracts user text with senderLabel prefix", () => {
    const messages: ChatHistoryMessage[] = [
      {
        role: "user",
        content: [{ type: "text", text: "Hello world" }],
        timestamp: 1,
        senderLabel: "管理员 (webchat-ui)",
      },
    ];
    const { textLines, toolPairs } = extractContentForSummary(messages);
    expect(textLines).toEqual(["管理员 (webchat-ui): Hello world"]);
    expect(toolPairs).toHaveLength(0);
  });

  it("defaults user prefix to 用户 when senderLabel is absent", () => {
    const messages: ChatHistoryMessage[] = [
      { role: "user", content: [{ type: "text", text: "Hi" }], timestamp: 1 },
    ];
    const { textLines } = extractContentForSummary(messages);
    expect(textLines).toEqual(["用户: Hi"]);
  });

  it("extracts assistant text with 助手 prefix, ignoring thinking blocks", () => {
    const messages: ChatHistoryMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "internal thought" },
          { type: "text", text: "Here is my answer" },
        ],
        timestamp: 2,
      },
    ];
    const { textLines, toolPairs } = extractContentForSummary(messages);
    expect(textLines).toEqual(["助手: Here is my answer"]);
    expect(toolPairs).toHaveLength(0);
  });

  it("pairs toolCall with toolResult via toolCallId", () => {
    const messages: ChatHistoryMessage[] = [
      {
        role: "assistant",
        content: [
          { type: "toolCall", id: "tc-1", name: "readFile", arguments: { path: "/tmp/a.txt" } },
        ],
        timestamp: 3,
      },
      {
        role: "toolResult",
        content: [{ type: "text", text: "file contents here" }],
        timestamp: 4,
        toolCallId: "tc-1",
        toolName: "readFile",
        isError: false,
      },
    ];
    const { textLines, toolPairs } = extractContentForSummary(messages);
    expect(textLines).toHaveLength(0);
    expect(toolPairs).toHaveLength(1);
    expect(toolPairs[0]).toEqual({
      name: "readFile",
      arguments: { path: "/tmp/a.txt" },
      result: "file contents here",
      isError: false,
    });
  });

  it("handles toolResult without matching toolCall gracefully", () => {
    const messages: ChatHistoryMessage[] = [
      {
        role: "toolResult",
        content: [{ type: "text", text: "orphan result" }],
        timestamp: 5,
        toolCallId: "tc-missing",
        toolName: "someFunc",
        isError: true,
      },
    ];
    const { toolPairs } = extractContentForSummary(messages);
    expect(toolPairs).toHaveLength(1);
    expect(toolPairs[0].name).toBe("someFunc");
    expect(toolPairs[0].isError).toBe(true);
  });

  it("skips empty text content blocks", () => {
    const messages: ChatHistoryMessage[] = [
      { role: "user", content: [{ type: "text", text: "   " }], timestamp: 1 },
      { role: "assistant", content: [{ type: "text", text: "" }], timestamp: 2 },
    ];
    const { textLines } = extractContentForSummary(messages);
    expect(textLines).toHaveLength(0);
  });

  it("returns empty arrays for empty messages", () => {
    const { textLines, toolPairs } = extractContentForSummary([]);
    expect(textLines).toHaveLength(0);
    expect(toolPairs).toHaveLength(0);
  });

  it("concatenates multiple text blocks in a single message", () => {
    const messages: ChatHistoryMessage[] = [
      {
        role: "user",
        content: [
          { type: "text", text: "Part 1 " },
          { type: "text", text: "Part 2" },
        ],
        timestamp: 1,
        senderLabel: "Alice",
      },
    ];
    const { textLines } = extractContentForSummary(messages);
    expect(textLines).toEqual(["Alice: Part 1 Part 2"]);
  });
});

// ── generateSummaryWithLLM error paths ───────────────────────────────────────

describe("generateSummaryWithLLM", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear LLM env vars
    delete process.env.MAS4S_LLM_BASE_URL;
    delete process.env.MAS4S_LLM_API_KEY;
    delete process.env.MAS4S_LLM_MODEL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("throws LLM_NOT_CONFIGURED when env vars are missing", async () => {
    await expect(generateSummaryWithLLM(["line"], [], "user1")).rejects.toThrow(
      "LLM environment variables are not configured",
    );
  });

  it("throws LLM_NOT_CONFIGURED when only some env vars are set", async () => {
    process.env.MAS4S_LLM_BASE_URL = "https://api.example.com/v1";
    // API_KEY and MODEL still missing
    await expect(generateSummaryWithLLM(["line"], [], "user1")).rejects.toThrow(
      "LLM environment variables are not configured",
    );
  });

  it("throws NO_MESSAGES_TO_SUMMARIZE when both inputs are empty", async () => {
    process.env.MAS4S_LLM_BASE_URL = "https://api.example.com/v1";
    process.env.MAS4S_LLM_API_KEY = "sk-test";
    process.env.MAS4S_LLM_MODEL = "gpt-4o-mini";
    await expect(generateSummaryWithLLM([], [], "user1")).rejects.toThrow(
      "No messages to summarize",
    );
  });
});
