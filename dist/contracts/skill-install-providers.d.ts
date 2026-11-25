import type { TuiAgent } from './tui-agent';
/** Null segments use canonical .agents/skills without a separate placement; IDs match detected Orca agents. */
export type SkillInstallProviderEntry = {
    readonly id: TuiAgent;
    readonly displayName: string;
    readonly globalSegments: readonly string[] | null;
    readonly workspaceSegments: readonly string[] | null;
    /** Env var relocating the agent's home (skills in `<home>/skills`). */
    readonly homeEnv?: string;
};
/** Read-only derived projection over `AGENT_SKILL_REGISTRY` for managed install providers. */
export declare const SKILL_INSTALL_PROVIDERS: readonly SkillInstallProviderEntry[];
export type SkillInstallProviderDefinition = (typeof SKILL_INSTALL_PROVIDERS)[number];
export type SkillInstallProviderId = SkillInstallProviderDefinition['id'];
export declare function isSkillInstallProviderId(value: string): value is SkillInstallProviderId;
/** Explicit choices include agents installed later; removal omits choices to clean every previously used root. */
export declare function selectedOrDetectedSkillProviders(detectedProviders: readonly string[], selectedProviders: readonly string[] | undefined): readonly string[];
