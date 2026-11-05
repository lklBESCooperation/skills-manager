import { resolveEffectiveSkills, type EffectiveSkillState, type SkillProjectOverrides } from '../contracts/skill-enablement';
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
} | {
    kind: 'remove';
    observation: SkillEnablementObservation;
} | {
    kind: 'keep';
    observation: SkillEnablementObservation;
}
/** Canonical-root providers enable by moving the vault master into canonical, not by linking. */
 | {
    kind: 'move-to-canonical';
    observation: SkillEnablementObservation;
};
export type SkillEnablementPlan = {
    actions: SkillEnablementPlanAction[];
    counts: {
        add: number;
        remove: number;
        keep: number;
        moveToCanonical: number;
        removeCanonical: number;
    };
    /** Unresolvable destinations the applier must not touch (foreign directories at a target). */
    conflicts: SkillEnablementObservation[];
    /** Where each planned skill's master lives right now (vault, canonical, or missing). */
    masters: Record<string, SkillEnablementMasterLocation>;
};
export type SkillEnablementPlannerInput = {
    vaultRoot: string;
    installedSkillIds: readonly string[];
    userDefaults: Readonly<Record<string, EffectiveSkillState | undefined>>;
    projectOverrides: Readonly<SkillProjectOverrides>;
    destinations: readonly SkillProviderDestination[];
    /** Canonical root for this scope; masters found here count as installed. */
    canonicalRoot?: string;
    /**
     * Moves relocate the single master, so they may only cross vault↔canonical inside one
     * scope. A canonical root outside the vault's scope gets a plain link instead.
     */
    canonicalMoveAllowed?: boolean;
};
/**
 * Diff actual per-provider placement against the resolved target. Non-canonical roots plan a
 * link (add), unlink (remove), or keep; canonical-root providers plan a master move instead.
 */
export declare function planSkillEnablement(input: SkillEnablementPlannerInput): Promise<SkillEnablementPlan>;
export { resolveEffectiveSkills };
