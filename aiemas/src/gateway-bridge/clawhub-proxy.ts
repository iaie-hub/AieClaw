import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

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
): Promise<unknown> {
  const url = buildUrl(baseUrl, path, query);
  const isHttps = url.protocol === "https:";
  const requestFn = isHttps ? httpsRequest : httpRequest;

  console.log(`[mas4s:proxy] proxyToRegistry call: method=${method} url=${url.toString()} apiKey=${apiKey}`);
  console.log(`[mas4s:proxy] Egress env vars: HTTP_PROXY=${process.env.HTTP_PROXY || "undefined"}, HTTPS_PROXY=${process.env.HTTPS_PROXY || "undefined"}, NO_PROXY=${process.env.NO_PROXY || "undefined"}, ALL_PROXY=${process.env.ALL_PROXY || "undefined"}`);

  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const req = requestFn(
      url,
      {
        method: method.toUpperCase(),
        headers: {
          "X-API-Key": apiKey,
          "Content-Type": "application/json",
        },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = [];
        const elapsed = Date.now() - startTime;
        console.log(`[mas4s:proxy] Response headers received: statusCode=${res.statusCode} elapsed=${elapsed}ms`);

        res.on("data", (chunk: Buffer) => {
          chunks.push(chunk);
        });

        res.on("end", () => {
          const body = Buffer.concat(chunks).toString("utf-8");
          const statusCode = res.statusCode ?? 0;
          const totalElapsed = Date.now() - startTime;
          console.log(`[mas4s:proxy] Response fully received: statusCode=${statusCode} bodyLength=${body.length} totalElapsed=${totalElapsed}ms`);

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
      socket.on("lookup", (err, address, family, host) => {
        console.log(`[mas4s:proxy] DNS lookup: host=${host} address=${address} err=${String(err || "none")}`);
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
