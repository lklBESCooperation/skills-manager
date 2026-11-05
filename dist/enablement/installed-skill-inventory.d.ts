/** A skill is installed when its master lives in the vault OR already sits in canonical. */
export declare function listInstalledSkillIds(vaultRoot: string, canonicalRoot: string): Promise<string[]>;
