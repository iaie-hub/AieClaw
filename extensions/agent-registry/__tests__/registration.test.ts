/**
 * Unit + property tests for RegistrationManager.
 *
 * Feature: agent-registry-channel
 * Property 5: AgentCard invariants
 * Property 6: AgentCard skill filtering
 * Property 7: Skill field mapping preservation
 *
 * Validates: Requirements 2.1–2.7, 3.1–3.6, 8.1–8.3
 */

import * as fc from "fast-check";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { serializeEnvelope, createEnvelope } from "../src/envelope.js";
import { createRegistrationManager } from "../src/registration.js";
import type { AgentRegistryConfig, InstalledSkill, NATSClient } from "../src/types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal AgentRegistryConfig from the given fields. */
function makeConfig(
  overrides: Partial<AgentRegistryConfig> & { agentId: string; agentName: string },
): AgentRegistryConfig {
  return {
    natsUrl: "nats://localhost:4222",
    skills: [],
    ...overrides,
  };
}

/** Build a mock NATSClient where every method is a vi.fn(). */
function makeMockNatsClient(): NATSClient & {
  request: ReturnType<typeof vi.fn>;
  publish: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
  unsubscribeAll: ReturnType<typeof vi.fn>;
  drain: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  newInbox: ReturnType<typeof vi.fn>;
} {
  return {
    request: vi.fn(),
    publish: vi.fn(),
    subscribe: vi.fn(),
    unsubscribeAll: vi.fn(),
    drain: vi.fn(),
    close: vi.fn(),
    newInbox: vi.fn(() => "mock-inbox"),
    isConnected: true,
  };
}

/** Serialize a successful RegisterResponse envelope for use in mock NATS replies. */
function makeSuccessResponseBytes(
  topics = {
    unicast: "a2a.agent.unicast.test-agent",
    multicast: [] as string[],
    broadcast: "a2a.agent.broadcast.all",
  },
  ttl = 30000,
): Uint8Array {
  const envelope = createEnvelope({
    request_id: "00000000-0000-4000-8000-000000000099",
    message_type: "res",
    source: "registry",
    seq: 0,
    action: "register",
    resource_type: "agent",
    payload: { success: true, topics, ttl },
    reply_to: null,
  });
  return serializeEnvelope(envelope);
}

/** Serialize a failed RegisterResponse envelope (success: false). */
function makeFailureResponseBytes(error: string): Uint8Array {
  const envelope = createEnvelope({
    request_id: "00000000-0000-4000-8000-000000000099",
    message_type: "res",
    source: "registry",
    seq: 0,
    action: "register",
    resource_type: "agent",
    payload: { success: false, error },
    reply_to: null,
  });
  return serializeEnvelope(envelope);
}

// ---------------------------------------------------------------------------
// Arbitraries
// ---------------------------------------------------------------------------

/** Valid agentId: 1–64 chars, [a-zA-Z0-9_-] */
const arbAgentId = fc.stringMatching(/^[a-zA-Z0-9_-]{1,64}$/);

/** Valid agentName: 1–128 chars */
const arbAgentName = fc.string({ minLength: 1, maxLength: 128 });

/** Arbitrary skill name: non-empty string up to 64 chars */
const arbSkillName = fc.string({ minLength: 1, maxLength: 64 }).filter((s) => s.trim().length > 0);

/** Arbitrary InstalledSkill with a given name. */
function arbInstalledSkillWithName(name: string): fc.Arbitrary<InstalledSkill> {
  return fc.record({
    id: fc.string({ minLength: 1, maxLength: 64 }),
    name: fc.constant(name),
    description: fc.string({ minLength: 0, maxLength: 256 }),
    tags: fc.array(fc.string({ minLength: 1, maxLength: 32 }), { maxLength: 8 }),
  });
}

/** Arbitrary InstalledSkill with a generated name. */
const arbInstalledSkill: fc.Arbitrary<InstalledSkill> = fc
  .string({ minLength: 1, maxLength: 64 })
  .filter((s) => s.trim().length > 0)
  .chain((name) => arbInstalledSkillWithName(name));

// ---------------------------------------------------------------------------
// Property 5: AgentCard invariants
// Validates: Requirements 2.2, 2.3, 2.4, 2.5, 2.7
// ---------------------------------------------------------------------------

describe("Feature: agent-registry-channel, Property 5: AgentCard invariants", () => {
  it("buildAgentCard produces card with correct agent_id, name, mac, transport, and longRunningOperations", async () => {
    await fc.assert(
      fc.asyncProperty(
        arbAgentId,
        arbAgentName,
        fc.array(arbSkillName, { maxLength: 5 }),
        async (agentId, agentName, skills) => {
          const config = makeConfig({ agentId, agentName, skills });
          const manager = createRegistrationManager({
            config,
            natsClient: makeMockNatsClient(),
            getInstalledSkills: async () => [],
          });

          const card = await manager.buildAgentCard();

          expect(card.agent_id).toBe(agentId);
          expect(card.name).toBe(agentName);
          expect(card.mac).toBe("00:00:00:00:00:00");
          expect(card.transport).toBe("mq");
          expect(card.capabilities.longRunningOperations).toBe(true);
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Property 6: AgentCard skill filtering
// Validates: Requirements 2.1, 2.6
// ---------------------------------------------------------------------------

describe("Feature: agent-registry-channel, Property 6: AgentCard skill filtering", () => {
  it("result skills contain exactly the intersection of configured names and installed skills", async () => {
    await fc.assert(
      fc.asyncProperty(
        // configuredSkills: array of skill names (some may not be installed)
        fc.array(arbSkillName, { minLength: 0, maxLength: 8 }),
        // installedSkills: array of InstalledSkill objects with unique names
        fc.array(arbSkillName, { minLength: 0, maxLength: 8 }).chain((names) => {
          // Deduplicate names to ensure uniqueness
          const uniqueNames = [...new Set(names)];
          return fc
            .tuple(...uniqueNames.map((n) => arbInstalledSkillWithName(n)))
            .map((skills) => skills as InstalledSkill[]);
        }),
        async (configuredSkills, installedSkills) => {
          const config = makeConfig({
            agentId: "test-agent",
            agentName: "Test Agent",
            skills: configuredSkills,
          });
          const manager = createRegistrationManager({
            config,
            natsClient: makeMockNatsClient(),
            getInstalledSkills: async () => installedSkills,
          });

          const card = await manager.buildAgentCard();

          const installedNames = new Set(installedSkills.map((s) => s.name));
          const expectedNames = configuredSkills.filter((n) => installedNames.has(n));

          // Result skill names should match the intersection
          const resultNames = card.skills.map((s) => s.name);

          // No extras: every result skill name must be in the expected set
          for (const name of resultNames) {
            expect(expectedNames).toContain(name);
          }

          // No omissions: every expected name must appear in the result
          for (const name of expectedNames) {
            expect(resultNames).toContain(name);
          }

          // Count matches: result length equals intersection size
          // (deduplicate expected since configuredSkills may have duplicates)
          const uniqueExpected = [...new Set(expectedNames)];
          expect(resultNames.length).toBe(uniqueExpected.length);
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Property 7: Skill field mapping preservation
// Validates: Requirements 2.6
// ---------------------------------------------------------------------------

describe("Feature: agent-registry-channel, Property 7: Skill field mapping preservation", () => {
  it("AgentSkill id/name/description/tags equal source InstalledSkill values", async () => {
    await fc.assert(
      fc.asyncProperty(
        // A single skill that is both configured and installed
        arbInstalledSkill,
        async (installedSkill) => {
          const config = makeConfig({
            agentId: "test-agent",
            agentName: "Test Agent",
            skills: [installedSkill.name],
          });
          const manager = createRegistrationManager({
            config,
            natsClient: makeMockNatsClient(),
            getInstalledSkills: async () => [installedSkill],
          });

          const card = await manager.buildAgentCard();

          expect(card.skills).toHaveLength(1);
          const agentSkill = card.skills[0];

          expect(agentSkill.id).toBe(installedSkill.id);
          expect(agentSkill.name).toBe(installedSkill.name);
          expect(agentSkill.description).toBe(installedSkill.description);
          expect(agentSkill.tags).toEqual(installedSkill.tags);
        },
      ),
    );
  });
});

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

describe("buildAgentCard — unit tests", () => {
  it("logs a warning and skips entry for an unresolved skill name", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const config = makeConfig({
      agentId: "agent-1",
      agentName: "Agent One",
      skills: ["missing-skill", "also-missing"],
    });
    const manager = createRegistrationManager({
      config,
      natsClient: makeMockNatsClient(),
      getInstalledSkills: async () => [],
    });

    const card = await manager.buildAgentCard();

    expect(card.skills).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy.mock.calls[0][0]).toContain("missing-skill");
    expect(warnSpy.mock.calls[1][0]).toContain("also-missing");

    warnSpy.mockRestore();
  });

  it("includes only resolved skills when some names are unresolved", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const installedSkill: InstalledSkill = {
      id: "skill-id-1",
      name: "real-skill",
      description: "A real skill",
      tags: ["tag1"],
    };

    const config = makeConfig({
      agentId: "agent-1",
      agentName: "Agent One",
      skills: ["real-skill", "ghost-skill"],
    });
    const manager = createRegistrationManager({
      config,
      natsClient: makeMockNatsClient(),
      getInstalledSkills: async () => [installedSkill],
    });

    const card = await manager.buildAgentCard();

    expect(card.skills).toHaveLength(1);
    expect(card.skills[0].name).toBe("real-skill");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("ghost-skill");

    warnSpy.mockRestore();
  });
});

describe("register() — unit tests", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns ok: false and logs error when registry returns success: false", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const natsClient = makeMockNatsClient();
    natsClient.request.mockResolvedValue(makeFailureResponseBytes("agent already registered"));

    const config = makeConfig({ agentId: "agent-1", agentName: "Agent One" });
    const manager = createRegistrationManager({
      config,
      natsClient,
      getInstalledSkills: async () => [],
    });

    const result = await manager.register();

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    expect(errorSpy).toHaveBeenCalled();
    // The error log should mention the rejection reason
    const loggedMessage = errorSpy.mock.calls[0][0] as string;
    expect(loggedMessage).toContain("agent already registered");

    errorSpy.mockRestore();
  });

  it("returns ok: false and logs error when natsClient.request times out", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const natsClient = makeMockNatsClient();
    natsClient.request.mockRejectedValue(new Error("timeout"));

    const config = makeConfig({ agentId: "agent-1", agentName: "Agent One" });
    const manager = createRegistrationManager({
      config,
      natsClient,
      getInstalledSkills: async () => [],
    });

    const result = await manager.register();

    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it("returns ok: true and stores topics + ttlMs on success", async () => {
    const natsClient = makeMockNatsClient();
    const expectedTopics = {
      unicast: "a2a.agent.unicast.agent-1",
      multicast: ["a2a.agent.group.g1"],
      broadcast: "a2a.agent.broadcast.all",
    };
    natsClient.request.mockResolvedValue(makeSuccessResponseBytes(expectedTopics, 60000));

    const config = makeConfig({ agentId: "agent-1", agentName: "Agent One" });
    const manager = createRegistrationManager({
      config,
      natsClient,
      getInstalledSkills: async () => [],
    });

    const result = await manager.register();

    expect(result.ok).toBe(true);
    expect(result.topics).toEqual(expectedTopics);
    expect(result.ttlMs).toBe(60000);
    expect(manager.assignedTopics).toEqual(expectedTopics);
    expect(manager.ttlMs).toBe(60000);
  });

  it("sends request to registry.agent.register with 10s timeout", async () => {
    const natsClient = makeMockNatsClient();
    natsClient.request.mockResolvedValue(makeSuccessResponseBytes());

    const config = makeConfig({ agentId: "agent-1", agentName: "Agent One" });
    const manager = createRegistrationManager({
      config,
      natsClient,
      getInstalledSkills: async () => [],
    });

    await manager.register();

    expect(natsClient.request).toHaveBeenCalledWith(
      "registry.agent.register",
      expect.any(Uint8Array),
      10000,
    );
  });
});

describe("deregister() — unit tests", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("does not throw when natsClient.request fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const natsClient = makeMockNatsClient();
    natsClient.request.mockRejectedValue(new Error("connection refused"));

    const config = makeConfig({ agentId: "agent-1", agentName: "Agent One" });
    const manager = createRegistrationManager({
      config,
      natsClient,
      getInstalledSkills: async () => [],
    });

    // Must not throw
    await expect(manager.deregister()).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();

    errorSpy.mockRestore();
  });

  it("logs agent_id in the error message on deregister failure", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const natsClient = makeMockNatsClient();
    natsClient.request.mockRejectedValue(new Error("timeout"));

    const config = makeConfig({ agentId: "my-special-agent", agentName: "Agent One" });
    const manager = createRegistrationManager({
      config,
      natsClient,
      getInstalledSkills: async () => [],
    });

    await manager.deregister();

    expect(errorSpy).toHaveBeenCalled();
    const loggedMessage = errorSpy.mock.calls[0][0] as string;
    expect(loggedMessage).toContain("my-special-agent");

    errorSpy.mockRestore();
  });

  it("sends request to registry.agent.deregister with 5s timeout", async () => {
    const natsClient = makeMockNatsClient();
    // Resolve successfully
    natsClient.request.mockResolvedValue(new Uint8Array());

    const config = makeConfig({ agentId: "agent-1", agentName: "Agent One" });
    const manager = createRegistrationManager({
      config,
      natsClient,
      getInstalledSkills: async () => [],
    });

    await manager.deregister();

    expect(natsClient.request).toHaveBeenCalledWith(
      "registry.agent.deregister",
      expect.any(Uint8Array),
      5000,
    );
  });
});
