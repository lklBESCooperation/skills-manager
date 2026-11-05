import { z } from 'zod';
export declare const DynamicPackRuleSchema: z.ZodObject<{
    match: z.ZodArray<z.ZodObject<{
        field: z.ZodEnum<{
            author: "author";
            namePrefix: "namePrefix";
            sourceKind: "sourceKind";
            tag: "tag";
        }>;
        op: z.ZodEnum<{
            eq: "eq";
            in: "in";
            prefix: "prefix";
        }>;
        value: z.ZodString;
    }, z.core.$strict>>;
    logic: z.ZodLiteral<"and">;
}, z.core.$strict>;
export declare const StaticSkillPackSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    members: z.ZodArray<z.ZodString>;
    createdAt: z.ZodISODateTime;
    updatedAt: z.ZodISODateTime;
}, z.core.$strict>;
export declare const DynamicSkillPackSchema: z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodISODateTime;
    updatedAt: z.ZodISODateTime;
    dynamic: z.ZodObject<{
        match: z.ZodArray<z.ZodObject<{
            field: z.ZodEnum<{
                author: "author";
                namePrefix: "namePrefix";
                sourceKind: "sourceKind";
                tag: "tag";
            }>;
            op: z.ZodEnum<{
                eq: "eq";
                in: "in";
                prefix: "prefix";
            }>;
            value: z.ZodString;
        }, z.core.$strict>>;
        logic: z.ZodLiteral<"and">;
    }, z.core.$strict>;
}, z.core.$strict>;
export declare const SkillPackSchema: z.ZodUnion<readonly [z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    members: z.ZodArray<z.ZodString>;
    createdAt: z.ZodISODateTime;
    updatedAt: z.ZodISODateTime;
}, z.core.$strict>, z.ZodObject<{
    id: z.ZodString;
    name: z.ZodString;
    description: z.ZodOptional<z.ZodString>;
    createdAt: z.ZodISODateTime;
    updatedAt: z.ZodISODateTime;
    dynamic: z.ZodObject<{
        match: z.ZodArray<z.ZodObject<{
            field: z.ZodEnum<{
                author: "author";
                namePrefix: "namePrefix";
                sourceKind: "sourceKind";
                tag: "tag";
            }>;
            op: z.ZodEnum<{
                eq: "eq";
                in: "in";
                prefix: "prefix";
            }>;
            value: z.ZodString;
        }, z.core.$strict>>;
        logic: z.ZodLiteral<"and">;
    }, z.core.$strict>;
}, z.core.$strict>]>;
export declare const isDynamicSkillPack: (pack: SkillPack) => pack is DynamicSkillPack;
export declare const SkillPackOperationModeSchema: z.ZodEnum<{
    apply: "apply";
    switch: "switch";
}>;
export declare const SkillPackPreviewDiffSchema: z.ZodObject<{
    enable: z.ZodArray<z.ZodString>;
    disable: z.ZodArray<z.ZodString>;
    keep: z.ZodArray<z.ZodString>;
    missing: z.ZodArray<z.ZodString>;
}, z.core.$strict>;
export declare const SkillPackFileSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    packs: z.ZodArray<z.ZodUnion<readonly [z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        members: z.ZodArray<z.ZodString>;
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
    }, z.core.$strict>, z.ZodObject<{
        id: z.ZodString;
        name: z.ZodString;
        description: z.ZodOptional<z.ZodString>;
        createdAt: z.ZodISODateTime;
        updatedAt: z.ZodISODateTime;
        dynamic: z.ZodObject<{
            match: z.ZodArray<z.ZodObject<{
                field: z.ZodEnum<{
                    author: "author";
                    namePrefix: "namePrefix";
                    sourceKind: "sourceKind";
                    tag: "tag";
                }>;
                op: z.ZodEnum<{
                    eq: "eq";
                    in: "in";
                    prefix: "prefix";
                }>;
                value: z.ZodString;
            }, z.core.$strict>>;
            logic: z.ZodLiteral<"and">;
        }, z.core.$strict>;
    }, z.core.$strict>]>>;
}, z.core.$strict>;
export type DynamicPackRule = z.infer<typeof DynamicPackRuleSchema>;
export type DynamicPackRuleCondition = DynamicPackRule['match'][number];
export type StaticSkillPack = z.infer<typeof StaticSkillPackSchema>;
export type DynamicSkillPack = z.infer<typeof DynamicSkillPackSchema>;
export type SkillPack = z.infer<typeof SkillPackSchema>;
export type SkillPackOperationMode = z.infer<typeof SkillPackOperationModeSchema>;
export type SkillPackPreviewDiff = z.infer<typeof SkillPackPreviewDiffSchema>;
export type SkillPackFile = z.infer<typeof SkillPackFileSchema>;
export type SkillPackScope = 'user' | 'project';
export type SkillPackReadResult = {
    packs: SkillPack[];
    error: string | null;
};
