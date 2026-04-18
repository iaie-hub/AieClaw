import type { OpenClawConfig } from "../config/types.openclaw.js";
import { formatErrorMessage } from "../infra/errors.js";
import { createSubsystemLogger } from "../logging/subsystem.js";
import {
  groupPluginDiscoveryProvidersByOrder,
  normalizePluginDiscoveryResult,
  resolvePluginDiscoveryProviders,
  runProviderCatalog,
} from "../plugins/provider-discovery.js";
import { resolveOwningPluginIdsForProvider } from "../plugins/providers.js";
import { ensureAuthProfileStore } from "./auth-profiles/store.js";
import {
  isNonSecretApiKeyMarker,
  resolveNonEnvSecretRefApiKeyMarker,
} from "./model-auth-markers.js";
import type {
  ProviderApiKeyResolver,
  ProviderAuthResolver,
  ProviderConfig,
} from "./models-config.providers.secrets.js";
import {
  createProviderApiKeyResolver,
  createProviderAuthResolver,
} from "./models-config.providers.secrets.js";
import { findNormalizedProviderValue } from "./provider-id.js";

const log = createSubsystemLogger("agents/model-providers");

// ── 方案 1：进程级 provider discovery 缓存 ──────────────────────────────────
// key 为 config+env 的 fingerprint，与 agentDir 无关。
// 不使用 TTL：discovery 结果完全由 config+env 决定，fingerprint 变化即失效。
const PROVIDER_DISCOVERY_CACHE_KEY = Symbol.for("openclaw.providerDiscoveryCache");

type ProviderDiscoveryCacheEntry = {
  fingerprint: string;
  providers: Record<string, ProviderConfig>;
};

type ProviderDiscoveryCache = {
  entry: ProviderDiscoveryCacheEntry | null;
  pending: Promise<Record<string, ProviderConfig>> | null;
};

function getProviderDiscoveryCache(): ProviderDiscoveryCache {
  const g = globalThis as typeof globalThis & {
    [PROVIDER_DISCOVERY_CACHE_KEY]?: ProviderDiscoveryCache;
  };
  if (!g[PROVIDER_DISCOVERY_CACHE_KEY]) {
    g[PROVIDER_DISCOVERY_CACHE_KEY] = { entry: null, pending: null };
  }
  return g[PROVIDER_DISCOVERY_CACHE_KEY];
}

function buildProviderDiscoveryFingerprint(
  config: OpenClawConfig | undefined,
  env: NodeJS.ProcessEnv,
): string {
  // 只包含影响 provider discovery 结构的因素。
  // 排除 apiKey/secret 值——不同 agentDir 的 secret resolution 可能不同，
  // 但不影响 provider 列表和模型目录的结构。
  const envShape = {
    OPENCLAW_LIVE_TEST: env.OPENCLAW_LIVE_TEST,
    OPENCLAW_LIVE_GATEWAY: env.OPENCLAW_LIVE_GATEWAY,
    LIVE: env.LIVE,
    OPENCLAW_LIVE_PROVIDERS: env.OPENCLAW_LIVE_PROVIDERS,
    OPENCLAW_TEST_ONLY_PROVIDER_PLUGIN_IDS: env.OPENCLAW_TEST_ONLY_PROVIDER_PLUGIN_IDS,
  };
  // 提取 provider 结构（baseUrl、api、models id 列表），忽略 apiKey 等 secret 字段
  const providerStructure = config?.models?.providers
    ? Object.fromEntries(
        Object.entries(config.models.providers).map(([key, p]) => [
          key,
          {
            baseUrl: p?.baseUrl,
            api: p?.api,
            models: Array.isArray(p?.models)
              ? p.models.map((m: { id?: string }) => m?.id)
              : undefined,
          },
        ]),
      )
    : undefined;
  return JSON.stringify({ providerStructure, envShape });
}

export function resetProviderDiscoveryCacheForTest(): void {
  const cache = getProviderDiscoveryCache();
  cache.entry = null;
  cache.pending = null;
}

const PROVIDER_IMPLICIT_MERGERS: Partial<
  Record<
    string,
    (params: { existing: ProviderConfig | undefined; implicit: ProviderConfig }) => ProviderConfig
  >
> = {
  ollama: ({ implicit }) => implicit,
};

const PLUGIN_DISCOVERY_ORDERS = ["simple", "profile", "paired", "late"] as const;

type ImplicitProviderParams = {
  agentDir: string;
  config?: OpenClawConfig;
  env?: NodeJS.ProcessEnv;
  workspaceDir?: string;
  explicitProviders?: Record<string, ProviderConfig> | null;
};

type ImplicitProviderContext = ImplicitProviderParams & {
  authStore: ReturnType<typeof ensureAuthProfileStore>;
  env: NodeJS.ProcessEnv;
  resolveProviderApiKey: ProviderApiKeyResolver;
  resolveProviderAuth: ProviderAuthResolver;
};

function resolveLiveProviderCatalogTimeoutMs(env: NodeJS.ProcessEnv): number | null {
  const live =
    env.OPENCLAW_LIVE_TEST === "1" || env.OPENCLAW_LIVE_GATEWAY === "1" || env.LIVE === "1";
  if (!live) {
    return null;
  }
  const raw = env.OPENCLAW_LIVE_PROVIDER_DISCOVERY_TIMEOUT_MS?.trim();
  if (!raw) {
    return 15_000;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 15_000;
}

function resolveProviderDiscoveryFilter(params: {
  config?: OpenClawConfig;
  workspaceDir?: string;
  env: NodeJS.ProcessEnv;
}): string[] | undefined {
  const { config, workspaceDir, env } = params;
  const testRaw = env.OPENCLAW_TEST_ONLY_PROVIDER_PLUGIN_IDS?.trim();
  if (testRaw) {
    const ids = testRaw
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    return ids.length > 0 ? [...new Set(ids)] : undefined;
  }
  const live =
    env.OPENCLAW_LIVE_TEST === "1" || env.OPENCLAW_LIVE_GATEWAY === "1" || env.LIVE === "1";
  if (!live) {
    return undefined;
  }
  const rawValues = [
    env.OPENCLAW_LIVE_PROVIDERS?.trim(),
    env.OPENCLAW_LIVE_GATEWAY_PROVIDERS?.trim(),
  ].filter((value): value is string => Boolean(value && value !== "all"));
  if (rawValues.length === 0) {
    return undefined;
  }
  const ids = rawValues
    .flatMap((value) => value.split(","))
    .map((value) => value.trim())
    .filter(Boolean);
  if (ids.length === 0) {
    return undefined;
  }
  const pluginIds = new Set<string>();
  for (const id of ids) {
    const owners =
      resolveOwningPluginIdsForProvider({
        provider: id,
        config,
        workspaceDir,
        env,
      }) ?? [];
    if (owners.length > 0) {
      for (const owner of owners) {
        pluginIds.add(owner);
      }
      continue;
    }
    pluginIds.add(id);
  }
  return pluginIds.size > 0
    ? [...pluginIds].toSorted((left, right) => left.localeCompare(right))
    : undefined;
}

export function resolveProviderDiscoveryFilterForTest(params: {
  config?: OpenClawConfig;
  workspaceDir?: string;
  env: NodeJS.ProcessEnv;
}): string[] | undefined {
  return resolveProviderDiscoveryFilter(params);
}

function mergeImplicitProviderSet(
  target: Record<string, ProviderConfig>,
  additions: Record<string, ProviderConfig> | undefined,
): void {
  if (!additions) {
    return;
  }
  for (const [key, value] of Object.entries(additions)) {
    target[key] = value;
  }
}

function mergeImplicitProviderConfig(params: {
  providerId: string;
  existing: ProviderConfig | undefined;
  implicit: ProviderConfig;
}): ProviderConfig {
  const { providerId, existing, implicit } = params;
  if (!existing) {
    return implicit;
  }
  const merge = PROVIDER_IMPLICIT_MERGERS[providerId];
  if (merge) {
    return merge({ existing, implicit });
  }
  return {
    ...implicit,
    ...existing,
    models:
      Array.isArray(existing.models) && existing.models.length > 0
        ? existing.models
        : implicit.models,
  };
}

function resolveConfiguredImplicitProvider(params: {
  configuredProviders?: Record<string, ProviderConfig> | null;
  providerIds: readonly string[];
}): ProviderConfig | undefined {
  for (const providerId of params.providerIds) {
    const configured = findNormalizedProviderValue(
      params.configuredProviders ?? undefined,
      providerId,
    );
    if (configured) {
      return configured;
    }
  }
  return undefined;
}

function resolveExistingImplicitProviderFromContext(params: {
  ctx: ImplicitProviderContext;
  providerIds: readonly string[];
}): ProviderConfig | undefined {
  return (
    resolveConfiguredImplicitProvider({
      configuredProviders: params.ctx.explicitProviders,
      providerIds: params.providerIds,
    }) ??
    resolveConfiguredImplicitProvider({
      configuredProviders: params.ctx.config?.models?.providers,
      providerIds: params.providerIds,
    })
  );
}

async function resolvePluginImplicitProviders(
  ctx: ImplicitProviderContext,
  providers: import("../plugins/types.js").ProviderPlugin[],
  order: import("../plugins/types.js").ProviderDiscoveryOrder,
): Promise<Record<string, ProviderConfig> | undefined> {
  const byOrder = groupPluginDiscoveryProvidersByOrder(providers);
  const discovered: Record<string, ProviderConfig> = {};
  const catalogConfig = buildPluginCatalogConfig(ctx);
  const pluginsForOrder = byOrder[order];

  if (pluginsForOrder.length === 0) {
    return undefined;
  }

  // 方案 3：并行执行同一 order 内所有 provider 的 catalog 发现
  const catalogTasks = pluginsForOrder.map((provider) => {
    const resolveCatalogProviderApiKey = (providerId?: string) => {
      const resolvedProviderId = providerId?.trim() || provider.id;
      const resolved = ctx.resolveProviderApiKey(resolvedProviderId);
      if (resolved.apiKey) {
        return resolved;
      }

      if (
        !findNormalizedProviderValue(
          {
            [provider.id]: true,
            ...Object.fromEntries((provider.aliases ?? []).map((alias) => [alias, true])),
            ...Object.fromEntries((provider.hookAliases ?? []).map((alias) => [alias, true])),
          },
          resolvedProviderId,
        )
      ) {
        return resolved;
      }

      const synthetic = provider.resolveSyntheticAuth?.({
        config: catalogConfig,
        provider: resolvedProviderId,
        providerConfig: catalogConfig.models?.providers?.[resolvedProviderId],
      });
      const syntheticApiKey = synthetic?.apiKey?.trim();
      if (!syntheticApiKey) {
        return resolved;
      }

      return {
        apiKey: isNonSecretApiKeyMarker(syntheticApiKey)
          ? syntheticApiKey
          : resolveNonEnvSecretRefApiKeyMarker("file"),
        discoveryApiKey: undefined,
      };
    };

    return runProviderCatalogWithTimeout({
      provider,
      config: catalogConfig,
      agentDir: ctx.agentDir,
      workspaceDir: ctx.workspaceDir,
      env: ctx.env,
      resolveProviderApiKey: resolveCatalogProviderApiKey,
      resolveProviderAuth: (providerId, options) =>
        ctx.resolveProviderAuth(providerId?.trim() || provider.id, options),
      timeoutMs: resolveLiveProviderCatalogTimeoutMs(ctx.env),
    }).then((result) => {
      return { provider, result };
    });
  });

  // 等待所有并行 catalog 任务完成，按原始顺序处理结果（保持确定性）
  const results = await Promise.allSettled(catalogTasks);

  for (const settled of results) {
    if (settled.status !== "fulfilled" || !settled.value.result) {
      continue;
    }
    const { provider, result } = settled.value;
    const normalizedResult = normalizePluginDiscoveryResult({ provider, result });
    for (const [providerId, implicitProvider] of Object.entries(normalizedResult)) {
      discovered[providerId] = mergeImplicitProviderConfig({
        providerId,
        existing:
          discovered[providerId] ??
          resolveExistingImplicitProviderFromContext({
            ctx,
            providerIds: [
              providerId,
              provider.id,
              ...(provider.aliases ?? []),
              ...(provider.hookAliases ?? []),
            ],
          }),
        implicit: implicitProvider,
      });
    }
  }

  return Object.keys(discovered).length > 0 ? discovered : undefined;
}

function buildPluginCatalogConfig(ctx: ImplicitProviderContext): OpenClawConfig {
  if (!ctx.explicitProviders || Object.keys(ctx.explicitProviders).length === 0) {
    return ctx.config ?? {};
  }
  return {
    ...ctx.config,
    models: {
      ...ctx.config?.models,
      providers: {
        ...ctx.config?.models?.providers,
        ...ctx.explicitProviders,
      },
    },
  };
}

async function runProviderCatalogWithTimeout(
  params: Parameters<typeof runProviderCatalog>[0] & {
    timeoutMs: number | null;
  },
): Promise<Awaited<ReturnType<typeof runProviderCatalog>> | undefined> {
  const catalogRun = runProviderCatalog(params);
  const timeoutMs = params.timeoutMs ?? undefined;
  if (!timeoutMs) {
    return await catalogRun;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      catalogRun,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(
            new Error(`provider catalog timed out after ${timeoutMs}ms: ${params.provider.id}`),
          );
        }, timeoutMs);
        timer.unref?.();
      }),
    ]);
  } catch (error) {
    const message = formatErrorMessage(error);
    if (message.includes("provider catalog timed out after")) {
      log.warn(`${message}; skipping provider discovery`);
      return undefined;
    }
    throw error;
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export async function resolveImplicitProviders(
  params: ImplicitProviderParams,
): Promise<NonNullable<OpenClawConfig["models"]>["providers"]> {
  const env = params.env ?? process.env;

  // 方案 1：进程级缓存，纯 fingerprint 匹配，无 TTL
  const cache = getProviderDiscoveryCache();
  const fingerprint = buildProviderDiscoveryFingerprint(params.config, env);

  if (cache.entry && cache.entry.fingerprint === fingerprint) {
    return cache.entry.providers;
  }

  // 如果有正在进行的 discovery，等待它完成后再检查缓存
  if (cache.pending) {
    try {
      await cache.pending;
    } catch {
      // pending 失败了，继续执行新的 discovery
    }
    // pending 完成后缓存可能已被填充，再检查一次
    if (cache.entry && cache.entry.fingerprint === fingerprint) {
      return cache.entry.providers;
    }
  }

  const pending = (async () => {
    const providers: Record<string, ProviderConfig> = {};
    let authStore: ReturnType<typeof ensureAuthProfileStore> | undefined;
    const getAuthStore = () =>
      (authStore ??= ensureAuthProfileStore(params.agentDir, {
        allowKeychainPrompt: false,
      }));
    const context: ImplicitProviderContext = {
      ...params,
      get authStore() {
        return getAuthStore();
      },
      env,
      resolveProviderApiKey: createProviderApiKeyResolver(env, getAuthStore, params.config),
      resolveProviderAuth: createProviderAuthResolver(env, getAuthStore, params.config),
    };
    const discoveryProviders = await resolvePluginDiscoveryProviders({
      config: params.config,
      workspaceDir: params.workspaceDir,
      env,
      onlyPluginIds: resolveProviderDiscoveryFilter({
        config: params.config,
        workspaceDir: params.workspaceDir,
        env,
      }),
    });

    for (const order of PLUGIN_DISCOVERY_ORDERS) {
      mergeImplicitProviderSet(
        providers,
        await resolvePluginImplicitProviders(context, discoveryProviders, order),
      );
    }

    cache.entry = { fingerprint, providers };
    return providers;
  })();

  cache.pending = pending;
  try {
    return await pending;
  } finally {
    if (cache.pending === pending) {
      cache.pending = null;
    }
  }
}
