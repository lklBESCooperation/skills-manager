import type { SkillVaultIndex } from '../contracts/skill-vault-contract';
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
export declare function adoptSkillsIntoVault(input: {
    homeDirectory: string;
    vaultRoot: string;
    indexPath: string;
    items: readonly SkillVaultAdoptItemInput[];
    filesystem?: SkillVaultAdoptFilesystem;
}): Promise<SkillVaultAdoptOutcome>;
/** Cancel management for one entry: move the primary back and drop its links. */
export declare function unadoptSkillFromVault(input: {
    vaultRoot: string;
    indexPath: string;
    id: string;
    /** Additional link locations to clear beyond the recorded origin. */
    extraLinkPaths?: readonly string[];
    filesystem?: SkillVaultAdoptFilesystem;
}): Promise<{
    originPath: string;
}>;
