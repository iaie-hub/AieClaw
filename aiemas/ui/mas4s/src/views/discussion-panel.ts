import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import { onCollabMessage, type CollabMessage } from "../gateway/collab-api.js";

interface CollabEntry extends CollabMessage {
  id: string;
  receivedAt: number;
}

function topicKind(topic: string): "discussion" | "cowork" | "other" {
  if (topic.startsWith("a2a.discussion.")) {
    return "discussion";
  }
  if (topic.startsWith("a2a.cowork.")) {
    return "cowork";
  }
  return "other";
}

function topicLabel(topic: string): string {
  if (topic.startsWith("a2a.discussion.")) {
    return topic.slice("a2a.discussion.".length);
  }
  if (topic.startsWith("a2a.cowork.")) {
    return topic.slice("a2a.cowork.".length);
  }
  return topic;
}

function formatData(data: unknown): string {
  try {
    return JSON.stringify(data, null, 2);
  } catch {
    return String(data);
  }
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

/**
 * Real-time collaboration viewer panel.
 * Displays a2a.discussion.* and a2a.cowork.* messages pushed by the gateway.
 */
@customElement("discussion-panel")
export class DiscussionPanel extends LitElement {
  @state() private entries: CollabEntry[] = [];
  @state() private filter = "";

  private unsubscribe: (() => void) | null = null;

  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      flex: 1;
      overflow: hidden;
      background: #f8fafc;
    }

    .header {
      padding: 16px 20px 12px;
      background: #fff;
      border-bottom: 1px solid #e2e8f0;
      flex-shrink: 0;
    }

    .header-title {
      font-size: 15px;
      font-weight: 600;
      color: #1e293b;
      margin: 0 0 10px 0;
    }

    .toolbar {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .filter-input {
      flex: 1;
      padding: 6px 10px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      font-size: 13px;
      outline: none;
      background: #f8fafc;
      color: #1e293b;
    }

    .filter-input:focus {
      border-color: #2563eb;
      background: #fff;
    }

    .clear-btn {
      padding: 5px 12px;
      font-size: 12px;
      border: 1px solid #e2e8f0;
      border-radius: 8px;
      background: #fff;
      color: #64748b;
      cursor: pointer;
    }

    .clear-btn:hover {
      background: #f1f5f9;
      color: #1e293b;
    }

    .count-badge {
      font-size: 12px;
      color: #64748b;
      white-space: nowrap;
    }

    .entries-list {
      flex: 1;
      overflow-y: auto;
      padding: 12px 16px;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .empty-hint {
      text-align: center;
      color: #94a3b8;
      font-size: 13px;
      margin-top: 48px;
      line-height: 1.8;
    }

    .entry {
      background: #fff;
      border: 1px solid #e2e8f0;
      border-radius: 10px;
      overflow: hidden;
    }

    .entry-header {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      border-bottom: 1px solid #f1f5f9;
      cursor: pointer;
      user-select: none;
    }

    .entry-header:hover {
      background: #f8fafc;
    }

    .kind-badge {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 7px;
      border-radius: 5px;
      flex-shrink: 0;
    }

    .kind-discussion {
      background: #dbeafe;
      color: #1d4ed8;
    }

    .kind-cowork {
      background: #dcfce7;
      color: #166534;
    }

    .kind-other {
      background: #f1f5f9;
      color: #475569;
    }

    .entry-topic {
      font-size: 12px;
      font-weight: 500;
      color: #334155;
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .entry-time {
      font-size: 11px;
      color: #94a3b8;
      flex-shrink: 0;
    }

    .entry-body {
      padding: 10px 12px;
    }

    .entry-body pre {
      margin: 0;
      font-size: 11px;
      line-height: 1.55;
      color: #334155;
      white-space: pre-wrap;
      word-break: break-word;
      max-height: 320px;
      overflow-y: auto;
      background: #f8fafc;
      border-radius: 6px;
      padding: 8px;
    }

    .entry.collapsed .entry-body {
      display: none;
    }
  `;

  /** Set of entry ids that are collapsed */
  @state() private collapsed: Set<string> = new Set();

  connectedCallback() {
    super.connectedCallback();
    this.unsubscribe = onCollabMessage((event) => {
      this.addEntry(event);
    });
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  private addEntry(event: CollabMessage) {
    const entry: CollabEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      receivedAt: Date.now(),
      topic: event.topic,
      data: event.data,
    };
    this.entries = [...this.entries, entry];
    void this.updateComplete.then(() => {
      const list = this.shadowRoot?.querySelector(".entries-list");
      if (list) {
        list.scrollTop = list.scrollHeight;
      }
    });
  }

  private toggleCollapse(id: string) {
    const next = new Set(this.collapsed);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    this.collapsed = next;
  }

  private clearEntries() {
    this.entries = [];
    this.collapsed = new Set();
  }

  private get filteredEntries(): CollabEntry[] {
    const q = this.filter.trim().toLowerCase();
    if (!q) {
      return this.entries;
    }
    return this.entries.filter(
      (e) => e.topic.toLowerCase().includes(q) || formatData(e.data).toLowerCase().includes(q),
    );
  }

  render() {
    const filtered = this.filteredEntries;
    return html`
      <div class="header">
        <p class="header-title">协作讨论 · 实时消息</p>
        <div class="toolbar">
          <input
            class="filter-input"
            type="text"
            placeholder="过滤 topic 或内容…"
            .value=${this.filter}
            @input=${(e: Event) => {
              this.filter = (e.target as HTMLInputElement).value;
            }}
          />
          <button class="clear-btn" @click=${() => this.clearEntries()}>清空</button>
          <span class="count-badge">${filtered.length} 条</span>
        </div>
      </div>

      <div class="entries-list">
        ${filtered.length === 0
          ? html`
              <div class="empty-hint">
                暂无消息<br />
                当前会话中发起讨论或协同任务后，<br />
                实时内容将在此显示。
              </div>
            `
          : filtered.map((entry) => this.renderEntry(entry))}
      </div>
    `;
  }

  private renderEntry(entry: CollabEntry) {
    const kind = topicKind(entry.topic);
    const label = topicLabel(entry.topic);
    const isCollapsed = this.collapsed.has(entry.id);
    return html`
      <div class="entry ${isCollapsed ? "collapsed" : ""}">
        <div class="entry-header" @click=${() => this.toggleCollapse(entry.id)}>
          <span class="kind-badge kind-${kind}">
            ${kind === "discussion" ? "讨论" : kind === "cowork" ? "协任务" : "other"}
          </span>
          <span class="entry-topic" title=${entry.topic}>${label}</span>
          <span class="entry-time">${formatTime(entry.receivedAt)}</span>
        </div>
        <div class="entry-body">
          <pre>${formatData(entry.data)}</pre>
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    "discussion-panel": DiscussionPanel;
  }
}
