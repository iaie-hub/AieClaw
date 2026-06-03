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

  // ── Filter State ───────────────────────────────────────────────────────────
  @state() private _filterActiveMinutes = 120;
  @state() private _filterLimit = 200;
  @state() private _filterShowArchived = false;

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
      const params: Record<string, unknown> = {
        includeGlobal: true,
        includeUnknown: true,
        configuredAgentsOnly: false,
        limit: this._filterLimit,
      };
      // When showArchived is off, apply activeMinutes filter
      if (!this._filterShowArchived && this._filterActiveMinutes > 0) {
        params.activeMinutes = this._filterActiveMinutes;
      }
      const result = await client.request("sessions.list", params);
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

  private _onFilterChange = (
    e: CustomEvent<{
      activeMinutes: number;
      limit: number;
      showArchived: boolean;
    }>,
  ) => {
    const f = e.detail;
    this._filterActiveMinutes = f.activeMinutes;
    this._filterLimit = f.limit;
    this._filterShowArchived = f.showArchived;
    void this._fetchSessions();
  };

  private _onSessionDelete = async (e: CustomEvent<{ key: string }>) => {
    const { key } = e.detail;
    try {
      const client = getClient();
      await client.request("sessions.delete", { key, deleteTranscript: true });
      // Remove from local list
      this._sessions = this._sessions.filter((s) => s.key !== key);
      // Clear selection if deleted session was selected
      if (this._selectedSessionKey === key) {
        this._selectedSessionKey = "";
        this._messages = [];
      }
    } catch (err) {
      console.error("[sessions-view] sessions.delete failed:", err);
    }
  };

  private _onSessionRefresh = (e: CustomEvent<{ key: string }>) => {
    const { key } = e.detail;
    if (key === this._selectedSessionKey) {
      void this._fetchHistory(key);
    }
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
        .filterActiveMinutes=${this._filterActiveMinutes}
        .filterLimit=${this._filterLimit}
        .filterShowArchived=${this._filterShowArchived}
        @session-select=${this._onSessionSelect}
        @retry-fetch=${this._onRetryFetch}
        @filter-change=${this._onFilterChange}
        @session-delete=${this._onSessionDelete}
        @session-refresh=${this._onSessionRefresh}
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
