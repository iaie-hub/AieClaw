// Curated setup helpers for provider plugins that integrate local/self-hosted models.
export type {
  OpenClawPluginApi,
  ProviderAuthContext,
  ProviderAuthMethodNonInteractiveContext,
  ProviderAuthResult,
  ProviderDiscoveryContext,
} from "../plugins/types.js";

export * from "./provider-self-hosted-setup-core.js";
export { OLLAMA_DEFAULT_BASE_URL, OLLAMA_DEFAULT_MODEL } from "./ollama-surface.js";
export {
  buildOllamaProvider,
  configureOllamaNonInteractive,
  ensureOllamaModelPulled,
  promptAndConfigureOllama,
} from "./ollama-surface.js";
export {
  VLLM_DEFAULT_BASE_URL,
  VLLM_DEFAULT_CONTEXT_WINDOW,
  VLLM_DEFAULT_COST,
  VLLM_DEFAULT_MAX_TOKENS,
  promptAndConfigureVllm,
} from "../plugins/provider-vllm-setup.js";
export { buildVllmProvider } from "./vllm.js";
export { buildSglangProvider } from "./sglang.js";
