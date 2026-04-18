/**
 * Integration tests for main-workspace layout switching flow.
 *
 * Feature: topology-layout-switcher
 * Validates: Requirements 2.5, 3.3, 9.1, 9.2, 9.5, 10.1, 10.4
 */

import { describe, it, expect, afterEach } from "vitest";
import type { LayoutMode } from "../types/layout-types.js";
import type { MasSession } from "../types/session-types.js";
import "./main-workspace.js";
import type { MainWorkspace } from "./main-workspace.js";

// ── Helpers ──

function createSession(overrides: Partial<MasSession> = {}): MasSession {
  return {
    key: "agent:root-agent:group:sess-001",
    sessionUuid: "sess-001",
    kind: "group",
    masType: "initiated",
    hasNotification: false,
    notificationCount: 0,
    participants: [],
    updatedAt: null,
    ...overrides,
  } as MasSession;
}

function createWorkspace(overrides: Record<string, unknown> = {}): MainWorkspace {
  const el = document.createElement("main-workspace");
  el.activeNav = "workspace";
  el.session = createSession();
  el.subAgents = ["sub-1", "sub-2"];
  el.agents = [
    { id: "root-agent", name: "Root" },
    { id: "sub-1", name: "Sub One" },
    { id: "sub-2", name: "Sub Two" },
  ];
  el.subAgentMessages = new Map([
    ["sub-1", []],
    ["sub-2", []],
  ]);
  Object.assign(el, overrides);
  document.body.appendChild(el);
  return el;
}

function cleanup(el: MainWorkspace): void {
  el.remove();
}

/** Trigger a layout change via the private handler. */
function triggerLayoutChange(el: MainWorkspace, mode: LayoutMode): void {
  (el as any)._onLayoutChange(new CustomEvent("layout-change", { detail: { mode } }));
}
// ── Test 1: Layout panel toggle (需求 2.5) ──

describe("Layout panel toggle", () => {
  let el: MainWorkspace;

  afterEach(() => {
    if (el) {
      cleanup(el);
    }
  });

  it("opens layout panel on toggle, selects a mode, panel closes and layout changes (需求 2.5, 3.3)", async () => {
    el = createWorkspace();
    await el.updateComplete;

    // Panel starts closed
    expect((el as any)._layoutPanelOpen).toBe(false);

    // Toggle open
    (el as any)._onLayoutToggle();
    await el.updateComplete;
    expect((el as any)._layoutPanelOpen).toBe(true);

    // Panel should be rendered in shadow DOM
    const panel = el.shadowRoot?.querySelector(".layout-panel");
    expect(panel).not.toBeNull();

    // Select grid-2x2 mode via _onLayoutChange
    triggerLayoutChange(el, "grid-2x2");
    await el.updateComplete;

    // Panel should close after selection
    expect((el as any)._layoutPanelOpen).toBe(false);
    // Layout mode should update
    expect((el as any)._layoutMode).toBe("grid-2x2");
  });
});

// ── Test 2: Full layout cycle (需求 3.3, 3.5) ──

describe("Full layout cycle", () => {
  let el: MainWorkspace;

  afterEach(() => {
    if (el) {
      cleanup(el);
    }
  });

  it("cycles through all modes: single → grid-2x2 → three-column → left-main → top-bottom → single", async () => {
    el = createWorkspace();
    await el.updateComplete;

    const cycle: Array<{ mode: LayoutMode; expectedViewMode: "single" | "multi" }> = [
      { mode: "single", expectedViewMode: "single" },
      { mode: "grid-2x2", expectedViewMode: "multi" },
      { mode: "three-column", expectedViewMode: "multi" },
      { mode: "left-main", expectedViewMode: "multi" },
      { mode: "top-bottom", expectedViewMode: "multi" },
      { mode: "single", expectedViewMode: "single" },
    ];

    for (const { mode, expectedViewMode } of cycle) {
      triggerLayoutChange(el, mode);
      await el.updateComplete;

      expect((el as any)._layoutMode).toBe(mode);
      expect(el.viewMode).toBe(expectedViewMode);
    }
  });
});
// ── Test 3: Multi-window rendering (需求 9.1, 9.2) ──

describe("Multi-window rendering", () => {
  let el: MainWorkspace;

  afterEach(() => {
    if (el) {
      cleanup(el);
    }
  });

  it("renders agent-panel instances in grid when layoutMode is grid-2x2 (需求 9.1, 9.2)", async () => {
    el = createWorkspace();
    await el.updateComplete;

    triggerLayoutChange(el, "grid-2x2");
    await el.updateComplete;

    // Should have a multi-grid container (not a drawer-overlay)
    const multiGrid = el.shadowRoot?.querySelector(".multi-grid");
    expect(multiGrid).not.toBeNull();

    // Should have agent-panel instances (sub variant) inside grid-slots
    const panels = el.shadowRoot?.querySelectorAll(".grid-slot agent-panel[variant='sub']");
    expect(panels).not.toBeNull();
    expect(panels!.length).toBe(2); // sub-1 and sub-2

    // Each panel should have hideClose=true
    for (const panel of panels!) {
      const p = panel as HTMLElement & { hideClose: boolean };
      expect(p.hideClose).toBe(true);
    }

    // Drawer overlay should NOT be present in multi-window mode
    const drawerOverlay = el.shadowRoot?.querySelector(".drawer-overlay");
    expect(drawerOverlay).toBeNull();
  });
});

// ── Test 4: Drawer mutual exclusion (需求 10.1, 10.4) ──

describe("Drawer mutual exclusion", () => {
  let el: MainWorkspace;

  afterEach(() => {
    if (el) {
      cleanup(el);
    }
  });

  it("closes drawer when switching from single to multi-window mode (需求 10.1)", async () => {
    el = createWorkspace();
    await el.updateComplete;

    // Directly set drawer state to open (simulating drawer open in single mode)
    (el as any)._drawerAgentId = "sub-1";
    (el as any)._drawerOpen = true;
    await el.updateComplete;
    expect((el as any)._drawerOpen).toBe(true);

    // Switch to multi-window mode — _onLayoutChange calls _closeDrawer()
    triggerLayoutChange(el, "grid-2x2");
    await el.updateComplete;

    // Drawer should be closed
    expect((el as any)._drawerOpen).toBe(false);
  });

  it("prevents drawer from opening in multi-window mode (需求 10.1)", async () => {
    el = createWorkspace();
    await el.updateComplete;

    triggerLayoutChange(el, "grid-2x2");
    await el.updateComplete;

    // Attempt to open drawer — should be blocked
    (el as any)._openDrawer("sub-1");
    await el.updateComplete;
    expect((el as any)._drawerOpen).toBe(false);
  });

  it("restores drawer behavior when switching back to single mode (需求 10.4)", async () => {
    el = createWorkspace();
    await el.updateComplete;

    // Switch to multi, then back to single
    triggerLayoutChange(el, "grid-2x2");
    await el.updateComplete;
    triggerLayoutChange(el, "single");
    await el.updateComplete;

    // Drawer should be openable again
    (el as any)._openDrawer("sub-1");
    await el.updateComplete;
    expect((el as any)._drawerOpen).toBe(true);
    expect((el as any)._drawerAgentId).toBe("sub-1");
  });
});

// ── Test 5: Event forwarding (需求 9.5) ──

describe("Event forwarding in multi-window mode", () => {
  let el: MainWorkspace;

  afterEach(() => {
    if (el) {
      cleanup(el);
    }
  });

  it("forwards drawer-send-message events from agent-panel instances (需求 9.5)", async () => {
    el = createWorkspace();
    await el.updateComplete;

    triggerLayoutChange(el, "grid-2x2");
    await el.updateComplete;

    // Listen for forwarded event on the main-workspace element
    let receivedDetail: { agentId: string; text: string } | null = null;
    el.addEventListener("drawer-send-message", ((e: CustomEvent) => {
      receivedDetail = e.detail;
    }) as EventListener);

    // Find an agent-panel (sub variant) in the grid and dispatch a drawer-send-message
    const panels = el.shadowRoot?.querySelectorAll(".grid-slot agent-panel");
    expect(panels).not.toBeNull();
    expect(panels!.length).toBeGreaterThan(0);

    const firstPanel = panels![0] as HTMLElement;
    firstPanel.dispatchEvent(
      new CustomEvent("drawer-send-message", {
        detail: { agentId: "sub-1", text: "hello" },
        bubbles: true,
        composed: true,
      }),
    );

    expect(receivedDetail).not.toBeNull();
    expect(receivedDetail!.agentId).toBe("sub-1");
    expect(receivedDetail!.text).toBe("hello");
  });
});
