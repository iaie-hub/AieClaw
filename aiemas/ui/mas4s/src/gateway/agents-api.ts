import type { GatewayBrowserClient } from "../lib/gateway.js";
import type {
  AgentsListPayload,
  AgentFilesPayload,
  AgentFileGetPayload,
  AgentFileSetPayload,
  AgentToolsPayload,
  AgentSkillsPayload,
  AgentChannelsPayload,
  AgentCronStatusPayload,
  AgentCronListPayload,
} from "../types/agents-types.js";

/**
 * 通过 Gateway API 获取智能体列表。
 * 调用 agents.list 方法，超时 10 秒。
 */
export async function fetchAgents(client: GatewayBrowserClient): Promise<AgentsListPayload> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("请求超时，请稍后重试")), 10_000);
  });

  try {
    const result = await Promise.race([
      client.request<AgentsListPayload>("agents.list", {}),
      timeout,
    ]);
    return result;
  } catch (error: unknown) {
    if (error && typeof error === "object") {
      const err = error as { gatewayCode?: string; code?: string; message?: string };
      if (err.gatewayCode === "DISCONNECTED" || err.code === "DISCONNECTED") {
        throw new Error("连接已断开，请检查网络", { cause: error });
      }
      if (err.message) {
        throw new Error(err.message, { cause: error });
      }
    }
    throw new Error("获取智能体列表失败", { cause: error });
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

/** 获取智能体文件列表 */
export async function fetchAgentFiles(
  client: GatewayBrowserClient,
  agentId: string,
): Promise<AgentFilesPayload> {
  return client.request<AgentFilesPayload>("agents.files.list", { agentId });
}

/** 获取智能体单个文件内容 */
export async function fetchAgentFileContent(
  client: GatewayBrowserClient,
  agentId: string,
  name: string,
): Promise<AgentFileGetPayload> {
  return client.request<AgentFileGetPayload>("agents.files.get", { agentId, name });
}

/** 保存智能体文件内容 */
export async function saveAgentFile(
  client: GatewayBrowserClient,
  agentId: string,
  name: string,
  content: string,
): Promise<AgentFileSetPayload> {
  return client.request<AgentFileSetPayload>("agents.files.set", { agentId, name, content });
}

/** 获取智能体工具目录 */
export async function fetchAgentTools(
  client: GatewayBrowserClient,
  agentId: string,
): Promise<AgentToolsPayload> {
  return client.request<AgentToolsPayload>("tools.catalog", { agentId, includePlugins: true });
}

/** 获取智能体技能状态 */
export async function fetchAgentSkills(
  client: GatewayBrowserClient,
  agentId: string,
): Promise<AgentSkillsPayload> {
  return client.request<AgentSkillsPayload>("skills.status", { agentId });
}

/** 获取频道状态 */
export async function fetchChannelsStatus(
  client: GatewayBrowserClient,
): Promise<AgentChannelsPayload> {
  return client.request<AgentChannelsPayload>("channels.status", { probe: false, timeoutMs: 8000 });
}

/** 获取定时任务状态 */
export async function fetchCronStatus(
  client: GatewayBrowserClient,
): Promise<AgentCronStatusPayload> {
  return client.request<AgentCronStatusPayload>("cron.status", {});
}

/** 获取定时任务列表 */
export async function fetchCronList(client: GatewayBrowserClient): Promise<AgentCronListPayload> {
  return client.request<AgentCronListPayload>("cron.list", {
    includeDisabled: true,
    limit: 50,
    offset: 0,
    enabled: "all",
    sortBy: "nextRunAtMs",
    sortDir: "asc",
  });
}
