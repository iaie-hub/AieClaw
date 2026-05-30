import { getAgentRegistryConfig } from "../store/agent-registry-config.js";
import { getNatsConfig } from "../store/nats-config.js";
import { errorShape, getAgentDownloadTempDir, type SimpleHandlers } from "./aiemas-utils.js";
import { proxyToRegistry, ClawHubProxyError, CLAWHUB_ERROR_CODES } from "./clawhub-proxy.js";
import { getRegistryBaseUrl, type ClawHubHandlersDeps } from "./clawhub-helpers.js";

export function registerClawHubSkillsHandlers(
  handlers: SimpleHandlers,
  deps: ClawHubHandlersDeps,
): void {
  const { db } = deps;

  // ── 7.5 UPLOAD SKILL TO HUB ──
  handlers["aiemas.clawhub.skill.upload"] = async ({ params, respond }) => {
    try {
      const skillKey = params["skillKey"] as string | undefined;
      const workspace = params["workspace"] as string | undefined;
      const items = params["items"] as string[] | undefined;
      const name = params["name"] as string | undefined;
      const description = (params["description"] as string | undefined) || "";

      if (!skillKey || !workspace || !Array.isArray(items) || !name) {
        respond(
          false,
          undefined,
          errorShape("INVALID_PARAMS", "skillKey, workspace, items, and name required"),
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
      const execFileAsync = promisify(execFile);

      try {
        await fsAccess(workspace);
      } catch {
        respond(false, undefined, errorShape("NOT_FOUND", "技能工作区目录不存在"));
        return;
      }

      const tempDir = getAgentDownloadTempDir(skillKey);
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
          "/api/v1/clawhub/skill",
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
