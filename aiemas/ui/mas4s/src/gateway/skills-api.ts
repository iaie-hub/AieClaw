import type { GatewayBrowserClient } from "../lib/gateway.js";
import type { SkillStatusReport } from "../types/skills-types.js";

/**
 * 创建带超时的 Promise 包装器。
 * @param promise - 原始 Promise
 * @param timeoutMs - 超时时间（毫秒）
 * @param errorMessage - 超时错误消息
 * @returns 带超时的 Promise
 */
function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => {
        reject(new Error(errorMessage));
      }, timeoutMs);
    }),
  ]);
}

/**
 * 通过 Gateway API 获取 Skills 状态报告。
 * 调用 skills.status 方法，超时时间为 10 秒。
 *
 * @param client - Gateway 客户端实例
 * @returns Skills 状态报告
 * @throws 超时、断开连接或 Gateway 错误
 */
export async function fetchSkills(client: GatewayBrowserClient): Promise<SkillStatusReport> {
  try {
    const result = await withTimeout(
      client.request<SkillStatusReport>("skills.status", {}),
      10000,
      "请求超时，请稍后重试",
    );
    return result;
  } catch (error: unknown) {
    // 错误处理：将 Gateway 错误转换为用户友好的错误消息
    if (error && typeof error === "object") {
      const err = error as { code?: string; message?: string; gatewayCode?: string };
      // 检查 GatewayRequestError 的 gatewayCode 字段
      if (err.gatewayCode === "DISCONNECTED" || err.code === "DISCONNECTED") {
        throw new Error("连接已断开，请检查网络", { cause: error });
      }
      if (err.message) {
        throw new Error(err.message, { cause: error });
      }
    }
    throw new Error("获取 Skills 数据失败", { cause: error });
  }
}

/**
 * 通过 Gateway API 更新 Skill 的启用状态。
 * 调用 skills.update 方法，超时时间为 5 秒。
 *
 * @param client - Gateway 客户端实例
 * @param skillKey - Skill 的唯一标识符
 * @param enabled - 目标启用状态（true 为启用，false 为禁用）
 * @throws 超时、断开连接或 Gateway 错误
 */
export async function toggleSkillEnabled(
  client: GatewayBrowserClient,
  skillKey: string,
  enabled: boolean,
): Promise<void> {
  try {
    const result = await withTimeout(
      client.request<{ ok?: boolean; error?: { message?: string } }>("skills.update", {
        skillKey,
        enabled,
      }),
      5000,
      "请求超时，请稍后重试",
    );

    // Gateway 可能返回 ok: false 表示操作失败
    if (result.ok === false) {
      throw new Error(result.error?.message ?? "更新 Skill 状态失败");
    }
  } catch (error: unknown) {
    // 错误处理：将 Gateway 错误转换为用户友好的错误消息
    if (error && typeof error === "object") {
      const err = error as { code?: string; message?: string; gatewayCode?: string };
      // 检查 GatewayRequestError 的 gatewayCode 字段
      if (err.gatewayCode === "DISCONNECTED" || err.code === "DISCONNECTED") {
        throw new Error("连接已断开，请检查网络", { cause: error });
      }
      if (err.message) {
        throw error;
      }
    }
    throw new Error("更新 Skill 状态失败", { cause: error });
  }
}
