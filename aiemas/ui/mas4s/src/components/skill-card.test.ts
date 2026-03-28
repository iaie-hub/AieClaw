import { describe, it, expect, beforeEach, vi } from "vitest";
import type { SkillStatusEntry } from "../types/skills-types.js";
import "./skill-card.js";
import type { SkillCard } from "./skill-card.js";

function createSkillCard(skill: SkillStatusEntry, selected = false): SkillCard {
  const el = document.createElement("skill-card");
  el.skill = skill;
  el.selected = selected;
  document.body.appendChild(el);
  return el;
}

function cleanupElement(el: SkillCard): void {
  el.remove();
}

describe("skill-card", () => {
  let mockSkill: SkillStatusEntry;

  beforeEach(() => {
    mockSkill = {
      name: "Test Skill",
      description: "A test skill for unit testing",
      source: "openclaw-workspace",
      skillKey: "test-skill",
      filePath: "/path/to/skill.md",
      emoji: "🧪",
      disabled: false,
      eligible: true,
      missing: { bins: [], env: [], config: [] },
      install: [],
    };
  });

  it("should render skill name", async () => {
    const el = createSkillCard(mockSkill);
    await el.updateComplete;
    const name = el.shadowRoot?.querySelector(".skill-name");
    expect(name?.textContent).toBe("Test Skill");
    cleanupElement(el);
  });

  it("should render skill description", async () => {
    const el = createSkillCard(mockSkill);
    await el.updateComplete;
    const description = el.shadowRoot?.querySelector(".skill-description");
    expect(description?.textContent).toBe("A test skill for unit testing");
    cleanupElement(el);
  });

  it("should render skill emoji icon", async () => {
    const el = createSkillCard(mockSkill);
    await el.updateComplete;
    const icon = el.shadowRoot?.querySelector(".skill-icon");
    expect(icon?.textContent).toBe("🧪");
    cleanupElement(el);
  });

  it("should render default icon when emoji is missing", async () => {
    const skillWithoutEmoji = { ...mockSkill, emoji: undefined };
    const el = createSkillCard(skillWithoutEmoji);
    await el.updateComplete;
    const icon = el.shadowRoot?.querySelector(".skill-icon");
    expect(icon?.textContent).toBe("📦");
    cleanupElement(el);
  });

  it("should show ready status indicator when skill is enabled and eligible (需求 11.8)", async () => {
    const el = createSkillCard(mockSkill);
    await el.updateComplete;
    const indicator = el.shadowRoot?.querySelector(".skill-status-indicator");
    expect(indicator?.classList.contains("ready")).toBe(true);
    const statusText = el.shadowRoot?.querySelector(".skill-status-text");
    expect(statusText?.textContent).toBe("就绪");
    cleanupElement(el);
  });

  it("should show needs-setup status indicator when skill is enabled but not eligible (需求 11.8)", async () => {
    const needsSetupSkill = { ...mockSkill, eligible: false };
    const el = createSkillCard(needsSetupSkill);
    await el.updateComplete;
    const indicator = el.shadowRoot?.querySelector(".skill-status-indicator");
    expect(indicator?.classList.contains("needs-setup")).toBe(true);
    const statusText = el.shadowRoot?.querySelector(".skill-status-text");
    expect(statusText?.textContent).toBe("需要配置");
    cleanupElement(el);
  });

  it("should show disabled status indicator when skill is disabled (需求 11.7)", async () => {
    const disabledSkill = { ...mockSkill, disabled: true };
    const el = createSkillCard(disabledSkill);
    await el.updateComplete;
    const indicator = el.shadowRoot?.querySelector(".skill-status-indicator");
    expect(indicator?.classList.contains("disabled")).toBe(true);
    const statusText = el.shadowRoot?.querySelector(".skill-status-text");
    expect(statusText?.textContent).toBe("已禁用");
    cleanupElement(el);
  });

  it("should apply selected class when selected prop is true", async () => {
    const el = createSkillCard(mockSkill, true);
    await el.updateComplete;
    const card = el.shadowRoot?.querySelector(".skill-card");
    expect(card?.classList.contains("selected")).toBe(true);
    cleanupElement(el);
  });

  it("should not apply selected class when selected prop is false", async () => {
    const el = createSkillCard(mockSkill, false);
    await el.updateComplete;
    const card = el.shadowRoot?.querySelector(".skill-card");
    expect(card?.classList.contains("selected")).toBe(false);
    cleanupElement(el);
  });

  it("should dispatch skill-select event when clicked (需求 4.1)", async () => {
    const el = createSkillCard(mockSkill);
    await el.updateComplete;
    const eventSpy = vi.fn();
    el.addEventListener("skill-select", eventSpy);

    const card = el.shadowRoot?.querySelector(".skill-card") as HTMLElement;
    card.click();

    expect(eventSpy).toHaveBeenCalledOnce();
    const event = eventSpy.mock.calls[0][0] as CustomEvent;
    expect(event.detail.skill).toEqual(mockSkill);
    cleanupElement(el);
  });

  it("should dispatch skill-select event when Enter key is pressed", async () => {
    const el = createSkillCard(mockSkill);
    await el.updateComplete;
    const eventSpy = vi.fn();
    el.addEventListener("skill-select", eventSpy);

    const card = el.shadowRoot?.querySelector(".skill-card") as HTMLElement;
    const enterEvent = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
    card.dispatchEvent(enterEvent);

    expect(eventSpy).toHaveBeenCalledOnce();
    cleanupElement(el);
  });

  it("should dispatch skill-select event when Space key is pressed", async () => {
    const el = createSkillCard(mockSkill);
    await el.updateComplete;
    const eventSpy = vi.fn();
    el.addEventListener("skill-select", eventSpy);

    const card = el.shadowRoot?.querySelector(".skill-card") as HTMLElement;
    const spaceEvent = new KeyboardEvent("keydown", { key: " ", bubbles: true });
    card.dispatchEvent(spaceEvent);

    expect(eventSpy).toHaveBeenCalledOnce();
    cleanupElement(el);
  });

  it("should render skill source", async () => {
    const el = createSkillCard(mockSkill);
    await el.updateComplete;
    const source = el.shadowRoot?.querySelector(".skill-source");
    expect(source?.textContent).toBe("openclaw-workspace");
    cleanupElement(el);
  });

  it("should have proper accessibility attributes", async () => {
    const el = createSkillCard(mockSkill);
    await el.updateComplete;
    const card = el.shadowRoot?.querySelector(".skill-card") as HTMLElement;
    expect(card.getAttribute("role")).toBe("button");
    expect(card.getAttribute("tabindex")).toBe("0");
    expect(card.getAttribute("aria-label")).toBe("Test Skill");
    cleanupElement(el);
  });

  it("should display skill name (需求 2.3)", async () => {
    const el = createSkillCard(mockSkill);
    await el.updateComplete;
    const name = el.shadowRoot?.querySelector(".skill-name");
    expect(name?.textContent).toBe(mockSkill.name);
    cleanupElement(el);
  });

  it("should display skill description (需求 2.4)", async () => {
    const el = createSkillCard(mockSkill);
    await el.updateComplete;
    const description = el.shadowRoot?.querySelector(".skill-description");
    expect(description?.textContent).toBe(mockSkill.description);
    cleanupElement(el);
  });

  it("should display skill status indicator (需求 2.5)", async () => {
    const el = createSkillCard(mockSkill);
    await el.updateComplete;
    const indicator = el.shadowRoot?.querySelector(".skill-status-indicator");
    expect(indicator).not.toBeNull();
    cleanupElement(el);
  });
});
