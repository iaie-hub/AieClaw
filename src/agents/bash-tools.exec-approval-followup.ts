import {
  resolveExternalBestEffortDeliveryTarget,
  type ExternalBestEffortDeliveryTarget,
} from "../infra/outbound/best-effort-delivery.js";
import { sendMessage } from "../infra/outbound/message.js";
import { isCronSessionKey, isSubagentSessionKey } from "../sessions/session-key-utils.js";
import { normalizeLowercaseStringOrEmpty } from "../shared/string-coerce.js";
import { isGatewayMessageChannel, normalizeMessageChannel } from "../utils/message-channel.js";
import {
  formatExecDeniedUserMessage,
  isExecDeniedResultText,
  parseExecApprovalResultText,
} from "./exec-approval-result.js";
import { sanitizeUserFacingText } from "./pi-embedded-helpers/errors.js";
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

// ── Session-level followup serialization ──────────────────────────
// Multiple exec-approval-followup runs on the same session must execute
// serially.  Without this, concurrent agent runs reason over incomplete
// chat history (missing results from sibling followups still in flight)
// and re-issue the same commands, producing duplicate approval requests.
// Denied followups are excluded from the queue because their prompt
// explicitly instructs the LLM not to re-run commands.
const sessionFollowupChains = new Map<string, Promise<void>>();

function enqueueSessionFollowup(sessionKey: string, fn: () => Promise<void>): Promise<void> {
  const prev = sessionFollowupChains.get(sessionKey) ?? Promise.resolve();
  const next = prev
    .catch(() => {}) // previous failure must not block subsequent followups
    .then(() => fn());
  sessionFollowupChains.set(sessionKey, next);
  // Clean up the reference once the chain settles to avoid memory leaks.
  void next.finally(() => {
    if (sessionFollowupChains.get(sessionKey) === next) {
      sessionFollowupChains.delete(sessionKey);
    }
  });
  return next;
}

function buildExecDeniedFollowupPrompt(resultText: string): string {
  const preamble = [
    "An async command did not run.",
    "Do not run the command again.",
    "There is no new command output.",
    "Do not mention, summarize, or reuse output from any earlier run in this session.",
  ].join("\n");

  const resultBlock = `[tool_result] ${resultText.trim().replace(/\n/g, "\\n")}`;

  const postamble = [
    "Reply to the user in a helpful way.",
    "Explain that the command did not run and why.",
    "Do not claim there is new command output.",
  ].join("\n");

  return `[text] ${preamble.replace(/\n/g, "\\n")}\n${resultBlock}\n[text] ${postamble.replace(/\n/g, "\\n")}`;
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return "unknown error";
  }
}

export function buildExecApprovalFollowupPrompt(resultText: string): string {
  const trimmed = resultText.trim();
  const parsed = parseExecApprovalResultText(trimmed);

  if (parsed.kind === "denied") {
    return buildExecDeniedFollowupPrompt(trimmed);
  }

  const preamble = [
    "An async command the user already approved has completed.",
    "Do not run the command again.",
    "If the task requires more steps, continue from this result before replying to the user.",
    "Only ask the user for help if you are actually blocked.",
  ].join("\n");

  const postamble = [
    "Continue the task if needed, then reply to the user in a helpful way.",
    "If it succeeded, share the relevant output.",
    "If it failed, explain what went wrong.",
  ].join("\n");

  const blocks: string[] = [`[text] ${preamble.replace(/\n/g, "\\n")}`];

  if (parsed.kind === "finished") {
    const statusLine = `Exec finished (${parsed.metadata})`;
    blocks.push(`[text] ${statusLine}`);
    if (parsed.body) {
      blocks.push(`[tool_result] ${parsed.body.replace(/\n/g, "\\n")}`);
    }
  } else if (parsed.kind === "completed") {
    if (parsed.body) {
      blocks.push(`[tool_result] ${parsed.body.replace(/\n/g, "\\n")}`);
    }
  } else {
    // Other/Fallback
    blocks.push(`[tool_result] ${trimmed.replace(/\n/g, "\\n")}`);
  }

  blocks.push(`[text] ${postamble.replace(/\n/g, "\\n")}`);

  return blocks.join("\n");
}

function shouldSuppressExecDeniedFollowup(sessionKey: string | undefined): boolean {
  return isSubagentSessionKey(sessionKey) || isCronSessionKey(sessionKey);
}

function formatDirectExecApprovalFollowupText(
  resultText: string,
  opts: { allowDenied?: boolean } = {},
): string | null {
  const parsed = parseExecApprovalResultText(resultText);
  if (parsed.kind === "other" && !parsed.raw) {
    return null;
  }
  if (parsed.kind === "denied") {
    return opts.allowDenied ? formatExecDeniedUserMessage(parsed.raw) : null;
  }

  if (parsed.kind === "finished") {
    const metadata = normalizeLowercaseStringOrEmpty(parsed.metadata);
    const body = sanitizeUserFacingText(parsed.body, {
      errorContext: !metadata.includes("code 0"),
    }).trim();

    let prefix = "";
    if (!body) {
      prefix = metadata.includes("code 0")
        ? "Background command finished."
        : metadata.includes("signal")
          ? "Background command stopped unexpectedly."
          : "Background command finished with an error.";
    }

    return body ? `${prefix ? `${prefix}\n\n` : ""}${body}` : prefix || null;
  }

  if (parsed.kind === "completed") {
    const body = sanitizeUserFacingText(parsed.body, { errorContext: true }).trim();
    return body || "Background command finished.";
  }

  return sanitizeUserFacingText(parsed.raw, { errorContext: true }).trim() || null;
}

function buildSessionResumeFallbackPrefix(): string {
  return "Automatic session resume failed, so sending the status directly.\n\n";
}

function canDirectSendDeniedFollowup(sessionError: unknown): boolean {
  return sessionError !== null;
}

function buildAgentFollowupArgs(params: {
  approvalId: string;
  sessionKey: string;
  resultText: string;
  deliveryTarget: ExternalBestEffortDeliveryTarget;
  sessionOnlyOriginChannel?: string;
  turnSourceTo?: string;
  turnSourceAccountId?: string;
  turnSourceThreadId?: string | number;
}) {
  const { deliveryTarget, sessionOnlyOriginChannel } = params;
  return {
    sessionKey: params.sessionKey,
    role: "system" as const,
    message: buildExecApprovalFollowupPrompt(params.resultText),
    deliver: deliveryTarget.deliver,
    ...(deliveryTarget.deliver ? { bestEffortDeliver: true as const } : {}),
    channel: deliveryTarget.deliver ? deliveryTarget.channel : sessionOnlyOriginChannel,
    to: deliveryTarget.deliver
      ? deliveryTarget.to
      : sessionOnlyOriginChannel
        ? params.turnSourceTo
        : undefined,
    accountId: deliveryTarget.deliver
      ? deliveryTarget.accountId
      : sessionOnlyOriginChannel
        ? params.turnSourceAccountId
        : undefined,
    threadId: deliveryTarget.deliver
      ? deliveryTarget.threadId
      : sessionOnlyOriginChannel
        ? params.turnSourceThreadId
        : undefined,
    idempotencyKey: `exec-approval-followup:${params.approvalId}`,
  };
}

async function sendDirectFollowupFallback(params: {
  approvalId: string;
  deliveryTarget: ExternalBestEffortDeliveryTarget;
  resultText: string;
  sessionError: unknown;
}): Promise<boolean> {
  const directText = formatDirectExecApprovalFollowupText(params.resultText, {
    allowDenied: canDirectSendDeniedFollowup(params.sessionError),
  });
  if (!params.deliveryTarget.deliver || !directText) {
    return false;
  }

  const prefix = params.sessionError ? buildSessionResumeFallbackPrefix() : "";
  await sendMessage({
    channel: params.deliveryTarget.channel,
    to: params.deliveryTarget.to ?? "",
    accountId: params.deliveryTarget.accountId,
    threadId: params.deliveryTarget.threadId,
    content: `${prefix}${directText}`,
    agentId: undefined,
    idempotencyKey: `exec-approval-followup:${params.approvalId}`,
  });
  return true;
}

export async function sendExecApprovalFollowup(
  params: ExecApprovalFollowupParams,
): Promise<boolean> {
  const sessionKey = params.sessionKey?.trim();
  const resultText = params.resultText.trim();
  if (!resultText) {
    return false;
  }
  const isDenied = isExecDeniedResultText(resultText);
  if (isDenied && shouldSuppressExecDeniedFollowup(sessionKey)) {
    return false;
  }

  const deliveryTarget = resolveExternalBestEffortDeliveryTarget({
    channel: params.turnSourceChannel,
    to: params.turnSourceTo,
    accountId: params.turnSourceAccountId,
    threadId: params.turnSourceThreadId,
  });
  const normalizedTurnSourceChannel = normalizeMessageChannel(params.turnSourceChannel);
  const sessionOnlyOriginChannel =
    normalizedTurnSourceChannel && isGatewayMessageChannel(normalizedTurnSourceChannel)
      ? normalizedTurnSourceChannel
      : undefined;

  let sessionError: unknown = null;

  if (sessionKey) {
    try {
      const agentArgs = buildAgentFollowupArgs({
        approvalId: params.approvalId,
        sessionKey,
        resultText,
        deliveryTarget,
        sessionOnlyOriginChannel,
        turnSourceTo: params.turnSourceTo,
        turnSourceAccountId: params.turnSourceAccountId,
        turnSourceThreadId: params.turnSourceThreadId,
      });
      const doCall = () =>
        callGatewayTool("agent", { timeoutMs: 60_000 }, agentArgs, { expectFinal: true });

      if (isDenied) {
        // Denied followups instruct the LLM not to re-run commands, so they
        // cannot cause duplicate approvals and do not need serialization.
        await doCall();
      } else {
        // Approved followups are serialized per session to prevent concurrent
        // agent runs from reasoning over incomplete chat history.
        await enqueueSessionFollowup(sessionKey, async () => {
          await doCall();
        });
      }
      return true;
    } catch (err) {
      sessionError = err;
    }
  }

  if (
    await sendDirectFollowupFallback({
      approvalId: params.approvalId,
      deliveryTarget,
      resultText,
      sessionError,
    })
  ) {
    return true;
  }

  if (sessionError) {
    throw new Error(`Session followup failed: ${formatUnknownError(sessionError)}`);
  }
  if (isDenied) {
    return false;
  }
  throw new Error("Session key or deliverable origin route is required");
}
