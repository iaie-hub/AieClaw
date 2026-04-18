/**
 * 多 Agent 消息链路性能优化 — 集中封装模块
 *
 * 方案 4+6：gateway 启动时阻塞式预热 agent 缓存。
 * 在 gateway 接受用户请求前完成预热，消除预热与请求的 event loop 竞争。
 *
 * 设计原则：
 * - 阻塞式执行（await），确保预热完成后再接受请求
 * - 串行处理每个 agent，避免并发 CPU 密集操作阻塞 event loop
 * - 失败不影响 gateway 启动
 * - 对上游文件零侵入（通过 public API 调用）
 *
 * 预热策略：
 * 对每个已知 agent 串行执行完整初始化路径，填充所有缓存层：
 * - ensureOpenClawModelsJson → provider discovery 缓存 + targetPath 缓存 + normalizeProviders 缓存
 * - discoverAuthStorage + discoverModels → auth storage mtime 缓存
 * - resolveModelAsync → normalizeResolvedModel 缓存 + provider runtime hook 初始化
 */

import { listAgentIds, resolveAgentDir } from "../agents/agent-scope.js";
import { resolveDefaultModelForAgent } from "../agents/model-selection.js";
import { ensureOpenClawModelsJson } from "../agents/models-config.js";
import { resolveModelAsync } from "../agents/pi-embedded-runner/model.js";
import { discoverAuthStorage, discoverModels } from "../agents/pi-model-discovery.js";
import type { OpenClawConfig } from "../config/types.openclaw.js";

/**
 * 阻塞式预热所有已知 agent 的缓存。
 * 调用方式：`await warmupAgentCaches(config)` — 在 gateway 接受请求前完成。
 */
export async function warmupAgentCaches(config?: OpenClawConfig): Promise<void> {
  const started = Date.now();
  try {
    const agentIds = config ? listAgentIds(config) : [];

    // 串行处理每个 agent，避免并发 CPU 密集操作阻塞 event loop
    for (const agentId of agentIds) {
      try {
        const agentDir = resolveAgentDir(config!, agentId);

        // 1. 预热 ensureOpenClawModelsJson 的所有缓存层
        await ensureOpenClawModelsJson(config, agentDir);

        // 2. 预热 discoverAuthStorage + discoverModels 缓存
        const authStorage = discoverAuthStorage(agentDir);
        const modelRegistry = discoverModels(authStorage, agentDir);

        // 3. 预热 resolveModelAsync（normalizeResolvedModel 缓存 + provider runtime hook）
        const defaultModel = resolveDefaultModelForAgent({ cfg: config!, agentId });
        await resolveModelAsync(defaultModel.provider, defaultModel.model, agentDir, config, {
          authStorage,
          modelRegistry,
        });
      } catch {
        // 单个 agent 预热失败不影响其他
      }
    }

    console.log(
      `[perf:warmup] agent caches warmed in ${Date.now() - started}ms (agents=${agentIds.length})`,
    );
  } catch (err) {
    console.warn(`[perf:warmup] agent cache warmup failed (non-fatal): ${String(err)}`);
  }
}
