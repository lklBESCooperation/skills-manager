import { z } from 'zod'

export const DynamicPackConditionSchema = z
  .object({
    field: z.enum(['tag', 'author', 'sourceKind', 'namePrefix']),
    op: z.enum(['eq', 'in', 'prefix']),
    value: z.string().min(1)
  })
  .strict()

export const DynamicPackRuleSchema = z
  .object({
    match: z.array(DynamicPackConditionSchema).min(1),
    logic: z.literal('and')
  })
  .strict()

/** V2 condition: 8 fields, 6 operators, 2-level nested and/or groups (Architect §3.2). */
export const DynamicPackConditionV2Schema = z
  .object({
    field: z.enum([
      'tag',
      'author',
      'sourceKind',
      'namePrefix',
      'scope',
      'agent',
      'originRoot',
      'enabled'
    ]),
    op: z.enum(['eq', 'neq', 'in', 'not_in', 'prefix', 'contains']),
    value: z.string().min(1)
  })
  .strict()

export const DynamicPackNestedGroupSchema = z
  .object({
    logic: z.enum(['and', 'or']),
    conditions: z.array(DynamicPackConditionV2Schema).min(1)
  })
  .strict()

export const DynamicPackRuleV2Schema = z
  .object({
    logic: z.enum(['and', 'or']),
    conditions: z
      .array(z.union([DynamicPackConditionV2Schema, DynamicPackNestedGroupSchema]))
      .min(1)
  })
  .strict()

export const StaticSkillPackSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: z.string().trim().min(1),
    description: z.string().optional(),
    members: z
      .array(z.string().min(1))
      .min(1)
      .refine((members) => new Set(members).size === members.length),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true })
  })
  .strict()

export const DynamicSkillPackSchema = StaticSkillPackSchema.omit({ members: true }).extend({
  dynamic: DynamicPackRuleSchema
})

export const DynamicSkillPackV2Schema = StaticSkillPackSchema.omit({ members: true }).extend({
  dynamic: z.union([DynamicPackRuleSchema, DynamicPackRuleV2Schema])
})

// Union keeps stored members (static) and eval-time rules (dynamic) mutually exclusive.
export const SkillPackSchema = z.union([StaticSkillPackSchema, DynamicSkillPackSchema])
export const SkillPackV2Schema = z.union([StaticSkillPackSchema, DynamicSkillPackV2Schema])

export const isDynamicSkillPack = (
  pack: SkillPack | SkillPackV2
): pack is DynamicSkillPack | DynamicSkillPackV2 =>
  'dynamic' in pack && pack.dynamic !== undefined

export const isDynamicRuleV2 = (
  rule: DynamicPackRule | DynamicPackRuleV2
): rule is DynamicPackRuleV2 => 'conditions' in rule

export const SkillPackOperationModeSchema = z.enum(['apply', 'switch'])
export const SkillPackPreviewDiffSchema = z
  .object({
    enable: z.array(z.string()),
    disable: z.array(z.string()),
    keep: z.array(z.string()),
    missing: z.array(z.string())
  })
  .strict()

export const SkillPackFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    packs: z
      .array(SkillPackSchema)
      .refine((packs) => new Set(packs.map((pack) => pack.id)).size === packs.length)
  })
  .strict()

export const SkillPackFileV2Schema = z
  .object({
    schemaVersion: z.literal(2),
    packs: z
      .array(SkillPackV2Schema)
      .refine((packs) => new Set(packs.map((pack) => pack.id)).size === packs.length)
  })
  .strict()

export const SkillPackCloudRefSchema = z
  .object({
    packageId: z.string().min(1),
    shareLink: z.string().min(1).optional()
  })
  .strict()

/** Portable `.pmstudio-pack.json` format (machine paths stripped). */
export const SkillPackExportBundleSchema = z
  .object({
    format: z.literal('pmstudio-pack-v1'),
    exportedAt: z.iso.datetime({ offset: true }),
    pack: SkillPackV2Schema,
    cloudRefs: z.record(z.string(), SkillPackCloudRefSchema).optional()
  })
  .strict()

export const SkillPackUndoSnapshotSchema = z
  .object({
    undoId: z.string().min(1),
    packId: z.string().min(1),
    mode: SkillPackOperationModeSchema,
    scope: z.enum(['user', 'project']),
    createdAt: z.iso.datetime({ offset: true }),
    affectedSkillIds: z.array(z.string()),
    previousEnabledIds: z.array(z.string())
  })
  .strict()

export const SkillPackUndoRingSchema = z
  .object({
    schemaVersion: z.literal(1),
    snapshots: z.array(SkillPackUndoSnapshotSchema).max(10)
  })
  .strict()

export type DynamicPackRule = z.infer<typeof DynamicPackRuleSchema>
export type DynamicPackRuleCondition = DynamicPackRule['match'][number]
export type DynamicPackConditionV2 = z.infer<typeof DynamicPackConditionV2Schema>
export type DynamicPackNestedGroup = z.infer<typeof DynamicPackNestedGroupSchema>
export type DynamicPackRuleV2 = z.infer<typeof DynamicPackRuleV2Schema>
export type StaticSkillPack = z.infer<typeof StaticSkillPackSchema>
export type DynamicSkillPack = z.infer<typeof DynamicSkillPackSchema>
export type DynamicSkillPackV2 = z.infer<typeof DynamicSkillPackV2Schema>
export type SkillPack = z.infer<typeof SkillPackSchema>
export type SkillPackV2 = z.infer<typeof SkillPackV2Schema>
export type SkillPackOperationMode = z.infer<typeof SkillPackOperationModeSchema>
export type SkillPackPreviewDiff = z.infer<typeof SkillPackPreviewDiffSchema>
export type SkillPackFile = z.infer<typeof SkillPackFileSchema>
export type SkillPackFileV2 = z.infer<typeof SkillPackFileV2Schema>
export type SkillPackExportBundle = z.infer<typeof SkillPackExportBundleSchema>
export type SkillPackUndoSnapshot = z.infer<typeof SkillPackUndoSnapshotSchema>
export type SkillPackUndoRing = z.infer<typeof SkillPackUndoRingSchema>
export type SkillPackScope = 'user' | 'project'
export type SkillPackReadResult = { packs: SkillPackV2[]; error: string | null }
