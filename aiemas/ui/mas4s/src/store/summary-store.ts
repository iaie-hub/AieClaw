import type { SessionSummary } from "../types/session-types.js";

const KEY_PREFIX = "summary:";

/**
 * 临时摘要存储层，以 sessionStorage 为后端。
 * - key 格式：`summary:{sessionKey}`
 * - 标签页关闭后自动清除，页面刷新后仍可恢复
 * - 需求：4.11，属性 11：SummaryStore 缓存一致性
 */
export class SummaryStore {
  private static _instance: SummaryStore | null = null;

  static get instance(): SummaryStore {
    return (SummaryStore._instance ??= new SummaryStore());
  }

  get(sessionKey: string): SessionSummary | null {
    try {
      const raw = sessionStorage.getItem(KEY_PREFIX + sessionKey);
      if (!raw) {
        return null;
      }
      return JSON.parse(raw) as SessionSummary;
    } catch {
      return null;
    }
  }

  set(sessionKey: string, summary: SessionSummary): void {
    try {
      sessionStorage.setItem(KEY_PREFIX + sessionKey, JSON.stringify(summary));
    } catch {
      // sessionStorage 写入失败（如隐私模式容量限制）时静默忽略
    }
  }

  remove(sessionKey: string): void {
    sessionStorage.removeItem(KEY_PREFIX + sessionKey);
  }
}
