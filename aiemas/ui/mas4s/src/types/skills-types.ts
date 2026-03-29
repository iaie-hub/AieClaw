/** Skill 安装项 */
export interface SkillInstallItem {
  id: string;
  label: string;
  kind: string;
  bins: string[];
}

/** Skills 状态条目 */
export interface SkillStatusEntry {
  name: string;
  description: string;
  source: string;
  skillKey: string;
  filePath: string;
  baseDir: string;
  emoji?: string;
  homepage?: string;
  disabled: boolean;
  eligible: boolean;
  always: boolean;
  bundled?: boolean;
  blockedByAllowlist: boolean;
  primaryEnv?: string;
  requirements?: {
    bins?: string[];
    anyBins?: string[];
    env?: string[];
    config?: string[];
    os?: string[];
  };
  missing: {
    bins: string[];
    anyBins: string[];
    env: string[];
    config: string[];
    os: string[];
  };
  configChecks: Array<{
    path: string;
    satisfied: boolean;
  }>;
  install: SkillInstallItem[];
}

/** Skills 状态报告 */
export interface SkillStatusReport {
  workspaceDir: string;
  managedSkillsDir: string;
  skills: SkillStatusEntry[];
}
