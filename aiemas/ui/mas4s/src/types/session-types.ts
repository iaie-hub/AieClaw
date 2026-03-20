import type { GatewaySessionRow, SessionRunStatus } from "../lib/types.js";

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
