"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SkillPackFileSchema = exports.SkillPackPreviewDiffSchema = exports.SkillPackOperationModeSchema = exports.isDynamicSkillPack = exports.SkillPackSchema = exports.DynamicSkillPackSchema = exports.StaticSkillPackSchema = exports.DynamicPackRuleSchema = void 0;
const zod_1 = require("zod");
exports.DynamicPackRuleSchema = zod_1.z
    .object({
    match: zod_1.z
        .array(zod_1.z
        .object({
        field: zod_1.z.enum(['tag', 'author', 'sourceKind', 'namePrefix']),
        op: zod_1.z.enum(['eq', 'in', 'prefix']),
        value: zod_1.z.string().min(1)
    })
        .strict())
        .min(1),
    logic: zod_1.z.literal('and')
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
// Union keeps stored members (static) and eval-time rules (dynamic) mutually exclusive.
exports.SkillPackSchema = zod_1.z.union([exports.StaticSkillPackSchema, exports.DynamicSkillPackSchema]);
const isDynamicSkillPack = (pack) => 'dynamic' in pack && pack.dynamic !== undefined;
exports.isDynamicSkillPack = isDynamicSkillPack;
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
