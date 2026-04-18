import * as fc from "fast-check";
/**
 * Unit + property tests for the resolveAgentTools injection point in createOpenClawTools.
 *
 * Feature: a2a-communication
 * Validates: Requirements 1.3
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnyAgentTool } from "./tools/common.js";
// ── Stub heavy tool factories so importing openclaw-tools stays cheap ──
import "./test-helpers/fast-openclaw-tools-sessions.ts";
import "./test-helpers/fast-tool-stubs.ts";

vi.mock("../gateway/call.js", () => ({
  callGateway: vi.fn(),
}));

vi.mock("../config/config.js", async () => {
  const actual = await vi.importActual<typeof import("../config/config.js")>("../config/config.js");
  return {
    ...actual,
    loadConfig: () => ({
      tools: { sessions: { visibility: "all" }, agentToAgent: { enabled: true } },
    }),
    resolveGatewayPort: () => 18789,
  };
});

vi.mock("../secrets/runtime.js", () => ({
  getActiveRuntimeWebToolsMetadata: () => undefined,
}));

import type { Mas4sIntegration } from "../gateway/mas4s-integration.js";
import { createOpenClawTools, setMas4sIntegrationRef } from "./openclaw-tools.js";

// ── Helper: create a minimal fake tool ──
function fakeTool(name: string): AnyAgentTool {
  return {
    name,
    description: `${name} fake`,
    parameters: { type: "object" as const, properties: {} },
    execute: vi.fn(async () => ({ text: "ok", details: {} })),
  } as unknown as AnyAgentTool;
}

describe("resolveAgentTools injection point", () => {
  beforeEach(() => {
    // Reset to no integration before each test
    setMas4sIntegrationRef(null);
  });

  // ── Unit tests ──

  it("returns normal tools when resolveAgentTools is undefined (null integration)", () => {
    setMas4sIntegrationRef(null);
    const tools = createOpenClawTools({ disablePluginTools: true });
    expect(tools.length).toBeGreaterThan(0);
    // All tools should be core tools — no AIEMAS tools injected
    const names = tools.map((t) => t.name);
    expect(names).not.toContain("aiemas_sessions_send");
  });

  it("appends resolveAgentTools results to the end of the tool list", () => {
    const aiemasToolA = fakeTool("aiemas_tool_a");
    const aiemasToolB = fakeTool("aiemas_tool_b");

    const integration = {
      resolveAgentTools: () => [aiemasToolA, aiemasToolB],
    } as unknown as Mas4sIntegration;
    setMas4sIntegrationRef(integration);

    const tools = createOpenClawTools({ disablePluginTools: true });
    const names = tools.map((t) => t.name);

    // AIEMAS tools should be at the end
    expect(names.at(-2)).toBe("aiemas_tool_a");
    expect(names.at(-1)).toBe("aiemas_tool_b");

    // Core tools should still be present and unaffected
    expect(names.includes("canvas")).toBe(true);
    expect(names.includes("nodes")).toBe(true);
  });

  it("catches resolveAgentTools exceptions and continues with normal tools", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const integration = {
      resolveAgentTools: () => {
        throw new Error("AIEMAS plugin crashed");
      },
    } as unknown as Mas4sIntegration;
    setMas4sIntegrationRef(integration);

    const tools = createOpenClawTools({ disablePluginTools: true });
    expect(tools.length).toBeGreaterThan(0);

    // Should have logged a warning
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("resolveAgentTools failed"));

    // No AIEMAS tools should be present
    const names = tools.map((t) => t.name);
    expect(names.every((n) => !n.startsWith("aiemas_"))).toBe(true);

    warnSpy.mockRestore();
  });

  it("returns normal tools when resolveAgentTools returns an empty array", () => {
    const integration = {
      resolveAgentTools: () => [],
    } as unknown as Mas4sIntegration;
    setMas4sIntegrationRef(integration);

    const toolsWithEmpty = createOpenClawTools({ disablePluginTools: true });

    setMas4sIntegrationRef(null);
    const toolsWithNull = createOpenClawTools({ disablePluginTools: true });

    // Same set of tools
    expect(toolsWithEmpty.map((t) => t.name)).toEqual(toolsWithNull.map((t) => t.name));
  });

  // ── Property-based test ──

  /**
   * Property 1: 工具注入追加到列表末尾
   *
   * For any non-empty AIEMAS tool array returned by resolveAgentTools,
   * after calling createOpenClawTools, the returned tool list should end
   * with those AIEMAS tools (after core tools), and the core tool list
   * should be unaffected.
   *
   * **Validates: Requirements 1.3**
   */
  it("Property 1: tool injection appends to list end (fast-check)", () => {
    // Get the baseline core tools (no injection)
    setMas4sIntegrationRef(null);
    const coreTools = createOpenClawTools({ disablePluginTools: true });
    const coreNames = coreTools.map((t) => t.name);

    // Arbitrary: generate 1-10 fake AIEMAS tool names
    const arbToolNames = fc
      .array(fc.stringMatching(/^[a-z][a-z0-9_]{2,19}$/), { minLength: 1, maxLength: 10 })
      // Ensure unique names that don't collide with core tools
      .map((names) => {
        const unique = [...new Set(names.map((n) => `aiemas_${n}`))];
        return unique.filter((n) => !coreNames.includes(n));
      })
      .filter((names) => names.length > 0);

    fc.assert(
      fc.property(arbToolNames, (toolNames) => {
        const aiemasTools = toolNames.map((name) => fakeTool(name));

        const integration = {
          resolveAgentTools: () => aiemasTools,
        } as unknown as Mas4sIntegration;
        setMas4sIntegrationRef(integration);

        const result = createOpenClawTools({ disablePluginTools: true });
        const resultNames = result.map((t) => t.name);

        // 1. The returned list ends with the AIEMAS tools in order
        const tail = resultNames.slice(-toolNames.length);
        expect(tail).toEqual(toolNames);

        // 2. The core tools prefix is unaffected
        const prefix = resultNames.slice(0, coreNames.length);
        expect(prefix).toEqual(coreNames);

        // 3. Total length = core + AIEMAS
        expect(resultNames.length).toBe(coreNames.length + toolNames.length);
      }),
      { numRuns: 100 },
    );

    // Cleanup
    setMas4sIntegrationRef(null);
  });
});
