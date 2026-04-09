/**
 * Centralized cache service for the aiemas TenantService.
 *
 * Aggregates all in-memory caches (UserCache, TopologyCache, etc.)
 * and provides a single `init(db)` entry point to load them from
 * the database at startup.
 *
 * New caches MUST be registered here — see aiemas/AGENTS.md §2.
 */

import type { DatabaseSync } from "node:sqlite";
import { UserCache } from "../users/user-cache.js";
import { TopologyCache } from "./topology-cache.js";

export class CacheService {
  readonly userCache: UserCache;
  readonly topologyCache: TopologyCache;

  constructor() {
    this.userCache = new UserCache();
    this.topologyCache = new TopologyCache();
  }

  /** 统一初始化：从 DB 加载所有缓存数据 */
  init(db: DatabaseSync): void {
    this.userCache.load(db);
    this.topologyCache.load(db);
  }
}
