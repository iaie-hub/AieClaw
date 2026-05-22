/**
 * Shared TypeScript interfaces and type aliases for the agent-registry channel plugin.
 *
 * All types are strict — no `any`. External-boundary payloads use `unknown`.
 */

// ---------------------------------------------------------------------------
// NATS transport layer
// ---------------------------------------------------------------------------

export interface NATSClientOptions {
  url: string;
  token?: string;
  onDisconnect: () => void;
  onReconnect: () => void;
}

export interface NATSSubscription {
  subject: string;
  unsubscribe(): void;
}

export interface NATSClient {
  connect(): Promise<void>;
  request(subject: string, payload: Uint8Array, timeoutMs: number): Promise<Uint8Array>;
  publish(subject: string, payload: Uint8Array): void;
  subscribe(subject: string, handler: (msg: Uint8Array) => void): NATSSubscription;
  unsubscribeAll(): Promise<void>;
  drain(timeoutMs: number): Promise<void>;
  close(): Promise<void>;
  /** Generate a unique temporary inbox subject for request-reply patterns. */
  newInbox(): string;
  readonly isConnected: boolean;
}

// ---------------------------------------------------------------------------
// Plugin configuration
// ---------------------------------------------------------------------------

export interface AgentRegistryConfig {
  /** AGENT_REGISTRY_NATS_URL */
  natsUrl: string;
  /** AGENT_REGISTRY_AGENT_ID */
  agentId: string;
  /** AGENT_REGISTRY_AGENT_NAME */
  agentName: string;
  /** AGENT_REGISTRY_NATS_TOKEN (optional) */
  natsToken?: string;
  /** AGENT_REGISTRY_SKILLS parsed, default [] */
  skills: string[];
  /** AGENT_REGISTRY_BOUND_AGENT_ID (optional) */
  boundAgentId?: string;
}

// ---------------------------------------------------------------------------
// Registry envelope (wire format)
// ---------------------------------------------------------------------------

export interface RegistryEnvelope {
  /** UUID v4 */
  message_id: string;
  /** UUID v4 — req: generated; res: copied from req */
  request_id: string;
  message_type: "req" | "res" | "event";
  /** Unix epoch ms, non-negative integer */
  timestamp: number;
  /** Sender agent_id; "registry" for Registry-originated messages */
  source: string;
  /** Sender's current session key; null if not in a session context */
  session: string | null;
  /** Non-negative integer, monotonically increasing per session */
  seq: number;
  /** e.g. "register", "heartbeat", "message", "join" */
  action: string;
  /** "agent" | "cowork" */
  resource_type: string;
  payload: Record<string, unknown>;
  /** Temporary inbox subject for request-reply; null otherwise */
  reply_to: string | null;
}

// ---------------------------------------------------------------------------
// AgentCard and related A2A types
// ---------------------------------------------------------------------------

export interface AgentCapabilities {
  streaming: boolean;
  pushNotifications: boolean;
  longRunningOperations: boolean;
  stateTransitionHistory: boolean;
}

export interface AgentSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
}

export interface AgentCard {
  // A2A standard fields
  name: string;
  description: string;
  /** "1.0.0" */
  version: string;
  /** "nats://a2a.agent.unicast.{agentId}" */
  url: string;
  capabilities: AgentCapabilities;
  skills: AgentSkill[];
  /** ["text/plain"] */
  defaultInputModes: string[];
  /** ["text/plain"] */
  defaultOutputModes: string[];
  securitySchemes?: Record<string, unknown>;
  authentication?: Record<string, unknown>;
  icon?: string;
  // Registry extension fields
  agent_id: string;
  /** Always "00:00:00:00:00:00" — never the host MAC */
  mac: string;
  transport: "mq";
  endpoint?: string;
  status: "online" | "idle" | "busy" | "offline";
}

// ---------------------------------------------------------------------------
// Topic assignment (returned by Registry on successful registration)
// ---------------------------------------------------------------------------

export interface TopicAssignment {
  /** "a2a.agent.unicast.{agentId}" */
  unicast: string;
  /** ["a2a.agent.group.{groupId}", ...] */
  multicast: string[];
  /** "a2a.agent.broadcast.all" */
  broadcast: string;
}

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

export interface HeartbeatPayload {
  agent_id: string;
  status: "online" | "idle" | "busy" | "offline";
  load: {
    /** Always 0 — not measured */
    cpu: number;
    /** Always 0 — not measured */
    memory: number;
    active_task_count: number;
  };
}

// ---------------------------------------------------------------------------
// Session context (discriminated union for outbound routing)
// ---------------------------------------------------------------------------

export type SessionContext =
  | { kind: "unicast"; sourceAgentId: string }
  | { kind: "multicast"; groupId: string }
  | { kind: "cowork"; coworkId: string; isComplete: boolean };

// ---------------------------------------------------------------------------
// Plugin status
// ---------------------------------------------------------------------------

export type PluginStatus =
  | "disabled"
  | "connecting"
  | "registering"
  | "registered"
  | "reconnecting"
  | "unavailable"
  | "disconnected";

// ---------------------------------------------------------------------------
// Registration result
// ---------------------------------------------------------------------------

export interface RegisterResult {
  ok: boolean;
  /** Effective agent_id assigned by the Registry (may differ from requested id when a suffix was applied). */
  agentId?: string;
  topics?: TopicAssignment;
  ttlMs?: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Installed skill (from OpenClaw Skill Registry)
// ---------------------------------------------------------------------------

export interface InstalledSkill {
  id: string;
  name: string;
  description: string;
  tags: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
}

// ---------------------------------------------------------------------------
// Agent session handle (plugin-internal abstraction over OpenClaw sessions)
// ---------------------------------------------------------------------------

/**
 * A handle to an active OpenClaw agent session.
 * Implementations are provided by channel.ts via the plugin SDK runtime.
 */
export interface AgentSession {
  /** Dispatch an inbound A2A message to this session. */
  dispatch(envelope: RegistryEnvelope): Promise<void>;
  /** Number of active tasks in this session (used for least-loaded selection). */
  readonly activeTaskCount: number;
}

// ---------------------------------------------------------------------------
// Manager option bags
// ---------------------------------------------------------------------------

export interface RegistrationManagerOptions {
  config: AgentRegistryConfig;
  natsClient: NATSClient;
  getInstalledSkills: () => Promise<InstalledSkill[]>;
  /**
   * Returns the description string to embed in the AgentCard.
   * Implementations should read the bound agent's AGENTS.md (falling back to
   * the default agent's AGENTS.md when no bound agent is configured).
   * Falls back to the agent name when the file is unavailable.
   */
  getAgentDescription?: () => Promise<string>;
}

export interface HeartbeatManagerOptions {
  /** Returns the effective agent_id (may change after registration assigns a suffix). */
  getAgentId: () => string;
  natsClient: NATSClient;
  getActiveSessionCount: () => number;
  /** Called when Registry is detected as offline (3 consecutive missed acks). */
  onRegistryOffline?: () => void;
  /** Called when Registry recovers (ack received after being offline). */
  onRegistryOnline?: () => void;
}

export interface MessageRouterOptions {
  boundAgentId: string;
  natsClient: NATSClient;
  arbiter: CollaborationArbiter;
  createSession: (sourceAgentId: string, agentId: string) => AgentSession;
  getOrCreateSession: (key: string, agentId: string) => AgentSession;
  getLeastLoadedSession: (agentId: string) => AgentSession;
  getEffectiveAgentId?: () => string;
}

export interface CollaborationArbiterOptions {
  boundAgentId: string;
  /** Returns the effective registry agent_id (may change after registration assigns a suffix). */
  getEffectiveAgentId: () => string;
  natsClient: NATSClient;
  createArbiterSession: (agentId: string) => AgentSession;
  configuredSkills: string[];
  /**
   * Returns a markdown-formatted capability context string built from the
   * bound agent's AGENTS.md and TOOLS.md workspace files.
   * Returns an empty string when the workspace is unavailable or files are missing.
   */
  getCapabilityContext: () => Promise<string>;
  /**
   * Returns the inbound message handler for a given collaboration topic.
   * Called when the arbiter decides to join a cowork; the
   * returned handler is used as the NATS subscription callback so that
   * incoming messages on the topic are routed through the MessageRouter.
   *
   * This MUST be provided by channel.ts by closing over the MessageRouter
   * reference (which is created after the arbiter, hence the callback pattern).
   */
  createCollaborationTopicHandler: (topic: string) => (bytes: Uint8Array) => void;
}

export interface OutboundAdapterOptions {
  /** Returns the effective agent_id (may change after registration assigns a suffix). */
  getAgentId: () => string;
  natsClient: NATSClient;
}

export interface OutboundSendParams {
  responseText: string;
  inboundEnvelope: RegistryEnvelope;
  sessionContext: SessionContext;
  sessionSeq: number;
  isSessionComplete: boolean;
  /** Sender's current session key, written into the outbound envelope's session field. */
  senderSessionKey?: string;
}

// ---------------------------------------------------------------------------
// Forward-declared interfaces (implemented in their respective modules)
// These are referenced by the option bags above and kept here to avoid cycles.
// ---------------------------------------------------------------------------

export interface CollaborationArbiter {
  initialize(): Promise<void>;
  processCoworkCreated(payload: Record<string, unknown>): Promise<void>;
  dispose(): void;
}
