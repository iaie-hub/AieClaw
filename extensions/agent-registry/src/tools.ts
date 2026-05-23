/**
 * tools.ts — Agent-facing tools for the agent-registry channel plugin.
 *
 * These tools are registered via `api.registerTool()` in the plugin's
 * `registerFull` callback, making them visible to the Agent's LLM as
 * callable functions in the tool list.
 *
 * Tools are registered as factory functions (OpenClawPluginToolFactory) so
 * they receive the OpenClawPluginToolContext at resolution time, which
 * includes `ctx.sessionKey` — the current OpenClaw session key. This
 * session key is passed into outbound envelopes so receiving agents can
 * route responses back to the correct session.
 *
 * The tools delegate to the runtime API injected by channel.ts into
 * `channelRuntime.agentRegistry`. A module-level reference is set when
 * the channel starts and cleared on teardown.
 */

import type { CreateCoworkParams, CreateCoworkResult } from "./cowork-initiator.js";
import type { DiscoverAgentsParams, DiscoverAgentsResult } from "./agent-discovery.js";
import type { SendMessageParams, SendMessageResult } from "./unicast-sender.js";
import type { SendCoworkMessageParams, SendCoworkMessageResult } from "./cowork-sender.js";

// ---------------------------------------------------------------------------
// Runtime bridge — set by channel.ts startAccount, read by tool execute()
// ---------------------------------------------------------------------------

export interface AgentRegistryToolRuntime {
  createCowork(params: CreateCoworkParams): Promise<CreateCoworkResult>;
  sendMessage(params: SendMessageParams): SendMessageResult;
  sendCoworkMessage(params: SendCoworkMessageParams): SendCoworkMessageResult;
  discoverAgents(params?: DiscoverAgentsParams): Promise<DiscoverAgentsResult>;
}

let runtimeRef: AgentRegistryToolRuntime | null = null;

export function setAgentRegistryToolRuntime(rt: AgentRegistryToolRuntime | null): void {
  runtimeRef = rt;
}

function getRuntime(): AgentRegistryToolRuntime {
  if (!runtimeRef) {
    throw new Error(
      "agent-registry channel is not connected. Ensure the AGENT_REGISTRY_NATS_URL environment variable is set and the channel is running.",
    );
  }
  return runtimeRef;
}

// ---------------------------------------------------------------------------
// Tool result helper
// ---------------------------------------------------------------------------

function jsonResult(payload: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

function errorResult(error: string) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify({ error }, null, 2) }],
    details: { error },
  };
}

// ---------------------------------------------------------------------------
// discover_agents tool factory
// ---------------------------------------------------------------------------

export const discoverAgentsToolFactory = (ctx: { sessionKey?: string }) => ({
  name: "discover_agents",
  label: "Discover Agents",
  description:
    "Discover other agents registered in the Agent Registry. " +
    "Returns a list of online agents with their IDs, names, descriptions, status, and skills. " +
    "Use this to find agents before sending them messages or initiating collaboration.",
  parameters: {
    type: "object",
    properties: {
      filter_skills: {
        type: "array",
        items: { type: "string" },
        description:
          "Filter by skill tags (AND logic — agent must have ALL listed tags). Example: [\"vm\", \"network\"]",
      },
      filter_status: {
        type: "string",
        enum: ["online", "idle", "busy", "offline"],
        description: "Filter by agent status. Omit to return all statuses.",
      },
    },
    required: [],
  },
  async execute(
    _toolCallId: string,
    params: unknown,
  ) {
    const p = (params && typeof params === "object" ? params : {}) as Record<string, unknown>;
    const rt = getRuntime();

    const filterSkills = Array.isArray(p["filter_skills"])
      ? (p["filter_skills"] as string[]).map(String)
      : undefined;
    const filterStatus = typeof p["filter_status"] === "string"
      ? (p["filter_status"] as "online" | "idle" | "busy" | "offline")
      : undefined;

    const result = await rt.discoverAgents({ filterSkills, filterStatus });

    if (!result.ok) {
      return errorResult(result.error);
    }

    return jsonResult({
      total: result.total,
      agents: result.agents.map((a) => ({
        agent_id: a.agentId,
        name: a.name,
        description: a.description,
        status: a.status,
        skills: a.skills,
      })),
    });
  },
});

// ---------------------------------------------------------------------------
// send_message_to_agent tool factory
// ---------------------------------------------------------------------------

export const sendMessageToolFactory = (ctx: { sessionKey?: string }) => ({
  name: "send_message_to_agent",
  label: "Send Message to Agent",
  description:
    "Send a direct message to an agent registered in the external Agent Registry via NATS unicast. " +
    "Use this tool for agents OUTSIDE your local AIEMAS topology — i.e. agents that are NOT your managed sub-agents. " +
    "The message is published immediately (no synchronous wait); the target agent's reply arrives asynchronously on your unicast subscription. " +
    "Use discover_agents first to confirm the target agent's ID and online status.",
  parameters: {
    type: "object",
    properties: {
      target_agent_id: {
        type: "string",
        description: "The registered agent_id of the target agent (e.g. \"agent-002\").",
      },
      text: {
        type: "string",
        description: "The message content to send.",
      },
      action: {
        type: "string",
        description: "Optional action label for the message envelope. Defaults to \"message\".",
      },
    },
    required: ["target_agent_id", "text"],
  },
  async execute(
    _toolCallId: string,
    params: unknown,
  ) {
    const p = (params && typeof params === "object" ? params : {}) as Record<string, unknown>;
    const rt = getRuntime();

    const targetAgentId = String(p["target_agent_id"] ?? "");
    const text = String(p["text"] ?? "");
    const action = typeof p["action"] === "string" ? p["action"] : undefined;

    if (!targetAgentId) {
      return errorResult("target_agent_id is required");
    }
    if (!text) {
      return errorResult("text is required");
    }

    const result = rt.sendMessage({
      targetAgentId,
      text,
      action,
      senderSessionKey: ctx.sessionKey,
    });

    if (!result.ok) {
      return errorResult(result.error!);
    }

    return jsonResult({
      success: true,
      message_id: result.messageId,
      target_agent_id: targetAgentId,
      note: "Message published. The target agent's reply will arrive asynchronously.",
    });
  },
});

// ---------------------------------------------------------------------------
// create_cowork tool factory
// ---------------------------------------------------------------------------

export const createCoworkToolFactory = (ctx: { sessionKey?: string }) => ({
  name: "create_cowork",
  label: "Create Collaboration",
  description:
    "Initiate a multi-agent collaboration session. " +
    "Other agents will be notified via broadcast and can autonomously decide to join " +
    "based on their capabilities. Use this when a task requires collective reasoning " +
    "from multiple specialized agents.",
  parameters: {
    type: "object",
    properties: {
      name: {
        type: "string",
        description: "Short, human-readable name for the collaboration (≤80 chars).",
      },
      description: {
        type: "string",
        description: "Detailed description of the collaboration context and goals.",
      },
      conversation: {
        type: "array",
        items: { type: "string" },
        description: "Recent conversation snippets providing context for other agents.",
      },
    },
    required: ["name"],
  },
  async execute(
    _toolCallId: string,
    params: unknown,
  ) {
    const p = (params && typeof params === "object" ? params : {}) as Record<string, unknown>;
    const rt = getRuntime();

    const name = String(p["name"] ?? "");
    const description = typeof p["description"] === "string" ? p["description"] : undefined;
    const conversation = Array.isArray(p["conversation"])
      ? (p["conversation"] as string[]).map(String)
      : undefined;

    if (!name) {
      return errorResult("name is required");
    }

    const result = await rt.createCowork({
      name,
      description,
      conversation,
      senderSessionKey: ctx.sessionKey,
    });

    if (!result.ok) {
      return errorResult(result.error);
    }

    return jsonResult({
      success: true,
      cowork_id: result.coworkId,
      topic: result.topic,
      note: "Collaboration created. Other agents are being notified and will join if they can help.",
    });
  },
});

// ---------------------------------------------------------------------------
// send_cowork_message tool factory
// ---------------------------------------------------------------------------

export const sendCoworkMessageToolFactory = (ctx: { sessionKey?: string }) => ({
  name: "send_cowork_message",
  label: "Send Cowork Message",
  description:
    "Send a message into an active collaboration session (cowork). " +
    "The message is published to the cowork topic (a2a.cowork.{coworkId}) and received by all participating agents. " +
    "Use this to proactively contribute to an ongoing collaboration — e.g. propose ideas, share findings, or assign sub-tasks. " +
    "Requires an active cowork_id obtained from create_cowork or from a cowork you have joined.",
  parameters: {
    type: "object",
    properties: {
      cowork_id: {
        type: "string",
        description: "The cowork_id of the active collaboration session.",
      },
      message: {
        type: "string",
        description: "The message content to publish to the collaboration.",
      },
      action: {
        type: "string",
        description: "Optional action label for the message envelope. Defaults to \"message\".",
      },
    },
    required: ["cowork_id", "message"],
  },
  async execute(
    _toolCallId: string,
    params: unknown,
  ) {
    const p = (params && typeof params === "object" ? params : {}) as Record<string, unknown>;
    const rt = getRuntime();

    const coworkId = String(p["cowork_id"] ?? "");
    const message = String(p["message"] ?? "");
    const action = typeof p["action"] === "string" ? p["action"] : undefined;

    if (!coworkId) {
      return errorResult("cowork_id is required");
    }
    if (!message) {
      return errorResult("message is required");
    }

    const result = rt.sendCoworkMessage({
      coworkId,
      message,
      action,
      senderSessionKey: ctx.sessionKey,
    });

    if (!result.ok) {
      return errorResult(result.error!);
    }

    return jsonResult({
      success: true,
      message_id: result.messageId,
      cowork_id: coworkId,
      note: "Message published to the collaboration topic. All participating agents will receive it.",
    });
  },
});

// ---------------------------------------------------------------------------
// Legacy static tool exports (for backward compatibility with existing tests)
// ---------------------------------------------------------------------------

export const discoverAgentsTool = discoverAgentsToolFactory({});
export const sendMessageTool = sendMessageToolFactory({});
export const createCoworkTool = createCoworkToolFactory({});
export const sendCoworkMessageTool = sendCoworkMessageToolFactory({});
