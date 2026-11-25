import { z } from 'zod'

// ② skills vault (PRD §2.2). The filesystem is the source of truth; this index
// only accelerates the UI and can be rebuilt by rescanning at any time.

export const SKILL_VAULT_SCHEMA_VERSION = 1 as const
export const SKILL_VAULT_INDEX_FILE_NAME = 'skills-index.json'

const SHA256_PATTERN = /^[a-f0-9]{64}$/

export const ManagedPlacementTopologySchema = z.enum(['symlink', 'junction', 'copy'])
export type ManagedPlacementTopology = z.infer<typeof ManagedPlacementTopologySchema>

export const ManagedPlacementRecordSchema = z
  .object({
    topology: ManagedPlacementTopologySchema,
    syncedDigest: z.string().regex(SHA256_PATTERN),
    syncedMtimeMs: z.number().optional()
  })
  .strict()

export type ManagedPlacementRecord = z.infer<typeof ManagedPlacementRecordSchema>

export const SkillVaultEntrySchema = z
  .object({
    /** Stable id: the vault directory name. */
    id: z.string().min(1).max(128),
    /** SKILL.md frontmatter name (or first heading). */
    name: z.string().min(1).max(256),
    description: z.string().nullable(),
    sourceKind: z.enum(['adopted', 'installed', 'bundled']),
    /** Pre-adoption location; unadopt moves the primary copy back here. */
    originPath: z.string().nullable(),
    /** Every origin the vault primary replaced with a link (or copy). */
    linkPaths: z.array(z.string().min(1)).default([]),
    /** Whole-tree LF-sha256 digest, same algorithm as the share manifest. */
    digest: z.string().regex(SHA256_PATTERN),
    sizeBytes: z.number().int().nonnegative(),
    tags: z.array(z.string().min(1).max(64)).max(64),
    author: z.string().nullable(),
    installedAt: z.string().min(1),
    updatedAt: z.string().min(1),
    /** True when the host cannot create symlinks and placements are copies. */
    copyMode: z.boolean().optional(),
    /** Per-placement sync digests keyed by normalized destination path (Q6 copyMode drift detection). */
    managedPlacements: z.record(z.string(), ManagedPlacementRecordSchema).optional()
  })
  .strict()

export type SkillVaultEntry = z.infer<typeof SkillVaultEntrySchema>

export const SkillVaultIndexSchema = z
  .object({
    schemaVersion: z.literal(SKILL_VAULT_SCHEMA_VERSION),
    entries: z.array(SkillVaultEntrySchema)
  })
  .strict()

export type SkillVaultIndex = z.infer<typeof SkillVaultIndexSchema>

export type CopyModePlacementState =
  | 'managed-copy-clean'
  | 'managed-copy-outdated'
  | 'managed-copy-drifted'
  | 'foreign-conflict'

/**
 * Three-way digest comparison (Q6):
 * - VaultDigest (D_V), SyncedDigest (D_S), ObservedDigest (D_O).
 */
export function classifyCopyModePlacement(input: {
  vaultDigest: string
  observedDigest: string | null
  placement: ManagedPlacementRecord | undefined
}): CopyModePlacementState {
  if (!input.placement || input.placement.topology !== 'copy' || input.observedDigest === null) {
    return 'foreign-conflict'
  }
  const { syncedDigest } = input.placement
  if (input.observedDigest !== syncedDigest) {
    return 'managed-copy-drifted'
  }
  if (syncedDigest !== input.vaultDigest) {
    return 'managed-copy-outdated'
  }
  return 'managed-copy-clean'
}

export function parseSkillVaultIndex(value: unknown): SkillVaultIndex | null {
  const parsed = SkillVaultIndexSchema.safeParse(value)
  return parsed.success ? parsed.data : null
}

/**
 * Salvage read for the vault index: any unreadable or malformed file degrades
 * to null so the caller rebuilds from a scan instead of throwing. The index is
 * derived state by design; corruption must never take the CLI down.
 */
export function salvageSkillVaultIndex(rawJson: string): SkillVaultIndex | null {
  try {
    return parseSkillVaultIndex(JSON.parse(rawJson))
  } catch {
    return null
  }
}

export function emptySkillVaultIndex(): SkillVaultIndex {
  return { schemaVersion: SKILL_VAULT_SCHEMA_VERSION, entries: [] }
}
