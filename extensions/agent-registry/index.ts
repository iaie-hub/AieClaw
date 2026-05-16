import { defineBundledChannelEntry } from "openclaw/plugin-sdk/channel-entry-contract";

export default defineBundledChannelEntry({
  id: "agent-registry",
  name: "Agent Registry",
  description: "A2A Agent Registry channel via NATS JetStream",
  importMetaUrl: import.meta.url,
  plugin: {
    specifier: "./channel-plugin-api.js",
    exportName: "agentRegistryPlugin",
  },
});
