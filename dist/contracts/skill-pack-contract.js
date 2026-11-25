"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SkillPackUndoRingSchema = exports.SkillPackUndoSnapshotSchema = exports.SkillPackExportBundleSchema = exports.SkillPackCloudRefSchema = exports.SkillPackFileV2Schema = exports.SkillPackFileSchema = exports.SkillPackPreviewDiffSchema = exports.SkillPackOperationModeSchema = exports.isDynamicRuleV2 = exports.isDynamicSkillPack = exports.SkillPackV2Schema = exports.SkillPackSchema = exports.DynamicSkillPackV2Schema = exports.DynamicSkillPackSchema = exports.StaticSkillPackSchema = exports.DynamicPackRuleV2Schema = exports.DynamicPackNestedGroupSchema = exports.DynamicPackConditionV2Schema = exports.DynamicPackRuleSchema = exports.DynamicPackConditionSchema = void 0;
const zod_1 = require("zod");
exports.DynamicPackConditionSchema = zod_1.z
    .object({
    field: zod_1.z.enum(['tag', 'author', 'sourceKind', 'namePrefix']),
    op: zod_1.z.enum(['eq', 'in', 'prefix']),
    value: zod_1.z.string().min(1)
})
    .strict();
exports.DynamicPackRuleSchema = zod_1.z
    .object({
    match: zod_1.z.array(exports.DynamicPackConditionSchema).min(1),
    logic: zod_1.z.literal('and')
})
    .strict();
/** V2 condition: 8 fields, 6 operators, 2-level nested and/or groups (Architect §3.2). */
exports.DynamicPackConditionV2Schema = zod_1.z
    .object({
    field: zod_1.z.enum([
        'tag',
        'author',
        'sourceKind',
        'namePrefix',
        'scope',
        'agent',
        'originRoot',
        'enabled'
    ]),
    op: zod_1.z.enum(['eq', 'neq', 'in', 'not_in', 'prefix', 'contains']),
    value: zod_1.z.string().min(1)
})
    .strict();
exports.DynamicPackNestedGroupSchema = zod_1.z
    .object({
    logic: zod_1.z.enum(['and', 'or']),
    conditions: zod_1.z.array(exports.DynamicPackConditionV2Schema).min(1)
})
    .strict();
exports.DynamicPackRuleV2Schema = zod_1.z
    .object({
    logic: zod_1.z.enum(['and', 'or']),
    conditions: zod_1.z
        .array(zod_1.z.union([exports.DynamicPackConditionV2Schema, exports.DynamicPackNestedGroupSchema]))
        .min(1)
})
    .strict();
exports.StaticSkillPackSchema = zod_1.z
    .object({
    id: zod_1.z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
    name: zod_1.z.string().trim().min(1),
    description: zod_1.z.string().optional(),
    members: zod_1.z
        .array(zod_1.z.string().min(1))
        .min(1)
        .refine((members) => new Set(members).size === members.length),
    createdAt: zod_1.z.iso.datetime({ offset: true }),
    updatedAt: zod_1.z.iso.datetime({ offset: true })
})
    .strict();
exports.DynamicSkillPackSchema = exports.StaticSkillPackSchema.omit({ members: true }).extend({
    dynamic: exports.DynamicPackRuleSchema
});
exports.DynamicSkillPackV2Schema = exports.StaticSkillPackSchema.omit({ members: true }).extend({
    dynamic: zod_1.z.union([exports.DynamicPackRuleSchema, exports.DynamicPackRuleV2Schema])
});
// Union keeps stored members (static) and eval-time rules (dynamic) mutually exclusive.
exports.SkillPackSchema = zod_1.z.union([exports.StaticSkillPackSchema, exports.DynamicSkillPackSchema]);
exports.SkillPackV2Schema = zod_1.z.union([exports.StaticSkillPackSchema, exports.DynamicSkillPackV2Schema]);
const isDynamicSkillPack = (pack) => 'dynamic' in pack && pack.dynamic !== undefined;
exports.isDynamicSkillPack = isDynamicSkillPack;
const isDynamicRuleV2 = (rule) => 'conditions' in rule;
exports.isDynamicRuleV2 = isDynamicRuleV2;
exports.SkillPackOperationModeSchema = zod_1.z.enum(['apply', 'switch']);
exports.SkillPackPreviewDiffSchema = zod_1.z
    .object({
    enable: zod_1.z.array(zod_1.z.string()),
    disable: zod_1.z.array(zod_1.z.string()),
    keep: zod_1.z.array(zod_1.z.string()),
    missing: zod_1.z.array(zod_1.z.string())
})
    .strict();
exports.SkillPackFileSchema = zod_1.z
    .object({
    schemaVersion: zod_1.z.literal(1),
    packs: zod_1.z
        .array(exports.SkillPackSchema)
        .refine((packs) => new Set(packs.map((pack) => pack.id)).size === packs.length)
})
    .strict();
exports.SkillPackFileV2Schema = zod_1.z
    .object({
    schemaVersion: zod_1.z.literal(2),
    packs: zod_1.z
        .array(exports.SkillPackV2Schema)
        .refine((packs) => new Set(packs.map((pack) => pack.id)).size === packs.length)
})
    .strict();
exports.SkillPackCloudRefSchema = zod_1.z
    .object({
    packageId: zod_1.z.string().min(1),
    shareLink: zod_1.z.string().min(1).optional()
})
    .strict();
/** Portable `.pmstudio-pack.json` format (machine paths stripped). */
exports.SkillPackExportBundleSchema = zod_1.z
    .object({
    format: zod_1.z.literal('pmstudio-pack-v1'),
    exportedAt: zod_1.z.iso.datetime({ offset: true }),
    pack: exports.SkillPackV2Schema,
    cloudRefs: zod_1.z.record(zod_1.z.string(), exports.SkillPackCloudRefSchema).optional()
})
    .strict();
exports.SkillPackUndoSnapshotSchema = zod_1.z
    .object({
    undoId: zod_1.z.string().min(1),
    packId: zod_1.z.string().min(1),
    mode: exports.SkillPackOperationModeSchema,
    scope: zod_1.z.enum(['user', 'project']),
    createdAt: zod_1.z.iso.datetime({ offset: true }),
    affectedSkillIds: zod_1.z.array(zod_1.z.string()),
    previousEnabledIds: zod_1.z.array(zod_1.z.string())
})
    .strict();
exports.SkillPackUndoRingSchema = zod_1.z
    .object({
    schemaVersion: zod_1.z.literal(1),
    snapshots: zod_1.z.array(exports.SkillPackUndoSnapshotSchema).max(10)
})
    .strict();
