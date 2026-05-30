/**
 * Skill aggregation utilities for ClawHub view.
 * Aggregates skills from registry agents and supports search filtering.
 */

export interface RegistryAgent {
  card: {
    agent_id: string;
    name: string;
    skills?: Array<string | { name: string; [key: string]: any }>;
  };
  status: "online" | "idle" | "busy" | "offline";
}

export interface AggregatedSkill {
  name: string;
  agents: Array<{
    agentId: string;
    agentName: string;
    status: "online" | "idle" | "busy" | "offline";
  }>;
}

/**
 * Aggregate skills from a list of registry agents.
 * Groups by exact skill name (case-sensitive). Each unique skill name
 * produces one AggregatedSkill entry listing all agents that declare it.
 */
export function aggregateSkills(agents: RegistryAgent[]): AggregatedSkill[] {
  const skillMap = new Map<string, AggregatedSkill>();

  for (const agent of agents) {
    const skillNames = (agent.card.skills || []).map((s) =>
      typeof s === "string" ? s : s?.name || "",
    );
    const uniqueSkills = new Set(skillNames.filter(Boolean));
    for (const skillName of uniqueSkills) {
      let entry = skillMap.get(skillName);
      if (!entry) {
        entry = { name: skillName, agents: [] };
        skillMap.set(skillName, entry);
      }
      entry.agents.push({
        agentId: agent.card.agent_id,
        agentName: agent.card.name,
        status: agent.status,
      });
    }
  }

  return Array.from(skillMap.values());
}

/**
 * Filter aggregated skills by search query.
 * Performs case-insensitive substring matching on skill name.
 */
export function filterSkills(skills: AggregatedSkill[], query: string): AggregatedSkill[] {
  if (!query) {
    return skills;
  }
  const lowerQuery = query.toLowerCase();
  return skills.filter((skill) => skill.name.toLowerCase().includes(lowerQuery));
}
