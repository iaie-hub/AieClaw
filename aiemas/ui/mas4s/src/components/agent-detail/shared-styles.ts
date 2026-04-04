import { css } from "lit";

/** 页签面板和子详情对话框的共享样式 */
export const tabPanelStyles = css`
  :host {
    display: block;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 16px;
  }
  .item-card {
    background: #fff;
    border: 1px solid #e1e4e8;
    border-radius: 12px;
    padding: 16px;
    cursor: pointer;
    transition:
      transform 0.15s,
      box-shadow 0.15s;
    display: flex;
    flex-direction: column;
  }
  .item-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
    border-color: #3b82f6;
  }
  .card-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: 8px;
  }
  .card-title {
    font-size: 14px;
    font-weight: 600;
    color: #1e293b;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .card-desc {
    font-size: 12px;
    color: #64748b;
    margin-bottom: 12px;
    flex: 1;
    line-height: 1.5;
  }
  .card-meta {
    font-size: 11px;
    color: #a1a1aa;
    border-top: 1px solid #f0f0f0;
    padding-top: 10px;
    margin-top: auto;
  }
  .status-ok {
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 12px;
    font-weight: 500;
    background: #e6ffed;
    color: #28a745;
  }
  .status-missing {
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 12px;
    font-weight: 500;
    background: #ffeef0;
    color: #d73a49;
  }
  .status-disabled {
    font-size: 11px;
    padding: 2px 6px;
    border-radius: 12px;
    font-weight: 500;
    background: #f3f4f6;
    color: #94a3b8;
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
  }
  .tag {
    background: #f3f4f6;
    color: #64748b;
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 11px;
    font-family: monospace;
  }
  .empty-state {
    text-align: center;
    padding: 48px 0;
    color: #94a3b8;
    font-size: 14px;
  }
  .loading-state {
    text-align: center;
    padding: 48px 0;
    color: #94a3b8;
    font-size: 14px;
  }

  /* ── Sub-detail dialog ── */
  .sub-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.35);
    z-index: 1100;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: fadeIn 0.15s ease;
  }
  .sub-dialog {
    background: #fff;
    border-radius: 14px;
    width: min(600px, 88vw);
    max-height: 70vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 16px 48px rgba(0, 0, 0, 0.12);
    animation: slideUp 0.2s ease;
    overflow: hidden;
  }
  .sub-header {
    padding: 18px 24px;
    border-bottom: 1px solid #e8edf5;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
  }
  .sub-title {
    font-size: 16px;
    font-weight: 600;
    color: #1e293b;
  }
  .close-btn {
    width: 32px;
    height: 32px;
    border: none;
    background: #f1f5f9;
    border-radius: 8px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #64748b;
    font-size: 18px;
    transition: all 0.15s;
  }
  .close-btn:hover {
    background: #e2e8f0;
    color: #1e293b;
  }
  .sub-body {
    flex: 1;
    overflow-y: auto;
    padding: 20px 24px;
    font-size: 13px;
    color: #475569;
    line-height: 1.7;
  }
  .detail-row {
    display: flex;
    gap: 8px;
    padding: 6px 0;
    border-bottom: 1px solid #f8fafc;
  }
  .detail-label {
    color: #94a3b8;
    font-weight: 500;
    min-width: 72px;
    flex-shrink: 0;
  }
  .detail-value {
    color: #1e293b;
    word-break: break-all;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }
  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateY(12px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
`;
