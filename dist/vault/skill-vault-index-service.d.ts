import { emptySkillVaultIndex, type SkillVaultIndex } from '../contracts/skill-vault-contract';
export declare function readSkillVaultIndex(indexPath: string): Promise<SkillVaultIndex | null>;
export declare function writeSkillVaultIndex(indexPath: string, index: SkillVaultIndex): Promise<void>;
export declare function rebuildSkillVaultIndex(indexPath: string, entries: SkillVaultIndex['entries']): Promise<SkillVaultIndex>;
/** Whole-tree LF-normalized sha256, identical to the share-manifest package digest. */
export declare function computeSkillVaultDigest(skillDirectory: string): Promise<string>;
export declare function skillVaultSizeBytes(skillDirectory: string): Promise<number>;
/**
 * Probe once per process whether this host accepts a directory symlink/junction
 * inside the vault root. On failure (Windows without privilege, exFAT, WSL
 * cross-filesystem) the vault degrades to copy mode (PRD §2.3).
 */
export declare function detectSkillVaultCopyMode(vaultRoot: string): Promise<boolean>;
export { emptySkillVaultIndex };
