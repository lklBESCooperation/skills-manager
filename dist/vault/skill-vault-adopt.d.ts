import { type ManagedPlacementRecord, type SkillVaultIndex } from '../contracts/skill-vault-contract';
export type SkillVaultAdoptOutcome = {
    adopted: {
        id: string;
        vaultPath: string;
        originPath: string;
        merged: string[];
    }[];
    copyMode: boolean;
    index: SkillVaultIndex;
};
export type SkillVaultAdoptItemInput = {
    id: string;
    originPath: string;
    mergePaths: readonly string[];
};
export type SkillVaultAdoptFilesystem = {
    mkdir(path: string): Promise<void>;
    rename(source: string, target: string): Promise<void>;
    remove(path: string): Promise<void>;
    symlink(target: string, path: string, kind: 'dir' | 'junction'): Promise<void>;
    copyTree(source: string, target: string): Promise<void>;
    readFile(path: string): Promise<string>;
    lstat(path: string): Promise<{
        isSymbolicLink(): boolean;
    } | null>;
};
export declare const nativeSkillVaultAdoptFilesystem: SkillVaultAdoptFilesystem;
export type AdoptedRecord = {
    id: string;
    vaultPath: string;
    originPath: string;
    mergePaths: string[];
    digest: string;
    name: string;
    description: string | null;
    sizeBytes: number;
    installedAt: string;
    managedPlacements: Record<string, ManagedPlacementRecord>;
};
/**
 * Single-skill atomic adoption unit: stages, moves primary into Vault, links/copies origins,
 * and rolls back ONLY this skill if any step fails.
 */
export declare function adoptSingleSkillUnit(input: {
    vaultRoot: string;
    item: SkillVaultAdoptItemInput;
    copyMode: boolean;
    installedAt?: string;
    readonlyRoots?: readonly string[];
    filesystem?: SkillVaultAdoptFilesystem;
}): Promise<AdoptedRecord>;
/** Batch-atomic adopt (legacy contract preserved: any failure rolls back all items in the batch). */
export declare function adoptSkillsIntoVault(input: {
    homeDirectory: string;
    vaultRoot: string;
    indexPath: string;
    items: readonly SkillVaultAdoptItemInput[];
    readonlyRoots?: readonly string[];
    filesystem?: SkillVaultAdoptFilesystem;
}): Promise<SkillVaultAdoptOutcome>;
export declare function toIndexEntry(record: AdoptedRecord, now: string, copyMode: boolean): SkillVaultIndex['entries'][number];
/** Promote a drifted copyMode placement into Vault (updating Vault master & syncedDigest). */
export declare function promoteCopyModeToVault(input: {
    vaultRoot: string;
    indexPath: string;
    id: string;
    placementPath: string;
    readonlyRoots?: readonly string[];
}): Promise<SkillVaultIndex>;
/** Reset a drifted/outdated copyMode placement from the authoritative Vault master. */
export declare function resetCopyModeFromVault(input: {
    vaultRoot: string;
    indexPath: string;
    id: string;
    placementPath: string;
    readonlyRoots?: readonly string[];
}): Promise<SkillVaultIndex>;
/** Cancel management for one entry: move the primary back and drop its links. */
export declare function unadoptSkillFromVault(input: {
    vaultRoot: string;
    indexPath: string;
    id: string;
    /** Additional link locations to clear beyond the recorded origin. */
    extraLinkPaths?: readonly string[];
    readonlyRoots?: readonly string[];
    force?: boolean;
    filesystem?: SkillVaultAdoptFilesystem;
}): Promise<{
    originPath: string;
}>;
