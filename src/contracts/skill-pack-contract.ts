import { z } from 'zod'

export const DynamicPackRuleSchema = z
  .object({
    match: z
      .array(
        z
          .object({
            field: z.enum(['tag', 'author', 'sourceKind', 'namePrefix']),
            op: z.enum(['eq', 'in', 'prefix']),
            value: z.string().min(1)
          })
          .strict()
      )
      .min(1),
    logic: z.literal('and')
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

// Union keeps stored members (static) and eval-time rules (dynamic) mutually exclusive.
export const SkillPackSchema = z.union([StaticSkillPackSchema, DynamicSkillPackSchema])
export const isDynamicSkillPack = (pack: SkillPack): pack is DynamicSkillPack =>
  'dynamic' in pack && pack.dynamic !== undefined

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

export type DynamicPackRule = z.infer<typeof DynamicPackRuleSchema>
export type DynamicPackRuleCondition = DynamicPackRule['match'][number]
export type StaticSkillPack = z.infer<typeof StaticSkillPackSchema>
export type DynamicSkillPack = z.infer<typeof DynamicSkillPackSchema>
export type SkillPack = z.infer<typeof SkillPackSchema>
export type SkillPackOperationMode = z.infer<typeof SkillPackOperationModeSchema>
export type SkillPackPreviewDiff = z.infer<typeof SkillPackPreviewDiffSchema>
export type SkillPackFile = z.infer<typeof SkillPackFileSchema>
export type SkillPackScope = 'user' | 'project'
export type SkillPackReadResult = { packs: SkillPack[]; error: string | null }
