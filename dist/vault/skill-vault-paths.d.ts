export declare function normalizedSkillVaultPath(path: string): string;
export declare function userSkillVaultRoot(homeDirectory: string): string;
export declare function userSkillVaultIndexPath(homeDirectory: string): string;
export declare function projectSkillVaultRoot(workspaceDirectory: string): string;
/** Symmetric with `userSkillVaultIndexPath`: `<ws>/.pmstudio/skills-index.json` (D-5). */
export declare function projectSkillVaultIndexPath(workspaceDirectory: string): string;
/** Legacy pre-v0.2 location kept strictly for read-only migration fallback. */
export declare function legacyProjectSkillVaultIndexPath(workspaceDirectory: string): string;
export declare function skillVaultEntryRoot(vaultRoot: string, id: string): string;
