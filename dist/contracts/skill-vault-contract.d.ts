import { z } from 'zod';
export declare const SKILL_VAULT_SCHEMA_VERSION: 1;
export declare const SKILL_VAULT_INDEX_FILE_NAME = "skills-index.json";
export declare const SkillVaultEntrySchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    description: z.ZodNullable<z.ZodString>;
    sourceKind: z.ZodEnum<{
        adopted: "adopted";
        bundled: "bundled";
        installed: "installed";
    }>;
    originPath: z.ZodNullable<z.ZodString>;
    linkPaths: z.ZodDefault<z.ZodArray<z.ZodString>>;
    digest: z.ZodString;
    sizeBytes: z.ZodNumber;
    tags: z.ZodArray<z.ZodString>;
    author: z.ZodNullable<z.ZodString>;
    installedAt: z.ZodString;
    updatedAt: z.ZodString;
    copyMode: z.ZodOptional<z.ZodBoolean>;
}, z.core.$strict>;
export type SkillVaultEntry = z.infer<typeof SkillVaultEntrySchema>;
export declare const SkillVaultIndexSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    entries: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        description: z.ZodNullable<z.ZodString>;
        sourceKind: z.ZodEnum<{
            adopted: "adopted";
            bundled: "bundled";
            installed: "installed";
        }>;
        originPath: z.ZodNullable<z.ZodString>;
        linkPaths: z.ZodDefault<z.ZodArray<z.ZodString>>;
        digest: z.ZodString;
        sizeBytes: z.ZodNumber;
        tags: z.ZodArray<z.ZodString>;
        author: z.ZodNullable<z.ZodString>;
        installedAt: z.ZodString;
        updatedAt: z.ZodString;
        copyMode: z.ZodOptional<z.ZodBoolean>;
    }, z.core.$strict>>;
}, z.core.$strict>;
export type SkillVaultIndex = z.infer<typeof SkillVaultIndexSchema>;
export declare function parseSkillVaultIndex(value: unknown): SkillVaultIndex | null;
/**
 * Salvage read for the vault index: any unreadable or malformed file degrades
 * to null so the caller rebuilds from a scan instead of throwing. The index is
 * derived state by design; corruption must never take the CLI down.
 */
export declare function salvageSkillVaultIndex(rawJson: string): SkillVaultIndex | null;
export declare function emptySkillVaultIndex(): SkillVaultIndex;
