/**
 * Property-based tests for layout-utils.
 *
 * Feature: topology-layout-switcher
 *
 * Properties tested in this file:
 *   Property 1: 网格维度充分性
 *   Property 2: 窗口分配正确性
 *   Property 3: 全列布局列数等于 Agent 总数
 *   Property 4: 响应式布局降级
 */

import * as fc from "fast-check";
import { describe, it, expect } from "vitest";
import type { LayoutMode } from "../types/layout-types.js";
import {
  computeGridDimensions,
  computeGridLayout,
  resolveEffectiveLayout,
} from "../utils/layout-utils.js";

// ── Arbitraries ──

/** agentId: alphanumeric + hyphens, starts with a letter, 1-20 chars */
const arbAgentId = fc.stringMatching(/^[a-z][a-z0-9-]{0,19}$/);

/** Multi-layout modes (excludes "single") */
const arbMultiLayoutMode: fc.Arbitrary<LayoutMode> = fc.constantFrom(
  "grid-2x2" as const,
  "three-column" as const,
  "left-main" as const,
  "top-bottom" as const,
);

/** All layout modes */
const arbLayoutMode: fc.Arbitrary<LayoutMode> = fc.constantFrom(
  "single" as const,
  "grid-2x2" as const,
  "three-column" as const,
  "left-main" as const,
  "top-bottom" as const,
);

/** Viewport width: 300-2560 */
const arbViewportWidth = fc.integer({ min: 300, max: 2560 });

/** Deduplicate an array preserving order */
function deduplicate(arr: string[]): string[] {
  const seen = new Set<string>();
  return arr.filter((x) => {
    if (seen.has(x)) {
      return false;
    }
    seen.add(x);
    return true;
  });
}

/** Sub-agent list: 0-10 unique agent ids */
const arbSubAgentList = fc.array(arbAgentId, { minLength: 0, maxLength: 10 }).map(deduplicate);

// ── Property 1: 网格维度充分性 ──

describe("Feature: topology-layout-switcher, Property 1: 网格维度充分性", () => {
  /**
   * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.9
   *
   * For any agent count N (1-20), computeGridDimensions(N) returns
   * cols × rows ≥ N (all agents fit) AND spare slots < cols (at most
   * one incomplete row of waste).
   */
  it("cols × rows ≥ N AND spare slots (cols × rows - N) < cols", () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 20 }), (n: number) => {
        const { cols, rows } = computeGridDimensions(n);
        const totalSlots = cols * rows;
        const spare = totalSlots - n;

        // All agents must fit
        expect(totalSlots).toBeGreaterThanOrEqual(n);
        // At most one incomplete row of waste
        expect(spare).toBeLessThan(cols);
      }),
      { numRuns: 100 },
    );
  });
});

// ── Property 2: 窗口分配正确性 ──

describe("Feature: topology-layout-switcher, Property 2: 窗口分配正确性", () => {
  /**
   * Validates: Requirements 5.7, 5.8, 5.9, 6.2, 6.3, 6.4, 7.2, 7.3, 7.5, 8.2, 8.3, 8.5, 9.1
   *
   * For any multi-layout mode and agent list:
   * 1. slots[0].agentId === rootAgentId AND slots[0].type === "root"
   * 2. Subsequent "sub" type slots correspond 1:1 with subAgentIds in order
   * 3. Count of "sub" slots === subAgentIds.length
   * 4. All remaining slots have type "placeholder"
   */
  it("slots[0] is root, sub slots match subAgentIds in order, rest are placeholders", () => {
    fc.assert(
      fc.property(
        arbMultiLayoutMode,
        arbAgentId,
        arbSubAgentList,
        (mode: LayoutMode, rootAgentId: string, subAgentIds: string[]) => {
          const result = computeGridLayout(mode, rootAgentId, subAgentIds);
          const { slots } = result;

          // 1. First slot is root
          expect(slots[0].agentId).toBe(rootAgentId);
          expect(slots[0].type).toBe("root");

          // 2 & 3. Sub slots match subAgentIds in order
          const subSlots = slots.filter((s) => s.type === "sub");
          expect(subSlots.length).toBe(subAgentIds.length);
          subSlots.forEach((slot, i) => {
            expect(slot.agentId).toBe(subAgentIds[i]);
          });

          // 4. Remaining slots are placeholders
          const nonRootNonSub = slots.slice(1 + subAgentIds.length);
          for (const slot of nonRootNonSub) {
            expect(slot.type).toBe("placeholder");
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── Property 3: 全列布局列数等于 Agent 总数 ──

describe("Feature: topology-layout-switcher, Property 3: 全列布局列数等于 Agent 总数", () => {
  /**
   * Validates: Requirement 6.1
   *
   * For any rootAgentId and subAgentIds, three-column mode's column count
   * equals 1 + subAgentIds.length. Parse gridTemplateColumns repeat(N, 1fr)
   * to extract N.
   */
  it("three-column gridTemplateColumns repeat(N, 1fr) where N = 1 + subAgentIds.length", () => {
    fc.assert(
      fc.property(arbAgentId, arbSubAgentList, (rootAgentId: string, subAgentIds: string[]) => {
        const result = computeGridLayout("three-column", rootAgentId, subAgentIds);
        const expectedN = 1 + subAgentIds.length;

        // Parse repeat(N, 1fr)
        const match = result.gridTemplateColumns.match(/^repeat\((\d+),\s*1fr\)$/);
        expect(match).not.toBeNull();
        const actualN = Number(match![1]);
        expect(actualN).toBe(expectedN);
      }),
      { numRuns: 100 },
    );
  });
});

// ── Property 4: 响应式布局降级 ──

describe("Feature: topology-layout-switcher, Property 4: 响应式布局降级", () => {
  /**
   * Validates: Requirements 11.1, 11.3, 11.4
   *
   * For any LayoutMode and viewport width (300-2560):
   * 1. viewportWidth < 768 → returns "single"
   * 2. 768 ≤ viewportWidth < 1024 AND userChoice === "grid-2x2" → returns "left-main"
   * 3. viewportWidth ≥ 1024 → returns userChoice
   * 4. 768 ≤ viewportWidth < 1024 AND userChoice !== "grid-2x2" → returns userChoice
   */
  it("responsive downgrade rules hold for all layout modes and viewport widths", () => {
    fc.assert(
      fc.property(
        arbLayoutMode,
        arbViewportWidth,
        (userChoice: LayoutMode, viewportWidth: number) => {
          const result = resolveEffectiveLayout(userChoice, viewportWidth);

          if (viewportWidth < 768) {
            // Rule 1: small screen → single
            expect(result).toBe("single");
          } else if (viewportWidth < 1024 && userChoice === "grid-2x2") {
            // Rule 2: medium screen + grid-2x2 → left-main
            expect(result).toBe("left-main");
          } else if (viewportWidth >= 1024) {
            // Rule 3: large screen → userChoice
            expect(result).toBe(userChoice);
          } else {
            // Rule 4: medium screen + non-grid-2x2 → userChoice
            expect(result).toBe(userChoice);
          }
        },
      ),
      { numRuns: 100 },
    );
  });
});
