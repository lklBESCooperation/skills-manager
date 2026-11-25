import type { PluginSkillRecord } from '../contracts/plugin-skill-contract';
import type { SkillAuditReport } from '../contracts/skill-audit-contract';
import type { SkillVaultIndex } from '../contracts/skill-vault-contract';
export type SkillAuditInput = {
    scope: 'global' | 'workspace';
    homeDirectory: string;
    workspaceDirectory?: string;
    vaultRoot: string;
    vaultIndex?: SkillVaultIndex | null;
    pluginSkills?: readonly PluginSkillRecord[];
    readonlyRoots?: readonly string[];
    installStateDirectory?: string;
};
/**
 * Purely read-only health & readonly-plugin diagnostic scanner (HUB-246 item 2 `audit/`).
 * Performs zero filesystem mutations.
 */
export declare function auditSkillsHealth(input: SkillAuditInput): Promise<SkillAuditReport>;
