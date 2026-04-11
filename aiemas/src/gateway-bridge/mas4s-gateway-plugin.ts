import { TenantServiceError } from "../errors.js";
import type { TenantService, TenantServiceConfig } from "../index.js";
import { createTenantService } from "../index.js";
import { deleteSummary, deleteSessionMessages } from "../session-history/session-summary-store.js";
import { createAiemasSessionsStore } from "../store/aiemas-sessions-store.js";
import type { SimpleHandlers } from "./aiemas-utils.js";
import { errorShape } from "./aiemas-utils.js";
import { GatewayAuthBridge } from "./bridge.js";
import { extractMasTokenFromUrl } from "./integration.js";

/**
 * Callback to dispatch an internal gateway request.
 * Set by the integration layer after plugin creation.
 * Returns the response payload on success, throws on failure.
 */
export type GatewayDispatchFn = (
  method: string,
  params: Record<string, unknown>,
  client: unknown,
) => Promise<unknown>;

export interface Mas4sGatewayPlugin {
  bridge: GatewayAuthBridge;
  tenantService: TenantService;
  extraHandlers: SimpleHandlers;
  extractMasTokenFromUrl: typeof extractMasTokenFromUrl;
  /** Set by integration layer to enable internal gateway calls (e.g. chat.history). */
  gatewayDispatch: GatewayDispatchFn | null;
  /** Session transcript store for capturing messages. */
  transcriptStore: import("../session-history/session-transcript-store.js").SessionTranscriptStore;
  /** Stop the session label lifecycle event subscription. */
  stopLabelSync: () => void;
  /** Persist a minimal SOP snapshot for reconnect recovery. */
  upsertRunState: (
    sessionUuid: string,
    patch: {
      runId?: string;
      sopSnapshot?: import("./run-state-store.js").SOPSnapshot;
      isChatting?: boolean;
    },
  ) => void;
  /** Clear run state for a session (on reset/delete/clear). */
  clearRunState: (sessionUuid: string) => void;
  /** SQLite database handle for direct DB operations. */
  db: import("node:sqlite").DatabaseSync;
  /** Load a full GatewaySessionRow (injected from core gateway). */
  loadGatewaySessionRow: (sessionKey: string) => unknown;
}

export async function createMas4sGatewayPlugin(
  config?: TenantServiceConfig,
): Promise<Mas4sGatewayPlugin> {
  const tenantService = createTenantService(config);
  await tenantService.init();

  const { initDatabase } = await import("../store/database.js");
  const { homedir } = await import("node:os");
  const { join } = await import("node:path");
  const dbPath = config?.dbPath ?? join(homedir(), ".openclaw", "aiemas", "mas4s.db");
  const db = initDatabase(dbPath);
  const sessionStore = createAiemasSessionsStore(db);

  // Log user count on startup for operational visibility
  const userCountRow = db.prepare("SELECT COUNT(*) AS count FROM users").get() as {
    count: number;
  };
  console.log(`[mas4s] Gateway started: ${userCountRow.count} user(s) in database`);

  // Reset stale SOP run states from the previous gateway session.
  const { resetAllRunStatesOnStartup } = await import("./run-state-store.js");
  const resetCount = resetAllRunStatesOnStartup(db);
  if (resetCount > 0) {
    console.log(`[mas4s] Reset ${resetCount} stale SOP run state(s) from previous gateway session`);
  }

  // Initialize message capture store in a separate DB for performance isolation
  const { initMessageDatabase } = await import("../store/database.js");
  const messageDbPath = config?.dbPath ? config.dbPath.replace(/\.db$/, ".message.db") : undefined;
  const messageDb = initMessageDatabase(messageDbPath);

  const { SessionTranscriptStore } = await import("../session-history/session-transcript-store.js");
  const transcriptStore = new SessionTranscriptStore(messageDb);
  transcriptStore.start();

  const bridge = new GatewayAuthBridge(tenantService, db, config?.llm, transcriptStore);

  // Subscribe to session lifecycle events to persist label into aiemas_sessions.
  const { onSessionLifecycleEvent } =
    await import("../../../src/sessions/session-lifecycle-events.js");
  const stopLabelSync = onSessionLifecycleEvent((event) => {
    try {
      if (event.reason === "session-delete") {
        const { extractUuidFromKey } = require("../utils/session-utils.js");
        const uuid = extractUuidFromKey(event.sessionKey);
        sessionStore.deleteSessionByUuid(uuid);
        deleteSummary(messageDb, uuid);
        deleteSessionMessages(messageDb, uuid);
        return;
      }
      const hasLabel = event.label !== undefined;
      const hasDisplayName = event.displayName !== undefined;
      if (!hasLabel && !hasDisplayName) {
        return;
      }
      sessionStore.upsertSessionLabel(event.sessionKey, {
        ...(hasLabel ? { label: event.label ?? null } : {}),
        ...(hasDisplayName && !hasLabel ? { label: event.displayName ?? null } : {}),
      });
    } catch (err) {
      console.error("[mas4s:label-sync] upsertSessionLabel error:", err);
    }
  });

  // ── Build extraHandlers by registering handler groups ──
  const extraHandlers: SimpleHandlers = {};

  // system.status stays here (trivial, no deps worth extracting)
  extraHandlers["system.status"] = async ({ respond }) => {
    try {
      const result = tenantService.getSystemStatus();
      respond(true, result, undefined);
    } catch (err) {
      const e =
        err instanceof TenantServiceError ? err : new TenantServiceError("INTERNAL", String(err));
      respond(false, undefined, errorShape(e.code, e.message));
    }
  };

  // Lazy plugin reference for handlers that need it (plugin is defined below)
  let _plugin: Mas4sGatewayPlugin;
  const getPlugin = () => _plugin;

  // Auth handlers (login, refresh, verify)
  const { registerAuthPluginHandlers } = await import("./handlers-auth.js");
  registerAuthPluginHandlers(extraHandlers, { tenantService });

  // User handlers (register, list, update, approve, reject, logout)
  const { registerUserHandlers } = await import("./handlers-user.js");
  registerUserHandlers(extraHandlers, { tenantService, bridge });

  // Session handlers (invite, members, leave, archive, summary, label, run.state, etc.)
  const { registerSessionHandlers } = await import("./handlers-session.js");
  registerSessionHandlers(extraHandlers, {
    bridge,
    tenantService,
    db,
    messageDb,
    transcriptStore,
    sessionStore,
    getPlugin,
  });

  // FS/file handlers (fs.list, files.download, file.upload, agents.preDelete, agents.export, agents.import)
  const { registerFsHandlers } = await import("./handlers-fs.js");
  registerFsHandlers(extraHandlers, { sessionStore, getPlugin });

  // AIEMAS sessions cascade handlers (sessions.create, sessions.delete, sessions.list)
  const { registerAiemasSessionsHandlers } = await import("./handlers-aiemas-sessions.js");
  registerAiemasSessionsHandlers(extraHandlers, { bridge, tenantService, db, getPlugin });

  // Agent/topology handlers (topology.list, topology.save, agents.import context wrapper)
  const { registerAgentHandlers } = await import("./aiemas-agent.js");
  registerAgentHandlers(extraHandlers, {
    plugin: undefined,
    db,
    cacheService: tenantService.cacheService,
    setCurrentRequestContext: () => {},
    clearRequestContext: () => {},
    getCallGateway: () => {
      if (!_plugin.gatewayDispatch) {
        return null;
      }
      const dispatch = _plugin.gatewayDispatch;
      return (method, callParams) => dispatch(method, callParams, null);
    },
    loadGatewaySessionRow: (sessionKey: string) => {
      if (!_plugin.loadGatewaySessionRow) {
        throw new Error("loadGatewaySessionRow not available");
      }
      return _plugin.loadGatewaySessionRow(sessionKey);
    },
    sessionCallbacks: {
      recordSessionCreated: (sessionKey, uid, tid) => {
        bridge.onSessionCreated(sessionKey, "", { userId: uid, tenantId: tid, masRole: null });
      },
      deleteSessionRecords: (sessionKey) => {
        bridge.onSessionDeleted(sessionKey);
      },
    },
  });

  const { upsertRunState: _upsertRunState, clearRunState: _clearRunState } =
    await import("./run-state-store.js");

  const plugin: Mas4sGatewayPlugin = {
    bridge,
    tenantService,
    extraHandlers,
    extractMasTokenFromUrl,
    gatewayDispatch: null,
    transcriptStore,
    stopLabelSync,
    upsertRunState: (sessionUuid, patch) => _upsertRunState(db, sessionUuid, patch),
    clearRunState: (sessionUuid) => _clearRunState(db, sessionUuid),
    loadGatewaySessionRow: (_sessionKey: string) => null,
    db,
  };

  // Wire up the lazy plugin reference for handlers
  _plugin = plugin;

  return plugin;
}
