import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import type { ApprovalRequest, ApprovalResolved } from "../types/approval-types.js";
import type { ChatMessage } from "../types/chat-types.js";
import "./msg-user.js";
import "./msg-colleague.js";
import "./msg-agent.js";
import "./msg-approval-card.js";

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

  private _renderMessage(msg: ChatMessage) {
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
    // ── History approval messages (role="approval") ──────────────────────────
    if (msg.role === "approval") {
      const reqItem = msg.content.find((c) => c.type === "approval_requested");
      if (reqItem?.args) {
        const data = reqItem.args as Record<string, unknown>;
        const approvalId = data["id"] as string;
        // Reconstruct ApprovalRequest from stored data
        const approval: ApprovalRequest = {
          id: approvalId,
          request: {
            command: (data["command"] as string) ?? "",
            commandPreview: data["commandPreview"] as string | undefined,
            cwd: (data["cwd"] as string | null) ?? null,
            resolvedPath: (data["resolvedPath"] as string | null) ?? null,
            host: (data["host"] as string | null) ?? null,
            agentId: (data["agentId"] as string | null) ?? null,
            security: (data["security"] as string | null) ?? null,
            sessionKey: (data["sessionKey"] as string | null) ?? null,
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
    if (msg.role === "assistant" || msg.role === "toolResult" || msg.role === "tool") {
      // Suppress assistant messages that triggered an approval request.
      // In real-time, `chat final` overwrites these with empty content and the
      // approval card takes over. In history, we use the stored triggeredByMsgId
      // to achieve the same effect without content-matching heuristics.
      if (msg.role === "assistant" && msg.id && this._cachedApprovalTriggeredMsgIds.has(msg.id)) {
        return html``;
      }
      return html`<msg-agent .message=${msg}></msg-agent>`;
    }
    // 其他 role（system 等）暂不渲染
    return html``;
  }

  render() {
    // Build the history resolved map once per render cycle
    this._cachedHistoryResolved = this._buildHistoryResolvedMap();
    return html`${this.messages.map((msg) => this._renderMessage(msg))}`;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "message-list": MessageList;
  }
}
