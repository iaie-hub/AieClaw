import { describe, expect, it } from "vitest";
import type { OpenClawConfig } from "../config/config.js";
import { buildStatusScanResult } from "./status.scan-result.ts";

describe("buildStatusScanResult", () => {
  it("builds the full shared scan result shape", () => {
    expect(
      buildStatusScanResult({
        cfg: { gateway: {} } as OpenClawConfig,
        sourceConfig: { gateway: {} } as OpenClawConfig,
        secretDiagnostics: ["diag"],
        osSummary: { platform: "linux", label: "linux" } as ReturnType<
          typeof import("../infra/os-summary.js").resolveOsSummary
        >,
        tailscaleMode: "serve",
        tailscaleDns: "box.tail.ts.net",
        tailscaleHttpsUrl: "https://box.tail.ts.net",
        update: {
          installKind: "package",
          root: null,
          packageManager: "unknown",
        } as import("../infra/update-check.js").UpdateCheckResult,
        gatewaySnapshot: {
          gatewayConnection: {
            url: "ws://127.0.0.1:18789",
            urlSource: "config",
            message: "Gateway target: ws://127.0.0.1:18789",
          },
          remoteUrlMissing: false,
          gatewayMode: "local",
          gatewayProbeAuth: { token: "tok" },
          gatewayProbeAuthWarning: "warn",
          gatewayProbe: { connectLatencyMs: 42, error: null } as never,
          gatewayReachable: true,
          gatewaySelf: { host: "gateway" } as never,
        },
        channelIssues: [
          { channel: "discord", accountId: "default", kind: "runtime", message: "warn" },
        ],
        agentStatus: { agents: [{ id: "main" }], defaultId: "main" } as never,
        channels: { rows: [], details: [] } as never,
        summary: {
          runtimeVersion: null,
          heartbeat: { defaultAgentId: "main", agents: [] },
          channelSummary: [],
          queuedSystemEvents: [],
          tasks: { total: 0, active: 0, failures: 0, byStatus: { queued: 0, running: 0 } },
          taskAudit: { errors: 0, warnings: 0 },
          sessions: {
            paths: [],
            count: 0,
            defaults: { model: null, contextTokens: null },
            recent: [],
            byAgent: [],
          },
        } as never,
        memory: { agentId: "main" } as never,
        memoryPlugin: { enabled: true, slot: "memory-core" },
        pluginCompatibility: [{ pluginId: "legacy", message: "warn" }] as never,
      }),
    ).toBeDefined();
  });
});
