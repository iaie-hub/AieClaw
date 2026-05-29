import type { GatewayBrowserClient } from "../lib/gateway.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RegistryAgent {
  registration_id?: string;
  card: {
    agent_id: string;
    name: string;
    description?: string;
    version?: string;
    url?: string;
    capabilities?: {
      streaming: boolean;
      pushNotifications: boolean;
      longRunningOperations: boolean;
      stateTransitionHistory: boolean;
    };
    skills?: Array<
      | string
      | {
          id: string;
          name: string;
          description?: string;
          tags?: string[];
          examples?: string[];
          inputModes?: string[];
          outputModes?: string[];
        }
    >;
    defaultInputModes?: string[];
    defaultOutputModes?: string[];
    icon?: string;
    mac?: string;
    ip?: string;
    transport?: "mq" | "http";
    endpoint?: string;
    status?: "online" | "idle" | "busy" | "offline";
  };
  topics?: {
    unicast: string;
    multicast: string[];
    broadcast: string;
  };
  group_ids?: string[];
  last_seen?: string;
  registered_at?: string;
  ttl?: number;
  permissions?: {
    allow_create_cowork: boolean;
  };
  status: "online" | "idle" | "busy" | "offline";
  load?: {
    cpu: number;
    memory: number;
    active_task_count: number;
  };
}

export interface AgentsListResponse {
  agents: RegistryAgent[];
  count: number;
  total: number;
  page: number;
  page_size: number;
}

export interface RegistryConfig {
  apiKey: string | null;
  natsUrl: string | null;
  natsToken: string | null;
  agentId: string | null;
  agentName: string | null;
  boundAgentId: string | null;
  registryUrl?: string | null;
}

export interface RegistrySettings {
  apiKey: string | null;
  registryUrl: string | null;
}

export interface NatsSettings {
  natsUrl: string | null;
  natsToken: string | null;
  agentId: string | null;
  agentName: string | null;
  boundAgentId: string | null;
}

// ── API Functions ─────────────────────────────────────────────────────────────

/** 获取远程 Agent 列表 */
export async function fetchRegistryAgents(
  client: GatewayBrowserClient,
  page: number,
  pageSize: number,
): Promise<AgentsListResponse> {
  return client.request<AgentsListResponse>("aiemas.clawhub.agents.list", { page, pageSize });
}

/** 获取配置 (Legacy) */
export async function fetchRegistryConfig(client: GatewayBrowserClient): Promise<RegistryConfig> {
  return client.request<RegistryConfig>("aiemas.clawhub.config.get");
}

/** 保存配置 (Legacy) */
export async function saveRegistryConfig(
  client: GatewayBrowserClient,
  config: Partial<RegistryConfig>,
): Promise<{ ok: boolean; error?: string }> {
  return client.request<{ ok: boolean; error?: string }>("aiemas.clawhub.config.save", config);
}

/** 获取 AgentRegistry 配置 */
export async function fetchRegistrySettings(
  client: GatewayBrowserClient,
): Promise<RegistrySettings> {
  return client.request<RegistrySettings>("aiemas.clawhub.registry-config.get");
}

/** 保存 AgentRegistry 配置 */
export async function saveRegistrySettings(
  client: GatewayBrowserClient,
  config: Partial<RegistrySettings>,
): Promise<{ ok: boolean; error?: string }> {
  return client.request<{ ok: boolean; error?: string }>(
    "aiemas.clawhub.registry-config.save",
    config,
  );
}

/** 获取 NATS 配置 */
export async function fetchNatsSettings(client: GatewayBrowserClient): Promise<NatsSettings> {
  return client.request<NatsSettings>("aiemas.clawhub.nats-config.get");
}

/** 保存 NATS 配置 */
export async function saveNatsSettings(
  client: GatewayBrowserClient,
  config: Partial<NatsSettings>,
): Promise<{ ok: boolean; error?: string }> {
  return client.request<{ ok: boolean; error?: string }>("aiemas.clawhub.nats-config.save", config);
}

/** 上传 Agent 到 AgentHub */
export async function uploadAgentToHub(
  client: GatewayBrowserClient,
  params: {
    agentId: string;
    workspace: string;
    items: string[];
    name: string;
    description: string;
  },
): Promise<{ success: boolean; agent?: unknown }> {
  return client.request("aiemas.clawhub.agent.upload", params);
}

export interface HubAgent {
  id: string;
  name: string;
  description?: string;
  file_path: string;
  file_size: number;
  visibility: "public" | "private";
  uploader_id: string;
  uploader_name: string;
  created_at: string;
  updated_at: string;
  can_manage?: boolean;
}

export interface HubAgentsListResponse {
  agents: HubAgent[];
  count: number;
  total: number;
  page: number;
  page_size: number;
}

/** 获取 AgentHub 包列表 */
export async function fetchHubAgents(
  client: GatewayBrowserClient,
  page: number,
  pageSize: number,
): Promise<HubAgentsListResponse> {
  return client.request<HubAgentsListResponse>("aiemas.clawhub.agenthub.list", { page, pageSize });
}

/** 更新 Agent 的可见性 */
export async function updateHubAgentVisibility(
  client: GatewayBrowserClient,
  agentId: string,
  visibility: "public" | "private",
): Promise<{ success: boolean; agent?: HubAgent }> {
  return client.request("aiemas.clawhub.agenthub.visibility.update", { agentId, visibility });
}

/** 下载 AgentHub 包 */
export async function downloadHubAgent(
  client: GatewayBrowserClient,
  agentId: string,
  filename: string,
): Promise<{ ok: boolean; downloadPath?: string }> {
  return client.request("aiemas.clawhub.agent.download", { agentId, filename });
}

export interface HubSkill {
  id: string;
  name: string;
  description?: string;
  file_path: string;
  file_size: number;
  visibility: "public" | "private";
  uploader_id: string;
  uploader_name: string;
  created_at: string;
  updated_at: string;
  can_manage?: boolean;
}

export interface HubSkillsListResponse {
  skills: HubSkill[];
  count: number;
  total: number;
  page: number;
  page_size: number;
}

/** 获取 SkillHub 包列表 */
export async function fetchHubSkills(
  client: GatewayBrowserClient,
  page: number,
  pageSize: number,
): Promise<HubSkillsListResponse> {
  return client.request<HubSkillsListResponse>("aiemas.clawhub.skillhub.list", { page, pageSize });
}

/** 更新 Skill 的可见性 */
export async function updateHubSkillVisibility(
  client: GatewayBrowserClient,
  skillId: string,
  visibility: "public" | "private",
): Promise<{ success: boolean; skill?: HubSkill }> {
  return client.request("aiemas.clawhub.skillhub.visibility.update", { skillId, visibility });
}

/** 下载 SkillHub 包 */
export async function downloadHubSkill(
  client: GatewayBrowserClient,
  skillId: string,
  filename: string,
): Promise<{ ok: boolean; downloadPath?: string }> {
  return client.request("aiemas.clawhub.skill.download", { skillId, filename });
}
