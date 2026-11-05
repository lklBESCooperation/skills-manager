import { type EffectiveSkillResolution, type SkillEnablementSalvage, type SkillProjectOverrides, type SkillUserDefaults } from '../contracts/skill-enablement';
import { type SkillProviderRootOverrides } from '../infra/skill-provider-destinations';
import { type EnablementBoundedFileReader, type ExecutedEnablementStep } from './skill-enablement-journal';
import { type SkillEnablementPlan } from './skill-enablement-planner';
export type SkillEnablementScope = 'global' | 'workspace';
/** Host-injected file IO: zod salvage for state parsing, bounded reads for journal recovery. */
export type SkillEnablementFileIO = {
    salvage: SkillEnablementSalvage;
    readFileBounded: EnablementBoundedFileReader;
};
export type SkillEnablementCommand = {
    kind: 'enable' | 'disable';
    skillIds: readonly string[];
    scope: 'user' | 'project';
}
/** Project-level only: delete the override key and re-place from the resolution. */
 | {
    kind: 'inherit';
    skillIds: readonly string[];
};
export type SkillEnablementRuntimeInput = {
    scope: SkillEnablementScope;
    homeDirectory: string;
    workspaceDirectory?: string;
    /** Injected vault root; P1 owns the real layout (`~/.pmstudio/skills`), tests build fakes. */
    vaultRoot: string;
    /** Journal location for the placement batch; defaults beside the state files. */
    stateDirectory: string;
    detectedProviders: readonly string[];
    selectedProviders?: readonly string[];
    providerRootOverrides?: SkillProviderRootOverrides;
    /** Host-injected file IO; the CLI entry binds the app's shared implementations. */
    fileIO: SkillEnablementFileIO;
};
export type SkillEnablementResult = {
    status: 'applied' | 'conflict' | 'partial';
    executed: ExecutedEnablementStep[];
    conflicts: {
        skillId: string;
        provider: string;
        rootPath: string;
    }[];
    plan: SkillEnablementPlan;
    resolution: Map<string, EffectiveSkillResolution>;
    droppedStateKeys: string[];
    /** True when a persisted state file existed but no usable envelope recovered. */
    stateFileUnreadable: boolean;
};
export declare function userDefaultsStatePath(homeDirectory: string): string;
/** The vault root backing a scope; project scope uses the project vault only when it exists. */
export declare function enablementVaultRoot(input: {
    scope: SkillEnablementScope;
    homeDirectory: string;
    workspaceDirectory?: string;
}): string;
export declare function projectStatePath(workspaceDirectory: string): string;
/**
 * One enablement change = state-file update + plan diff + transactional placement batch.
 * An interrupted previous batch is replayed to convergence before the fresh plan runs.
 */
export declare function runSkillEnablementCommand(input: {
    command: SkillEnablementCommand;
    runtime: SkillEnablementRuntimeInput;
    /** Test seam for T2.11. */
    interruptAfterCount?: number;
}): Promise<SkillEnablementResult>;
/** The read-only view behind `pms skills effective`: resolution plus placement reality. */
export declare function readSkillEnablementState(input: {
    runtime: SkillEnablementRuntimeInput;
}): Promise<{
    resolution: Map<string, EffectiveSkillResolution>;
    installedSkillIds: string[];
    userDefaults: SkillUserDefaults;
    projectOverrides: SkillProjectOverrides;
    droppedStateKeys: string[];
    stateFileUnreadable: boolean;
}>;
