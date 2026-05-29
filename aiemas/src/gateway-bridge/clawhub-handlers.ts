import type { DatabaseSync } from "node:sqlite";
import { getAgentRegistryConfig, saveAgentRegistryConfig } from "../store/agent-registry-config.js";
import { getNatsConfig, saveNatsConfig } from "../store/nats-config.js";
import { errorShape, getAgentDownloadTempDir, type SimpleHandlers } from "./aiemas-utils.js";
import { proxyToRegistry, ClawHubProxyError, CLAWHUB_ERROR_CODES } from "./clawhub-proxy.js";

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
 * Mask an API key for display: show first 8 chars + "****" + last 8 chars.
 * Returns null if the key is null/empty.
 */
function maskApiKey(apiKey: string | null): string | null {
  if (!apiKey) {
    return null;
  }
  if (apiKey.length <= 16) {
    return apiKey;
  }
  return apiKey.slice(0, 8) + "****" + apiKey.slice(-8);
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

  // ── aiemas.clawhub.agenthub.list ──
  handlers["aiemas.clawhub.agenthub.list"] = async ({ params, respond }) => {
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

      const result = await proxyToRegistry("GET", baseUrl, "/api/v1/clawhub/agent", config.apiKey, {
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

  // ── aiemas.clawhub.agenthub.visibility.update ──
  handlers["aiemas.clawhub.agenthub.visibility.update"] = async ({ params, respond }) => {
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

      const agentId = params["agentId"] as string | undefined;
      const visibility = params["visibility"] as string | undefined;

      if (!agentId || !visibility) {
        respond(false, undefined, errorShape("INVALID_PARAMS", "agentId and visibility required"));
        return;
      }

      const baseUrl = getRegistryBaseUrl(config.registryUrl, nats.natsUrl);

      const result = await proxyToRegistry(
        "PUT",
        baseUrl,
        `/api/v1/clawhub/agent/${agentId}/visibility`,
        config.apiKey,
        undefined,
        {
          visibility,
        },
      );

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

  // ── 7. UPLOAD AGENT TO HUB ──
  handlers["aiemas.clawhub.agent.upload"] = async ({ params, respond }) => {
    try {
      const agentId = params["agentId"] as string | undefined;
      const workspace = params["workspace"] as string | undefined;
      const items = params["items"] as string[] | undefined;
      const name = params["name"] as string | undefined;
      const description = (params["description"] as string | undefined) || "";

      if (!agentId || !workspace || !Array.isArray(items) || !name) {
        respond(
          false,
          undefined,
          errorShape("INVALID_PARAMS", "agentId, workspace, items, and name required"),
        );
        return;
      }

      // Check config
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
      const baseUrl = getRegistryBaseUrl(config.registryUrl, nats.natsUrl);

      // Node native modules
      const nodePath = await import("node:path");
      const { access: fsAccess, cp, rm } = await import("node:fs/promises");
      const { mkdirSync } = await import("node:fs");
      const { promisify } = await import("node:util");
      const { execFile } = await import("node:child_process");
      const os = await import("node:os");
      const execFileAsync = promisify(execFile);

      try {
        await fsAccess(workspace);
      } catch {
        respond(false, undefined, errorShape("NOT_FOUND", "工作区目录不存在"));
        return;
      }

      const tempDir = getAgentDownloadTempDir(agentId);
      const archivePath = `${tempDir}-upload.zip`;

      mkdirSync(tempDir, { recursive: true });
      try {
        for (const item of items) {
          const src = nodePath.join(workspace, item);
          const dest = nodePath.join(tempDir, item);
          await cp(src, dest, { recursive: true });
        }

        // Remove any pre-existing archive for a clean full export
        await rm(archivePath, { force: true });
        await execFileAsync("zip", ["-r", archivePath, "."], { cwd: tempDir });
      } finally {
        await rm(tempDir, { recursive: true, force: true });
      }

      // Call proxyMultipartToRegistry to upload it
      let uploadResult;
      try {
        const { proxyMultipartToRegistry } = await import("./clawhub-proxy.js");
        uploadResult = await proxyMultipartToRegistry(
          "POST",
          baseUrl,
          "/api/v1/clawhub/agent",
          config.apiKey,
          { name, description },
          archivePath,
          "file",
        );
      } finally {
        // Cleanup local zip package
        await rm(archivePath, { force: true });
      }

      respond(true, uploadResult, undefined);
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

  // ── 8. DOWNLOAD AGENT FROM HUB ──
  handlers["aiemas.clawhub.agent.download"] = async ({ params, respond }) => {
    try {
      const agentId = params["agentId"] as string | undefined;
      const filename = params["filename"] as string | undefined;

      if (!agentId || !filename) {
        respond(false, undefined, errorShape("INVALID_PARAMS", "agentId and filename required"));
        return;
      }

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

      const baseUrl = getRegistryBaseUrl(config.registryUrl, nats.natsUrl);

      const os = await import("node:os");
      const nodePath = await import("node:path");
      const fs = await import("node:fs");
      const https = await import("node:https");
      const http = await import("node:http");

      const downloadDir = getAgentDownloadTempDir(agentId);
      fs.mkdirSync(downloadDir, { recursive: true });
      const downloadPath = nodePath.join(
        downloadDir,
        filename.endsWith(".zip") ? filename : `${filename}.zip`,
      );

      const normalizedBase = baseUrl.replace(/\/+$/, "");
      const urlStr = `${normalizedBase}/api/v1/clawhub/agent/${agentId}/download`;
      const url = new URL(urlStr);
      const isHttps = url.protocol === "https:";
      const requestFn = isHttps ? https.request : http.request;

      await new Promise<void>((resolve, reject) => {
        const req = requestFn(
          url,
          {
            method: "GET",
            headers: {
              "X-API-Key": config.apiKey!,
            },
            timeout: 60_000,
          },
          (res) => {
            if (res.statusCode === 401) {
              reject(
                new ClawHubProxyError(
                  CLAWHUB_ERROR_CODES.INVALID_API_KEY,
                  "API Key invalid or expired",
                  401,
                ),
              );
              return;
            }
            if (res.statusCode! < 200 || res.statusCode! >= 300) {
              reject(
                new ClawHubProxyError(
                  CLAWHUB_ERROR_CODES.REGISTRY_ERROR,
                  `AgentRegistry returned HTTP ${res.statusCode}`,
                  res.statusCode,
                ),
              );
              return;
            }

            const fileStream = fs.createWriteStream(downloadPath);
            res.pipe(fileStream);

            fileStream.on("finish", () => {
              fileStream.close();
              resolve();
            });

            fileStream.on("error", (err) => {
              fs.unlink(downloadPath, () => {}); // ignore unlink errors
              reject(err);
            });
          },
        );

        req.on("error", (err) => {
          reject(
            new ClawHubProxyError(
              CLAWHUB_ERROR_CODES.SERVICE_UNREACHABLE,
              `Failed to download: ${err.message}`,
            ),
          );
        });

        req.on("timeout", () => {
          req.destroy();
          reject(
            new ClawHubProxyError(CLAWHUB_ERROR_CODES.TIMEOUT, "Download request timed out (60s)"),
          );
        });

        req.end();
      });

      respond(true, { ok: true, downloadPath }, undefined);
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

  // ── aiemas.clawhub.skillhub.list ──
  handlers["aiemas.clawhub.skillhub.list"] = async ({ params, respond }) => {
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

      const result = await proxyToRegistry("GET", baseUrl, "/api/v1/clawhub/skill", config.apiKey, {
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

  // ── aiemas.clawhub.skillhub.visibility.update ──
  handlers["aiemas.clawhub.skillhub.visibility.update"] = async ({ params, respond }) => {
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

      const skillId = params["skillId"] as string | undefined;
      const visibility = params["visibility"] as string | undefined;

      if (!skillId || !visibility) {
        respond(false, undefined, errorShape("INVALID_PARAMS", "skillId and visibility required"));
        return;
      }

      const baseUrl = getRegistryBaseUrl(config.registryUrl, nats.natsUrl);

      const result = await proxyToRegistry(
        "PUT",
        baseUrl,
        `/api/v1/clawhub/skill/${skillId}/visibility`,
        config.apiKey,
        undefined,
        {
          visibility,
        },
      );

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

  // ── 9. DOWNLOAD SKILL FROM HUB ──
  handlers["aiemas.clawhub.skill.download"] = async ({ params, respond }) => {
    try {
      const skillId = params["skillId"] as string | undefined;
      const filename = params["filename"] as string | undefined;

      if (!skillId || !filename) {
        respond(false, undefined, errorShape("INVALID_PARAMS", "skillId and filename required"));
        return;
      }

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

      const baseUrl = getRegistryBaseUrl(config.registryUrl, nats.natsUrl);

      const os = await import("node:os");
      const nodePath = await import("node:path");
      const fs = await import("node:fs");
      const https = await import("node:https");
      const http = await import("node:http");

      const downloadDir = getAgentDownloadTempDir(skillId);
      fs.mkdirSync(downloadDir, { recursive: true });
      const downloadPath = nodePath.join(
        downloadDir,
        filename.endsWith(".zip") ? filename : `${filename}.zip`,
      );

      const normalizedBase = baseUrl.replace(/\/+$/, "");
      const urlStr = `${normalizedBase}/api/v1/clawhub/skill/${skillId}/download`;
      const url = new URL(urlStr);
      const isHttps = url.protocol === "https:";
      const requestFn = isHttps ? https.request : http.request;

      await new Promise<void>((resolve, reject) => {
        const req = requestFn(
          url,
          {
            method: "GET",
            headers: {
              "X-API-Key": config.apiKey!,
            },
            timeout: 60_000,
          },
          (res) => {
            if (res.statusCode === 401) {
              reject(
                new ClawHubProxyError(
                  CLAWHUB_ERROR_CODES.INVALID_API_KEY,
                  "API Key invalid or expired",
                  401,
                ),
              );
              return;
            }
            if (res.statusCode! < 200 || res.statusCode! >= 300) {
              reject(
                new ClawHubProxyError(
                  CLAWHUB_ERROR_CODES.REGISTRY_ERROR,
                  `AgentRegistry returned HTTP ${res.statusCode}`,
                  res.statusCode,
                ),
              );
              return;
            }

            const fileStream = fs.createWriteStream(downloadPath);
            res.pipe(fileStream);

            fileStream.on("finish", () => {
              fileStream.close();
              resolve();
            });

            fileStream.on("error", (err) => {
              fs.unlink(downloadPath, () => {}); // ignore unlink errors
              reject(err);
            });
          },
        );

        req.on("error", (err) => {
          reject(
            new ClawHubProxyError(
              CLAWHUB_ERROR_CODES.SERVICE_UNREACHABLE,
              `Failed to download: ${err.message}`,
            ),
          );
        });

        req.on("timeout", () => {
          req.destroy();
          reject(
            new ClawHubProxyError(CLAWHUB_ERROR_CODES.TIMEOUT, "Download request timed out (60s)"),
          );
        });

        req.end();
      });

      respond(true, { ok: true, downloadPath }, undefined);
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
