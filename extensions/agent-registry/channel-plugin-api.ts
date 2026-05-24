// Keep bundled channel entry imports narrow so bootstrap/discovery paths do
// not drag the broad Agent Registry barrel into lightweight plugin loads.
export { agentRegistryPlugin } from "./src/channel.js";
