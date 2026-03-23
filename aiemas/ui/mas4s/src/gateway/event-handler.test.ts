import { describe, it, expect } from "vitest";
import { tryParseSpawnConfirm } from "./event-handler.js";

describe("tryParseSpawnConfirm（属性 12）", () => {
  it("解析标准格式", () => {
    const text =
      "[SPAWN_CONFIRM] 即将启动子 Agent：ResearchBot，任务：文献综述，请回复 confirm 继续";
    const result = tryParseSpawnConfirm(text);
    expect(result).not.toBeNull();
    expect(result?.agentName).toBe("ResearchBot");
    expect(result?.task).toBe("文献综述");
  });

  it("不含标记时返回 null", () => {
    expect(tryParseSpawnConfirm("普通消息")).toBeNull();
    expect(tryParseSpawnConfirm("")).toBeNull();
    expect(tryParseSpawnConfirm("SPAWN_CONFIRM 没有方括号")).toBeNull();
  });

  it("含标记但格式不完整时返回默认值", () => {
    const result = tryParseSpawnConfirm("[SPAWN_CONFIRM] 一些内容");
    expect(result).not.toBeNull();
    expect(result?.agentName).toBe("未知");
  });

  it("英文冒号格式", () => {
    const text = "[SPAWN_CONFIRM] 即将启动子 Agent: DataBot, 任务: 数据分析";
    const result = tryParseSpawnConfirm(text);
    expect(result?.agentName).toBe("DataBot");
    expect(result?.task).toBe("数据分析");
  });

  it("对任意不含标记的字符串返回 null", () => {
    const cases = ["hello world", "spawn confirm", "[SPAWN] something", "CONFIRM something", "   "];
    for (const c of cases) {
      expect(tryParseSpawnConfirm(c)).toBeNull();
    }
  });
});
