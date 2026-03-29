import { fixture, html } from "@open-wc/testing";
import { describe, it, expect, beforeEach, vi } from "vitest";
import "./skill-detail-panel.js";
import type { SkillStatusEntry } from "../types/skills-types.js";
import type { SkillDetailPanel } from "./skill-detail-panel.js";

describe("skill-detail-panel", () => {
  let element: SkillDetailPanel;
  const mockSkill: SkillStatusEntry = {
    name: "Test Skill",
    description: "A test skill for unit testing",
    source: "openclaw-workspace",
    skillKey: "test-skill",
    filePath: "/path/to/test-skill.md",
    baseDir: "/path/to",
    emoji: "🧪",
    homepage: "https://example.com",
    disabled: false,
    eligible: true,
    always: false,
    blockedByAllowlist: false,
    requirements: {
      bins: ["node", "npm"],
      anyBins: [],
      env: ["API_KEY"],
      config: ["test.config"],
      os: [],
    },
    missing: {
      bins: [],
      anyBins: [],
      env: [],
      config: [],
      os: [],
    },
    configChecks: [],
    install: [
      {
        id: "install-1",
        label: "Install dependencies",
        kind: "npm",
        bins: ["npm"],
      },
    ],
  };

  beforeEach(async () => {
    element = await fixture<SkillDetailPanel>(html`<skill-detail-panel></skill-detail-panel>`);
  });

  it("should render empty state when no skill is provided", () => {
    const emptyState = element.shadowRoot?.querySelector(".empty-state");
    expect(emptyState).toBeTruthy();
    expect(emptyState?.textContent).toContain("未选择 Skill");
  });

  it("should display skill name and description", async () => {
    element.skill = mockSkill;
    element.open = true;
    await element.updateComplete;

    const title = element.shadowRoot?.querySelector(".panel-title");
    const description = element.shadowRoot?.querySelector(".section-content");

    expect(title?.textContent).toBe("Test Skill");
    expect(description?.textContent).toBe("A test skill for unit testing");
  });

  it("should display skill emoji icon", async () => {
    element.skill = mockSkill;
    element.open = true;
    await element.updateComplete;

    const icon = element.shadowRoot?.querySelector(".panel-icon-wrapper");
    expect(icon?.textContent).toBe("🧪");
  });

  it("should display default icon when emoji is not provided", async () => {
    const skillWithoutEmoji = { ...mockSkill, emoji: undefined };
    element.skill = skillWithoutEmoji;
    element.open = true;
    await element.updateComplete;

    const icon = element.shadowRoot?.querySelector(".panel-icon-wrapper");
    expect(icon?.textContent).toBe("📦");
  });

  it("should display current enabled status", async () => {
    element.skill = mockSkill;
    element.open = true;
    await element.updateComplete;

    const statusText = element.shadowRoot?.querySelector(".status-text");
    expect(statusText?.textContent).toBe("就绪");
  });

  it("should display disabled status when skill is disabled", async () => {
    const disabledSkill = { ...mockSkill, disabled: true };
    element.skill = disabledSkill;
    element.open = true;
    await element.updateComplete;

    const statusText = element.shadowRoot?.querySelector(".status-text");
    expect(statusText?.textContent).toBe("已禁用");
  });

  it("should display unavailable status when skill is not eligible", async () => {
    const unavailableSkill = { ...mockSkill, eligible: false };
    element.skill = unavailableSkill;
    element.open = true;
    await element.updateComplete;

    const statusText = element.shadowRoot?.querySelector(".status-text");
    expect(statusText?.textContent).toBe("不可用");
  });

  it("should show toggle button", async () => {
    element.skill = mockSkill;
    element.open = true;
    await element.updateComplete;

    const toggleButton = element.shadowRoot?.querySelector(".action-toggle-button");
    expect(toggleButton).toBeTruthy();
  });

  it("should emit toggle-enabled event on button click", async () => {
    element.skill = mockSkill;
    element.open = true;
    await element.updateComplete;

    const eventSpy = vi.fn();
    element.addEventListener("toggle-enabled", eventSpy);

    const toggleButton = element.shadowRoot?.querySelector(
      ".action-toggle-button",
    ) as HTMLButtonElement;
    toggleButton?.click();

    expect(eventSpy).toHaveBeenCalledOnce();
    expect(eventSpy.mock.calls[0][0].detail).toEqual({
      skillKey: "test-skill",
      enabled: false, // Currently enabled, so toggle to disabled
    });
  });

  it("should display configuration requirements", async () => {
    element.skill = mockSkill;
    element.open = true;
    await element.updateComplete;

    const requirements = element.shadowRoot?.querySelectorAll(".req-badge");
    expect(requirements?.length).toBeGreaterThan(0);

    const requirementTexts = Array.from(requirements || []).map((el) => el.textContent);
    expect(requirementTexts.some((text) => text?.includes("node"))).toBe(true);
    expect(requirementTexts.some((text) => text?.includes("API_KEY"))).toBe(true);
  });

  it("should display install status", async () => {
    element.skill = mockSkill;
    element.open = true;
    await element.updateComplete;

    const content = element.shadowRoot?.textContent || "";
    expect(content).toContain("Install dependencies");
  });

  it("should display file path when available", async () => {
    element.skill = mockSkill;
    element.open = true;
    await element.updateComplete;

    const filePath = element.shadowRoot?.querySelector(".file-path-container");
    expect(filePath?.textContent).toBe("/path/to/test-skill.md");
  });

  it("should not display file path section when not available", async () => {
    const skillWithoutPath = { ...mockSkill, filePath: "" };
    element.skill = skillWithoutPath;
    element.open = true;
    await element.updateComplete;

    const filePath = element.shadowRoot?.querySelector(".file-path-container");
    expect(filePath).toBeFalsy();
  });

  it("should provide close button", async () => {
    element.skill = mockSkill;
    element.open = true;
    await element.updateComplete;

    const closeButton = element.shadowRoot?.querySelector(".close-button");
    expect(closeButton).toBeTruthy();
  });

  it("should emit close event when close button is clicked", async () => {
    element.skill = mockSkill;
    element.open = true;
    await element.updateComplete;

    const eventSpy = vi.fn();
    element.addEventListener("close", eventSpy);

    const closeButton = element.shadowRoot?.querySelector(".close-button") as HTMLButtonElement;
    closeButton?.click();

    expect(eventSpy).toHaveBeenCalledOnce();
  });

  it("should emit close event when backdrop is clicked", async () => {
    element.skill = mockSkill;
    element.open = true;
    await element.updateComplete;

    const eventSpy = vi.fn();
    element.addEventListener("close", eventSpy);

    const backdrop = element.shadowRoot?.querySelector(".detail-backdrop") as HTMLElement;
    backdrop?.click();

    expect(eventSpy).toHaveBeenCalledOnce();
  });

  it("should apply open class when open property is true", async () => {
    element.skill = mockSkill;
    element.open = true;
    await element.updateComplete;

    const panel = element.shadowRoot?.querySelector(".detail-panel");
    expect(panel?.classList.contains("open")).toBe(true);
  });

  it("should not apply open class when open property is false", async () => {
    element.skill = mockSkill;
    element.open = false;
    await element.updateComplete;

    const panel = element.shadowRoot?.querySelector(".detail-panel");
    expect(panel?.classList.contains("open")).toBe(false);
  });

  it("should show backdrop when open", async () => {
    element.skill = mockSkill;
    element.open = true;
    await element.updateComplete;

    const backdrop = element.shadowRoot?.querySelector(".detail-backdrop");
    expect(backdrop?.classList.contains("visible")).toBe(true);
  });

  it("should disable toggle button when updating", async () => {
    element.skill = mockSkill;
    element.open = true;
    element.updating = true;
    await element.updateComplete;

    const toggleButton = element.shadowRoot?.querySelector(
      ".action-toggle-button",
    ) as HTMLButtonElement;
    expect(toggleButton?.classList.contains("updating")).toBe(true);
    expect(toggleButton?.disabled).toBe(true);
  });

  it("should not emit toggle-enabled event when updating", async () => {
    element.skill = mockSkill;
    element.open = true;
    element.updating = true;
    await element.updateComplete;

    const eventSpy = vi.fn();
    element.addEventListener("toggle-enabled", eventSpy);

    const toggleButton = element.shadowRoot?.querySelector(
      ".action-toggle-button",
    ) as HTMLButtonElement;
    toggleButton?.click();

    expect(eventSpy).not.toHaveBeenCalled();
  });

  it("should display missing items when present", async () => {
    const skillWithMissing = {
      ...mockSkill,
      eligible: false,
      missing: {
        bins: ["missing-bin"],
        anyBins: [],
        env: ["MISSING_ENV"],
        config: ["missing.config"],
        os: [],
      },
    };
    element.skill = skillWithMissing;
    element.open = true;
    await element.updateComplete;

    const missingItems = element.shadowRoot?.querySelectorAll(".missing-item");
    expect(missingItems?.length).toBeGreaterThan(0);

    const missingTexts = Array.from(missingItems || []).map((el) => el.textContent);
    expect(missingTexts.some((text) => text?.includes("missing-bin"))).toBe(true);
    expect(missingTexts.some((text) => text?.includes("MISSING_ENV"))).toBe(true);
    expect(missingTexts.some((text) => text?.includes("missing.config"))).toBe(true);
  });

  it("should display source badge", async () => {
    element.skill = mockSkill;
    element.open = true;
    await element.updateComplete;

    const sourceBadge = element.shadowRoot?.querySelector(".source-badge");
    expect(sourceBadge?.textContent).toBe("openclaw-workspace");
  });

  it("should display homepage link when available", async () => {
    element.skill = mockSkill;
    element.open = true;
    await element.updateComplete;

    const link = element.shadowRoot?.querySelector("a[href]") as HTMLAnchorElement;
    expect(link?.href).toBe("https://example.com/");
    expect(link?.target).toBe("_blank");
  });

  it("should apply enabled class to toggle switch for enabled skill", async () => {
    element.skill = mockSkill;
    element.open = true;
    await element.updateComplete;

    const toggleSwitch = element.shadowRoot?.querySelector(".toggle-switch-small");
    expect(toggleSwitch?.classList.contains("enabled")).toBe(true);
  });

  it("should not apply enabled class to toggle switch for disabled skill", async () => {
    const disabledSkill = { ...mockSkill, disabled: true };
    element.skill = disabledSkill;
    element.open = true;
    await element.updateComplete;

    const toggleSwitch = element.shadowRoot?.querySelector(".toggle-switch-small");
    expect(toggleSwitch?.classList.contains("enabled")).toBe(false);
  });

  it("should handle skill with no requirements", async () => {
    const skillWithoutRequirements = {
      ...mockSkill,
      requirements: undefined,
    };
    element.skill = skillWithoutRequirements;
    element.open = true;
    await element.updateComplete;

    const content = element.shadowRoot?.textContent || "";
    expect(content).toContain("无特殊要求");
  });

  it("should handle skill with no install items", async () => {
    const skillWithoutInstall = {
      ...mockSkill,
      install: [],
    };
    element.skill = skillWithoutInstall;
    element.open = true;
    await element.updateComplete;

    const content = element.shadowRoot?.textContent || "";
    expect(content).toContain("无需安装");
  });

  it("should display anyBins requirements", async () => {
    const skillWithAnyBins = {
      ...mockSkill,
      requirements: {
        bins: [],
        anyBins: ["git", "svn"],
        env: [],
        config: [],
        os: [],
      },
    };
    element.skill = skillWithAnyBins;
    element.open = true;
    await element.updateComplete;

    const content = element.shadowRoot?.textContent || "";
    expect(content).toContain("git");
  });
});
