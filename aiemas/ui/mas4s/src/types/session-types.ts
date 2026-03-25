import type { GatewaySessionRow, SessionRunStatus } from "../lib/types.js";

/** 会话摘要（与后端 SessionSummary 等价） */
export interface SessionSummary {
  sessionKey: string;
  textSummary: string | null;
  toolSummary: string | null;
  generatedAt: number;
  generatedBy: string;
}

/**
 * mas4s 会话 = GatewaySessionRow（kind:"group"）+ mas4s 专属扩展。
 * status 直接复用 GatewaySessionRow.status。
 */
export interface MasSession extends GatewaySessionRow {
  /** 发起者（initiated）vs 参与者（participated），决定审批按钮可见性 */
  masType: "initiated" | "participated";
  hasNotification: boolean;
  notificationCount: number;
  participants: MasParticipant[];
  /** 归档时间戳，NULL/undefined 表示未归档 */
  archivedAt?: number | null;
  /** 是否已有持久化摘要 */
  hasSummary?: boolean;
}

export interface MasParticipant {
  id: string;
  name: string;
  isInitiator: boolean;
}

/** 从 GatewaySessionRow.status 派生 UI Tag type */
export function resolveStatusType(
  status: SessionRunStatus | undefined,
): "danger" | "warning" | "success" | "info" {
  switch (status) {
    case "failed":
    case "killed":
      return "danger";
    case "timeout":
      return "warning";
    case "done":
      return "success";
    case "running":
    default:
      return "info";
  }
}
