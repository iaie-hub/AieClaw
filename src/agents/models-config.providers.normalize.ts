import type { OpenClawConfig } from "../config/types.openclaw.js";
import { ensureAuthProfileStore } from "./auth-profiles/store.js";
import { normalizeConfiguredProviderCatalogModelId } from "./model-ref-shared.js";
import {
  normalizeProviderSpecificConfig,
  resolveProviderConfigApiKeyResolver,
} from "./models-config.providers.policy.js";
import type { ProviderConfig, SecretDefaults } from "./models-config.providers.secret-helpers.js";
import {
  normalizeConfiguredProviderApiKey,
  normalizeHeaderValues,
  normalizeResolvedEnvApiKey,
  resolveApiKeyFromProfiles,
  resolveMissingProviderApiKey,
} from "./models-config.providers.secret-helpers.js";
import { enforceSourceManagedProviderSecrets } from "./models-config.providers.source-managed.js";

type ModelsConfig = NonNullable<OpenClawConfig["models"]>;
type ProviderModelConfig = NonNullable<
  NonNullable<ModelsConfig["providers"]>[string]["models"]
>[number];

function getProviderModelId(model: ProviderModelConfig): string | undefined {
  return typeof model.id === "string" && model.id.trim() ? model.id : undefined;
}

function mergeNormalizedProviderModel(
  existing: ProviderModelConfig,
  incoming: ProviderModelConfig,
): ProviderModelConfig {
  return {
    ...incoming,
    ...existing,
    ...(existing.cost || incoming.cost
      ? {
          cost: {
            ...incoming.cost,
            ...existing.cost,
          },
        }
      : undefined),
  };
}

function normalizeProviderModelsForConfig(
  providerKey: string,
  provider: ProviderConfig,
): { provider: ProviderConfig; mutated: boolean } {
  if (!Array.isArray(provider.models) || provider.models.length === 0) {
    return { provider, mutated: false };
  }

  let mutated = false;
  const nextModels: ProviderModelConfig[] = [];
  const seenById = new Map<string, number>();
  for (const model of provider.models) {
    const rawId = getProviderModelId(model);
    const normalizedId = rawId
      ? normalizeConfiguredProviderCatalogModelId(providerKey, rawId)
      : rawId;
    const normalizedModel =
      normalizedId && normalizedId !== rawId ? { ...model, id: normalizedId } : model;
    if (normalizedModel !== model) {
      mutated = true;
    }
    const id = getProviderModelId(normalizedModel);
    if (id) {
      const existingIndex = seenById.get(id);
      if (existingIndex !== undefined) {
        mutated = true;
        nextModels[existingIndex] = mergeNormalizedProviderModel(
          nextModels[existingIndex],
          normalizedModel,
        );
        continue;
      }
      seenById.set(id, nextModels.length);
    }
    nextModels.push(normalizedModel);
  }

  return mutated
    ? { provider: { ...provider, models: nextModels }, mutated }
    : { provider, mutated };
}

export function normalizeProviderCatalogModelsForConfig(
  providers: ModelsConfig["providers"],
): ModelsConfig["providers"] {
  if (!providers) {
    return providers;
  }

  let mutated = false;
  const next: Record<string, ProviderConfig> = {};
  for (const [providerKey, provider] of Object.entries(providers)) {
    const normalized = normalizeProviderModelsForConfig(providerKey, provider);
    if (normalized.mutated) {
      mutated = true;
    }
    next[providerKey] = normalized.provider;
  }

  return mutated ? next : providers;
}

// ── 方案 5b：normalizeProviders 进程级缓存 ──────────────────────────────────
// key 为 agentDir + providers 结构 fingerprint。
// normalizeProviders 的结果依赖 agentDir（auth profile）和 providers 配置。
// 在同一 gateway 进程内，相同 agentDir + 相同 providers 结构 → 相同结果。
const NORMALIZE_PROVIDERS_CACHE_KEY = Symbol.for("openclaw.normalizeProvidersCache");

type NormalizeProvidersCacheEntry = {
  result: ModelsConfig["providers"];
};

type NormalizeProvidersCache = Map<string, NormalizeProvidersCacheEntry>;

function getNormalizeProvidersCache(): NormalizeProvidersCache {
  const g = globalThis as typeof globalThis & {
    [NORMALIZE_PROVIDERS_CACHE_KEY]?: NormalizeProvidersCache;
  };
  if (!g[NORMALIZE_PROVIDERS_CACHE_KEY]) {
    g[NORMALIZE_PROVIDERS_CACHE_KEY] = new Map();
  }
  return g[NORMALIZE_PROVIDERS_CACHE_KEY];
}

function buildNormalizeProvidersCacheKey(
  agentDir: string,
  providers: ModelsConfig["providers"],
): string {
  // 只用 provider key + baseUrl + models[].id 做 fingerprint，排除 apiKey 等 secret 字段
  const structure = providers
    ? Object.entries(providers)
        .map(
          ([key, p]) =>
            `${key}:${p?.baseUrl ?? ""}:${p?.api ?? ""}:${Array.isArray(p?.models) ? p.models.map((m: { id?: string }) => m?.id ?? "").join(",") : ""}`,
        )
        .join("|")
    : "";
  return `${agentDir}\0${structure}`;
}

export function normalizeProviders(params: {
  providers: ModelsConfig["providers"];
  agentDir: string;
  env?: NodeJS.ProcessEnv;
  secretDefaults?: SecretDefaults;
  sourceProviders?: ModelsConfig["providers"];
  sourceSecretDefaults?: SecretDefaults;
  secretRefManagedProviders?: Set<string>;
}): ModelsConfig["providers"] {
  const { providers } = params;
  if (!providers) {
    return providers;
  }

  // 方案 5b：进程级缓存
  const npCache = getNormalizeProvidersCache();
  const npCacheKey = buildNormalizeProvidersCacheKey(params.agentDir, providers);
  const npCached = npCache.get(npCacheKey);
  if (npCached) {
    return npCached.result;
  }

  const env = params.env ?? process.env;
  let authStore: ReturnType<typeof ensureAuthProfileStore> | undefined;
  const resolveProfileApiKey = (providerKey: string) => {
    if (!authStore) {
      authStore = ensureAuthProfileStore(params.agentDir, {
        allowKeychainPrompt: false,
      });
    }
    return resolveApiKeyFromProfiles({
      provider: providerKey,
      store: authStore,
      env,
    });
  };
  let mutated = false;
  const next: Record<string, ProviderConfig> = {};

  for (const [key, provider] of Object.entries(providers)) {
    const normalizedKey = key.trim();
    if (!normalizedKey) {
      mutated = true;
      continue;
    }
    if (normalizedKey !== key) {
      mutated = true;
    }
    let normalizedProvider = provider;
    const normalizedHeaders = normalizeHeaderValues({
      headers: normalizedProvider.headers,
      secretDefaults: params.secretDefaults,
    });
    if (normalizedHeaders.mutated) {
      mutated = true;
      normalizedProvider = { ...normalizedProvider, headers: normalizedHeaders.headers };
    }
    const providerWithConfiguredApiKey = normalizeConfiguredProviderApiKey({
      providerKey: normalizedKey,
      provider: normalizedProvider,
      secretDefaults: params.secretDefaults,
      profileApiKey: undefined,
      secretRefManagedProviders: params.secretRefManagedProviders,
    });
    if (providerWithConfiguredApiKey !== normalizedProvider) {
      mutated = true;
      normalizedProvider = providerWithConfiguredApiKey;
    }

    // Reverse-lookup: if apiKey looks like a resolved secret value (not an env
    // var name), check whether it matches the canonical env var for this provider.
    // This prevents resolveConfigEnvVars()-resolved secrets from being persisted
    // to models.json as plaintext. (Fixes #38757)
    const providerWithResolvedEnvApiKey = normalizeResolvedEnvApiKey({
      providerKey: normalizedKey,
      provider: normalizedProvider,
      env,
      secretRefManagedProviders: params.secretRefManagedProviders,
    });
    if (providerWithResolvedEnvApiKey !== normalizedProvider) {
      mutated = true;
      normalizedProvider = providerWithResolvedEnvApiKey;
    }

    const needsProfileApiKey =
      Array.isArray(normalizedProvider.models) &&
      normalizedProvider.models.length > 0 &&
      !(
        (typeof normalizedProvider.apiKey === "string" && normalizedProvider.apiKey.trim()) ||
        normalizedProvider.apiKey
      );
    const profileApiKey = needsProfileApiKey ? resolveProfileApiKey(normalizedKey) : undefined;
    const providerApiKeyResolver = needsProfileApiKey
      ? resolveProviderConfigApiKeyResolver(normalizedKey)
      : undefined;
    const providerWithApiKey = resolveMissingProviderApiKey({
      providerKey: normalizedKey,
      provider: normalizedProvider,
      env,
      profileApiKey,
      secretRefManagedProviders: params.secretRefManagedProviders,
      providerApiKeyResolver,
    });
    if (providerWithApiKey !== normalizedProvider) {
      mutated = true;
      normalizedProvider = providerWithApiKey;
    }

    const providerSpecificNormalized = normalizeProviderSpecificConfig(
      normalizedKey,
      normalizedProvider,
    );
    if (providerSpecificNormalized !== normalizedProvider) {
      mutated = true;
      normalizedProvider = providerSpecificNormalized;
    }

    const providerWithNormalizedModels = normalizeProviderModelsForConfig(
      normalizedKey,
      normalizedProvider,
    );
    if (providerWithNormalizedModels.mutated) {
      mutated = true;
      normalizedProvider = providerWithNormalizedModels.provider;
    }

    const existing = next[normalizedKey];
    if (existing) {
      // Keep deterministic behavior if users accidentally define duplicate
      // provider keys that only differ by surrounding whitespace.
      mutated = true;
      next[normalizedKey] = {
        ...existing,
        ...normalizedProvider,
        models: normalizedProvider.models ?? existing.models,
      };
      continue;
    }
    next[normalizedKey] = normalizedProvider;
  }

  const normalizedProviders = mutated ? next : providers;
  const result = enforceSourceManagedProviderSecrets({
    providers: normalizedProviders,
    sourceProviders: params.sourceProviders,
    sourceSecretDefaults: params.sourceSecretDefaults,
    secretRefManagedProviders: params.secretRefManagedProviders,
  });
  npCache.set(npCacheKey, { result });
  return result;
}
