import type { DatabaseSync } from "node:sqlite";
import type { TSchema } from "typebox";
import { Type } from "typebox";
import type { SessionTranscriptStore } from "../session-history/session-transcript-store.js";
import { createAiemasSessionsStore } from "../store/aiemas-sessions-store.js";
import {
  constructKeyFromUuid,
  extractAgentNameFromKey,
  extractUuidFromKey,
} from "../utils/session-utils.js";

// ── Local tool type (compatible with AnyAgentTool from Gateway core) ──
// Defined locally to avoid importing from src/ (architecture boundary).

interface AgentToolResult<T> {
  content: Array<{ type: "text"; text: string }>;
  details: T;
}

export interface AiemasAgentTool {
  name: string;
  description: string;
  parameters: TSchema;
  label: string;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
    onUpdate?: unknown,
  ) => Promise<AgentToolResult<unknown>>;
}

// ── Dependencies ──

export interface AiemasToolDeps {
  db: DatabaseSync;
  /** 依赖注入：由桥接层构造的 sessions_send 调用回调 */
  callSessionsSend: (params: {
    sessionKey: string;
    message: string;
    timeoutSeconds?: number;
  }) => Promise<unknown>;
  /** Optional: transcript store for marking A2A messages with role="agent" */
  transcriptStore?: SessionTranscriptStore;
  /** 依赖注入：广播 chat 事件到 WebSocket 客户端，用于 A2A 输入消息实时显示在子 Agent 抽屉中 */
  broadcastChatEvent?: (params: {
    sessionKey: string;
    runId: string;
    message: {
      role: string;
      content: Array<{ type: string; text: string }>;
      timestamp: number;
      senderLabel?: string;
    };
  }) => void;
}

// ── Parameter schema ──

export const AiemasSessionsSendSchema = Type.Object({
  agentId: Type.String({ description: "目标子 Agent 的 agentId" }),
  message: Type.String({ description: "要发送的消息" }),
  timeoutSeconds: Type.Optional(
    Type.Number({ minimum: 0, description: "等待回复的超时秒数，默认 600" }),
  ),
});

// ── Helper ──

function jsonResult(payload: unknown): AgentToolResult<unknown> {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    details: payload,
  };
}

// ── Tool factory ──

/**
 * 创建 aiemas_sessions_send 工具。
 *
 * agentSessionKey 由 resolveAgentTools 上下文传入，在工具创建时绑定到闭包中。
 * 工具执行时从闭包获取 agentSessionKey，提取 sessionUuid，
 * 查询 aiemas_sessions 表解析目标 sessionKey，再通过 callSessionsSend 回调发送消息。
 */
export function createAiemasSessionsSendTool(
  deps: AiemasToolDeps,
  context?: { agentSessionKey?: string },
): AiemasAgentTool {
  const { db, callSessionsSend, transcriptStore } = deps;
  const agentSessionKey = context?.agentSessionKey;

  // ── 串行队列 ──
  // LLM 会并发发起多次 aiemas_sessions_send 工具调用，Gateway 工具框架会并行
  // 执行每个 execute。但 nested Lane maxConcurrent=1，agent 实际串行执行。
  // 如果 N 个 wait 同时计时，排在后面的 agent 还没开始执行就已超时。
  // 用 Promise 链将 execute 串行化：每个调用等前一个完成后再提交+wait，
  // 确保 wait 计时从实际提交时开始，消除排队超时问题。
  let serialQueue: Promise<unknown> = Promise.resolve();

  /** 实际执行逻辑，由串行队列依次调度。 */
  async function executeImpl(
    _toolCallId: string,
    params: Record<string, unknown>,
  ): Promise<AgentToolResult<unknown>> {
    const agentId = params.agentId as string | undefined;
    const message = params.message as string | undefined;
    const timeoutSeconds = params.timeoutSeconds as number | undefined;

    console.log(
      `[aiemas:tools] aiemas_sessions_send: source=${agentSessionKey}, targetAgentId=${agentId}`,
    );

    // 1. 验证 agentSessionKey 非空
    if (!agentSessionKey) {
      return jsonResult({
        status: "error",
        error: "agentSessionKey is required but was empty or undefined",
      });
    }

    // 2. 提取 sessionUuid，验证有效
    const sessionUuid = extractUuidFromKey(agentSessionKey);
    if (!sessionUuid) {
      return jsonResult({
        status: "error",
        error: `Failed to extract sessionUuid from agentSessionKey: ${agentSessionKey}`,
      });
    }

    // 3. 查询 aiemas_sessions 表，从 descendantSessions 查找目标 agentId
    let targetSessionKey: string | undefined;
    try {
      const store = createAiemasSessionsStore(db);
      const rootSession = store.loadRootSession(agentSessionKey);
      if (rootSession) {
        const descendant = rootSession.descendantSessions.find((d) => d.agentId === agentId);
        if (descendant) {
          targetSessionKey = descendant.sessionKey;
        }
      }
    } catch (err) {
      // DB 查询失败 → 记录警告日志，回退到派生规则
      console.warn(
        `[aiemas-tools] DB query failed, falling back to derived sessionKey: ${String(err)}`,
      );
    }

    // 4. 若未找到，fallback 使用 constructKeyFromUuid 派生 sessionKey
    if (!targetSessionKey) {
      targetSessionKey = constructKeyFromUuid(agentId ?? "", sessionUuid);
    }

    // 5. 调用 callSessionsSend 回调
    try {
      // 强制最小超时 600 秒，防止 LLM 传入过小的值导致子 Agent 超时
      const effectiveTimeout = Math.max(timeoutSeconds ?? 600, 600);
      console.log(
        `[aiemas:tools] dispatching message to sessionKey=${targetSessionKey} timeout=${effectiveTimeout}s`,
      );

      // 5a. Mark the next user message on the target session as agent-sourced.
      // This must happen BEFORE callSessionsSend so the transcript store can
      // match the incoming message and convert role from "user" to "agent".
      if (transcriptStore && agentSessionKey) {
        const sourceAgentId = extractAgentNameFromKey(agentSessionKey);
        transcriptStore.markNextMessageAsAgent(targetSessionKey, {
          sourceAgentId,
          sourceSessionKey: agentSessionKey,
          message: message ?? "",
        });
      }

      // 5b. Broadcast A2A input message to UI so the sub-agent drawer shows it in real-time.
      // This fires BEFORE callSessionsSend so the input bubble appears immediately,
      // before the child agent starts its run and streams assistant/tool events.
      if (deps.broadcastChatEvent && targetSessionKey && agentSessionKey) {
        const sourceAgentId = extractAgentNameFromKey(agentSessionKey);
        deps.broadcastChatEvent({
          sessionKey: targetSessionKey,
          runId: `a2a-input-${Date.now()}`,
          message: {
            role: "agent",
            content: [{ type: "text", text: message ?? "" }],
            timestamp: Date.now(),
            senderLabel: sourceAgentId,
          },
        });
      }

      const result = (await callSessionsSend({
        sessionKey: targetSessionKey,
        message: message ?? "",
        timeoutSeconds: effectiveTimeout,
      })) as { status: string; approvalId?: string; runId?: string };

      // 6. 状态增强反馈：为 Orchestrator (LLM) 提供更清晰的中文指令
      if (result.status === "blocked") {
        return jsonResult({
          status: "blocked",
          approvalId: result.approvalId,
          message: `子 Agent (${agentId}) 正在等待人工授权以执行敏感操作。`,
          instruction:
            "请告知用户：当前操作涉及敏感权限，需要用户在聊天界面查看并点击【审批】按钮，或回复 /approve 进行授权。在用户完成授权前，请不要重复发送相同的指令。",
        });
      }

      if (result.status === "running") {
        return jsonResult({
          status: "running",
          runId: result.runId,
          message: `子 Agent (${agentId}) 正在执行耗时任务，目前仍在后台处理中。`,
          instruction:
            "任务已成功排产并正在运行，但超过了预设的同步等待时间。请告知用户任务正在处理，建议用户稍后查询结果，或者您可以在合适的时候再次调用此工具查看后续反馈。",
        });
      }

      // 7. 返回原始结果 (含 ok, timeout, error 等标识)
      return jsonResult(result);
    } catch (err) {
      return jsonResult({
        status: "error",
        error: `callSessionsSend failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  return {
    name: "aiemas_sessions_send",
    label: "AIEMAS Session Send",
    description:
      "[RESTRICTED — AIEMAS topology only] Send a message to a managed sub-agent within your AIEMAS topology (e.g. aieiaas-resource, aieiaas-model). " +
      "Handles session cascading automatically — just provide the target agentId. " +
      "Do NOT use sessions_send or subagents for sub-agent communication. " +
      "IMPORTANT: For agents registered in the external Agent Registry (not your managed sub-agents), use the send_message_to_agent tool instead.",

    parameters: AiemasSessionsSendSchema,
    execute: async (_toolCallId, params) => {
      // 串行化：将 executeImpl 追加到 Promise 链尾部。
      // 前一个调用完成（无论成功/失败）后，下一个才开始提交+wait，
      // 避免并发 wait 导致排队中的 agent 超时。
      const task = serialQueue.catch(() => {}).then(() => executeImpl(_toolCallId, params));
      serialQueue = task;
      return task;
    },
  };
}
