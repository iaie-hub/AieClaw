import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import type {
  SOPStepView,
  SkillProgressView,
  ProgressLogEntry,
} from "../components/sop-pipeline.js";
import type { ApprovalRequest, ApprovalResolved } from "../types/approval-types.js";
import type { ChatMessage } from "../types/chat-types.js";
import "./msg-user.js";
import "./msg-colleague.js";
import "./msg-agent.js";
import "./msg-agent-input.js";
import "./msg-tool-result.js";
import "./msg-approval-card.js";
import "./msg-system-card.js";
import "../components/sop-pipeline.js";

/**
 * 消息列表：根据 role 和 subType 分发渲染对应消息组件。
 */
@customElement("message-list")
export class MessageList extends LitElement {
  @property({ attribute: false }) messages: ChatMessage[] = [];
  @property({ attribute: false }) pendingApprovals: ApprovalRequest[] = [];
  @property({ attribute: false }) resolvedApprovals: Map<
    string,
    { approval: ApprovalRequest; resolved: ApprovalResolved }
  > = new Map();
  @property({ type: Boolean }) isInitiator = false;
  @property({ type: Boolean }) showToolMessages = true;

  // ── SOP state (fed from WebSocket events or history replay) ───────────────
  @property({ attribute: false }) sopSteps: SOPStepView[] = [];
  @property({ attribute: false }) sopLabel = "";
  @property({ attribute: false }) activeProgress: SkillProgressView | null = null;
  @property({ attribute: false }) progressLogs: ProgressLogEntry[] = [];

  static styles = css`
    :host {
      display: block;
    }
  `;

  /**
   * Build a lookup map from approval ID → ApprovalResolved by scanning
   * all approval messages with approval_resolved content items.
   * Used to pair history approval cards with their resolution status.
   *
   * Also populates _cachedApprovalTriggeredMsgIds: the set of assistant message
   * ids that triggered an approval request. These messages are suppressed in the
   * history view to match real-time behaviour, where `chat final` overwrites them
   * with empty content and the approval card takes over visually.
   */
  private _buildHistoryResolvedMap(): Map<string, ApprovalResolved> {
    const map = new Map<string, ApprovalResolved>();
    this._cachedApprovalTriggeredMsgIds = new Set<string>();
    for (const msg of this.messages) {
      if (msg.role !== "approval") {
        continue;
      }
      // Collect triggeredByMsgId from approval_requested items
      const reqItem = msg.content.find((c) => c.type === "approval_requested");
      if (reqItem?.args) {
        const reqData = reqItem.args as Record<string, unknown>;
        const triggeredId = reqData["triggeredByMsgId"];
        if (typeof triggeredId === "string" && triggeredId) {
          this._cachedApprovalTriggeredMsgIds.add(triggeredId);
        }
      }
      const resItem = msg.content.find((c) => c.type === "approval_resolved");
      if (resItem?.args) {
        const data = resItem.args as Record<string, unknown>;
        const id = data["id"] as string;
        if (id) {
          map.set(id, {
            id,
            decision: (data["decision"] as string) ?? "allow-once",
            resolvedBy: (data["resolvedBy"] as string | null) ?? null,
            ts: (data["ts"] as number) ?? msg.timestamp,
          });
        }
      }
    }
    return map;
  }

  /** Cached per render cycle */
  private _cachedHistoryResolved: Map<string, ApprovalResolved> | null = null;
  /**
   * Set of assistant message ids that triggered an approval request.
   * Populated by _buildHistoryResolvedMap; used to suppress those messages
   * in the history view so they don't appear alongside the approval card.
   */
  private _cachedApprovalTriggeredMsgIds: Set<string> = new Set();

  private _renderMessage(msg: ChatMessage, isLatestAgent: boolean) {
    // ── 始终过滤无可见内容的 assistant 消息（空白气泡） ─────────────────────
    // 跳过 pending/colleague 等由专用组件渲染的 subType，它们不依赖 content
    if (msg.role === "assistant" && msg.subType !== "pending" && msg.subType !== "colleague") {
      const visibleTypes = this.showToolMessages
        ? ["text", "thinking", "tool_call"]
        : ["text", "thinking"];
      const hasVisibleContent = msg.content.some((c) => {
        if (!visibleTypes.includes(c.type)) {
          return false;
        }
        if (c.type === "text") {
          return !!c.text?.trim();
        }
        if (c.type === "thinking") {
          return !!(c.thinking ?? c.text ?? "").trim();
        }
        return true; // tool_call
      });
      if (!hasVisibleContent) {
        return html``;
      }
    }

    // ── 隐藏工具调用/结果消息 ──────────────────────────────────────────────
    if (!this.showToolMessages) {
      if (msg.role === "tool" || msg.role === "toolResult") {
        return html``;
      }
    }

    if (msg.subType === "colleague") {
      return html`<msg-colleague .message=${msg}></msg-colleague>`;
    }
    if (msg.subType === "pending") {
      // 先查 pending 队列，再查 resolved 缓存
      const pending = this.pendingApprovals.find((a) => a.id === msg.id);
      if (pending) {
        return html`<msg-approval-card
          .approval=${pending}
          .isInitiator=${this.isInitiator}
        ></msg-approval-card>`;
      }
      const resolved = this.resolvedApprovals.get(msg.id!);
      if (resolved) {
        return html`<msg-approval-card
          .approval=${resolved.approval}
          .resolved=${resolved.resolved}
          .isInitiator=${this.isInitiator}
        ></msg-approval-card>`;
      }
      return html``;
    }
    if (msg.subType === "execution-followup") {
      return html`<msg-system-card .message=${msg}></msg-system-card>`;
    }
    // ── History approval messages (role="approval") ──────────────────────────
    if (msg.role === "approval") {
      const reqItem = msg.content.find((c) => c.type === "approval_requested");
      if (reqItem?.args) {
        const data = reqItem.args as Record<string, unknown>;
        const approvalId = data["id"] as string;
        // The stored payload may be the raw exec.approval.requested broadcast
        // (nested: { id, request: { command, ... }, createdAtMs, expiresAtMs })
        // or a flattened shape. Support both.
        const nested = data["request"] as Record<string, unknown> | undefined;
        const r = nested ?? data;
        // Reconstruct ApprovalRequest from stored data
        const approval: ApprovalRequest = {
          id: approvalId,
          request: {
            command: (r["command"] as string) ?? "",
            commandPreview: r["commandPreview"] as string | undefined,
            cwd: (r["cwd"] as string | null) ?? null,
            resolvedPath: (r["resolvedPath"] as string | null) ?? null,
            host: (r["host"] as string | null) ?? null,
            agentId: (r["agentId"] as string | null) ?? null,
            security: (r["security"] as string | null) ?? null,
            sessionKey: (r["sessionKey"] as string | null) ?? null,
            ask: null,
            nodeId: null,
            systemRunBinding: null,
            systemRunPlan: null,
            turnSourceChannel: null,
            turnSourceTo: null,
            turnSourceAccountId: null,
            turnSourceThreadId: null,
          },
          createdAtMs: (data["createdAtMs"] as number) ?? msg.timestamp,
          expiresAtMs: (data["expiresAtMs"] as number) ?? msg.timestamp,
        };
        // Look for a matching resolved message in the list
        const resolvedFromHistory = this._cachedHistoryResolved?.get(approvalId) ?? null;
        // Also check real-time resolved cache
        const resolvedFromRealtime = this.resolvedApprovals.get(approvalId);
        const resolved = resolvedFromRealtime?.resolved ?? resolvedFromHistory;
        return html`<msg-approval-card
          .approval=${approval}
          .resolved=${resolved}
          .isInitiator=${false}
        ></msg-approval-card>`;
      }
      // approval_resolved messages without a matching requested:
      // render as a user action bubble only for [approval:user-resolve] records
      const resItem = msg.content.find((c) => c.type === "approval_resolved");
      if (resItem?.args) {
        const data = resItem.args as Record<string, unknown>;
        // Only render user bubble for user-resolve records, not gateway-broadcast resolved
        if (data["_source"] !== "user-resolve") {
          return html``;
        }
        const decision = (data["decision"] as string) ?? "allow-once";
        const resolvedBy = (data["resolvedBy"] as string | null) ?? null;
        const ts = (data["ts"] as number) ?? msg.timestamp;
        const command = (data["command"] as string) ?? "";
        const decisionText =
          decision === "deny" ? "拒绝" : decision === "allow-always" ? "始终允许" : "允许一次";
        const actionMsg = {
          role: "user",
          content: [{ type: "text" as const, text: `${decisionText}：${command}` }],
          timestamp: ts,
          id: msg.id,
          senderLabel: resolvedBy,
        };
        return html`<msg-user .message=${actionMsg}></msg-user>`;
      }
      return html``;
    }
    if (msg.role === "user" || msg.role === "User") {
      return html`<msg-user .message=${msg}></msg-user>`;
    }
    if (msg.role === "agent") {
      return html`<msg-agent-input .message=${msg}></msg-agent-input>`;
    }
    if (msg.role === "assistant") {
      // Suppress assistant messages that triggered an approval request.
      if (msg.id && this._cachedApprovalTriggeredMsgIds.has(msg.id)) {
        return html``;
      }
      return html`<msg-agent .message=${msg} .isLatest=${isLatestAgent}></msg-agent>`;
    }
    if (msg.role === "tool" || msg.role === "toolResult") {
      return html`<msg-tool-result .message=${msg}></msg-tool-result>`;
    }
    // Progress messages are consumed by the SOP pipeline component, not rendered inline
    if (msg.role === "progress") {
      return html``;
    }
    // 其他 role（system 等）暂不渲染
    return html``;
  }

  render() {
    // Build the history resolved map once per render cycle
    this._cachedHistoryResolved = this._buildHistoryResolvedMap();

    // Find the id of the last visible assistant message (for quick-reply buttons)
    const lastAgentMsg = [...this.messages]
      .toReversed()
      .find(
        (m: ChatMessage) =>
          m.role === "assistant" && !(m.id && this._cachedApprovalTriggeredMsgIds.has(m.id)),
      );
    const lastAgentId = lastAgentMsg?.id;

    return html`
      ${this.messages.map((msg) =>
        this._renderMessage(msg, !!(lastAgentId && msg.id === lastAgentId)),
      )}
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "message-list": MessageList;
  }
}
