import { resolveEffectiveSkills, type EffectiveSkillState, type SkillAgentOverrides, type SkillProjectOverrides } from '../contracts/skill-enablement';
import { type SkillVaultIndex } from '../contracts/skill-vault-contract';
import type { SkillProviderDestination } from '../infra/skill-provider-destinations';
export type SkillEnablementObservation = {
    skillId: string;
    provider: string;
    rootPath: string;
    /** Real destination of the existing link; null when the entry is not a link to the vault copy. */
    linkTarget: string | null;
    /** Any entry exists at the destination (link, directory, or file). */
    exists: boolean;
    readsCanonicalRoot: boolean;
    isSymbolicLink: boolean;
};
export type SkillEnablementMasterLocation = {
    location: 'vault';
} | {
    location: 'canonical';
} | {
    location: 'missing';
};
export type SkillEnablementPlanAction = {
    kind: 'add';
    observation: SkillEnablementObservation;
    copyMode?: boolean;
} | {
    kind: 'remove';
    observation: SkillEnablementObservation;
    copyMode?: boolean;
} | {
    kind: 'keep';
    observation: SkillEnablementObservation;
} | {
    kind: 'refresh-copy';
    observation: SkillEnablementObservation;
}
/** One-time migration of a legacy canonical-resident skill into permanent Vault master. */
 | {
    kind: 'adopt-canonical-to-vault';
    observation: SkillEnablementObservation;
};
export type SkillEnablementPlan = {
    actions: SkillEnablementPlanAction[];
    counts: {
        add: number;
        remove: number;
        keep: number;
        refreshCopy: number;
        adoptCanonicalToVault: number;
        removeCanonical: number;
    };
    /** Unresolvable destinations the applier must not touch (foreign directories or drifted copies). */
    conflicts: SkillEnablementObservation[];
    /** Readonly plugin destinations skipped/blocked by the fence. */
    readonlyBlocked: SkillEnablementObservation[];
    /** Where each planned skill's master lives right now (vault, canonical, or missing). */
    masters: Record<string, SkillEnablementMasterLocation>;
};
export type SkillEnablementPlannerInput = {
    vaultRoot: string;
    installedSkillIds: readonly string[];
    userDefaults: Readonly<Record<string, EffectiveSkillState | undefined>>;
    projectOverrides: Readonly<SkillProjectOverrides>;
    userAgentOverrides?: Readonly<SkillAgentOverrides>;
    projectAgentOverrides?: Readonly<SkillAgentOverrides>;
    scope?: 'global' | 'workspace';
    destinations: readonly SkillProviderDestination[];
    /** Canonical root for this scope; masters found here migrate once into Vault. */
    canonicalRoot?: string;
    /** Deprecated compatibility flag: Vault is always permanent master; legacy canonical dirs migrate into Vault. */
    canonicalMoveAllowed?: boolean;
    copyMode?: boolean;
    vaultIndex?: SkillVaultIndex | null;
    readonlyRoots?: readonly string[];
};
/**
 * Vault is the permanent single master (`<vaultRoot>/<skillId>`). Both canonical `.agents/skills`
 * and private provider roots receive symlinks/junctions (or tracked `copyMode` copies) pointing at
 * Vault. Legacy canonical-resident masters emit a one-time `adopt-canonical-to-vault` action.
 */
export declare function planSkillEnablement(input: SkillEnablementPlannerInput): Promise<SkillEnablementPlan>;
export { resolveEffectiveSkills };
