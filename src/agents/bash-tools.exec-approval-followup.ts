import { isDeliverableMessageChannel } from "../utils/message-channel.js";
import { callGatewayTool } from "./tools/gateway.js";

type ExecApprovalFollowupParams = {
  approvalId: string;
  sessionKey?: string;
  turnSourceChannel?: string;
  turnSourceTo?: string;
  turnSourceAccountId?: string;
  turnSourceThreadId?: string | number;
  resultText: string;
};

function buildExecDeniedFollowupPrompt(resultText: string): string {
  return [
    "An async command did not run.",
    "Do not run the command again.",
    "There is no new command output.",
    "Do not mention, summarize, or reuse output from any earlier run in this session.",
    "",
    "Exact completion details:",
    resultText.trim(),
    "",
    "Reply to the user in a helpful way.",
    "Explain that the command did not run and why.",
    "Do not claim there is new command output.",
  ].join("\n");
}

export function buildExecApprovalFollowupPrompt(resultText: string): string {
  const trimmed = resultText.trim();
  if (trimmed.startsWith("Exec denied (")) {
    return buildExecDeniedFollowupPrompt(trimmed);
  }
  return [
    "An async command the user already approved has completed.",
    "Do not run the command again.",
    "",
    "Exact completion details:",
    trimmed,
    "",
    "Reply to the user with the relevant output above.",
    "If it succeeded, share the key results.",
    "If it failed, explain what went wrong.",
    "Do not call any tools. Do not run any commands.",
  ].join("\n");
}

export async function sendExecApprovalFollowup(
  params: ExecApprovalFollowupParams,
): Promise<boolean> {
  const sessionKey = params.sessionKey?.trim();
  const resultText = params.resultText.trim();
  if (!sessionKey || !resultText) {
    console.log(
      `[exec-approval-followup] skipped: sessionKey=${!!sessionKey}, resultText=${!!resultText}`,
    );
    return false;
  }

  const channel = params.turnSourceChannel?.trim();
  const to = params.turnSourceTo?.trim();
  const threadId =
    params.turnSourceThreadId != null && params.turnSourceThreadId !== ""
      ? String(params.turnSourceThreadId)
      : undefined;

  console.log(
    `[exec-approval-followup] sending followup: approvalId=${params.approvalId}, sessionKey=${sessionKey}, channel=${channel}, to=${to}, threadId=${threadId}`,
  );

  try {
    // Only request delivery when channel is an external deliverable channel (e.g. telegram, discord).
    // webchat is INTERNAL_MESSAGE_CHANNEL — it is not deliverable and must not use deliver:true.
    const isExternal = !!channel && isDeliverableMessageChannel(channel);
    const deliverPayload = isExternal
      ? {
          deliver: true,
          bestEffortDeliver: true,
          channel,
          to: to || undefined,
          accountId: params.turnSourceAccountId?.trim() || undefined,
          threadId,
        }
      : {};

    await callGatewayTool(
      "agent",
      { timeoutMs: 60_000 },
      {
        sessionKey,
        message: buildExecApprovalFollowupPrompt(resultText),
        ...deliverPayload,
        role: "system",
        idempotencyKey: `exec-approval-followup:${params.approvalId}`,
        // Prevent the agent from calling any tools in this summary-only turn.
        // The followup is a completion notification; the agent must only summarize
        // the result and reply — not plan new steps or re-run commands.
        extraSystemPrompt: [
          "RUNTIME CONSTRAINT: This turn is a completion notification for an async exec command.",
          "You MUST NOT call any tools (exec, bash, or otherwise) in this turn.",
          "You MUST NOT re-run the command or start new tasks.",
          "Only summarize the result already provided and reply to the user.",
        ].join(" "),
      },
      { expectFinal: true },
    );
    console.log(`[exec-approval-followup] completed: approvalId=${params.approvalId}`);
  } catch (error) {
    console.error(
      `[exec-approval-followup] failed: approvalId=${params.approvalId}, error=${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  }

  return true;
}
