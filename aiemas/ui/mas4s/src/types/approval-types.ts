/**
 * exec.approval.requested 广播 payload（与 gateway exec-approval.ts broadcast 字段一一对应）。
 * 不修改 gateway 任何文件，此类型仅在 mas4s 前端内部使用。
 */
export interface ApprovalRequest {
  id: string;
  request: {
    command: string;
    commandPreview?: string;
    commandArgv?: string[];
    envKeys?: string[];
    systemRunBinding?: unknown;
    systemRunPlan?: unknown;
    cwd: string | null;
    nodeId: string | null;
    host: string | null;
    security: string | null;
    ask: string | null;
    agentId: string | null;
    resolvedPath: string | null;
    sessionKey: string | null;
    turnSourceChannel: string | null;
    turnSourceTo: string | null;
    turnSourceAccountId: string | null;
    turnSourceThreadId: string | number | null;
  };
  createdAtMs: number;
  expiresAtMs: number;
}

/** exec.approval.resolved 广播 payload */
export interface ApprovalResolved {
  id: string;
  /** "allow-once" | "allow-always" | "deny" */
  decision: string;
  resolvedBy?: string | null;
  ts: number;
  request?: ApprovalRequest["request"];
}
