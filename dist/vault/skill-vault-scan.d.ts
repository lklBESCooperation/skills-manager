import type { SkillVaultIndex } from '../contracts/skill-vault-contract';
export type SkillVaultDisposition = 'managed' | 'adoptable' | 'duplicate-same-digest' | 'conflict' | 'orca-managed';
export type SkillVaultCandidate = {
    id: string;
    path: string;
    digest: string;
    mtimeMs: number | null;
    sizeBytes: number;
};
export type SkillVaultAdoptItem = {
    id: string;
    disposition: SkillVaultDisposition;
    digest: string;
    /** The copy that becomes the vault primary. */
    originPath: string;
    /** Copies at the same digest that adopt turns into links to the primary. */
    mergePaths: string[];
};
export type SkillVaultScanItem = {
    id: string;
    disposition: SkillVaultDisposition;
    originPath: string;
    digest: string;
    sizeBytes: number;
    mtimeMs: number | null;
    mergePaths: string[];
    /** Conflicting variants with differing digests; listed for a user decision. */
    conflicts: SkillVaultCandidate[];
};
export type SkillVaultScanPlan = {
    items: SkillVaultScanItem[];
    counts: {
        managed: number;
        adoptable: number;
        merged: number;
        conflicts: number;
        orcaManaged: number;
    };
};
export type SkillVaultScanInput = {
    homeDirectory: string;
    vaultRoot: string;
    /** Skill directories found by discovery in agent roots (vault root excluded). */
    candidatePaths: readonly string[];
    /** Install receipts directory; omitting it disables Orca-managed detection. */
    installStateDirectory?: string;
    /** Reserved for index-driven fast paths; the scan stays filesystem-driven. */
    index?: SkillVaultIndex | null;
};
/** Group candidates by directory name; each group's verdict is one plan row. */
export declare function scanSkillVault(input: SkillVaultScanInput): Promise<SkillVaultScanPlan>;
/** Rows an adopt run acts on; conflicts stay out for an explicit user choice. */
export declare function adoptableSkillVaultItems(plan: SkillVaultScanPlan): SkillVaultAdoptItem[];
