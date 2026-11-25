import { type SkillCreateWizardInput, type SkillEditorFileEntry } from '../contracts/skill-editor-contract';
import type { SkillVaultIndex } from '../contracts/skill-vault-contract';
export type SkillEditorScopeOptions = {
    vaultRoot: string;
    indexPath: string;
    readonlyRoots?: readonly string[];
};
export declare function listSkillFiles(scope: SkillEditorScopeOptions, skillId: string): Promise<SkillEditorFileEntry[]>;
export declare function readSkillFile(scope: SkillEditorScopeOptions, skillId: string, relativePath: string): Promise<string>;
export declare function writeSkillFile(scope: SkillEditorScopeOptions, skillId: string, relativePath: string, content: string, options?: {
    validateFrontmatter?: boolean;
}): Promise<{
    path: string;
    digest: string;
}>;
export declare function deleteSkillFile(scope: SkillEditorScopeOptions, skillId: string, relativePath: string): Promise<void>;
export declare function createLocalSkillInVault(scope: SkillEditorScopeOptions, input: SkillCreateWizardInput, extraFiles?: readonly {
    relativePath: string;
    content: string;
}[]): Promise<{
    id: string;
    vaultPath: string;
    index: SkillVaultIndex | null;
}>;
