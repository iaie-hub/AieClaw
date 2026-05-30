import { createReadStream, statSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { basename } from "node:path";

/**
 * Error codes for ClawHub proxy operations.
 */
export const CLAWHUB_ERROR_CODES = {
  SERVICE_UNREACHABLE: "SERVICE_UNREACHABLE",
  INVALID_API_KEY: "INVALID_API_KEY",
  API_KEY_NOT_CONFIGURED: "API_KEY_NOT_CONFIGURED",
  REGISTRY_ERROR: "REGISTRY_ERROR",
  TIMEOUT: "TIMEOUT",
} as const;

export type ClawHubErrorCode = (typeof CLAWHUB_ERROR_CODES)[keyof typeof CLAWHUB_ERROR_CODES];

/**
 * Error thrown by the ClawHub proxy when a request fails.
 */
export class ClawHubProxyError extends Error {
  constructor(
    readonly code: ClawHubErrorCode,
    message: string,
    readonly statusCode?: number,
  ) {
    super(message);
    this.name = "ClawHubProxyError";
  }
}

const TIMEOUT_MS = 10_000;

/**
 * Proxy an HTTP request to the AgentRegistry.
 *
 * @param method - HTTP method (currently only GET is used)
 * @param baseUrl - Base URL of the AgentRegistry (e.g. "http://localhost:8000")
 * @param path - API path (e.g. "/api/v1/agents")
 * @param apiKey - API Key for authentication via X-API-Key header
 * @param query - Optional query parameters
 * @returns Parsed JSON response body
 * @throws ClawHubProxyError on network error, timeout, or non-2xx response
 */
export async function proxyToRegistry(
  method: string,
  baseUrl: string,
  path: string,
  apiKey: string,
  query?: Record<string, string>,
  bodyObj?: unknown,
): Promise<unknown> {
  const url = buildUrl(baseUrl, path, query);
  const isHttps = url.protocol === "https:";
  const requestFn = isHttps ? httpsRequest : httpRequest;

  let bodyBuffer: Buffer | undefined;
  if (bodyObj !== undefined) {
    bodyBuffer = Buffer.from(JSON.stringify(bodyObj), "utf-8");
  }

  console.log(
    `[mas4s:proxy] proxyToRegistry call: method=${method} url=${url.toString()} apiKey=${apiKey}`,
  );
  console.log(
    `[mas4s:proxy] Egress env vars: HTTP_PROXY=${process.env.HTTP_PROXY || "undefined"}, HTTPS_PROXY=${process.env.HTTPS_PROXY || "undefined"}, NO_PROXY=${process.env.NO_PROXY || "undefined"}, ALL_PROXY=${process.env.ALL_PROXY || "undefined"}`,
  );

  return new Promise((resolve, reject) => {
    const startTime = Date.now();

    const headers: Record<string, string | number> = {
      "X-API-Key": apiKey,
      "Content-Type": "application/json",
    };
    if (bodyBuffer) {
      headers["Content-Length"] = bodyBuffer.length;
    }

    const req = requestFn(
      url,
      {
        method: method.toUpperCase(),
        headers,
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        const elapsed = Date.now() - startTime;
        console.log(
          `[mas4s:proxy] Response headers received: statusCode=${res.statusCode} elapsed=${elapsed}ms`,
        );

        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });

        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf-8");
          const statusCode = res.statusCode ?? 0;
          const totalElapsed = Date.now() - startTime;
          console.log(
            `[mas4s:proxy] Response fully received: statusCode=${statusCode} bodyLength=${body.length} totalElapsed=${totalElapsed}ms`,
          );

          if (statusCode === 401) {
            reject(
              new ClawHubProxyError(
                CLAWHUB_ERROR_CODES.INVALID_API_KEY,
                "API Key invalid or expired",
                statusCode,
              ),
            );
            return;
          }

          if (statusCode < 200 || statusCode >= 300) {
            reject(
              new ClawHubProxyError(
                CLAWHUB_ERROR_CODES.REGISTRY_ERROR,
                `AgentRegistry returned HTTP ${statusCode}: ${body.slice(0, 200)}`,
                statusCode,
              ),
            );
            return;
          }

          try {
            const parsed: unknown = JSON.parse(body);
            resolve(parsed);
          } catch {
            reject(
              new ClawHubProxyError(
                CLAWHUB_ERROR_CODES.REGISTRY_ERROR,
                "Failed to parse AgentRegistry response as JSON",
                statusCode,
              ),
            );
          }
        });

        res.on("error", (err) => {
          console.error(`[mas4s:proxy] Egress stream error:`, err);
          reject(
            new ClawHubProxyError(
              CLAWHUB_ERROR_CODES.SERVICE_UNREACHABLE,
              `AgentRegistry response error: ${err.message}`,
            ),
          );
        });
      },
    );

    req.on("socket", (socket) => {
      console.log(`[mas4s:proxy] Socket assigned to request`);
      socket.on("connect", () => {
        const elapsed = Date.now() - startTime;
        console.log(`[mas4s:proxy] TCP connection established: elapsed=${elapsed}ms`);
      });
      socket.on("lookup", (err, address, _family, host) => {
        console.log(
          `[mas4s:proxy] DNS lookup: host=${host} address=${address} err=${String(err || "none")}`,
        );
      });
    });

    req.on("timeout", () => {
      const elapsed = Date.now() - startTime;
      console.error(`[mas4s:proxy] Request TIMEOUT (10s) triggered: elapsed=${elapsed}ms`);
      req.destroy();
      reject(
        new ClawHubProxyError(CLAWHUB_ERROR_CODES.TIMEOUT, "AgentRegistry request timed out (10s)"),
      );
    });

    req.on("error", (err) => {
      const elapsed = Date.now() - startTime;
      console.error(`[mas4s:proxy] Request error triggered: elapsed=${elapsed}ms`, err);
      // Distinguish timeout-induced destroy from network errors
      if ((err as NodeJS.ErrnoException).code === "ECONNABORTED") {
        reject(
          new ClawHubProxyError(
            CLAWHUB_ERROR_CODES.TIMEOUT,
            "AgentRegistry request timed out (10s)",
          ),
        );
      } else {
        reject(
          new ClawHubProxyError(
            CLAWHUB_ERROR_CODES.SERVICE_UNREACHABLE,
            `AgentRegistry unreachable: ${err.message}`,
          ),
        );
      }
    });

    if (bodyBuffer) {
      req.write(bodyBuffer);
    }
    req.end();
  });
}

/**
 * Build a URL from base, path, and optional query params.
 */
function buildUrl(baseUrl: string, path: string, query?: Record<string, string>): URL {
  // Ensure baseUrl doesn't have trailing slash and path starts with /
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  const url = new URL(`${normalizedBase}${normalizedPath}`);

  if (query) {
    for (const [key, value] of Object.entries(query)) {
      url.searchParams.set(key, value);
    }
  }

  return url;
}

/**
 * Proxy a multipart/form-data upload request to the AgentRegistry.
 */
export async function proxyMultipartToRegistry(
  method: string,
  baseUrl: string,
  path: string,
  apiKey: string,
  fields: Record<string, string>,
  filePath: string,
  fileFieldName: string,
): Promise<unknown> {
  const url = buildUrl(baseUrl, path);
  const isHttps = url.protocol === "https:";
  const requestFn = isHttps ? httpsRequest : httpRequest;

  const boundary = "----NodeFormBoundary" + Math.random().toString(36).substring(2);

  // 1. Build text fields buffer
  let fieldsStr = "";
  for (const [key, value] of Object.entries(fields)) {
    fieldsStr += `--${boundary}\r\n`;
    fieldsStr += `Content-Disposition: form-data; name="${key}"\r\n\r\n`;
    fieldsStr += `${value}\r\n`;
  }
  const fieldsBuffer = Buffer.from(fieldsStr, "utf-8");

  // 2. Build file header buffer
  const fileName = basename(filePath);
  let fileHeaderStr = `--${boundary}\r\n`;
  fileHeaderStr += `Content-Disposition: form-data; name="${fileFieldName}"; filename="${fileName}"\r\n`;
  fileHeaderStr += `Content-Type: application/zip\r\n\r\n`;
  const fileHeaderBuffer = Buffer.from(fileHeaderStr, "utf-8");

  // 3. Build footer buffer
  const footerBuffer = Buffer.from(`\r\n--${boundary}--\r\n`, "utf-8");

  // 4. Get file size
  let fileSize = 0;
  try {
    const fileStats = statSync(filePath);
    fileSize = fileStats.size;
  } catch (err: any) {
    throw new Error(`Failed to stat file ${filePath}: ${err.message}`);
  }

  const totalLength =
    fieldsBuffer.length + fileHeaderBuffer.length + fileSize + footerBuffer.length;

  console.log(
    `[mas4s:proxy] proxyMultipartToRegistry call: method=${method} url=${url.toString()} totalLength=${totalLength}`,
  );

  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const req = requestFn(
      url,
      {
        method: method.toUpperCase(),
        headers: {
          "X-API-Key": apiKey,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": totalLength,
        },
        timeout: 60_000, // Large uploads might take longer, let's use 60s
      },
      (res) => {
        const chunks: Buffer[] = [];

        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });

        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf-8");
          const statusCode = res.statusCode ?? 0;
          const totalElapsed = Date.now() - startTime;
          console.log(
            `[mas4s:proxy] Multipart response received: statusCode=${statusCode} totalElapsed=${totalElapsed}ms`,
          );

          if (statusCode === 401) {
            reject(
              new ClawHubProxyError(
                CLAWHUB_ERROR_CODES.INVALID_API_KEY,
                "API Key invalid or expired",
                statusCode,
              ),
            );
            return;
          }

          if (statusCode < 200 || statusCode >= 300) {
            reject(
              new ClawHubProxyError(
                CLAWHUB_ERROR_CODES.REGISTRY_ERROR,
                `AgentRegistry returned HTTP ${statusCode}: ${body.slice(0, 200)}`,
                statusCode,
              ),
            );
            return;
          }

          try {
            const parsed: unknown = JSON.parse(body);
            resolve(parsed);
          } catch {
            reject(
              new ClawHubProxyError(
                CLAWHUB_ERROR_CODES.REGISTRY_ERROR,
                "Failed to parse AgentRegistry response as JSON",
                statusCode,
              ),
            );
          }
        });

        res.on("error", (err) => {
          reject(
            new ClawHubProxyError(
              CLAWHUB_ERROR_CODES.SERVICE_UNREACHABLE,
              `AgentRegistry response error: ${err.message}`,
            ),
          );
        });
      },
    );

    req.on("timeout", () => {
      req.destroy();
      reject(
        new ClawHubProxyError(
          CLAWHUB_ERROR_CODES.TIMEOUT,
          "AgentRegistry upload request timed out (60s)",
        ),
      );
    });

    req.on("error", (err) => {
      if ((err as NodeJS.ErrnoException).code === "ECONNABORTED") {
        reject(
          new ClawHubProxyError(
            CLAWHUB_ERROR_CODES.TIMEOUT,
            "AgentRegistry upload request timed out (60s)",
          ),
        );
      } else {
        reject(
          new ClawHubProxyError(
            CLAWHUB_ERROR_CODES.SERVICE_UNREACHABLE,
            `AgentRegistry unreachable: ${err.message}`,
          ),
        );
      }
    });

    // Write fields & headers
    req.write(fieldsBuffer);
    req.write(fileHeaderBuffer);

    // Stream the file
    const fileStream = createReadStream(filePath);
    fileStream.on("error", (err) => {
      req.destroy(err);
      reject(err);
    });
    fileStream.pipe(req, { end: false });
    fileStream.on("end", () => {
      req.write(footerBuffer);
      req.end();
    });
  });
}
