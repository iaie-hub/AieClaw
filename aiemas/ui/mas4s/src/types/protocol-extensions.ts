/**
 * 协议扩展类型（后续迭代预留）。
 * 第一期不使用，仅定义接口以指导后续迭代。
 * 原则：不修改 gateway 任何现有文件。
 */

/**
 * 第二期：Human-in-the-Loop 审批上下文（纯前端解析）。
 * 从 exec.approval.requested 的 request.ask 字段 JSON 解析得到。
 */
export interface MasApprovalContext {
  agentName?: string;
  proposalId?: string;
  /** 风险等级 */
  riskLevel?: "low" | "medium" | "high" | "critical";
}

/** 尝试从 request.ask 字段解析 MasApprovalContext（容错，解析失败返回 null） */
export function tryParseMasApprovalContext(
  ask: string | null | undefined,
): MasApprovalContext | null {
  if (!ask) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(ask);
    if (parsed && typeof parsed === "object" && "riskLevel" in parsed) {
      return parsed as MasApprovalContext;
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * 第三期：个性化输出方案（通过 assistant 消息的结构化内容传递）。
 * Agent 在 chat 消息中以约定 JSON 格式输出方案，前端解析渲染。
 */
export interface MasProposal {
  id: string;
  sessionKey: string;
  title: string;
  summary: string;
  /** 方案正文（Markdown） */
  body: string;
  createdAtMs: number;
  status: "pending" | "accepted" | "rejected";
}

/** 第三期：方案 diff（纯前端计算） */
export interface MasProposalDiff {
  proposalId: string;
  baseProposalId: string;
  /** unified diff 格式字符串 */
  unifiedDiff: string;
  changedSections: string[];
}
