/**
 * Property-based tests for skill-aggregator.
 *
 * Feature: clawhub-registry-integration
 *
 * Properties tested in this file:
 *   Property 8: Skill aggregation groups by unique name
 *   Property 9: Skill search filter correctness
 *
 * Validates: Requirements 7.1, 7.3, 7.5
 */

import * as fc from "fast-check";
import { describe, it, expect } from "vitest";
import {
  aggregateSkills,
  filterSkills,
  type RegistryAgent,
  type AggregatedSkill,
} from "./skill-aggregator.js";

// ── Shared Arbitraries ──

/** Arbitrary for agent status */
const arbStatus = fc.constantFrom(
  "online" as const,
  "idle" as const,
  "busy" as const,
  "offline" as const,
);

/** Arbitrary for a skill name (non-empty string) */
const arbSkillName = fc.string({ minLength: 1, maxLength: 30 });

/** Arbitrary for a single RegistryAgent */
const arbRegistryAgent: fc.Arbitrary<RegistryAgent> = fc.record({
  card: fc.record({
    agent_id: fc.string({ minLength: 1, maxLength: 32 }),
    name: fc.string({ minLength: 1, maxLength: 50 }),
    skills: fc.array(arbSkillName, { minLength: 0, maxLength: 10 }),
  }),
  status: arbStatus,
});

/** Arbitrary for a list of RegistryAgents */
const arbAgentList = fc.array(arbRegistryAgent, { minLength: 0, maxLength: 20 });

// ── Property 8: Skill aggregation groups by unique name ──

describe("Feature: clawhub-registry-integration, Property 8: Skill aggregation groups by unique name", () => {
  // Feature: clawhub-registry-integration, Property 8: Skill aggregation groups by unique name
  /**
   * **Validates: Requirements 7.1, 7.3**
   *
   * For any list of AgentRecords, the skill aggregation function SHALL produce
   * exactly one AggregatedSkill entry per unique skill name (case-sensitive),
   * and each entry SHALL list all agents that declare that skill with their
   * respective statuses.
   */

  it("produces exactly one entry per unique skill name (case-sensitive)", () => {
    fc.assert(
      fc.property(arbAgentList, (agents: RegistryAgent[]) => {
        const result = aggregateSkills(agents);

        // Collect all unique skill names from input
        const uniqueSkillNames = new Set<string>();
        for (const agent of agents) {
          for (const skill of agent.card.skills || []) {
            uniqueSkillNames.add(typeof skill === "string" ? skill : skill.name);
          }
        }

        // Result should have exactly one entry per unique skill name
        expect(result.length).toBe(uniqueSkillNames.size);

        // Each result entry name should be unique
        const resultNames = result.map((s) => s.name);
        expect(new Set(resultNames).size).toBe(resultNames.length);

        // Every unique skill name from input should appear in result
        for (const skillName of uniqueSkillNames) {
          expect(resultNames).toContain(skillName);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("each entry lists ALL agents that declare that skill", () => {
    fc.assert(
      fc.property(arbAgentList, (agents: RegistryAgent[]) => {
        const result = aggregateSkills(agents);

        // For each skill in the result, verify it lists all agents that declared it
        for (const entry of result) {
          // Collect all agents from input that declare this skill
          const expectedAgents: Array<{
            agentId: string;
            agentName: string;
            status: "online" | "idle" | "busy" | "offline";
          }> = [];

          for (const agent of agents) {
            const skillNames = (agent.card.skills || []).map((s) => (typeof s === "string" ? s : s.name));
            if (skillNames.includes(entry.name)) {
              expectedAgents.push({
                agentId: agent.card.agent_id,
                agentName: agent.card.name,
                status: agent.status,
              });
            }
          }

          // The entry should have exactly the expected agents
          expect(entry.agents.length).toBe(expectedAgents.length);

          // Each expected agent should appear in the entry
          for (const expected of expectedAgents) {
            const found = entry.agents.find(
              (a) =>
                a.agentId === expected.agentId &&
                a.agentName === expected.agentName &&
                a.status === expected.status,
            );
            expect(found).toBeDefined();
          }
        }
      }),
      { numRuns: 100 },
    );
  });

  it("case-sensitive: skills differing only in case produce separate entries", () => {
    // Generate agents where some skills differ only in case
    const arbMixedCaseAgents = fc
      .tuple(
        fc.string({ minLength: 1, maxLength: 10 }),
        fc.string({ minLength: 1, maxLength: 32 }),
        arbStatus,
      )
      .map(([baseName, agentId, status]) => {
        const lower = baseName.toLowerCase();
        const upper = baseName.toUpperCase();
        // Only test when they actually differ
        if (lower === upper) return null;
        const agent: RegistryAgent = {
          card: { agent_id: agentId, name: "TestAgent", skills: [lower, upper] },
          status,
        };
        return agent;
      })
      .filter((a): a is RegistryAgent => a !== null);

    fc.assert(
      fc.property(arbMixedCaseAgents, (agent: RegistryAgent) => {
        const result = aggregateSkills([agent]);
        const skills = agent.card.skills || [];
        const lower = typeof skills[0] === "string" ? skills[0] : skills[0]?.name || "";
        const upper = typeof skills[1] === "string" ? skills[1] : skills[1]?.name || "";

        // If they differ, they should produce separate entries
        if (lower !== upper) {
          const lowerEntry = result.find((s) => s.name === lower);
          const upperEntry = result.find((s) => s.name === upper);
          expect(lowerEntry).toBeDefined();
          expect(upperEntry).toBeDefined();
          expect(lowerEntry).not.toBe(upperEntry);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("empty agent list produces empty result", () => {
    const result = aggregateSkills([]);
    expect(result).toEqual([]);
  });

  it("agents with no skills produce empty result", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            card: fc.record({
              agent_id: fc.string({ minLength: 1, maxLength: 16 }),
              name: fc.string({ minLength: 1, maxLength: 16 }),
              skills: fc.constant([] as string[]),
            }),
            status: arbStatus,
          }),
          { minLength: 1, maxLength: 10 },
        ),
        (agents: RegistryAgent[]) => {
          const result = aggregateSkills(agents);
          expect(result).toEqual([]);
        },
      ),
      { numRuns: 100 },
    );
  });
});

// ── Property 9: Skill search filter correctness ──

describe("Feature: clawhub-registry-integration, Property 9: Skill search filter correctness", () => {
  // Feature: clawhub-registry-integration, Property 9: Skill search filter correctness
  /**
   * **Validates: Requirements 7.5**
   *
   * For any aggregated skill list and any search query string, the filter function
   * SHALL return only those skills whose name contains the query as a substring
   * (case-insensitive comparison), and SHALL return all such matching skills.
   */

  /** Arbitrary for an AggregatedSkill entry */
  const arbAggregatedSkill: fc.Arbitrary<AggregatedSkill> = fc.record({
    name: fc.string({ minLength: 1, maxLength: 30 }),
    agents: fc.array(
      fc.record({
        agentId: fc.string({ minLength: 1, maxLength: 16 }),
        agentName: fc.string({ minLength: 1, maxLength: 30 }),
        status: arbStatus,
      }),
      { minLength: 1, maxLength: 5 },
    ),
  });

  const arbSkillList = fc.array(arbAggregatedSkill, { minLength: 0, maxLength: 20 });
  const arbQuery = fc.string({ minLength: 0, maxLength: 15 });

  it("returns only skills whose name contains the query (case-insensitive)", () => {
    fc.assert(
      fc.property(arbSkillList, arbQuery, (skills: AggregatedSkill[], query: string) => {
        const result = filterSkills(skills, query);

        // Every returned skill must contain the query (case-insensitive)
        for (const skill of result) {
          expect(skill.name.toLowerCase()).toContain(query.toLowerCase());
        }
      }),
      { numRuns: 100 },
    );
  });

  it("returns ALL skills whose name contains the query (case-insensitive)", () => {
    fc.assert(
      fc.property(arbSkillList, arbQuery, (skills: AggregatedSkill[], query: string) => {
        const result = filterSkills(skills, query);

        // Every skill from input that matches should be in the result
        const lowerQuery = query.toLowerCase();
        const expectedMatches = skills.filter((s) =>
          s.name.toLowerCase().includes(lowerQuery),
        );

        expect(result.length).toBe(expectedMatches.length);

        for (const expected of expectedMatches) {
          const found = result.find((s) => s.name === expected.name);
          expect(found).toBeDefined();
        }
      }),
      { numRuns: 100 },
    );
  });

  it("biconditional: skill in result ⟺ name.toLowerCase().includes(query.toLowerCase())", () => {
    fc.assert(
      fc.property(arbSkillList, arbQuery, (skills: AggregatedSkill[], query: string) => {
        const result = filterSkills(skills, query);
        const resultNames = new Set(result.map((s) => s.name));
        const lowerQuery = query.toLowerCase();

        for (const skill of skills) {
          const shouldMatch = skill.name.toLowerCase().includes(lowerQuery);
          expect(resultNames.has(skill.name)).toBe(shouldMatch);
        }
      }),
      { numRuns: 100 },
    );
  });

  it("empty query returns all skills", () => {
    fc.assert(
      fc.property(arbSkillList, (skills: AggregatedSkill[]) => {
        const result = filterSkills(skills, "");
        expect(result.length).toBe(skills.length);
      }),
      { numRuns: 100 },
    );
  });

  it("filter preserves skill data integrity (no mutation)", () => {
    fc.assert(
      fc.property(arbSkillList, arbQuery, (skills: AggregatedSkill[], query: string) => {
        const result = filterSkills(skills, query);

        // Each returned skill should be reference-equal to the original
        for (const skill of result) {
          const original = skills.find((s) => s.name === skill.name);
          expect(original).toBeDefined();
          expect(skill).toBe(original);
        }
      }),
      { numRuns: 100 },
    );
  });
});
