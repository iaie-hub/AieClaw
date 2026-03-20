import type { IncomingMessage } from "node:http";

/**
 * Extract masToken from WS upgrade request URL query string.
 * Returns undefined if not present.
 */
export function extractMasTokenFromUrl(upgradeReq: IncomingMessage): string | undefined {
  try {
    const url = new URL(upgradeReq.url ?? "/", "http://localhost");
    return url.searchParams.get("masToken") ?? undefined;
  } catch {
    return undefined;
  }
}
