import { describe, it, expect, afterEach } from "vitest";
import "./topology-bar.js";
import type { TopologyBar } from "./topology-bar.js";

/** Minimal props so the component renders (subAgents.length > 0 required). */
function createBar(overrides: Partial<TopologyBar> = {}): TopologyBar {
  const el = document.createElement("topology-bar");
  el.subAgents = ["agent-1"];
  el.agents = [{ id: "agent-1", name: "Test" }];
  el.rootAgentId = "root";
  Object.assign(el, overrides);
  document.body.appendChild(el);
  return el;
}

function cleanup(el: TopologyBar): void {
  el.remove();
}

function getLayoutBtn(el: TopologyBar): HTMLElement | null {
  return el.shadowRoot?.querySelector(".layout-btn") ?? null;
}

describe("topology-bar Layout_Button", () => {
  let el: TopologyBar;

  afterEach(() => {
    if (el) {
      cleanup(el);
    }
  });

  // ── Requirement 1.1 / 1.5: DOM attributes ──

  it("renders Layout_Button with role='button' (需求 1.5)", async () => {
    el = createBar();
    await el.updateComplete;
    const btn = getLayoutBtn(el);
    expect(btn).not.toBeNull();
    expect(btn!.getAttribute("role")).toBe("button");
  });

  it("renders Layout_Button with tabindex='0' (需求 1.5)", async () => {
    el = createBar();
    await el.updateComplete;
    const btn = getLayoutBtn(el);
    expect(btn!.getAttribute("tabindex")).toBe("0");
  });

  it("renders Layout_Button with aria-label='布局切换' (需求 1.5)", async () => {
    el = createBar();
    await el.updateComplete;
    const btn = getLayoutBtn(el);
    expect(btn!.getAttribute("aria-label")).toBe("布局切换");
  });

  // ── Requirement 1.3: click dispatches layout-toggle ──

  it("dispatches layout-toggle custom event on click (需求 1.3)", async () => {
    el = createBar();
    await el.updateComplete;

    let received = false;
    let eventBubbles = false;
    let eventComposed = false;

    el.addEventListener("layout-toggle", ((e: Event) => {
      received = true;
      eventBubbles = e.bubbles;
      eventComposed = e.composed;
    }) as EventListener);

    const btn = getLayoutBtn(el)!;
    btn.click();

    expect(received).toBe(true);
    expect(eventBubbles).toBe(true);
    expect(eventComposed).toBe(true);
  });

  // ── Requirement 1.6: Enter key dispatches layout-toggle ──

  it("dispatches layout-toggle on Enter key (需求 1.6)", async () => {
    el = createBar();
    await el.updateComplete;

    let received = false;
    el.addEventListener("layout-toggle", () => {
      received = true;
    });

    const btn = getLayoutBtn(el)!;
    btn.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
    );

    expect(received).toBe(true);
  });

  // ── Requirement 1.6: Space key dispatches layout-toggle ──

  it("dispatches layout-toggle on Space key (需求 1.6)", async () => {
    el = createBar();
    await el.updateComplete;

    let received = false;
    el.addEventListener("layout-toggle", () => {
      received = true;
    });

    const btn = getLayoutBtn(el)!;
    btn.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true, composed: true }));

    expect(received).toBe(true);
  });

  // ── Requirement 1.5 / 11.2: layoutDisabled styling and no event ──

  it("has 'disabled' class and does NOT dispatch events when layoutDisabled=true (需求 1.5, 11.2)", async () => {
    el = createBar({ layoutDisabled: true });
    await el.updateComplete;

    const btn = getLayoutBtn(el)!;
    expect(btn.classList.contains("disabled")).toBe(true);

    let received = false;
    el.addEventListener("layout-toggle", () => {
      received = true;
    });

    btn.click();
    expect(received).toBe(false);

    // Also verify keyboard does not fire
    btn.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true, composed: true }),
    );
    expect(received).toBe(false);
  });

  // ── Requirement 1.1: active class when layoutMode !== "single" ──

  it("has 'active' class when layoutMode is not 'single' (需求 1.1)", async () => {
    el = createBar({ layoutMode: "grid-2x2" });
    await el.updateComplete;

    const btn = getLayoutBtn(el)!;
    expect(btn.classList.contains("active")).toBe(true);
  });

  it("does NOT have 'active' class when layoutMode is 'single'", async () => {
    el = createBar({ layoutMode: "single" });
    await el.updateComplete;

    const btn = getLayoutBtn(el)!;
    expect(btn.classList.contains("active")).toBe(false);
  });
});
