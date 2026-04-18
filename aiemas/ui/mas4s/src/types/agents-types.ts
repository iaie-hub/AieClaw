/**
 * agents.list 响应中单个智能体的数据结构。
 */
export interface AgentEntry {
  id: string;
  name?: string;
  workspace: string;
  model: {
    primary: string;
    fallbacks: string[];
  };
}

/**
 * agents.list 响应 payload。
 */
export interface AgentsListPayload {
  defaultId: string;
  mainKey: string;
  scope: string;
  agents: AgentEntry[];
}

// ── Agent Detail Types ────────────────────────────────────────────────────────

/** agents.files.list 响应中的文件条目 */
export interface AgentFileEntry {
  name: string;
  path: string;
  missing: boolean;
  size?: number;
  updatedAtMs?: number;
  content?: string;
}

export interface AgentFilesPayload {
  agentId: string;
  workspace: string;
  files: AgentFileEntry[];
}

/** agents.files.get 响应 */
export interface AgentFileGetPayload {
  agentId: string;
  workspace: string;
  file: AgentFileEntry;
}

/** agents.files.set 响应 */
export interface AgentFileSetPayload {
  ok: true;
  agentId: string;
  workspace: string;
  file: AgentFileEntry;
}

/** tools.catalog 中的单个工具 */
export interface AgentToolEntry {
  id: string;
  label: string;
  description: string;
  source: string;
  defaultProfiles: string[];
}

/** tools.catalog 中的工具分组 */
export interface AgentToolGroup {
  id: string;
  label: string;
  source: string;
  tools: AgentToolEntry[];
}

export interface AgentToolsPayload {
  agentId: string;
  profiles: Array<{ id: string; label: string }>;
  groups: AgentToolGroup[];
}

/** skills.status 中的技能安装项 */
export interface AgentSkillInstall {
  id: string;
  kind: string;
  label: string;
  bins: string[];
}

/** skills.status 中的技能条目 */
export interface AgentSkillEntry {
  name: string;
  description: string;
  source: string;
  skillKey: string;
  emoji?: string;
  homepage?: string;
  disabled: boolean;
  eligible: boolean;
  always: boolean;
  bundled?: boolean;
  blockedByAllowlist: boolean;
  primaryEnv?: string;
  missing: {
    bins: string[];
    anyBins: string[];
    env: string[];
    config: string[];
    os: string[];
  };
  configChecks: Array<{ path: string; satisfied: boolean }>;
  install: AgentSkillInstall[];
}

export interface AgentSkillsPayload {
  workspaceDir: string;
  managedSkillsDir: string;
  skills: AgentSkillEntry[];
}

/** channels.status payload */
export interface AgentChannelsPayload {
  ts: number;
  channelOrder: string[];
  channelLabels: Record<string, string>;
  channels: Record<string, unknown>;
  channelMeta: unknown[];
}

/** cron.status payload */
export interface AgentCronStatusPayload {
  enabled: boolean;
  storePath: string;
  jobs: number;
  nextWakeAtMs: number | null;
}

/** cron.list 中的任务条目 */
export interface AgentCronJob {
  id: string;
  label?: string;
  schedule?: string;
  enabled: boolean;
  nextRunAtMs?: number | null;
}

export interface AgentCronListPayload {
  jobs: AgentCronJob[];
  total: number;
}

// ── Import / Export Types ─────────────────────────────────────────────────────

/** aiemas.fs.list 响应中的文件/目录条目 */
export interface WorkspaceEntry {
  name: string;
  type: "file" | "directory";
  size: number;
}

/** aiemas.fs.list 响应 */
export interface WorkspaceListPayload {
  entries: WorkspaceEntry[];
}

/** aiemas.agents.export 响应 */
export interface AgentExportPayload {
  archivePath: string;
}

/** aiemas.files.download 响应 */
export interface FileDownloadPayload {
  data: string;
  fileName: string;
  mimeType: string;
}

/** aiemas.file.upload 响应 */
export interface FileUploadPayload {
  filePath: string;
}
