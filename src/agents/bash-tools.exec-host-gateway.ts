import type { AgentToolResult } from "@mariozechner/pi-agent-core";
import {
  addAllowlistEntry,
  type ExecAsk,
  type ExecSecurity,
  buildEnforcedShellCommand,
  evaluateShellAllowlist,
  recordAllowlistUse,
  resolveApprovalAuditCandidatePath,
  requiresExecApproval,
  resolveAllowAlwaysPatterns,
} from "../infra/exec-approvals.js";
import {
  describeInterpreterInlineEval,
  detectInterpreterInlineEvalArgv,
} from "../infra/exec-inline-eval.js";
import { detectCommandObfuscation } from "../infra/exec-obfuscation-detect.js";
import type { SafeBinProfile } from "../infra/exec-safe-bin-policy.js";
import { logInfo } from "../logger.js";
import {
  buildExecApprovalRequesterContext,
  buildExecApprovalTurnSourceContext,
  registerExecApprovalRequestForHostOrThrow,
} from "./bash-tools.exec-approval-request.js";
import {
  buildDefaultExecApprovalRequestArgs,
  buildExecApprovalPendingToolResult,
  createExecApprovalDecisionState,
  createAndRegisterDefaultExecApprovalRequest,
  resolveApprovalDecisionOrUndefined,
  resolveExecHostApprovalContext,
} from "./bash-tools.exec-host-shared.js";
import { createApprovalSlug } from "./bash-tools.exec-runtime.js";
import type { ExecToolDetails } from "./bash-tools.exec-types.js";

export type ProcessGatewayAllowlistParams = {
  command: string;
  workdir: string;
  env: Record<string, string>;
  requestedEnv?: Record<string, string>;
  pty: boolean;
  timeoutSec?: number;
  defaultTimeoutSec: number;
  security: ExecSecurity;
  ask: ExecAsk;
  safeBins: Set<string>;
  safeBinProfiles: Readonly<Record<string, SafeBinProfile>>;
  strictInlineEval?: boolean;
  agentId?: string;
  sessionKey?: string;
  /** The agent run ID that triggered this exec, used to detect followup-loop re-runs. */
  runId?: string;
  turnSourceChannel?: string;
  turnSourceTo?: string;
  turnSourceAccountId?: string;
  turnSourceThreadId?: string | number;
  scopeKey?: string;
  warnings: string[];
  notifySessionKey?: string;
  approvalRunningNoticeMs: number;
  maxOutput: number;
  pendingMaxOutput: number;
  trustedSafeBinDirs?: ReadonlySet<string>;
};

export type ProcessGatewayAllowlistResult = {
  execCommandOverride?: string;
  toolResult?: AgentToolResult<ExecToolDetails>;
};

export async function processGatewayAllowlist(
  params: ProcessGatewayAllowlistParams,
): Promise<ProcessGatewayAllowlistResult> {
  // Hard guard: exec-approval-followup turns must never trigger new exec commands.
  // The followup is a summary-only notification; if the agent calls exec anyway,
  // deny it immediately to break the approval loop.
  if (params.runId?.startsWith("exec-approval-followup:")) {
    console.warn(
      `[exec-host-gateway] BLOCKED exec in followup turn: runId=${params.runId}, command=${params.command}`,
    );
    throw new Error(
      "exec denied: tool calls are not allowed in exec-approval followup turns (summary-only).",
    );
  }

  const { approvals, hostSecurity, hostAsk, askFallback } = resolveExecHostApprovalContext({
    agentId: params.agentId,
    security: params.security,
    ask: params.ask,
    host: "gateway",
  });
  const allowlistEval = evaluateShellAllowlist({
    command: params.command,
    allowlist: approvals.allowlist,
    safeBins: params.safeBins,
    safeBinProfiles: params.safeBinProfiles,
    cwd: params.workdir,
    env: params.env,
    platform: process.platform,
    trustedSafeBinDirs: params.trustedSafeBinDirs,
  });
  const allowlistMatches = allowlistEval.allowlistMatches;
  const analysisOk = allowlistEval.analysisOk;
  const allowlistSatisfied =
    hostSecurity === "allowlist" && analysisOk ? allowlistEval.allowlistSatisfied : false;
  const inlineEvalHit =
    params.strictInlineEval === true
      ? (allowlistEval.segments
          .map((segment) =>
            detectInterpreterInlineEvalArgv(segment.resolution?.effectiveArgv ?? segment.argv),
          )
          .find((entry) => entry !== null) ?? null)
      : null;
  if (inlineEvalHit) {
    params.warnings.push(
      `Warning: strict inline-eval mode requires explicit approval for ${describeInterpreterInlineEval(
        inlineEvalHit,
      )}.`,
    );
  }
  let enforcedCommand: string | undefined;
  if (hostSecurity === "allowlist" && analysisOk && allowlistSatisfied) {
    const enforced = buildEnforcedShellCommand({
      command: params.command,
      segments: allowlistEval.segments,
      platform: process.platform,
    });
    if (!enforced.ok || !enforced.command) {
      throw new Error(`exec denied: allowlist execution plan unavailable (${enforced.reason})`);
    }
    enforcedCommand = enforced.command;
  }
  const isInternalManagementCommand =
    params.command.trim().startsWith("/approve ") || params.command.trim().startsWith("/deny ");
  const obfuscation = detectCommandObfuscation(params.command);
  if (obfuscation.detected && !isInternalManagementCommand) {
    logInfo(`exec: obfuscation detected (gateway): ${obfuscation.reasons.join(", ")}`);
    params.warnings.push(`⚠️ Obfuscated command detected: ${obfuscation.reasons.join("; ")}`);
  }
  const recordMatchedAllowlistUse = (resolvedPath?: string) => {
    if (allowlistMatches.length === 0) {
      return;
    }
    const seen = new Set<string>();
    for (const match of allowlistMatches) {
      if (seen.has(match.pattern)) {
        continue;
      }
      seen.add(match.pattern);
      recordAllowlistUse(approvals.file, params.agentId, match, params.command, resolvedPath);
    }
  };
  const hasHeredocSegment = allowlistEval.segments.some((segment) =>
    segment.argv.some((token) => token.startsWith("<<")),
  );
  const requiresHeredocApproval =
    hostSecurity === "allowlist" && analysisOk && allowlistSatisfied && hasHeredocSegment;
  const requiresInlineEvalApproval = inlineEvalHit !== null;
  const requiresAsk =
    !isInternalManagementCommand &&
    (requiresExecApproval({
      ask: hostAsk,
      security: hostSecurity,
      analysisOk,
      allowlistSatisfied,
    }) ||
      requiresHeredocApproval ||
      requiresInlineEvalApproval ||
      obfuscation.detected);
  if (requiresHeredocApproval) {
    params.warnings.push(
      "Warning: heredoc execution requires explicit approval in allowlist mode.",
    );
  }

  if (requiresAsk) {
    const requestArgs = buildDefaultExecApprovalRequestArgs({
      warnings: params.warnings,
      approvalRunningNoticeMs: params.approvalRunningNoticeMs,
      createApprovalSlug,
      turnSourceChannel: params.turnSourceChannel,
      turnSourceAccountId: params.turnSourceAccountId,
    });
    const registerGatewayApproval = async (approvalId: string) =>
      await registerExecApprovalRequestForHostOrThrow({
        approvalId,
        command: params.command,
        env: params.requestedEnv,
        workdir: params.workdir,
        host: "gateway",
        security: hostSecurity,
        ask: hostAsk,
        ...buildExecApprovalRequesterContext({
          agentId: params.agentId,
          sessionKey: params.sessionKey,
        }),
        resolvedPath: resolveApprovalAuditCandidatePath(
          allowlistEval.segments[0]?.resolution ?? null,
          params.workdir,
        ),
        ...buildExecApprovalTurnSourceContext(params),
      });
    const {
      approvalId,
      approvalSlug,
      warningText,
      expiresAtMs,
      preResolvedDecision,
      initiatingSurface,
      sentApproverDms,
      unavailableReason,
    } = await createAndRegisterDefaultExecApprovalRequest({
      ...requestArgs,
      register: registerGatewayApproval,
    });
    const resolvedPath = resolveApprovalAuditCandidatePath(
      allowlistEval.segments[0]?.resolution ?? null,
      params.workdir,
    );

    console.log(
      `[exec-host-gateway] approval registered: id=${approvalId}, command=${params.command}, sessionKey=${params.notifySessionKey}, channel=${params.turnSourceChannel}, to=${params.turnSourceTo}`,
    );
    // Diagnostic: log call stack to trace which agent turn triggered this approval
    const stack = new Error().stack ?? "";
    const stackLines = stack.split("\n").slice(2, 6).join(" | ");
    console.log(`[exec-host-gateway] approval registered stack (id=${approvalId}): ${stackLines}`);

    const decision = await resolveApprovalDecisionOrUndefined({
      approvalId,
      preResolvedDecision,
      onFailure: () => {},
    });

    if (decision === undefined) {
      return {
        toolResult: buildExecApprovalPendingToolResult({
          host: "gateway",
          command: params.command,
          cwd: params.workdir,
          warningText,
          approvalId,
          approvalSlug,
          expiresAtMs,
          initiatingSurface,
          sentApproverDms,
          unavailableReason: unavailableReason ?? "no-approval-route",
        }),
      };
    }

    const {
      baseDecision,
      approvedByAsk: initialApprovedByAsk,
      deniedReason: initialDeniedReason,
    } = createExecApprovalDecisionState({
      decision,
      askFallback,
      obfuscationDetected: obfuscation.detected,
    });
    let approvedByAsk = initialApprovedByAsk;
    let deniedReason = initialDeniedReason;

    if (baseDecision.timedOut && askFallback === "allowlist") {
      if (!analysisOk || !allowlistSatisfied) {
        deniedReason = "approval-timeout (allowlist-miss)";
      } else {
        approvedByAsk = true;
      }
    } else if (decision === "allow-once") {
      approvedByAsk = true;
    } else if (decision === "allow-always") {
      approvedByAsk = true;
      if (hostSecurity === "allowlist" && !requiresInlineEvalApproval) {
        const patterns = resolveAllowAlwaysPatterns({
          segments: allowlistEval.segments,
          cwd: params.workdir,
          env: params.env,
          platform: process.platform,
        });
        for (const pattern of patterns) {
          if (pattern) {
            addAllowlistEntry(approvals.file, params.agentId, pattern);
          }
        }
      }
    }

    if (hostSecurity === "allowlist" && (!analysisOk || !allowlistSatisfied) && !approvedByAsk) {
      deniedReason = deniedReason ?? "allowlist-miss";
    }

    if (deniedReason) {
      throw new Error(`exec denied (gateway id=${approvalId}, ${deniedReason}): ${params.command}`);
    }

    recordMatchedAllowlistUse(resolvedPath ?? undefined);

    return { execCommandOverride: enforcedCommand };
  }

  if (
    hostSecurity === "allowlist" &&
    (!analysisOk || !allowlistSatisfied) &&
    !isInternalManagementCommand
  ) {
    throw new Error("exec denied: allowlist miss");
  }

  recordMatchedAllowlistUse(
    resolveApprovalAuditCandidatePath(
      allowlistEval.segments[0]?.resolution ?? null,
      params.workdir,
    ),
  );

  return { execCommandOverride: enforcedCommand };
}
