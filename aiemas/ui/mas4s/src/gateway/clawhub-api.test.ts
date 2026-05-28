import { beforeEach, describe, expect, it, vi } from "vitest";
import type { GatewayBrowserClient } from "../lib/gateway.js";
import {
  fetchRegistryAgents,
  fetchRegistryConfig,
  saveRegistryConfig,
  type AgentsListResponse,
  type RegistryConfig,
} from "./clawhub-api.js";

describe("clawhub-api", () => {
  let mockClient: GatewayBrowserClient;
  let mockRequest: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockRequest = vi.fn();
    mockClient = {
      request: mockRequest,
    } as unknown as GatewayBrowserClient;
  });

  describe("fetchRegistryAgents", () => {
    it("should call aiemas.clawhub.agents.list with page and pageSize", async () => {
      const mockResponse: AgentsListResponse = {
        agents: [
          {
            card: { agent_id: "agent-1", name: "Test Agent", skills: ["skill-a"] },
            status: "online",
            load: { cpu: 0.5, memory: 0.3, active_task_count: 2 },
          },
        ],
        count: 1,
        total: 1,
        page: 1,
        page_size: 20,
      };

      mockRequest.mockResolvedValue(mockResponse);

      const result = await fetchRegistryAgents(mockClient, 1, 20);

      expect(mockRequest).toHaveBeenCalledWith("aiemas.clawhub.agents.list", {
        page: 1,
        pageSize: 20,
      });
      expect(result).toEqual(mockResponse);
    });

    it("should pass through different page parameters", async () => {
      mockRequest.mockResolvedValue({ agents: [], count: 0, total: 0, page: 3, page_size: 50 });

      await fetchRegistryAgents(mockClient, 3, 50);

      expect(mockRequest).toHaveBeenCalledWith("aiemas.clawhub.agents.list", {
        page: 3,
        pageSize: 50,
      });
    });

    it("should propagate gateway errors", async () => {
      mockRequest.mockRejectedValue(new Error("gateway not connected"));

      await expect(fetchRegistryAgents(mockClient, 1, 20)).rejects.toThrow(
        "gateway not connected",
      );
    });
  });

  describe("fetchRegistryConfig", () => {
    it("should call aiemas.clawhub.config.get with no params", async () => {
      const mockConfig: RegistryConfig = {
        apiKey: "api-ar-xxxx****",
        natsUrl: "nats://localhost:4222",
        natsToken: "token-123",
        agentId: "agent-1",
        agentName: "My Agent",
        boundAgentId: "local-agent-1",
      };

      mockRequest.mockResolvedValue(mockConfig);

      const result = await fetchRegistryConfig(mockClient);

      expect(mockRequest).toHaveBeenCalledWith("aiemas.clawhub.config.get");
      expect(result).toEqual(mockConfig);
    });

    it("should handle null config values", async () => {
      const mockConfig: RegistryConfig = {
        apiKey: null,
        natsUrl: null,
        natsToken: null,
        agentId: null,
        agentName: null,
        boundAgentId: null,
      };

      mockRequest.mockResolvedValue(mockConfig);

      const result = await fetchRegistryConfig(mockClient);

      expect(result).toEqual(mockConfig);
    });

    it("should propagate gateway errors", async () => {
      mockRequest.mockRejectedValue(new Error("gateway not connected"));

      await expect(fetchRegistryConfig(mockClient)).rejects.toThrow("gateway not connected");
    });
  });

  describe("saveRegistryConfig", () => {
    it("should call aiemas.clawhub.config.save with config payload", async () => {
      mockRequest.mockResolvedValue({ ok: true });

      const config = { apiKey: "api-ar-" + "x".repeat(57) };
      const result = await saveRegistryConfig(mockClient, config);

      expect(mockRequest).toHaveBeenCalledWith("aiemas.clawhub.config.save", config);
      expect(result).toEqual({ ok: true });
    });

    it("should handle partial config updates", async () => {
      mockRequest.mockResolvedValue({ ok: true });

      const config = { natsUrl: "nats://new-host:4222", agentName: "Updated Agent" };
      const result = await saveRegistryConfig(mockClient, config);

      expect(mockRequest).toHaveBeenCalledWith("aiemas.clawhub.config.save", config);
      expect(result).toEqual({ ok: true });
    });

    it("should return error response when save fails", async () => {
      mockRequest.mockResolvedValue({ ok: false, error: "API Key 无效或已过期" });

      const config = { apiKey: "api-ar-" + "y".repeat(57) };
      const result = await saveRegistryConfig(mockClient, config);

      expect(result).toEqual({ ok: false, error: "API Key 无效或已过期" });
    });

    it("should propagate gateway errors", async () => {
      mockRequest.mockRejectedValue(new Error("gateway not connected"));

      await expect(saveRegistryConfig(mockClient, { apiKey: "test" })).rejects.toThrow(
        "gateway not connected",
      );
    });
  });
});
