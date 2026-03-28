/** Skills 状态条目 */
export interface SkillStatusEntry {
  name: string;
  description: string;
  source: string;
  skillKey: string;
  filePath: string;
  emoji?: string;
  homepage?: string;
  disabled: boolean;
  eligible: boolean;
  bundled?: boolean;
  primaryEnv?: string;
  requires?: {
    bins?: string[];
    anyBins?: string[];
    env?: string[];
    config?: string[];
  };
  missing: {
    bins: string[];
    env: string[];
    config: string[];
  };
  install: Array<{
    id: string;
    label: string;
    kind: string;
  }>;
}

/** Skills 状态报告 */
export interface SkillStatusReport {
  workspaceDir: string;
  managedSkillsDir: string;
  skills: SkillStatusEntry[];
}
