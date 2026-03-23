/**
 * 从 openclaw ui/types.ts 内化的核心类型。
 * mas4s 只需要 session 相关类型，其余省略。
 */

export type SessionRunStatus = "running" | "done" | "failed" | "killed" | "timeout";

export type GatewaySessionRow = {
  key: string;
  spawnedBy?: string;
  kind: "direct" | "group" | "global" | "unknown";
  label?: string;
  displayName?: string;
  surface?: string;
  subject?: string;
  room?: string;
  space?: string;
  updatedAt: number | null;
  sessionId?: string;
  systemSent?: boolean;
  abortedLastRun?: boolean;
  thinkingLevel?: string;
  fastMode?: boolean;
  verboseLevel?: string;
  reasoningLevel?: string;
  elevatedLevel?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  status?: SessionRunStatus;
  startedAt?: number;
  endedAt?: number;
  runtimeMs?: number;
  childSessions?: string[];
  model?: string;
  modelProvider?: string;
  contextTokens?: number;
};
