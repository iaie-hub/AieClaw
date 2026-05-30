import { describe, it, expect } from "vitest";
import {
  aggregateSkills,
  filterSkills,
  type RegistryAgent,
  type AggregatedSkill,
} from "./skill-aggregator.js";

describe("aggregateSkills", () => {
  it("returns empty array for empty agent list", () => {
    expect(aggregateSkills([])).toEqual([]);
  });

  it("aggregates skills from a single agent", () => {
    const agents: RegistryAgent[] = [
      {
        card: { agent_id: "a1", name: "Agent One", skills: ["coding", "testing"] },
        status: "online",
      },
    ];
    const result = aggregateSkills(agents);
    expect(result).toHaveLength(2);
    expect(result).toContainEqual({
      name: "coding",
      agents: [{ agentId: "a1", agentName: "Agent One", status: "online" }],
    });
    expect(result).toContainEqual({
      name: "testing",
      agents: [{ agentId: "a1", agentName: "Agent One", status: "online" }],
    });
  });

  it("groups same skill name from multiple agents into one entry", () => {
    const agents: RegistryAgent[] = [
      { card: { agent_id: "a1", name: "Agent One", skills: ["coding"] }, status: "online" },
      { card: { agent_id: "a2", name: "Agent Two", skills: ["coding"] }, status: "idle" },
    ];
    const result = aggregateSkills(agents);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("coding");
    expect(result[0].agents).toHaveLength(2);
    expect(result[0].agents).toContainEqual({
      agentId: "a1",
      agentName: "Agent One",
      status: "online",
    });
    expect(result[0].agents).toContainEqual({
      agentId: "a2",
      agentName: "Agent Two",
      status: "idle",
    });
  });

  it("treats skill names as case-sensitive", () => {
    const agents: RegistryAgent[] = [
      { card: { agent_id: "a1", name: "Agent One", skills: ["Coding"] }, status: "online" },
      { card: { agent_id: "a2", name: "Agent Two", skills: ["coding"] }, status: "idle" },
    ];
    const result = aggregateSkills(agents);
    expect(result).toHaveLength(2);
    const names = result.map((s) => s.name);
    expect(names).toContain("Coding");
    expect(names).toContain("coding");
  });

  it("handles agent with empty skills array", () => {
    const agents: RegistryAgent[] = [
      { card: { agent_id: "a1", name: "Agent One", skills: [] }, status: "online" },
    ];
    expect(aggregateSkills(agents)).toEqual([]);
  });

  it("preserves agent status in aggregated entries", () => {
    const agents: RegistryAgent[] = [
      { card: { agent_id: "a1", name: "Agent One", skills: ["search"] }, status: "busy" },
      { card: { agent_id: "a2", name: "Agent Two", skills: ["search"] }, status: "offline" },
    ];
    const result = aggregateSkills(agents);
    expect(result[0].agents[0].status).toBe("busy");
    expect(result[0].agents[1].status).toBe("offline");
  });
});

describe("filterSkills", () => {
  const skills: AggregatedSkill[] = [
    {
      name: "Natural Language Processing",
      agents: [{ agentId: "a1", agentName: "NLP Agent", status: "online" }],
    },
    { name: "Code Generation", agents: [{ agentId: "a2", agentName: "Coder", status: "idle" }] },
    { name: "code review", agents: [{ agentId: "a3", agentName: "Reviewer", status: "online" }] },
    { name: "Testing", agents: [{ agentId: "a4", agentName: "Tester", status: "busy" }] },
  ];

  it("returns all skills when query is empty string", () => {
    expect(filterSkills(skills, "")).toEqual(skills);
  });

  it("filters by case-insensitive substring match", () => {
    const result = filterSkills(skills, "code");
    expect(result).toHaveLength(2);
    expect(result.map((s) => s.name)).toContain("Code Generation");
    expect(result.map((s) => s.name)).toContain("code review");
  });

  it("matches uppercase query against lowercase skill name", () => {
    const result = filterSkills(skills, "CODE");
    expect(result).toHaveLength(2);
  });

  it("returns empty array when no skills match", () => {
    const result = filterSkills(skills, "xyz");
    expect(result).toEqual([]);
  });

  it("matches partial substrings", () => {
    const result = filterSkills(skills, "atur");
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("Natural Language Processing");
  });

  it("returns all skills for empty input array", () => {
    expect(filterSkills([], "test")).toEqual([]);
  });
});
