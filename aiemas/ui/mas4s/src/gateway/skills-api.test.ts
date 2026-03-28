import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayBrowserClient } from "../lib/gateway.js";
import type { SkillStatusReport } from "../types/skills-types.js";
import { fetchSkills, toggleSkillEnabled } from "./skills-api.js";

describe("skills-api", () => {
  let mockClient: GatewayBrowserClient;
  let mockRequest: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockRequest = vi.fn();
    mockClient = {
      request: mockRequest,
    } as unknown as GatewayBrowserClient;
    vi.useRealTimers();
  });

  describe("fetchSkills", () => {
    it("should call skills.status and return SkillStatusReport", async () => {
      const mockReport: SkillStatusReport = {
        workspaceDir: "/workspace",
        managedSkillsDir: "/skills",
        skills: [
          {
            name: "test-skill",
            description: "Test skill",
            source: "openclaw-workspace",
            skillKey: "test-skill",
            filePath: "/path/to/skill",
            disabled: false,
            eligible: true,
            missing: { bins: [], env: [], config: [] },
            install: [],
          },
        ],
      };

      mockRequest.mockResolvedValue(mockReport);

      const result = await fetchSkills(mockClient);

      expect(mockRequest).toHaveBeenCalledWith("skills.status", {});
      expect(result).toEqual(mockReport);
    });

    it("should handle timeout error", async () => {
      vi.useFakeTimers();

      // Mock a request that never resolves
      mockRequest.mockImplementation(() => new Promise(() => {}));

      const promise = fetchSkills(mockClient);

      // Fast-forward time to trigger timeout
      await vi.advanceTimersByTimeAsync(10000);

      await expect(promise).rejects.toThrow("请求超时，请稍后重试");

      vi.useRealTimers();
    });

    it("should handle disconnection error", async () => {
      const disconnectError = new Error("disconnected");
      Object.assign(disconnectError, { gatewayCode: "DISCONNECTED" });

      mockRequest.mockRejectedValue(disconnectError);

      await expect(fetchSkills(mockClient)).rejects.toThrow("连接已断开，请检查网络");
    });

    it("should handle generic Gateway error", async () => {
      const gatewayError = new Error("Gateway error");
      mockRequest.mockRejectedValue(gatewayError);

      await expect(fetchSkills(mockClient)).rejects.toThrow("Gateway error");
    });

    it("should handle unknown error", async () => {
      mockRequest.mockRejectedValue("unknown error");

      await expect(fetchSkills(mockClient)).rejects.toThrow("获取 Skills 数据失败");
    });
  });

  describe("toggleSkillEnabled", () => {
    it("should call skills.update with correct params when enabling", async () => {
      mockRequest.mockResolvedValue({ ok: true });

      await toggleSkillEnabled(mockClient, "test-skill", true);

      expect(mockRequest).toHaveBeenCalledWith("skills.update", {
        skillKey: "test-skill",
        enabled: true,
      });
    });

    it("should call skills.update with correct params when disabling", async () => {
      mockRequest.mockResolvedValue({ ok: true });

      await toggleSkillEnabled(mockClient, "test-skill", false);

      expect(mockRequest).toHaveBeenCalledWith("skills.update", {
        skillKey: "test-skill",
        enabled: false,
      });
    });

    it("should handle timeout error", async () => {
      vi.useFakeTimers();

      // Mock a request that never resolves
      mockRequest.mockImplementation(() => new Promise(() => {}));

      const promise = toggleSkillEnabled(mockClient, "test-skill", true);

      // Fast-forward time to trigger timeout
      await vi.advanceTimersByTimeAsync(5000);

      await expect(promise).rejects.toThrow("请求超时，请稍后重试");

      vi.useRealTimers();
    });

    it("should handle disconnection error", async () => {
      const disconnectError = new Error("disconnected");
      Object.assign(disconnectError, { gatewayCode: "DISCONNECTED" });

      mockRequest.mockRejectedValue(disconnectError);

      await expect(toggleSkillEnabled(mockClient, "test-skill", true)).rejects.toThrow(
        "连接已断开，请检查网络",
      );
    });

    it("should handle Gateway error response with ok: false", async () => {
      mockRequest.mockResolvedValue({
        ok: false,
        error: { message: "Skill not found" },
      });

      await expect(toggleSkillEnabled(mockClient, "test-skill", true)).rejects.toThrow(
        "Skill not found",
      );
    });

    it("should handle Gateway error response with ok: false and no message", async () => {
      mockRequest.mockResolvedValue({
        ok: false,
      });

      await expect(toggleSkillEnabled(mockClient, "test-skill", true)).rejects.toThrow(
        "更新 Skill 状态失败",
      );
    });

    it("should handle generic Gateway error", async () => {
      const gatewayError = new Error("Gateway error");
      mockRequest.mockRejectedValue(gatewayError);

      await expect(toggleSkillEnabled(mockClient, "test-skill", true)).rejects.toThrow(
        "Gateway error",
      );
    });

    it("should handle unknown error", async () => {
      mockRequest.mockRejectedValue("unknown error");

      await expect(toggleSkillEnabled(mockClient, "test-skill", true)).rejects.toThrow(
        "更新 Skill 状态失败",
      );
    });
  });
});
