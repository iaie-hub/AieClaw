/**
 * Property-based tests for main-workspace component.
 *
 * Feature: topology-layout-switcher
 *
 * Properties tested in this file:
 *   Property 5: 非 Single 模式同步 viewMode
 */

import * as fc from "fast-check";
import { describe, it, expect, afterEach } from "vitest";
import type { LayoutMode } from "../types/layout-types.js";
import "./main-workspace.js";
import type { MainWorkspace } from "./main-workspace.js";

// ── Arbitraries ──

/** All layout modes */
const arbLayoutMode: fc.Arbitrary<LayoutMode> = fc.constantFrom(
  "single" as const,
  "grid-2x2" as const,
  "three-column" as const,
  "left-main" as const,
  "top-bottom" as const,
);

// ── Helpers ──

function createElement(): MainWorkspace {
  const el = document.createElement("main-workspace");
  document.body.appendChild(el);
  return el;
}

function cleanup(el: MainWorkspace): void {
  el.remove();
}

// ── Property 5: 非 Single 模式同步 viewMode ──

describe("Feature: topology-layout-switcher, Property 5: 非 Single 模式同步 viewMode", () => {
  let el: MainWorkspace;

  afterEach(() => {
    if (el) {
      cleanup(el);
    }
  });

  /**
   * **Validates: Requirements 3.5**
   *
   * For any non-"single" LayoutMode, when _onLayoutChange is called with
   * that mode, viewMode should be "multi".
   * When _onLayoutChange is called with "single", viewMode should be "single".
   */
  it("viewMode syncs to 'multi' for non-single modes and 'single' for single mode", async () => {
    el = createElement();
    await el.updateComplete;

    fc.assert(
      fc.property(arbLayoutMode, (mode: LayoutMode) => {
        (el as any)._onLayoutChange(new CustomEvent("layout-change", { detail: { mode } }));

        if (mode === "single") {
          expect(el.viewMode).toBe("single");
        } else {
          expect(el.viewMode).toBe("multi");
        }
      }),
      { numRuns: 100 },
    );
  });
});
