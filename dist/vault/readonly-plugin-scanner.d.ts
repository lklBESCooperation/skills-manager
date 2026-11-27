import type { PluginSkillRecord } from '../contracts/plugin-skill-contract';
export type ReadonlyPluginScanInput = {
    homeDirectory: string;
    workspaceDirectory?: string;
    /** Optional plugin root directory (e.g. from Orca worker) to probe sibling Orca plugins. */
    pluginRoot?: string;
    /** Extra system roots (used mainly in tests to avoid reading `/etc/codex/skills`). */
    etcCodexSkillsRoot?: string;
};
export type ReadonlyPluginScanResult = {
    skills: PluginSkillRecord[];
    readonlyRoots: string[];
};
export declare function scanReadonlyPluginSkills(input: ReadonlyPluginScanInput): Promise<ReadonlyPluginScanResult>;
