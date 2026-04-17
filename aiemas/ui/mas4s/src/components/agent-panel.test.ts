import { describe, it, expect, afterEach } from "vitest";
import "./agent-panel.js";
import type { AgentPanel } from "./agent-panel.js";

function createPanel(overrides: Partial<AgentPanel> = {}): AgentPanel {
  const el = document.createElement("agent-panel");
  // Minimal required props for sub variant to render content
  el.variant = "sub";
  el.agentId = "agent-1";
  el.agents = [{ id: "agent-1", name: "Test Agent" }];
  el.messages = [];
  Object.assign(el, overrides);
  document.body.appendChild(el);
  return el;
}

function cleanup(el: AgentPanel): void {
  el.remove();
}

describe("agent-panel hideClose property (sub variant)", () => {
  let el: AgentPanel;

  afterEach(() => {
    if (el) {
      cleanup(el);
    }
  });

  it("should render close button when hideClose is false (default) (需求 9.4)", async () => {
    el = createPanel();
    await el.updateComplete;

    const closeBtn = el.shadowRoot?.querySelector('button[aria-label="关闭"]');
    expect(closeBtn).not.toBeNull();
    expect(closeBtn?.textContent?.trim()).toBe("✕");
  });

  it("should NOT render close button when hideClose is true (需求 9.4)", async () => {
    el = createPanel({ hideClose: true });
    await el.updateComplete;

    const closeBtn = el.shadowRoot?.querySelector('button[aria-label="关闭"]');
    expect(closeBtn).toBeNull();
  });
});
