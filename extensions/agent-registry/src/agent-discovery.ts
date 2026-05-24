/**
 * agent-discovery.ts — Discover registered agents via NATS request-reply.
 *
 * Encapsulates the NATS request to `registry.agent.discover` so that Agent
 * skills can call `runtime.agentRegistry.discoverAgents()` to find other
 * online agents by skill tags or status.
 *
 * Timeout: 10 seconds per registry spec.
 */

import { v4 as uuidv4 } from "uuid";
import { createEnvelope, serializeEnvelope, deserializeEnvelope } from "./envelope.js";
import type { NATSClient } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DiscoverAgentsParams {
  /** Filter by skill tags (AND logic — agent must have ALL listed tags). */
  filterSkills?: string[];
  /** Filter by agent status. */
  filterStatus?: "online" | "idle" | "busy" | "offline";
}

export interface DiscoveredAgent {
  agentId: string;
  name: string;
  description: string;
  status: string;
  skills: Array<{
    id: string;
    name: string;
    description: string;
    tags: string[];
  }>;
}

export type DiscoverAgentsResult =
  | { ok: true; agents: DiscoveredAgent[]; total: number }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// discoverAgents
// ---------------------------------------------------------------------------

/**
 * Send a `registry.agent.discover` NATS request to AgentRegistry.
 *
 * On success the registry returns a list of agents matching the filter criteria.
 * Each agent record includes id, name, description, status, and skills.
 */
export async function discoverAgents(
  params: DiscoverAgentsParams,
  agentId: string,
  natsClient: NATSClient,
): Promise<DiscoverAgentsResult> {
  const replyInbox = natsClient.newInbox();

  const envelope = createEnvelope({
    request_id: uuidv4(),
    message_type: "req",
    source: agentId,
    seq: 0,
    action: "discover",
    resource_type: "agent",
    payload: {
      filter_skills: params.filterSkills ?? null,
      filter_status: params.filterStatus ?? null,
    },
    reply_to: replyInbox,
  });

  try {
    const responseBytes = await new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        sub.unsubscribe();
        reject(new Error("discover request timed out after 10 s"));
      }, 10_000);

      const sub = natsClient.subscribe(replyInbox, (bytes) => {
        clearTimeout(timer);
        sub.unsubscribe();
        resolve(bytes);
      });

      natsClient.publish("registry.agent.discover", serializeEnvelope(envelope));
    });

    const response = deserializeEnvelope(responseBytes);
    const p = response.payload as {
      agents?: Array<Record<string, unknown>>;
      total?: number;
      success?: boolean;
      error?: string;
    };

    if (p.success === false) {
      return { ok: false, error: p.error ?? "registry returned success=false" };
    }

    const agents: DiscoveredAgent[] = (p.agents ?? []).map((raw) => {
      const card = raw["card"] && typeof raw["card"] === "object" ? (raw["card"] as Record<string, unknown>) : raw;
      return {
        agentId: String(card["agent_id"] ?? card["agentId"] ?? ""),
        name: String(card["name"] ?? ""),
        description: String(card["description"] ?? ""),
        status: String(card["status"] ?? "unknown"),
        skills: Array.isArray(card["skills"])
          ? (card["skills"] as Array<Record<string, unknown>>).map((s) => ({
              id: String(s["id"] ?? ""),
              name: String(s["name"] ?? ""),
              description: String(s["description"] ?? ""),
              tags: Array.isArray(s["tags"]) ? (s["tags"] as string[]).map(String) : [],
            }))
          : [],
      };
    });

    return { ok: true, agents, total: p.total ?? agents.length };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}
