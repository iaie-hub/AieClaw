import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { describe, it, expect, afterEach } from "vitest";
import { proxyToRegistry, ClawHubProxyError, CLAWHUB_ERROR_CODES } from "./clawhub-proxy.js";

function createTestServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ server: Server; baseUrl: string }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}` });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

describe("clawhub-proxy", () => {
  let server: Server | undefined;

  afterEach(async () => {
    if (server) {
      await closeServer(server);
      server = undefined;
    }
  });

  it("sends GET request with X-API-Key header and returns parsed JSON", async () => {
    let receivedHeaders: Record<string, string | string[] | undefined> = {};
    let receivedUrl = "";
    let receivedMethod = "";

    const setup = await createTestServer((req, res) => {
      receivedHeaders = req.headers;
      receivedUrl = req.url ?? "";
      receivedMethod = req.method ?? "";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ agents: [], total: 0 }));
    });
    server = setup.server;

    const result = await proxyToRegistry("GET", setup.baseUrl, "/api/v1/agents", "api-ar-test123");

    expect(receivedMethod).toBe("GET");
    expect(receivedUrl).toBe("/api/v1/agents");
    expect(receivedHeaders["x-api-key"]).toBe("api-ar-test123");
    expect(receivedHeaders["content-type"]).toBe("application/json");
    expect(result).toEqual({ agents: [], total: 0 });
  });

  it("appends query parameters to the URL", async () => {
    let receivedUrl = "";

    const setup = await createTestServer((req, res) => {
      receivedUrl = req.url ?? "";
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    server = setup.server;

    await proxyToRegistry("GET", setup.baseUrl, "/api/v1/agents", "api-ar-key", {
      page: "2",
      page_size: "20",
    });

    expect(receivedUrl).toContain("page=2");
    expect(receivedUrl).toContain("page_size=20");
  });

  it("throws INVALID_API_KEY on 401 response", async () => {
    const setup = await createTestServer((_req, res) => {
      res.writeHead(401, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Unauthorized" }));
    });
    server = setup.server;

    await expect(
      proxyToRegistry("GET", setup.baseUrl, "/api/v1/healthy", "bad-key"),
    ).rejects.toMatchObject({
      code: CLAWHUB_ERROR_CODES.INVALID_API_KEY,
      statusCode: 401,
    });
  });

  it("throws REGISTRY_ERROR on non-2xx response (e.g. 500)", async () => {
    const setup = await createTestServer((_req, res) => {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal Server Error" }));
    });
    server = setup.server;

    await expect(
      proxyToRegistry("GET", setup.baseUrl, "/api/v1/agents", "api-ar-key"),
    ).rejects.toMatchObject({
      code: CLAWHUB_ERROR_CODES.REGISTRY_ERROR,
      statusCode: 500,
    });
  });

  it("throws REGISTRY_ERROR when response is not valid JSON", async () => {
    const setup = await createTestServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("not json");
    });
    server = setup.server;

    await expect(
      proxyToRegistry("GET", setup.baseUrl, "/api/v1/agents", "api-ar-key"),
    ).rejects.toMatchObject({
      code: CLAWHUB_ERROR_CODES.REGISTRY_ERROR,
    });
  });

  it("throws SERVICE_UNREACHABLE on connection refused", async () => {
    // Use a port that is almost certainly not listening
    await expect(
      proxyToRegistry("GET", "http://127.0.0.1:1", "/api/v1/agents", "api-ar-key"),
    ).rejects.toMatchObject({
      code: CLAWHUB_ERROR_CODES.SERVICE_UNREACHABLE,
    });
  });

  it("throws TIMEOUT when server does not respond within 10s", async () => {
    const setup = await createTestServer((_req, _res) => {
      // Never respond — let the timeout fire
    });
    server = setup.server;

    await expect(
      proxyToRegistry("GET", setup.baseUrl, "/api/v1/agents", "api-ar-key"),
    ).rejects.toMatchObject({
      code: CLAWHUB_ERROR_CODES.TIMEOUT,
    });
  }, 15_000);

  it("ClawHubProxyError has correct name and properties", () => {
    const err = new ClawHubProxyError(CLAWHUB_ERROR_CODES.REGISTRY_ERROR, "test error", 503);
    expect(err.name).toBe("ClawHubProxyError");
    expect(err.code).toBe("REGISTRY_ERROR");
    expect(err.message).toBe("test error");
    expect(err.statusCode).toBe(503);
    expect(err).toBeInstanceOf(Error);
  });

  it("CLAWHUB_ERROR_CODES exports all expected codes", () => {
    expect(CLAWHUB_ERROR_CODES.SERVICE_UNREACHABLE).toBe("SERVICE_UNREACHABLE");
    expect(CLAWHUB_ERROR_CODES.INVALID_API_KEY).toBe("INVALID_API_KEY");
    expect(CLAWHUB_ERROR_CODES.API_KEY_NOT_CONFIGURED).toBe("API_KEY_NOT_CONFIGURED");
    expect(CLAWHUB_ERROR_CODES.REGISTRY_ERROR).toBe("REGISTRY_ERROR");
    expect(CLAWHUB_ERROR_CODES.TIMEOUT).toBe("TIMEOUT");
  });
});
