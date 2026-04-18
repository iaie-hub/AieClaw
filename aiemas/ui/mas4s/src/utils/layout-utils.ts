/**
 * 布局计算纯函数。
 *
 * 根据布局模式、agent 列表和视口宽度计算 CSS Grid 参数、窗口分配和响应式降级。
 * 所有函数均为纯函数，无副作用，便于属性测试。
 */

import type { GridLayoutResult, LayoutMode } from "../types/layout-types.js";

/**
 * 根据 agent 总数计算 grid-2x2 模式的行列数。
 *
 * 规则：
 * - 1 → 1×1
 * - 2 → 1×2
 * - 3-4 → 2×2
 * - 5-6 → 2×3
 * - >6 → cols = ceil(sqrt(N)), rows = ceil(N/cols)
 */
export function computeGridDimensions(totalAgents: number): { cols: number; rows: number } {
  if (totalAgents <= 1) {
    return { cols: 1, rows: 1 };
  }
  if (totalAgents === 2) {
    return { cols: 2, rows: 1 };
  }
  if (totalAgents <= 4) {
    return { cols: 2, rows: 2 };
  }
  if (totalAgents <= 6) {
    return { cols: 3, rows: 2 };
  }

  const cols = Math.ceil(Math.sqrt(totalAgents));
  const rows = Math.ceil(totalAgents / cols);
  return { cols, rows };
}

/**
 * 根据 layoutMode 和 agent 列表计算 CSS Grid 布局参数。
 *
 * 返回 gridTemplateColumns、gridTemplateRows 和窗口分配 slots。
 * slots[0] 始终为 Root Agent，后续为子 Agent，剩余为 placeholder。
 */
export function computeGridLayout(
  layoutMode: LayoutMode,
  rootAgentId: string,
  subAgentIds: string[],
): GridLayoutResult {
  const totalAgents = 1 + subAgentIds.length;

  switch (layoutMode) {
    case "single":
      return {
        gridTemplateColumns: "1fr",
        gridTemplateRows: "1fr",
        slots: [{ agentId: rootAgentId, type: "root" }],
      };

    case "grid-2x2": {
      const { cols, rows } = computeGridDimensions(totalAgents);
      const totalSlots = cols * rows;

      const slots: GridLayoutResult["slots"] = [{ agentId: rootAgentId, type: "root" }];
      for (const id of subAgentIds) {
        slots.push({ agentId: id, type: "sub" });
      }
      // 填充占位窗口
      for (let i = totalAgents; i < totalSlots; i++) {
        slots.push({ agentId: "", type: "placeholder" });
      }

      return {
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
        slots,
      };
    }

    case "three-column": {
      return {
        gridTemplateColumns: `repeat(${totalAgents}, 1fr)`,
        gridTemplateRows: "1fr",
        slots: [
          { agentId: rootAgentId, type: "root" },
          ...subAgentIds.map((id) => ({ agentId: id, type: "sub" as const })),
        ],
      };
    }

    case "left-main": {
      const slots: GridLayoutResult["slots"] = [
        { agentId: rootAgentId, type: "root" },
        ...subAgentIds.map((id) => ({ agentId: id, type: "sub" as const })),
      ];
      return {
        gridTemplateColumns: "3fr 2fr",
        gridTemplateRows: "1fr",
        slots,
      };
    }

    case "top-bottom": {
      const slots: GridLayoutResult["slots"] = [
        { agentId: rootAgentId, type: "root" },
        ...subAgentIds.map((id) => ({ agentId: id, type: "sub" as const })),
      ];
      return {
        gridTemplateColumns: "1fr",
        gridTemplateRows: "1fr 1fr",
        slots,
      };
    }
  }
  return {
    gridTemplateColumns: "1fr",
    gridTemplateRows: "1fr",
    slots: [{ agentId: rootAgentId, type: "root" }],
  };
}

/**
 * 根据视口宽度和用户选择的布局模式，返回实际生效的布局模式。
 *
 * 响应式降级规则：
 * - viewportWidth < 768 → "single"
 * - 768 ≤ viewportWidth < 1024 且 userChoice === "grid-2x2" → "left-main"
 * - 其余 → userChoice
 */
export function resolveEffectiveLayout(userChoice: LayoutMode, viewportWidth: number): LayoutMode {
  if (viewportWidth < 768) {
    return "single";
  }
  if (viewportWidth < 1024 && userChoice === "grid-2x2") {
    return "left-main";
  }
  return userChoice;
}
