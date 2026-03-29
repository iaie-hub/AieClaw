import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as skillsApi from "../gateway/skills-api.js";
import type { GatewayBrowserClient } from "../lib/gateway.js";
import { AppStore } from "../store/app-store.js";
import type { SkillStatusEntry, SkillStatusReport } from "../types/skills-types.js";
import { SkillsController } from "./skills-controller.js";

describe("SkillsController", () => {
  let controller: SkillsController;
  let mockClient: GatewayBrowserClient;
  let store: AppStore;

  beforeEach(() => {
    // 创建 mock Gateway 客户端
    mockClient = {
      request: vi.fn(),
    } as unknown as GatewayBrowserClient;

    // 创建新的 AppStore 实例用于测试
    store = new AppStore();

    // 创建 controller 实例
    controller = new SkillsController(mockClient, store);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("fetchSkills", () => {
    it("should call skills.status on mount and update AppStore", async () => {
      // 验证需求 5.1, 5.2, 5.3
      const mockReport: SkillStatusReport = {
        workspaceDir: "/workspace",
        managedSkillsDir: "/skills",
        skills: [
          {
            name: "test-skill",
            description: "Test skill",
            source: "openclaw-workspace",
            skillKey: "test-skill",
            filePath: "/test.md",
            baseDir: "/",
            disabled: false,
            eligible: true,
            always: false,
            blockedByAllowlist: false,
            missing: { bins: [], anyBins: [], env: [], config: [], os: [] },
            configChecks: [],
            install: [],
          },
        ],
      };

      vi.spyOn(skillsApi, "fetchSkills").mockResolvedValue(mockReport);

      await controller.fetchSkills();

      expect(store.skillsReport).toEqual(mockReport);
      expect(store.skillsError).toBeNull();
      expect(store.skillsLoading).toBe(false);
    });

    it("should handle timeout error", async () => {
      // 验证需求 9.1
      vi.useFakeTimers();

      vi.spyOn(skillsApi, "fetchSkills").mockRejectedValue(new Error("请求超时，请稍后重试"));

      const promise = controller.fetchSkills();

      // 等待所有重试完成
      await vi.runAllTimersAsync();
      await promise;

      expect(store.skillsError).not.toBeNull();
      expect(store.skillsError).toContain("请求超时");

      vi.useRealTimers();
    });

    it("should handle disconnection error", async () => {
      // 验证需求 9.3
      vi.useFakeTimers();

      vi.spyOn(skillsApi, "fetchSkills").mockRejectedValue(new Error("连接已断开，请检查网络"));

      const promise = controller.fetchSkills();

      // 等待所有重试完成
      await vi.runAllTimersAsync();
      await promise;

      expect(store.skillsError).not.toBeNull();
      expect(store.skillsError).toContain("连接已断开");

      vi.useRealTimers();
    });

    it("should clear error on successful request", async () => {
      // 验证需求 9.6
      const mockReport: SkillStatusReport = {
        workspaceDir: "/workspace",
        managedSkillsDir: "/skills",
        skills: [],
      };

      // 先设置一个错误
      store.setSkillsError("之前的错误");

      vi.spyOn(skillsApi, "fetchSkills").mockResolvedValue(mockReport);

      await controller.fetchSkills();

      expect(store.skillsError).toBeNull();
    });

    it("should retry up to 3 times with exponential backoff", async () => {
      // 验证需求 5.4, 5.5
      vi.useFakeTimers();

      const fetchSpy = vi
        .spyOn(skillsApi, "fetchSkills")
        .mockRejectedValue(new Error("Network error"));

      // 第一次调用
      const promise = controller.fetchSkills();

      // 等待第一次失败
      await vi.runAllTimersAsync();

      // 应该重试 3 次
      expect(fetchSpy).toHaveBeenCalledTimes(4); // 初始 + 3 次重试

      await promise;

      vi.useRealTimers();
    });
  });

  describe("toggleSkillEnabled", () => {
    it("should call skills.update with correct params", async () => {
      // 验证需求 11.3
      const mockReport: SkillStatusReport = {
        workspaceDir: "/workspace",
        managedSkillsDir: "/skills",
        skills: [
          {
            name: "test-skill",
            description: "Test skill",
            source: "openclaw-workspace",
            skillKey: "test-skill",
            filePath: "/test.md",
            baseDir: "/",
            disabled: false,
            eligible: true,
            always: false,
            blockedByAllowlist: false,
            missing: { bins: [], anyBins: [], env: [], config: [], os: [] },
            configChecks: [],
            install: [],
          },
        ],
      };

      store.setSkillsReport(mockReport);

      const toggleSpy = vi.spyOn(skillsApi, "toggleSkillEnabled").mockResolvedValue();

      await controller.toggleSkillEnabled("test-skill", false);

      expect(toggleSpy).toHaveBeenCalledWith(mockClient, "test-skill", false);
    });

    it("should update AppStore on successful toggle", async () => {
      // 验证需求 11.4, 11.5
      const mockReport: SkillStatusReport = {
        workspaceDir: "/workspace",
        managedSkillsDir: "/skills",
        skills: [
          {
            name: "test-skill",
            description: "Test skill",
            source: "openclaw-workspace",
            skillKey: "test-skill",
            filePath: "/test.md",
            baseDir: "/",
            disabled: false,
            eligible: true,
            always: false,
            blockedByAllowlist: false,
            missing: { bins: [], anyBins: [], env: [], config: [], os: [] },
            configChecks: [],
            install: [],
          },
        ],
      };

      store.setSkillsReport(mockReport);

      vi.spyOn(skillsApi, "toggleSkillEnabled").mockResolvedValue();

      await controller.toggleSkillEnabled("test-skill", false);

      const updatedSkill = store.skillsReport?.skills.find((s) => s.skillKey === "test-skill");
      expect(updatedSkill?.disabled).toBe(true);
    });

    it("should show error on failed toggle", async () => {
      // 验证需求 11.6
      vi.spyOn(skillsApi, "toggleSkillEnabled").mockRejectedValue(new Error("更新 Skill 状态失败"));

      await expect(controller.toggleSkillEnabled("test-skill", false)).rejects.toThrow(
        "更新 Skill 状态失败",
      );
    });
  });

  describe("classifySkill", () => {
    it("should classify openclaw-workspace as workspace", () => {
      // 验证需求 7.1
      const skill: SkillStatusEntry = {
        name: "test",
        description: "test",
        source: "openclaw-workspace",
        skillKey: "test",
        filePath: "/test.md",
        baseDir: "/",
        disabled: false,
        eligible: true,
        always: false,
        blockedByAllowlist: false,
        missing: { bins: [], anyBins: [], env: [], config: [], os: [] },
        configChecks: [],
        install: [],
      };

      expect(controller.classifySkill(skill)).toBe("workspace");
    });

    it("should classify agents-skills-project as workspace", () => {
      // 验证需求 7.2
      const skill: SkillStatusEntry = {
        name: "test",
        description: "test",
        source: "agents-skills-project",
        skillKey: "test",
        filePath: "/test.md",
        baseDir: "/",
        disabled: false,
        eligible: true,
        always: false,
        blockedByAllowlist: false,
        missing: { bins: [], anyBins: [], env: [], config: [], os: [] },
        configChecks: [],
        install: [],
      };

      expect(controller.classifySkill(skill)).toBe("workspace");
    });

    it("should classify openclaw-bundled as builtin", () => {
      // 验证需求 7.3
      const skill: SkillStatusEntry = {
        name: "test",
        description: "test",
        source: "openclaw-bundled",
        skillKey: "test",
        filePath: "/test.md",
        baseDir: "/",
        disabled: false,
        eligible: true,
        always: false,
        blockedByAllowlist: false,
        missing: { bins: [], anyBins: [], env: [], config: [], os: [] },
        configChecks: [],
        install: [],
      };

      expect(controller.classifySkill(skill)).toBe("builtin");
    });

    it("should classify openclaw-managed as builtin", () => {
      // 验证需求 7.4
      const skill: SkillStatusEntry = {
        name: "test",
        description: "test",
        source: "openclaw-managed",
        skillKey: "test",
        filePath: "/test.md",
        baseDir: "/",
        disabled: false,
        eligible: true,
        always: false,
        blockedByAllowlist: false,
        missing: { bins: [], anyBins: [], env: [], config: [], os: [] },
        configChecks: [],
        install: [],
      };

      expect(controller.classifySkill(skill)).toBe("builtin");
    });

    it("should classify agents-skills-personal as builtin", () => {
      // 验证需求 7.5
      const skill: SkillStatusEntry = {
        name: "test",
        description: "test",
        source: "agents-skills-personal",
        skillKey: "test",
        filePath: "/test.md",
        baseDir: "/",
        disabled: false,
        eligible: true,
        always: false,
        blockedByAllowlist: false,
        missing: { bins: [], anyBins: [], env: [], config: [], os: [] },
        configChecks: [],
        install: [],
      };

      expect(controller.classifySkill(skill)).toBe("builtin");
    });

    it("should classify openclaw-extra as builtin", () => {
      // 验证需求 7.6
      const skill: SkillStatusEntry = {
        name: "test",
        description: "test",
        source: "openclaw-extra",
        skillKey: "test",
        filePath: "/test.md",
        baseDir: "/",
        disabled: false,
        eligible: true,
        always: false,
        blockedByAllowlist: false,
        missing: { bins: [], anyBins: [], env: [], config: [], os: [] },
        configChecks: [],
        install: [],
      };

      expect(controller.classifySkill(skill)).toBe("builtin");
    });

    it("should classify unknown source as builtin", () => {
      // 验证需求 7.7
      const skill: SkillStatusEntry = {
        name: "test",
        description: "test",
        source: "unknown-source",
        skillKey: "test",
        filePath: "/test.md",
        baseDir: "/",
        disabled: false,
        eligible: true,
        always: false,
        blockedByAllowlist: false,
        missing: { bins: [], anyBins: [], env: [], config: [], os: [] },
        configChecks: [],
        install: [],
      };

      expect(controller.classifySkill(skill)).toBe("builtin");
    });
  });

  describe("filterSkills", () => {
    const mockSkills: SkillStatusEntry[] = [
      {
        name: "workspace-skill-1",
        description: "A workspace skill",
        source: "openclaw-workspace",
        skillKey: "ws1",
        filePath: "/ws1.md",
        baseDir: "/",
        disabled: false,
        eligible: true,
        always: false,
        blockedByAllowlist: false,
        missing: { bins: [], anyBins: [], env: [], config: [], os: [] },
        configChecks: [],
        install: [],
      },
      {
        name: "workspace-skill-2",
        description: "Another workspace skill",
        source: "agents-skills-project",
        skillKey: "ws2",
        filePath: "/ws2.md",
        baseDir: "/",
        disabled: false,
        eligible: true,
        always: false,
        blockedByAllowlist: false,
        missing: { bins: [], anyBins: [], env: [], config: [], os: [] },
        configChecks: [],
        install: [],
      },
      {
        name: "builtin-skill-1",
        description: "A builtin skill",
        source: "openclaw-bundled",
        skillKey: "bi1",
        filePath: "/bi1.md",
        baseDir: "/",
        disabled: false,
        eligible: true,
        always: false,
        blockedByAllowlist: false,
        missing: { bins: [], anyBins: [], env: [], config: [], os: [] },
        configChecks: [],
        install: [],
      },
      {
        name: "builtin-skill-2",
        description: "Another builtin skill",
        source: "openclaw-managed",
        skillKey: "bi2",
        filePath: "/bi2.md",
        baseDir: "/",
        disabled: false,
        eligible: true,
        always: false,
        blockedByAllowlist: false,
        missing: { bins: [], anyBins: [], env: [], config: [], os: [] },
        configChecks: [],
        install: [],
      },
    ];

    it("should return all skills when tab is 'all' and no search text", () => {
      const filtered = controller.filterSkills(mockSkills, "all", "");
      expect(filtered).toHaveLength(4);
    });

    it("should filter workspace skills when tab is 'workspace'", () => {
      // 验证需求 3.5
      const filtered = controller.filterSkills(mockSkills, "workspace", "");
      expect(filtered).toHaveLength(2);
      expect(filtered.every((s) => controller.classifySkill(s) === "workspace")).toBe(true);
    });

    it("should filter builtin skills when tab is 'builtin'", () => {
      // 验证需求 3.6
      const filtered = controller.filterSkills(mockSkills, "builtin", "");
      expect(filtered).toHaveLength(2);
      expect(filtered.every((s) => controller.classifySkill(s) === "builtin")).toBe(true);
    });

    it("should filter by search text in name", () => {
      // 验证需求 2.7
      const filtered = controller.filterSkills(mockSkills, "all", "workspace-skill-1");
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe("workspace-skill-1");
    });

    it("should filter by search text in description", () => {
      // 验证需求 2.7
      const filtered = controller.filterSkills(mockSkills, "all", "Another");
      expect(filtered).toHaveLength(2);
      expect(filtered.every((s) => s.description.includes("Another"))).toBe(true);
    });

    it("should filter by search text case-insensitively", () => {
      // 验证需求 2.7
      const filtered = controller.filterSkills(mockSkills, "all", "WORKSPACE");
      expect(filtered).toHaveLength(2);
    });

    it("should combine tab and search filters", () => {
      const filtered = controller.filterSkills(mockSkills, "workspace", "workspace-skill-1");
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe("workspace-skill-1");
    });

    it("should return empty array when no skills match", () => {
      const filtered = controller.filterSkills(mockSkills, "all", "nonexistent");
      expect(filtered).toHaveLength(0);
    });
  });
});
