import { defineBundledChannelEntry } from "openclaw/plugin-sdk/channel-entry-contract";
import type { AnyAgentTool } from "openclaw/plugin-sdk/channel-entry-contract";
import {
  discoverAgentsTool,
  sendMessageTool,
  createCoworkTool,
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
    api.registerTool(discoverAgentsTool as unknown as AnyAgentTool, { name: "discover_agents" });
    api.registerTool(sendMessageTool as unknown as AnyAgentTool, { name: "send_message_to_agent" });
    api.registerTool(createCoworkTool as unknown as AnyAgentTool, { name: "create_cowork" });
  },
});
