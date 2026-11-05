"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SkillVaultIndexSchema = exports.SkillVaultEntrySchema = exports.SKILL_VAULT_INDEX_FILE_NAME = exports.SKILL_VAULT_SCHEMA_VERSION = void 0;
exports.parseSkillVaultIndex = parseSkillVaultIndex;
exports.salvageSkillVaultIndex = salvageSkillVaultIndex;
exports.emptySkillVaultIndex = emptySkillVaultIndex;
const zod_1 = require("zod");
// ② skills vault (PRD §2.2). The filesystem is the source of truth; this index
// only accelerates the UI and can be rebuilt by rescanning at any time.
exports.SKILL_VAULT_SCHEMA_VERSION = 1;
exports.SKILL_VAULT_INDEX_FILE_NAME = 'skills-index.json';
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
exports.SkillVaultEntrySchema = zod_1.z
    .object({
    /** Stable id: the vault directory name. */
    id: zod_1.z.string().min(1).max(128),
    /** SKILL.md frontmatter name (or first heading). */
    name: zod_1.z.string().min(1).max(256),
    description: zod_1.z.string().nullable(),
    sourceKind: zod_1.z.enum(['adopted', 'installed', 'bundled']),
    /** Pre-adoption location; unadopt moves the primary copy back here. */
    originPath: zod_1.z.string().nullable(),
    /** Every origin the vault primary replaced with a link (or copy). */
    linkPaths: zod_1.z.array(zod_1.z.string().min(1)).default([]),
    /** Whole-tree LF-sha256 digest, same algorithm as the share manifest. */
    digest: zod_1.z.string().regex(SHA256_PATTERN),
    sizeBytes: zod_1.z.number().int().nonnegative(),
    tags: zod_1.z.array(zod_1.z.string().min(1).max(64)).max(64),
    author: zod_1.z.string().nullable(),
    installedAt: zod_1.z.string().min(1),
    updatedAt: zod_1.z.string().min(1),
    /** True when the host cannot create symlinks and placements are copies. */
    copyMode: zod_1.z.boolean().optional()
})
    .strict();
exports.SkillVaultIndexSchema = zod_1.z
    .object({
    schemaVersion: zod_1.z.literal(exports.SKILL_VAULT_SCHEMA_VERSION),
    entries: zod_1.z.array(exports.SkillVaultEntrySchema)
})
    .strict();
function parseSkillVaultIndex(value) {
    const parsed = exports.SkillVaultIndexSchema.safeParse(value);
    return parsed.success ? parsed.data : null;
}
/**
 * Salvage read for the vault index: any unreadable or malformed file degrades
 * to null so the caller rebuilds from a scan instead of throwing. The index is
 * derived state by design; corruption must never take the CLI down.
 */
function salvageSkillVaultIndex(rawJson) {
    try {
        return parseSkillVaultIndex(JSON.parse(rawJson));
    }
    catch {
        return null;
    }
}
function emptySkillVaultIndex() {
    return { schemaVersion: exports.SKILL_VAULT_SCHEMA_VERSION, entries: [] };
}
