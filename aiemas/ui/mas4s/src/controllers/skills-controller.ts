import { fetchSkills, toggleSkillEnabled as apiToggleSkillEnabled } from "../gateway/skills-api.js";
import type { GatewayBrowserClient } from "../lib/gateway.js";
import { AppStore } from "../store/app-store.js";
import type { SkillStatusEntry } from "../types/skills-types.js";

/**
 * SkillsController - 管理 Skills 数据获取和状态更新的业务逻辑控制器
 *
 * 职责：
 * - 通过 Gateway API 获取 Skills 数据
 * - 处理 Skill 启用/禁用操作
 * - 实现 Skills 分类逻辑（工作空间 vs 内置）
 * - 实现 Skills 过滤逻辑（按页签和搜索文本）
 * - 错误重试逻辑（最多 3 次，指数退避）
 */
export class SkillsController {
  private store: AppStore;
  private client: GatewayBrowserClient;
  private retryCount = 0;
  private readonly maxRetries = 3;

  constructor(client: GatewayBrowserClient, store: AppStore = AppStore.instance) {
    this.client = client;
    this.store = store;
  }

  /**
   * 获取 Skills 数据并更新 AppStore
   * 实现错误重试逻辑（最多 3 次，指数退避）
   *
   * **验证需求: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 9.5, 9.6**
   */
  async fetchSkills(): Promise<void> {
    this.store.setSkillsLoading(true);

    try {
      const report = await fetchSkills(this.client);
      this.store.setSkillsReport(report);
      this.store.setSkillsLoading(false);
      this.retryCount = 0; // 成功后重置重试计数
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "获取 Skills 数据失败";

      if (this.retryCount < this.maxRetries) {
        this.retryCount++;
        // 指数退避：2^retryCount 秒
        const delayMs = Math.pow(2, this.retryCount) * 1000;
        console.warn(
          `Skills 数据获取失败，${delayMs / 1000}秒后重试 (${this.retryCount}/${this.maxRetries})`,
        );

        setTimeout(() => {
          void this.fetchSkills();
        }, delayMs);
      } else {
        // 达到最大重试次数，显示错误
        this.store.setSkillsError(errorMessage);
        this.retryCount = 0; // 重置重试计数，以便下次手动重试
      }
    }
  }

  /**
   * 切换 Skill 的启用状态
   *
   * @param skillKey - Skill 的唯一标识符
   * @param enabled - 目标启用状态（true 为启用，false 为禁用）
   *
   * **验证需求: 11.3, 11.4**
   */
  async toggleSkillEnabled(skillKey: string, enabled: boolean): Promise<void> {
    try {
      await apiToggleSkillEnabled(this.client, skillKey, enabled);

      // 更新本地状态
      const report = this.store.skillsReport;
      if (report) {
        const updatedSkills = report.skills.map((skill) =>
          skill.skillKey === skillKey ? { ...skill, disabled: !enabled } : skill,
        );
        this.store.setSkillsReport({ ...report, skills: updatedSkills });
      }
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : "更新 Skill 状态失败";
      throw new Error(errorMessage, { cause: error });
    }
  }

  /**
   * 批量切换 Skills 的启用状态
   *
   * @param skillKeys - Skill 的唯一标识符数组
   * @param enabled - 目标启用状态（true 为启用，false 为禁用）
   */
  async toggleSkillsBatch(skillKeys: string[], enabled: boolean): Promise<void> {
    if (!skillKeys.length) {
      return;
    }

    // 对于批量操作，不更新全局的 skillsLoading 状态以免全屏白屏
    // 我们交由 UI 层自行管理局部 loading 即可
    const results = await Promise.allSettled(
      skillKeys.map((key) => apiToggleSkillEnabled(this.client, key, enabled)),
    );

    const failures: string[] = [];
    results.forEach((res, index) => {
      if (res.status === "rejected") {
        const errorMsg = res.reason instanceof Error ? res.reason.message : String(res.reason);
        failures.push(`Skill ${skillKeys[index]}: ${errorMsg}`);
      }
    });

    // 只重新拉取一次，保证数据一致性（或者也可以像 toggleSkillEnabled 一样做本地 optimistic 更新，但统一拉取更安全）
    // 为了防止 fetchSkills 发出 loading 事件，我们可以直接走 fetchSkills 后台更新
    try {
      const report = await fetchSkills(this.client);
      this.store.setSkillsReport(report);
    } catch {
      // 忽略刷新失败
    }

    if (failures.length > 0) {
      throw new Error(`批量操作部分失败:\n${failures.join("\n")}`);
    }
  }

  /**
   * 根据 source 字段分类 Skill
   *
   * @param skill - Skill 状态条目
   * @returns 'workspace' 或 'builtin'
   *
   * **验证需求: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7**
   */
  classifySkill(skill: SkillStatusEntry): "workspace" | "builtin" {
    const workspaceSources = ["openclaw-workspace", "agents-skills-project"];
    return workspaceSources.includes(skill.source) ? "workspace" : "builtin";
  }

  /**
   * 根据页签和搜索文本过滤 Skills
   *
   * @param skills - Skills 列表
   * @param tab - 当前选中的页签 ('all' | 'workspace' | 'builtin')
   * @param searchText - 搜索文本
   * @returns 过滤后的 Skills 列表
   *
   * **验证需求: 2.7, 3.5, 3.6**
   */
  filterSkills(
    skills: SkillStatusEntry[],
    tab: "all" | "workspace" | "builtin",
    searchText: string,
  ): SkillStatusEntry[] {
    // 按页签过滤
    let filtered = skills;
    if (tab === "workspace") {
      filtered = skills.filter((skill) => this.classifySkill(skill) === "workspace");
    } else if (tab === "builtin") {
      filtered = skills.filter((skill) => this.classifySkill(skill) === "builtin");
    }

    // 按搜索文本过滤
    if (searchText.trim()) {
      const query = searchText.toLowerCase();
      filtered = filtered.filter(
        (skill) =>
          skill.name.toLowerCase().includes(query) ||
          skill.description.toLowerCase().includes(query),
      );
    }

    return filtered;
  }
}
