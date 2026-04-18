/** 布局模式标识符 */
export type LayoutMode = "single" | "grid-2x2" | "three-column" | "left-main" | "top-bottom";

/** 布局模式元数据（用于面板渲染） */
export interface LayoutOption {
  mode: LayoutMode;
  label: string;
  /** SVG path 或模板 */
  icon: string;
}

/** 计算后的 Grid 布局参数 */
export interface GridLayoutResult {
  gridTemplateColumns: string;
  gridTemplateRows: string;
  /** 窗口分配：index 0 = Root Agent，后续为子 Agent */
  slots: Array<{ agentId: string; type: "root" | "sub" | "placeholder" }>;
}
