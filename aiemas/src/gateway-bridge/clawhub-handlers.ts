import type { DatabaseSync } from "node:sqlite";
import { getAgentRegistryConfig, saveAgentRegistryConfig } from "../store/agent-registry-config.js";
import { getNatsConfig, saveNatsConfig } from "../store/nats-config.js";
import { proxyToRegistry, ClawHubProxyError, CLAWHUB_ERROR_CODES } from "./clawhub-proxy.js";
import { errorShape, type SimpleHandlers } from "./aiemas-utils.js";

export interface ClawHubHandlersDeps {
  db: DatabaseSync;
}

/** Default AgentRegistry HTTP port. */
const DEFAULT_REGISTRY_PORT = 8000;
const DEFAULT_REGISTRY_URL = `http://localhost:${DEFAULT_REGISTRY_PORT}`;

/**
 * Derive the AgentRegistry HTTP base URL.
 *
 * Resolution order:
 * 1. registryUrl explicitly configured in DB
 * 2. AGENT_REGISTRY_URL environment variable
 * 3. Derive from natsUrl host with default HTTP port (8000)
 * 4. Fall back to http://localhost:8000
 */
function getRegistryBaseUrl(registryUrl: string | null, natsUrl: string | null): string {
  if (registryUrl) {
    return registryUrl.replace(/\/+$/, "");
  }
  const envUrl = process.env.AGENT_REGISTRY_URL;
  if (envUrl) {
    return envUrl.replace(/\/+$/, "");
  }

  if (!natsUrl) {
    return DEFAULT_REGISTRY_URL;
  }
  // natsUrl is like "nats://host:port" — derive HTTP URL from the host
  try {
    const match = natsUrl.match(/^nats:\/\/([^:/]+)(?::(\d+))?/);
    if (match?.[1]) {
      return `http://${match[1]}:${DEFAULT_REGISTRY_PORT}`;
    }
  } catch {
    // ignore parse errors
  }
  return DEFAULT_REGISTRY_URL;
}

/**
 * Mask an API key for display: show first 10 chars + "****".
 * Returns null if the key is null/empty.
 */
function maskApiKey(apiKey: string | null): string | null {
  if (!apiKey) {
    return null;
  }
  if (apiKey.length <= 10) {
    return apiKey;
  }
  return apiKey.slice(0, 10) + "****";
}

/**
 * Register all ClawHub RPC handlers on the given handlers map.
 */
export function registerClawHubHandlers(handlers: SimpleHandlers, deps: ClawHubHandlersDeps): void {
  const { db } = deps;

  // ── 1. REGISTRY CONFIG GET ──
  handlers["aiemas.clawhub.registry-config.get"] = async ({ respond }) => {
    try {
      const config = getAgentRegistryConfig(db);
      respond(
        true,
        {
          apiKey: maskApiKey(config.apiKey),
          registryUrl: config.registryUrl,
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape("INTERNAL", String(err)));
    }
  };

  // ── 2. REGISTRY CONFIG SAVE ──
  handlers["aiemas.clawhub.registry-config.save"] = async ({ params, respond }) => {
    try {
      const apiKey = params["apiKey"] as string | undefined;
      const registryUrl = params["registryUrl"] as string | undefined;

      // If apiKey is provided, validate it via the healthy endpoint first
      if (apiKey) {
        const config = getAgentRegistryConfig(db);
        const nats = getNatsConfig(db);
        const baseUrl = getRegistryBaseUrl(registryUrl ?? config.registryUrl, nats.natsUrl);

        try {
          await proxyToRegistry("GET", baseUrl, "/api/v1/healthy", apiKey);
        } catch (err) {
          if (err instanceof ClawHubProxyError) {
            respond(false, undefined, {
              ok: false,
              error: err.message,
              code: err.code,
            });
            return;
          }
          respond(false, undefined, {
            ok: false,
            error: "Failed to validate API Key",
            code: CLAWHUB_ERROR_CODES.SERVICE_UNREACHABLE,
          });
          return;
        }
      }

      // Persist config
      const configToSave: Record<string, string | undefined> = {};
      if (apiKey !== undefined) configToSave.apiKey = apiKey;
      if (registryUrl !== undefined) configToSave.registryUrl = registryUrl;

      saveAgentRegistryConfig(db, configToSave);
      respond(true, { ok: true }, undefined);
    } catch (err) {
      respond(false, undefined, {
        ok: false,
        error: String(err),
        code: "INTERNAL",
      });
    }
  };

  // ── 3. NATS CONFIG GET ──
  handlers["aiemas.clawhub.nats-config.get"] = async ({ respond }) => {
    try {
      const nats = getNatsConfig(db);
      respond(
        true,
        {
          natsUrl: nats.natsUrl,
          natsToken: nats.natsToken,
          agentId: nats.agentId,
          agentName: nats.agentName,
          boundAgentId: nats.boundAgentId,
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape("INTERNAL", String(err)));
    }
  };

  // ── 4. NATS CONFIG SAVE ──
  handlers["aiemas.clawhub.nats-config.save"] = async ({ params, respond }) => {
    try {
      const natsUrl = params["natsUrl"] as string | undefined;
      const natsToken = params["natsToken"] as string | undefined;
      const agentId = params["agentId"] as string | undefined;
      const agentName = params["agentName"] as string | undefined;
      const boundAgentId = params["boundAgentId"] as string | undefined;

      const configToSave: Record<string, string | undefined> = {};
      if (natsUrl !== undefined) configToSave.natsUrl = natsUrl;
      if (natsToken !== undefined) configToSave.natsToken = natsToken;
      if (agentId !== undefined) configToSave.agentId = agentId;
      if (agentName !== undefined) configToSave.agentName = agentName;
      if (boundAgentId !== undefined) configToSave.boundAgentId = boundAgentId;

      saveNatsConfig(db, configToSave);
      respond(true, { ok: true }, undefined);
    } catch (err) {
      respond(false, undefined, {
        ok: false,
        error: String(err),
        code: "INTERNAL",
      });
    }
  };

  // ── LEGACY: aiemas.clawhub.config.get (For compatibility) ──
  handlers["aiemas.clawhub.config.get"] = async ({ respond }) => {
    try {
      const config = getAgentRegistryConfig(db);
      const nats = getNatsConfig(db);
      respond(
        true,
        {
          apiKey: maskApiKey(config.apiKey),
          natsUrl: nats.natsUrl,
          natsToken: nats.natsToken,
          agentId: nats.agentId,
          agentName: nats.agentName,
          boundAgentId: nats.boundAgentId,
          registryUrl: config.registryUrl,
        },
        undefined,
      );
    } catch (err) {
      respond(false, undefined, errorShape("INTERNAL", String(err)));
    }
  };

  // ── LEGACY: aiemas.clawhub.config.save (For compatibility) ──
  handlers["aiemas.clawhub.config.save"] = async ({ params, respond }) => {
    try {
      const apiKey = params["apiKey"] as string | undefined;
      const registryUrl = params["registryUrl"] as string | undefined;
      const natsUrl = params["natsUrl"] as string | undefined;
      const natsToken = params["natsToken"] as string | undefined;
      const agentId = params["agentId"] as string | undefined;
      const agentName = params["agentName"] as string | undefined;
      const boundAgentId = params["boundAgentId"] as string | undefined;

      // Validate API Key if passed
      if (apiKey) {
        const config = getAgentRegistryConfig(db);
        const baseUrl = getRegistryBaseUrl(registryUrl ?? config.registryUrl, natsUrl ?? null);

        try {
          await proxyToRegistry("GET", baseUrl, "/api/v1/healthy", apiKey);
        } catch (err) {
          if (err instanceof ClawHubProxyError) {
            respond(false, undefined, {
              ok: false,
              error: err.message,
              code: err.code,
            });
            return;
          }
          respond(false, undefined, {
            ok: false,
            error: "Failed to validate API Key",
            code: CLAWHUB_ERROR_CODES.SERVICE_UNREACHABLE,
          });
          return;
        }
      }

      // Save registry config fields
      const regToSave: Record<string, string | undefined> = {};
      if (apiKey !== undefined) regToSave.apiKey = apiKey;
      if (registryUrl !== undefined) regToSave.registryUrl = registryUrl;
      saveAgentRegistryConfig(db, regToSave);

      // Save NATS config fields
      const natsToSave: Record<string, string | undefined> = {};
      if (natsUrl !== undefined) natsToSave.natsUrl = natsUrl;
      if (natsToken !== undefined) natsToSave.natsToken = natsToken;
      if (agentId !== undefined) natsToSave.agentId = agentId;
      if (agentName !== undefined) natsToSave.agentName = agentName;
      if (boundAgentId !== undefined) natsToSave.boundAgentId = boundAgentId;
      saveNatsConfig(db, natsToSave);

      respond(true, { ok: true }, undefined);
    } catch (err) {
      respond(false, undefined, {
        ok: false,
        error: String(err),
        code: "INTERNAL",
      });
    }
  };

  // ── aiemas.clawhub.agents.list ──
  handlers["aiemas.clawhub.agents.list"] = async ({ params, respond }) => {
    try {
      const config = getAgentRegistryConfig(db);
      const nats = getNatsConfig(db);

      if (!config.apiKey) {
        respond(false, undefined, {
          ok: false,
          error: "API Key not configured",
          code: CLAWHUB_ERROR_CODES.API_KEY_NOT_CONFIGURED,
        });
        return;
      }

      const page = String(params["page"] ?? "1");
      const pageSize = String(params["pageSize"] ?? "20");
      const baseUrl = getRegistryBaseUrl(config.registryUrl, nats.natsUrl);

      const result = await proxyToRegistry("GET", baseUrl, "/api/v1/agents", config.apiKey, {
        page,
        page_size: pageSize,
      });

      respond(true, result, undefined);
    } catch (err) {
      if (err instanceof ClawHubProxyError) {
        respond(false, undefined, {
          ok: false,
          error: err.message,
          code: err.code,
        });
        return;
      }
      respond(false, undefined, {
        ok: false,
        error: String(err),
        code: "INTERNAL",
      });
    }
  };

  // ── aiemas.clawhub.healthy ──
  handlers["aiemas.clawhub.healthy"] = async ({ params, respond }) => {
    try {
      const apiKey = params["apiKey"] as string | undefined;
      const registryUrl = params["registryUrl"] as string | undefined;

      if (!apiKey) {
        respond(false, undefined, {
          ok: false,
          error: "apiKey parameter is required",
          code: CLAWHUB_ERROR_CODES.API_KEY_NOT_CONFIGURED,
        });
        return;
      }

      const config = getAgentRegistryConfig(db);
      const nats = getNatsConfig(db);
      const baseUrl = getRegistryBaseUrl(registryUrl ?? config.registryUrl, nats.natsUrl);

      const result = await proxyToRegistry("GET", baseUrl, "/api/v1/healthy", apiKey);
      respond(true, result, undefined);
    } catch (err) {
      if (err instanceof ClawHubProxyError) {
        respond(false, undefined, {
          ok: false,
          error: err.message,
          code: err.code,
        });
        return;
      }
      respond(false, undefined, {
        ok: false,
        error: String(err),
        code: "INTERNAL",
      });
    }
  };
}
