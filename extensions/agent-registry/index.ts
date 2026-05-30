import { defineBundledChannelEntry } from "openclaw/plugin-sdk/channel-entry-contract";
import type { AnyAgentTool } from "openclaw/plugin-sdk/channel-entry-contract";
import {
  discoverAgentsToolFactory,
  sendMessageToolFactory,
  createCoworkToolFactory,
  sendCoworkMessageToolFactory,
} from "./src/tools.js";

export default defineBundledChannelEntry({
  id: "agent-registry",
  name: "Agent Registry",
  description: "A2A Agent Registry channel via NATS JetStream",
  importMetaUrl: import.meta.url,
  plugin: {
    specifier: "./channel-plugin-api.js",
    exportName: "agentRegistryPlugin",
  },
  registerFull(api) {
    api.registerTool(discoverAgentsToolFactory as unknown as (ctx: unknown) => AnyAgentTool, {
      name: "discover_agents",
    });
    api.registerTool(sendMessageToolFactory as unknown as (ctx: unknown) => AnyAgentTool, {
      name: "send_message_to_agent",
    });
    api.registerTool(createCoworkToolFactory as unknown as (ctx: unknown) => AnyAgentTool, {
      name: "create_cowork",
    });
    api.registerTool(sendCoworkMessageToolFactory as unknown as (ctx: unknown) => AnyAgentTool, {
      name: "send_cowork_message",
    });
  },
});
