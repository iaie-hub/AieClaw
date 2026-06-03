import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { getClient } from "../gateway/client.js";
import type { SessionListItem } from "../types/session-types.js";
import { sortSessionsByUpdatedAt, mapHistoryToChatMessages } from "../types/session-types.js";
import type { ChatMessage } from "../types/chat-types.js";
import "../components/sessions-list-panel.js";
import "../components/session-content-panel.js";

/**
 * 会话页面主视图组件。
 * 双栏布局：左侧会话列表面板（280px），右侧会话内容面板（flex: 1）。
 * 管理会话列表获取、会话选择、消息历史加载和消息发送。
 */
@customElement("sessions-view")
export class SessionsView extends LitElement {
  @state() private _sessions: SessionListItem[] = [];
  @state() private _selectedSessionKey = "";
  @state() private _messages: ChatMessage[] = [];
  @state() private _loadingSessions = false;
  @state() private _loadingHistory = false;
  @state() private _sessionsError = "";
  @state() private _historyError = "";

  static styles = css`
    :host {
      display: flex;
      flex-direction: row;
      width: 100%;
      height: 100%;
      background: #f1f5f9;
      gap: 0;
      overflow: hidden;
      box-sizing: border-box;
      font-family: "DM Sans", "PingFang SC", "Noto Sans SC", system-ui, sans-serif;
    }

    .content-panel-wrapper {
      flex: 1;
      min-width: 0;
      height: 100%;
      padding: 12px 12px 12px 0;
      box-sizing: border-box;
    }
  `;

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  connectedCallback() {
    super.connectedCallback();
    void this._fetchSessions();
  }

  // ── API Calls ──────────────────────────────────────────────────────────────

  private async _fetchSessions() {
    this._loadingSessions = true;
    this._sessionsError = "";
    try {
      const client = getClient();
      await client.waitConnected();
      const result = await client.request("sessions.list", {
        includeGlobal: true,
        includeUnknown: false,
        configuredAgentsOnly: false,
        activeMinutes: 120,
        limit: 200,
      });
      const sessions = (result as { sessions?: SessionListItem[] })?.sessions ?? (result as SessionListItem[]);
      this._sessions = sortSessionsByUpdatedAt(
        Array.isArray(sessions) ? sessions : [],
      );
    } catch (err: unknown) {
      console.error("[sessions-view] sessions.list failed:", err);
      this._sessionsError = err instanceof Error ? err.message : "获取会话列表失败";
    } finally {
      this._loadingSessions = false;
    }
  }

  private async _fetchHistory(sessionKey: string) {
    this._loadingHistory = true;
    this._historyError = "";
    this._messages = [];
    try {
      const client = getClient();
      await client.waitConnected();
      const result = await client.request("chat.history", {
        sessionKey,
        agentId: "main",
        limit: 100,
        maxChars: 4000,
      });
      // Race condition: if user switched sessions while loading, discard
      if (this._selectedSessionKey !== sessionKey) return;
      const rawMessages = (result as { messages?: unknown[] })?.messages ?? (result as unknown[]);
      this._messages = mapHistoryToChatMessages(
        Array.isArray(rawMessages) ? rawMessages : [],
      );
    } catch (err: unknown) {
      // Race condition check
      if (this._selectedSessionKey !== sessionKey) return;
      console.error("[sessions-view] chat.history failed:", err);
      this._historyError = err instanceof Error ? err.message : "获取消息历史失败";
    } finally {
      if (this._selectedSessionKey === sessionKey) {
        this._loadingHistory = false;
      }
    }
  }

  // ── Event Handlers ─────────────────────────────────────────────────────────

  private _onSessionSelect = (e: CustomEvent<{ key: string }>) => {
    const { key } = e.detail;
    if (key === this._selectedSessionKey) return;
    this._selectedSessionKey = key;
    this._historyError = "";
    void this._fetchHistory(key);
  };

  private _onSendMessage = async (
    e: CustomEvent<{ sessionKey?: string; text: string; attachments?: unknown[] }>,
  ) => {
    if (!this._selectedSessionKey) return;
    const client = getClient();
    try {
      await client.request("chat.send", {
        sessionKey: this._selectedSessionKey,
        message: e.detail.text,
        clientRunId: crypto.randomUUID(),
      });
    } catch (err) {
      console.error("[sessions-view] chat.send failed:", err);
    }
  };

  private _onRetryFetch = () => {
    void this._fetchSessions();
  };

  // ── Computed ───────────────────────────────────────────────────────────────

  private get _selectedSession(): SessionListItem | undefined {
    return this._sessions.find((s) => s.key === this._selectedSessionKey);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  render() {
    const selected = this._selectedSession;
    return html`
      <sessions-list-panel
        .sessions=${this._sessions}
        .selectedSessionKey=${this._selectedSessionKey}
        .loading=${this._loadingSessions}
        .error=${this._sessionsError}
        @session-select=${this._onSessionSelect}
        @retry-fetch=${this._onRetryFetch}
      ></sessions-list-panel>
      <div class="content-panel-wrapper">
        <session-content-panel
          .messages=${this._messages}
          .loading=${this._loadingHistory}
          .error=${this._historyError}
          .hasSession=${!!this._selectedSessionKey}
          .totalTokens=${selected?.totalTokens ?? 0}
          .contextTokens=${selected?.contextTokens ?? 0}
          @send-message=${this._onSendMessage}
        ></session-content-panel>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "sessions-view": SessionsView;
  }
}
