import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { initDatabase } from "../store/database.js";
import { saveAgentRegistryConfig } from "../store/agent-registry-config.js";
import { saveNatsConfig } from "../store/nats-config.js";
import { registerClawHubHandlers } from "./clawhub-handlers.js";
import type { SimpleHandlers } from "./aiemas-utils.js";

// ── Test helpers ──

function createTestServer(
  handler: (req: IncomingMessage, res: ServerResponse) => void,
): Promise<{ server: Server; baseUrl: string; port: number }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({ server, baseUrl: `http://127.0.0.1:${addr.port}`, port: addr.port });
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

const tempPaths: string[] = [];

function tmpDbPath(): string {
  const dir = join(tmpdir(), `mas4s-clawhub-handlers-${randomUUID()}`);
  const p = join(dir, "mas4s.db");
  tempPaths.push(dir);
  return p;
}

/** Invoke a handler and capture the respond() call */
async function callHandler(
  handlers: SimpleHandlers,
  method: string,
  params: Record<string, unknown> = {},
): Promise<{ ok: boolean; payload: unknown; error: unknown }> {
  const handler = handlers[method];
  if (!handler) throw new Error(`Handler "${method}" not registered`);

  return new Promise((resolve) => {
    handler({
      params,
      client: {},
      respond: (ok, payload, error) => {
        resolve({ ok, payload, error });
      },
    });
  });
}

describe("clawhub-handlers", () => {
  let db: DatabaseSync;
  let handlers: SimpleHandlers;
  let server: Server | undefined;
  const originalEnv = process.env.AGENT_REGISTRY_URL;

  beforeEach(() => {
    const dbPath = tmpDbPath();
    db = initDatabase(dbPath);
    handlers = {};
    registerClawHubHandlers(handlers, { db });
  });

  afterEach(async () => {
    // Restore env
    if (originalEnv === undefined) {
      delete process.env.AGENT_REGISTRY_URL;
    } else {
      process.env.AGENT_REGISTRY_URL = originalEnv;
    }

    if (server) {
      await closeServer(server);
      server = undefined;
    }
    try {
      db.close();
    } catch {
      // ignore
    }
    for (const p of tempPaths.splice(0)) {
      try {
        rmSync(p, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  });

  describe("handler registration", () => {
    it("registers all six handlers", () => {
      expect(handlers["aiemas.clawhub.config.get"]).toBeDefined();
      expect(handlers["aiemas.clawhub.config.save"]).toBeDefined();
      expect(handlers["aiemas.clawhub.registry-config.get"]).toBeDefined();
      expect(handlers["aiemas.clawhub.registry-config.save"]).toBeDefined();
      expect(handlers["aiemas.clawhub.nats-config.get"]).toBeDefined();
      expect(handlers["aiemas.clawhub.nats-config.save"]).toBeDefined();
      expect(handlers["aiemas.clawhub.agents.list"]).toBeDefined();
      expect(handlers["aiemas.clawhub.healthy"]).toBeDefined();
    });
  });

  describe("aiemas.clawhub.registry-config.get", () => {
    it("returns config with null fields when empty", async () => {
      const { ok, payload } = await callHandler(handlers, "aiemas.clawhub.registry-config.get");
      expect(ok).toBe(true);
      const p = payload as Record<string, unknown>;
      expect(p.apiKey).toBeNull();
      expect(p.registryUrl).toBeNull();
    });

    it("masks API key showing first 10 chars + ****", async () => {
      const fullKey = "api-ar-" + "x".repeat(57); // 64 chars total
      saveAgentRegistryConfig(db, { apiKey: fullKey, registryUrl: "http://localhost:8000" });

      const { ok, payload } = await callHandler(handlers, "aiemas.clawhub.registry-config.get");
      expect(ok).toBe(true);
      const p = payload as Record<string, unknown>;
      expect(p.apiKey).toBe("api-ar-xxx****");
      expect(p.registryUrl).toBe("http://localhost:8000");
    });
  });

  describe("aiemas.clawhub.registry-config.save", () => {
    it("saves config without apiKey validation if apiKey is not provided", async () => {
      const { ok, payload } = await callHandler(handlers, "aiemas.clawhub.registry-config.save", {
        registryUrl: "http://myregistry:8000",
      });
      expect(ok).toBe(true);
      expect((payload as Record<string, unknown>).ok).toBe(true);

      const { payload: getPayload } = await callHandler(handlers, "aiemas.clawhub.registry-config.get");
      const p = getPayload as Record<string, unknown>;
      expect(p.registryUrl).toBe("http://myregistry:8000");
    });

    it("validates apiKey via healthy endpoint before saving", async () => {
      const setup = await createTestServer((req, res) => {
        if (req.url === "/api/v1/healthy" && req.headers["x-api-key"] === "api-ar-valid-key") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true, status: "healthy" }));
        } else {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "Unauthorized" }));
        }
      });
      server = setup.server;

      const { ok, payload } = await callHandler(handlers, "aiemas.clawhub.registry-config.save", {
        apiKey: "api-ar-valid-key",
        registryUrl: setup.baseUrl,
      });
      expect(ok).toBe(true);
      expect((payload as Record<string, unknown>).ok).toBe(true);
    });
  });

  describe("aiemas.clawhub.nats-config.get & save", () => {
    it("gets and saves nats configuration fields", async () => {
      const { ok: saveOk } = await callHandler(handlers, "aiemas.clawhub.nats-config.save", {
        natsUrl: "nats://myhost:4222",
        natsToken: "token123",
        agentId: "agent-abc",
        agentName: "Nats Agent",
        boundAgentId: "bound-xyz",
      });
      expect(saveOk).toBe(true);

      const { ok: getOk, payload } = await callHandler(handlers, "aiemas.clawhub.nats-config.get");
      expect(getOk).toBe(true);
      const p = payload as Record<string, unknown>;
      expect(p.natsUrl).toBe("nats://myhost:4222");
      expect(p.natsToken).toBe("token123");
      expect(p.agentId).toBe("agent-abc");
      expect(p.agentName).toBe("Nats Agent");
      expect(p.boundAgentId).toBe("bound-xyz");
    });
  });

  describe("legacy aiemas.clawhub.config compatibility", () => {
    it("combines registry and nats fields in config.get", async () => {
      saveAgentRegistryConfig(db, { apiKey: "api-ar-" + "x".repeat(57), registryUrl: "http://registry:8000" });
      saveNatsConfig(db, { natsUrl: "nats://localhost:4222", agentName: "Legacy Agent" });

      const { ok, payload } = await callHandler(handlers, "aiemas.clawhub.config.get");
      expect(ok).toBe(true);
      const p = payload as Record<string, unknown>;
      expect(p.apiKey).toBe("api-ar-xxx****");
      expect(p.registryUrl).toBe("http://registry:8000");
      expect(p.natsUrl).toBe("nats://localhost:4222");
      expect(p.agentName).toBe("Legacy Agent");
    });

    it("splits fields to their respective tables in config.save", async () => {
      const { ok } = await callHandler(handlers, "aiemas.clawhub.config.save", {
        registryUrl: "http://compat:8000",
        natsUrl: "nats://compat:4222",
      });
      expect(ok).toBe(true);

      const { payload: regPayload } = await callHandler(handlers, "aiemas.clawhub.registry-config.get");
      expect((regPayload as any).registryUrl).toBe("http://compat:8000");

      const { payload: natsPayload } = await callHandler(handlers, "aiemas.clawhub.nats-config.get");
      expect((natsPayload as any).natsUrl).toBe("nats://compat:4222");
    });
  });

  describe("aiemas.clawhub.agents.list", () => {
    it("returns error when API key is not configured", async () => {
      const { ok, error } = await callHandler(handlers, "aiemas.clawhub.agents.list", {
        page: 1,
        pageSize: 20,
      });
      expect(ok).toBe(false);
      const e = error as Record<string, unknown>;
      expect(e.code).toBe("API_KEY_NOT_CONFIGURED");
    });

    it("proxies request to registry with correct query params", async () => {
      let receivedUrl = "";
      let receivedApiKey = "";

      const setup = await createTestServer((req, res) => {
        receivedUrl = req.url ?? "";
        receivedApiKey = (req.headers["x-api-key"] as string) ?? "";
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ agents: [{ card: { agent_id: "a1" } }], total: 1, page: 2, page_size: 10 }));
      });
      server = setup.server;

      const apiKey = "api-ar-" + "k".repeat(57);
      saveAgentRegistryConfig(db, { apiKey, registryUrl: setup.baseUrl });

      const { ok, payload } = await callHandler(handlers, "aiemas.clawhub.agents.list", {
        page: 2,
        pageSize: 10,
      });

      expect(ok).toBe(true);
      expect(receivedUrl).toContain("page=2");
      expect(receivedUrl).toContain("page_size=10");
      expect(receivedApiKey).toBe(apiKey);
      expect((payload as Record<string, unknown>).total).toBe(1);
    });
  });
});
