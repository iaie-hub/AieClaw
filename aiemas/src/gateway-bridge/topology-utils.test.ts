import { describe, it, expect } from "vitest";
import { extractDescendantAgentIds, extractSessionUuid } from "./topology-utils.js";

describe("topology-utils", () => {
  describe("extractDescendantAgentIds", () => {
    it("should extract all unique agent IDs from edges, excluding rootAgentId", () => {
      const edges = [
        { from: "root", to: "child1" },
        { from: "root", to: "child2" },
        { from: "child1", to: "grandchild" },
      ];
      const result = extractDescendantAgentIds(edges, "root");
      expect(result).toEqual(["child1", "child2", "grandchild"]);
    });

    it("should return empty array for empty edges", () => {
      const result = extractDescendantAgentIds([], "root");
      expect(result).toEqual([]);
    });

    it("should handle edges with duplicate agent IDs", () => {
      const edges = [
        { from: "root", to: "child1" },
        { from: "root", to: "child1" },
        { from: "child1", to: "child2" },
      ];
      const result = extractDescendantAgentIds(edges, "root");
      expect(result).toEqual(["child1", "child2"]);
    });

    it("should exclude rootAgentId from results", () => {
      const edges = [
        { from: "root", to: "child1" },
        { from: "child1", to: "root" },
      ];
      const result = extractDescendantAgentIds(edges, "root");
      expect(result).toEqual(["child1"]);
    });

    it("should return sorted results for determinism", () => {
      const edges = [
        { from: "root", to: "zebra" },
        { from: "root", to: "apple" },
        { from: "root", to: "banana" },
      ];
      const result = extractDescendantAgentIds(edges, "root");
      expect(result).toEqual(["apple", "banana", "zebra"]);
    });

    it("should handle edges with empty from/to fields", () => {
      const edges = [
        { from: "root", to: "child1" },
        { from: "", to: "child2" },
        { from: "child3", to: "" },
      ];
      const result = extractDescendantAgentIds(edges, "root");
      expect(result).toEqual(["child1", "child2", "child3"]);
    });

    it("should handle complex topology with multiple levels", () => {
      const edges = [
        { from: "aie-iaas", to: "aieiaas-resource" },
        { from: "aie-iaas", to: "aieiaas-model" },
        { from: "aieiaas-resource", to: "aieiaas-task" },
        { from: "aieiaas-model", to: "aieiaas-monitor" },
      ];
      const result = extractDescendantAgentIds(edges, "aie-iaas");
      expect(result).toEqual([
        "aieiaas-model",
        "aieiaas-monitor",
        "aieiaas-resource",
        "aieiaas-task",
      ]);
    });
  });

  describe("extractSessionUuid", () => {
    it("should extract sessionUuid from valid sessionKey", () => {
      const sessionKey = "agent:aie-iaas:group:mas-d4548844";
      const result = extractSessionUuid(sessionKey);
      expect(result).toBe("mas-d4548844");
    });

    it("should extract sessionUuid from sessionKey with different agentId", () => {
      const sessionKey = "agent:aieiaas-resource:group:mas-d4548844";
      const result = extractSessionUuid(sessionKey);
      expect(result).toBe("mas-d4548844");
    });

    it("should return empty string for empty sessionKey", () => {
      const result = extractSessionUuid("");
      expect(result).toBe("");
    });

    it("should return empty string for null sessionKey", () => {
      const result = extractSessionUuid(null as unknown as string);
      expect(result).toBe("");
    });

    it("should return empty string for undefined sessionKey", () => {
      const result = extractSessionUuid(undefined as unknown as string);
      expect(result).toBe("");
    });

    it("should return empty string for malformed sessionKey with fewer than 4 parts", () => {
      const result = extractSessionUuid("agent:aie-iaas:group");
      expect(result).toBe("");
    });

    it("should return empty string for sessionKey with only 2 parts", () => {
      const result = extractSessionUuid("agent:aie-iaas");
      expect(result).toBe("");
    });

    it("should handle sessionKey with extra colons", () => {
      const sessionKey = "agent:aie-iaas:group:mas-d4548844:extra:parts";
      const result = extractSessionUuid(sessionKey);
      expect(result).toBe("mas-d4548844");
    });

    it("should handle sessionKey with UUID-like sessionUuid", () => {
      const sessionKey = "agent:test-agent:group:550e8400-e29b-41d4-a716-446655440000";
      const result = extractSessionUuid(sessionKey);
      expect(result).toBe("550e8400-e29b-41d4-a716-446655440000");
    });

    it("should return empty string if fourth part is empty", () => {
      const sessionKey = "agent:aie-iaas:group:";
      const result = extractSessionUuid(sessionKey);
      expect(result).toBe("");
    });
  });
});
